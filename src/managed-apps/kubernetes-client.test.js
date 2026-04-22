'use strict';

const { KubernetesClient } = require('./kubernetes-client');

function createDeploySshTool({
    applyStdout = '',
    inspectionStdout = '',
    applyExitCode = 0,
    inspectionExitCode = 0,
    host = 'deploy.example:22',
} = {}) {
    return {
        handler: jest.fn()
            .mockResolvedValueOnce({
                stdout: applyStdout,
                stderr: '',
                exitCode: applyExitCode,
                host,
            })
            .mockResolvedValueOnce({
                stdout: inspectionStdout,
                stderr: '',
                exitCode: inspectionExitCode,
                host,
            }),
    };
}

function buildInspectionStdout(overrides = {}) {
    const values = {
        expectedHost: 'demo.demoserver2.buzz',
        expectedService: 'demo',
        expectedServicePort: '80',
        expectedContainerPort: '80',
        deploymentPresent: 'true',
        servicePresent: 'true',
        ingressPresent: 'true',
        deploymentContainerPort: '80',
        servicePort: '80',
        serviceTargetPort: '80',
        ingressHost: 'demo.demoserver2.buzz',
        ingressBackendService: 'demo',
        ingressBackendPort: '80',
        ingressClass: 'traefik',
        ingressAddress: '10.0.0.10',
        ingressHostMatches: 'true',
        ingressBackendMatches: 'true',
        serviceTargetMatches: 'true',
        tlsSecret: 'true',
        certificateName: 'demo-cert',
        certificateReady: 'true',
        certificateStatus: 'True',
        certificateMessage: '',
        traefikReady: 'true',
        appProbeAttempted: 'true',
        appProbeOk: 'true',
        appProbeStatus: '200',
        appProbeError: '',
        appProbeBody: '',
        ...overrides,
    };
    const lines = [
        `__KIMIBUILT_EXPECTED_HOST__=${values.expectedHost}`,
        `__KIMIBUILT_EXPECTED_SERVICE__=${values.expectedService}`,
        `__KIMIBUILT_EXPECTED_SERVICE_PORT__=${values.expectedServicePort}`,
        `__KIMIBUILT_EXPECTED_CONTAINER_PORT__=${values.expectedContainerPort}`,
        `__KIMIBUILT_DEPLOYMENT_PRESENT__=${values.deploymentPresent}`,
        `__KIMIBUILT_SERVICE_PRESENT__=${values.servicePresent}`,
        `__KIMIBUILT_INGRESS_PRESENT__=${values.ingressPresent}`,
        `__KIMIBUILT_DEPLOYMENT_CONTAINER_PORT__=${values.deploymentContainerPort}`,
        `__KIMIBUILT_SERVICE_PORT__=${values.servicePort}`,
        `__KIMIBUILT_SERVICE_TARGET_PORT__=${values.serviceTargetPort}`,
        `__KIMIBUILT_INGRESS_HOST__=${values.ingressHost}`,
        `__KIMIBUILT_INGRESS_BACKEND_SERVICE__=${values.ingressBackendService}`,
        `__KIMIBUILT_INGRESS_BACKEND_PORT__=${values.ingressBackendPort}`,
        `__KIMIBUILT_INGRESS_CLASS__=${values.ingressClass}`,
        `__KIMIBUILT_INGRESS_ADDRESS__=${values.ingressAddress}`,
        `__KIMIBUILT_INGRESS_HOST_MATCHES__=${values.ingressHostMatches}`,
        `__KIMIBUILT_INGRESS_BACKEND_MATCHES__=${values.ingressBackendMatches}`,
        `__KIMIBUILT_SERVICE_TARGET_MATCHES__=${values.serviceTargetMatches}`,
        `__KIMIBUILT_TLS_SECRET__=${values.tlsSecret}`,
        `__KIMIBUILT_CERTIFICATE_NAME__=${values.certificateName}`,
        `__KIMIBUILT_CERTIFICATE_READY__=${values.certificateReady}`,
        `__KIMIBUILT_CERTIFICATE_STATUS__=${values.certificateStatus}`,
        `__KIMIBUILT_CERTIFICATE_MESSAGE__=${values.certificateMessage}`,
        `__KIMIBUILT_TRAEFIK_READY__=${values.traefikReady}`,
        `__KIMIBUILT_APP_PROBE_ATTEMPTED__=${values.appProbeAttempted}`,
        `__KIMIBUILT_APP_PROBE_OK__=${values.appProbeOk}`,
        `__KIMIBUILT_APP_PROBE_STATUS__=${values.appProbeStatus}`,
        `__KIMIBUILT_APP_PROBE_ERROR__=${values.appProbeError}`,
        `__KIMIBUILT_APP_PROBE_BODY__=${values.appProbeBody}`,
    ];
    for (const item of Array.isArray(values.challengeSummary) ? values.challengeSummary : []) {
        lines.push(`__KIMIBUILT_CHALLENGE__=${item}`);
    }
    for (const item of Array.isArray(values.ingressEvents) ? values.ingressEvents : []) {
        lines.push(`__KIMIBUILT_INGRESS_EVENT__=${item}`);
    }
    for (const item of Array.isArray(values.traefikLogExcerpt) ? values.traefikLogExcerpt : []) {
        lines.push(`__KIMIBUILT_TRAEFIK_LOG__=${item}`);
    }
    return lines.join('\n');
}

