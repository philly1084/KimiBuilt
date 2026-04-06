const { Router } = require('express');
const { config } = require('../config');
const { validate } = require('../middleware/validate');
const { sessionStore } = require('../session-store');
const { memoryService } = require('../memory/memory-service');
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
    stripInjectedNotesPageEditDirective,
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
const { buildProjectMemoryUpdate, mergeProjectMemory } = require('../project-memory');
const { buildContinuityInstructions } = require('../runtime-prompts');
const { buildFrontendAssistantMetadata, buildWebChatSessionMessages } = require('../web-chat-message-state');
const { normalizeMemoryKeywords } = require('../memory/memory-keywords');
const {
    buildScopedSessionMetadata,
    resolveClientSurface,
    resolveSessionScope,
} = require('../session-scope');

const router = Router();
const WORKLOAD_PREFLIGHT_RECENT_LIMIT = config.memory.recentTranscriptLimit;

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

function buildOwnerMemoryMetadata(ownerId = null, memoryScope = null, extra = {}) {
    return {
        ...(ownerId ? { ownerId } : {}),
        ...(memoryScope ? { memoryScope } : {}),
        ...extra,
    };
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

const chatSchema = {
    message: { required: true, type: 'string' },
    sessionId: { required: false, type: 'string' },
    stream: { required: false, type: 'boolean' },
    model: { required: false, type: 'string' },
    reasoningEffort: { required: false, type: 'string', enum: ['low', 'medium', 'high', 'xhigh'] },
    reasoning_effort: { required: false, type: 'string', enum: ['low', 'medium', 'high', 'xhigh'] },
    reasoning: { required: false, type: 'object' },
    artifactIds: { required: false, type: 'array' },
    outputFormat: { required: false, type: 'string' },
    enableConversationExecutor: { required: false, type: 'boolean' },
    useAgentExecutor: { required: false, type: 'boolean' },
    executionProfile: { required: false, type: 'string' },
    metadata: { required: false, type: 'object' },
    memoryKeywords: { required: false, type: 'array' },
};

function resolveConversationTaskType(metadata = {}, session = null) {
    const candidates = [
        metadata?.taskType,
        metadata?.task_type,
        metadata?.clientSurface,
        metadata?.client_surface,
        session?.metadata?.taskType,
        session?.metadata?.task_type,
        session?.metadata?.clientSurface,
        session?.metadata?.client_surface,
    ];

    return candidates.find((value) => typeof value === 'string' && value.trim()) || 'chat';
}

router.post('/', validate(chatSchema), async (req, res, next) => {
    let runtimeTask = null;
    const startedAt = Date.now();
    try {
        const {
            message,
            stream = true,
            model = null,
            reasoning: _ignoredReasoning = null,
            artifactIds = [],
            outputFormat = null,
            executionProfile = null,
            metadata: requestMetadata = {},
        } = req.body;
        const reasoningEffort = resolveReasoningEffort(req.body);
        const enableConversationExecutor = resolveConversationExecutorFlag(req.body);
        let { sessionId } = req.body;
        const memoryKeywords = normalizeMemoryKeywords(
            req.body.memoryKeywords || req.body?.metadata?.memoryKeywords || [],
        );
        const requestedTaskType = resolveConversationTaskType(requestMetadata);
        const ownerId = getRequestOwnerId(req);
        const requestTimezone = String(
            requestMetadata?.timezone
            || requestMetadata?.timeZone
            || req.get('x-timezone')
            || '',
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
            ...(memoryKeywords.length > 0 ? { memoryKeywords } : {}),
        };
        const requestedClientSurface = resolveClientSurface(req.body || {}, null, requestedTaskType);
        const requestedSessionMetadata = buildScopedSessionMetadata({
            ...effectiveRequestMetadata,
            mode: requestedTaskType,
            taskType: requestedTaskType,
            clientSurface: requestedClientSurface,
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
            return res.status(404).json({ error: { message: 'Session not found' } });
        }
        let effectiveSession = await persistSessionModel(sessionId, session, model);

        const sshContext = resolveSshRequestContext(message, effectiveSession);
        const effectiveMessage = sshContext.effectivePrompt || message;
        const clientSurface = resolveClientSurface(req.body || {}, session, requestedTaskType);
        const taskType = resolveConversationTaskType(requestMetadata, session);
        const memoryScope = resolveSessionScope({
            ...requestedSessionMetadata,
            taskType,
            clientSurface,
        }, session);
        const artifactIntentText = stripInjectedNotesPageEditDirective(message);
        effectiveRequestMetadata = {
            ...effectiveRequestMetadata,
            clientSurface,
            memoryScope,
        };
        let effectiveOutputFormat = outputFormat
            || inferRequestedOutputFormat(artifactIntentText)
            || inferOutputFormatFromSession(artifactIntentText, session);
        if (shouldSuppressImplicitMermaidArtifact({
            taskType,
            text: artifactIntentText,
            outputFormat: effectiveOutputFormat,
            outputFormatProvided: Boolean(outputFormat),
        })) {
            effectiveOutputFormat = null;
        }
        if (shouldSuppressNotesSurfaceArtifact({
            taskType,
            text: artifactIntentText,
            outputFormat: effectiveOutputFormat,
            outputFormatProvided: Boolean(outputFormat),
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
        const effectiveArtifactIds = resolveArtifactContextIds(session, artifactIds, message);
        runtimeTask = startRuntimeTask({
            sessionId,
            input: message,
            model: model || session?.metadata?.model || null,
            mode: 'chat',
            transport: 'http',
            metadata: { route: '/api/chat', stream, phase: 'preflight', reasoningEffort },
        });

        if (effectiveOutputFormat) {
            const toolManager = await ensureRuntimeToolManager(req.app);
            const artifactMemory = await memoryService.process(sessionId, message, {
                ownerId,
                memoryScope,
                sourceSurface: clientSurface || taskType,
                memoryKeywords,
                profile: 'default',
                returnDetails: true,
            });
            const artifactRecentMessages = await sessionStore.getRecentMessages(
                sessionId,
                WORKLOAD_PREFLIGHT_RECENT_LIMIT,
            );
            const preparedImages = await maybePrepareImagesForArtifactPrompt({
                toolManager,
                sessionId,
                route: '/api/chat',
                transport: 'http',
                taskType,
                text: message,
                outputFormat: effectiveOutputFormat,
                artifactIds: effectiveArtifactIds,
            });
            const artifactGenerationSession = preparedImages.resetPreviousResponse
                ? { ...effectiveSession, previousResponseId: null }
                : effectiveSession;
            const generationArtifacts = await generateOutputArtifactFromPrompt({
                sessionId,
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
            });
            const responseArtifacts = [
                ...preparedImages.artifacts,
                ...generationArtifacts.artifacts,
            ].filter((artifact, index, array) => {
                const artifactId = artifact?.id || '';
                return artifactId && array.findIndex((entry) => entry?.id === artifactId) === index;
            });

            if (stream) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.setHeader('X-Session-Id', sessionId);
            }

            await sessionStore.recordResponse(sessionId, generationArtifacts.responseId);
            await sessionStore.update(sessionId, {
                metadata: {
                    lastOutputFormat: effectiveOutputFormat,
                    lastGeneratedArtifactId: generationArtifacts.artifact.id,
                    taskType,
                    clientSurface: clientSurface || taskType,
                    memoryScope,
                },
            });
            memoryService.rememberResponse(
                sessionId,
                generationArtifacts.assistantMessage,
                buildOwnerMemoryMetadata(ownerId, memoryScope, {
                    sourceSurface: clientSurface || taskType,
                    memoryKeywords,
                }),
            );
            await memoryService.rememberArtifactResult(sessionId, {
                artifact: generationArtifacts.artifact,
                summary: generationArtifacts.assistantMessage,
                sourceText: generationArtifacts.outputText,
                metadata: buildOwnerMemoryMetadata(ownerId, memoryScope, {
                    sourceSurface: clientSurface || taskType,
                    memoryKeywords,
                    sourcePrompt: message,
                    artifactFormat: effectiveOutputFormat,
                    artifactFilename: generationArtifacts.artifact?.filename || '',
                }),
            });
            await memoryService.rememberLearnedSkill(sessionId, {
                objective: message,
                assistantText: generationArtifacts.assistantMessage,
                toolEvents: preparedImages.toolEvents,
                artifact: generationArtifacts.artifact,
                metadata: buildOwnerMemoryMetadata(ownerId, memoryScope, {
                    sourceSurface: clientSurface || taskType,
                    memoryKeywords,
                }),
            });
            await sessionStore.appendMessages(sessionId, buildWebChatSessionMessages({
                userText: message,
                assistantText: generationArtifacts.assistantMessage,
                toolEvents: preparedImages.toolEvents,
                artifacts: responseArtifacts,
            }));
            await updateSessionProjectMemory(sessionId, {
                userText: message,
                assistantText: generationArtifacts.assistantMessage,
                toolEvents: preparedImages.toolEvents,
                artifacts: responseArtifacts,
            }, ownerId);

            completeRuntimeTask(runtimeTask?.id, {
                responseId: generationArtifacts.responseId,
                output: generationArtifacts.assistantMessage,
                model: model || session?.metadata?.model || null,
                duration: Date.now() - startedAt,
                metadata: {
                    outputFormat: effectiveOutputFormat,
                    artifactDirect: true,
                    toolEvents: preparedImages.toolEvents,
                },
            });

            if (stream) {
                res.write(`data: ${JSON.stringify({ type: 'delta', content: generationArtifacts.assistantMessage })}\n\n`);
                res.write(`data: ${JSON.stringify({
                    type: 'done',
                    sessionId,
                    responseId: generationArtifacts.responseId,
                    artifacts: responseArtifacts,
                    toolEvents: preparedImages.toolEvents,
                })}\n\n`);
                res.end();
                return;
            }

            res.json({
                sessionId,
                responseId: generationArtifacts.responseId,
                message: generationArtifacts.assistantMessage,
                artifacts: responseArtifacts,
                toolEvents: preparedImages.toolEvents,
            });
            return;
        }

        const instructions = await buildInstructionsWithArtifacts(
            session,
            buildContinuityInstructions(),
            effectiveArtifactIds,
        );

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Session-Id', sessionId);

            const toolManager = await ensureRuntimeToolManager(req.app);

            const execution = await executeConversationRuntime(req.app, {
                input: effectiveMessage,
                session,
                sessionId,
                memoryInput: message,
                previousResponseId: session.previousResponseId,
                instructions,
                stream: true,
                model,
                reasoningEffort,
                toolManager,
                toolContext: {
                    sessionId,
                    route: '/api/chat',
                    transport: 'http',
                    memoryService,
                    ownerId,
                    clientSurface,
                    memoryScope,
                    memoryKeywords,
                    timezone: requestTimezone,
                    now: requestNow,
                    workloadService: req.app.locals.agentWorkloadService,
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
                    res.write(`data: ${JSON.stringify({ type: 'delta', content: event.delta })}\n\n`);
                }

                if (event.type === 'response.completed') {
                    const completedText = resolveCompletedResponseText(fullText, event.response);
                    const missingDelta = getMissingCompletionDelta(fullText, completedText);
                    if (missingDelta) {
                        fullText = completedText;
                        res.write(`data: ${JSON.stringify({ type: 'delta', content: missingDelta })}\n\n`);
                    } else {
                        fullText = completedText;
                    }

                    const toolEvents = event.response?.metadata?.toolEvents || [];
                    if (!execution.handledPersistence) {
                        await sessionStore.recordResponse(
                            sessionId,
                            event.response.id,
                            event.response?.metadata?.promptState ? { promptState: event.response.metadata.promptState } : null,
                        );
                        memoryService.rememberResponse(sessionId, fullText, buildOwnerMemoryMetadata(ownerId, memoryScope, {
                            sourceSurface: clientSurface || taskType,
                            memoryKeywords,
                        }));
                    }
                    const sshMetadata = extractSshSessionMetadataFromToolEvents(event.response?.metadata?.toolEvents);
                    if (sshMetadata) {
                        await sessionStore.update(sessionId, { metadata: sshMetadata });
                    }
            effectiveSession = await persistSessionModel(sessionId, effectiveSession, event.response?.model || model || null);
            const artifacts = await maybeGenerateOutputArtifact({
                sessionId,
                session: effectiveSession,
                        mode: taskType,
                        outputFormat: effectiveOutputFormat,
                        content: fullText,
                        prompt: message,
                        title: 'chat-output',
                        responseId: event.response.id,
                        artifactIds,
                        model,
                        reasoningEffort,
                        recentMessages: await sessionStore.getRecentMessages(sessionId, WORKLOAD_PREFLIGHT_RECENT_LIMIT),
                    });
                    if (artifacts.length > 0) {
                        await Promise.all(artifacts.map((artifact) => memoryService.rememberArtifactResult(sessionId, {
                            artifact,
                            summary: `Created the ${artifact.format || effectiveOutputFormat || 'generated'} artifact (${artifact.filename}).`,
                            sourceText: fullText,
                            metadata: buildOwnerMemoryMetadata(ownerId, memoryScope, {
                                sourceSurface: clientSurface || taskType,
                                memoryKeywords,
                                sourcePrompt: message,
                            }),
                        })));
                        await memoryService.rememberLearnedSkill(sessionId, {
                            objective: message,
                            assistantText: fullText,
                            toolEvents,
                            artifact: artifacts[artifacts.length - 1],
                            metadata: buildOwnerMemoryMetadata(ownerId, memoryScope, {
                                sourceSurface: clientSurface || taskType,
                                memoryKeywords,
                            }),
                        });
                    }
                    await updateSessionProjectMemory(sessionId, {
                        userText: message,
                        assistantText: fullText,
                        toolEvents,
                        artifacts,
                    }, ownerId);
                    if (!execution.handledPersistence) {
                        await sessionStore.appendMessages(sessionId, buildWebChatSessionMessages({
                            userText: message,
                            assistantText: fullText,
                            toolEvents,
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
                    res.write(`data: ${JSON.stringify({
                        type: 'done',
                        sessionId,
                        responseId: event.response.id,
                        artifacts,
                        toolEvents,
                        assistant_metadata: buildFrontendAssistantMetadata(event.response?.metadata),
                        assistantMetadata: buildFrontendAssistantMetadata(event.response?.metadata),
                    })}\n\n`);
                }
            }

            res.end();
            return;
        }

        const runtimeToolManager = await ensureRuntimeToolManager(req.app);
        const execution = await executeConversationRuntime(req.app, {
            input: effectiveMessage,
            session,
            sessionId,
            memoryInput: message,
            previousResponseId: session.previousResponseId,
            instructions,
            stream: false,
            model,
            reasoningEffort,
            toolManager: runtimeToolManager,
            toolContext: {
                sessionId,
                route: '/api/chat',
                transport: 'http',
                memoryService,
                ownerId,
                clientSurface,
                memoryScope,
                memoryKeywords,
                timezone: requestTimezone,
                now: requestNow,
                workloadService: req.app.locals.agentWorkloadService,
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
        if (!execution.handledPersistence) {
            await sessionStore.recordResponse(
                sessionId,
                response.id,
                response?.metadata?.promptState ? { promptState: response.metadata.promptState } : null,
            );
        }

        const outputText = extractResponseText(response);
        if (!execution.handledPersistence) {
            memoryService.rememberResponse(sessionId, outputText, buildOwnerMemoryMetadata(ownerId, memoryScope, {
                sourceSurface: clientSurface || taskType,
                memoryKeywords,
            }));
        }
        const sshMetadata = extractSshSessionMetadataFromToolEvents(response?.metadata?.toolEvents);
        if (sshMetadata) {
            await sessionStore.update(sessionId, { metadata: sshMetadata });
        }
        effectiveSession = await persistSessionModel(sessionId, effectiveSession, response.model || model || null);
        const artifacts = await maybeGenerateOutputArtifact({
            sessionId,
            session: effectiveSession,
            mode: taskType,
            outputFormat: effectiveOutputFormat,
            content: outputText,
            prompt: message,
            title: 'chat-output',
            responseId: response.id,
            artifactIds,
            model,
            reasoningEffort,
            recentMessages: await sessionStore.getRecentMessages(sessionId, WORKLOAD_PREFLIGHT_RECENT_LIMIT),
        });
        if (artifacts.length > 0) {
            await Promise.all(artifacts.map((artifact) => memoryService.rememberArtifactResult(sessionId, {
                artifact,
                summary: `Created the ${artifact.format || effectiveOutputFormat || 'generated'} artifact (${artifact.filename}).`,
                sourceText: outputText,
                metadata: buildOwnerMemoryMetadata(ownerId, memoryScope, {
                    sourceSurface: clientSurface || taskType,
                    memoryKeywords,
                    sourcePrompt: message,
                }),
            })));
            await memoryService.rememberLearnedSkill(sessionId, {
                objective: message,
                assistantText: outputText,
                toolEvents: response?.metadata?.toolEvents || [],
                artifact: artifacts[artifacts.length - 1],
                metadata: buildOwnerMemoryMetadata(ownerId, memoryScope, {
                    sourceSurface: clientSurface || taskType,
                    memoryKeywords,
                }),
            });
        }
        await updateSessionProjectMemory(sessionId, {
            userText: message,
            assistantText: outputText,
            toolEvents: response?.metadata?.toolEvents || [],
            artifacts,
        }, ownerId);
        if (!execution.handledPersistence) {
            await sessionStore.appendMessages(sessionId, buildWebChatSessionMessages({
                userText: message,
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
            sessionId,
            responseId: response.id,
            message: outputText,
            artifacts,
            toolEvents: response?.metadata?.toolEvents || [],
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

module.exports = router;
