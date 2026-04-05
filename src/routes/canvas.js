const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { sessionStore } = require('../session-store');
const { memoryService } = require('../memory/memory-service');
const { executeConversationRuntime, resolveConversationExecutorFlag } = require('../runtime-execution');
const { buildInstructionsWithArtifacts, maybeGenerateOutputArtifact, resolveReasoningEffort } = require('../ai-route-utils');
const { extractResponseText } = require('../artifacts/artifact-service');
const { startRuntimeTask, completeRuntimeTask, failRuntimeTask } = require('../admin/runtime-monitor');
const { buildDashboardTemplatePromptContext, isDashboardRequest } = require('../dashboard-template-catalog');
const { normalizeMemoryKeywords } = require('../memory/memory-keywords');
const {
    buildScopedSessionMetadata,
    resolveClientSurface,
    resolveSessionScope,
} = require('../session-scope');

const router = Router();

function normalizeClientNow(value = '') {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return null;
    }

    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function getRequestOwnerId(req) {
    return String(req.user?.username || '').trim() || null;
}

function buildOwnerMemoryMetadata(ownerId = null, memoryScope = null, extra = {}) {
    return {
        ...(ownerId ? { ownerId } : {}),
        ...(memoryScope ? { memoryScope } : {}),
        ...extra,
    };
}

const canvasSchema = {
    message: { required: true, type: 'string' },
    sessionId: { required: false, type: 'string' },
    canvasType: { required: false, type: 'string', enum: ['code', 'document', 'diagram', 'frontend'] },
    existingContent: { required: false, type: 'string' },
    model: { required: false, type: 'string' },
    reasoningEffort: { required: false, type: 'string', enum: ['low', 'medium', 'high', 'xhigh'] },
    reasoning_effort: { required: false, type: 'string', enum: ['low', 'medium', 'high', 'xhigh'] },
    reasoning: { required: false, type: 'object' },
    artifactIds: { required: false, type: 'array' },
    outputFormat: { required: false, type: 'string' },
    enableConversationExecutor: { required: false, type: 'boolean' },
    useAgentExecutor: { required: false, type: 'boolean' },
    executionProfile: { required: false, type: 'string' },
    memoryKeywords: { required: false, type: 'array' },
};

function inferFrontendTitle(content = '') {
    const source = String(content || '').trim();
    if (!source) {
        return 'Frontend Demo';
    }

    const titleMatch = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch?.[1]) {
        return titleMatch[1].replace(/\s+/g, ' ').trim();
    }

    const h1Match = source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match?.[1]) {
        return h1Match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    }

    return 'Frontend Demo';
}

function normalizeFrontendBundle(bundle = null, content = '') {
    const files = [];
    const source = bundle?.files;

    if (Array.isArray(source)) {
        source.forEach((entry) => {
            if (!entry || typeof entry !== 'object') {
                return;
            }

            const fileContent = typeof entry.content === 'string' ? entry.content : '';
            const filePath = String(entry.path || entry.name || '').trim();
            if (!filePath || !fileContent.trim()) {
                return;
            }

            files.push({
                path: filePath,
                language: String(entry.language || '').trim() || null,
                purpose: String(entry.purpose || '').trim() || null,
                content: fileContent,
            });
        });
    } else if (source && typeof source === 'object') {
        Object.entries(source).forEach(([filePath, fileContent]) => {
            if (!String(filePath || '').trim() || typeof fileContent !== 'string' || !fileContent.trim()) {
                return;
            }

            files.push({
                path: String(filePath).trim(),
                language: null,
                purpose: null,
                content: fileContent,
            });
        });
    }

    if (!files.find((entry) => entry.path.toLowerCase() === 'index.html') && String(content || '').trim()) {
        files.unshift({
            path: 'index.html',
            language: 'html',
            purpose: 'Standalone demo entry point for preview and export.',
            content: String(content || '').trim(),
        });
    }

    return {
        entry: String(bundle?.entry || 'index.html').trim() || 'index.html',
        files,
    };
}

function normalizeFrontendHandoff(handoff = null, metadata = {}, content = '') {
    const targetFramework = String(
        handoff?.targetFramework
        || handoff?.framework
        || metadata.frameworkTarget
        || 'static'
    ).trim() || 'static';

    const componentMap = Array.isArray(handoff?.componentMap)
        ? handoff.componentMap
            .map((entry) => ({
                name: String(entry?.name || '').trim(),
                purpose: String(entry?.purpose || '').trim(),
                targetPath: String(entry?.targetPath || '').trim() || null,
            }))
            .filter((entry) => entry.name && entry.purpose)
        : [];

    const integrationSteps = Array.isArray(handoff?.integrationSteps)
        ? handoff.integrationSteps
            .map((entry) => String(entry || '').trim())
            .filter(Boolean)
        : [];

    return {
        summary: String(
            handoff?.summary
            || metadata.summary
            || 'Portable frontend demo with a standalone HTML preview and repo-ready file guidance.'
        ).trim() || 'Portable frontend demo with a standalone HTML preview and repo-ready file guidance.',
        targetFramework,
        componentMap,
        integrationSteps: integrationSteps.length > 0
            ? integrationSteps
            : [
                'Keep the generated demo as a visual reference first, then split it into project components.',
                'Move shared colors, spacing, and typography into your design system tokens.',
                'Replace demo copy, mock data, and inline scripts with live project data and components.',
            ],
        entryFile: String(handoff?.entryFile || 'index.html').trim() || 'index.html',
        sourceType: /<html\b/i.test(String(content || '')) ? 'standalone-html' : 'markup-fragment',
    };
}

