const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { sessionStore } = require('../session-store');
const { memoryService } = require('../memory/memory-service');
const { executeConversationRuntime, resolveConversationExecutorFlag } = require('../runtime-execution');
const { buildInstructionsWithArtifacts, maybeGenerateOutputArtifact } = require('../ai-route-utils');
const { startRuntimeTask, completeRuntimeTask, failRuntimeTask } = require('../admin/runtime-monitor');

const router = Router();

const canvasSchema = {
    message: { required: true, type: 'string' },
    sessionId: { required: false, type: 'string' },
    canvasType: { required: false, type: 'string', enum: ['code', 'document', 'diagram'] },
    existingContent: { required: false, type: 'string' },
    model: { required: false, type: 'string' },
    artifactIds: { required: false, type: 'array' },
    outputFormat: { required: false, type: 'string' },
    enableConversationExecutor: { required: false, type: 'boolean' },
    useAgentExecutor: { required: false, type: 'boolean' },
    executionProfile: { required: false, type: 'string' },
};

router.post('/', validate(canvasSchema), async (req, res, next) => {
    let runtimeTask = null;
    const startedAt = Date.now();
    try {
        const {
            message,
            canvasType = 'document',
            existingContent = '',
            model = null,
            artifactIds = [],
            outputFormat = null,
            executionProfile = null,
        } = req.body;
        const enableConversationExecutor = resolveConversationExecutorFlag(req.body);
        let { sessionId } = req.body;

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

        runtimeTask = startRuntimeTask({
            sessionId,
            input: message,
            model: model || null,
            mode: 'canvas',
            transport: 'http',
            metadata: { route: '/api/canvas', canvasType, phase: 'preflight' },
        });
        const instructions = await buildInstructionsWithArtifacts(
            session,
            buildCanvasInstructions(canvasType, existingContent),
            artifactIds,
        );

        const execution = await executeConversationRuntime(req.app, {
            input: message,
            sessionId,
            memoryInput: message,
            previousResponseId: session.previousResponseId,
            instructions,
            stream: false,
            model,
            executionProfile,
            enableConversationExecutor,
            taskType: 'canvas',
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
        const structured = parseCanvasResponse(outputText, canvasType);
        const artifacts = await maybeGenerateOutputArtifact({
            sessionId,
            session,
            mode: 'canvas',
            outputFormat,
            content: structured.content,
            prompt: message,
            title: structured.metadata?.title || 'canvas-output',
            responseId: response.id,
            artifactIds,
            existingContent,
            model,
        });

        completeRuntimeTask(runtimeTask?.id, {
            responseId: response.id,
            output: structured.content,
            model: response.model || model || null,
            duration: Date.now() - startedAt,
            metadata: {
                canvasType,
                ...(response?.metadata || {}),
            },
        });

        res.json({
            sessionId,
            responseId: response.id,
            canvasType,
            artifacts,
            ...structured,
        });
    } catch (err) {
        failRuntimeTask(runtimeTask?.id, {
            error: err,
            duration: Date.now() - startedAt,
            model: req.body?.model || null,
            metadata: { canvasType: req.body?.canvasType || 'document' },
        });
        next(err);
    }
});

function buildCanvasInstructions(canvasType, existingContent) {
    const base = `You are an AI assistant working in canvas mode. You generate structured content that can be displayed in an editable canvas interface.

Always respond with valid JSON in this format:
{
  "content": "the main generated content",
  "metadata": { "language": "...", "title": "..." },
  "suggestions": ["suggestion 1", "suggestion 2"]
}`;

    const typeInstructions = {
        code: '\n\nYou are generating CODE. Include the programming language in metadata.language. Provide working, well-commented code. Suggestions should be improvements or alternative approaches.',
        document: '\n\nYou are generating a DOCUMENT. Use markdown formatting. Include a title in metadata.title. Suggestions should be ways to expand or improve the document.',
        diagram: '\n\nYou are generating a DIAGRAM using Mermaid syntax. Include the diagram type in metadata.type (flowchart, sequence, etc). Suggestions should be ways to enhance the diagram.',
    };

    let instructions = base + (typeInstructions[canvasType] || typeInstructions.document);

    if (existingContent) {
        instructions += `\n\nThe user has existing content that they want to modify or build upon:\n\`\`\`\n${existingContent}\n\`\`\``;
    }

    return instructions;
}

function parseCanvasResponse(text, canvasType) {
    try {
        const parsed = JSON.parse(text);
        return {
            content: parsed.content || text,
            metadata: parsed.metadata || { type: canvasType },
            suggestions: parsed.suggestions || [],
        };
    } catch {
        return {
            content: text,
            metadata: { type: canvasType },
            suggestions: [],
        };
    }
}

module.exports = router;

