const { Router } = require('express');
const { sessionStore } = require('../session-store');
const { memoryService } = require('../memory/memory-service');
const { createResponse, generateImage, listModels } = require('../openai-client');
const { buildSessionInstructions } = require('../session-instructions');

const router = Router();

function isChatCapableModel(modelId = '') {
    const normalizedId = String(modelId).toLowerCase();

    if (!normalizedId) return false;

    const looksLikeChatModel = [
        'gpt',
        'claude',
        'gemini',
        'kimi',
        'llama',
        'mistral',
        'qwen',
        'phi',
        'ollama',
        'antigravity',
    ].some((token) => normalizedId.includes(token));

    const imageOnly = normalizedId.includes('image') && !normalizedId.includes('vision');
    const audioOnly = normalizedId.includes('tts') || normalizedId.includes('speech') || normalizedId.includes('transcribe');

    return looksLikeChatModel && !imageOnly && !audioOnly;
}

/**
 * GET /v1/models
 * OpenAI-compatible models endpoint
 */
router.get('/models', async (_req, res, next) => {
    try {
        const models = await listModels();
        res.json({
            object: 'list',
            data: models
                .filter((model) => isChatCapableModel(model.id))
                .map(m => ({
                id: m.id,
                object: 'model',
                created: m.created || Math.floor(Date.now() / 1000),
                owned_by: m.owned_by || 'openai',
                })),
        });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /v1/chat/completions
 * OpenAI-compatible chat completions endpoint
 * Adds session management and memory on top
 */
router.post('/chat/completions', async (req, res, next) => {
    try {
        const { 
            model, 
            messages, 
            stream = false, 
            temperature, 
            max_tokens,
            top_p,
            frequency_penalty,
            presence_penalty,
            session_id, // KimiBuilt extension
        } = req.body;

        console.log(`[Chat] Request: model=${model}, stream=${stream}, messages=${messages?.length}`);

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            console.log('[Chat] Error: No messages provided');
            return res.status(400).json({
                error: {
                    message: 'messages is required and must be an array',
                    type: 'invalid_request_error',
                },
            });
        }

        // Get or create session
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

        // Get the last user message for memory retrieval
        const lastUserMessage = messages.filter(m => m.role === 'user').pop();
        const contextMessages = lastUserMessage 
            ? await memoryService.process(sessionId, lastUserMessage.content)
            : [];

        // Build input from messages
        const input = messages.map(m => ({
            role: m.role,
            content: m.content,
        }));

        if (stream) {
            // SSE streaming
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Session-Id', sessionId);

            const response = await createResponse({
                input,
                previousResponseId: session.previousResponseId,
                contextMessages,
                instructions: buildSessionInstructions(session),
                stream: true,
                model,
            });

            let fullText = '';
            let chunkIndex = 0;

            for await (const event of response) {
                if (event.type === 'response.output_text.delta') {
                    fullText += event.delta;
                    
                    // Send OpenAI-compatible chunk
                    const chunk = {
                        id: `chatcmpl-${sessionId}-${chunkIndex}`,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: model || 'gpt-4o',
                        choices: [{
                            index: 0,
                            delta: { content: event.delta },
                            finish_reason: null,
                        }],
                    };
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                    chunkIndex++;
                }

                if (event.type === 'response.completed') {
                    await sessionStore.recordResponse(sessionId, event.response.id);
                    memoryService.rememberResponse(sessionId, fullText);
                    
                    // Send final chunk
                    const finalChunk = {
                        id: `chatcmpl-${sessionId}`,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: model || 'gpt-4o',
                        choices: [{
                            index: 0,
                            delta: {},
                            finish_reason: 'stop',
                        }],
                    };
                    res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
                    res.write('data: [DONE]\n\n');
                }
            }

            res.end();
        } else {
            // Non-streaming
            const response = await createResponse({
                input,
                previousResponseId: session.previousResponseId,
                contextMessages,
                instructions: buildSessionInstructions(session),
                stream: false,
                model,
            });

            await sessionStore.recordResponse(sessionId, response.id);

            const outputText = response.output
                .filter((o) => o.type === 'message')
                .map((o) => o.content.map((c) => c.text).join(''))
                .join('\n');

            memoryService.rememberResponse(sessionId, outputText);

            // OpenAI-compatible response
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
                    },
                    finish_reason: 'stop',
                }],
                usage: {
                    prompt_tokens: -1, // Not tracked
                    completion_tokens: -1,
                    total_tokens: -1,
                },
                session_id: sessionId, // KimiBuilt extension
            });
        }
    } catch (err) {
        console.error('[Chat] Error:', err.message);
        console.error('[Chat] Stack:', err.stack);
        next(err);
    }
});

/**
 * POST /v1/responses
 * OpenAI-compatible responses endpoint (new API)
 */
router.post('/responses', async (req, res, next) => {
    try {
        const { 
            model, 
            input, 
            instructions,
            stream = false,
            session_id, // KimiBuilt extension
        } = req.body;

        // Get or create session
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

        // Get the user input for memory retrieval
        const userInput = typeof input === 'string' ? input : 
            input.filter(i => i.role === 'user').pop()?.content || '';
        const contextMessages = await memoryService.process(sessionId, userInput);

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Session-Id', sessionId);

            const response = await createResponse({
                input,
                previousResponseId: session.previousResponseId,
                contextMessages,
                instructions: buildSessionInstructions(session, instructions),
                stream: true,
                model,
            });

            let fullText = '';

            for await (const event of response) {
                if (event.type === 'response.output_text.delta') {
                    fullText += event.delta;
                    res.write(`data: ${JSON.stringify({
                        type: 'response.output_text.delta',
                        delta: event.delta,
                    })}\n\n`);
                }

                if (event.type === 'response.completed') {
                    await sessionStore.recordResponse(sessionId, event.response.id);
                    memoryService.rememberResponse(sessionId, fullText);
                    res.write(`data: ${JSON.stringify({
                        type: 'response.completed',
                        response: event.response,
                    })}\n\n`);
                }
            }

            res.end();
        } else {
            const response = await createResponse({
                input,
                previousResponseId: session.previousResponseId,
                contextMessages,
                instructions: buildSessionInstructions(session, instructions),
                stream: false,
                model,
            });

            await sessionStore.recordResponse(sessionId, response.id);

            const outputText = response.output
                .filter((o) => o.type === 'message')
                .map((o) => o.content.map((c) => c.text).join(''))
                .join('\n');

            memoryService.rememberResponse(sessionId, outputText);

            res.json({
                ...response,
                session_id: sessionId, // KimiBuilt extension
            });
        }
    } catch (err) {
        next(err);
    }
});

/**
 * POST /v1/images/generations
 * OpenAI-compatible image generation endpoint
 */
router.post('/images/generations', async (req, res, next) => {
    try {
        const {
            prompt,
            model = 'dall-e-3',
            n = 1,
            size = '1024x1024',
            quality = 'standard',
            style = 'vivid',
            session_id, // KimiBuilt extension
        } = req.body;

        // Get or create session
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
            session_id: sessionId, // KimiBuilt extension
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