function buildFrontendFallbackMetadata(content = '') {
    const title = inferFrontendTitle(content);
    return {
        type: 'frontend',
        title,
        language: 'html',
        frameworkTarget: 'static',
        previewMode: 'iframe',
        bundle: normalizeFrontendBundle(null, content),
        handoff: normalizeFrontendHandoff({ summary: `Standalone frontend demo for ${title}.` }, {}, content),
    };
}

function normalizeFrontendMetadata(metadata = {}, content = '') {
    const normalized = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? { ...metadata }
        : {};

    return {
        ...normalized,
        type: 'frontend',
        title: String(normalized.title || '').trim() || inferFrontendTitle(content),
        language: String(normalized.language || 'html').trim() || 'html',
        frameworkTarget: String(normalized.frameworkTarget || normalized.framework || 'static').trim() || 'static',
        previewMode: 'iframe',
        bundle: normalizeFrontendBundle(normalized.bundle, content),
        handoff: normalizeFrontendHandoff(normalized.handoff, normalized, content),
    };
}

router.post('/', validate(canvasSchema), async (req, res, next) => {
    let runtimeTask = null;
    const startedAt = Date.now();
    try {
        const {
            message,
            canvasType = 'document',
            existingContent = '',
            model = null,
            reasoning: _ignoredReasoning = null,
            artifactIds = [],
            outputFormat = null,
            executionProfile = null,
        } = req.body;
        const reasoningEffort = resolveReasoningEffort(req.body);
        const enableConversationExecutor = resolveConversationExecutorFlag(req.body);
        let { sessionId } = req.body;
        const memoryKeywords = normalizeMemoryKeywords(
            req.body.memoryKeywords || req.body?.metadata?.memoryKeywords || [],
        );
        const ownerId = getRequestOwnerId(req);
        const requestTimezone = String(
            req.body?.metadata?.timezone
            || req.body?.metadata?.timeZone
            || req.get('x-timezone')
            || '',
        ).trim() || null;
        const requestNow = normalizeClientNow(
            req.body?.metadata?.clientNow
            || req.body?.metadata?.client_now
            || req.get('x-client-now')
            || '',
        );
        const effectiveRequestMetadata = {
            ...(req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {}),
            ...(requestTimezone ? { timezone: requestTimezone } : {}),
            ...(requestNow ? { clientNow: requestNow } : {}),
            ...(memoryKeywords.length > 0 ? { memoryKeywords } : {}),
        };
        const requestedClientSurface = resolveClientSurface(req.body || {}, null, 'canvas');
        const requestedSessionMetadata = buildScopedSessionMetadata({
            ...effectiveRequestMetadata,
            mode: 'canvas',
            taskType: 'canvas',
            canvasType,
            clientSurface: requestedClientSurface,
        });

        const session = await sessionStore.resolveOwnedSession(
            sessionId,
            requestedSessionMetadata,
            ownerId,
        );
        if (session) {
            sessionId = session.id;
        }
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }
        const clientSurface = resolveClientSurface(req.body || {}, session, 'canvas');
        const memoryScope = resolveSessionScope({
            ...requestedSessionMetadata,
            clientSurface,
        }, session);

        runtimeTask = startRuntimeTask({
            sessionId,
            input: message,
            model: model || null,
            mode: 'canvas',
            transport: 'http',
            metadata: { route: '/api/canvas', canvasType, phase: 'preflight', reasoningEffort },
        });
        const instructions = await buildInstructionsWithArtifacts(
            session,
            buildCanvasInstructions(canvasType, existingContent, message),
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
            reasoningEffort,
            toolContext: {
                sessionId,
                route: '/api/canvas',
                transport: 'http',
                memoryService,
                ownerId,
                clientSurface,
                memoryScope,
                memoryKeywords,
                timezone: requestTimezone,
                now: requestNow,
                workloadService: req.app.locals.agentWorkloadService,
            },
            executionProfile,
            enableConversationExecutor,
            taskType: 'canvas',
            clientSurface,
            memoryScope,
            metadata: {
                ...effectiveRequestMetadata,
                clientSurface,
            },
            ownerId,
        });
        const response = execution.response;
        if (!execution.handledPersistence) {
            await sessionStore.recordResponse(sessionId, response.id);
        }

        const outputText = extractResponseText(response);
        if (!execution.handledPersistence) {
            memoryService.rememberResponse(sessionId, outputText, buildOwnerMemoryMetadata(ownerId, memoryScope, {
                sourceSurface: clientSurface || 'canvas',
                memoryKeywords,
            }));
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
            reasoningEffort,
            recentMessages: await sessionStore.getRecentMessages(sessionId),
        });
        if (artifacts.length > 0) {
            await Promise.all(artifacts.map((artifact) => memoryService.rememberArtifactResult(sessionId, {
                artifact,
                summary: `Created the ${artifact.format || outputFormat || 'generated'} artifact (${artifact.filename}).`,
                sourceText: structured.content,
                metadata: buildOwnerMemoryMetadata(ownerId, memoryScope, {
                    sourceSurface: clientSurface || 'canvas',
                    memoryKeywords,
                    sourcePrompt: message,
                }),
            })));
            await memoryService.rememberLearnedSkill(sessionId, {
                objective: message,
                assistantText: structured.content,
                toolEvents: response?.metadata?.toolEvents || [],
                artifact: artifacts[artifacts.length - 1],
                metadata: buildOwnerMemoryMetadata(ownerId, memoryScope, {
                    sourceSurface: clientSurface || 'canvas',
                    memoryKeywords,
                }),
            });
        }

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
            metadata: { canvasType: req.body?.canvasType || 'document', reasoningEffort: resolveReasoningEffort(req.body) },
        });
        next(err);
    }
});

