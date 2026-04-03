'use strict';

jest.mock('./runtime-tool-manager', () => ({
    ensureRuntimeToolManager: jest.fn(),
}));

jest.mock('./runtime-execution', () => ({
    executeConversationRuntime: jest.fn(),
}));

jest.mock('./ai-route-utils', () => {
    const actual = jest.requireActual('./ai-route-utils');
    return {
        ...actual,
        buildInstructionsWithArtifacts: jest.fn(async () => 'continuity instructions'),
        inferRequestedOutputFormat: jest.fn(() => null),
        maybePrepareImagesForArtifactPrompt: jest.fn(async ({ artifactIds = [] } = {}) => ({
            artifactIds,
            artifacts: [],
            toolEvents: [],
            imagePrompt: null,
            resetPreviousResponse: false,
        })),
        maybeGenerateOutputArtifact: jest.fn(async () => []),
        resolveArtifactContextIds: jest.fn(() => []),
    };
});

const { ensureRuntimeToolManager } = require('./runtime-tool-manager');
const { executeConversationRuntime } = require('./runtime-execution');
const {
    inferRequestedOutputFormat,
    maybeGenerateOutputArtifact,
    maybePrepareImagesForArtifactPrompt,
    resolveArtifactContextIds,
} = require('./ai-route-utils');
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

    test('packages deferred workload chat output into an artifact after runtime execution', async () => {
        ensureRuntimeToolManager.mockResolvedValue({
            executeTool: jest.fn(),
            getTool: jest.fn(),
        });
        executeConversationRuntime.mockResolvedValue({
            handledPersistence: true,
            response: {
                id: 'resp-1',
                output: [{
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: 'Penguin headlines\n\n- Emperor penguins...' }],
                }],
                metadata: {
                    toolEvents: [{ toolCall: { function: { name: 'web-search' } } }],
                },
            },
        });
        inferRequestedOutputFormat.mockReturnValue('pdf');
        maybePrepareImagesForArtifactPrompt.mockResolvedValue({
            artifactIds: [],
            artifacts: [],
            toolEvents: [],
            imagePrompt: null,
            resetPreviousResponse: false,
        });
        maybeGenerateOutputArtifact.mockResolvedValue([{
            id: 'artifact-1',
            filename: 'penguins.pdf',
        }]);
        resolveArtifactContextIds.mockReturnValue([]);

        const sessionStore = {
            getOwned: jest.fn(async () => ({
                id: 'session-1',
                previousResponseId: null,
                metadata: {},
            })),
            get: jest.fn(async () => ({
                id: 'session-1',
                previousResponseId: null,
                metadata: {},
            })),
            appendMessages: jest.fn(async () => null),
            update: jest.fn(async () => null),
            recordResponse: jest.fn(async () => null),
        };
        const memoryService = {
            rememberResponse: jest.fn(),
        };
        const service = new ConversationRunService({
            app: { locals: {} },
            sessionStore,
            memoryService,
        });

        const result = await service.runChatTurn({
            sessionId: 'session-1',
            ownerId: 'user-1',
            session: {
                id: 'session-1',
                previousResponseId: null,
                metadata: {},
            },
            message: 'do web search on penguins and then make a pdf for me',
            metadata: {
                taskType: 'chat',
                workloadRun: true,
            },
        });

        expect(executeConversationRuntime).toHaveBeenCalled();
        expect(maybeGenerateOutputArtifact).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session-1',
            outputFormat: 'pdf',
            content: 'Penguin headlines\n\n- Emperor penguins...',
            prompt: '',
            responseId: 'resp-1',
        }));
        expect(sessionStore.update).toHaveBeenCalledWith('session-1', expect.objectContaining({
            metadata: expect.objectContaining({
                lastOutputFormat: 'pdf',
                lastGeneratedArtifactId: 'artifact-1',
            }),
        }));
        expect(sessionStore.appendMessages).toHaveBeenCalledWith('session-1', [
            {
                role: 'assistant',
                content: 'Created the PDF artifact (penguins.pdf).',
            },
        ]);
        expect(result.artifacts).toEqual([{
            id: 'artifact-1',
            filename: 'penguins.pdf',
        }]);
        expect(result.artifactMessage).toBe('Created the PDF artifact (penguins.pdf).');
    });
});
