const { Router } = require('express');
const { sessionStore } = require('../session-store');
const { memoryService } = require('../memory/memory-service');
const { createResponse, generateImage, listModels } = require('../openai-client');
const { ensureRuntimeToolManager } = require('../runtime-tool-manager');
const {
    buildInstructionsWithArtifacts,
    maybeGenerateOutputArtifact,
    generateOutputArtifactFromPrompt,
    isArtifactContinuationPrompt,
    inferOutputFormatFromSession,
    resolveArtifactContextIds,
} = require('../ai-route-utils');
const { artifactService, extractResponseText } = require('../artifacts/artifact-service');
const { startRuntimeTask, completeRuntimeTask, failRuntimeTask } = require('../admin/runtime-monitor');

const router = Router();
const RECENT_TRANSCRIPT_LIMIT = 12;

async function executeRuntimeResponse(app, params) {
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

function normalizeMessageText(content = '') {
    if (typeof content === 'string') {
        return content;
    }

    if (Array.isArray(content)) {
        return content
            .map((item) => {
                if (typeof item === 'string') {
                    return item;
                }

                if (item?.type === 'text' || item?.type === 'input_text' || item?.type === 'output_text') {
                    return item.text || '';
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
    const lastUserText = normalizeMessageText(lastUserMessage?.content || '');

    if (!isArtifactContinuationPrompt(lastUserText)) {
        return inferOutputFormatFromSession(lastUserText, session);
    }

    for (let index = normalizedMessages.length - 1; index >= 0; index -= 1) {
        const message = normalizedMessages[index];
        const format = inferOutputFormatFromText(normalizeMessageText(message?.content || ''));
        if (format) {
            return format;
        }
    }

    return inferOutputFormatFromSession(lastUserText, session);
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

        let sessionId = resolveSessionId(req);
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
        const lastUserText = normalizeMessageText(lastUserMessage?.content || '');
        const effectiveOutputFormat = output_format
            || inferOutputFormatFromText(lastUserText)
            || inferOutputFormatFromTranscript(messages, session);
        const effectiveArtifactIds = resolveArtifactContextIds(session, artifact_ids);
        const artifactPrompt = buildArtifactPromptFromTranscript(messages, lastUserText);
        runtimeTask = startRuntimeTask({
            sessionId,
            input: lastUserText || JSON.stringify(messages),
            model: model || null,
            mode: 'openai-chat',
            transport: 'http',
            metadata: { route: '/v1/chat/completions', stream, phase: 'preflight' },
        });
        if (effectiveOutputFormat) {
            setSessionHeaders(res, sessionId);

            if (stream) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
            }

            const generation = await generateOutputArtifactFromPrompt({
                sessionId,
                session,
                mode: 'chat',
                outputFormat: effectiveOutputFormat,
                prompt: artifactPrompt,
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
                { role: 'user', content: lastUserText },
                { role: 'assistant', content: generation.assistantMessage },
            ]);

            completeRuntimeTask(runtimeTask?.id, {
                responseId: generation.responseId,
                output: generation.assistantMessage,
                model: model || null,
                duration: Date.now() - startedAt,
                metadata: { outputFormat: effectiveOutputFormat, artifactDirect: true },
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
                    artifacts: generation.artifacts,
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
                        artifacts: generation.artifacts,
                    },
                    finish_reason: 'stop',
                }],
                usage: {
                    prompt_tokens: -1,
                    completion_tokens: -1,
                    total_tokens: -1,
                },
                session_id: sessionId,
                artifacts: generation.artifacts,
            });
            return;
        }

        const artifactInstructions = effectiveOutputFormat
            ? artifactService.getGenerationInstructions(effectiveOutputFormat)
            : '';
        const instructions = await buildInstructionsWithArtifacts(
            session,
            buildContinuityInstructions(artifactInstructions),
            effectiveArtifactIds,
        );
        const input = messages.map((message) => ({ role: message.role, content: message.content }));

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            setSessionHeaders(res, sessionId);

            const toolManager = await ensureRuntimeToolManager(req.app);
            const execution = await executeRuntimeResponse(req.app, {
                input,
                sessionId,
                memoryInput: lastUserText,
                loadContextMessages: Boolean(lastUserText),
                loadRecentMessages: shouldInjectRecentMessages(messages),
                previousResponseId: session.previousResponseId,
                instructions,
                stream: true,
                model,
                toolManager,
                toolContext: {
                    sessionId,
                    route: '/v1/chat/completions',
                    transport: 'http',
                },
                enableAutomaticToolCalls: true,
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
                    if (!execution.handledPersistence) {
                        await sessionStore.recordResponse(sessionId, event.response.id);
                        memoryService.rememberResponse(sessionId, fullText);
                        await sessionStore.appendMessages(sessionId, [
                            { role: 'user', content: lastUserText },
                            { role: 'assistant', content: fullText },
                        ]);
                    }
                    const artifacts = await maybeGenerateOutputArtifact({
                        sessionId,
                        session,
                        mode: 'chat',
                        outputFormat: effectiveOutputFormat,
                        content: fullText,
                        prompt: artifactPrompt,
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

        setSessionHeaders(res, sessionId);

        const execution = await executeRuntimeResponse(req.app, {
            input,
            sessionId,
            memoryInput: lastUserText,
            loadContextMessages: Boolean(lastUserText),
            loadRecentMessages: shouldInjectRecentMessages(messages),
            previousResponseId: session.previousResponseId,
            instructions,
            stream: false,
            model,
            toolManager: await ensureRuntimeToolManager(req.app),
            toolContext: {
                sessionId,
                route: '/v1/chat/completions',
                transport: 'http',
            },
            enableAutomaticToolCalls: true,
        });
        const response = execution.response;
        if (!execution.handledPersistence) {
            await sessionStore.recordResponse(sessionId, response.id);
        }
        const outputText = extractResponseText(response);
        if (!execution.handledPersistence) {
            memoryService.rememberResponse(sessionId, outputText);
            await sessionStore.appendMessages(sessionId, [
                { role: 'user', content: lastUserText },
                { role: 'assistant', content: outputText },
            ]);
        }
        const artifacts = await maybeGenerateOutputArtifact({
            sessionId,
            session,
            mode: 'chat',
            outputFormat: effectiveOutputFormat,
            content: outputText,
            prompt: artifactPrompt,
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
            artifact_ids = [],
            output_format = null,
        } = req.body;

        let sessionId = resolveSessionId(req);
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

        const normalizedInputMessages = typeof input === 'string'
            ? [{ role: 'user', content: input }]
            : (Array.isArray(input)
                ? input.filter((item) => item?.role).map((item) => ({ role: item.role, content: item.content }))
                : []);
        const userInput = typeof input === 'string'
            ? input
            : normalizeMessageText(input.filter((item) => item.role === 'user').pop()?.content || '');
        const effectiveOutputFormat = output_format
            || inferOutputFormatFromText(userInput)
            || inferOutputFormatFromTranscript(normalizedInputMessages, session);
        const effectiveArtifactIds = resolveArtifactContextIds(session, artifact_ids);
        const artifactPrompt = buildArtifactPromptFromTranscript(normalizedInputMessages, userInput);
        runtimeTask = startRuntimeTask({
            sessionId,
            input: userInput || JSON.stringify(input),
            model: model || null,
            mode: 'openai-responses',
            transport: 'http',
            metadata: { route: '/v1/responses', stream, phase: 'preflight' },
        });
        if (effectiveOutputFormat) {
            setSessionHeaders(res, sessionId);

            if (stream) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
            }

            const generation = await generateOutputArtifactFromPrompt({
                sessionId,
                session,
                mode: 'chat',
                outputFormat: effectiveOutputFormat,
                prompt: artifactPrompt,
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
                { role: 'user', content: userInput },
                { role: 'assistant', content: generation.assistantMessage },
            ]);

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
                metadata: { outputFormat: effectiveOutputFormat, artifactDirect: true },
            });

            if (stream) {
                res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: generation.assistantMessage })}\n\n`);
                res.write(`data: ${JSON.stringify({
                    type: 'response.completed',
                    response: syntheticResponse,
                    session_id: sessionId,
                    artifacts: generation.artifacts,
                })}\n\n`);
                res.end();
                return;
            }

            res.json({
                ...syntheticResponse,
                session_id: sessionId,
                artifacts: generation.artifacts,
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

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            setSessionHeaders(res, sessionId);

            const toolManager = await ensureRuntimeToolManager(req.app);
            const execution = await executeRuntimeResponse(req.app, {
                input,
                sessionId,
                memoryInput: userInput,
                loadContextMessages: Boolean(userInput),
                loadRecentMessages: typeof input === 'string' || shouldInjectRecentMessages(input),
                previousResponseId: session.previousResponseId,
                instructions: fullInstructions,
                stream: true,
                model,
                toolManager,
                toolContext: {
                    sessionId,
                    route: '/v1/responses',
                    transport: 'http',
                },
                enableAutomaticToolCalls: true,
            });
            const response = execution.response;

            let fullText = '';
            for await (const event of response) {
                if (event.type === 'response.output_text.delta') {
                    fullText += event.delta;
                    res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: event.delta })}\n\n`);
                }

                if (event.type === 'response.completed') {
                    if (!execution.handledPersistence) {
                        await sessionStore.recordResponse(sessionId, event.response.id);
                        memoryService.rememberResponse(sessionId, fullText);
                        await sessionStore.appendMessages(sessionId, [
                            { role: 'user', content: userInput },
                            { role: 'assistant', content: fullText },
                        ]);
                    }
                    const artifacts = await maybeGenerateOutputArtifact({
                        sessionId,
                        session,
                        mode: 'chat',
                        outputFormat: effectiveOutputFormat,
                        content: fullText,
                        prompt: artifactPrompt,
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

        setSessionHeaders(res, sessionId);

        const execution = await executeRuntimeResponse(req.app, {
            input,
            sessionId,
            memoryInput: userInput,
            loadContextMessages: Boolean(userInput),
            loadRecentMessages: typeof input === 'string' || shouldInjectRecentMessages(input),
            previousResponseId: session.previousResponseId,
            instructions: fullInstructions,
            stream: false,
            model,
            toolManager: await ensureRuntimeToolManager(req.app),
            toolContext: {
                sessionId,
                route: '/v1/responses',
                transport: 'http',
            },
            enableAutomaticToolCalls: true,
        });
        const response = execution.response;
        if (!execution.handledPersistence) {
            await sessionStore.recordResponse(sessionId, response.id);
        }
        const outputText = extractResponseText(response);
        if (!execution.handledPersistence) {
            memoryService.rememberResponse(sessionId, outputText);
            await sessionStore.appendMessages(sessionId, [
                { role: 'user', content: userInput },
                { role: 'assistant', content: outputText },
            ]);
        }
        const artifacts = await maybeGenerateOutputArtifact({
            sessionId,
            session,
            mode: 'chat',
            outputFormat: effectiveOutputFormat,
            content: outputText,
            prompt: artifactPrompt,
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
        } = req.body;

        let sessionId = resolveSessionId(req);
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
        setSessionHeaders(res, sessionId);

        res.json({
            ...response,
            session_id: sessionId,
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;







