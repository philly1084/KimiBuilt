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
    ensureRuntimeToolManager: jest.fn(),
}));

jest.mock('../runtime-execution', () => ({
    executeConversationRuntime: jest.fn(),
    resolveConversationExecutorFlag: jest.fn(() => false),
    inferExecutionProfile: jest.fn(() => 'notes'),
}));

jest.mock('../ai-route-utils', () => ({
    buildInstructionsWithArtifacts: jest.fn(),
    maybeGenerateOutputArtifact: jest.fn(),
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
    extractResponseText: jest.fn(() => 'Returned through normal runtime'),
    resolveCompletedResponseText: jest.fn(() => 'Returned through normal runtime'),
    getMissingCompletionDelta: jest.fn(() => ''),
}));

jest.mock('../admin/runtime-monitor', () => ({
    startRuntimeTask: jest.fn(() => ({ id: 'task-compat-1' })),
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
}));

jest.mock('../session-scope', () => ({
    buildScopedSessionMetadata: jest.fn((metadata = {}) => metadata),
    resolveSessionScope: jest.fn(() => 'notes'),
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
const {
    buildInstructionsWithArtifacts,
    generateOutputArtifactFromPrompt,
    inferRequestedOutputFormat,
    shouldSuppressNotesSurfaceArtifact,
} = require('../ai-route-utils');

const openAiCompatRouter = require('./openai-compat');

describe('/v1/chat/completions notes routing', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        const session = {
            id: 'page-session-1',
            previousResponseId: null,
            metadata: {
                taskType: 'notes',
                clientSurface: 'notes',
            },
        };
        sessionStore.resolveOwnedSession.mockResolvedValue(session);
        sessionStore.getOwned.mockResolvedValue(session);
        sessionStore.get.mockResolvedValue(session);
        sessionStore.getRecentMessages.mockResolvedValue([]);
        sessionStore.update.mockResolvedValue(session);
        buildInstructionsWithArtifacts.mockResolvedValue('continuity instructions');
    });

    test('does not take the direct artifact branch for notes sessions even when html is inferred', async () => {
        inferRequestedOutputFormat.mockReturnValue('html');
        shouldSuppressNotesSurfaceArtifact.mockReturnValue(false);
        executeConversationRuntime.mockResolvedValue({
            handledPersistence: true,
            response: {
                id: 'resp-notes-compat-1',
                output_text: 'Returned through normal runtime',
                output: [{
                    type: 'message',
                    content: [{ type: 'output_text', text: 'Returned through normal runtime' }],
                }],
                metadata: {
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
                    { role: 'user', content: 'Create a page about pigeons.' },
                ],
                taskType: 'notes',
                clientSurface: 'notes',
                session_id: 'page-session-1',
            });

        expect(response.status).toBe(200);
        expect(generateOutputArtifactFromPrompt).not.toHaveBeenCalled();
        expect(executeConversationRuntime).toHaveBeenCalled();
        expect(shouldSuppressNotesSurfaceArtifact).toHaveBeenCalledWith(expect.objectContaining({
            taskType: 'notes',
            outputFormat: 'html',
        }));
    });

    test('does not take the direct artifact branch for notes sessions even when html output is explicitly requested', async () => {
        inferRequestedOutputFormat.mockReturnValue(null);
        shouldSuppressNotesSurfaceArtifact.mockReturnValue(false);
        executeConversationRuntime.mockResolvedValue({
            handledPersistence: true,
            response: {
                id: 'resp-notes-compat-2',
                output_text: 'Returned through normal runtime',
                output: [{
                    type: 'message',
                    content: [{ type: 'output_text', text: 'Returned through normal runtime' }],
                }],
                metadata: {
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
                    { role: 'user', content: 'Create a page about penguins.' },
                ],
                taskType: 'notes',
                clientSurface: 'notes',
                output_format: 'html',
                session_id: 'page-session-1',
            });

        expect(response.status).toBe(200);
        expect(generateOutputArtifactFromPrompt).not.toHaveBeenCalled();
        expect(executeConversationRuntime).toHaveBeenCalled();
        expect(shouldSuppressNotesSurfaceArtifact).toHaveBeenCalledWith(expect.objectContaining({
            taskType: 'notes',
            outputFormat: 'html',
            outputFormatProvided: true,
        }));
    });
});
