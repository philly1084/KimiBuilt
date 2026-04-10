const express = require('express');
const request = require('supertest');

jest.mock('../session-store', () => ({
    sessionStore: {
        resolveOwnedSession: jest.fn(),
        getOwned: jest.fn(),
        get: jest.fn(),
        getRecentMessages: jest.fn(),
        update: jest.fn(),
        recordResponse: jest.fn(),
        appendMessages: jest.fn(),
        updateControlState: jest.fn(),
    },
}));

jest.mock('../memory/memory-service', () => ({
    memoryService: {
        rememberResponse: jest.fn(),
    },
}));

jest.mock('../openai-client', () => ({
    generateImage: jest.fn(),
    listModels: jest.fn(),
}));

jest.mock('../runtime-tool-manager', () => ({
    ensureRuntimeToolManager: jest.fn(async () => ({})),
}));

jest.mock('../runtime-execution', () => ({
    executeConversationRuntime: jest.fn(),
    resolveConversationExecutorFlag: jest.fn(() => false),
    inferExecutionProfile: jest.fn(() => 'default'),
}));

jest.mock('../ai-route-utils', () => ({
    buildInstructionsWithArtifacts: jest.fn(async () => 'continuity instructions'),
    maybeGenerateOutputArtifact: jest.fn(async () => []),
    generateOutputArtifactFromPrompt: jest.fn(),
    inferRequestedOutputFormat: jest.fn(() => null),
    isArtifactContinuationPrompt: jest.fn(() => false),
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
    shouldSuppressNotesSurfaceArtifact: jest.fn(() => false),
    shouldSuppressImplicitMermaidArtifact: jest.fn(() => false),
    shouldSuppressWebChatImplicitHtmlArtifact: jest.fn(() => false),
    stripInjectedNotesPageEditDirective: jest.fn((text) => text),
    resolveSshRequestContext: jest.fn((text) => ({ effectivePrompt: text })),
    extractSshSessionMetadataFromToolEvents: jest.fn(() => null),
    inferOutputFormatFromSession: jest.fn(() => null),
    resolveArtifactContextIds: jest.fn(() => []),
    resolveReasoningEffort: jest.fn(() => null),
}));

jest.mock('../artifacts/artifact-service', () => ({
    artifactService: {
        getGenerationInstructions: jest.fn(() => ''),
    },
    extractResponseText: jest.fn(() => 'Answer'),
    resolveCompletedResponseText: jest.fn((fullText = '', response = {}) => fullText || response.output_text || 'Answer'),
    getMissingCompletionDelta: jest.fn(() => ''),
}));

jest.mock('../admin/runtime-monitor', () => ({
    startRuntimeTask: jest.fn(() => ({ id: 'task-compat-stream-1' })),
    completeRuntimeTask: jest.fn(),
    failRuntimeTask: jest.fn(),
}));

jest.mock('../project-memory', () => ({
    buildProjectMemoryUpdate: jest.fn(() => ({})),
    mergeProjectMemory: jest.fn((_existing, update) => update || {}),
}));

jest.mock('../generated-image-artifacts', () => ({
    persistGeneratedImages: jest.fn(async () => ({ artifacts: [] })),
}));

jest.mock('../runtime-prompts', () => ({
    buildContinuityInstructions: jest.fn(() => 'continuity instructions'),
}));

jest.mock('../runtime-control-state', () => ({
    getSessionControlState: jest.fn(() => ({})),
}));

jest.mock('../web-chat-message-state', () => ({
    buildWebChatSessionMessages: jest.fn(() => []),
    buildFrontendAssistantMetadata: jest.fn((metadata = {}) => metadata),
}));

jest.mock('../session-scope', () => ({
    buildScopedSessionMetadata: jest.fn((metadata = {}) => metadata),
    isSessionIsolationEnabled: jest.fn(() => false),
    resolveSessionScope: jest.fn(() => 'web-chat'),
}));

