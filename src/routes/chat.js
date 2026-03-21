const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { sessionStore } = require('../session-store');
const { memoryService } = require('../memory/memory-service');
const { createResponse } = require('../openai-client');
const { ensureRuntimeToolManager } = require('../runtime-tool-manager');
const {
    buildInstructionsWithArtifacts,
    maybeGenerateOutputArtifact,
    generateOutputArtifactFromPrompt,
    inferOutputFormatFromSession,
    resolveArtifactContextIds,
} = require('../ai-route-utils');
const { startRuntimeTask, completeRuntimeTask, failRuntimeTask } = require('../admin/runtime-monitor');

const router = Router();
const RECENT_TRANSCRIPT_LIMIT = 12;

async function executeChatResponse(app, params) {
    const agentOrchestrator = app?.locals?.agentOrchestrator;
    if (agentOrchestrator?.executeConversation) {
        return {
            ...(await agentOrchestrator.executeConversation(params)),
            handledPersistence: true,
        };
    }

    const contextMessages = params.contextMessages || (
        params.loadContextMessages === false
            ? []
            : await memoryService.process(params.sessionId, params.memoryInput || '')
    );
    const recentMessages = params.recentMessages || (
        params.loadRecentMessages === false
            ? []
            : await sessionStore.getRecentMessages(params.sessionId, RECENT_TRANSCRIPT_LIMIT)
    );

    return {
        response: await createResponse({
            ...params,
            contextMessages,
            recentMessages,
        }),
        handledPersistence: false,
    };
}

function inferOutputFormatFromText(text = '') {
    const normalized = String(text || '').toLowerCase();
    const checks = [
        ['power-query', /\b(power\s*query|\.(pq|m)\b)/],
        ['xlsx', /\b(xlsx|spreadsheet|excel|workbook)\b/],
        ['pdf', /\bpdf\b/],
        ['docx', /\b(docx|word document)\b/],
        ['xml', /\bxml\b/],
        ['mermaid', /\bmermaid\b/],
        ['html', /\bhtml\b/],
    ];

    return checks.find(([, pattern]) => pattern.test(normalized))?.[0] || null;
}

const chatSchema = {
    message: { required: true, type: 'string' },
    sessionId: { required: false, type: 'string' },
    stream: { required: false, type: 'boolean' },
    model: { required: false, type: 'string' },
    artifactIds: { required: false, type: 'array' },
    outputFormat: { required: false, type: 'string' },
};

router.post('/', validate(chatSchema), async (req, res, next) => {
    let runtimeTask = null;
    const startedAt = Date.now();
    try {
        const { message, stream = true, model = null, artifactIds = [], outputFormat = null } = req.body;
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

        const effectiveOutputFormat = outputFormat
            || inferOutputFormatFromText(message)
            || inferOutputFormatFromSession(message, session);
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
                })}\n\n`);
                res.end();
                return;
            }

            res.json({
                sessionId,
                responseId: generation.responseId,
                message: generation.assistantMessage,
                artifacts: generation.artifacts,
            });
            return;
        }

        const instructions = await buildInstructionsWithArtifacts(
            session,
            'You are a helpful AI assistant. Use the recent session transcript as the primary context for follow-up references like "that", "again", or "same as before". Use recalled memory only as supplemental context. Follow the user\'s current request directly instead of defaulting to document or business-workflow tasks unless they ask for that. Be concise and informative.',
            effectiveArtifactIds,
        );

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Session-Id', sessionId);

            const toolManager = await ensureRuntimeToolManager(req.app);
            const execution = await executeChatResponse(req.app, {
                input: message,
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
                enableAutomaticToolCalls: true,
            });
            const response = execution.response;

            let fullText = '';

            for await (const event of response) {
                if (event.type === 'response.output_text.delta') {
                    fullText += event.delta;
                    res.write(`data: ${JSON.stringify({ type: 'delta', content: event.delta })}\n\n`);
                }

                if (event.type === 'response.completed') {
                    if (!execution.handledPersistence) {
                        await sessionStore.recordResponse(sessionId, event.response.id);
                        memoryService.rememberResponse(sessionId, fullText);
                        await sessionStore.appendMessages(sessionId, [
                            { role: 'user', content: message },
                            { role: 'assistant', content: fullText },
                        ]);
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
                    completeRuntimeTask(runtimeTask?.id, {
                        responseId: event.response.id,
                        output: fullText,
                        model: event.response.model || model || null,
                        duration: Date.now() - startedAt,
                    });
                    res.write(`data: ${JSON.stringify({ type: 'done', sessionId, responseId: event.response.id, artifacts })}\n\n`);
                }
            }

            res.end();
            return;
        }

        const execution = await executeChatResponse(req.app, {
            input: message,
            sessionId,
            memoryInput: message,
            previousResponseId: session.previousResponseId,
            instructions,
            stream: false,
            model,
            toolManager: await ensureRuntimeToolManager(req.app),
            toolContext: {
                sessionId,
                route: '/api/chat',
                transport: 'http',
            },
            enableAutomaticToolCalls: true,
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

        completeRuntimeTask(runtimeTask?.id, {
            responseId: response.id,
            output: outputText,
            model: response.model || model || null,
            duration: Date.now() - startedAt,
        });

        res.json({
            sessionId,
            responseId: response.id,
            message: outputText,
            artifacts,
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
