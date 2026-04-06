const { Router } = require('express');
const { config } = require('../config');
const { sessionStore } = require('../session-store');
const { memoryService } = require('../memory/memory-service');
const { generateImage, listModels } = require('../openai-client');
const { ensureRuntimeToolManager } = require('../runtime-tool-manager');
const { executeConversationRuntime, resolveConversationExecutorFlag, inferExecutionProfile } = require('../runtime-execution');
const {
    buildInstructionsWithArtifacts,
    maybeGenerateOutputArtifact,
    generateOutputArtifactFromPrompt,
    inferRequestedOutputFormat,
    isArtifactContinuationPrompt,
    maybePrepareImagesForArtifactPrompt,
    resolveDeferredWorkloadPreflight,
    shouldSuppressNotesSurfaceArtifact,
    shouldSuppressImplicitMermaidArtifact,
    stripInjectedNotesPageEditDirective,
    resolveSshRequestContext,
    extractSshSessionMetadataFromToolEvents,
    inferOutputFormatFromSession,
    resolveArtifactContextIds,
    resolveReasoningEffort,
} = require('../ai-route-utils');
const {
    artifactService,
    extractResponseText,
    resolveCompletedResponseText,
    getMissingCompletionDelta,
} = require('../artifacts/artifact-service');
const { stripNullCharacters } = require('../utils/text');
const { startRuntimeTask, completeRuntimeTask, failRuntimeTask } = require('../admin/runtime-monitor');
const { buildProjectMemoryUpdate, mergeProjectMemory } = require('../project-memory');
const { persistGeneratedImages } = require('../generated-image-artifacts');
const { buildContinuityInstructions: buildBaseContinuityInstructions } = require('../runtime-prompts');
const { getSessionControlState } = require('../runtime-control-state');
const { buildFrontendAssistantMetadata, buildWebChatSessionMessages } = require('../web-chat-message-state');
const {
    buildScopedSessionMetadata,
    resolveSessionScope,
} = require('../session-scope');
const {
    buildUserCheckpointAnsweredPatch,
    buildUserCheckpointAskedPatch,
    buildUserCheckpointInstructions,
    buildUserCheckpointPolicy,
    extractPendingUserCheckpoint,
    getUserCheckpointState,
    parseUserCheckpointResponseMessage,
} = require('../user-checkpoints');

const router = Router();
const FINAL_SYNTHESIS_PLACEHOLDER = 'I completed the request, but the final answer could not be synthesized from the model response.';
const WORKLOAD_PREFLIGHT_RECENT_LIMIT = config.memory.recentTranscriptLimit;

function buildOwnerMemoryMetadata(ownerId = null, memoryScope = null) {
    return {
        ...(ownerId ? { ownerId } : {}),
        ...(memoryScope ? { memoryScope } : {}),
    };
}

function normalizeClientNow(value = '') {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return null;
    }

    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function getRequestOwnerId(req) {
    return String(req.user?.username || '').trim() || null;
}

function normalizeMessageText(content = '') {
    if (typeof content === 'string') {
        return stripNullCharacters(content);
    }

    if (Array.isArray(content)) {
        return content
            .map((item) => {
                if (typeof item === 'string') {
                    return item;
                }

                if (item?.type === 'text' || item?.type === 'input_text' || item?.type === 'output_text') {
                    return stripNullCharacters(item.text || '');
                }

                return '';
            })
            .filter(Boolean)
            .join('\n');
    }

    return '';
}

function inferOutputFormatFromTranscript(messages = [], session = null) {
    const normalizedMessages = Array.isArray(messages) ? messages : [];
    const lastUserMessage = normalizedMessages.filter((message) => message?.role === 'user').pop();
    const lastUserText = stripInjectedNotesPageEditDirective(normalizeMessageText(lastUserMessage?.content || ''));
    const mermaidContinuationIntent = /\b(mermaid|diagram|flowchart|sequence diagram|erd|entity relationship|class diagram|state diagram|artifact|file|export)\b/i.test(lastUserText);

    if (!isArtifactContinuationPrompt(lastUserText)) {
        return inferOutputFormatFromSession(lastUserText, session);
    }

    for (let index = normalizedMessages.length - 1; index >= 0; index -= 1) {
        const message = normalizedMessages[index];
        const format = inferRequestedOutputFormat(stripInjectedNotesPageEditDirective(normalizeMessageText(message?.content || '')));
        if (format === 'mermaid' && !mermaidContinuationIntent) {
            continue;
        }
        if (format) {
            return format;
        }
    }

    return inferOutputFormatFromSession(lastUserText, session);
}

function isFinalSynthesisPlaceholder(text = '') {
    const normalized = stripNullCharacters(String(text || '')).trim();
    return !normalized || normalized === FINAL_SYNTHESIS_PLACEHOLDER;
}

function summarizeCompatToolEvent(event = {}) {
    const toolName = String(event?.toolCall?.function?.name || event?.result?.toolId || 'tool').trim();
    const success = event?.result?.success !== false;
    const stdout = stripNullCharacters(String(event?.result?.data?.stdout || '')).trim();
    const stderr = stripNullCharacters(String(event?.result?.data?.stderr || '')).trim();
    const error = stripNullCharacters(String(event?.result?.error || '')).trim();
    const preview = stdout || stderr || error;

    if (!success) {
        return [
            `- ${toolName}: failed.`,
            error ? `Error: ${error}` : '',
            !error && stderr ? `Details: ${stderr}` : '',
        ].filter(Boolean).join(' ');
    }

    return [
        `- ${toolName}: succeeded.`,
        preview ? `Output: ${preview.slice(0, 600)}` : '',
    ].filter(Boolean).join(' ');
}

function buildCompatToolFallbackText({ userText = '', toolEvents = [] } = {}) {
    const events = Array.isArray(toolEvents) ? toolEvents : [];
    if (events.length === 0) {
        return FINAL_SYNTHESIS_PLACEHOLDER;
    }

    return [
        'Verified tool results:',
        userText ? `Request: ${stripNullCharacters(String(userText || '')).trim()}` : '',
        ...events.slice(0, 8).map((event) => summarizeCompatToolEvent(event)),
    ].filter(Boolean).join('\n');
}

function applyCompatFallbackToResponse(response = {}, text = '') {
    const normalizedText = stripNullCharacters(String(text || '')).trim();
    const metadata = response?.metadata && typeof response.metadata === 'object'
        ? response.metadata
        : {};

    const normalizedOutput = Array.isArray(response?.output) && response.output.length > 0
        ? response.output.map((item, index) => {
            if (index !== 0) {
                return item;
            }

            return {
                ...item,
                content: [{
                    type: 'output_text',
                    text: normalizedText,
                }],
            };
        })
        : [{
            id: `msg_${response?.id || 'compat_fallback'}`,
            type: 'message',
            role: 'assistant',
            content: [{
                type: 'output_text',
                text: normalizedText,
            }],
        }];

    const normalizedChoices = Array.isArray(response?.choices) && response.choices.length > 0
        ? response.choices.map((choice, index) => {
            if (index !== 0) {
                return choice;
            }

            return {
                ...choice,
                message: {
                    ...(choice?.message || {}),
                    role: 'assistant',
                    content: normalizedText,
                },
            };
        })
        : [{
            index: 0,
            message: {
                role: 'assistant',
                content: normalizedText,
            },
            finish_reason: 'stop',
        }];

    return {
        ...response,
        output_text: normalizedText,
        output: normalizedOutput,
        choices: normalizedChoices,
        metadata: {
            ...metadata,
            compatToolFallbackApplied: true,
        },
    };
}