jest.mock('../user-checkpoints', () => ({
    buildUserCheckpointAnsweredPatch: jest.fn(() => ({})),
    buildUserCheckpointAskedPatch: jest.fn(() => ({})),
    buildUserCheckpointInstructions: jest.fn(() => ''),
    buildUserCheckpointPolicy: jest.fn(() => ({
        enabled: false,
        maxQuestions: 0,
        askedCount: 0,
        remaining: 0,
        pending: null,
    })),
    extractPendingUserCheckpoint: jest.fn(() => null),
    getUserCheckpointState: jest.fn(() => ({ pending: null })),
    parseUserCheckpointResponseMessage: jest.fn(() => null),
}));

const { sessionStore } = require('../session-store');
const { executeConversationRuntime } = require('../runtime-execution');
const openAiCompatRouter = require('./openai-compat');

describe('/v1/chat/completions stream forwarding', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        const session = {
            id: 'web-chat-stream-1',
            previousResponseId: null,
            metadata: {
                taskType: 'chat',
                clientSurface: 'web-chat',
            },
        };

        sessionStore.resolveOwnedSession.mockResolvedValue(session);
        sessionStore.getOwned.mockResolvedValue(session);
        sessionStore.get.mockResolvedValue(session);
        sessionStore.getRecentMessages.mockResolvedValue([]);
        sessionStore.update.mockResolvedValue(session);
    });

    test('forwards reasoning deltas through chat completion chunks alongside tool events', async () => {
        executeConversationRuntime.mockResolvedValue({
            handledPersistence: true,
            response: (async function* streamEvents() {
                yield {
                    type: 'response.reasoning_summary_text.delta',
                    delta: 'Checking the request. ',
                    summary: 'Checking the request. ',
                };
                yield {
                    type: 'response.output_item.added',
                    item: {
                        type: 'function_call',
                        name: 'web_search',
                        call_id: 'call_compat_1',
                    },
                };
                yield {
                    type: 'response.output_text.delta',
                    delta: 'Answer',
                };
                yield {
                    type: 'response.completed',
                    response: {
                        id: 'resp-compat-stream-1',
                        model: 'gpt-4o',
                        output_text: 'Answer',
                        output: [{
                            type: 'message',
                            role: 'assistant',
                            content: [{ type: 'output_text', text: 'Answer' }],
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
        app.use('/v1', openAiCompatRouter);

        const response = await request(app)
            .post('/v1/chat/completions')
            .send({
                messages: [
                    { role: 'user', content: 'Check this request.' },
                ],
                taskType: 'chat',
                clientSurface: 'web-chat',
                stream: true,
                session_id: 'web-chat-stream-1',
            });

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain('text/event-stream');
        expect(response.headers['cache-control']).toContain('no-transform');
        expect(response.headers['x-accel-buffering']).toBe('no');
        expect(response.text.startsWith(': stream-open\n\n')).toBe(true);
        expect(response.text).toContain('"delta":{"reasoning":"Checking the request. "}');
        expect(response.text).toContain('"type":"response.reasoning_summary_text.delta"');
        expect(response.text).toContain('"summary":"Checking the request. "');
        expect(response.text).toContain('"type":"response.output_item.added"');
        expect(response.text).toContain('"name":"web_search"');
        expect(response.text).toContain('"delta":{"content":"Answer"}');
        expect(response.text).toContain('data: [DONE]');
    });

    test('includes final reasoning on non-stream chat completion messages', async () => {
        executeConversationRuntime.mockResolvedValue({
            handledPersistence: true,
            response: {
                id: 'resp-compat-final-1',
                model: 'gpt-4o',
                output_text: 'Answer',
                output: [{
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: 'Answer' }],
                }],
                metadata: {
                    reasoningSummary: 'Checked the request and chose the direct path.',
                    reasoningAvailable: true,
                    toolEvents: [],
                },
            },
        });

        const app = express();
        app.use(express.json());
        app.use('/v1', openAiCompatRouter);

        const response = await request(app)
            .post('/v1/chat/completions')
            .send({
                messages: [
                    { role: 'user', content: 'Check this request.' },
                ],
                taskType: 'chat',
                clientSurface: 'web-chat',
                stream: false,
                session_id: 'web-chat-stream-1',
            });

        expect(response.status).toBe(200);
        expect(response.body.choices[0].message.content).toBe('Answer');
        expect(response.body.choices[0].message.reasoning).toBe('Checked the request and chose the direct path.');
    });
});
