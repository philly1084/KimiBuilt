const express = require('express');
const request = require('supertest');

jest.mock('../middleware/validate', () => ({
    validate: () => (_req, _res, next) => next(),
}));

jest.mock('../session-store', () => ({
    sessionStore: {
        getOrCreate: jest.fn(),
        get: jest.fn(),
        update: jest.fn(),
        recordResponse: jest.fn(),
        appendMessages: jest.fn(),
    },
}));

jest.mock('../memory/memory-service', () => ({
    memoryService: {
        rememberResponse: jest.fn(),
    },
}));

jest.mock('../runtime-tool-manager', () => ({
    ensureRuntimeToolManager: jest.fn(),
}));

jest.mock('../runtime-execution', () => ({
    executeConversationRuntime: jest.fn(),
    resolveConversationExecutorFlag: jest.fn(() => false),
}));

jest.mock('../ai-route-utils', () => ({
    buildInstructionsWithArtifacts: jest.fn(),
    maybeGenerateOutputArtifact: jest.fn(),
    generateOutputArtifactFromPrompt: jest.fn(),
    inferRequestedOutputFormat: jest.fn(() => null),
    resolveSshRequestContext: jest.fn(),
    extractSshSessionMetadataFromToolEvents: jest.fn(() => null),
    inferOutputFormatFromSession: jest.fn(() => null),
    resolveArtifactContextIds: jest.fn(() => []),
}));

jest.mock('../admin/runtime-monitor', () => ({
    startRuntimeTask: jest.fn(() => ({ id: 'task-1' })),
    completeRuntimeTask: jest.fn(),
    failRuntimeTask: jest.fn(),
}));

jest.mock('../project-memory', () => ({
    buildProjectMemoryUpdate: jest.fn(() => ({})),
    mergeProjectMemory: jest.fn((_existing, update) => update || {}),
}));

jest.mock('../runtime-prompts', () => ({
    buildContinuityInstructions: jest.fn(() => 'continuity instructions'),
}));

const { sessionStore } = require('../session-store');
const { ensureRuntimeToolManager } = require('../runtime-tool-manager');
const { executeConversationRuntime } = require('../runtime-execution');
const {
    buildInstructionsWithArtifacts,
    maybeGenerateOutputArtifact,
    resolveSshRequestContext,
} = require('../ai-route-utils');

const chatRouter = require('./chat');

describe('/api/chat route', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        const session = {
            id: 'session-1',
            previousResponseId: null,
            metadata: {},
        };
        sessionStore.getOrCreate.mockResolvedValue(session);
        sessionStore.get.mockResolvedValue(session);
        sessionStore.update.mockResolvedValue(session);
        buildInstructionsWithArtifacts.mockResolvedValue('continuity instructions');
        maybeGenerateOutputArtifact.mockResolvedValue([]);
    });

    test('routes SSH-looking requests through the orchestrator instead of executing a direct tool shortcut', async () => {
        const toolManager = {
            executeTool: jest.fn(),
            getTool: jest.fn(),
        };
        ensureRuntimeToolManager.mockResolvedValue(toolManager);
        resolveSshRequestContext.mockReturnValue({
            explicitIntent: false,
            continuation: true,
            shouldTreatAsSsh: true,
            effectivePrompt: 'SSH into root@test.demoserver2.buzz and check the failing init container logs',
            target: {
                host: 'test.demoserver2.buzz',
                username: 'root',
                port: 22,
            },
            command: 'kubectl logs -n gitea gitea-cc75bfc56-jprw4 -c init-app-ini --previous',
            directParams: {
                host: 'test.demoserver2.buzz',
                username: 'root',
                port: 22,
                command: 'kubectl logs -n gitea gitea-cc75bfc56-jprw4 -c init-app-ini --previous',
            },
        });
        executeConversationRuntime.mockResolvedValue({
            handledPersistence: true,
            response: {
                id: 'resp-1',
                model: 'gpt-test',
                output: [{
                    type: 'message',
                    content: [{ text: 'Handled by orchestrator' }],
                }],
                metadata: {
                    toolEvents: [],
                },
            },
        });

        const app = express();
        app.use(express.json());
        app.use('/api/chat', chatRouter);

        const response = await request(app)
            .post('/api/chat')
            .send({
                sessionId: 'session-1',
                message: 'check the failing init container logs',
                stream: false,
            });

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            sessionId: 'session-1',
            responseId: 'resp-1',
            message: 'Handled by orchestrator',
        });
        expect(executeConversationRuntime).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                input: 'SSH into root@test.demoserver2.buzz and check the failing init container logs',
                sessionId: 'session-1',
                memoryInput: 'check the failing init container logs',
                stream: false,
                toolManager,
            }),
        );
        expect(toolManager.executeTool).not.toHaveBeenCalled();
    });
});
