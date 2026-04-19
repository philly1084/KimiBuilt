'use strict';

const fs = require('fs');
const https = require('https');
const { config } = require('../config');
const settingsController = require('../routes/admin/settings.controller');

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

class KubernetesClient {
    constructor(options = {}) {
        this.config = options.config || config.kubernetes;
        this.deployConfig = options.deployConfigProvider || (() => (
            typeof settingsController.getEffectiveDeployConfig === 'function'
                ? settingsController.getEffectiveDeployConfig()
                : {}
        ));
    }

    isConfigured() {
        return this.config.enabled !== false
            && Boolean(this.config.serviceHost)
            && fs.existsSync(this.config.tokenPath);
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
        if (!this.isConfigured()) {
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
    } = {}) {
        const deployConfig = this.deployConfig();
        const appName = sanitizeKubernetesName(slug, 'managed-app');
        const appNamespace = sanitizeKubernetesName(namespace || appName, 'managed-apps');
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
}

module.exports = {
    KubernetesClient,
};
