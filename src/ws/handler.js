const { sessionStore } = require('../session-store');
const { memoryService } = require('../memory/memory-service');
const { config } = require('../config');
const { ensureRuntimeToolManager } = require('../runtime-tool-manager');
const { executeConversationRuntime, resolveConversationExecutorFlag } = require('../runtime-execution');
const {
    buildInstructionsWithArtifacts,
    maybeGenerateOutputArtifact,
    generateOutputArtifactFromPrompt,
    inferRequestedOutputFormat,
    maybePrepareImagesForArtifactPrompt,
    resolveDeferredWorkloadPreflight,
    shouldSuppressNotesSurfaceArtifact,
    shouldSuppressImplicitMermaidArtifact,
    resolveSshRequestContext,
    extractSshSessionMetadataFromToolEvents,
    inferOutputFormatFromSession,
    resolveArtifactContextIds,
    resolveReasoningEffort,
} = require('../ai-route-utils');
const {
    extractResponseText,
    resolveCompletedResponseText,
    getMissingCompletionDelta,
} = require('../artifacts/artifact-service');
const { startRuntimeTask, completeRuntimeTask, failRuntimeTask } = require('../admin/runtime-monitor');
const { getAuthenticatedUser, isAuthEnabled } = require('../auth/service');
const { buildProjectMemoryUpdate, mergeProjectMemory } = require('../project-memory');
const { buildContinuityInstructions } = require('../runtime-prompts');
const {
    broadcastToAdmins,
    broadcastToSession,
    registerAdminConnection,
    registerSessionConnection,
    unregisterAdminConnection,
    unregisterSessionConnection,
} = require('../realtime-hub');

// Admin dashboard event emitter
const EventEmitter = require('events');
const adminEvents = new EventEmitter();
const WORKLOAD_PREFLIGHT_RECENT_LIMIT = config.memory.recentTranscriptLimit;

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

    return sessionStore.update(sessionId, {
        metadata: {
            projectMemory: mergeProjectMemory(
                session?.metadata?.projectMemory || {},
                buildProjectMemoryUpdate(updates),
            ),
        },
    });
}

async function persistSessionModel(sessionId, session = null, model = null) {
    const normalizedModel = String(model || '').trim();
    if (!sessionId || !normalizedModel || session?.metadata?.model === normalizedModel) {
        return session;
    }

    const updated = await sessionStore.update(sessionId, {
        metadata: {
            model: normalizedModel,
        },
    });

    return updated || session;
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

    return candidates.find((value) => typeof value === 'string' && value.trim()) || 'chat';
}

function normalizeClientNow(value = '') {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return null;
    }

    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function setupWebSocket(wss, app = null) {
    wss.on('connection', (ws, req) => {
        ws.app = app;
        if (isAuthEnabled()) {
            const authState = getAuthenticatedUser(req);
            if (!authState.authenticated) {
                ws.close(4401, 'Authentication required');
                return;
            }
            ws.user = authState.user;
        } else {
            ws.user = { username: 'anonymous', role: 'open' };
        }

        console.log('[WS] Client connected');

        ws.on('message', async (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                const { type, payload } = msg;
                let { sessionId } = msg;
                const ownerId = String(ws.user?.username || '').trim() || null;

                if (type === 'session_subscribe') {
                    registerSessionConnection(ws, payload?.sessionId || sessionId);
                    ws.send(JSON.stringify({ type: 'session_subscribed', sessionId: payload?.sessionId || sessionId }));
                    return;
                }

                if (type === 'session_unsubscribe') {
                    unregisterSessionConnection(ws, payload?.sessionId || sessionId);
                    ws.send(JSON.stringify({ type: 'session_unsubscribed', sessionId: payload?.sessionId || sessionId }));
                    return;
                }

                if (type === 'admin_subscribe') {
                    handleAdminSubscribe(ws);
                    return;
                }

                if (type === 'admin_unsubscribe') {
                    handleAdminUnsubscribe(ws);
                    return;
                }

                const requestedSessionId = sessionId;
                const session = ownerId
                    ? await sessionStore.resolveOwnedSession(
                        requestedSessionId,
                        { mode: type, transport: 'ws' },
                        ownerId,
                    )
                    : requestedSessionId
                        ? await sessionStore.getOrCreate(requestedSessionId, { mode: type, transport: 'ws' })
                        : await sessionStore.create({ mode: type, transport: 'ws' });
                if (!session) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
                    return;
                }
                sessionId = session.id;
                if (!requestedSessionId) {
                    ws.send(JSON.stringify({ type: 'session_created', sessionId }));
                }

                switch (type) {
                    case 'chat':
                        registerSessionConnection(ws, sessionId);
                        await handleChat(ws, session, payload, app?.locals?.toolManager || null, ownerId);
                        break;
                    case 'canvas':
                        registerSessionConnection(ws, sessionId);
                        await handleCanvas(ws, session, payload, ownerId);
                        break;
                    case 'notation':
                        registerSessionConnection(ws, sessionId);
                        await handleNotation(ws, session, payload, ownerId);
                        break;
                    default:
                        ws.send(JSON.stringify({ type: 'error', message: `Unknown type: ${type}` }));
                }
            } catch (err) {
                console.error('[WS] Error:', err.message);
                ws.send(JSON.stringify({ type: 'error', message: err.message }));
            }
        });

        ws.on('close', () => {
            console.log('[WS] Client disconnected');
            unregisterAdminConnection(ws);
            unregisterSessionConnection(ws);
        });
    });
}

