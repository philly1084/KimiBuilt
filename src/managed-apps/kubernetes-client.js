'use strict';

const fs = require('fs');
const https = require('https');
const { config } = require('../config');
const settingsController = require('../routes/admin/settings.controller');
const { SSHExecuteTool } = require('../agent-sdk/tools/categories/ssh/SSHExecuteTool');

function normalizeText(value = '') {
    return String(value || '').trim();
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeKubernetesName(value = '', fallback = 'managed-app') {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');
    return normalized || fallback;
}

function buildDockerConfigJson({ registryHost = '', username = '', password = '' } = {}) {
    const auth = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
    return JSON.stringify({
        auths: {
            [registryHost]: {
                username,
                password,
                auth,
            },
        },
    });
}

function normalizeDeployTarget(value = '') {
    const normalized = normalizeText(value).toLowerCase();
    if (['ssh', 'remote', 'remote-ssh', 'remote_ssh'].includes(normalized)) {
        return 'ssh';
    }
    if (['in-cluster', 'in_cluster', 'cluster', 'local-cluster', 'local_cluster'].includes(normalized)) {
        return 'ssh';
    }
    return '';
}

function normalizeNamespacePrefix(value = 'app-') {
    const stem = sanitizeKubernetesName(String(value || '').replace(/-+$/g, ''), 'app');
    return stem ? `${stem}-` : 'app-';
}

function normalizeManagedAppNamespace(value = '', slug = '', namespacePrefix = 'app-') {
    const prefix = normalizeNamespacePrefix(namespacePrefix);
    const normalizedValue = sanitizeKubernetesName(value, '');
    if (normalizedValue && normalizedValue.startsWith(prefix)) {
        return normalizedValue;
    }

    const normalizedSlug = sanitizeKubernetesName(slug, '');
    const shouldUseSlug = normalizedSlug && (
        !normalizedValue
        || normalizedValue === 'managed-app'
        || normalizedValue === 'managed-apps'
        || normalizedValue === 'default'
    );
    const base = shouldUseSlug
        ? normalizedSlug
        : (normalizedValue || normalizedSlug || 'managed-app');
    return sanitizeKubernetesName(`${prefix}${base}`, 'managed-apps');
}

function parseInteger(value, fallback = 0) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function escapeRegExp(value = '') {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readMarkerValue(text = '', marker = '') {
    const match = String(text || '').match(new RegExp(`^${escapeRegExp(marker)}=(.*)$`, 'm'));
    return match?.[1] ? String(match[1]).trim() : '';
}

function readMarkerValues(text = '', marker = '') {
    const prefix = `${String(marker || '').trim()}=`;
    return String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith(prefix))
        .map((line) => line.slice(prefix.length).trim())
        .filter(Boolean);
}

function createNoopTracker() {
    return {
        recordExecution() {},
        recordNetworkCall() {},
    };
}

function parseBooleanMarkerValue(text = '', marker = '') {
    return /^true$/i.test(readMarkerValue(text, marker));
}

class KubernetesClient {
    constructor(options = {}) {
        this.config = options.config || config.kubernetes;
        this.managedAppsConfig = options.managedAppsConfig || config.managedApps || {};
        this.deployConfig = options.deployConfigProvider || (() => (
            typeof settingsController.getEffectiveDeployConfig === 'function'
                ? settingsController.getEffectiveDeployConfig()
                : {}
        ));
        this.sshTool = options.sshTool || new SSHExecuteTool({
            id: 'ssh-execute-managed-app-internal',
            name: 'Managed App SSH Internal',
            description: 'Internal SSH helper for managed app deployments',
        });
    }

    resolveDeployTarget(value = '') {
        return 'ssh';
    }

    isInClusterConfigured() {
        return this.config.enabled !== false
            && Boolean(this.config.serviceHost)
            && fs.existsSync(this.config.tokenPath);
    }

    isSshConfigured() {
        const ssh = typeof settingsController.getEffectiveSshConfig === 'function'
            ? settingsController.getEffectiveSshConfig()
            : {};
        return Boolean(ssh.enabled && ssh.host && ssh.username && (ssh.password || ssh.privateKeyPath));
    }

    isConfigured(deploymentTarget = '') {
        return this.isSshConfigured();
    }

    getApiBaseUrl() {
        const host = normalizeText(this.config.serviceHost || 'kubernetes.default.svc');
        const port = Number(this.config.servicePort) || 443;
        return `https://${host}:${port}`;
    }

    getAgent() {
        const ca = fs.existsSync(this.config.caPath)
            ? fs.readFileSync(this.config.caPath)
            : undefined;
        return new https.Agent({
            ca,
            rejectUnauthorized: this.config.verifyTls !== false,
        });
    }

    getAuthToken() {
        return fs.readFileSync(this.config.tokenPath, 'utf8').trim();
    }

    async request(method, pathname, body = null, { allowNotFound = false } = {}) {
        if (!this.isInClusterConfigured()) {
            throw new Error('Managed app deployment requires an in-cluster Kubernetes service account.');
        }

        const url = new URL(pathname, `${this.getApiBaseUrl()}/`);

        return new Promise((resolve, reject) => {
            const request = https.request(url, {
                method,
                agent: this.getAgent(),
                headers: {
                    Authorization: `Bearer ${this.getAuthToken()}`,
                    Accept: 'application/json',
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                },
            }, (response) => {
                let data = '';
                response.on('data', (chunk) => {
                    data += chunk.toString();
                });
                response.on('end', () => {
                    if (allowNotFound && response.statusCode === 404) {
                        resolve(null);
                        return;
                    }
                    if ((response.statusCode || 500) >= 400) {
                        reject(new Error(`Kubernetes API ${method} ${pathname} failed: HTTP ${response.statusCode}${data ? ` ${data}` : ''}`));
                        return;
                    }
                    if (!data) {
                        resolve({});
                        return;
                    }
                    try {
                        resolve(JSON.parse(data));
                    } catch (_error) {
                        resolve({ raw: data });
                    }
                });
            });

            request.on('error', reject);
            if (body) {
                request.write(JSON.stringify(body));
            }
            request.end();
        });
    }

    async getNamespace(name = '') {
        return this.request('GET', `/api/v1/namespaces/${encodeURIComponent(name)}`, null, {
            allowNotFound: true,
        });
    }

    async ensureNamespace(name = '') {
        const namespace = sanitizeKubernetesName(name, 'managed-apps');
        const existing = await this.getNamespace(namespace);
        if (existing) {
            return existing;
        }

        return this.request('POST', '/api/v1/namespaces', {
            apiVersion: 'v1',
            kind: 'Namespace',
            metadata: {
                name: namespace,
                labels: {
                    'kimibuilt.io/managed-app': 'true',
                },
            },
        });
    }

    async upsertNamespacedResource({ kind = '', apiPath = '', collectionPath = '', namespace = '', name = '', resource = {} } = {}) {
        const existing = await this.request('GET', `${apiPath}/${encodeURIComponent(name)}`, null, {
            allowNotFound: true,
        });
        if (!existing) {
            return this.request('POST', collectionPath, resource);
        }

        return this.request('PUT', `${apiPath}/${encodeURIComponent(name)}`, {
            ...resource,
            metadata: {
                ...(resource.metadata || {}),
                resourceVersion: existing.metadata?.resourceVersion,
            },
        });
    }

    async ensureRegistryPullSecret({
        namespace = '',
        name = '',
        registryHost = '',
        username = '',
        password = '',
    } = {}) {
        if (!normalizeText(registryHost) || !normalizeText(username) || !normalizeText(password)) {
            return null;
        }

        const secretName = sanitizeKubernetesName(name || 'gitea-registry-credentials', 'gitea-registry-credentials');
        return this.upsertNamespacedResource({
            kind: 'Secret',
            apiPath: `/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets`,
            collectionPath: `/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets`,
            namespace,
            name: secretName,
            resource: {
                apiVersion: 'v1',
                kind: 'Secret',
                metadata: {
                    name: secretName,
                    namespace,
                    labels: {
                        'kimibuilt.io/managed-app': 'true',
                    },
                },
                type: 'kubernetes.io/dockerconfigjson',
                data: {
                    '.dockerconfigjson': Buffer.from(buildDockerConfigJson({
                        registryHost,
                        username,
                        password,
                    }), 'utf8').toString('base64'),
                },
            },
        });
    }

    buildDeploymentManifest({
        namespace = '',
        deploymentName = '',
        image = '',
        containerPort = 80,
        registryPullSecretName = '',
        appLabels = {},
    } = {}) {
        return {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: {
                name: deploymentName,
                namespace,
                labels: appLabels,
            },
            spec: {
                replicas: 1,
                selector: {
                    matchLabels: appLabels,
                },
                template: {
                    metadata: {
                        labels: appLabels,
                    },
                    spec: {
                        ...(registryPullSecretName
                            ? {
                                imagePullSecrets: [{
                                    name: registryPullSecretName,
                                }],
                            }
                            : {}),
                        containers: [{
                            name: 'app',
                            image,
                            imagePullPolicy: 'Always',
                            ports: [{
                                name: 'http',
                                containerPort,
                            }],
                        }],
                    },
                },
            },
        };
    }

    buildServiceManifest({
        namespace = '',
        serviceName = '',
        containerPort = 80,
        appLabels = {},
    } = {}) {
        return {
            apiVersion: 'v1',
            kind: 'Service',
            metadata: {
                name: serviceName,
                namespace,
                labels: appLabels,
            },
            spec: {
                selector: appLabels,
                ports: [{
                    name: 'http',
                    port: 80,
                    targetPort: containerPort,
                }],
            },
        };
    }

    buildIngressManifest({
        namespace = '',
        ingressName = '',
        publicHost = '',
        serviceName = '',
        ingressClassName = '',
        tlsClusterIssuer = '',
        tlsSecretName = '',
        appLabels = {},
    } = {}) {
        return {
            apiVersion: 'networking.k8s.io/v1',
            kind: 'Ingress',
            metadata: {
                name: ingressName,
                namespace,
                labels: appLabels,
                annotations: {
                    ...(tlsClusterIssuer ? { 'cert-manager.io/cluster-issuer': tlsClusterIssuer } : {}),
                },
            },
            spec: {
                ...(ingressClassName ? { ingressClassName } : {}),
                rules: [{
                    host: publicHost,
                    http: {
                        paths: [{
                            path: '/',
                            pathType: 'Prefix',
                            backend: {
                                service: {
                                    name: serviceName,
                                    port: {
                                        number: 80,
                                    },
                                },
                            },
                        }],
                    },
                }],
                ...(tlsSecretName
                    ? {
                        tls: [{
                            hosts: [publicHost],
                            secretName: tlsSecretName,
                        }],
                    }
                    : {}),
            },
        };
    }

    async waitForDeploymentReady(namespace = '', deploymentName = '', timeoutMs = 120000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const deployment = await this.request(
                'GET',
                `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(deploymentName)}`,
            );
            const desired = Number(deployment?.spec?.replicas || 1);
            const available = Number(deployment?.status?.availableReplicas || 0);
            const ready = Number(deployment?.status?.readyReplicas || 0);
            if (available >= desired && ready >= desired) {
                return {
                    ok: true,
                    desiredReplicas: desired,
                    availableReplicas: available,
                    readyReplicas: ready,
                };
            }
            await sleep(3000);
        }

        return {
            ok: false,
            error: `Timed out waiting for deployment ${namespace}/${deploymentName} to become ready.`,
        };
    }

    async secretExists(namespace = '', name = '') {
        const secret = await this.request(
            'GET',
            `/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(name)}`,
            null,
            { allowNotFound: true },
        );
        return Boolean(secret);
    }

    async verifyHttps(publicHost = '', timeoutMs = 15000) {
        const host = normalizeText(publicHost);
        if (!host) {
            return {
                ok: false,
                error: 'No public host configured.',
            };
        }

        try {
            const response = await fetch(`https://${host}/`, {
                method: 'GET',
                redirect: 'manual',
                signal: AbortSignal.timeout(timeoutMs),
            });
            return {
                ok: response.ok || [301, 302, 307, 308].includes(response.status),
                status: response.status,
            };
        } catch (error) {
            return {
                ok: false,
                error: error.message,
            };
        }
    }

    async waitForHttps(publicHost = '', {
        timeoutMs = 300000,
        intervalMs = 5000,
        requestTimeoutMs = 15000,
    } = {}) {
        const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 300000);
        let lastResult = {
            ok: false,
            error: 'HTTPS verification did not run.',
        };

        while (Date.now() < deadline) {
            lastResult = await this.verifyHttps(publicHost, requestTimeoutMs);
            if (lastResult.ok) {
                return {
                    ...lastResult,
                    attemptsCompleted: true,
                };
            }

            await sleep(Math.max(250, Number(intervalMs) || 5000));
        }

        return {
            ...lastResult,
            attemptsCompleted: true,
        };
    }

    buildRemoteTlsStatusCommand({
        namespace = '',
        ingressName = '',
        tlsSecretName = '',
        timeoutSeconds = 300,
        pollIntervalSeconds = 5,
    } = {}) {
        return [
            'set -e',
            'kubectl_cmd() {',
            '  if command -v kubectl >/dev/null 2>&1; then kubectl "$@"; return; fi',
            '  if command -v k3s >/dev/null 2>&1; then k3s kubectl "$@"; return; fi',
            '  echo "kubectl or k3s is required on the remote host" >&2',
            '  exit 1',
            '}',
            'if [ -f /etc/rancher/k3s/k3s.yaml ] && [ -z "${KUBECONFIG:-}" ]; then export KUBECONFIG=/etc/rancher/k3s/k3s.yaml; fi',
            `namespace=${this.quoteShellArg(namespace)}`,
            `ingress_name=${this.quoteShellArg(ingressName)}`,
            `tls_secret_name=${this.quoteShellArg(tlsSecretName)}`,
            `timeout_seconds=${this.quoteShellArg(String(Math.max(30, Number(timeoutSeconds) || 300)))}`,
            `poll_interval_seconds=${this.quoteShellArg(String(Math.max(1, Number(pollIntervalSeconds) || 5)))}`,
            'deadline=$(( $(date +%s) + timeout_seconds ))',
            'tls_ready=false',
            'certificate_ready=unknown',
            'while [ "$(date +%s)" -le "$deadline" ]; do',
            '  if kubectl_cmd get secret "$tls_secret_name" -n "$namespace" >/dev/null 2>&1; then',
            '    tls_ready=true',
            '    break',
            '  fi',
            '  sleep "$poll_interval_seconds"',
            'done',
            'echo "__KIMIBUILT_TLS_SECRET__=${tls_ready}"',
            'ingress_host=$(kubectl_cmd get ingress "$ingress_name" -n "$namespace" -o jsonpath=\'{.spec.rules[0].host}\' 2>/dev/null || true)',
            'if [ -n "${ingress_host:-}" ]; then echo "__KIMIBUILT_INGRESS_HOST__=${ingress_host}"; fi',
            'ingress_address=$(kubectl_cmd get ingress "$ingress_name" -n "$namespace" -o jsonpath=\'{range .status.loadBalancer.ingress[*]}{.ip}{.hostname}{" "}{end}\' 2>/dev/null || true)',
            'if [ -n "${ingress_address:-}" ]; then echo "__KIMIBUILT_INGRESS_ADDRESS__=${ingress_address}"; fi',
            'if [ "$tls_ready" = "true" ]; then',
            '  certificate_ready=true',
            'else',
            '  certificate_ready=unknown',
            'fi',
            'echo "__KIMIBUILT_CERTIFICATE_READY__=${certificate_ready}"',
        ].join('\n');
    }

    async waitForRemoteTlsSecret({
        namespace = '',
        ingressName = '',
        tlsSecretName = '',
        timeoutMs = 300000,
    } = {}) {
        const command = this.buildRemoteTlsStatusCommand({
            namespace,
            ingressName,
            tlsSecretName,
            timeoutSeconds: Math.ceil(Math.max(1000, Number(timeoutMs) || 300000) / 1000),
        });
        const result = await this.sshTool.handler({
            command,
            timeout: Math.max(60000, Number(timeoutMs) || 300000),
        }, {}, createNoopTracker());

        return {
            ok: parseBooleanMarkerValue(result.stdout || '', '__KIMIBUILT_TLS_SECRET__'),
            certificateReady: parseBooleanMarkerValue(result.stdout || '', '__KIMIBUILT_CERTIFICATE_READY__'),
            ingressHost: readMarkerValue(result.stdout || '', '__KIMIBUILT_INGRESS_HOST__'),
            ingressAddress: readMarkerValue(result.stdout || '', '__KIMIBUILT_INGRESS_ADDRESS__'),
            stdout: String(result.stdout || ''),
            stderr: String(result.stderr || ''),
            exitCode: Number(result.exitCode || 0),
            host: result.host,
        };
    }

    async deployManagedApp({
        slug = '',
        namespace = '',
        publicHost = '',
        image = '',
        containerPort = 80,
        registryPullSecretName = '',
        registryHost = '',
        registryUsername = '',
        registryPassword = '',
        deploymentTarget = '',
    } = {}) {
        return this.deployManagedAppViaSsh({
            slug,
            namespace,
            publicHost,
            image,
            containerPort,
            registryPullSecretName,
            registryHost,
            registryUsername,
            registryPassword,
        });
    }

    buildNamespaceManifest(namespace = '') {
        return {
            apiVersion: 'v1',
            kind: 'Namespace',
            metadata: {
                name: namespace,
                labels: {
                    'kimibuilt.io/managed-app': 'true',
                },
            },
        };
    }

    buildRegistryPullSecretManifest({
        namespace = '',
        name = '',
        registryHost = '',
        username = '',
        password = '',
    } = {}) {
        if (!normalizeText(registryHost) || !normalizeText(username) || !normalizeText(password)) {
            return null;
        }

        const secretName = sanitizeKubernetesName(name || 'gitea-registry-credentials', 'gitea-registry-credentials');
        return {
            apiVersion: 'v1',
            kind: 'Secret',
            metadata: {
                name: secretName,
                namespace,
                labels: {
                    'kimibuilt.io/managed-app': 'true',
                },
            },
            type: 'kubernetes.io/dockerconfigjson',
            data: {
                '.dockerconfigjson': Buffer.from(buildDockerConfigJson({
                    registryHost,
                    username,
                    password,
                }), 'utf8').toString('base64'),
            },
        };
    }

    buildOpaqueSecretManifest({
        namespace = '',
        name = '',
        labels = {},
        stringData = {},
    } = {}) {
        return {
            apiVersion: 'v1',
            kind: 'Secret',
            metadata: {
                name: sanitizeKubernetesName(name, 'managed-app-secret'),
                namespace,
                labels,
            },
            type: 'Opaque',
            stringData: Object.fromEntries(
                Object.entries(stringData || {})
                    .map(([key, value]) => [String(key || '').trim(), String(value ?? '')])
                    .filter(([key]) => Boolean(key)),
            ),
        };
    }

    quoteShellArg(value) {
        return `'${String(value || '').replace(/'/g, `'"'"'`)}'`;
    }

    buildRemotePlatformDoctorCommand({ platformNamespace = '' } = {}) {
        const namespace = sanitizeKubernetesName(
            platformNamespace || this.managedAppsConfig.platformNamespace || 'agent-platform',
            'agent-platform',
        );

        return [
            'set -e',
            'kubectl_cmd() {',
            '  if command -v kubectl >/dev/null 2>&1; then kubectl "$@"; return; fi',
            '  if command -v k3s >/dev/null 2>&1; then k3s kubectl "$@"; return; fi',
            '  echo "kubectl or k3s is required on the remote host" >&2',
            '  exit 1',
            '}',
            'if [ -f /etc/rancher/k3s/k3s.yaml ] && [ -z "${KUBECONFIG:-}" ]; then export KUBECONFIG=/etc/rancher/k3s/k3s.yaml; fi',
            `platform_namespace=${this.quoteShellArg(namespace)}`,
            'echo "__KIMIBUILT_PLATFORM_NAMESPACE__=${platform_namespace}"',
            'if kubectl_cmd get namespace "$platform_namespace" >/dev/null 2>&1; then',
            '  echo "__KIMIBUILT_PLATFORM_NAMESPACE_EXISTS__=true"',
            'else',
            '  echo "__KIMIBUILT_PLATFORM_NAMESPACE_EXISTS__=false"',
            '  exit 0',
            'fi',
            'deployment_status() {',
            '  name="$1"',
            '  if kubectl_cmd get deployment "$name" -n "$platform_namespace" >/dev/null 2>&1; then',
            "    desired=$(kubectl_cmd get deployment \"$name\" -n \"$platform_namespace\" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)",
            "    ready=$(kubectl_cmd get deployment \"$name\" -n \"$platform_namespace\" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)",
            "    available=$(kubectl_cmd get deployment \"$name\" -n \"$platform_namespace\" -o jsonpath='{.status.availableReplicas}' 2>/dev/null || true)",
            "    updated=$(kubectl_cmd get deployment \"$name\" -n \"$platform_namespace\" -o jsonpath='{.status.updatedReplicas}' 2>/dev/null || true)",
            '    echo "__KIMIBUILT_DEPLOYMENT__=${name}|present|${desired:-0}|${ready:-0}|${available:-0}|${updated:-0}"',
            '  else',
            '    echo "__KIMIBUILT_DEPLOYMENT__=${name}|missing|0|0|0|0"',
            '  fi',
            '}',
            'deployment_status gitea',
            'deployment_status buildkitd',
            'deployment_status act-runner',
            'if kubectl_cmd get secret gitea-actions -n "$platform_namespace" >/dev/null 2>&1; then',
            '  echo "__KIMIBUILT_SECRET__=gitea-actions|present"',
            "  runner_token_b64=$(kubectl_cmd get secret gitea-actions -n \"$platform_namespace\" -o jsonpath='{.data.runner-registration-token}' 2>/dev/null || true)",
            '  if [ -z "${runner_token_b64:-}" ]; then',
            '    echo "__KIMIBUILT_RUNNER_TOKEN__=missing"',
            '  else',
            '    runner_token=$(printf "%s" "$runner_token_b64" | base64 -d 2>/dev/null || true)',
            '    case "$runner_token" in',
            '      "" ) echo "__KIMIBUILT_RUNNER_TOKEN__=missing" ;;',
            '      "change-me"|"replace-me"|"replace-after-gitea-boot" ) echo "__KIMIBUILT_RUNNER_TOKEN__=placeholder" ;;',
            '      * ) echo "__KIMIBUILT_RUNNER_TOKEN__=present" ;;',
            '    esac',
            '  fi',
            'else',
            '  echo "__KIMIBUILT_SECRET__=gitea-actions|missing"',
            '  echo "__KIMIBUILT_RUNNER_TOKEN__=missing-secret"',
            'fi',
            "runner_env=$(kubectl_cmd get deployment act-runner -n \"$platform_namespace\" -o jsonpath='{range .spec.template.spec.containers[*].env[*]}{.name}={.value}{\"\\n\"}{end}' 2>/dev/null || true)",
            'if [ -n "${runner_env:-}" ]; then',
            '  runner_labels=$(printf "%s\\n" "$runner_env" | grep "^GITEA_RUNNER_LABELS=" | head -n 1 | cut -d= -f2-)',
            '  gitea_instance_url=$(printf "%s\\n" "$runner_env" | grep "^GITEA_INSTANCE_URL=" | head -n 1 | cut -d= -f2-)',
            '  if [ -n "${runner_labels:-}" ]; then echo "__KIMIBUILT_RUNNER_LABELS__=${runner_labels}"; fi',
            '  if [ -n "${gitea_instance_url:-}" ]; then echo "__KIMIBUILT_GITEA_INSTANCE_URL__=${gitea_instance_url}"; fi',
            'fi',
            "gitea_ingress_host=$(kubectl_cmd get ingress gitea -n \"$platform_namespace\" -o jsonpath='{.spec.rules[0].host}' 2>/dev/null || true)",
            'if [ -n "${gitea_ingress_host:-}" ]; then echo "__KIMIBUILT_GITEA_INGRESS_HOST__=${gitea_ingress_host}"; fi',
            'if kubectl_cmd get deployment act-runner -n "$platform_namespace" >/dev/null 2>&1; then',
            '  kubectl_cmd logs deployment/act-runner -n "$platform_namespace" --tail=40 2>/dev/null | sed \'s/^/__KIMIBUILT_RUNNER_LOG__=/\' || true',
            'fi',
        ].join('\n');
    }

    buildRemotePlatformReconcileCommand({
        platformNamespace = '',
        desiredRunnerReplicas = 1,
        runnerRegistrationToken = '',
        runnerLabels = '',
        giteaInstanceUrl = '',
    } = {}) {
        const namespace = sanitizeKubernetesName(
            platformNamespace || this.managedAppsConfig.platformNamespace || 'agent-platform',
            'agent-platform',
        );
        const actRunnerDesiredReplicas = Math.max(0, parseInteger(desiredRunnerReplicas, 1));
        const secretManifest = normalizeText(runnerRegistrationToken)
            ? this.buildOpaqueSecretManifest({
                namespace,
                name: 'gitea-actions',
                labels: {
                    'kimibuilt.io/managed-app-platform': 'true',
                },
                stringData: {
                    'runner-registration-token': normalizeText(runnerRegistrationToken),
                },
            })
            : null;

        return [
            'set -e',
            'kubectl_cmd() {',
            '  if command -v kubectl >/dev/null 2>&1; then kubectl "$@"; return; fi',
            '  if command -v k3s >/dev/null 2>&1; then k3s kubectl "$@"; return; fi',
            '  echo "kubectl or k3s is required on the remote host" >&2',
            '  exit 1',
            '}',
            'if [ -f /etc/rancher/k3s/k3s.yaml ] && [ -z "${KUBECONFIG:-}" ]; then export KUBECONFIG=/etc/rancher/k3s/k3s.yaml; fi',
            `platform_namespace=${this.quoteShellArg(namespace)}`,
            `desired_runner_replicas=${this.quoteShellArg(String(actRunnerDesiredReplicas))}`,
            `desired_runner_labels=${this.quoteShellArg(normalizeText(runnerLabels))}`,
            `desired_gitea_instance_url=${this.quoteShellArg(normalizeText(giteaInstanceUrl))}`,
            'echo "__KIMIBUILT_PLATFORM_NAMESPACE__=${platform_namespace}"',
            'if ! kubectl_cmd get namespace "$platform_namespace" >/dev/null 2>&1; then',
            '  echo "__KIMIBUILT_RECONCILE_ACTION__=platform-namespace-missing"',
            '  exit 1',
            'fi',
            'scale_min_if_needed() {',
            '  name="$1"',
            '  minimum="$2"',
            '  if kubectl_cmd get deployment "$name" -n "$platform_namespace" >/dev/null 2>&1; then',
            "    current=$(kubectl_cmd get deployment \"$name\" -n \"$platform_namespace\" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)",
            '    if [ -z "${current:-}" ]; then current=0; fi',
            '    if [ "$current" -lt "$minimum" ]; then',
            '      kubectl_cmd scale deployment "$name" -n "$platform_namespace" --replicas="$minimum" >/dev/null',
            '      echo "__KIMIBUILT_RECONCILE_ACTION__=${name}-scaled-${minimum}"',
            '    fi',
            '  fi',
            '}',
            'scale_min_if_needed gitea 1',
            'scale_min_if_needed buildkitd 1',
            secretManifest
                ? [
                    'cat <<\'EOF\' | kubectl_cmd apply -f -',
                    JSON.stringify(secretManifest, null, 2),
                    'EOF',
                    'echo "__KIMIBUILT_RECONCILE_ACTION__=gitea-actions-secret-applied"',
                ].join('\n')
                : '',
            'if kubectl_cmd get deployment act-runner -n "$platform_namespace" >/dev/null 2>&1; then',
            '  if [ -n "${desired_runner_labels:-}" ]; then',
            '    kubectl_cmd set env deployment/act-runner -n "$platform_namespace" GITEA_RUNNER_LABELS="${desired_runner_labels}" >/dev/null',
            '    echo "__KIMIBUILT_RECONCILE_ACTION__=act-runner-labels-set"',
            '  fi',
            '  if [ -n "${desired_gitea_instance_url:-}" ]; then',
            '    kubectl_cmd set env deployment/act-runner -n "$platform_namespace" GITEA_INSTANCE_URL="${desired_gitea_instance_url}" >/dev/null',
            '    echo "__KIMIBUILT_RECONCILE_ACTION__=act-runner-instance-url-set"',
            '  fi',
            '  kubectl_cmd scale deployment act-runner -n "$platform_namespace" --replicas="${desired_runner_replicas}" >/dev/null',
            '  echo "__KIMIBUILT_RECONCILE_ACTION__=act-runner-scaled-${desired_runner_replicas}"',
            '  kubectl_cmd rollout restart deployment/act-runner -n "$platform_namespace" >/dev/null',
            '  echo "__KIMIBUILT_RECONCILE_ACTION__=act-runner-restarted"',
            '  kubectl_cmd rollout status deployment/act-runner -n "$platform_namespace" --timeout=180s',
            'else',
            '  echo "__KIMIBUILT_RECONCILE_ACTION__=act-runner-missing"',
            'fi',
        ].filter(Boolean).join('\n');
    }

    async inspectManagedAppPlatform({
        platformNamespace = '',
        deploymentTarget = '',
    } = {}) {
        if (!this.isSshConfigured()) {
            throw new Error('Managed app platform inspection requires SSH access to the remote deploy host.');
        }

        const target = this.resolveDeployTarget(deploymentTarget);
        const command = this.buildRemotePlatformDoctorCommand({ platformNamespace });
        const result = await this.sshTool.handler({
            command,
            timeout: 120000,
        }, {}, createNoopTracker());
        const stdout = String(result.stdout || '');
        const deployments = {};

        readMarkerValues(stdout, '__KIMIBUILT_DEPLOYMENT__').forEach((entry) => {
            const [name, status, desired, ready, available, updated] = String(entry || '').split('|');
            if (!name) {
                return;
            }

            deployments[name] = {
                name,
                present: status === 'present',
                desiredReplicas: parseInteger(desired, 0),
                readyReplicas: parseInteger(ready, 0),
                availableReplicas: parseInteger(available, 0),
                updatedReplicas: parseInteger(updated, 0),
            };
        });

        Object.values(deployments).forEach((deployment) => {
            deployment.ready = deployment.present && deployment.readyReplicas >= Math.max(1, deployment.desiredReplicas || 0);
        });

        const namespace = readMarkerValue(stdout, '__KIMIBUILT_PLATFORM_NAMESPACE__')
            || sanitizeKubernetesName(platformNamespace || this.managedAppsConfig.platformNamespace || 'agent-platform', 'agent-platform');
        const namespaceExists = /^true$/i.test(readMarkerValue(stdout, '__KIMIBUILT_PLATFORM_NAMESPACE_EXISTS__'));
        const secretStateLine = readMarkerValue(stdout, '__KIMIBUILT_SECRET__');
        const [secretName, secretStatus] = secretStateLine.split('|');
        const runnerLogs = readMarkerValues(stdout, '__KIMIBUILT_RUNNER_LOG__');

        return {
            deploymentTarget: target || 'ssh',
            platformNamespace: namespace,
            namespaceExists,
            executionHost: result.host,
            deployments,
            secrets: {
                [secretName || 'gitea-actions']: {
                    name: secretName || 'gitea-actions',
                    present: secretStatus === 'present',
                },
            },
            runnerTokenState: readMarkerValue(stdout, '__KIMIBUILT_RUNNER_TOKEN__') || 'unknown',
            runnerLabels: readMarkerValue(stdout, '__KIMIBUILT_RUNNER_LABELS__'),
            giteaInstanceUrl: readMarkerValue(stdout, '__KIMIBUILT_GITEA_INSTANCE_URL__'),
            giteaIngressHost: readMarkerValue(stdout, '__KIMIBUILT_GITEA_INGRESS_HOST__'),
            runnerLogExcerpt: runnerLogs.slice(-20),
            raw: {
                stdout,
                stderr: String(result.stderr || ''),
                exitCode: Number(result.exitCode || 0),
            },
        };
    }

    async reconcileManagedAppPlatform({
        platformNamespace = '',
        deploymentTarget = '',
        desiredRunnerReplicas = 1,
        runnerRegistrationToken = '',
        runnerLabels = '',
        giteaInstanceUrl = '',
    } = {}) {
        if (!this.isSshConfigured()) {
            throw new Error('Managed app platform reconciliation requires SSH access to the remote deploy host.');
        }

        const target = this.resolveDeployTarget(deploymentTarget);
        const command = this.buildRemotePlatformReconcileCommand({
            platformNamespace,
            desiredRunnerReplicas,
            runnerRegistrationToken,
            runnerLabels,
            giteaInstanceUrl,
        });
        const result = await this.sshTool.handler({
            command,
            timeout: 180000,
        }, {}, createNoopTracker());

        return {
            deploymentTarget: target || 'ssh',
            platformNamespace: readMarkerValue(result.stdout || '', '__KIMIBUILT_PLATFORM_NAMESPACE__')
                || sanitizeKubernetesName(platformNamespace || this.managedAppsConfig.platformNamespace || 'agent-platform', 'agent-platform'),
            executionHost: result.host,
            actions: readMarkerValues(result.stdout || '', '__KIMIBUILT_RECONCILE_ACTION__'),
            raw: {
                stdout: String(result.stdout || ''),
                stderr: String(result.stderr || ''),
                exitCode: Number(result.exitCode || 0),
            },
        };
    }

    buildRemoteManifestApplyCommand(manifests = [], { namespace = '', deploymentName = '', tlsSecretName = '', timeoutSeconds = 120 } = {}) {
        const applyBlocks = manifests
            .filter(Boolean)
            .map((manifest) => [
                'cat <<\'EOF\' | kubectl_cmd apply -f -',
                JSON.stringify(manifest, null, 2),
                'EOF',
            ].join('\n'))
            .join('\n');

        return [
            'set -e',
            'kubectl_cmd() {',
            '  if command -v kubectl >/dev/null 2>&1; then kubectl "$@"; return; fi',
            '  if command -v k3s >/dev/null 2>&1; then k3s kubectl "$@"; return; fi',
            '  echo "kubectl or k3s is required on the remote host" >&2',
            '  exit 1',
            '}',
            'if [ -f /etc/rancher/k3s/k3s.yaml ] && [ -z "${KUBECONFIG:-}" ]; then export KUBECONFIG=/etc/rancher/k3s/k3s.yaml; fi',
            applyBlocks,
            `kubectl_cmd rollout status deployment/${this.quoteShellArg(deploymentName)} -n ${this.quoteShellArg(namespace)} --timeout=${Math.max(30, Number(timeoutSeconds) || 120)}s`,
            `if kubectl_cmd get secret ${this.quoteShellArg(tlsSecretName)} -n ${this.quoteShellArg(namespace)} >/dev/null 2>&1; then echo "__KIMIBUILT_TLS_SECRET__=true"; else echo "__KIMIBUILT_TLS_SECRET__=false"; fi`,
        ].filter(Boolean).join('\n');
    }

    async deployManagedAppViaSsh({
        slug = '',
        namespace = '',
        publicHost = '',
        image = '',
        containerPort = 80,
        registryPullSecretName = '',
        registryHost = '',
        registryUsername = '',
        registryPassword = '',
    } = {}) {
        if (!this.isSshConfigured()) {
            throw new Error('Managed app deployment requires SSH access to the remote deploy host.');
        }

        const deployConfig = this.deployConfig();
        const appName = sanitizeKubernetesName(slug, 'managed-app');
        const appNamespace = normalizeManagedAppNamespace(
            namespace || appName,
            appName,
            this.managedAppsConfig.namespacePrefix || 'app-',
        );
        const host = normalizeText(publicHost);
        const appLabels = {
            'app.kubernetes.io/name': appName,
            'app.kubernetes.io/managed-by': 'kimibuilt',
            'kimibuilt.io/managed-app': 'true',
        };
        const tlsSecretName = sanitizeKubernetesName(`${appName}-tls`, `${appName}-tls`);
        const manifests = [
            this.buildNamespaceManifest(appNamespace),
            this.buildRegistryPullSecretManifest({
                namespace: appNamespace,
                name: registryPullSecretName,
                registryHost,
                username: registryUsername,
                password: registryPassword,
            }),
            this.buildDeploymentManifest({
                namespace: appNamespace,
                deploymentName: appName,
                image,
                containerPort,
                registryPullSecretName,
                appLabels,
            }),
            this.buildServiceManifest({
                namespace: appNamespace,
                serviceName: appName,
                containerPort,
                appLabels,
            }),
            this.buildIngressManifest({
                namespace: appNamespace,
                ingressName: appName,
                publicHost: host,
                serviceName: appName,
                ingressClassName: deployConfig.ingressClassName || '',
                tlsClusterIssuer: deployConfig.tlsClusterIssuer || '',
                tlsSecretName,
                appLabels,
            }),
        ];

        const command = this.buildRemoteManifestApplyCommand(manifests, {
            namespace: appNamespace,
            deploymentName: appName,
            tlsSecretName,
            timeoutSeconds: 120,
        });
        const result = await this.sshTool.handler({
            command,
            timeout: 180000,
        }, {}, createNoopTracker());
        const rolloutOk = Number(result.exitCode || 0) === 0;
        const tlsStatus = rolloutOk
            ? await this.waitForRemoteTlsSecret({
                namespace: appNamespace,
                ingressName: appName,
                tlsSecretName,
                timeoutMs: this.managedAppsConfig.tlsReadyTimeoutMs || 300000,
            })
            : {
                ok: false,
                certificateReady: false,
                ingressHost: host,
                ingressAddress: '',
                stdout: '',
                stderr: '',
                exitCode: Number(result.exitCode || 0),
                host: result.host,
            };
        const https = rolloutOk
            ? await this.waitForHttps(host, {
                timeoutMs: this.managedAppsConfig.httpsVerifyTimeoutMs || 300000,
                intervalMs: this.managedAppsConfig.httpsVerifyIntervalMs || 5000,
                requestTimeoutMs: this.managedAppsConfig.httpsRequestTimeoutMs || 15000,
            })
            : {
                ok: false,
                error: 'Rollout failed before HTTPS verification started.',
                attemptsCompleted: false,
            };

        return {
            namespace: appNamespace,
            deployment: appName,
            service: appName,
            ingress: appName,
            tlsSecretName,
            rollout: {
                ok: rolloutOk,
                exitCode: result.exitCode,
                stdout: result.stdout,
                stderr: result.stderr,
                host: result.host,
            },
            verification: {
                rollout: rolloutOk,
                ingress: true,
                tls: tlsStatus.ok === true,
                https: https.ok === true,
            },
            tlsStatus,
            https,
            executionHost: result.host,
        };
    }
}

module.exports = {
    KubernetesClient,
};
