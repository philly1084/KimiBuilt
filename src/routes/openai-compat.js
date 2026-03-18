const { Router } = require('express');
const { sessionStore } = require('../session-store');
const { memoryService } = require('../memory/memory-service');
const { createResponse, generateImage, listModels } = require('../openai-client');
const { buildInstructionsWithArtifacts, maybeGenerateOutputArtifact } = require('../ai-route-utils');
const { artifactService, extractResponseText } = require('../artifacts/artifact-service');
const { startRuntimeTask, completeRuntimeTask, failRuntimeTask } = require('../admin/runtime-monitor');

const router = Router();

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

function buildContinuityInstructions(extra = '') {
    return [
        'You are a helpful AI assistant.',
        'Use the recent session transcript as the primary context for follow-up references like "that", "again", "same as before", or "the number from earlier".',
        'Use recalled memory only as supplemental context.',
        'Do not claim you lack access to prior conversation if session transcript or recalled context is available in the prompt.',
        'Follow the user\'s current request directly instead of defaulting to document or business-workflow tasks unless they ask for that.',
        'Be concise and informative.',
        extra || '',
    ].filter(Boolean).join('\n');
}

function shouldInjectRecentMessages(inputMessages = []) {
    if (!Array.isArray(inputMessages)) {
        return true;
    }

    const conversationalMessages = inputMessages.filter((message) => ['user', 'assistant', 'system', 'tool'].includes(message?.role));
    return conversationalMessages.length <= 1;
}