async function handleChat(ws, session, payload = {}, toolManager = null, ownerId = null) {
    let runtimeTask = null;
    const startedAt = Date.now();
    const { message, model = null, artifactIds = [], outputFormat = null, executionProfile = null } = payload;
    const reasoningEffort = resolveReasoningEffort(payload);
    const enableConversationExecutor = resolveConversationExecutorFlag(payload);
    const requestTimezone = String(
        payload?.metadata?.timezone
        || payload?.metadata?.timeZone
        || payload?.timezone
        || '',
    ).trim() || null;
    const requestNow = normalizeClientNow(
        payload?.metadata?.clientNow
        || payload?.metadata?.client_now
        || payload?.clientNow
        || payload?.client_now
        || '',
    );
    let effectiveRequestMetadata = {
        ...(payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}),
        ...(requestTimezone ? { timezone: requestTimezone } : {}),
        ...(requestNow ? { clientNow: requestNow } : {}),
    };
    if (!message) {
        ws.send(JSON.stringify({ type: 'error', message: "'message' is required" }));
        return;
    }
    session = await persistSessionModel(session.id, session, model);

    const sshContext = resolveSshRequestContext(message, session);
    const effectiveMessage = sshContext.effectivePrompt || message;
    const taskType = resolveConversationTaskType(payload, session);
    let effectiveOutputFormat = outputFormat
        || inferRequestedOutputFormat(message)
        || inferOutputFormatFromSession(message, session);
    if (shouldSuppressImplicitMermaidArtifact({
        taskType,
        text: message,
        outputFormat: effectiveOutputFormat,
        outputFormatProvided: Boolean(outputFormat),
    })) {
        effectiveOutputFormat = null;
    }
    if (shouldSuppressNotesSurfaceArtifact({
        taskType,
        text: message,
        outputFormat: effectiveOutputFormat,
        outputFormatProvided: Boolean(outputFormat),
    })) {
        effectiveOutputFormat = null;
    }
    const recentMessagesForWorkloadPreflight = effectiveOutputFormat
        ? await sessionStore.getRecentMessages(session.id, WORKLOAD_PREFLIGHT_RECENT_LIMIT)
        : [];
    const workloadPreflight = resolveDeferredWorkloadPreflight({
        text: message,
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
    const effectiveArtifactIds = resolveArtifactContextIds(session, artifactIds, message);
    runtimeTask = startRuntimeTask({
        sessionId: session.id,
        input: message,
        model,
        mode: 'chat',
        transport: 'ws',
        metadata: { route: '/ws', stream: true, phase: 'preflight', reasoningEffort },
    });

    try {
        const runtimeToolManager = toolManager || await ensureRuntimeToolManager(ws.app);

        if (effectiveOutputFormat) {
            const preparedImages = await maybePrepareImagesForArtifactPrompt({
                toolManager: runtimeToolManager,
                sessionId: session.id,
                route: '/ws',
                transport: 'ws',
                taskType,
                text: message,
                outputFormat: effectiveOutputFormat,
                artifactIds: effectiveArtifactIds,
            });
            const artifactGenerationSession = preparedImages.resetPreviousResponse
                ? { ...session, previousResponseId: null }
                : session;
            const generation = await generateOutputArtifactFromPrompt({
                sessionId: session.id,
                session: artifactGenerationSession,
                mode: taskType,
                outputFormat: effectiveOutputFormat,
                prompt: message,
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

            await sessionStore.recordResponse(session.id, generation.responseId);
            await sessionStore.update(session.id, {
                metadata: {
                    lastOutputFormat: effectiveOutputFormat,
                    lastGeneratedArtifactId: generation.artifact.id,
                    taskType,
                    clientSurface: taskType,
                },
            });
            memoryService.rememberResponse(session.id, generation.assistantMessage, ownerId ? { ownerId } : {});
            await sessionStore.appendMessages(session.id, [
                { role: 'user', content: message },
                { role: 'assistant', content: generation.assistantMessage },
            ]);
            await updateSessionProjectMemory(session.id, {
                userText: message,
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

            ws.send(JSON.stringify({ type: 'delta', content: generation.assistantMessage }));
            ws.send(JSON.stringify({
                type: 'done',
                sessionId: session.id,
                responseId: generation.responseId,
                artifacts: responseArtifacts,
                toolEvents: preparedImages.toolEvents,
            }));
            return;
        }

        const instructions = await buildInstructionsWithArtifacts(
            session,
            buildContinuityInstructions(),
            effectiveArtifactIds,
        );
        const execution = await executeConversationRuntime(ws.app, {
            input: effectiveMessage,
            sessionId: session.id,
            memoryInput: message,
            previousResponseId: session.previousResponseId,
            instructions,
            stream: true,
            model,
            reasoningEffort,
            toolManager: runtimeToolManager,
            toolContext: {
                sessionId: session.id,
                route: '/ws',
                transport: 'ws',
                memoryService,
                ownerId,
                timezone: requestTimezone,
                now: requestNow,
                workloadService: ws.app.locals.agentWorkloadService,
            },
            executionProfile,
            enableAutomaticToolCalls: true,
            enableConversationExecutor,
            taskType,
            metadata: effectiveRequestMetadata,
            ownerId,
        });
        const response = execution.response;

        let fullText = '';

        for await (const event of response) {
            if (event.type === 'response.output_text.delta') {
                fullText += event.delta;
                ws.send(JSON.stringify({ type: 'delta', content: event.delta }));
            }

            if (event.type === 'response.completed') {
                const completedText = resolveCompletedResponseText(fullText, event.response);
                const missingDelta = getMissingCompletionDelta(fullText, completedText);
                if (missingDelta) {
                    fullText = completedText;
                    ws.send(JSON.stringify({ type: 'delta', content: missingDelta }));
                } else {
                    fullText = completedText;
                }

                if (!execution.handledPersistence) {
                    await sessionStore.recordResponse(session.id, event.response.id);
                    memoryService.rememberResponse(session.id, fullText, ownerId ? { ownerId } : {});
                    await sessionStore.appendMessages(session.id, [
                        { role: 'user', content: message },
                        { role: 'assistant', content: fullText },
                    ]);
                }
                const sshMetadata = extractSshSessionMetadataFromToolEvents(event.response?.metadata?.toolEvents);
                if (sshMetadata) {
                    await sessionStore.update(session.id, { metadata: sshMetadata });
                }
                session = await persistSessionModel(session.id, session, event.response?.model || model || null);
                const artifacts = await maybeGenerateOutputArtifact({
                    sessionId: session.id,
                    session,
                    mode: taskType,
                    outputFormat: effectiveOutputFormat,
                    content: fullText,
                    prompt: message,
                    title: 'chat-output',
                    responseId: event.response.id,
                    artifactIds,
                    model,
                    reasoningEffort,
                });
                await updateSessionProjectMemory(session.id, {
                    userText: message,
                    assistantText: fullText,
                    toolEvents: event.response?.metadata?.toolEvents || [],
                    artifacts,
                }, ownerId);
                completeRuntimeTask(runtimeTask?.id, {
                    responseId: event.response.id,
                    output: fullText,
                    model: event.response.model || model || null,
                    duration: Date.now() - startedAt,
                    metadata: event.response?.metadata || {},
                });
                ws.send(JSON.stringify({
                    type: 'done',
                    sessionId: session.id,
                    responseId: event.response.id,
                    artifacts,
                }));
            }
        }
    } catch (error) {
        failRuntimeTask(runtimeTask?.id, {
            error,
            duration: Date.now() - startedAt,
            model,
        });
        throw error;
    }
}

async function handleCanvas(ws, session, payload = {}, ownerId = null) {
    let runtimeTask = null;
    const startedAt = Date.now();
    const {
        message,
        canvasType = 'document',
        existingContent = '',
        model = null,
        artifactIds = [],
        outputFormat = null,
        executionProfile = null,
    } = payload;
    const reasoningEffort = resolveReasoningEffort(payload);
    const enableConversationExecutor = resolveConversationExecutorFlag(payload);

    if (!message) {
        ws.send(JSON.stringify({ type: 'error', message: "'message' is required" }));
        return;
    }

    runtimeTask = startRuntimeTask({
        sessionId: session.id,
        input: message,
        model,
        mode: 'canvas',
        transport: 'ws',
        metadata: { route: '/ws', canvasType, phase: 'preflight', reasoningEffort },
    });

    try {
        const instructions = await buildInstructionsWithArtifacts(
            session,
            `You are an AI canvas assistant generating ${canvasType} content. Respond with valid JSON: { "content": "...", "metadata": {...}, "suggestions": [...] }${existingContent ? `\n\nExisting content:\n${existingContent}` : ''}`,
            artifactIds,
        );
        const execution = await executeConversationRuntime(ws.app, {
            input: existingContent ? `${message}\n\nExisting content:\n${existingContent}` : message,
            sessionId: session.id,
            memoryInput: message,
            previousResponseId: session.previousResponseId,
            instructions,
            stream: false,
            model,
            reasoningEffort,
            executionProfile,
            enableConversationExecutor,
            taskType: 'canvas',
            ownerId,
        });
        const response = execution.response;
        if (!execution.handledPersistence) {
            await sessionStore.recordResponse(session.id, response.id);
        }

        const outputText = extractResponseText(response);
        if (!execution.handledPersistence) {
            memoryService.rememberResponse(session.id, outputText, ownerId ? { ownerId } : {});
            await sessionStore.appendMessages(session.id, [
                { role: 'user', content: message },
                { role: 'assistant', content: outputText },
            ]);
        }
        const artifacts = await maybeGenerateOutputArtifact({
            sessionId: session.id,
            session,
            mode: 'canvas',
            outputFormat,
            content: outputText,
            prompt: message,
            title: `canvas-${canvasType}`,
            responseId: response.id,
            artifactIds,
            existingContent,
            model,
            reasoningEffort,
        });
        completeRuntimeTask(runtimeTask?.id, {
            responseId: response.id,
            output: outputText,
            model: response.model || model || null,
            duration: Date.now() - startedAt,
            metadata: {
                canvasType,
                ...(response?.metadata || {}),
            },
        });

        ws.send(JSON.stringify({
            type: 'done',
            sessionId: session.id,
            responseId: response.id,
            canvasType,
            content: outputText,
            artifacts,
        }));
    } catch (error) {
        failRuntimeTask(runtimeTask?.id, {
            error,
            duration: Date.now() - startedAt,
            model,
            metadata: { canvasType },
        });
        throw error;
    }
}

async function handleNotation(ws, session, payload = {}, ownerId = null) {
    let runtimeTask = null;
    const startedAt = Date.now();
    const {
        notation,
        helperMode = 'expand',
        context = '',
        model = null,
        artifactIds = [],
        outputFormat = null,
        executionProfile = null,
    } = payload;
    const reasoningEffort = resolveReasoningEffort(payload);
    const enableConversationExecutor = resolveConversationExecutorFlag(payload);

    if (!notation) {
        ws.send(JSON.stringify({ type: 'error', message: "'notation' is required" }));
        return;
    }

    runtimeTask = startRuntimeTask({
        sessionId: session.id,
        input: notation,
        model,
        mode: 'notation',
        transport: 'ws',
        metadata: { route: '/ws', helperMode, phase: 'preflight', reasoningEffort },
    });

    try {
        const instructions = await buildInstructionsWithArtifacts(
            session,
            `You are an AI notation helper in ${helperMode} mode. Respond with valid JSON: { "result": "...", "annotations": [...], "suggestions": [...] }${context ? `\nContext: ${context}` : ''}`,
            artifactIds,
        );
        const execution = await executeConversationRuntime(ws.app, {
            input: notation,
            sessionId: session.id,
            memoryInput: notation,
            previousResponseId: session.previousResponseId,
            instructions,
            stream: false,
            model,
            reasoningEffort,
            executionProfile,
            enableConversationExecutor,
            taskType: 'notation',
            ownerId,
        });
        const response = execution.response;
        if (!execution.handledPersistence) {
            await sessionStore.recordResponse(session.id, response.id);
        }

        const outputText = extractResponseText(response);
        if (!execution.handledPersistence) {
            memoryService.rememberResponse(session.id, outputText, ownerId ? { ownerId } : {});
            await sessionStore.appendMessages(session.id, [
                { role: 'user', content: notation },
                { role: 'assistant', content: outputText },
            ]);
        }
        const artifacts = await maybeGenerateOutputArtifact({
            sessionId: session.id,
            session,
            mode: 'notation',
            outputFormat,
            content: outputText,
            prompt: notation,
            title: `notation-${helperMode}`,
            responseId: response.id,
            artifactIds,
            existingContent: context,
            model,
            reasoningEffort,
        });
        completeRuntimeTask(runtimeTask?.id, {
            responseId: response.id,
            output: outputText,
            model: response.model || model || null,
            duration: Date.now() - startedAt,
            metadata: {
                helperMode,
                ...(response?.metadata || {}),
            },
        });

        ws.send(JSON.stringify({
            type: 'done',
            sessionId: session.id,
            responseId: response.id,
            helperMode,
            content: outputText,
            artifacts,
        }));
    } catch (error) {
        failRuntimeTask(runtimeTask?.id, {
            error,
            duration: Date.now() - startedAt,
            model,
            metadata: { helperMode },
        });
        throw error;
    }
}

// Admin WebSocket handlers
function handleAdminSubscribe(ws) {
    registerAdminConnection(ws);
    ws.isAdmin = true;
    
    // Send initial stats
    ws.send(JSON.stringify({
        type: 'admin_connected',
        timestamp: new Date().toISOString()
    }));
    
    console.log('[WS] Admin client subscribed.');
}

function handleAdminUnsubscribe(ws) {
    unregisterAdminConnection(ws);
    ws.isAdmin = false;
    console.log('[WS] Admin client unsubscribed.');
}

// Admin event helpers
function emitTaskEvent(eventType, data) {
    broadcastToAdmins({
        type: 'task_event',
        event: eventType,
        data,
        timestamp: new Date().toISOString()
    });
}

function emitLogEvent(logEntry) {
    broadcastToAdmins({
        type: 'log_event',
        data: logEntry,
        timestamp: new Date().toISOString()
    });
}

function emitStatsUpdate(stats) {
    broadcastToAdmins({
        type: 'stats_update',
        data: stats,
        timestamp: new Date().toISOString()
    });
}

module.exports = { 
    setupWebSocket,
    adminEvents,
    broadcastToSession,
    broadcastToAdmins,
    emitTaskEvent,
    emitLogEvent,
    emitStatsUpdate
};
