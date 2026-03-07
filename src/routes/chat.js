const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { sessionStore } = require('../session-store');
const { memoryService } = require('../memory/memory-service');
const { createResponse } = require('../openai-client');
const { buildSessionInstructions } = require('../session-instructions');

const router = Router();

const chatSchema = {
    message: { required: true, type: 'string' },
    sessionId: { required: false, type: 'string' },
    stream: { required: false, type: 'boolean' },
    model: { required: false, type: 'string' },
};

/**
 * POST /api/chat
 * Send a message and receive a response.
 * Supports streaming (SSE) when stream=true.
 */
router.post('/', validate(chatSchema), async (req, res, next) => {
    try {
        const { message, stream = true, model = null } = req.body;
        let { sessionId } = req.body;

        // Auto-create session if not provided
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

        // Retrieve relevant memories
        const contextMessages = await memoryService.process(sessionId, message);

        if (stream) {
            // SSE streaming
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Session-Id', sessionId);

            const response = await createResponse({
                input: message,
                previousResponseId: session.previousResponseId,
                contextMessages,
                instructions: buildSessionInstructions(
                    session,
                    'You are a helpful AI assistant. Be concise and informative.',
                ),
                stream: true,
                model,
            });

            let fullText = '';

            for await (const event of response) {
                if (event.type === 'response.output_text.delta') {
                    fullText += event.delta;
                    res.write(`data: ${JSON.stringify({ type: 'delta', content: event.delta })}\n\n`);
                }

                if (event.type === 'response.completed') {
                    await sessionStore.recordResponse(sessionId, event.response.id);
                    // Store the assistant response in memory
                    memoryService.rememberResponse(sessionId, fullText);
                    res.write(`data: ${JSON.stringify({ type: 'done', sessionId, responseId: event.response.id })}\n\n`);
                }
            }

            res.end();
        } else {
            // Non-streaming
            const response = await createResponse({
                input: message,
                previousResponseId: session.previousResponseId,
                contextMessages,
                instructions: buildSessionInstructions(
                    session,
                    'You are a helpful AI assistant. Be concise and informative.',
                ),
                stream: false,
                model,
            });

            await sessionStore.recordResponse(sessionId, response.id);

            const outputText = response.output
                .filter((o) => o.type === 'message')
                .map((o) => o.content.map((c) => c.text).join(''))
                .join('\n');

            // Store in memory
            memoryService.rememberResponse(sessionId, outputText);

            res.json({
                sessionId,
                responseId: response.id,
                message: outputText,
            });
        }
    } catch (err) {
        next(err);
    }
});

module.exports = router;