function resolveCompatAssistantText({ response = {}, outputText = '', userText = '' } = {}) {
    const toolEvents = response?.metadata?.toolEvents || [];
    if (toolEvents.length === 0 || !isFinalSynthesisPlaceholder(outputText)) {
        return {
            outputText,
            response,
        };
    }

    const fallbackText = buildCompatToolFallbackText({
        userText,
        toolEvents,
    });

    return {
        outputText: fallbackText,
        response: applyCompatFallbackToResponse(response, fallbackText),
    };
}

function isRemotePermissionGrantText(text = '') {
    const normalized = stripNullCharacters(String(text || '')).trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    const grantsPermission = [
        /\b(i give you permission|you have permission|permission granted|i approve|approved)\b/,
        /\b(go ahead and use|you can use|allowed to use|can use)\b[\s\S]{0,20}\b(remote command|ssh|server access|remote access)\b/,
    ].some((pattern) => pattern.test(normalized));

    if (!grantsPermission) {
        return false;
    }

    return !/\b(health|report|summary|status|state|check|inspect|diagnose|debug|deploy|restart|install|fix|repair|update|change|configure|build|logs?|kubectl|pod|service|ingress)\b/.test(normalized);
}

function shouldRetryPlaceholderAsRemoteBuild({ session = null, executionProfile = 'default', outputText = '', response = {}, userText = '' } = {}) {
    if (executionProfile === 'remote-build') {
        return false;
    }

    if (!isFinalSynthesisPlaceholder(outputText)) {
        return false;
    }

    if ((response?.metadata?.toolEvents || []).length > 0) {
        return false;
    }

    const controlState = getSessionControlState(session);
    const hasStickyRemoteContext = Boolean(
        controlState?.lastToolIntent === 'remote-command'
        || controlState?.lastToolIntent === 'ssh-execute'
        || controlState?.lastSshTarget?.host
        || controlState?.remoteWorkingState?.target?.host
        || controlState?.lastRemoteObjective,
    );

    return hasStickyRemoteContext && isRemotePermissionGrantText(userText);
}

function buildArtifactPromptFromTranscript(messages = [], fallbackPrompt = '') {
    const normalizedMessages = Array.isArray(messages) ? messages : [];
    const lastUserMessage = normalizedMessages.filter((message) => message?.role === 'user').pop();
    const lastUserText = normalizeMessageText(lastUserMessage?.content || fallbackPrompt);

    if (!isArtifactContinuationPrompt(lastUserText)) {
        return lastUserText || fallbackPrompt;
    }

    const transcript = normalizedMessages
        .filter((message) => ['user', 'assistant', 'tool'].includes(message?.role))
        .slice(-8)
        .map((message) => `${message.role}: ${normalizeMessageText(message?.content || '')}`.trim())
        .filter((line) => line && !line.endsWith(':'))
        .join('\n');

    if (!transcript) {
        return lastUserText || fallbackPrompt;
    }

    return [
        'Continue or refine the same artifact request using this recent conversation context.',
        transcript,
        `Current request: ${lastUserText || fallbackPrompt}`,
    ].filter(Boolean).join('\n\n');
}

function buildContinuityInstructions(extra = '') {
    return buildBaseContinuityInstructions(extra);
}

function resolveClientSurface(payload = {}, session = null) {
    const candidates = [
        payload?.clientSurface,
        payload?.client_surface,
        payload?.metadata?.clientSurface,
        payload?.metadata?.client_surface,
        session?.metadata?.clientSurface,
        session?.metadata?.client_surface,
    ];

    return candidates.find((value) => typeof value === 'string' && value.trim()) || '';
}

function attachUpdatedControlState(session = null, controlState = null) {
    if (!session || !controlState) {
        return session;
    }

    return {
        ...session,
        controlState,
        metadata: {
            ...(session.metadata || {}),
            controlState,
        },
    };
}

async function applyAnsweredUserCheckpointState(sessionId, session, userText = '') {
    const response = parseUserCheckpointResponseMessage(userText);
    if (!response) {
        return {
            session,
            response: null,
        };
    }

    const checkpointState = getUserCheckpointState(session);
    if (checkpointState.pending?.id && checkpointState.pending.id !== response.checkpointId) {
        return {
            session,
            response,
        };
    }

    const controlState = await sessionStore.updateControlState(
        sessionId,
        buildUserCheckpointAnsweredPatch(session, response),
    );

    return {
        session: attachUpdatedControlState(session, controlState),
        response,
    };
}

async function applyAskedUserCheckpointState(sessionId, session, toolEvents = []) {
    const checkpoint = extractPendingUserCheckpoint(toolEvents);
    if (!checkpoint) {
        return session;
    }

    const controlState = await sessionStore.updateControlState(
        sessionId,
        buildUserCheckpointAskedPatch(session, checkpoint),
    );

    return attachUpdatedControlState(session, controlState);
}

function getHeaderValue(req, headerName) {
    const value = req.headers?.[headerName];
    if (Array.isArray(value)) {
        return value.find(Boolean) || null;
    }
    return value || null;
}

function resolveSessionId(req) {
    const body = req.body || {};
    const candidates = [
        body.session_id,
        body.sessionId,
        body.conversation_id,
        body.conversationId,
        body.thread_id,
        body.threadId,
        getHeaderValue(req, 'x-session-id'),
        getHeaderValue(req, 'x-conversation-id'),
        getHeaderValue(req, 'x-thread-id'),
    ];

    return candidates.find((value) => typeof value === 'string' && value.trim()) || null;
}

function setSessionHeaders(res, sessionId) {
    if (!sessionId) {
        return;
    }

    res.setHeader('X-Session-Id', sessionId);
    res.setHeader('X-Conversation-Id', sessionId);
    res.setHeader('X-Thread-Id', sessionId);
}

function isNotesSurfaceValue(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    return [
        'notes',
        'notes-app',
        'notes_app',
        'notes-editor',
        'notes_editor',
    ].includes(normalized);
}

function resolveConversationTaskType(payload = {}, session = null) {
    const candidates = [
        payload?.taskType,
        payload?.task_type,
        payload?.clientSurface,
        payload?.client_surface,
        payload?.metadata?.taskType,
        payload?.metadata?.task_type,
        payload?.metadata?.clientSurface,
        payload?.metadata?.client_surface,
        session?.metadata?.taskType,
        session?.metadata?.task_type,
        session?.metadata?.clientSurface,
        session?.metadata?.client_surface,
    ];

    return candidates.some((value) => isNotesSurfaceValue(value)) ? 'notes' : 'chat';
}

function shouldInjectRecentMessages(inputMessages = []) {
    if (!Array.isArray(inputMessages)) {
        return true;
    }

    // Many clients send only a system prompt plus the latest user turn. Treat that
    // as an incremental turn so the server still injects the stored session transcript.
    const transcriptMessages = inputMessages.filter((message) => ['user', 'assistant', 'tool'].includes(message?.role));
    return transcriptMessages.length <= 1;
}

