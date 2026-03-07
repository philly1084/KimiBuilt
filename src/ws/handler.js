const { sessionStore } = require('../session-store');
const { memoryService } = require('../memory/memory-service');
const { createResponse } = require('../openai-client');
const { buildSessionInstructions } = require('../session-instructions');

/**
 * WebSocket handler for real-time bidirectional streaming.
 * Supports all modes: chat, canvas, notation.
 *
 * Message format (client → server):
 * {
 *   "type": "chat" | "canvas" | "notation",
 *   "sessionId": "optional-session-id",
 *   "payload": { ... mode-specific fields ... }
 * }
 *
 * Response format (server → client):
 * {
 *   "type": "delta" | "done" | "error" | "session_created",
 *   "content": "...",
 *   "sessionId": "...",
 *   ...
 * }
 */
function setupWebSocket(wss) {
    wss.on('connection', (ws) => {
        console.log('[WS] Client connected');

        ws.on('message', async (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                const { type, payload } = msg;
                let { sessionId } = msg;

                // Auto-create session
                let session;
                if (!sessionId) {
                    session = await sessionStore.create({ mode: type, transport: 'ws' });
                    sessionId = session.id;
                    ws.send(JSON.stringify({ type: 'session_created', sessionId }));
                } else {
                    session = await sessionStore.getOrCreate(sessionId, { mode: type, transport: 'ws' });
                }

                if (!session) {
                    session = await sessionStore.get(sessionId);
                }
                if (!session) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
                    return;
                }

                switch (type) {
                    case 'chat':
                        await handleChat(ws, session, payload);
                        break;
                    case 'canvas':
                        await handleCanvas(ws, session, payload);
                        break;
                    case 'notation':
                        await handleNotation(ws, session, payload);
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
        });
    });
}

/**
 * Handle chat messages over WebSocket with streaming.
 */
async function handleChat(ws, session, payload) {
    const { message, model = null } = payload;
    if (!message) {
        ws.send(JSON.stringify({ type: 'error', message: "'message' is required" }));
        return;
    }

    const contextMessages = await memoryService.process(session.id, message);

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
            ws.send(JSON.stringify({ type: 'delta', content: event.delta }));
        }

        if (event.type === 'response.completed') {
            await sessionStore.recordResponse(session.id, event.response.id);
            memoryService.rememberResponse(session.id, fullText);
            ws.send(JSON.stringify({
                type: 'done',
                sessionId: session.id,
                responseId: event.response.id,
            }));
        }
    }
}

/**
 * Handle canvas messages over WebSocket (non-streaming).
 */
async function handleCanvas(ws, session, payload) {
    const { message, canvasType = 'document', existingContent = '', model = null } = payload;
    if (!message) {
        ws.send(JSON.stringify({ type: 'error', message: "'message' is required" }));
        return;
    }

    const contextMessages = await memoryService.process(session.id, message);

    const instructions = buildSessionInstructions(
        session,
        `You are an AI canvas assistant generating ${canvasType} content.
Respond with valid JSON: { "content": "...", "metadata": {...}, "suggestions": [...] }`,
    );

    const response = await createResponse({
        input: existingContent ? `${message}\n\nExisting content:\n${existingContent}` : message,
        previousResponseId: session.previousResponseId,
        contextMessages,
        instructions,
        stream: false,
        model,
    });

    await sessionStore.recordResponse(session.id, response.id);

    const outputText = response.output
        .filter((o) => o.type === 'message')
        .map((o) => o.content.map((c) => c.text).join(''))
        .join('\n');

    memoryService.rememberResponse(session.id, outputText);

    ws.send(JSON.stringify({
        type: 'done',
        sessionId: session.id,
        responseId: response.id,
        canvasType,
        content: outputText,
    }));
}

/**
 * Handle notation messages over WebSocket (non-streaming).
 */
async function handleNotation(ws, session, payload) {
    const { notation, helperMode = 'expand', context = '', model = null } = payload;
    if (!notation) {
        ws.send(JSON.stringify({ type: 'error', message: "'notation' is required" }));
        return;
    }

    const contextMessages = await memoryService.process(session.id, notation);

    const instructions = buildSessionInstructions(
        session,
        `You are an AI notation helper in ${helperMode} mode.
Respond with valid JSON: { "result": "...", "annotations": [...], "suggestions": [...] }
${context ? `Context: ${context}` : ''}`,
    );

    const response = await createResponse({
        input: notation,
        previousResponseId: session.previousResponseId,
        contextMessages,
        instructions,
        stream: false,
        model,
    });

    await sessionStore.recordResponse(session.id, response.id);

    const outputText = response.output
        .filter((o) => o.type === 'message')
        .map((o) => o.content.map((c) => c.text).join(''))
        .join('\n');

    memoryService.rememberResponse(session.id, outputText);

    ws.send(JSON.stringify({
        type: 'done',
        sessionId: session.id,
        responseId: response.id,
        helperMode,
        content: outputText,
    }));
}

module.exports = { setupWebSocket };