describe('KubernetesClient', () => {
    test('deployManagedApp uses SSH when the deployment target is ssh', async () => {
        const sshTool = createDeploySshTool({
            inspectionStdout: buildInspectionStdout(),
        });
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

        client.waitForHttps = jest.fn(async () => ({
            ok: true,
            status: 200,
            attemptsCompleted: true,
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

        expect(sshTool.handler).toHaveBeenNthCalledWith(1, expect.objectContaining({
            command: expect.stringContaining('kubectl_cmd apply -f -'),
            timeout: 180000,
        }), {}, expect.any(Object));
        expect(sshTool.handler).toHaveBeenNthCalledWith(2, expect.objectContaining({
            command: expect.stringContaining('__KIMIBUILT_EXPECTED_HOST__'),
        }), {}, expect.any(Object));
        expect(result.rollout.ok).toBe(true);
        expect(result.verification.ingress).toBe(true);
        expect(result.verification.tls).toBe(true);
        expect(result.verification.https).toBe(true);
        expect(result.executionHost).toBe('deploy.example:22');
    });

    test('deployManagedApp normalizes legacy namespaces to the managed app namespace prefix', async () => {
        const sshTool = createDeploySshTool({
            inspectionStdout: buildInspectionStdout(),
        });
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

        client.waitForHttps = jest.fn(async () => ({
            ok: true,
            status: 200,
            attemptsCompleted: true,
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

        expect(sshTool.handler).toHaveBeenNthCalledWith(1, expect.objectContaining({
            command: expect.stringContaining('"name": "app-demo"'),
        }), {}, expect.any(Object));
        expect(result.namespace).toBe('app-demo');
    });

    test('deployManagedApp ignores legacy in-cluster targets and still uses SSH', async () => {
        const sshTool = createDeploySshTool({
            inspectionStdout: buildInspectionStdout(),
        });
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

        client.waitForHttps = jest.fn(async () => ({
            ok: true,
            status: 200,
            attemptsCompleted: true,
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
            command: expect.stringContaining('__KIMIBUILT_TRAEFIK_READY__'),
        }), {}, expect.any(Object));
        expect(result.rollout.ok).toBe(true);
    });

    test('deployManagedApp treats public HTTPS 404 as a failed verification with diagnostics', async () => {
        const sshTool = createDeploySshTool({
            inspectionStdout: buildInspectionStdout({
                tlsSecret: 'true',
                certificateReady: 'true',
                appProbeOk: 'true',
                appProbeStatus: '200',
            }),
        });
        const client = new KubernetesClient({
            managedAppsConfig: {
                deployTarget: 'ssh',
            },
            sshTool,
        });

        client.waitForHttps = jest.fn(async () => ({
            ok: false,
            status: 404,
            bodyPreview: 'not found',
            attemptsCompleted: true,
        }));
        client.isSshConfigured = jest.fn(() => true);

        const result = await client.deployManagedApp({
            slug: 'demo',
            namespace: 'app-demo',
            publicHost: 'demo.demoserver2.buzz',
            image: 'gitea.demoserver2.buzz/agent-apps/demo:sha-abcdef123456',
            deploymentTarget: 'ssh',
        });

        expect(result.verification.rollout).toBe(true);
        expect(result.verification.ingress).toBe(true);
        expect(result.verification.tls).toBe(true);
        expect(result.verification.https).toBe(false);
        expect(result.diagnostics.httpsStatus).toBe(404);
        expect(result.diagnostics.appProbe.ok).toBe(true);
        expect(result.diagnostics.ingressHostMatches).toBe(true);
    });

    test('deployManagedApp surfaces missing TLS secret and cert-manager diagnostics', async () => {
        const sshTool = createDeploySshTool({
            inspectionStdout: buildInspectionStdout({
                tlsSecret: 'false',
                certificateReady: 'false',
                certificateStatus: 'False',
                certificateMessage: 'Waiting for DNS-01 challenge propagation',
                challengeSummary: ['demo-tls|pending|Waiting for DNS propagation'],
                ingressEvents: ['Warning PresentError challenge not yet valid'],
            }),
        });
        const client = new KubernetesClient({
            managedAppsConfig: {
                deployTarget: 'ssh',
            },
            sshTool,
        });

        client.waitForHttps = jest.fn(async () => ({
            ok: false,
            error: 'certificate not available',
            attemptsCompleted: true,
        }));
        client.isSshConfigured = jest.fn(() => true);

        const result = await client.deployManagedApp({
            slug: 'demo',
            namespace: 'app-demo',
            publicHost: 'demo.demoserver2.buzz',
            image: 'gitea.demoserver2.buzz/agent-apps/demo:sha-abcdef123456',
            deploymentTarget: 'ssh',
        });

        expect(result.verification.tls).toBe(false);
        expect(result.tlsStatus.certificateReady).toBe(false);
        expect(result.tlsStatus.challengeSummary).toEqual(expect.arrayContaining([
            expect.stringContaining('pending'),
        ]));
        expect(result.tlsStatus.ingressEvents).toEqual(expect.arrayContaining([
            expect.stringContaining('PresentError'),
        ]));
    });

    test('deployManagedApp marks ingress verification false when host or backend mismatches', async () => {
        const sshTool = createDeploySshTool({
            inspectionStdout: buildInspectionStdout({
                ingressHost: 'wrong.demoserver2.buzz',
                ingressBackendService: 'other-service',
                ingressHostMatches: 'false',
                ingressBackendMatches: 'false',
                appProbeOk: 'false',
                appProbeStatus: '404',
            }),
        });
        const client = new KubernetesClient({
            managedAppsConfig: {
                deployTarget: 'ssh',
            },
            sshTool,
        });

        client.waitForHttps = jest.fn(async () => ({
            ok: false,
            status: 404,
            attemptsCompleted: true,
        }));
        client.isSshConfigured = jest.fn(() => true);

        const result = await client.deployManagedApp({
            slug: 'demo',
            namespace: 'app-demo',
            publicHost: 'demo.demoserver2.buzz',
            image: 'gitea.demoserver2.buzz/agent-apps/demo:sha-abcdef123456',
            deploymentTarget: 'ssh',
        });

        expect(result.verification.ingress).toBe(false);
        expect(result.diagnostics.ingressHost).toBe('wrong.demoserver2.buzz');
        expect(result.diagnostics.ingressBackendService).toBe('other-service');
        expect(result.diagnostics.ingressHostMatches).toBe(false);
        expect(result.diagnostics.ingressBackendMatches).toBe(false);
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
