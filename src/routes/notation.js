const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { sessionStore } = require('../session-store');
const { memoryService } = require('../memory/memory-service');
const { createResponse } = require('../openai-client');

const router = Router();

const notationSchema = {
    notation: { required: true, type: 'string' },
    sessionId: { required: false, type: 'string' },
    context: { required: false, type: 'string' },
    helperMode: { required: false, type: 'string', enum: ['expand', 'explain', 'validate'] },
    model: { required: false, type: 'string' },
};

/**
 * POST /api/notation
 * Notation-style structured helper.
 * Accepts shorthand notation and returns expanded/explained/validated results.
 */
router.post('/', validate(notationSchema), async (req, res, next) => {
    try {
        const { notation, context = '', helperMode = 'expand', model = null } = req.body;
        let { sessionId } = req.body;

        // Auto-create session
        if (!sessionId) {
            const session = sessionStore.create({ mode: 'notation', helperMode });
            sessionId = session.id;
        }

        const session = sessionStore.get(sessionId);
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }

        // Retrieve relevant memories
        const contextMessages = await memoryService.process(sessionId, notation);

        // Build notation-specific instructions
        const instructions = buildNotationInstructions(helperMode, context);

        const response = await createResponse({
            input: notation,
            previousResponseId: session.previousResponseId,
            contextMessages,
            instructions,
            stream: false,
            model,
        });

        sessionStore.recordResponse(sessionId, response.id);

        const outputText = response.output
            .filter((o) => o.type === 'message')
            .map((o) => o.content.map((c) => c.text).join(''))
            .join('\n');

        // Store in memory
        memoryService.rememberResponse(sessionId, outputText);

        // Parse the structured response
        const structured = parseNotationResponse(outputText);

        res.json({
            sessionId,
            responseId: response.id,
            helperMode,
            ...structured,
        });
    } catch (err) {
        next(err);
    }
});

/**
 * Build notation-specific system instructions.
 */
function buildNotationInstructions(helperMode, context) {
    const base = `You are an AI notation helper. Users write in shorthand notation and you process it according to the specified mode.

Always respond with valid JSON in this format:
{
  "result": "the processed output",
  "annotations": [{"line": 1, "note": "explanation"}],
  "suggestions": ["suggestion 1", "suggestion 2"]
}`;

    const modeInstructions = {
        expand: `\n\nMODE: EXPAND — Take the shorthand notation and expand it into full, detailed content. Preserve the intent and structure while making it comprehensive and production-ready.`,
        explain: `\n\nMODE: EXPLAIN — Analyze the notation and provide detailed explanations for each part. Break down what each element means and how it connects to the whole.`,
        validate: `\n\nMODE: VALIDATE — Check the notation for correctness, completeness, and best practices. Flag any issues, missing elements, or improvements. Provide a corrected version if needed.`,
    };

    let instructions = base + (modeInstructions[helperMode] || modeInstructions.expand);

    if (context) {
        instructions += `\n\nAdditional context provided by the user:\n${context}`;
    }

    return instructions;
}

/**
 * Parse the AI response into structured notation format.
 */
function parseNotationResponse(text) {
    try {
        const parsed = JSON.parse(text);
        return {
            result: parsed.result || text,
            annotations: parsed.annotations || [],
            suggestions: parsed.suggestions || [],
        };
    } catch {
        return {
            result: text,
            annotations: [],
            suggestions: [],
        };
    }
}

module.exports = router;
