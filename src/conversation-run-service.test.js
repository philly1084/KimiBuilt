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
            expect.objectContaining({ ownerId: 'user-1', memoryScope: 'chat' }),
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
            content: expect.stringContaining('Penguin headlines'),
            mode: 'chat',
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
            expect.objectContaining({
                role: 'assistant',
                content: 'Created the PDF artifact (penguins.pdf).',
                metadata: expect.objectContaining({
                    artifacts: [
                        expect.objectContaining({
                            id: 'artifact-1',
                            filename: 'penguins.pdf',
                        }),
                    ],
                }),
            }),
        ]);
        expect(result.artifacts).toEqual([
            expect.objectContaining({
                id: 'artifact-1',
                filename: 'penguins.pdf',
                format: 'pdf',
            }),
        ]);
        expect(result.artifactMessage).toBe('Created the PDF artifact (penguins.pdf).');
    });

    test('honors an explicit workload output format even when the prompt does not mention it', async () => {
        ensureRuntimeToolManager.mockResolvedValue({
            executeTool: jest.fn(),
            getTool: jest.fn(),
        });
        executeConversationRuntime.mockResolvedValue({
            handledPersistence: true,
            response: {
                id: 'resp-2',
                output: [{
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: 'Cluster plan\n\n- Review node health\n- Review pods' }],
                }],
                metadata: {
                    toolEvents: [],
                },
            },
        });
        inferRequestedOutputFormat.mockReturnValue(null);
        maybePrepareImagesForArtifactPrompt.mockResolvedValue({
            artifactIds: [],
            artifacts: [],
            toolEvents: [],
            imagePrompt: null,
            resetPreviousResponse: false,
        });
        maybeGenerateOutputArtifact.mockResolvedValue([{
            id: 'artifact-2',
            filename: 'cluster-plan.pdf',
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
            message: 'Turn the cluster notes into a clean review plan.',
            metadata: {
                taskType: 'chat',
                workloadRun: true,
                outputFormat: 'pdf',
            },
        });

        expect(maybeGenerateOutputArtifact).toHaveBeenCalledWith(expect.objectContaining({
            outputFormat: 'pdf',
            content: expect.stringContaining('Cluster plan'),
        }));
        expect(result.artifactMessage).toBe('Created the PDF artifact (cluster-plan.pdf).');
    });

    test('surfaces tool-generated presentation artifacts for workload deep-research runs', async () => {
        ensureRuntimeToolManager.mockResolvedValue({
            executeTool: jest.fn(),
            getTool: jest.fn(),
        });
        executeConversationRuntime.mockResolvedValue({
            handledPersistence: true,
            response: {
                id: 'resp-deck-1',
                output: [{
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: 'Built the research-backed presentation.' }],
                }],
                metadata: {
                    toolEvents: [{
                        toolCall: {
                            function: {
                                name: 'deep-research-presentation',
                            },
                        },
                        result: {
                            success: true,
                            data: {
                                action: 'research_and_generate_presentation',
                                document: {
                                    id: 'deck-1',
                                    filename: 'pigeon-love-research.pptx',
                                    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                                    downloadUrl: '/api/documents/deck-1/download',
                                    metadata: { format: 'pptx' },
                                },
                            },
                        },
                    }],
                },
            },
        });
        inferRequestedOutputFormat.mockReturnValue(null);

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
            rememberArtifactResult: jest.fn(async () => null),
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
            message: 'Research pigeon courtship and build a deck I can review.',
            metadata: {
                taskType: 'chat',
                clientSurface: 'workload',
                workloadRun: true,
            },
        });

        expect(result.artifacts).toEqual([
            expect.objectContaining({
                id: 'deck-1',
                filename: 'pigeon-love-research.pptx',
                format: 'pptx',
                downloadUrl: '/api/documents/deck-1/download',
            }),
        ]);
        expect(result.artifactMessage).toBe('Created the PPTX artifact (pigeon-love-research.pptx).');
        expect(sessionStore.appendMessages).toHaveBeenCalledWith('session-1', [
            expect.objectContaining({
                role: 'assistant',
                content: 'Created the PPTX artifact (pigeon-love-research.pptx).',
                metadata: expect.objectContaining({
                    artifacts: [
                        expect.objectContaining({
                            id: 'deck-1',
                            downloadUrl: '/api/documents/deck-1/download',
                        }),
                    ],
                }),
            }),
        ]);
    });

    test('formats opencode structured execution results for the transcript', async () => {
        const executeTool = jest.fn(async () => ({
            success: true,
            data: {
                status: 'completed',
                workspacePath: '/srv/apps/kimibuilt',
                agent: 'build',
                summary: 'Fixed the build failure and updated the config.',
                diff: [
                    { path: 'src/opencode/service.js' },
                    { path: 'src/routes/tools.js' },
                ],
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
            app: { locals: { opencodeService: { id: 'svc' } } },
            sessionStore,
            memoryService,
        });

        const result = await service.runStructuredExecution({
            sessionId: 'session-1',
            ownerId: 'user-1',
            execution: {
                tool: 'opencode-run',
                params: {
                    prompt: 'Fix the build failure in this repo.',
                    workspacePath: '/srv/apps/kimibuilt',
                    target: 'remote-default',
                },
            },
            metadata: {
                executionProfile: 'remote-build',
                prompt: 'Fix the build failure in this repo.',
            },
        });

        expect(executeTool).toHaveBeenCalledWith(
            'opencode-run',
            expect.objectContaining({
                prompt: 'Fix the build failure in this repo.',
                workspacePath: '/srv/apps/kimibuilt',
                target: 'remote-default',
            }),
            expect.objectContaining({
                sessionId: 'session-1',
                ownerId: 'user-1',
                opencodeService: { id: 'svc' },
            }),
        );
        expect(result.outputText).toContain('OpenCode completed in /srv/apps/kimibuilt using the build agent.');
        expect(result.outputText).toContain('Fixed the build failure and updated the config.');
        expect(result.outputText).toContain('- src/opencode/service.js');
        expect(sessionStore.appendMessages).toHaveBeenCalledWith('session-1', [
            {
                role: 'assistant',
                content: result.outputText,
            },
        ]);
    });

    test('returns structured execution artifacts when a tool materializes a presentation', async () => {
        const executeTool = jest.fn(async () => ({
            success: true,
            data: {
                action: 'research_and_generate_presentation',
                document: {
                    id: 'deck-structured-1',
                    filename: 'travel-pricing-deck.pptx',
                    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                    downloadUrl: '/api/documents/deck-structured-1/download',
                    metadata: { format: 'pptx' },
                },
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
            rememberArtifactResult: jest.fn(async () => null),
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
                tool: 'deep-research-presentation',
                params: {
                    prompt: 'Research Halifax vacation pricing and build a slide deck.',
                },
            },
            metadata: {
                executionProfile: 'default',
                prompt: 'Research Halifax vacation pricing and build a slide deck.',
            },
        });

        expect(result.artifacts).toEqual([
            expect.objectContaining({
                id: 'deck-structured-1',
                filename: 'travel-pricing-deck.pptx',
                format: 'pptx',
                downloadUrl: '/api/documents/deck-structured-1/download',
            }),
        ]);
        expect(result.artifactMessage).toBe('Created the PPTX artifact (travel-pricing-deck.pptx).');
        expect(sessionStore.appendMessages).toHaveBeenNthCalledWith(2, 'session-1', [
            expect.objectContaining({
                role: 'assistant',
                content: 'Created the PPTX artifact (travel-pricing-deck.pptx).',
                metadata: expect.objectContaining({
                    artifacts: [
                        expect.objectContaining({
                            id: 'deck-structured-1',
                            downloadUrl: '/api/documents/deck-structured-1/download',
                        }),
                    ],
                }),
            }),
        ]);
    });
});
