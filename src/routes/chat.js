const { Router } = require('express');
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
    shouldSuppressImplicitMermaidArtifact,
    resolveSshRequestContext,
    extractSshSessionMetadataFromToolEvents,
    inferOutputFormatFromSession,
    resolveArtifactContextIds,
} = require('../ai-route-utils');
const { startRuntimeTask, completeRuntimeTask, failRuntimeTask } = require('../admin/runtime-monitor');
const { buildProjectMemoryUpdate, mergeProjectMemory } = require('../project-memory');
const { buildContinuityInstructions } = require('../runtime-prompts');

const router = Router();

async function updateSessionProjectMemory(sessionId, updates = {}) {
    if (!sessionId) {
        return null;
    }

    const session = await sessionStore.get(sessionId);
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
    artifactIds: { required: false, type: 'array' },
    outputFormat: { required: false, type: 'string' },
    enableConversationExecutor: { required: false, type: 'boolean' },
    useAgentExecutor: { required: false, type: 'boolean' },
    executionProfile: { required: false, type: 'string' },
    metadata: { required: false, type: 'object' },
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
            artifactIds = [],
            outputFormat = null,
            executionProfile = null,
            metadata: requestMetadata = {},
        } = req.body;
        const enableConversationExecutor = resolveConversationExecutorFlag(req.body);
        let { sessionId } = req.body;

        let session;
        if (!sessionId) {
            session = await sessionStore.create({ mode: 'chat' });
            sessionId = session.id;
        } else {
            session = await sessionStore.getOrCreate(sessionId, { mode: 'chat' });
        }

        if (!session) {
            session = await sessionStore.get(sessionId);
        }
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }

        const sshContext = resolveSshRequestContext(message, session);
        const effectiveMessage = sshContext.effectivePrompt || message;
        const taskType = resolveConversationTaskType(requestMetadata, session);
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
        const effectiveArtifactIds = resolveArtifactContextIds(session, artifactIds);
        runtimeTask = startRuntimeTask({
            sessionId,
            input: message,
            model: model || session?.metadata?.model || null,
            mode: 'chat',
            transport: 'http',
            metadata: { route: '/api/chat', stream, phase: 'preflight' },
        });

        if (effectiveOutputFormat) {
            if (stream) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.setHeader('X-Session-Id', sessionId);
            }

            const generation = await generateOutputArtifactFromPrompt({
                sessionId,
                session,
                mode: 'chat',
                outputFormat: effectiveOutputFormat,
                prompt: message,
                artifactIds: effectiveArtifactIds,
                model,
            });

            await sessionStore.recordResponse(sessionId, generation.responseId);
            await sessionStore.update(sessionId, {
                metadata: {
                    lastOutputFormat: effectiveOutputFormat,
                    lastGeneratedArtifactId: generation.artifact.id,
                },
            });
            memoryService.rememberResponse(sessionId, generation.assistantMessage);
            await sessionStore.appendMessages(sessionId, [
                { role: 'user', content: message },
                { role: 'assistant', content: generation.assistantMessage },
            ]);
            await updateSessionProjectMemory(sessionId, {
                userText: message,
                assistantText: generation.assistantMessage,
                artifacts: generation.artifacts,
            });

            completeRuntimeTask(runtimeTask?.id, {
                responseId: generation.responseId,
                output: generation.assistantMessage,
                model: model || session?.metadata?.model || null,
                duration: Date.now() - startedAt,
                metadata: { outputFormat: effectiveOutputFormat, artifactDirect: true },
            });

            if (stream) {
                res.write(`data: ${JSON.stringify({ type: 'delta', content: generation.assistantMessage })}\n\n`);
                res.write(`data: ${JSON.stringify({
                    type: 'done',
                    sessionId,
                    responseId: generation.responseId,
                    artifacts: generation.artifacts,
                    toolEvents: [],
                })}\n\n`);
                res.end();
                return;
            }

            res.json({
                sessionId,
                responseId: generation.responseId,
                message: generation.assistantMessage,
                artifacts: generation.artifacts,
                toolEvents: [],
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
                sessionId,
                memoryInput: message,
                previousResponseId: session.previousResponseId,
                instructions,
                stream: true,
                model,
                toolManager,
                toolContext: {
                    sessionId,
                    route: '/api/chat',
                    transport: 'http',
                },
                executionProfile,
                enableAutomaticToolCalls: true,
                enableConversationExecutor,
                taskType: 'chat',
                metadata: requestMetadata,
            });
            const response = execution.response;

            let fullText = '';

            for await (const event of response) {
                if (event.type === 'response.output_text.delta') {
                    fullText += event.delta;
                    res.write(`data: ${JSON.stringify({ type: 'delta', content: event.delta })}\n\n`);
                }

                if (event.type === 'response.completed') {
                    const toolEvents = event.response?.metadata?.toolEvents || [];
                    if (!execution.handledPersistence) {
                        await sessionStore.recordResponse(sessionId, event.response.id);
                        memoryService.rememberResponse(sessionId, fullText);
                        await sessionStore.appendMessages(sessionId, [
                            { role: 'user', content: message },
                            { role: 'assistant', content: fullText },
                        ]);
                    }
                    const sshMetadata = extractSshSessionMetadataFromToolEvents(event.response?.metadata?.toolEvents);
                    if (sshMetadata) {
                        await sessionStore.update(sessionId, { metadata: sshMetadata });
                    }
                    const artifacts = await maybeGenerateOutputArtifact({
                        sessionId,
                        session,
                        mode: 'chat',
                        outputFormat: effectiveOutputFormat,
                        content: fullText,
                        prompt: message,
                        title: 'chat-output',
                        responseId: event.response.id,
                        artifactIds,
                        model,
                    });
                    await updateSessionProjectMemory(sessionId, {
                        userText: message,
                        assistantText: fullText,
                        toolEvents,
                        artifacts,
                    });
                    completeRuntimeTask(runtimeTask?.id, {
                        responseId: event.response.id,
                        output: fullText,
                        model: event.response.model || model || null,
                        duration: Date.now() - startedAt,
                        metadata: event.response?.metadata || {},
                    });
                    res.write(`data: ${JSON.stringify({ type: 'done', sessionId, responseId: event.response.id, artifacts, toolEvents })}\n\n`);
                }
            }

            res.end();
            return;
        }

        const runtimeToolManager = await ensureRuntimeToolManager(req.app);
        const execution = await executeConversationRuntime(req.app, {
            input: effectiveMessage,
            sessionId,
            memoryInput: message,
            previousResponseId: session.previousResponseId,
            instructions,
            stream: false,
            model,
            toolManager: runtimeToolManager,
            toolContext: {
                sessionId,
                route: '/api/chat',
                transport: 'http',
            },
            executionProfile,
            enableAutomaticToolCalls: true,
            enableConversationExecutor,
            taskType: 'chat',
            metadata: requestMetadata,
        });
        const response = execution.response;
        if (!execution.handledPersistence) {
            await sessionStore.recordResponse(sessionId, response.id);
        }

        const outputText = response.output
            .filter((item) => item.type === 'message')
            .map((item) => item.content.map((content) => content.text).join(''))
            .join('\n');
        if (!execution.handledPersistence) {
            memoryService.rememberResponse(sessionId, outputText);
            await sessionStore.appendMessages(sessionId, [
                { role: 'user', content: message },
                { role: 'assistant', content: outputText },
            ]);
        }
        const sshMetadata = extractSshSessionMetadataFromToolEvents(response?.metadata?.toolEvents);
        if (sshMetadata) {
            await sessionStore.update(sessionId, { metadata: sshMetadata });
        }
        const artifacts = await maybeGenerateOutputArtifact({
            sessionId,
            session,
            mode: 'chat',
            outputFormat: effectiveOutputFormat,
            content: outputText,
            prompt: message,
            title: 'chat-output',
            responseId: response.id,
            artifactIds,
            model,
        });
        await updateSessionProjectMemory(sessionId, {
            userText: message,
            assistantText: outputText,
            toolEvents: response?.metadata?.toolEvents || [],
            artifacts,
        });

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
        });
        next(err);
    }
});

module.exports = router;