function buildCanvasInstructions(canvasType, existingContent, requestPrompt = '') {
    const base = `You are an AI assistant working in canvas mode. You generate structured content that can be displayed in an editable canvas interface.

Always respond with valid JSON in this format:
{
  "content": "the main generated content",
  "metadata": { "language": "...", "title": "..." },
  "suggestions": ["suggestion 1", "suggestion 2"]
}`;
    const dashboardPromptContext = canvasType === 'frontend' && isDashboardRequest(requestPrompt, existingContent)
        ? buildDashboardTemplatePromptContext({
            prompt: requestPrompt,
            existingContent,
            limit: 3,
        })
        : '';

    const typeInstructions = {
        code: '\n\nYou are generating CODE. Include the programming language in metadata.language. Provide working, well-commented code. Suggestions should be improvements or alternative approaches.',
        document: '\n\nYou are generating a DOCUMENT. Use markdown formatting. Include a title in metadata.title. Suggestions should be ways to expand or improve the document.',
        diagram: '\n\nYou are generating a DIAGRAM using Mermaid syntax. Include the diagram type in metadata.type (flowchart, sequence, etc). Suggestions should be ways to enhance the diagram.',
        frontend: '\n\nYou are generating a DEMO WEBSITE FRONTEND. The content field must be ready-to-preview standalone HTML. Favor polished marketing sites, product pages, landing pages, editorial promos, dashboards, or microsites with deliberate visual direction. Include metadata.language as "html", metadata.frameworkTarget as "static", "react", or "nextjs", and metadata.previewMode as "iframe". Include metadata.bundle in the shape {"entry":"index.html","files":[{"path":"index.html","language":"html","purpose":"Preview entry","content":"..."},{"path":"styles.css","language":"css","purpose":"Shared styles","content":"..."},{"path":"app.js","language":"javascript","purpose":"Interactions","content":"..."}]}. Include metadata.handoff in the shape {"summary":"...","targetFramework":"...","componentMap":[{"name":"Hero","purpose":"...","targetPath":"src/components/Hero.jsx"}],"integrationSteps":["..."]}. Keep the demo portable so the bundle files can be copied into a real repository later. When the request is dashboard-oriented, choose one dashboard template from the provided catalog, include metadata.dashboardTemplate as {"id":"...","label":"...","rationale":"..."}, include metadata.dashboardTemplateOptions as [{"id":"...","label":"..."}], set <body data-dashboard-template="template-id">, and add data-dashboard-zone attributes on major layout regions. Suggestions should be concrete next frontend iterations.',
    };

    let instructions = base + (typeInstructions[canvasType] || typeInstructions.document);

    if (dashboardPromptContext) {
        instructions += `\n\n${dashboardPromptContext}`;
    }

    if (existingContent) {
        instructions += `\n\nThe user has existing content that they want to modify or build upon:\n\`\`\`\n${existingContent}\n\`\`\``;
    }

    return instructions;
}

function parseCanvasResponse(text, canvasType) {
    try {
        const parsed = JSON.parse(text);
        const parsedContent = typeof parsed.content === 'string'
            ? parsed.content
            : String(parsed.content || '');
        const metadata = canvasType === 'frontend'
            ? normalizeFrontendMetadata(parsed.metadata, parsedContent)
            : (parsed.metadata || { type: canvasType });
        return {
            content: parsedContent || text,
            metadata,
            suggestions: parsed.suggestions || [],
        };
    } catch {
        if (canvasType === 'frontend') {
            return {
                content: text,
                metadata: buildFrontendFallbackMetadata(text),
                suggestions: [],
            };
        }

        return {
            content: text,
            metadata: { type: canvasType },
            suggestions: [],
        };
    }
}

module.exports = router;
module.exports._private = {
    buildCanvasInstructions,
    parseCanvasResponse,
    buildFrontendFallbackMetadata,
    normalizeFrontendMetadata,
};

