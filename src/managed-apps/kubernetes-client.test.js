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

        expect(sshTool.handler).toHaveBeenCalledTimes(2);
        expect(sshTool.handler).toHaveBeenNthCalledWith(2, expect.objectContaining({
            command: expect.stringContaining('__KIMIBUILT_TLS_SECRET__'),
        }), {}, expect.any(Object));
        expect(result.rollout.ok).toBe(true);
    });

    test('inspectManagedAppPlatform reads remote Gitea runner health from the SSH target', async () => {
        const sshTool = {
            handler: jest.fn(async () => ({
                stdout: [
                    '__KIMIBUILT_PLATFORM_NAMESPACE__=agent-platform',
                    '__KIMIBUILT_PLATFORM_NAMESPACE_EXISTS__=true',
                    '__KIMIBUILT_DEPLOYMENT__=gitea|present|1|1|1|1',
                    '__KIMIBUILT_DEPLOYMENT__=buildkitd|present|1|1|1|1',
                    '__KIMIBUILT_DEPLOYMENT__=act-runner|present|1|0|0|0',
                    '__KIMIBUILT_SECRET__=gitea-actions|present',
                    '__KIMIBUILT_RUNNER_TOKEN__=placeholder',
                    '__KIMIBUILT_RUNNER_LABELS__=ubuntu-latest:host',
                    '__KIMIBUILT_GITEA_INSTANCE_URL__=https://gitea.demoserver2.buzz',
                    '__KIMIBUILT_GITEA_INGRESS_HOST__=gitea.demoserver2.buzz',
                    '__KIMIBUILT_RUNNER_LOG__=registration token invalid',
                ].join('\n'),
                stderr: '',
                exitCode: 0,
                host: 'deploy.example:22',
            })),
        };
        const client = new KubernetesClient({
            managedAppsConfig: {
                platformNamespace: 'agent-platform',
            },
            sshTool,
        });

        client.isSshConfigured = jest.fn(() => true);

        const result = await client.inspectManagedAppPlatform({
            platformNamespace: 'agent-platform',
            deploymentTarget: 'ssh',
        });

        expect(sshTool.handler).toHaveBeenCalledWith(expect.objectContaining({
            command: expect.stringContaining('deployment_status act-runner'),
            timeout: 120000,
        }), {}, expect.any(Object));
        expect(result.platformNamespace).toBe('agent-platform');
        expect(result.namespaceExists).toBe(true);
        expect(result.deployments.gitea.ready).toBe(true);
        expect(result.deployments['act-runner'].ready).toBe(false);
        expect(result.runnerTokenState).toBe('placeholder');
        expect(result.runnerLabels).toBe('ubuntu-latest:host');
        expect(result.giteaInstanceUrl).toBe('https://gitea.demoserver2.buzz');
        expect(result.runnerLogExcerpt).toContain('registration token invalid');
        expect(result.executionHost).toBe('deploy.example:22');
    });

    test('reconcileManagedAppPlatform updates the runner secret and restarts act-runner over SSH', async () => {
        const sshTool = {
            handler: jest.fn(async () => ({
                stdout: [
                    '__KIMIBUILT_PLATFORM_NAMESPACE__=agent-platform',
                    '__KIMIBUILT_RECONCILE_ACTION__=gitea-actions-secret-applied',
                    '__KIMIBUILT_RECONCILE_ACTION__=act-runner-labels-set',
                    '__KIMIBUILT_RECONCILE_ACTION__=act-runner-instance-url-set',
                    '__KIMIBUILT_RECONCILE_ACTION__=act-runner-scaled-1',
                    '__KIMIBUILT_RECONCILE_ACTION__=act-runner-restarted',
                ].join('\n'),
                stderr: '',
                exitCode: 0,
                host: 'deploy.example:22',
            })),
        };
        const client = new KubernetesClient({
            managedAppsConfig: {
                platformNamespace: 'agent-platform',
            },
            sshTool,
        });

        client.isSshConfigured = jest.fn(() => true);

        const result = await client.reconcileManagedAppPlatform({
            platformNamespace: 'agent-platform',
            deploymentTarget: 'ssh',
            desiredRunnerReplicas: 1,
            runnerRegistrationToken: 'runner-token-123',
            runnerLabels: 'ubuntu-latest:host',
            giteaInstanceUrl: 'https://gitea.demoserver2.buzz',
        });

        expect(sshTool.handler).toHaveBeenCalledWith(expect.objectContaining({
            command: expect.stringContaining('"runner-registration-token": "runner-token-123"'),
            timeout: 180000,
        }), {}, expect.any(Object));
        expect(result.actions).toEqual(expect.arrayContaining([
            'gitea-actions-secret-applied',
            'act-runner-scaled-1',
            'act-runner-restarted',
        ]));
        expect(result.executionHost).toBe('deploy.example:22');
    });
});
