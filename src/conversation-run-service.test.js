'use strict';

jest.mock('./runtime-tool-manager', () => ({
    ensureRuntimeToolManager: jest.fn(),
}));

const { ensureRuntimeToolManager } = require('./runtime-tool-manager');
const { ConversationRunService } = require('./conversation-run-service');

describe('ConversationRunService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('persists structured execution output into the session transcript and memory', async () => {
        const executeTool = jest.fn(async () => ({
            success: true,
            data: {
                host: '10.0.0.5',
                stdout: 'Wed Apr  1 09:05:00 UTC 2026',
                stderr: '',
            },
        }));
        ensureRuntimeToolManager.mockResolvedValue({
            executeTool,
        });

        const sessionStore = {
            getOwned: jest.fn(async () => ({
                id: 'session-1',
                metadata: {},
            })),
            get: jest.fn(),
            appendMessages: jest.fn(async () => null),
            update: jest.fn(async () => null),
        };
        const memoryService = {
            rememberResponse: jest.fn(),
        };
        const service = new ConversationRunService({
            app: { locals: {} },
            sessionStore,
            memoryService,
        });

        const result = await service.runStructuredExecution({
            sessionId: 'session-1',
            ownerId: 'user-1',
            execution: {
                tool: 'remote-command',
                params: {
                    host: '10.0.0.5',
                    username: 'ubuntu',
                    port: 22,
                    command: 'date',
                },
            },
            metadata: {
                executionProfile: 'remote-build',
                prompt: 'Run `date` on the server.',
            },
        });

        expect(executeTool).toHaveBeenCalledWith(
            'remote-command',
            expect.objectContaining({
                host: '10.0.0.5',
                username: 'ubuntu',
                port: 22,
                command: 'date',
            }),
            expect.objectContaining({
                sessionId: 'session-1',
                ownerId: 'user-1',
                executionProfile: 'remote-build',
            }),
        );
        expect(result.outputText).toContain('SSH command completed on 10.0.0.5.');
        expect(result.outputText).toContain('Wed Apr  1 09:05:00 UTC 2026');
        expect(sessionStore.appendMessages).toHaveBeenCalledWith('session-1', [
            {
                role: 'assistant',
                content: result.outputText,
            },
        ]);
        expect(memoryService.rememberResponse).toHaveBeenCalledWith(
            'session-1',
            result.outputText,
            { ownerId: 'user-1' },
        );
    });
});
