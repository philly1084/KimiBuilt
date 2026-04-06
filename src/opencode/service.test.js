'use strict';

jest.mock('../openai-client', () => ({
    listModels: jest.fn(async () => []),
}));

const { config } = require('../config');
const settingsController = require('../routes/admin/settings.controller');
const { listModels } = require('../openai-client');
const {
    OpenCodeService,
    buildOpenCodeGatewayModels,
    filterGatewayChatModels,
    resolveDefaultOpenCodeModelId,
} = require('./service');

describe('OpenCode service helpers', () => {
    const originalApiBaseURL = settingsController.settings.api.baseURL;
    const originalGatewayApiKey = config.opencode.gatewayApiKey;

    afterEach(() => {
        settingsController.settings.api.baseURL = originalApiBaseURL;
        config.opencode.gatewayApiKey = originalGatewayApiKey;
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
});