function isChatCapableModel(modelId = '') {
    const normalizedId = String(modelId).toLowerCase();
    if (!normalizedId) return false;

    const looksLikeChatModel = [
        'gpt', 'claude', 'gemini', 'kimi', 'llama', 'mistral', 'qwen', 'phi', 'ollama', 'antigravity', 'deepseek', 'deepseak',
    ].some((token) => normalizedId.includes(token));

    const imageOnly = normalizedId.includes('image') && !normalizedId.includes('vision');
    const audioOnly = normalizedId.includes('tts') || normalizedId.includes('speech') || normalizedId.includes('transcribe');

    return looksLikeChatModel && !imageOnly && !audioOnly;
}

async function updateSessionProjectMemory(sessionId, updates = {}, ownerId = null) {
    if (!sessionId) {
        return null;
    }

    const session = ownerId
        ? await sessionStore.getOwned(sessionId, ownerId)
        : await sessionStore.get(sessionId);
    if (!session) {
        return null;
    }

    const projectMemory = mergeProjectMemory(
        session?.metadata?.projectMemory || {},
        buildProjectMemoryUpdate(updates),
    );

    return sessionStore.update(sessionId, {
        metadata: {
            projectMemory,
        },
    });
}

router.get('/models', async (_req, res, next) => {
    try {
        const models = await listModels();
        res.json({
            object: 'list',
            data: models
                .filter((model) => isChatCapableModel(model.id))
                .map((model) => ({
                    id: model.id,
                    object: 'model',
                    created: model.created || Math.floor(Date.now() / 1000),
                    owned_by: model.owned_by || 'openai',
                })),
        });
    } catch (err) {
        next(err);
    }
});

