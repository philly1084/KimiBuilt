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
        return 'in-cluster';
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

function createNoopTracker() {
    return {
        recordExecution() {},
        recordNetworkCall() {},
    };
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
        return normalizeDeployTarget(value || this.managedAppsConfig.deployTarget) || 'in-cluster';
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
        return this.resolveDeployTarget(deploymentTarget) === 'ssh'
            ? this.isSshConfigured()
            : this.isInClusterConfigured();
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
        if (this.resolveDeployTarget(deploymentTarget) === 'ssh') {
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

        await this.ensureNamespace(appNamespace);
        await this.ensureRegistryPullSecret({
            namespace: appNamespace,
            name: registryPullSecretName,
            registryHost,
            username: registryUsername,
            password: registryPassword,
        });

        await this.upsertNamespacedResource({
            kind: 'Deployment',
            apiPath: `/apis/apps/v1/namespaces/${encodeURIComponent(appNamespace)}/deployments`,
            collectionPath: `/apis/apps/v1/namespaces/${encodeURIComponent(appNamespace)}/deployments`,
            namespace: appNamespace,
            name: appName,
            resource: this.buildDeploymentManifest({
                namespace: appNamespace,
                deploymentName: appName,
                image,
                containerPort,
                registryPullSecretName,
                appLabels,
            }),
        });

        await this.upsertNamespacedResource({
            kind: 'Service',
            apiPath: `/api/v1/namespaces/${encodeURIComponent(appNamespace)}/services`,
            collectionPath: `/api/v1/namespaces/${encodeURIComponent(appNamespace)}/services`,
            namespace: appNamespace,
            name: appName,
            resource: this.buildServiceManifest({
                namespace: appNamespace,
                serviceName: appName,
                containerPort,
                appLabels,
            }),
        });

        await this.upsertNamespacedResource({
            kind: 'Ingress',
            apiPath: `/apis/networking.k8s.io/v1/namespaces/${encodeURIComponent(appNamespace)}/ingresses`,
            collectionPath: `/apis/networking.k8s.io/v1/namespaces/${encodeURIComponent(appNamespace)}/ingresses`,
            namespace: appNamespace,
            name: appName,
            resource: this.buildIngressManifest({
                namespace: appNamespace,
                ingressName: appName,
                publicHost: host,
                serviceName: appName,
                ingressClassName: deployConfig.ingressClassName || '',
                tlsClusterIssuer: deployConfig.tlsClusterIssuer || '',
                tlsSecretName,
                appLabels,
            }),
        });

        const rollout = await this.waitForDeploymentReady(appNamespace, appName, 120000);
        const tls = await this.secretExists(appNamespace, tlsSecretName);
        const https = await this.verifyHttps(host, config.managedApps.httpsVerifyTimeoutMs);

        return {
            namespace: appNamespace,
            deployment: appName,
            service: appName,
            ingress: appName,
            tlsSecretName,
            rollout,
            verification: {
                rollout: rollout.ok === true,
                ingress: true,
                tls,
                https: https.ok === true,
            },
            https,
        };
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

    quoteShellArg(value) {
        return `'${String(value || '').replace(/'/g, `'"'"'`)}'`;
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
        const tls = /__KIMIBUILT_TLS_SECRET__=true/i.test(result.stdout || '');
        const https = await this.verifyHttps(host, this.managedAppsConfig.httpsVerifyTimeoutMs || 15000);

        return {
            namespace: appNamespace,
            deployment: appName,
            service: appName,
            ingress: appName,
            tlsSecretName,
            rollout: {
                ok: Number(result.exitCode || 0) === 0,
                exitCode: result.exitCode,
                stdout: result.stdout,
                stderr: result.stderr,
                host: result.host,
            },
            verification: {
                rollout: Number(result.exitCode || 0) === 0,
                ingress: true,
                tls,
                https: https.ok === true,
            },
            https,
            executionHost: result.host,
        };
    }
}

module.exports = {
    KubernetesClient,
};
