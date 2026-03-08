const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { sessionStore } = require('../session-store');
const { memoryService } = require('../memory/memory-service');
const { createResponse } = require('../openai-client');
const { buildInstructionsWithArtifacts, maybeGenerateOutputArtifact } = require('../ai-route-utils');

const router = Router();

const chatSchema = {
    message: { required: true, type: 'string' },
    sessionId: { required: false, type: 'string' },
    stream: { required: false, type: 'boolean' },
    model: { required: false, type: 'string' },
    artifactIds: { required: false, type: 'array' },
    outputFormat: { required: false, type: 'string' },
};

router.post('/', validate(chatSchema), async (req, res, next) => {
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

        const contextMessages = await memoryService.process(sessionId, message);
        const instructions = await buildInstructionsWithArtifacts(
            session,
            'You are a helpful AI assistant. Be concise and informative.',
            artifactIds,
        );

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Session-Id', sessionId);

            const response = await createResponse({
                input: message,
                previousResponseId: session.previousResponseId,
                contextMessages,
                instructions,
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
                    memoryService.rememberResponse(sessionId, fullText);
                    const artifacts = await maybeGenerateOutputArtifact({
                        sessionId,
                        mode: 'chat',
                        outputFormat,
                        content: fullText,
                        title: 'chat-output',
                        responseId: event.response.id,
                        artifactIds,
                    });
                    res.write(`data: ${JSON.stringify({ type: 'done', sessionId, responseId: event.response.id, artifacts })}\n\n`);
                }
            }

            res.end();
            return;
        }

        const response = await createResponse({
            input: message,
            previousResponseId: session.previousResponseId,
            contextMessages,
            instructions,
            stream: false,
            model,
        });

        await sessionStore.recordResponse(sessionId, response.id);

        const outputText = response.output
            .filter((item) => item.type === 'message')
            .map((item) => item.content.map((content) => content.text).join(''))
            .join('\n');

        memoryService.rememberResponse(sessionId, outputText);
        const artifacts = await maybeGenerateOutputArtifact({
            sessionId,
            mode: 'chat',
            outputFormat,
            content: outputText,
            title: 'chat-output',
            responseId: response.id,
            artifactIds,
        });

        res.json({
            sessionId,
            responseId: response.id,
            message: outputText,
            artifacts,
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