function isChatCapableModel(modelId = '') {
    const normalizedId = String(modelId).toLowerCase();
    if (!normalizedId) return false;

    const looksLikeChatModel = [
        'gpt', 'claude', 'gemini', 'kimi', 'llama', 'mistral', 'qwen', 'phi', 'ollama', 'antigravity',
    ].some((token) => normalizedId.includes(token));

    const imageOnly = normalizedId.includes('image') && !normalizedId.includes('vision');
    const audioOnly = normalizedId.includes('tts') || normalizedId.includes('speech') || normalizedId.includes('transcribe');

    return looksLikeChatModel && !imageOnly && !audioOnly;
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
            session_id,
            artifact_ids = [],
            output_format = null,
        } = req.body;

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({
                error: {
                    message: 'messages is required and must be an array',
                    type: 'invalid_request_error',
                },
            });
        }

        let sessionId = session_id;
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
            return res.status(404).json({
                error: {
                    message: 'Session not found',
                    type: 'invalid_request_error',
                },
            });
        }

        const lastUserMessage = messages.filter((message) => message.role === 'user').pop();
        const effectiveOutputFormat = output_format || inferOutputFormatFromText(lastUserMessage?.content || '');
        const contextMessages = lastUserMessage
            ? await memoryService.process(sessionId, lastUserMessage.content)
            : [];
        const recentMessages = shouldInjectRecentMessages(messages)
            ? sessionStore.getRecentMessages(session, 8)
            : [];

        const artifactInstructions = effectiveOutputFormat
            ? artifactService.getGenerationInstructions(effectiveOutputFormat)
            : '';
        const instructions = await buildInstructionsWithArtifacts(
            session,
            buildContinuityInstructions(artifactInstructions),
            artifact_ids,
        );
        const input = messages.map((message) => ({ role: message.role, content: message.content }));
        runtimeTask = startRuntimeTask({
            sessionId,
            input: lastUserMessage?.content || JSON.stringify(input),
            model: model || null,
            mode: 'openai-chat',
            transport: 'http',
            metadata: { route: '/v1/chat/completions', stream },
        });

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Session-Id', sessionId);

            const response = await createResponse({
                input,
                previousResponseId: session.previousResponseId,
                contextMessages,
                recentMessages,
                instructions,
                stream: true,
                model,
                toolManager: req.app.locals.toolManager,
                toolContext: {
                    sessionId,
                    route: '/v1/chat/completions',
                    transport: 'http',
                },
                enableAutomaticToolCalls: true,
            });

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
                    await sessionStore.recordResponse(sessionId, event.response.id);
                    memoryService.rememberResponse(sessionId, fullText);
                    await sessionStore.appendMessages(sessionId, [
                        { role: 'user', content: lastUserMessage?.content || '' },
                        { role: 'assistant', content: fullText },
                    ]);
                    const artifacts = await maybeGenerateOutputArtifact({
                        sessionId,
                        session,
                        mode: 'chat',
                        outputFormat: effectiveOutputFormat,
                        content: fullText,
                        prompt: lastUserMessage?.content || '',
                        title: 'chat-output',
                        responseId: event.response.id,
                        artifactIds: artifact_ids,
                        model,
                    });
                    completeRuntimeTask(runtimeTask?.id, {
                        responseId: event.response.id,
                        output: fullText,
                        model: event.response.model || model || null,
                        duration: Date.now() - startedAt,
                    });
                    res.write(`data: ${JSON.stringify({
                        id: `chatcmpl-${sessionId}`,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: model || 'gpt-4o',
                        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                        session_id: sessionId,
                        artifacts,
                    })}\n\n`);
                    res.write('data: [DONE]\n\n');
                }
            }

            res.end();
            return;
        }

        const response = await createResponse({
            input,
            previousResponseId: session.previousResponseId,
            contextMessages,
            recentMessages,
            instructions,
            stream: false,
            model,
            toolManager: req.app.locals.toolManager,
            toolContext: {
                sessionId,
                route: '/v1/chat/completions',
                transport: 'http',
            },
            enableAutomaticToolCalls: true,
        });

        await sessionStore.recordResponse(sessionId, response.id);
        const outputText = extractResponseText(response);
        memoryService.rememberResponse(sessionId, outputText);
        await sessionStore.appendMessages(sessionId, [
            { role: 'user', content: lastUserMessage?.content || '' },
            { role: 'assistant', content: outputText },
        ]);
        const artifacts = await maybeGenerateOutputArtifact({
            sessionId,
            session,
            mode: 'chat',
            outputFormat: effectiveOutputFormat,
            content: outputText,
            prompt: lastUserMessage?.content || '',
            title: 'chat-output',
            responseId: response.id,
            artifactIds: artifact_ids,
            model,
        });
        completeRuntimeTask(runtimeTask?.id, {
            responseId: response.id,
            output: outputText,
            model: response.model || model || null,
            duration: Date.now() - startedAt,
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

router.post('/responses', async (req, res, next) => {
    let runtimeTask = null;
    const startedAt = Date.now();
    try {
        const {
            model,
            input,
            instructions,
            stream = false,
            session_id,
            artifact_ids = [],
            output_format = null,
        } = req.body;

        let sessionId = session_id;
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
            return res.status(404).json({
                error: {
                    message: 'Session not found',
                    type: 'invalid_request_error',
                },
            });
        }

        const userInput = typeof input === 'string'
            ? input
            : input.filter((item) => item.role === 'user').pop()?.content || '';
        const effectiveOutputFormat = output_format || inferOutputFormatFromText(userInput);
        const contextMessages = await memoryService.process(sessionId, userInput);
        const recentMessages = typeof input === 'string' || shouldInjectRecentMessages(input)
            ? sessionStore.getRecentMessages(session, 8)
            : [];
        const artifactInstructions = effectiveOutputFormat
            ? artifactService.getGenerationInstructions(effectiveOutputFormat)
            : '';
        const fullInstructions = await buildInstructionsWithArtifacts(
            session,
            [buildContinuityInstructions(), instructions || '', artifactInstructions].filter(Boolean).join('\n\n'),
            artifact_ids,
        );
        runtimeTask = startRuntimeTask({
            sessionId,
            input: userInput || JSON.stringify(input),
            model: model || null,
            mode: 'openai-responses',
            transport: 'http',
            metadata: { route: '/v1/responses', stream },
        });

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Session-Id', sessionId);

            const response = await createResponse({
                input,
                previousResponseId: session.previousResponseId,
                contextMessages,
                recentMessages,
                instructions: fullInstructions,
                stream: true,
                model,
                toolManager: req.app.locals.toolManager,
                toolContext: {
                    sessionId,
                    route: '/v1/responses',
                    transport: 'http',
                },
                enableAutomaticToolCalls: true,
            });

            let fullText = '';
            for await (const event of response) {
                if (event.type === 'response.output_text.delta') {
                    fullText += event.delta;
                    res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: event.delta })}\n\n`);
                }

                if (event.type === 'response.completed') {
                    await sessionStore.recordResponse(sessionId, event.response.id);
                    memoryService.rememberResponse(sessionId, fullText);
                    await sessionStore.appendMessages(sessionId, [
                        { role: 'user', content: userInput },
                        { role: 'assistant', content: fullText },
                    ]);
                    const artifacts = await maybeGenerateOutputArtifact({
                        sessionId,
                        session,
                        mode: 'chat',
                        outputFormat: effectiveOutputFormat,
                        content: fullText,
                        prompt: userInput,
                        title: 'response-output',
                        responseId: event.response.id,
                        artifactIds: artifact_ids,
                        model,
                    });
                    completeRuntimeTask(runtimeTask?.id, {
                        responseId: event.response.id,
                        output: fullText,
                        model: event.response.model || model || null,
                        duration: Date.now() - startedAt,
                    });
                    res.write(`data: ${JSON.stringify({ type: 'response.completed', response: event.response, session_id: sessionId, artifacts })}\n\n`);
                }
            }

            res.end();
            return;
        }

        const response = await createResponse({
            input,
            previousResponseId: session.previousResponseId,
            contextMessages,
            recentMessages,
            instructions: fullInstructions,
            stream: false,
            model,
            toolManager: req.app.locals.toolManager,
            toolContext: {
                sessionId,
                route: '/v1/responses',
                transport: 'http',
            },
            enableAutomaticToolCalls: true,
        });

        await sessionStore.recordResponse(sessionId, response.id);
        const outputText = extractResponseText(response);
        memoryService.rememberResponse(sessionId, outputText);
        await sessionStore.appendMessages(sessionId, [
            { role: 'user', content: userInput },
            { role: 'assistant', content: outputText },
        ]);
        const artifacts = await maybeGenerateOutputArtifact({
            sessionId,
            session,
            mode: 'chat',
            outputFormat: effectiveOutputFormat,
            content: outputText,
            prompt: userInput,
            title: 'response-output',
            responseId: response.id,
            artifactIds: artifact_ids,
            model,
        });
        completeRuntimeTask(runtimeTask?.id, {
            responseId: response.id,
            output: outputText,
            model: response.model || model || null,
            duration: Date.now() - startedAt,
        });

        res.json({
            ...response,
            session_id: sessionId,
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

router.post('/images/generations', async (req, res, next) => {
    try {
        const {
            prompt,
            model = null,
            n = 1,
            size = '1024x1024',
            quality = 'standard',
            style = 'vivid',
            session_id,
        } = req.body;

        let sessionId = session_id;
        let session;
        if (!sessionId) {
            session = await sessionStore.create({ mode: 'image' });
            sessionId = session.id;
        } else {
            session = await sessionStore.getOrCreate(sessionId, { mode: 'image' });
        }

        if (!session) {
            session = await sessionStore.get(sessionId);
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

        await sessionStore.recordResponse(sessionId, `img_${Date.now()}`);

        res.json({
            ...response,
            session_id: sessionId,
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;







