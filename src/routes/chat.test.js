const express = require('express');
const request = require('supertest');

jest.mock('../middleware/validate', () => ({
    validate: () => (_req, _res, next) => next(),
}));

jest.mock('../session-store', () => ({
    sessionStore: {
        create: jest.fn(),
        resolveOwnedSession: jest.fn(),
        getOwned: jest.fn(),
        get: jest.fn(),
        getRecentMessages: jest.fn(),
        update: jest.fn(),
        recordResponse: jest.fn(),
        appendMessages: jest.fn(),
    },
}));

jest.mock('../memory/memory-service', () => ({
    memoryService: {
        process: jest.fn(),
        rememberResponse: jest.fn(),
        rememberArtifactResult: jest.fn(),
        rememberLearnedSkill: jest.fn(),
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
    maybePrepareImagesForArtifactPrompt: jest.fn(async ({ artifactIds = [] } = {}) => ({
        artifactIds,
        artifacts: [],
        toolEvents: [],
        imagePrompt: null,
    })),
    resolveDeferredWorkloadPreflight: jest.fn(() => ({
        timing: 'now',
        shouldSchedule: false,
        request: '',
        scenario: null,
    })),
    shouldDeferArtifactGenerationToWorkload: jest.fn(() => false),
    shouldSuppressNotesSurfaceArtifact: jest.fn(() => false),
    shouldSuppressImplicitMermaidArtifact: jest.fn(() => false),
    shouldSuppressWebChatImplicitHtmlArtifact: jest.fn(() => false),
    stripInjectedNotesPageEditDirective: jest.fn((text) => text),
    resolveReasoningEffort: jest.fn(() => null),
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
const { memoryService } = require('../memory/memory-service');
const { ensureRuntimeToolManager } = require('../runtime-tool-manager');
const { executeConversationRuntime } = require('../runtime-execution');
const {
    buildInstructionsWithArtifacts,
    generateOutputArtifactFromPrompt,
    maybePrepareImagesForArtifactPrompt,
    maybeGenerateOutputArtifact,
    resolveSshRequestContext,
    resolveDeferredWorkloadPreflight,
    shouldSuppressNotesSurfaceArtifact,
    shouldSuppressImplicitMermaidArtifact,
    stripInjectedNotesPageEditDirective,
    resolveReasoningEffort,
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
        sessionStore.resolveOwnedSession.mockResolvedValue(session);
        sessionStore.getOwned.mockResolvedValue(session);
        sessionStore.get.mockResolvedValue(session);
        sessionStore.getRecentMessages.mockResolvedValue([]);
        sessionStore.update.mockResolvedValue(session);
        buildInstructionsWithArtifacts.mockResolvedValue('continuity instructions');
        maybeGenerateOutputArtifact.mockResolvedValue([]);
        memoryService.process.mockResolvedValue({ contextMessages: [] });
        resolveDeferredWorkloadPreflight.mockReturnValue({
            timing: 'now',
            shouldSchedule: false,
            request: '',
            scenario: null,
        });
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

    test('persists the active chat model onto the session for later workload reuse', async () => {
        ensureRuntimeToolManager.mockResolvedValue({
            getTool: jest.fn(),
        });
        resolveSshRequestContext.mockReturnValue({
            effectivePrompt: 'Schedule a follow-up later.',
        });
        executeConversationRuntime.mockResolvedValue({
            handledPersistence: true,
            response: {
                id: 'resp-model-session-1',
                model: 'gpt-5.3-instant',
                output: [{
                    type: 'message',
                    content: [{ text: 'Scheduled.' }],
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
                message: 'Schedule a follow-up later.',
                model: 'gpt-5.3-instant',
                stream: false,
            });

        expect(response.status).toBe(200);
        expect(sessionStore.update).toHaveBeenCalledWith('session-1', expect.objectContaining({
            metadata: expect.objectContaining({
                model: 'gpt-5.3-instant',
            }),
        }));
    });

    test('suppresses implicit Mermaid artifact fallback for notes-style requests', async () => {
        ensureRuntimeToolManager.mockResolvedValue({
            getTool: jest.fn(),
        });
        resolveSshRequestContext.mockReturnValue({
            effectivePrompt: 'Create a Mermaid diagram for the auth flow inside this page',
        });
        shouldSuppressImplicitMermaidArtifact.mockReturnValue(true);
        executeConversationRuntime.mockResolvedValue({
            handledPersistence: true,
            response: {
                id: 'resp-notes-1',
                model: 'gemini-test',
                output: [{
                    type: 'message',
                    content: [{ text: 'Returned through normal runtime' }],
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
                message: 'Create a Mermaid diagram for the auth flow inside this page',
                stream: false,
                metadata: { taskType: 'notes', clientSurface: 'notes' },
            });

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Returned through normal runtime');
        expect(generateOutputArtifactFromPrompt).not.toHaveBeenCalled();
        expect(executeConversationRuntime).toHaveBeenCalled();
        expect(shouldSuppressImplicitMermaidArtifact).toHaveBeenCalledWith(expect.objectContaining({
            taskType: 'notes',
            text: 'Create a Mermaid diagram for the auth flow inside this page',
            outputFormatProvided: false,
        }));
    });

    test('suppresses direct PDF artifact generation for notes page-edit requests', async () => {
        ensureRuntimeToolManager.mockResolvedValue({
            getTool: jest.fn(),
        });
        resolveSshRequestContext.mockReturnValue({
            effectivePrompt: 'Put this hypercar collection on the page as a polished brochure PDF.',
        });
        require('../ai-route-utils').inferRequestedOutputFormat.mockReturnValue('pdf');
        shouldSuppressNotesSurfaceArtifact.mockReturnValue(true);
        executeConversationRuntime.mockResolvedValue({
            handledPersistence: true,
            response: {
                id: 'resp-notes-pdf-1',
                model: 'gemini-test',
                output: [{
                    type: 'message',
                    content: [{ text: 'Returned through normal runtime' }],
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
                message: 'Put this hypercar collection on the page as a polished brochure PDF.',
                stream: false,
                metadata: { taskType: 'notes', clientSurface: 'notes' },
            });

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Returned through normal runtime');
        expect(generateOutputArtifactFromPrompt).not.toHaveBeenCalled();
        expect(executeConversationRuntime).toHaveBeenCalled();
        expect(shouldSuppressNotesSurfaceArtifact).toHaveBeenCalledWith(expect.objectContaining({
            taskType: 'notes',
            text: 'Put this hypercar collection on the page as a polished brochure PDF.',
            outputFormat: 'pdf',
            outputFormatProvided: false,
        }));
    });

    test('allows direct PDF artifact generation for explicit notes exports', async () => {
        ensureRuntimeToolManager.mockResolvedValue({
            getTool: jest.fn(),
        });
        resolveSshRequestContext.mockReturnValue({
            effectivePrompt: 'Export this page as a PDF file I can download.',
        });
        shouldSuppressNotesSurfaceArtifact.mockReturnValue(false);
        generateOutputArtifactFromPrompt.mockResolvedValue({
            responseId: 'resp-notes-export-1',
            artifact: { id: 'pdf-artifact-1', filename: 'page-export.pdf' },
            artifacts: [{ id: 'pdf-artifact-1', filename: 'page-export.pdf' }],
            assistantMessage: 'Created the PDF artifact (page-export.pdf).',
        });

        const app = express();
        app.use(express.json());
        app.use('/api/chat', chatRouter);

        const response = await request(app)
            .post('/api/chat')
            .send({
                sessionId: 'session-1',
                message: 'Export this page as a PDF file I can download.',
                stream: false,
                outputFormat: 'pdf',
                metadata: { taskType: 'notes', clientSurface: 'notes' },
            });

        expect(response.status).toBe(200);
        expect(generateOutputArtifactFromPrompt).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session-1',
            mode: 'notes',
            outputFormat: 'pdf',
        }));
        expect(executeConversationRuntime).not.toHaveBeenCalled();
        expect(response.body.message).toBe('Created the PDF artifact (page-export.pdf).');
        expect(response.body.artifacts).toEqual([
            expect.objectContaining({ id: 'pdf-artifact-1', filename: 'page-export.pdf' }),
        ]);
    });

    test('creates an HTML artifact on web-chat for explicit html build requests', async () => {
        ensureRuntimeToolManager.mockResolvedValue({
            getTool: jest.fn(),
        });
        resolveSshRequestContext.mockReturnValue({
            effectivePrompt: 'Build me a simple HTML questionnaire page.',
        });
        require('../ai-route-utils').inferRequestedOutputFormat.mockReturnValue('html');
        generateOutputArtifactFromPrompt.mockResolvedValue({
            responseId: 'resp-html-export-1',
            artifact: {
                id: 'html-artifact-1',
                filename: 'questionnaire.html',
                downloadUrl: '/api/artifacts/html-artifact-1/download',
            },
            artifacts: [{
                id: 'html-artifact-1',
                filename: 'questionnaire.html',
                downloadUrl: '/api/artifacts/html-artifact-1/download',
            }],
            assistantMessage: 'Created the HTML artifact (questionnaire.html).',
        });

        const app = express();
        app.use(express.json());
        app.use('/api/chat', chatRouter);

        const response = await request(app)
            .post('/api/chat')
            .send({
                sessionId: 'session-1',
                message: 'Build me a simple HTML questionnaire page.',
                stream: false,
                metadata: { clientSurface: 'web-chat' },
            });

        expect(response.status).toBe(200);
        expect(generateOutputArtifactFromPrompt).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session-1',
            mode: 'web-chat',
            outputFormat: 'html',
        }));
        expect(executeConversationRuntime).not.toHaveBeenCalled();
        expect(response.body.artifacts).toEqual([
            expect.objectContaining({
                id: 'html-artifact-1',
                filename: 'questionnaire.html',
                downloadUrl: '/api/artifacts/html-artifact-1/download',
            }),
        ]);
    });

    test('strips the injected notes page-edit directive before artifact inference on /api/chat', async () => {
        ensureRuntimeToolManager.mockResolvedValue({
            getTool: jest.fn(),
        });
        resolveSshRequestContext.mockReturnValue({
            effectivePrompt: 'Create a page about penguins.\n\nInterpret "page" as the current notes page shown in this editor. This is a direct page edit request, so return notes-actions that apply the content to the current notes page unless the user explicitly says web page, site page, repo file, or server component. Put the result into page blocks. Do not reply with chat prose alone. Do not create standalone HTML, file, export, artifact, or download-link output unless the user explicitly asked for that.',
        });
        stripInjectedNotesPageEditDirective.mockImplementation((text) => (
            String(text).replace(/\n\nInterpret "page" as the current notes page shown in this editor[\s\S]*$/i, '')
        ));
        require('../ai-route-utils').inferRequestedOutputFormat.mockImplementation((text) => (
            /\bweb page\b/i.test(text) || /\bartifact\b/i.test(text) ? 'html' : null
        ));
        shouldSuppressNotesSurfaceArtifact.mockReturnValue(false);
        executeConversationRuntime.mockResolvedValue({
            handledPersistence: true,
            response: {
                id: 'resp-notes-chat-1',
                model: 'gpt-4o',
                output: [{
                    type: 'message',
                    content: [{ text: 'Returned through normal runtime' }],
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
                message: 'Create a page about penguins.\n\nInterpret "page" as the current notes page shown in this editor. This is a direct page edit request, so return notes-actions that apply the content to the current notes page unless the user explicitly says web page, site page, repo file, or server component. Put the result into page blocks. Do not reply with chat prose alone. Do not create standalone HTML, file, export, artifact, or download-link output unless the user explicitly asked for that.',
                stream: false,
                metadata: { taskType: 'notes', clientSurface: 'notes' },
            });

        expect(response.status).toBe(200);
        expect(stripInjectedNotesPageEditDirective).toHaveBeenCalled();
        expect(require('../ai-route-utils').inferRequestedOutputFormat).toHaveBeenCalledWith('Create a page about penguins.');
        expect(generateOutputArtifactFromPrompt).not.toHaveBeenCalled();
        expect(executeConversationRuntime).toHaveBeenCalled();
    });

    test('pre-generates image artifacts before direct PDF creation for mixed requests', async () => {
        ensureRuntimeToolManager.mockResolvedValue({
            getTool: jest.fn(() => ({ id: 'image-generate' })),
            executeTool: jest.fn(),
        });
        resolveSshRequestContext.mockReturnValue({
            effectivePrompt: 'Make a hypercar image and put it in a PDF brochure.',
        });
        require('../ai-route-utils').inferRequestedOutputFormat.mockReturnValue('pdf');
        maybePrepareImagesForArtifactPrompt.mockResolvedValue({
            artifactIds: ['image-artifact-1'],
            artifacts: [{ id: 'image-artifact-1', filename: 'hypercar-01.png' }],
            toolEvents: [{ toolCall: { function: { name: 'image-generate' } } }],
            imagePrompt: 'Make a hypercar image',
            resetPreviousResponse: true,
        });
        generateOutputArtifactFromPrompt.mockResolvedValue({
            responseId: 'resp-pdf-1',
            artifact: { id: 'pdf-artifact-1', filename: 'hypercars.pdf' },
            artifacts: [{ id: 'pdf-artifact-1', filename: 'hypercars.pdf' }],
            assistantMessage: 'Created the PDF artifact (hypercars.pdf).',
        });

        const app = express();
        app.use(express.json());
        app.use('/api/chat', chatRouter);

        const response = await request(app)
            .post('/api/chat')
            .send({
                sessionId: 'session-1',
                message: 'Make a hypercar image and put it in a PDF brochure.',
                stream: false,
            });

        expect(response.status).toBe(200);
        expect(maybePrepareImagesForArtifactPrompt).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session-1',
            text: 'Make a hypercar image and put it in a PDF brochure.',
            outputFormat: 'pdf',
            artifactIds: [],
        }));
        expect(generateOutputArtifactFromPrompt).toHaveBeenCalledWith(expect.objectContaining({
            artifactIds: ['image-artifact-1'],
            outputFormat: 'pdf',
            session: expect.objectContaining({
                previousResponseId: null,
            }),
        }));
        expect(response.body.artifacts).toEqual([
            { id: 'image-artifact-1', filename: 'hypercar-01.png' },
            { id: 'pdf-artifact-1', filename: 'hypercars.pdf' },
        ]);
        expect(response.body.toolEvents).toEqual([{ toolCall: { function: { name: 'image-generate' } } }]);
    });

    test('routes scheduled PDF requests through the runtime instead of generating the artifact immediately', async () => {
        ensureRuntimeToolManager.mockResolvedValue({
            getTool: jest.fn(),
        });
        resolveSshRequestContext.mockReturnValue({
            effectivePrompt: 'can you do web search on penguins and then make a pdf for me but schedule it for 5 minutes from now',
        });
        require('../ai-route-utils').inferRequestedOutputFormat.mockReturnValue('pdf');
        resolveDeferredWorkloadPreflight.mockReturnValue({
            timing: 'future',
            shouldSchedule: true,
            request: 'can you do web search on penguins and then make a pdf for me but schedule it for 5 minutes from now',
            scenario: {
                trigger: {
                    type: 'once',
                    runAt: '2026-04-03T14:52:00.000Z',
                },
            },
        });
        executeConversationRuntime.mockResolvedValue({
            handledPersistence: true,
            response: {
                id: 'resp-scheduled-pdf-1',
                model: 'gpt-test',
                output: [{
                    type: 'message',
                    content: [{ text: 'Penguin PDF scheduled.' }],
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
                message: 'can you do web search on penguins and then make a pdf for me but schedule it for 5 minutes from now',
                stream: false,
            });

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Penguin PDF scheduled.');
        expect(generateOutputArtifactFromPrompt).not.toHaveBeenCalled();
        expect(maybeGenerateOutputArtifact).not.toHaveBeenCalled();
        expect(executeConversationRuntime).toHaveBeenCalled();
        expect(resolveDeferredWorkloadPreflight).toHaveBeenCalledWith(expect.objectContaining({
            text: 'can you do web search on penguins and then make a pdf for me but schedule it for 5 minutes from now',
        }));
    });

    test('routes time-first scheduled PDF requests through the runtime instead of generating the artifact immediately', async () => {
        ensureRuntimeToolManager.mockResolvedValue({
            getTool: jest.fn(),
        });
        resolveSshRequestContext.mockReturnValue({
            effectivePrompt: 'in 5 minutes can you do some research on adhd and make a pdf document on it I can review, make it designed to questions on diagnosis and why its adhd traits.',
        });
        require('../ai-route-utils').inferRequestedOutputFormat.mockReturnValue('pdf');
        resolveDeferredWorkloadPreflight.mockReturnValue({
            timing: 'future',
            shouldSchedule: true,
            request: 'in 5 minutes can you do some research on adhd and make a pdf document on it I can review, make it designed to questions on diagnosis and why its adhd traits.',
            scenario: {
                trigger: {
                    type: 'once',
                    runAt: '2026-04-03T14:52:00.000Z',
                },
            },
        });
        executeConversationRuntime.mockResolvedValue({
            handledPersistence: true,
            response: {
                id: 'resp-scheduled-adhd-pdf-1',
                model: 'gpt-test',
                output: [{
                    type: 'message',
                    content: [{ text: 'ADHD PDF scheduled.' }],
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
                message: 'in 5 minutes can you do some research on adhd and make a pdf document on it I can review, make it designed to questions on diagnosis and why its adhd traits.',
                stream: false,
            });

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('ADHD PDF scheduled.');
        expect(generateOutputArtifactFromPrompt).not.toHaveBeenCalled();
        expect(maybeGenerateOutputArtifact).not.toHaveBeenCalled();
        expect(executeConversationRuntime).toHaveBeenCalled();
        expect(resolveDeferredWorkloadPreflight).toHaveBeenCalledWith(expect.objectContaining({
            text: 'in 5 minutes can you do some research on adhd and make a pdf document on it I can review, make it designed to questions on diagnosis and why its adhd traits.',
        }));
    });

    test('forwards normalized reasoning effort into runtime execution', async () => {
        ensureRuntimeToolManager.mockResolvedValue({
            getTool: jest.fn(),
        });
        resolveSshRequestContext.mockReturnValue({
            effectivePrompt: 'Answer directly with more reasoning.',
        });
        resolveReasoningEffort.mockReturnValue('high');
        executeConversationRuntime.mockResolvedValue({
            handledPersistence: true,
            response: {
                id: 'resp-reasoning-1',
                model: 'gpt-test',
                output: [{
                    type: 'message',
                    content: [{ text: 'Reasoned answer' }],
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
                message: 'Answer directly with more reasoning.',
                stream: false,
                reasoning_effort: 'high',
            });

        expect(response.status).toBe(200);
        expect(resolveReasoningEffort).toHaveBeenCalledWith(expect.objectContaining({
            reasoning_effort: 'high',
        }));
        expect(executeConversationRuntime).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                reasoningEffort: 'high',
            }),
        );
    });

    test('streams the completed response text when the runtime emits no deltas', async () => {
        ensureRuntimeToolManager.mockResolvedValue({
            getTool: jest.fn(),
        });
        resolveSshRequestContext.mockReturnValue({
            effectivePrompt: 'Say hello.',
        });
        executeConversationRuntime.mockResolvedValue({
            handledPersistence: false,
            response: (async function* streamWithoutDeltas() {
                yield {
                    type: 'response.completed',
                    response: {
                        id: 'resp-final-only',
                        model: 'gpt-test',
                        output: [{
                            type: 'message',
                            role: 'assistant',
                            content: [{ type: 'text', text: 'Recovered final answer' }],
                        }],
                        metadata: {
                            toolEvents: [],
                        },
                    },
                };
            }()),
        });

        const app = express();
        app.use(express.json());
        app.use('/api/chat', chatRouter);

        const response = await request(app)
            .post('/api/chat')
            .send({
                sessionId: 'session-1',
                message: 'Say hello.',
                stream: true,
            });

        expect(response.status).toBe(200);
        expect(response.text).toContain('"type":"delta","content":"Recovered final answer"');
        expect(response.text).toContain('data: [DONE]');
        expect(sessionStore.appendMessages).toHaveBeenCalledWith('session-1', expect.arrayContaining([
            expect.objectContaining({ role: 'assistant', content: 'Recovered final answer' }),
        ]));
    });

    test('surfaces tool-generated documents as chat artifacts when no fallback artifact is created', async () => {
        ensureRuntimeToolManager.mockResolvedValue({
            getTool: jest.fn(),
        });
        resolveSshRequestContext.mockReturnValue({
            effectivePrompt: 'Build the mission control dashboard again.',
        });
        executeConversationRuntime.mockResolvedValue({
            handledPersistence: true,
            response: {
                id: 'resp-dashboard-1',
                model: 'gpt-test',
                output: [{
                    type: 'message',
                    content: [{ text: 'I created the dashboard.' }],
                }],
                metadata: {
                    toolEvents: [{
                        toolCall: {
                            function: {
                                name: 'document-workflow',
                            },
                        },
                        result: {
                            success: true,
                            data: {
                                document: {
                                    id: 'doc-1',
                                    filename: 'mission-control.html',
                                    mimeType: 'text/html',
                                    downloadUrl: '/api/documents/doc-1/download',
                                    contentPreview: '<html><body>Mission control</body></html>',
                                    metadata: { format: 'html' },
                                },
                            },
                        },
                    }],
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
                message: 'Build the mission control dashboard again.',
                stream: false,
            });

        expect(response.status).toBe(200);
        expect(maybeGenerateOutputArtifact).toHaveBeenCalled();
        expect(response.body.artifacts).toEqual([
            expect.objectContaining({
                id: 'doc-1',
                filename: 'mission-control.html',
                format: 'html',
                mimeType: 'text/html',
                downloadUrl: '/api/documents/doc-1/download',
            }),
        ]);
    });
});
