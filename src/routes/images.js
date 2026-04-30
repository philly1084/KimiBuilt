const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { sessionStore } = require('../session-store');
const { generateImageBatch, listImageModels } = require('../openai-client');
const { searchImages, isConfigured: isUnsplashConfigured } = require('../unsplash-client');
const { buildProjectMemoryUpdate, mergeProjectMemory } = require('../project-memory');
const { persistGeneratedImages } = require('../generated-image-artifacts');
const {
    buildScopedSessionMetadata,
    resolveClientSurface,
    resolveSessionScope,
} = require('../session-scope');

const router = Router();

function getRequestOwnerId(req) {
    return String(req.user?.username || '').trim() || null;
}

async function updateSessionProjectMemory(sessionId, updates = {}, ownerId = null) {
    if (!sessionId) {
        return null;
    }

    const session = ownerId
        ? await sessionStore.getOwned(sessionId, ownerId)
        : await sessionStore.get(sessionId);
    if (!session) {
        return null;
    }

    return sessionStore.update(sessionId, {
        metadata: {
            projectMemory: mergeProjectMemory(
                session?.metadata?.projectMemory || {},
                buildProjectMemoryUpdate(updates),
            ),
        },
    });
}

const imageSchema = {
    sessionId: { required: false, type: 'string' },
    model: { required: false, type: 'string' },
    size: { required: false, type: 'string' },
    quality: { required: false, type: 'string' },
    style: { required: false, type: 'string' },
    background: { required: false, type: 'string' },
    response_format: { required: false, type: 'string' },
    output_format: { required: false, type: 'string' },
    output_compression: { required: false, type: 'number' },
    moderation: { required: false, type: 'string' },
    user: { required: false, type: 'string' },
    n: { required: false, type: 'number' },
    batchMode: { required: false, type: 'string', enum: ['auto', 'single', 'parallel'] },
};

function extractPromptText(value, depth = 0) {
    if (depth > 8 || value == null) {
        return '';
    }
    if (typeof value === 'string') {
        return value.trim();
    }
    if (Array.isArray(value)) {
        return value.map((entry) => extractPromptText(entry, depth + 1)).filter(Boolean).join(' ').trim();
    }
    if (typeof value === 'object') {
        return ['text', 'input_text', 'output_text', 'content', 'value']
            .map((key) => extractPromptText(value[key], depth + 1))
            .filter(Boolean)
            .join(' ')
            .trim();
    }
    return '';
}

function describePromptForLog(prompt) {
    return extractPromptText(prompt).replace(/\s+/g, ' ').slice(0, 50);
}

