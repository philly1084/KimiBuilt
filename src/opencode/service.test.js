'use strict';

jest.mock('../openai-client', () => ({
    listModels: jest.fn(async () => []),
}));

jest.mock('./client', () => {
    const state = {
        lastRemoteClient: null,
    };

    class MockOpenCodeLocalClient {}

    class MockOpenCodeRemoteClient {
        constructor({ port, username, password, sshConfig }) {
            this.port = port;
            this.username = username;
            this.password = password;
            this.sshConfig = sshConfig;
            this.waitForHealth = jest.fn(async () => ({ ok: true }));
            this.resolveConnection = jest.fn(async () => ({
                host: sshConfig.host,
                port: sshConfig.port || 22,
                username: sshConfig.username,
                password: sshConfig.password || '',
                privateKeyPath: sshConfig.privateKeyPath || '',
            }));
            this.openGlobalEventStream = jest.fn(async () => undefined);
            this.sshTool = {
                quoteShellArg: jest.fn((value) => `'${String(value).replace(/'/g, `'\"'\"'`)}'`),
                executeSSH: jest.fn(async () => ({
                    stdout: '',
                    stderr: '',
                    exitCode: 0,
                })),
                getConnectionConfig: jest.fn(async ({ host, port, username }) => ({
                    host: host || sshConfig.host,
                    port: port || sshConfig.port || 22,
                    username: username || sshConfig.username,
                    password: sshConfig.password || '',
                    privateKeyPath: sshConfig.privateKeyPath || '',
                })),
            };
            state.lastRemoteClient = this;
        }
    }

    return {
        OpenCodeLocalClient: MockOpenCodeLocalClient,
        OpenCodeRemoteClient: MockOpenCodeRemoteClient,
        extractMessageText: jest.fn(() => ''),
        __mock: state,
    };
});

const { config } = require('../config');
const settingsController = require('../routes/admin/settings.controller');
const { listModels } = require('../openai-client');
const { __mock: opencodeClientMock } = require('./client');
const {
    OpenCodeService,
    buildOpenCodeGatewayModels,
    filterGatewayChatModels,
    resolveDefaultOpenCodeModelId,
} = require('./service');

describe('OpenCode service helpers', () => {
    const originalApiBaseURL = settingsController.settings.api.baseURL;
    const originalGatewayApiKey = config.opencode.gatewayApiKey;
    const originalGetEffectiveSshConfig = settingsController.getEffectiveSshConfig;
    const originalGetEffectiveOpencodeConfig = settingsController.getEffectiveOpencodeConfig;

    afterEach(() => {
        settingsController.settings.api.baseURL = originalApiBaseURL;
        config.opencode.gatewayApiKey = originalGatewayApiKey;
        settingsController.getEffectiveSshConfig = originalGetEffectiveSshConfig;
        settingsController.getEffectiveOpencodeConfig = originalGetEffectiveOpencodeConfig;
        opencodeClientMock.lastRemoteClient = null;
        jest.clearAllMocks();
    });

    test('filters model listings down to chat-capable models', () => {
        const models = filterGatewayChatModels([
            { id: 'gpt-4o' },
            { id: 'gpt-image-1' },
            { id: 'claude-sonnet-4-5' },
            { id: 'text-embedding-3-small' },
        ]);

        expect(models).toEqual([
            { id: 'gpt-4o' },
            { id: 'claude-sonnet-4-5' },
        ]);
    });

    test('builds OpenCode model entries with limits when available', () => {
        const models = buildOpenCodeGatewayModels([
            {
                id: 'gpt-4o',
                context_length: 128000,
                max_output_tokens: 16384,
            },
        ]);

        expect(models).toEqual({
            'gpt-4o': {
                name: 'gpt-4o',
                limit: {
                    context: 128000,
                    output: 16384,
                },
            },
        });
    });

    test('prefers an explicitly requested default model id', () => {
        const modelId = resolveDefaultOpenCodeModelId({
            'gpt-4o': { name: 'gpt-4o' },
            'gpt-4o-mini': { name: 'gpt-4o-mini' },
        }, 'gpt-4o-mini');

        expect(modelId).toBe('gpt-4o-mini');
    });

    test('builds managed config against the KimiBuilt gateway with explicit model options', async () => {
        settingsController.settings.api.baseURL = 'https://kimibuilt.example.com';
        config.opencode.gatewayApiKey = 'gateway-secret';
        listModels.mockResolvedValue([
            {
                id: 'gpt-4o',
                context_length: 128000,
                max_output_tokens: 16384,
            },
            {
                id: 'gpt-image-1',
            },
        ]);

        const service = new OpenCodeService({
            store: {
                isAvailable: () => true,
            },
        });

        const localConfig = await service.buildManagedConfig({
            target: 'local',
            approvalMode: 'manual',
            workspacePath: 'C:/Users/phill/KimiBuilt',
        });
        const remoteConfig = await service.buildManagedConfig({
            target: 'remote-default',
            approvalMode: 'manual',
            workspacePath: '/srv/apps/kimibuilt',
        });

        expect(localConfig.provider.kimibuilt.options).toEqual({
            baseURL: `http://127.0.0.1:${config.port}/v1`,
            apiKey: 'gateway-secret',
        });
        expect(remoteConfig.provider.kimibuilt.options).toEqual({
            baseURL: 'https://kimibuilt.example.com/v1',
            apiKey: 'gateway-secret',
        });
        expect(localConfig.provider.kimibuilt.models).toEqual({
            'gpt-4o': {
                name: 'gpt-4o',
                limit: {
                    context: 128000,
                    output: 16384,
                },
            },
        });
        expect(localConfig.model).toBe('kimibuilt/gpt-4o');
    });

    test('builds admin runtime details with gateway auth and model catalog metadata', async () => {
        settingsController.settings.api.baseURL = 'https://kimibuilt.example.com';
        config.opencode.gatewayApiKey = 'gateway-secret';
        listModels.mockResolvedValue([
            {
                id: 'gpt-4o',
                owned_by: 'openai',
                context_length: 128000,
                max_output_tokens: 16384,
            },
            {
                id: 'gpt-4o-mini',
                owned_by: 'openai',
                context_length: 128000,
                max_output_tokens: 8192,
            },
        ]);

        const service = new OpenCodeService({
            store: {
                isAvailable: () => true,
            },
        });

        const details = await service.getAdminRuntimeDetails();

        expect(details.gateway).toEqual(expect.objectContaining({
            baseURL: 'https://kimibuilt.example.com/v1',
            localBaseURL: `http://127.0.0.1:${config.port}/v1`,
            authEnabled: true,
            authMode: 'explicit',
            remoteReachable: true,
            remoteReachabilityError: null,
        }));
        expect(details.defaults).toEqual({
            agent: 'build',
            model: 'gpt-4o',
            smallModel: 'gpt-4o-mini',
        });
        expect(details.models).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'gpt-4o',
                provider: 'openai',
                contextWindow: 128000,
                outputLimit: 16384,
                isDefault: true,
                isSmallModel: false,
            }),
            expect.objectContaining({
                id: 'gpt-4o-mini',
                isSmallModel: true,
            }),
        ]));
    });

    test('reports local and remote OpenCode readiness separately', () => {
        settingsController.settings.api.baseURL = 'http://127.0.0.1:3000';
        settingsController.getEffectiveSshConfig = jest.fn(() => ({
            enabled: false,
            host: '',
            port: 22,
            username: '',
            password: '',
            privateKeyPath: '',
        }));
        settingsController.getEffectiveOpencodeConfig = jest.fn(() => ({
            enabled: true,
            binaryPath: 'opencode',
            defaultAgent: 'build',
            defaultModel: 'gpt-4o',
            allowedWorkspaceRoots: ['C:/Users/phill/KimiBuilt'],
            remoteDefaultWorkspace: '/srv/apps/kimibuilt',
            providerEnvAllowlist: [],
            remoteAutoInstall: false,
        }));

        const service = new OpenCodeService({
            store: {
                isAvailable: () => true,
            },
        });

        expect(service.getExecutionCapabilities()).toEqual(expect.objectContaining({
            persistenceReady: true,
            localReady: true,
            remoteReady: false,
            localIssues: [],
            remoteIssues: expect.arrayContaining([
                'ssh-unconfigured',
                'remote-gateway-unreachable',
            ]),
        }));
    });

    test('includes the official remote auto-install bootstrap when enabled', async () => {
        settingsController.settings.api.baseURL = 'https://kimibuilt.example.com';
        settingsController.getEffectiveSshConfig = jest.fn(() => ({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        }));
        settingsController.getEffectiveOpencodeConfig = jest.fn(() => ({
            enabled: true,
            binaryPath: 'opencode',
            defaultAgent: 'build',
            defaultModel: 'gpt-4o',
            allowedWorkspaceRoots: ['C:/Users/phill/KimiBuilt'],
            remoteDefaultWorkspace: '/srv/apps/kimibuilt',
            providerEnvAllowlist: [],
            remoteAutoInstall: true,
        }));

        const service = new OpenCodeService({
            store: {
                isAvailable: () => true,
            },
        });
        service.buildManagedConfig = jest.fn(async () => ({
            provider: {},
        }));

        await service.startRemoteInstance('remote-run-1', '/srv/apps/kimibuilt', 'manual');

        const bootstrapScript = opencodeClientMock.lastRemoteClient.sshTool.executeSSH.mock.calls[0][1];
        expect(bootstrapScript).toContain('curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path');
        expect(bootstrapScript).toContain('export PATH="$HOME/.opencode/bin:$PATH"');
        expect(bootstrapScript).toContain('__KIMIBUILT_OPENCODE_INSTALL_NEEDS_CURL__');
        expect(opencodeClientMock.lastRemoteClient.waitForHealth).toHaveBeenCalledTimes(1);
    });

    test('bootstraps the remote OpenCode runtime using the configured workspace', async () => {
        settingsController.settings.api.baseURL = 'https://kimibuilt.example.com';
        settingsController.getEffectiveSshConfig = jest.fn(() => ({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        }));
        settingsController.getEffectiveOpencodeConfig = jest.fn(() => ({
            enabled: true,
            binaryPath: 'opencode',
            defaultAgent: 'build',
            defaultModel: 'gpt-4o',
            allowedWorkspaceRoots: ['C:/Users/phill/KimiBuilt'],
            remoteDefaultWorkspace: '/var/www/test.demoserver2.buzz',
            providerEnvAllowlist: [],
            remoteAutoInstall: true,
        }));

        const service = new OpenCodeService({
            store: {
                isAvailable: () => true,
            },
        });
        service.buildManagedConfig = jest.fn(async () => ({
            provider: {},
        }));

        const result = await service.bootstrapRuntime({
            target: 'remote-default',
        });

        expect(result).toEqual(expect.objectContaining({
            status: 'ready',
            target: 'remote-default',
            workspacePath: '/var/www/test.demoserver2.buzz',
            remoteAutoInstall: true,
            binaryPath: 'opencode',
        }));
        expect(opencodeClientMock.lastRemoteClient.sshTool.executeSSH).toHaveBeenCalledTimes(1);
    });
});
