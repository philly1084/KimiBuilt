'use strict';

const { KubernetesClient } = require('./kubernetes-client');

describe('KubernetesClient', () => {
    test('deployManagedApp uses SSH when the deployment target is ssh', async () => {
        const sshTool = {
            handler: jest.fn(async () => ({
                stdout: '__KIMIBUILT_TLS_SECRET__=true\n',
                stderr: '',
                exitCode: 0,
                host: 'deploy.example:22',
            })),
        };
        const client = new KubernetesClient({
            managedAppsConfig: {
                deployTarget: 'ssh',
                httpsVerifyTimeoutMs: 5000,
            },
            sshTool,
            deployConfigProvider: () => ({
                ingressClassName: 'traefik',
                tlsClusterIssuer: 'letsencrypt-prod',
            }),
        });

        client.verifyHttps = jest.fn(async () => ({
            ok: true,
            status: 200,
        }));
        client.isSshConfigured = jest.fn(() => true);

        const result = await client.deployManagedApp({
            slug: 'demo',
            namespace: 'app-demo',
            publicHost: 'demo.demoserver2.buzz',
            image: 'gitea.demoserver2.buzz/agent-apps/demo:sha-abcdef123456',
            containerPort: 80,
            registryPullSecretName: 'gitea-registry-credentials',
            registryHost: 'gitea.demoserver2.buzz',
            registryUsername: 'builder',
            registryPassword: 'secret',
            deploymentTarget: 'ssh',
        });

        expect(sshTool.handler).toHaveBeenCalledWith(expect.objectContaining({
            command: expect.stringContaining('kubectl_cmd apply -f -'),
            timeout: 180000,
        }), {}, expect.any(Object));
        expect(result.rollout.ok).toBe(true);
        expect(result.verification.tls).toBe(true);
        expect(result.verification.https).toBe(true);
        expect(result.executionHost).toBe('deploy.example:22');
    });

    test('deployManagedApp normalizes legacy namespaces to the managed app namespace prefix', async () => {
        const sshTool = {
            handler: jest.fn(async () => ({
                stdout: '__KIMIBUILT_TLS_SECRET__=true\n',
                stderr: '',
                exitCode: 0,
                host: 'deploy.example:22',
            })),
        };
        const client = new KubernetesClient({
            managedAppsConfig: {
                deployTarget: 'ssh',
                namespacePrefix: 'app-',
                httpsVerifyTimeoutMs: 5000,
            },
            sshTool,
            deployConfigProvider: () => ({
                ingressClassName: 'traefik',
                tlsClusterIssuer: 'letsencrypt-prod',
            }),
        });

        client.verifyHttps = jest.fn(async () => ({
            ok: true,
            status: 200,
        }));
        client.isSshConfigured = jest.fn(() => true);

        const result = await client.deployManagedApp({
            slug: 'demo',
            namespace: 'managed-app',
            publicHost: 'demo.demoserver2.buzz',
            image: 'gitea.demoserver2.buzz/agent-apps/demo:sha-abcdef123456',
            containerPort: 80,
            registryPullSecretName: 'gitea-registry-credentials',
            registryHost: 'gitea.demoserver2.buzz',
            registryUsername: 'builder',
            registryPassword: 'secret',
            deploymentTarget: 'ssh',
        });

        expect(sshTool.handler).toHaveBeenCalledWith(expect.objectContaining({
            command: expect.stringContaining('"name": "app-demo"'),
        }), {}, expect.any(Object));
        expect(result.namespace).toBe('app-demo');
    });

    test('deployManagedApp ignores legacy in-cluster targets and still uses SSH', async () => {
        const sshTool = {
            handler: jest.fn(async () => ({
                stdout: '__KIMIBUILT_TLS_SECRET__=true\n',
                stderr: '',
                exitCode: 0,
                host: 'deploy.example:22',
            })),
        };
        const client = new KubernetesClient({
            managedAppsConfig: {
                deployTarget: 'in-cluster',
                httpsVerifyTimeoutMs: 5000,
            },
            sshTool,
            deployConfigProvider: () => ({
                ingressClassName: 'traefik',
                tlsClusterIssuer: 'letsencrypt-prod',
            }),
        });

        client.verifyHttps = jest.fn(async () => ({
            ok: true,
            status: 200,
        }));
        client.isSshConfigured = jest.fn(() => true);

        const result = await client.deployManagedApp({
            slug: 'demo',
            namespace: 'app-demo',
            publicHost: 'demo.demoserver2.buzz',
            image: 'gitea.demoserver2.buzz/agent-apps/demo:sha-abcdef123456',
            deploymentTarget: 'in-cluster',
        });

        expect(sshTool.handler).toHaveBeenCalledTimes(1);
        expect(result.rollout.ok).toBe(true);
    });
});
