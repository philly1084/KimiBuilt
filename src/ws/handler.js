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
    shouldSuppressWebChatImplicitHtmlArtifact,
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
const { resolveTranscriptObjectiveFromSession } = require('../conversation-continuity');
const { buildProjectMemoryUpdate, mergeProjectMemory } = require('../project-memory');
const { buildContinuityInstructions } = require('../runtime-prompts');
const { buildFrontendAssistantMetadata, buildWebChatSessionMessages } = require('../web-chat-message-state');
const { normalizeMemoryKeywords } = require('../memory/memory-keywords');
const { extractArtifactsFromToolEvents, mergeRuntimeArtifacts } = require('../runtime-artifacts');
const {
    buildUserCheckpointInstructions,
    buildUserCheckpointPolicy,
} = require('../user-checkpoints');
const {
    applyAnsweredUserCheckpointState,
    applyAskedUserCheckpointState,
    buildUserCheckpointPolicyMetadata,
} = require('../web-chat-user-checkpoints');
const {
    buildScopedMemoryMetadata,
    buildScopedSessionMetadata,
    isSessionIsolationEnabled,
    resolveClientSurface,
    resolveSessionScope,
} = require('../session-scope');
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

function buildOwnerMemoryMetadata(ownerId = null, memoryScope = null, extra = {}) {
    return buildScopedMemoryMetadata({
        ...(ownerId ? { ownerId } : {}),
        ...(memoryScope ? { memoryScope } : {}),
        ...extra,
    });
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
                const requestedSessionMetadata = buildScopedSessionMetadata({
                    ...(payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}),
                    mode: type,
                    taskType: type,
                    transport: 'ws',
                    clientSurface: resolveClientSurface(payload || {}, null, type),
                });
                const session = ownerId
                    ? await sessionStore.resolveOwnedSession(
                        requestedSessionId,
                        requestedSessionMetadata,
                        ownerId,
                    )
                    : requestedSessionId
                        ? await sessionStore.getOrCreate(requestedSessionId, requestedSessionMetadata)
                        : await sessionStore.create(requestedSessionMetadata);
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
    const memoryKeywords = normalizeMemoryKeywords(
        payload.memoryKeywords || payload?.metadata?.memoryKeywords || [],
    );
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
        ...(memoryKeywords.length > 0 ? { memoryKeywords } : {}),
    };
    if (!message) {
        ws.send(JSON.stringify({ type: 'error', message: "'message' is required" }));
        return;
    }
    session = await persistSessionModel(session.id, session, model);
    const taskType = resolveConversationTaskType(payload, session);
    const clientSurface = resolveClientSurface(payload || {}, session, taskType);
    const memoryScope = resolveSessionScope({
        ...effectiveRequestMetadata,
        mode: taskType,
        taskType,
        clientSurface,
    }, session);
    const sessionIsolation = isSessionIsolationEnabled(effectiveRequestMetadata, session);
    const answeredCheckpointResult = await applyAnsweredUserCheckpointState(
        sessionStore,
        session.id,
        session,
        message,
    );
    session = answeredCheckpointResult.session;
    const userCheckpointPolicy = buildUserCheckpointPolicy({
        session,
        clientSurface,
    });
    const sshContext = resolveSshRequestContext(message, session);
    const effectiveMessage = sshContext.effectivePrompt || message;
    effectiveRequestMetadata = {
        ...effectiveRequestMetadata,
        clientSurface,
        memoryScope,
        userCheckpointPolicy: buildUserCheckpointPolicyMetadata(userCheckpointPolicy),
        ...(sessionIsolation ? { sessionIsolation: true } : {}),
    };
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
    if (shouldSuppressWebChatImplicitHtmlArtifact({
        clientSurface,
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
            const artifactRecentMessages = await sessionStore.getRecentMessages(
                session.id,
                WORKLOAD_PREFLIGHT_RECENT_LIMIT,
            );
            const artifactRecall = resolveTranscriptObjectiveFromSession(message, artifactRecentMessages);
            const artifactMemory = await memoryService.process(session.id, message, {
                ownerId,
                memoryScope,
                sessionIsolation,
                sourceSurface: clientSurface || taskType,
                memoryKeywords,
                profile: 'default',
                recallQuery: artifactRecall.objective || message,
                objective: artifactRecall.objective || message,
                recentMessages: artifactRecentMessages,
                returnDetails: true,
            });
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
                contextMessages: Array.isArray(artifactMemory)
                    ? artifactMemory
                    : (artifactMemory.contextMessages || []),
                recentMessages: artifactRecentMessages,
                toolManager,
                toolContext: {
                    sessionId: session.id,
                    route: '/ws',
                    transport: 'ws',
                    memoryService,
                    ownerId,
                    clientSurface,
                    memoryScope,
                    sessionIsolation,
                    memoryKeywords,
                    timezone: requestTimezone,
                    now: requestNow,
                    workloadService: ws.app.locals.agentWorkloadService,
                },
                executionProfile,
            });
            const responseArtifacts = mergeRuntimeArtifacts(
                preparedImages.artifacts,
                generation.artifacts,
            );

            await sessionStore.recordResponse(session.id, generation.responseId);
            await sessionStore.update(session.id, {
                metadata: {
                    lastOutputFormat: effectiveOutputFormat,
                    lastGeneratedArtifactId: generation.artifact.id,
                    taskType,
                    clientSurface: clientSurface || taskType,
                    memoryScope,
                },
            });
            memoryService.rememberResponse(
                session.id,
                generation.assistantMessage,
                buildOwnerMemoryMetadata(ownerId, memoryScope, {
                    sourceSurface: clientSurface || taskType,
                    memoryKeywords,
                }),
            );
            await memoryService.rememberArtifactResult(session.id, {
                artifact: generation.artifact,
                summary: generation.assistantMessage,
                sourceText: generation.outputText,
                metadata: buildOwnerMemoryMetadata(ownerId, memoryScope, {
                    sourceSurface: clientSurface || taskType,
                    memoryKeywords,
                    sourcePrompt: message,
                    artifactFormat: effectiveOutputFormat,
                    artifactFilename: generation.artifact?.filename || '',
                }),
            });
            await memoryService.rememberLearnedSkill(session.id, {
                objective: message,
                assistantText: generation.assistantMessage,
                toolEvents: preparedImages.toolEvents,
                artifact: generation.artifact,
                metadata: buildOwnerMemoryMetadata(ownerId, memoryScope, {
                    sourceSurface: clientSurface || taskType,
                    memoryKeywords,
                }),
            });
            await sessionStore.appendMessages(session.id, buildWebChatSessionMessages({
                userText: message,
                assistantText: generation.assistantMessage,
                toolEvents: preparedImages.toolEvents,
                artifacts: responseArtifacts,
            }));
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
                    assistant_metadata: buildFrontendAssistantMetadata({ artifacts: responseArtifacts }),
                    assistantMetadata: buildFrontendAssistantMetadata({ artifacts: responseArtifacts }),
                }));
            return;
        }

        const instructions = await buildInstructionsWithArtifacts(
            session,
            buildContinuityInstructions(buildUserCheckpointInstructions(userCheckpointPolicy)),
            effectiveArtifactIds,
        );
        const execution = await executeConversationRuntime(ws.app, {
            input: effectiveMessage,
            session,
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
                clientSurface,
                memoryScope,
                sessionIsolation,
                memoryKeywords,
                timezone: requestTimezone,
                now: requestNow,
                workloadService: ws.app.locals.agentWorkloadService,
                userCheckpointPolicy,
            },
            executionProfile,
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
                    await sessionStore.recordResponse(
                        session.id,
                        event.response.id,
                        event.response?.metadata?.promptState ? { promptState: event.response.metadata.promptState } : null,
                    );
                    memoryService.rememberResponse(session.id, fullText, buildOwnerMemoryMetadata(ownerId, memoryScope, {
                        sourceSurface: clientSurface || taskType,
                        memoryKeywords,
                    }));
                }
                const sshMetadata = extractSshSessionMetadataFromToolEvents(event.response?.metadata?.toolEvents);
                if (sshMetadata) {
                    await sessionStore.update(session.id, { metadata: sshMetadata });
                }
                session = await persistSessionModel(session.id, session, event.response?.model || model || null);
                session = await applyAskedUserCheckpointState(
                    sessionStore,
                    session.id,
                    session,
                    event.response?.metadata?.toolEvents || [],
                );
                const generatedArtifacts = await maybeGenerateOutputArtifact({
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
                    recentMessages: await sessionStore.getRecentMessages(session.id, WORKLOAD_PREFLIGHT_RECENT_LIMIT),
                });
                const artifacts = mergeRuntimeArtifacts(
                    extractArtifactsFromToolEvents(event.response?.metadata?.toolEvents || []),
                    generatedArtifacts,
                );
                if (artifacts.length > 0) {
                    await Promise.all(artifacts.map((artifact) => memoryService.rememberArtifactResult(session.id, {
                        artifact,
                        summary: `Created the ${artifact.format || effectiveOutputFormat || 'generated'} artifact (${artifact.filename}).`,
                        sourceText: fullText,
                        metadata: buildOwnerMemoryMetadata(ownerId, memoryScope, {
                            sourceSurface: clientSurface || taskType,
                            memoryKeywords,
                            sourcePrompt: message,
                        }),
                    })));
                    await memoryService.rememberLearnedSkill(session.id, {
                        objective: message,
                        assistantText: fullText,
                        toolEvents: event.response?.metadata?.toolEvents || [],
                        artifact: artifacts[artifacts.length - 1],
                        metadata: buildOwnerMemoryMetadata(ownerId, memoryScope, {
                            sourceSurface: clientSurface || taskType,
                            memoryKeywords,
                        }),
                    });
                }
                await updateSessionProjectMemory(session.id, {
                    userText: message,
                    assistantText: fullText,
                    toolEvents: event.response?.metadata?.toolEvents || [],
                    artifacts,
                }, ownerId);
                if (!execution.handledPersistence) {
                    await sessionStore.appendMessages(session.id, buildWebChatSessionMessages({
                        userText: message,
                        assistantText: fullText,
                        toolEvents: event.response?.metadata?.toolEvents || [],
                        artifacts,
                        assistantMetadata: event.response?.metadata,
                    }));
                }
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
                    toolEvents: event.response?.metadata?.toolEvents || [],
                    assistant_metadata: buildFrontendAssistantMetadata({
                        ...(event.response?.metadata || {}),
                        artifacts,
                    }),
                    assistantMetadata: buildFrontendAssistantMetadata({
                        ...(event.response?.metadata || {}),
                        artifacts,
                    }),
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
    const memoryKeywords = normalizeMemoryKeywords(
        payload.memoryKeywords || payload?.metadata?.memoryKeywords || [],
    );
    const reasoningEffort = resolveReasoningEffort(payload);
    const enableConversationExecutor = resolveConversationExecutorFlag(payload);
    const clientSurface = resolveClientSurface(payload || {}, session, 'canvas');
    const memoryScope = resolveSessionScope({
        ...(payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}),
        mode: 'canvas',
        taskType: 'canvas',
        clientSurface,
    }, session);
    const sessionIsolation = isSessionIsolationEnabled(payload?.metadata || {}, session);

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
            session,
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
            clientSurface,
            memoryScope,
            metadata: {
                ...(payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}),
                ...(memoryKeywords.length > 0 ? { memoryKeywords } : {}),
                clientSurface,
            },
            ownerId,
            toolContext: {
                sessionId: session.id,
                route: '/ws',
                transport: 'ws',
                memoryService,
                ownerId,
                clientSurface,
                memoryScope,
                sessionIsolation,
                memoryKeywords,
            },
        });
        const response = execution.response;
        if (!execution.handledPersistence) {
            await sessionStore.recordResponse(
                session.id,
                response.id,
                response?.metadata?.promptState ? { promptState: response.metadata.promptState } : null,
            );
        }

        const outputText = extractResponseText(response);
        if (!execution.handledPersistence) {
            memoryService.rememberResponse(session.id, outputText, buildOwnerMemoryMetadata(ownerId, memoryScope, {
                sourceSurface: clientSurface || 'canvas',
                memoryKeywords,
            }));
            await sessionStore.appendMessages(session.id, [
                { role: 'user', content: message },
                { role: 'assistant', content: outputText },
            ]);
        }
        const generatedArtifacts = await maybeGenerateOutputArtifact({
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
            recentMessages: await sessionStore.getRecentMessages(session.id),
        });
        const artifacts = mergeRuntimeArtifacts(
            extractArtifactsFromToolEvents(response?.metadata?.toolEvents || []),
            generatedArtifacts,
        );
        if (artifacts.length > 0) {
            await Promise.all(artifacts.map((artifact) => memoryService.rememberArtifactResult(session.id, {
                artifact,
                summary: `Created the ${artifact.format || outputFormat || 'generated'} artifact (${artifact.filename}).`,
                sourceText: outputText,
                metadata: buildOwnerMemoryMetadata(ownerId, memoryScope, {
                    sourceSurface: clientSurface || 'canvas',
                    memoryKeywords,
                    sourcePrompt: message,
                }),
            })));
            await memoryService.rememberLearnedSkill(session.id, {
                objective: message,
                assistantText: outputText,
                toolEvents: response?.metadata?.toolEvents || [],
                artifact: artifacts[artifacts.length - 1],
                metadata: buildOwnerMemoryMetadata(ownerId, memoryScope, {
                    sourceSurface: clientSurface || 'canvas',
                    memoryKeywords,
                }),
            });
        }
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
    const memoryKeywords = normalizeMemoryKeywords(
        payload.memoryKeywords || payload?.metadata?.memoryKeywords || [],
    );
    const reasoningEffort = resolveReasoningEffort(payload);
    const enableConversationExecutor = resolveConversationExecutorFlag(payload);
    const clientSurface = resolveClientSurface(payload || {}, session, 'notation');
    const memoryScope = resolveSessionScope({
        ...(payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}),
        mode: 'notation',
        taskType: 'notation',
        clientSurface,
    }, session);
    const sessionIsolation = isSessionIsolationEnabled(payload?.metadata || {}, session);

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
            session,
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
            clientSurface,
            memoryScope,
            metadata: {
                ...(payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}),
                ...(memoryKeywords.length > 0 ? { memoryKeywords } : {}),
                clientSurface,
            },
            ownerId,
            toolContext: {
                sessionId: session.id,
                route: '/ws',
                transport: 'ws',
                memoryService,
                ownerId,
                clientSurface,
                memoryScope,
                sessionIsolation,
                memoryKeywords,
            },
        });
        const response = execution.response;
        if (!execution.handledPersistence) {
            await sessionStore.recordResponse(
                session.id,
                response.id,
                response?.metadata?.promptState ? { promptState: response.metadata.promptState } : null,
            );
        }

        const outputText = extractResponseText(response);
        if (!execution.handledPersistence) {
            memoryService.rememberResponse(session.id, outputText, buildOwnerMemoryMetadata(ownerId, memoryScope, {
                sourceSurface: clientSurface || 'notation',
                memoryKeywords,
            }));
            await sessionStore.appendMessages(session.id, [
                { role: 'user', content: notation },
                { role: 'assistant', content: outputText },
            ]);
        }
        const generatedArtifacts = await maybeGenerateOutputArtifact({
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
            recentMessages: await sessionStore.getRecentMessages(session.id),
        });
        const artifacts = mergeRuntimeArtifacts(
            extractArtifactsFromToolEvents(response?.metadata?.toolEvents || []),
            generatedArtifacts,
        );
        if (artifacts.length > 0) {
            await Promise.all(artifacts.map((artifact) => memoryService.rememberArtifactResult(session.id, {
                artifact,
                summary: `Created the ${artifact.format || outputFormat || 'generated'} artifact (${artifact.filename}).`,
                sourceText: outputText,
                metadata: buildOwnerMemoryMetadata(ownerId, memoryScope, {
                    sourceSurface: clientSurface || 'notation',
                    memoryKeywords,
                    sourcePrompt: notation,
                }),
            })));
            await memoryService.rememberLearnedSkill(session.id, {
                objective: notation,
                assistantText: outputText,
                toolEvents: response?.metadata?.toolEvents || [],
                artifact: artifacts[artifacts.length - 1],
                metadata: buildOwnerMemoryMetadata(ownerId, memoryScope, {
                    sourceSurface: clientSurface || 'notation',
                    memoryKeywords,
                }),
            });
        }
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
