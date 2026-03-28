const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { sessionStore } = require('../session-store');
const { generateImage, listImageModels } = require('../openai-client');
const { searchImages, isConfigured: isUnsplashConfigured } = require('../unsplash-client');
const { buildProjectMemoryUpdate, mergeProjectMemory } = require('../project-memory');
const { persistGeneratedImages } = require('../generated-image-artifacts');

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
    prompt: { required: true, type: 'string' },
    sessionId: { required: false, type: 'string' },
    model: { required: false, type: 'string' },
    size: { required: false, type: 'string' },
    quality: { required: false, type: 'string' },
    style: { required: false, type: 'string' },
    n: { required: false, type: 'number' },
};

router.post('/', validate(imageSchema), async (req, res, next) => {
    try {
        const {
            prompt,
            model = null,
            size = '1024x1024',
            quality = 'standard',
            style = 'vivid',
            n = 1,
        } = req.body;
        let { sessionId } = req.body;
        const ownerId = getRequestOwnerId(req);

        let session;
        if (!sessionId) {
            session = await sessionStore.create({ mode: 'image', ownerId });
            sessionId = session.id;
        } else {
            session = await sessionStore.getOrCreateOwned(sessionId, { mode: 'image' }, ownerId);
        }

        if (!session) {
            session = await sessionStore.getOwned(sessionId, ownerId);
        }
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }

        console.log(`[Images] Generating image with ${model || 'gateway-default'}: "${prompt.substring(0, 50)}..."`);

        const response = await generateImage({
            prompt,
            model,
            size,
            quality,
            style,
            n: Math.min(n, 10),
        });
        const persistedImages = await persistGeneratedImages({
            sessionId,
            sourceMode: 'image',
            prompt,
            model: response?.model || model || null,
            images: response?.data || [],
        });
        const normalizedResponse = {
            ...response,
            data: persistedImages.images,
        };

        await sessionStore.recordResponse(sessionId, `img_${Date.now()}`);
        await updateSessionProjectMemory(sessionId, {
            userText: prompt,
            assistantText: `Generated ${Array.isArray(normalizedResponse?.data) ? normalizedResponse.data.length : n} image result(s).`,
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

        res.json({
            sessionId,
            created: normalizedResponse.created,
            data: normalizedResponse.data,
            artifacts: persistedImages.artifacts,
            model: normalizedResponse.model,
            size: normalizedResponse.size,
            quality: normalizedResponse.quality,
            style: normalizedResponse.style,
        });
    } catch (err) {
        console.error('[Images] Error:', err.message);
        next(err);
    }
});

router.get('/models', async (_req, res, next) => {
    try {
        const models = await listImageModels();
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