router.post('/chat/completions', async (req, res, next) => {
    let runtimeTask = null;
    const startedAt = Date.now();
    try {
        const {
            model,
            messages,
            stream = false,
            reasoning: _ignoredReasoning = null,
            artifact_ids = [],
            output_format = null,
            executionProfile = null,
            metadata: requestMetadata = {},
        } = req.body;
        const reasoningEffort = resolveReasoningEffort(req.body);
        const enableConversationExecutor = resolveConversationExecutorFlag(req.body);
        const ownerId = getRequestOwnerId(req);
        const requestTimezone = String(
            requestMetadata?.timezone
            || requestMetadata?.timeZone
            || req.get('x-timezone')
            || ''
        ).trim() || null;
        const requestNow = normalizeClientNow(
            requestMetadata?.clientNow
            || requestMetadata?.client_now
            || req.get('x-client-now')
            || '',
        );
        let effectiveRequestMetadata = {
            ...requestMetadata,
            ...(requestTimezone ? { timezone: requestTimezone } : {}),
            ...(requestNow ? { clientNow: requestNow } : {}),
        };

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({
                error: {
                    message: 'messages is required and must be an array',
                    type: 'invalid_request_error',
                },
            });
        }

        let sessionId = resolveSessionId(req);
        let session;
        const requestedTaskType = resolveConversationTaskType(req.body);
        const requestedClientSurface = resolveClientSurface(req.body, null);
        const requestedSessionMetadata = buildScopedSessionMetadata({
            ...effectiveRequestMetadata,
            mode: requestedTaskType,
            taskType: requestedTaskType,
            clientSurface: requestedClientSurface,
        });
        session = await sessionStore.resolveOwnedSession(
            sessionId,
            requestedSessionMetadata,
            ownerId,
        );
        if (session) {
            sessionId = session.id;
        }
        if (!session) {
            return res.status(404).json({
                error: {
                    message: 'Session not found',
                    type: 'invalid_request_error',
                },
            });
        }

        const clientSurface = resolveClientSurface(req.body, session);
        const memoryScope = resolveSessionScope({
            ...requestedSessionMetadata,
            taskType: requestedTaskType,
            clientSurface,
        }, session);
        effectiveRequestMetadata = {
            ...effectiveRequestMetadata,
            clientSurface,
            memoryScope,
        };
        const lastUserMessage = messages.filter((message) => message.role === 'user').pop();
        const lastUserText = normalizeMessageText(lastUserMessage?.content || '');
        const answeredCheckpointResult = await applyAnsweredUserCheckpointState(sessionId, session, lastUserText);
        session = answeredCheckpointResult.session;
        const userCheckpointPolicy = buildUserCheckpointPolicy({
            session,
            clientSurface,
        });
        const sshContext = resolveSshRequestContext(lastUserText, session);
        const effectiveInput = sshContext.effectivePrompt || lastUserText;
        const artifactIntentText = stripInjectedNotesPageEditDirective(lastUserText);
        const taskType = resolveConversationTaskType(req.body, session);
        const effectiveMessages = messages.map((message) => (
            message.role === 'user' && message === lastUserMessage
                ? { role: message.role, content: effectiveInput }
                : { role: message.role, content: message.content }
        ));
        const effectiveExecutionProfile = inferExecutionProfile({
            ...req.body,
            taskType,
            input: effectiveMessages,
            memoryInput: lastUserText,
            session,
        });
        const chatControlState = getSessionControlState(session);
        console.log(`[OpenAICompat] chat/completions routing sessionId=${sessionId} profile=${effectiveExecutionProfile} stickyRemote=${Boolean(chatControlState?.lastToolIntent || chatControlState?.lastSshTarget?.host || chatControlState?.lastRemoteObjective)} lastRemoteObjective=${JSON.stringify(chatControlState?.lastRemoteObjective || '')}`);
        let effectiveOutputFormat = output_format
            || inferRequestedOutputFormat(artifactIntentText)
            || inferOutputFormatFromTranscript(messages, session);
        if (shouldSuppressImplicitMermaidArtifact({
            taskType,
            text: artifactIntentText,
            outputFormat: effectiveOutputFormat,
            outputFormatProvided: Boolean(output_format),
        })) {
            effectiveOutputFormat = null;
        }
        if (shouldSuppressNotesSurfaceArtifact({
            taskType,
            text: artifactIntentText,
            outputFormat: effectiveOutputFormat,
            outputFormatProvided: Boolean(output_format),
        })) {
            effectiveOutputFormat = null;
        }
        const recentMessagesForWorkloadPreflight = effectiveOutputFormat
            ? await sessionStore.getRecentMessages(sessionId, WORKLOAD_PREFLIGHT_RECENT_LIMIT)
            : [];
        const workloadPreflight = resolveDeferredWorkloadPreflight({
            text: artifactIntentText,
            recentMessages: recentMessagesForWorkloadPreflight,
            timezone: requestTimezone,
            now: requestNow,
        });
        if (workloadPreflight.shouldSchedule) {
            effectiveOutputFormat = null;
        }
        effectiveRequestMetadata = {
            ...effectiveRequestMetadata,
            timingDecision: workloadPreflight.shouldSchedule ? 'future' : 'now',
            userCheckpointPolicy: {
                enabled: userCheckpointPolicy.enabled,
                maxQuestions: userCheckpointPolicy.maxQuestions,
                askedCount: userCheckpointPolicy.askedCount,
                remaining: userCheckpointPolicy.remaining,
                pending: userCheckpointPolicy.pending
                    ? {
                        id: userCheckpointPolicy.pending.id,
                        title: userCheckpointPolicy.pending.title,
                        question: userCheckpointPolicy.pending.question,
                    }
                    : null,
            },
            ...(workloadPreflight.shouldSchedule && workloadPreflight.scenario
                ? {
                    workloadPreflight: {
                        timing: 'future',
                        request: workloadPreflight.request,
                        trigger: workloadPreflight.scenario.trigger,
                    },
                }
                : {}),
        };
        const effectiveArtifactIds = resolveArtifactContextIds(session, artifact_ids, lastUserText);
        const artifactPrompt = buildArtifactPromptFromTranscript(messages, lastUserText);
        runtimeTask = startRuntimeTask({
            sessionId,
            input: lastUserText || JSON.stringify(messages),
            model: model || null,
            mode: 'openai-chat',
            transport: 'http',
            metadata: { route: '/v1/chat/completions', stream, phase: 'preflight', reasoningEffort },
        });
        if (effectiveOutputFormat) {
            setSessionHeaders(res, sessionId);
            const toolManager = await ensureRuntimeToolManager(req.app);
            const preparedImages = await maybePrepareImagesForArtifactPrompt({
                toolManager,
                sessionId,
                route: '/v1/chat/completions',
                transport: 'http',
                taskType,
                text: artifactPrompt,
                outputFormat: effectiveOutputFormat,
                artifactIds: effectiveArtifactIds,
            });
            const artifactGenerationSession = preparedImages.resetPreviousResponse
                ? { ...session, previousResponseId: null }
                : session;

            if (stream) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
            }

            const generation = await generateOutputArtifactFromPrompt({
                sessionId,
                session: artifactGenerationSession,
                mode: taskType,
                outputFormat: effectiveOutputFormat,
                prompt: artifactPrompt,
                artifactIds: preparedImages.artifactIds,
                model,
                reasoningEffort,
            });
            const responseArtifacts = [
                ...preparedImages.artifacts,
                ...generation.artifacts,
            ].filter((artifact, index, array) => {
                const artifactId = artifact?.id || '';
                return artifactId && array.findIndex((entry) => entry?.id === artifactId) === index;
            });

            await sessionStore.recordResponse(sessionId, generation.responseId);
            await sessionStore.update(sessionId, {
                metadata: {
                    lastOutputFormat: effectiveOutputFormat,
                    lastGeneratedArtifactId: generation.artifact.id,
                    taskType,
                    clientSurface: clientSurface || taskType,
                    memoryScope,
                },
            });
            memoryService.rememberResponse(
                sessionId,
                generation.assistantMessage,
                buildOwnerMemoryMetadata(ownerId, memoryScope),
            );
            await sessionStore.appendMessages(sessionId, buildWebChatSessionMessages({
                userText: lastUserText,
                assistantText: generation.assistantMessage,
                toolEvents: preparedImages.toolEvents,
                artifacts: responseArtifacts,
            }));
            await updateSessionProjectMemory(sessionId, {
                userText: lastUserText,
                assistantText: generation.assistantMessage,
                toolEvents: preparedImages.toolEvents,
                artifacts: responseArtifacts,
            }, ownerId);

            completeRuntimeTask(runtimeTask?.id, {
                responseId: generation.responseId,
                output: generation.assistantMessage,
                model: model || null,
                duration: Date.now() - startedAt,
                metadata: {
                    outputFormat: effectiveOutputFormat,
                    artifactDirect: true,
                    toolEvents: preparedImages.toolEvents,
                },
            });

            if (stream) {
                res.write(`data: ${JSON.stringify({
                    id: `chatcmpl-${sessionId}-0`,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: model || 'gpt-4o',
                    choices: [{ index: 0, delta: { content: generation.assistantMessage }, finish_reason: null }],
                })}\n\n`);
                res.write(`data: ${JSON.stringify({
                    id: `chatcmpl-${sessionId}`,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: model || 'gpt-4o',
                    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                    session_id: sessionId,
                    artifacts: responseArtifacts,
                    tool_events: preparedImages.toolEvents,
                    toolEvents: preparedImages.toolEvents,
                })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
                return;
            }

            res.json({
                id: `chatcmpl-${generation.responseId}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: model || 'gpt-4o',
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: generation.assistantMessage,
                        artifacts: responseArtifacts,
                    },
                    finish_reason: 'stop',
                }],
                usage: {
                    prompt_tokens: -1,
                    completion_tokens: -1,
                    total_tokens: -1,
                },
                session_id: sessionId,
                artifacts: responseArtifacts,
                tool_events: preparedImages.toolEvents,
                toolEvents: preparedImages.toolEvents,
            });
            return;
        }

        const artifactInstructions = effectiveOutputFormat
            ? artifactService.getGenerationInstructions(effectiveOutputFormat)
            : '';
        const userCheckpointInstructions = buildUserCheckpointInstructions(userCheckpointPolicy);
        const instructions = await buildInstructionsWithArtifacts(
            session,
            buildContinuityInstructions(
                [artifactInstructions, userCheckpointInstructions]
                    .filter(Boolean)
                    .join('\n\n'),
            ),
            effectiveArtifactIds,
        );
        const input = effectiveMessages;

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            setSessionHeaders(res, sessionId);

            const toolManager = await ensureRuntimeToolManager(req.app);
            const execution = await executeConversationRuntime(req.app, {
                input: messages.map((message) => (
                    message.role === 'user' && message === lastUserMessage
                        ? { role: message.role, content: effectiveInput }
                        : { role: message.role, content: message.content }
                )),
                sessionId,
                memoryInput: lastUserText,
                loadContextMessages: Boolean(lastUserText),
                loadRecentMessages: shouldInjectRecentMessages(messages),
                previousResponseId: session.previousResponseId,
                instructions,
                stream: true,
                model,
                reasoningEffort,
                toolManager,
                toolContext: {
                    sessionId,
                    route: '/v1/chat/completions',
                    transport: 'http',
                    clientSurface,
                    memoryService,
                    ownerId,
                    memoryScope,
                    timezone: requestTimezone,
                    now: requestNow,
                    workloadService: req.app.locals.agentWorkloadService,
                    userCheckpointPolicy,
                },
                executionProfile: effectiveExecutionProfile,
                enableAutomaticToolCalls: true,
                enableConversationExecutor,
                taskType,
                clientSurface,
                memoryScope,
                metadata: effectiveRequestMetadata,
                ownerId,
            });
            const response = execution.response;

            let fullText = '';
            let chunkIndex = 0;

            for await (const event of response) {
                if (event.type === 'response.output_text.delta') {
                    fullText += event.delta;
                    res.write(`data: ${JSON.stringify({
                        id: `chatcmpl-${sessionId}-${chunkIndex}`,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: model || 'gpt-4o',
                        choices: [{ index: 0, delta: { content: event.delta }, finish_reason: null }],
                    })}\n\n`);
                    chunkIndex += 1;
                }

                if (event.type === 'response.completed') {
                    const completedText = resolveCompletedResponseText(fullText, event.response);
                    const resolvedCompletion = resolveCompatAssistantText({
                        response: event.response,
                        outputText: completedText,
                        userText: lastUserText,
                    });
                    const missingDelta = getMissingCompletionDelta(fullText, resolvedCompletion.outputText);
                    if (missingDelta) {
                        fullText = resolvedCompletion.outputText;
                        res.write(`data: ${JSON.stringify({
                            id: `chatcmpl-${sessionId}-${chunkIndex}`,
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: model || 'gpt-4o',
                            choices: [{ index: 0, delta: { content: missingDelta }, finish_reason: null }],
                        })}\n\n`);
                        chunkIndex += 1;
                    } else {
                        fullText = resolvedCompletion.outputText;
                    }

                    const toolEvents = resolvedCompletion.response?.metadata?.toolEvents || [];
                    if (!execution.handledPersistence) {
                        await sessionStore.recordResponse(sessionId, resolvedCompletion.response.id);
                        memoryService.rememberResponse(sessionId, fullText, buildOwnerMemoryMetadata(ownerId, memoryScope));
                    }
                    const sshMetadata = extractSshSessionMetadataFromToolEvents(resolvedCompletion.response?.metadata?.toolEvents);
                    if (sshMetadata) {
                        await sessionStore.update(sessionId, { metadata: sshMetadata });
                    }
                    session = await applyAskedUserCheckpointState(sessionId, session, toolEvents);
                    const artifacts = await maybeGenerateOutputArtifact({
                        sessionId,
                        session,
                        mode: taskType,
                        outputFormat: effectiveOutputFormat,
                        content: fullText,
                        prompt: artifactPrompt,
                        title: 'chat-output',
                        responseId: resolvedCompletion.response.id,
                        artifactIds: artifact_ids,
                        model,
                        reasoningEffort,
                    });
                    await updateSessionProjectMemory(sessionId, {
                        userText: lastUserText,
                        assistantText: fullText,
                        toolEvents,
                        artifacts,
                    }, ownerId);
                    if (!execution.handledPersistence) {
                        await sessionStore.appendMessages(sessionId, buildWebChatSessionMessages({
                            userText: lastUserText,
                            assistantText: fullText,
                            toolEvents,
                            artifacts,
                            assistantMetadata: resolvedCompletion.response?.metadata,
                        }));
                    }
                    completeRuntimeTask(runtimeTask?.id, {
                        responseId: resolvedCompletion.response.id,
                        output: fullText,
                        model: resolvedCompletion.response.model || model || null,
                        duration: Date.now() - startedAt,
                        metadata: resolvedCompletion.response?.metadata || {},
                    });
                    res.write(`data: ${JSON.stringify({
                        id: `chatcmpl-${sessionId}`,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: model || 'gpt-4o',
                        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                        session_id: sessionId,
                        artifacts,
                        tool_events: toolEvents,
                        toolEvents,
                        assistant_metadata: buildFrontendAssistantMetadata(resolvedCompletion.response?.metadata),
                        assistantMetadata: buildFrontendAssistantMetadata(resolvedCompletion.response?.metadata),
                    })}\n\n`);
                    res.write('data: [DONE]\n\n');
                }
            }

            res.end();
            return;
        }

        setSessionHeaders(res, sessionId);
        const runtimeToolManager = await ensureRuntimeToolManager(req.app);
        const execution = await executeConversationRuntime(req.app, {
            input: effectiveMessages,
            sessionId,
            memoryInput: lastUserText,
            loadContextMessages: Boolean(lastUserText),
            loadRecentMessages: shouldInjectRecentMessages(messages),
            previousResponseId: session.previousResponseId,
            instructions,
            stream: false,
            model,
            reasoningEffort,
            toolManager: runtimeToolManager,
            toolContext: {
                sessionId,
                route: '/v1/chat/completions',
                transport: 'http',
                clientSurface,
                memoryService,
                ownerId,
                memoryScope,
                timezone: requestTimezone,
                now: requestNow,
                workloadService: req.app.locals.agentWorkloadService,
                userCheckpointPolicy,
            },
            executionProfile: effectiveExecutionProfile,
            enableAutomaticToolCalls: true,
            enableConversationExecutor,
            taskType,
            clientSurface,
            memoryScope,
            metadata: effectiveRequestMetadata,
            ownerId,
        });
        let response = execution.response;
        if (!execution.handledPersistence) {
            await sessionStore.recordResponse(sessionId, response.id);
        }
        let outputText = extractResponseText(response);
        const resolvedCompatResponse = resolveCompatAssistantText({
            response,
            outputText,
            userText: lastUserText,
        });
        response = resolvedCompatResponse.response;
        outputText = resolvedCompatResponse.outputText;
        if (shouldRetryPlaceholderAsRemoteBuild({
            session,
            executionProfile: effectiveExecutionProfile,
            outputText,
            response,
            userText: lastUserText,
        })) {
            console.warn(`[OpenAICompat] Retrying placeholder direct response as remote-build. sessionId=${sessionId}`);
            const retriedExecution = await executeConversationRuntime(req.app, {
                input: effectiveMessages,
                sessionId,
                memoryInput: lastUserText,
                loadContextMessages: Boolean(lastUserText),
                loadRecentMessages: shouldInjectRecentMessages(messages),
                previousResponseId: session.previousResponseId,
                instructions,
                stream: false,
                model,
                reasoningEffort,
                toolManager: runtimeToolManager,
                toolContext: {
                    sessionId,
                    route: '/v1/chat/completions',
                    transport: 'http',
                    clientSurface,
                    memoryService,
                    ownerId,
                    memoryScope,
                    timezone: requestTimezone,
                    now: requestNow,
                    workloadService: req.app.locals.agentWorkloadService,
                    userCheckpointPolicy,
                },
                executionProfile: 'remote-build',
                enableAutomaticToolCalls: true,
                enableConversationExecutor,
                taskType,
                clientSurface,
                memoryScope,
                metadata: {
                    ...effectiveRequestMetadata,
                    remoteBuildAutonomyApproved: true,
                },
                ownerId,
            });
            response = retriedExecution.response;
            outputText = extractResponseText(response);
        }
        if (!execution.handledPersistence) {
            memoryService.rememberResponse(sessionId, outputText, buildOwnerMemoryMetadata(ownerId, memoryScope));
        }
        const sshMetadata = extractSshSessionMetadataFromToolEvents(response?.metadata?.toolEvents);
        if (sshMetadata) {
            await sessionStore.update(sessionId, { metadata: sshMetadata });
        }
        session = await applyAskedUserCheckpointState(sessionId, session, response?.metadata?.toolEvents || []);
        const artifacts = await maybeGenerateOutputArtifact({
            sessionId,
            session,
            mode: taskType,
            outputFormat: effectiveOutputFormat,
            content: outputText,
            prompt: artifactPrompt,
            title: 'chat-output',
            responseId: response.id,
            artifactIds: artifact_ids,
            model,
            reasoningEffort,
        });
        await updateSessionProjectMemory(sessionId, {
            userText: lastUserText,
            assistantText: outputText,
            toolEvents: response?.metadata?.toolEvents || [],
            artifacts,
        }, ownerId);
        if (!execution.handledPersistence) {
            await sessionStore.appendMessages(sessionId, buildWebChatSessionMessages({
                userText: lastUserText,
                assistantText: outputText,
                toolEvents: response?.metadata?.toolEvents || [],
                artifacts,
                assistantMetadata: response?.metadata,
            }));
        }
        completeRuntimeTask(runtimeTask?.id, {
            responseId: response.id,
            output: outputText,
            model: response.model || model || null,
            duration: Date.now() - startedAt,
            metadata: response?.metadata || {},
        });

        res.json({
            id: `chatcmpl-${response.id}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: model || 'gpt-4o',
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content: outputText,
                    artifacts,
                },
                finish_reason: 'stop',
            }],
            usage: {
                prompt_tokens: -1,
                completion_tokens: -1,
                total_tokens: -1,
            },
            session_id: sessionId,
            artifacts,
            tool_events: response?.metadata?.toolEvents || [],
            toolEvents: response?.metadata?.toolEvents || [],
            assistant_metadata: buildFrontendAssistantMetadata(response?.metadata),
            assistantMetadata: buildFrontendAssistantMetadata(response?.metadata),
        });
    } catch (err) {
        failRuntimeTask(runtimeTask?.id, {
            error: err,
            duration: Date.now() - startedAt,
            model: req.body?.model || null,
            metadata: { reasoningEffort: resolveReasoningEffort(req.body) },
        });
        next(err);
    }
});

router.post('/responses', async (req, res, next) => {
    let runtimeTask = null;
    const startedAt = Date.now();
    try {
        const {
            model,
            input,
            instructions,
            stream = false,
            reasoning: _ignoredReasoning = null,
            artifact_ids = [],
            output_format = null,
            executionProfile = null,
            metadata: requestMetadata = {},
        } = req.body;
        const reasoningEffort = resolveReasoningEffort(req.body);
        const enableConversationExecutor = resolveConversationExecutorFlag(req.body);
        const ownerId = getRequestOwnerId(req);
        const requestTimezone = String(
            requestMetadata?.timezone
            || requestMetadata?.timeZone
            || req.get('x-timezone')
            || ''
        ).trim() || null;
        const requestNow = normalizeClientNow(
            requestMetadata?.clientNow
            || requestMetadata?.client_now
            || req.get('x-client-now')
            || '',
        );
        let effectiveRequestMetadata = {
            ...requestMetadata,
            ...(requestTimezone ? { timezone: requestTimezone } : {}),
            ...(requestNow ? { clientNow: requestNow } : {}),
        };

        let sessionId = resolveSessionId(req);
        let session;
        const requestedTaskType = resolveConversationTaskType(req.body);
        const requestedClientSurface = resolveClientSurface(req.body, null);
        const requestedSessionMetadata = buildScopedSessionMetadata({
            ...effectiveRequestMetadata,
            mode: requestedTaskType,
            taskType: requestedTaskType,
            clientSurface: requestedClientSurface,
        });
        session = await sessionStore.resolveOwnedSession(
            sessionId,
            requestedSessionMetadata,
            ownerId,
        );
        if (session) {
            sessionId = session.id;
        }
        if (!session) {
            return res.status(404).json({
                error: {
                    message: 'Session not found',
                    type: 'invalid_request_error',
                },
            });
        }

        const normalizedInputMessages = typeof input === 'string'
            ? [{ role: 'user', content: input }]
            : (Array.isArray(input)
                ? input.filter((item) => item?.role).map((item) => ({ role: item.role, content: item.content }))
                : []);
        const userInput = typeof input === 'string'
            ? input
            : normalizeMessageText(input.filter((item) => item.role === 'user').pop()?.content || '');
        const sshContext = resolveSshRequestContext(userInput, session);
        const effectiveUserInput = sshContext.effectivePrompt || userInput;
        const artifactIntentText = stripInjectedNotesPageEditDirective(userInput);
        const taskType = resolveConversationTaskType(req.body, session);
        const clientSurface = resolveClientSurface(req.body, session);
        const memoryScope = resolveSessionScope({
            ...requestedSessionMetadata,
            taskType,
            clientSurface,
        }, session);
        effectiveRequestMetadata = {
            ...effectiveRequestMetadata,
            clientSurface,
            memoryScope,
        };
        let effectiveOutputFormat = output_format
            || inferRequestedOutputFormat(artifactIntentText)
            || inferOutputFormatFromTranscript(normalizedInputMessages, session);
        if (shouldSuppressImplicitMermaidArtifact({
            taskType,
            text: artifactIntentText,
            outputFormat: effectiveOutputFormat,
            outputFormatProvided: Boolean(output_format),
        })) {
            effectiveOutputFormat = null;
        }
        if (shouldSuppressNotesSurfaceArtifact({
            taskType,
            text: artifactIntentText,
            outputFormat: effectiveOutputFormat,
            outputFormatProvided: Boolean(output_format),
        })) {
            effectiveOutputFormat = null;
        }
        const recentMessagesForWorkloadPreflight = effectiveOutputFormat
            ? await sessionStore.getRecentMessages(sessionId, WORKLOAD_PREFLIGHT_RECENT_LIMIT)
            : [];
        const workloadPreflight = resolveDeferredWorkloadPreflight({
            text: artifactIntentText,
            recentMessages: recentMessagesForWorkloadPreflight,
            timezone: requestTimezone,
            now: requestNow,
        });
        if (workloadPreflight.shouldSchedule) {
            effectiveOutputFormat = null;
        }
        effectiveRequestMetadata = {
            ...effectiveRequestMetadata,
            timingDecision: workloadPreflight.shouldSchedule ? 'future' : 'now',
            ...(workloadPreflight.shouldSchedule && workloadPreflight.scenario
                ? {
                    workloadPreflight: {
                        timing: 'future',
                        request: workloadPreflight.request,
                        trigger: workloadPreflight.scenario.trigger,
                    },
                }
                : {}),
        };
        const effectiveArtifactIds = resolveArtifactContextIds(session, artifact_ids, userInput);
        const artifactPrompt = buildArtifactPromptFromTranscript(normalizedInputMessages, userInput);
        runtimeTask = startRuntimeTask({
            sessionId,
            input: userInput || JSON.stringify(input),
            model: model || null,
            mode: 'openai-responses',
            transport: 'http',
            metadata: { route: '/v1/responses', stream, phase: 'preflight', reasoningEffort },
        });
        if (effectiveOutputFormat) {
            setSessionHeaders(res, sessionId);
            const toolManager = await ensureRuntimeToolManager(req.app);
            const preparedImages = await maybePrepareImagesForArtifactPrompt({
                toolManager,
                sessionId,
                route: '/v1/responses',
                transport: 'http',
                taskType,
                text: artifactPrompt,
                outputFormat: effectiveOutputFormat,
                artifactIds: effectiveArtifactIds,
            });
            const artifactGenerationSession = preparedImages.resetPreviousResponse
                ? { ...session, previousResponseId: null }
                : session;

            if (stream) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
            }

            const generation = await generateOutputArtifactFromPrompt({
                sessionId,
                session: artifactGenerationSession,
                mode: taskType,
                outputFormat: effectiveOutputFormat,
                prompt: artifactPrompt,
                artifactIds: preparedImages.artifactIds,
                model,
                reasoningEffort,
            });
            const responseArtifacts = [
                ...preparedImages.artifacts,
                ...generation.artifacts,
            ].filter((artifact, index, array) => {
                const artifactId = artifact?.id || '';
                return artifactId && array.findIndex((entry) => entry?.id === artifactId) === index;
            });

            await sessionStore.recordResponse(sessionId, generation.responseId);
            await sessionStore.update(sessionId, {
                metadata: {
                    lastOutputFormat: effectiveOutputFormat,
                    lastGeneratedArtifactId: generation.artifact.id,
                    taskType,
                    clientSurface: clientSurface || taskType,
                    memoryScope,
                },
            });
            memoryService.rememberResponse(
                sessionId,
                generation.assistantMessage,
                buildOwnerMemoryMetadata(ownerId, memoryScope),
            );
            await sessionStore.appendMessages(sessionId, buildWebChatSessionMessages({
                userText: userInput,
                assistantText: generation.assistantMessage,
                toolEvents: preparedImages.toolEvents,
                artifacts: responseArtifacts,
            }));
            await updateSessionProjectMemory(sessionId, {
                userText: userInput,
                assistantText: generation.assistantMessage,
                toolEvents: preparedImages.toolEvents,
                artifacts: responseArtifacts,
            }, ownerId);

            const syntheticResponse = {
                id: generation.responseId,
                object: 'response',
                created_at: Math.floor(Date.now() / 1000),
                model: model || 'gpt-4o',
                output: [{
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: generation.assistantMessage }],
                }],
            };

            completeRuntimeTask(runtimeTask?.id, {
                responseId: generation.responseId,
                output: generation.assistantMessage,
                model: model || null,
                duration: Date.now() - startedAt,
                metadata: {
                    outputFormat: effectiveOutputFormat,
                    artifactDirect: true,
                    toolEvents: preparedImages.toolEvents,
                },
            });

            if (stream) {
                res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: generation.assistantMessage })}\n\n`);
                res.write(`data: ${JSON.stringify({
                    type: 'response.completed',
                    response: syntheticResponse,
                    session_id: sessionId,
                    artifacts: responseArtifacts,
                    tool_events: preparedImages.toolEvents,
                    toolEvents: preparedImages.toolEvents,
                })}\n\n`);
                res.end();
                return;
            }

            res.json({
                ...syntheticResponse,
                session_id: sessionId,
                artifacts: responseArtifacts,
                tool_events: preparedImages.toolEvents,
                toolEvents: preparedImages.toolEvents,
            });
            return;
        }

        const artifactInstructions = effectiveOutputFormat
            ? artifactService.getGenerationInstructions(effectiveOutputFormat)
            : '';
        const fullInstructions = await buildInstructionsWithArtifacts(
            session,
            [buildContinuityInstructions(), instructions || '', artifactInstructions].filter(Boolean).join('\n\n'),
            effectiveArtifactIds,
        );
        const runtimeInput = typeof input === 'string'
            ? effectiveUserInput
            : normalizedInputMessages.map((message, index) => {
                const isLastUser = message.role === 'user'
                    && index === normalizedInputMessages.map((entry) => entry.role).lastIndexOf('user');
                return isLastUser
                    ? { ...message, content: effectiveUserInput }
                    : message;
            });
        const effectiveExecutionProfile = inferExecutionProfile({
            ...req.body,
            taskType,
            input: runtimeInput,
            memoryInput: userInput,
            session,
        });
        const responsesControlState = getSessionControlState(session);
        console.log(`[OpenAICompat] responses routing sessionId=${sessionId} profile=${effectiveExecutionProfile} stickyRemote=${Boolean(responsesControlState?.lastToolIntent || responsesControlState?.lastSshTarget?.host || responsesControlState?.lastRemoteObjective)} lastRemoteObjective=${JSON.stringify(responsesControlState?.lastRemoteObjective || '')}`);

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            setSessionHeaders(res, sessionId);

            const toolManager = await ensureRuntimeToolManager(req.app);
            const execution = await executeConversationRuntime(req.app, {
                input: runtimeInput,
                sessionId,
                memoryInput: userInput,
                loadContextMessages: Boolean(userInput),
                loadRecentMessages: typeof input === 'string' || shouldInjectRecentMessages(input),
                previousResponseId: session.previousResponseId,
                instructions: fullInstructions,
                stream: true,
                model,
                reasoningEffort,
                toolManager,
                toolContext: {
                    sessionId,
                    route: '/v1/responses',
                    transport: 'http',
                    clientSurface,
                    memoryService,
                    ownerId,
                    memoryScope,
                    timezone: requestTimezone,
                    now: requestNow,
                    workloadService: req.app.locals.agentWorkloadService,
                },
                executionProfile: effectiveExecutionProfile,
                enableAutomaticToolCalls: true,
                enableConversationExecutor,
                taskType,
                clientSurface,
                memoryScope,
                metadata: effectiveRequestMetadata,
                ownerId,
            });
            const response = execution.response;

            let fullText = '';
            for await (const event of response) {
                if (event.type === 'response.output_text.delta') {
                    fullText += event.delta;
                    res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: event.delta })}\n\n`);
                }

                if (event.type === 'response.completed') {
                    const completedText = resolveCompletedResponseText(fullText, event.response);
                    const resolvedCompletion = resolveCompatAssistantText({
                        response: event.response,
                        outputText: completedText,
                        userText: userInput,
                    });
                    const missingDelta = getMissingCompletionDelta(fullText, resolvedCompletion.outputText);
                    if (missingDelta) {
                        fullText = resolvedCompletion.outputText;
                        res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: missingDelta })}\n\n`);
                    } else {
                        fullText = resolvedCompletion.outputText;
                    }

                    if (!execution.handledPersistence) {
                        await sessionStore.recordResponse(sessionId, resolvedCompletion.response.id);
                        memoryService.rememberResponse(sessionId, fullText, buildOwnerMemoryMetadata(ownerId, memoryScope));
                    }
                    const sshMetadata = extractSshSessionMetadataFromToolEvents(resolvedCompletion.response?.metadata?.toolEvents);
                    if (sshMetadata) {
                        await sessionStore.update(sessionId, { metadata: sshMetadata });
                    }
                    const artifacts = await maybeGenerateOutputArtifact({
                        sessionId,
                        session,
                        mode: taskType,
                        outputFormat: effectiveOutputFormat,
                        content: fullText,
                        prompt: artifactPrompt,
                        title: 'response-output',
                        responseId: resolvedCompletion.response.id,
                        artifactIds: artifact_ids,
                        model,
                        reasoningEffort,
                    });
                    await updateSessionProjectMemory(sessionId, {
                        userText: userInput,
                        assistantText: fullText,
                        toolEvents: resolvedCompletion.response?.metadata?.toolEvents || [],
                        artifacts,
                    }, ownerId);
                    if (!execution.handledPersistence) {
                        await sessionStore.appendMessages(sessionId, buildWebChatSessionMessages({
                            userText: userInput,
                            assistantText: fullText,
                            toolEvents: resolvedCompletion.response?.metadata?.toolEvents || [],
                            artifacts,
                            assistantMetadata: resolvedCompletion.response?.metadata,
                        }));
                    }
                    completeRuntimeTask(runtimeTask?.id, {
                        responseId: resolvedCompletion.response.id,
                        output: fullText,
                        model: resolvedCompletion.response.model || model || null,
                        duration: Date.now() - startedAt,
                        metadata: resolvedCompletion.response?.metadata || {},
                    });
                    res.write(`data: ${JSON.stringify({
                        type: 'response.completed',
                        response: resolvedCompletion.response,
                        session_id: sessionId,
                        artifacts,
                        assistant_metadata: buildFrontendAssistantMetadata(resolvedCompletion.response?.metadata),
                        assistantMetadata: buildFrontendAssistantMetadata(resolvedCompletion.response?.metadata),
                    })}\n\n`);
                }
            }

            res.end();
            return;
        }

        setSessionHeaders(res, sessionId);
        const runtimeToolManager = await ensureRuntimeToolManager(req.app);
        const execution = await executeConversationRuntime(req.app, {
            input: runtimeInput,
            sessionId,
            memoryInput: userInput,
            loadContextMessages: Boolean(userInput),
            loadRecentMessages: typeof input === 'string' || shouldInjectRecentMessages(input),
            previousResponseId: session.previousResponseId,
            instructions: fullInstructions,
            stream: false,
            model,
            reasoningEffort,
            toolManager: runtimeToolManager,
            toolContext: {
                sessionId,
                route: '/v1/responses',
                transport: 'http',
                clientSurface,
                memoryService,
                ownerId,
                memoryScope,
                timezone: requestTimezone,
                now: requestNow,
                workloadService: req.app.locals.agentWorkloadService,
            },
            executionProfile: effectiveExecutionProfile,
            enableAutomaticToolCalls: true,
            enableConversationExecutor,
            taskType,
            clientSurface,
            memoryScope,
            metadata: effectiveRequestMetadata,
            ownerId,
        });
        let response = execution.response;
        if (!execution.handledPersistence) {
            await sessionStore.recordResponse(sessionId, response.id);
        }
        let outputText = extractResponseText(response);
        const resolvedCompatResponse = resolveCompatAssistantText({
            response,
            outputText,
            userText: userInput,
        });
        response = resolvedCompatResponse.response;
        outputText = resolvedCompatResponse.outputText;
        if (shouldRetryPlaceholderAsRemoteBuild({
            session,
            executionProfile: effectiveExecutionProfile,
            outputText,
            response,
            userText: userInput,
        })) {
            console.warn(`[OpenAICompat] Retrying placeholder direct response as remote-build. sessionId=${sessionId}`);
            const retriedExecution = await executeConversationRuntime(req.app, {
                input: runtimeInput,
                sessionId,
                memoryInput: userInput,
                loadContextMessages: Boolean(userInput),
                loadRecentMessages: typeof input === 'string' || shouldInjectRecentMessages(input),
                previousResponseId: session.previousResponseId,
                instructions: fullInstructions,
                stream: false,
                model,
                reasoningEffort,
                toolManager: runtimeToolManager,
                toolContext: {
                    sessionId,
                    route: '/v1/responses',
                    transport: 'http',
                    clientSurface,
                    memoryService,
                    ownerId,
                    memoryScope,
                    timezone: requestTimezone,
                    now: requestNow,
                    workloadService: req.app.locals.agentWorkloadService,
                },
                executionProfile: 'remote-build',
                enableAutomaticToolCalls: true,
                enableConversationExecutor,
                taskType,
                clientSurface,
                memoryScope,
                metadata: {
                    ...effectiveRequestMetadata,
                    remoteBuildAutonomyApproved: true,
                },
                ownerId,
            });
            response = retriedExecution.response;
            outputText = extractResponseText(response);
        }
        if (!execution.handledPersistence) {
            memoryService.rememberResponse(sessionId, outputText, buildOwnerMemoryMetadata(ownerId, memoryScope));
        }
        const sshMetadata = extractSshSessionMetadataFromToolEvents(response?.metadata?.toolEvents);
        if (sshMetadata) {
            await sessionStore.update(sessionId, { metadata: sshMetadata });
        }
        const artifacts = await maybeGenerateOutputArtifact({
            sessionId,
            session,
            mode: taskType,
            outputFormat: effectiveOutputFormat,
            content: outputText,
            prompt: artifactPrompt,
            title: 'response-output',
            responseId: response.id,
            artifactIds: artifact_ids,
            model,
            reasoningEffort,
        });
        await updateSessionProjectMemory(sessionId, {
            userText: userInput,
            assistantText: outputText,
            toolEvents: response?.metadata?.toolEvents || [],
            artifacts,
        }, ownerId);
        if (!execution.handledPersistence) {
            await sessionStore.appendMessages(sessionId, buildWebChatSessionMessages({
                userText: userInput,
                assistantText: outputText,
                toolEvents: response?.metadata?.toolEvents || [],
                artifacts,
                assistantMetadata: response?.metadata,
            }));
        }
        completeRuntimeTask(runtimeTask?.id, {
            responseId: response.id,
            output: outputText,
            model: response.model || model || null,
            duration: Date.now() - startedAt,
            metadata: response?.metadata || {},
        });

        res.json({
            ...response,
            session_id: sessionId,
            artifacts,
            assistant_metadata: buildFrontendAssistantMetadata(response?.metadata),
            assistantMetadata: buildFrontendAssistantMetadata(response?.metadata),
        });
    } catch (err) {
        failRuntimeTask(runtimeTask?.id, {
            error: err,
            duration: Date.now() - startedAt,
            model: req.body?.model || null,
            metadata: { reasoningEffort: resolveReasoningEffort(req.body) },
        });
        next(err);
    }
});

