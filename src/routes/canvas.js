const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { sessionStore } = require('../session-store');
const { memoryService } = require('../memory/memory-service');
const { createResponse } = require('../openai-client');
const { buildSessionInstructions } = require('../session-instructions');

const router = Router();

const canvasSchema = {
    message: { required: true, type: 'string' },
    sessionId: { required: false, type: 'string' },
    canvasType: { required: false, type: 'string', enum: ['code', 'document', 'diagram'] },
    existingContent: { required: false, type: 'string' },
    model: { required: false, type: 'string' },
};

/**
 * POST /api/canvas
 * Canvas-mode interaction for structured content generation.
 * Returns structured JSON with content, metadata, and suggestions.
 */
router.post('/', validate(canvasSchema), async (req, res, next) => {
    try {
        const { message, canvasType = 'document', existingContent = '', model = null } = req.body;
        let { sessionId } = req.body;

        // Auto-create session
        let session;
        if (!sessionId) {
            session = await sessionStore.create({ mode: 'canvas', canvasType });
            sessionId = session.id;
        } else {
            session = await sessionStore.getOrCreate(sessionId, { mode: 'canvas', canvasType });
        }

        if (!session) {
            session = await sessionStore.get(sessionId);
        }
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }

        // Retrieve relevant memories
        const contextMessages = await memoryService.process(sessionId, message);

        // Build canvas-specific instructions
        const instructions = buildSessionInstructions(
            session,
            buildCanvasInstructions(canvasType, existingContent),
        );

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
            .filter((o) => o.type === 'message')
            .map((o) => o.content.map((c) => c.text).join(''))
            .join('\n');

        // Store in memory
        memoryService.rememberResponse(sessionId, outputText);

        // Parse the structured response
        const structured = parseCanvasResponse(outputText, canvasType);

        res.json({
            sessionId,
            responseId: response.id,
            canvasType,
            ...structured,
        });
    } catch (err) {
        next(err);
    }
});

/**
 * Build canvas-specific system instructions.
 */
function buildCanvasInstructions(canvasType, existingContent) {
    const base = `You are an AI assistant working in canvas mode. You generate structured content that can be displayed in an editable canvas interface.

Always respond with valid JSON in this format:
{
  "content": "the main generated content",
  "metadata": { "language": "...", "title": "..." },
  "suggestions": ["suggestion 1", "suggestion 2"]
}`;

    const typeInstructions = {
        code: `\n\nYou are generating CODE. Include the programming language in metadata.language. Provide working, well-commented code. Suggestions should be improvements or alternative approaches.`,
        document: `\n\nYou are generating a DOCUMENT. Use markdown formatting. Include a title in metadata.title. Suggestions should be ways to expand or improve the document.`,
        diagram: `\n\nYou are generating a DIAGRAM using Mermaid syntax. Include the diagram type in metadata.type (flowchart, sequence, etc). Suggestions should be ways to enhance the diagram.`,
    };

    let instructions = base + (typeInstructions[canvasType] || typeInstructions.document);

    if (existingContent) {
        instructions += `\n\nThe user has existing content that they want to modify or build upon:\n\`\`\`\n${existingContent}\n\`\`\``;
    }

    return instructions;
}

/**
 * Parse the AI response into structured canvas format.
 */
function parseCanvasResponse(text, canvasType) {
    try {
        // Try to parse as JSON first
        const parsed = JSON.parse(text);
        return {
            content: parsed.content || text,
            metadata: parsed.metadata || { type: canvasType },
            suggestions: parsed.suggestions || [],
        };
    } catch {
        // If not valid JSON, wrap in structure
        return {
            content: text,
            metadata: { type: canvasType },
            suggestions: [],
        };
    }
}

module.exports = router;