router.post('/', validate(imageSchema), async (req, res, next) => {
    try {
        const {
            prompt,
            model = null,
            size = 'auto',
            quality = 'auto',
            style = null,
            background = 'auto',
            response_format = null,
            output_format = null,
            output_compression = null,
            moderation = null,
            user = null,
            n = 1,
            batchMode = 'auto',
        } = req.body;
        if (!extractPromptText(prompt)) {
            return res.status(400).json({
                error: {
                    type: 'validation_error',
                    message: 'Image generation requires a non-empty prompt.',
                },
            });
        }
        const promptText = extractPromptText(prompt);
        const requestedCount = Math.min(Math.max(Number(n) || 1, 1), 10);
        let { sessionId } = req.body;
        const ownerId = getRequestOwnerId(req);
        const requestedClientSurface = resolveClientSurface(req.body || {}, null, 'image');
        const requestedSessionMetadata = buildScopedSessionMetadata({
            mode: 'image',
            taskType: 'image',
            clientSurface: requestedClientSurface,
        });

        const session = ownerId
            ? await sessionStore.resolveOwnedSession(sessionId, requestedSessionMetadata, ownerId)
            : sessionId
                ? await sessionStore.getOrCreate(sessionId, requestedSessionMetadata)
                : await sessionStore.create(requestedSessionMetadata);
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }
        sessionId = session.id;
        const clientSurface = resolveClientSurface(req.body || {}, session, 'image');
        const memoryScope = resolveSessionScope({
            ...requestedSessionMetadata,
            clientSurface,
        }, session);

        console.log(`[Images] Generating image with ${model || 'gateway-default'}: "${describePromptForLog(prompt)}..."`);

        const response = await generateImageBatch({
            prompt,
            model,
            size,
            quality,
            style,
            background,
            response_format,
            output_format,
            output_compression,
            moderation,
            user,
            n: requestedCount,
            batchMode,
        });
        const persistedImages = await persistGeneratedImages({
            sessionId,
            sourceMode: 'image',
            prompt: promptText,
            model: response?.model || model || null,
            images: response?.data || [],
        });
        const normalizedResponse = {
            ...response,
            data: persistedImages.images,
        };

        await sessionStore.recordResponse(sessionId, `img_${Date.now()}`);
        await updateSessionProjectMemory(sessionId, {
            userText: promptText,
            assistantText: `Generated ${Array.isArray(normalizedResponse?.data) ? normalizedResponse.data.length : requestedCount} image result(s).`,
            artifacts: persistedImages.artifacts,
            toolEvents: [{
                toolCall: { function: { name: 'image-generate' } },
                result: {
                    success: true,
                    toolId: 'image-generate',
                    data: normalizedResponse,
                    error: null,
                },
                reason: 'Image generation request',
            }],
        }, ownerId);
        await sessionStore.update(sessionId, {
            metadata: {
                clientSurface,
                memoryScope,
            },
        });

        res.json({
            sessionId,
            created: normalizedResponse.created,
            data: normalizedResponse.data,
            artifacts: persistedImages.artifacts,
            model: normalizedResponse.model,
            size: normalizedResponse.size,
            quality: normalizedResponse.quality,
            style: normalizedResponse.style,
            background: normalizedResponse.background,
            output_format: normalizedResponse.output_format,
            output_compression: normalizedResponse.output_compression,
            moderation: normalizedResponse.moderation,
            batch: normalizedResponse.batch,
        });
    } catch (err) {
        console.error('[Images] Error:', err.message);
        next(err);
    }
});

router.get('/models', async (_req, res, next) => {
    try {
        const models = await listImageModels();
        res.set('Cache-Control', 'no-store');
        res.json({ models });
    } catch (err) {
        next(err);
    }
});

const searchSchema = {
    query: { required: true, type: 'string' },
    source: { required: false, type: 'string', enum: ['unsplash'] },
    page: { required: false, type: 'number' },
    per_page: { required: false, type: 'number' },
    orientation: { required: false, type: 'string', enum: ['landscape', 'portrait', 'squarish'] },
};

router.post('/search', validate(searchSchema), async (req, res, next) => {
    try {
        const {
            query,
            source = 'unsplash',
            page = 1,
            per_page = 10,
            orientation,
        } = req.body;

        if (source === 'unsplash') {
            if (!isUnsplashConfigured()) {
                return res.status(503).json({
                    error: {
                        type: 'service_unavailable',
                        message: 'Unsplash integration is not configured. Set UNSPLASH_ACCESS_KEY environment variable.',
                    },
                });
            }

            console.log(`[Images] Searching Unsplash: "${query}" (page=${page}, per_page=${per_page})`);

            const results = await searchImages(query, {
                page,
                perPage: per_page,
                orientation,
            });

            res.json({
                source: 'unsplash',
                query,
                total: results.total,
                total_pages: results.totalPages,
                results: results.results,
            });
        } else {
            return res.status(400).json({
                error: {
                    type: 'validation_error',
                    message: `Unsupported image source: ${source}. Supported sources: unsplash`,
                },
            });
        }
    } catch (err) {
        console.error('[Images] Search error:', err.message);
        next(err);
    }
});

module.exports = router;