router.post('/images/generations', async (req, res, next) => {
    try {
        const {
            prompt,
            model = null,
            n = 1,
            size = '1024x1024',
            quality = 'standard',
            style = 'vivid',
        } = req.body;

        let sessionId = resolveSessionId(req);
        const ownerId = getRequestOwnerId(req);
        const requestedSessionMetadata = buildScopedSessionMetadata({
            mode: 'image',
            taskType: 'image',
            clientSurface: resolveClientSurface(req.body, null) || 'image',
        });
        const session = await sessionStore.resolveOwnedSession(
            sessionId,
            requestedSessionMetadata,
            ownerId,
        );
        if (session) {
            sessionId = session.id;
        }
        if (!session) {
            return res.status(404).json({
                error: {
                    message: 'Session not found',
                    type: 'invalid_request_error',
                },
            });
        }

        const response = await generateImage({
            prompt,
            model,
            size,
            quality,
            style,
            n: Math.min(n, 10),
        });
        const persistedImages = await persistGeneratedImages({
            sessionId,
            sourceMode: 'image',
            prompt,
            model: response?.model || model || null,
            images: response?.data || [],
        });
        const normalizedResponse = {
            ...response,
            data: persistedImages.images,
        };

        await sessionStore.recordResponse(sessionId, `img_${Date.now()}`);
        await updateSessionProjectMemory(sessionId, {
            userText: prompt,
            assistantText: `Generated ${Array.isArray(normalizedResponse?.data) ? normalizedResponse.data.length : n} image result(s).`,
            artifacts: persistedImages.artifacts,
            toolEvents: [{
                toolCall: {
                    function: {
                        name: 'image-generate',
                    },
                },
                result: {
                    success: true,
                    toolId: 'image-generate',
                    data: normalizedResponse,
                    error: null,
                },
                reason: 'Image generation request',
            }],
        }, ownerId);
        setSessionHeaders(res, sessionId);

        res.json({
            ...normalizedResponse,
            session_id: sessionId,
            artifacts: persistedImages.artifacts,
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;







