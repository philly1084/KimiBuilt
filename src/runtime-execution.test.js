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

    test('uses the conversation orchestrator by default when it is available', async () => {
        const executeConversation = jest.fn().mockResolvedValue({
            success: true,
            response: { id: 'resp_executor' },
        });

        const result = await executeConversationRuntime({
            locals: {
                conversationOrchestrator: {
                    executeConversation,
                },
            },
        }, {
            sessionId: 'session-1',
            input: 'Answer directly.',
            memoryInput: 'Answer directly.',
        });

        expect(executeConversation).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session-1',
            input: 'Answer directly.',
            executionProfile: 'default',
        }));
        expect(createResponse).not.toHaveBeenCalled();
        expect(result.handledPersistence).toBe(true);
        expect(result.runtimeMode).toBe('orchestrated');
    });

    test('passes explicit executor flags through to the orchestrator without needing a separate runtime mode', async () => {
        const executeConversation = jest.fn().mockResolvedValue({
            success: true,
            response: { id: 'resp_executor' },
        });

        const result = await executeConversationRuntime({
            locals: {
                conversationOrchestrator: {
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
            taskType: 'chat',
        }));
        expect(createResponse).not.toHaveBeenCalled();
        expect(result.handledPersistence).toBe(true);
        expect(result.runtimeMode).toBe('orchestrated');
    });

    test('routes remote build requests to the executor even without the explicit flag', async () => {
        const executeConversation = jest.fn().mockResolvedValue({
            success: true,
            response: { id: 'resp_executor_remote' },
        });

        const result = await executeConversationRuntime({
            locals: {
                conversationOrchestrator: {
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
        }));
        expect(createResponse).not.toHaveBeenCalled();
        expect(result.runtimeMode).toBe('orchestrated');
    });

    test('falls back to agentOrchestrator only when conversationOrchestrator is unavailable', async () => {
        const executeConversation = jest.fn().mockResolvedValue({
            success: true,
            response: { id: 'resp_agent_fallback' },
        });

        const result = await executeConversationRuntime({
            locals: {
                agentOrchestrator: {
                    executeConversation,
                },
            },
        }, {
            sessionId: 'session-agent-fallback',
            input: 'Fallback to the legacy executor.',
        });

        expect(executeConversation).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session-agent-fallback',
            executionProfile: 'default',
        }));
        expect(createResponse).not.toHaveBeenCalled();
        expect(result.runtimeMode).toBe('orchestrated');
    });

    test('falls back to direct runtime if the executor is requested but unavailable', async () => {
        const result = await executeConversationRuntime({
            locals: {},
        }, {
            sessionId: 'session-3',
            input: 'Fallback cleanly.',
            enableConversationExecutor: true,
            reasoningEffort: 'high',
            memoryInput: 'Fallback cleanly.',
        });

        expect(createResponse).toHaveBeenCalledTimes(1);
        expect(createResponse).toHaveBeenCalledWith(expect.objectContaining({
            reasoningEffort: 'high',
        }));
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
        expect(inferExecutionProfile({ input: 'Run a remote command on root@77.42.44.98 to check its health.' })).toBe('remote-build');
        expect(inferExecutionProfile({
            taskType: 'notes',
            input: 'Can you reach the remote build now?',
        })).toBe('remote-build');
        expect(inferExecutionProfile({ input: 'Answer directly.' })).toBe('default');
    });

    test('uses the latest user turn instead of stale remote transcript content when inferring execution profile', () => {
        expect(inferExecutionProfile({
            input: [
                { role: 'user', content: 'SSH into the remote server and check kubectl.' },
                { role: 'assistant', content: 'I can inspect the cluster over SSH.' },
                { role: 'user', content: 'Create a React component for a todo list.' },
            ],
        })).toBe('default');
    });
});
