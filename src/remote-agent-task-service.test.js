'use strict';

const { RemoteAgentTaskService, parseRemoteTargetsYaml } = require('./remote-agent-task-service');

describe('RemoteAgentTaskService', () => {
    let providerSessionService;
    let sessionHandler;

    beforeEach(() => {
        sessionHandler = null;
        providerSessionService = {
            getProviderDefinition: jest.fn(() => ({
                providerId: 'gemini-cli',
                command: 'gemini',
                sessionCommand: 'gemini',
            })),
            createSession: jest.fn(async () => ({
                session: {
                    id: 'ps_1',
                    providerId: 'gemini-cli',
                    status: 'running',
                },
                streamUrl: '/admin/provider-sessions/ps_1/stream?token=provider-token',
            })),
            subscribeToSession: jest.fn((_sessionId, _ownerId, handler) => {
                sessionHandler = handler;
                return jest.fn();
            }),
            sendInput: jest.fn(async () => ({ success: true })),
            sendSignal: jest.fn(async () => ({ success: true })),
        };
    });

    test('creates a provider session and sends remote SSH task instructions', async () => {
        const service = new RemoteAgentTaskService({
            providerSessionService,
            remoteCliTargets: [
                {
                    targetId: 'k3s-prod',
                    description: 'K3s production host',
                    host: 'example.com',
                    user: 'deploy',
                    port: 22,
                    allowedCwds: ['/srv/apps'],
                    defaultCwd: '/srv/apps/my-app',
                },
            ],
        });

        const created = await service.createTask({
            providerId: 'gemini-cli',
            targetId: 'k3s-prod',
            task: 'Verify rollout',
        }, 'phill');

        expect(created.task.status).toBe('running');
        expect(created.task.reasoning.data).toEqual(expect.objectContaining({
            providerId: 'gemini-cli',
            targetId: 'k3s-prod',
            cwd: '/srv/apps/my-app',
            sshCommand: 'ssh deploy@example.com',
        }));
        expect(created.streamUrl).toMatch(/^\/admin\/remote-agent-tasks\/ragent_/);
        expect(providerSessionService.createSession).toHaveBeenCalledWith({
            providerId: 'gemini-cli',
            model: null,
        }, 'phill');
        expect(providerSessionService.sendInput).toHaveBeenCalledWith(
            'ps_1',
            'phill',
            expect.stringContaining('REMOTE_AGENT_PLAN'),
        );
        expect(providerSessionService.sendInput.mock.calls[0][2]).toContain('SSH command: ssh deploy@example.com');
        expect(providerSessionService.sendInput.mock.calls[0][2]).toContain('Task:\nVerify rollout');
    });

    test('rejects cwd outside the target allowedCwds', async () => {
        const service = new RemoteAgentTaskService({
            providerSessionService,
            remoteCliTargets: [
                {
                    targetId: 'k3s-prod',
                    host: 'example.com',
                    user: 'deploy',
                    allowedCwds: ['/srv/apps'],
                    defaultCwd: '/srv/apps/my-app',
                },
            ],
        });

        await expect(service.createTask({
            providerId: 'gemini-cli',
            targetId: 'k3s-prod',
            cwd: '/etc',
            task: 'Do work',
        }, 'phill')).rejects.toThrow('cwd must be inside one of the target allowedCwds');
    });

    test('mirrors provider output and exit events into task transcript and status', async () => {
        const service = new RemoteAgentTaskService({
            providerSessionService,
            remoteCliTargets: [
                {
                    targetId: 'k3s-prod',
                    host: 'example.com',
                    user: 'deploy',
                    allowedCwds: ['/srv/apps'],
                    defaultCwd: '/srv/apps/my-app',
                },
            ],
        });

        const created = await service.createTask({
            providerId: 'gemini-cli',
            targetId: 'k3s-prod',
            task: 'Do work',
        }, 'phill');
        sessionHandler({
            type: 'output',
            cursor: 9,
            timestamp: '2026-04-29T00:00:00.000Z',
            data: 'REMOTE_AGENT_RESULT done\n',
        });
        sessionHandler({
            type: 'exit',
            cursor: 10,
            timestamp: '2026-04-29T00:00:01.000Z',
            exitCode: 0,
        });

        const task = service.getPublicTask(created.task.id, 'phill');
        const transcript = service.getTranscript(created.task.id, 'phill');

        expect(task.status).toBe('completed');
        expect(transcript.transcript).toEqual([
            {
                cursor: 9,
                timestamp: '2026-04-29T00:00:00.000Z',
                type: 'output',
                data: 'REMOTE_AGENT_RESULT done\n',
            },
        ]);
    });

    test('parses remoteCliTargets from providers.yaml style config', () => {
        const targets = parseRemoteTargetsYaml(`
providers:
  - providerId: gemini-cli
    sessionCommand: gemini
remoteCliTargets:
  - targetId: k3s-prod
    description: K3s production host
    host: example.com
    user: deploy
    port: 2222
    allowedCwds:
      - /srv/apps
      - /opt/kimibuilt
    defaultCwd: /srv/apps/my-app
  - targetId: staging
    host: staging.example.com
    user: ubuntu
    allowedCwds:
      - /srv/staging
    defaultCwd: /srv/staging/app
`);

        expect(targets).toEqual([
            {
                targetId: 'k3s-prod',
                description: 'K3s production host',
                host: 'example.com',
                user: 'deploy',
                port: 2222,
                allowedCwds: ['/srv/apps', '/opt/kimibuilt'],
                defaultCwd: '/srv/apps/my-app',
            },
            {
                targetId: 'staging',
                description: '',
                host: 'staging.example.com',
                user: 'ubuntu',
                port: 22,
                allowedCwds: ['/srv/staging'],
                defaultCwd: '/srv/staging/app',
            },
        ]);
    });
});
