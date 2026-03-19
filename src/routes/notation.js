const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { sessionStore } = require('../session-store');
const { memoryService } = require('../memory/memory-service');
const { createResponse } = require('../openai-client');
const { buildInstructionsWithArtifacts, maybeGenerateOutputArtifact } = require('../ai-route-utils');
const { startRuntimeTask, completeRuntimeTask, failRuntimeTask } = require('../admin/runtime-monitor');

const router = Router();
const RECENT_TRANSCRIPT_LIMIT = 12;

const notationSchema = {
    notation: { required: true, type: 'string' },
    sessionId: { required: false, type: 'string' },
    context: { required: false, type: 'string' },
    helperMode: { required: false, type: 'string', enum: ['expand', 'explain', 'validate'] },
    model: { required: false, type: 'string' },
    artifactIds: { required: false, type: 'array' },
    outputFormat: { required: false, type: 'string' },
};

router.post('/', validate(notationSchema), async (req, res, next) => {
    let runtimeTask = null;
    const startedAt = Date.now();
    try {
        const {
            notation,
            context = '',
            helperMode = 'expand',
            model = null,
            artifactIds = [],
            outputFormat = null,
        } = req.body;
        let { sessionId } = req.body;

        let session;
        if (!sessionId) {
            session = await sessionStore.create({ mode: 'notation', helperMode });
            sessionId = session.id;
        } else {
            session = await sessionStore.getOrCreate(sessionId, { mode: 'notation', helperMode });
        }

        if (!session) {
            session = await sessionStore.get(sessionId);
        }
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }

        const contextMessages = await memoryService.process(sessionId, notation);
        const recentMessages = await sessionStore.getRecentMessages(session, RECENT_TRANSCRIPT_LIMIT);
        const instructions = await buildInstructionsWithArtifacts(
            session,
            buildNotationInstructions(helperMode, context),
            artifactIds,
        );

        runtimeTask = startRuntimeTask({
            sessionId,
            input: notation,
            model: model || null,
            mode: 'notation',
            transport: 'http',
            metadata: { route: '/api/notation', helperMode },
        });

        const response = await createResponse({
            input: notation,
            previousResponseId: session.previousResponseId,
            contextMessages,
            recentMessages,
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
        await sessionStore.appendMessages(sessionId, [
            { role: 'user', content: notation },
            { role: 'assistant', content: outputText },
        ]);
        const structured = parseNotationResponse(outputText);
        const artifacts = await maybeGenerateOutputArtifact({
            sessionId,
            session,
            mode: 'notation',
            outputFormat,
            content: structured.result,
            prompt: notation,
            title: `notation-${helperMode}`,
            responseId: response.id,
            artifactIds,
            existingContent: context,
            model,
        });

        completeRuntimeTask(runtimeTask?.id, {
            responseId: response.id,
            output: structured.result,
            model: response.model || model || null,
            duration: Date.now() - startedAt,
            metadata: { helperMode },
        });

        res.json({
            sessionId,
            responseId: response.id,
            helperMode,
            artifacts,
            ...structured,
        });
    } catch (err) {
        failRuntimeTask(runtimeTask?.id, {
            error: err,
            duration: Date.now() - startedAt,
            model: req.body?.model || null,
            metadata: { helperMode: req.body?.helperMode || 'expand' },
        });
        next(err);
    }
});

function buildNotationInstructions(helperMode, context) {
    const base = `You are an AI notation helper. Users write in shorthand notation and you process it according to the specified mode.

Always respond with valid JSON in this format:
{
  "result": "the processed output",
  "annotations": [{"line": 1, "note": "explanation"}],
  "suggestions": ["suggestion 1", "suggestion 2"]
}`;

    const modeInstructions = {
        expand: '\n\nMODE: EXPAND - Take the shorthand notation and expand it into full, detailed content. Preserve the intent and structure while making it comprehensive and production-ready.',
        explain: '\n\nMODE: EXPLAIN - Analyze the notation and provide detailed explanations for each part. Break down what each element means and how it connects to the whole.',
        validate: '\n\nMODE: VALIDATE - Check the notation for correctness, completeness, and best practices. Flag any issues, missing elements, or improvements. Provide a corrected version if needed.',
    };

    let instructions = base + (modeInstructions[helperMode] || modeInstructions.expand);
    if (context) {
        instructions += `\n\nAdditional context provided by the user:\n${context}`;
    }

    return instructions;
}

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
