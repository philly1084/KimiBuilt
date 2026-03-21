jest.mock('./session-store', () => ({
    sessionStore: {
        getRecentMessages: jest.fn(),
    },
}));

jest.mock('./memory/memory-service', () => ({
    memoryService: {
        process: jest.fn(),
    },
}));

jest.mock('./openai-client', () => ({
    createResponse: jest.fn(),
}));

const { sessionStore } = require('./session-store');
const { memoryService } = require('./memory/memory-service');
const { createResponse } = require('./openai-client');
const {
    executeConversationRuntime,
    resolveConversationExecutorFlag,
    inferExecutionProfile,
} = require('./runtime-execution');

describe('runtime-execution', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        sessionStore.getRecentMessages.mockResolvedValue([
            { role: 'assistant', content: 'Earlier reply' },
        ]);
        memoryService.process.mockResolvedValue(['Remembered context']);
        createResponse.mockResolvedValue({ id: 'resp_direct' });
    });

    test('keeps conversation executor disabled by default even when orchestrator exists', async () => {
        const executeConversation = jest.fn().mockResolvedValue({
            success: true,
            response: { id: 'resp_executor' },
        });

        const result = await executeConversationRuntime({
            locals: {
                agentOrchestrator: {
                    executeConversation,
                },
            },
        }, {
            sessionId: 'session-1',
            input: 'Answer directly.',
            memoryInput: 'Answer directly.',
        });

        expect(executeConversation).not.toHaveBeenCalled();
        expect(memoryService.process).toHaveBeenCalledWith('session-1', 'Answer directly.');
        expect(sessionStore.getRecentMessages).toHaveBeenCalledWith('session-1', 12);
        expect(createResponse).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session-1',
            input: 'Answer directly.',
            contextMessages: ['Remembered context'],
            recentMessages: [{ role: 'assistant', content: 'Earlier reply' }],
        }));
        expect(result.handledPersistence).toBe(false);
        expect(result.runtimeMode).toBe('direct');
    });

    test('routes to the multi-step executor only when explicitly requested', async () => {
        const executeConversation = jest.fn().mockResolvedValue({
            success: true,
            response: { id: 'resp_executor' },
        });

        const result = await executeConversationRuntime({
            locals: {
                agentOrchestrator: {
                    executeConversation,
                },
            },
        }, {
            sessionId: 'session-2',
            input: 'Use the executor.',
            enableConversationExecutor: true,
            taskType: 'chat',
        });

        expect(executeConversation).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session-2',
            input: 'Use the executor.',
            enableConversationExecutor: true,
            useAgentExecutor: true,
            taskType: 'chat',
        }));
        expect(createResponse).not.toHaveBeenCalled();
        expect(result.handledPersistence).toBe(true);
        expect(result.runtimeMode).toBe('executor');
    });

    test('routes remote build requests to the executor even without the explicit flag', async () => {
        const executeConversation = jest.fn().mockResolvedValue({
            success: true,
            response: { id: 'resp_executor_remote' },
        });

        const result = await executeConversationRuntime({
            locals: {
                agentOrchestrator: {
                    executeConversation,
                },
            },
        }, {
            sessionId: 'session-remote-1',
            input: 'SSH into the remote server and deploy the latest build.',
            taskType: 'chat',
        });

        expect(executeConversation).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session-remote-1',
            executionProfile: 'remote-build',
            useAgentExecutor: true,
        }));
        expect(createResponse).not.toHaveBeenCalled();
        expect(result.runtimeMode).toBe('executor');
    });

    test('falls back to direct runtime if the executor is requested but unavailable', async () => {
        const result = await executeConversationRuntime({
            locals: {},
        }, {
            sessionId: 'session-3',
            input: 'Fallback cleanly.',
            enableConversationExecutor: true,
            memoryInput: 'Fallback cleanly.',
        });

        expect(createResponse).toHaveBeenCalledTimes(1);
        expect(result.handledPersistence).toBe(false);
        expect(result.runtimeMode).toBe('direct');
    });

    test('accepts legacy and compatibility executor flags', () => {
        expect(resolveConversationExecutorFlag({ useAgentExecutor: true })).toBe(true);
        expect(resolveConversationExecutorFlag({ use_agent_executor: true })).toBe(true);
        expect(resolveConversationExecutorFlag({ enable_conversation_executor: true })).toBe(true);
        expect(resolveConversationExecutorFlag({})).toBe(false);
    });

    test('infers the remote build execution profile from explicit routing or remote-ops prompts', () => {
        expect(inferExecutionProfile({ executionProfile: 'remote-builder' })).toBe('remote-build');
        expect(inferExecutionProfile({ input: 'Use kubectl to inspect the cluster and restart the deployment.' })).toBe('remote-build');
        expect(inferExecutionProfile({ input: 'Answer directly.' })).toBe('default');
    });
});
