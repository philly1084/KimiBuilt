const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { sessionStore } = require('../session-store');
const { generateImage } = require('../openai-client');
const { searchImages, isConfigured: isUnsplashConfigured } = require('../unsplash-client');

const router = Router();

const imageSchema = {
    prompt: { required: true, type: 'string' },
    sessionId: { required: false, type: 'string' },
    model: { required: false, type: 'string' },
    size: { required: false, type: 'string', enum: ['256x256', '512x512', '1024x1024', '1024x1792', '1792x1024'] },
    quality: { required: false, type: 'string', enum: ['standard', 'hd'] },
    style: { required: false, type: 'string', enum: ['vivid', 'natural'] },
    n: { required: false, type: 'number' },
};

/**
 * POST /api/images
 * Generate images using DALL-E or compatible API.
 * Follows OpenAI image generation API standard.
 */
router.post('/', validate(imageSchema), async (req, res, next) => {
    try {
        const {
            prompt,
            model = 'dall-e-3',
            size = '1024x1024',
            quality = 'standard',
            style = 'vivid',
            n = 1,
        } = req.body;
        let { sessionId } = req.body;

        // Auto-create session for image generation
        let session;
        if (!sessionId) {
            session = await sessionStore.create({ mode: 'image' });
            sessionId = session.id;
        } else {
            session = await sessionStore.getOrCreate(sessionId, { mode: 'image' });
        }

        if (!session) {
            session = await sessionStore.get(sessionId);
        }
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }

        console.log(`[Images] Generating image with ${model}: "${prompt.substring(0, 50)}..."`);

        const response = await generateImage({
            prompt,
            model,
            size,
            quality,
            style,
            n: Math.min(n, 10), // Max 10 images
        });

        // Store in session for history
        await sessionStore.recordResponse(sessionId, `img_${Date.now()}`);

        res.json({
            sessionId,
            created: response.created,
            data: response.data,
            model,
            size,
            quality,
            style,
        });
    } catch (err) {
        console.error('[Images] Error:', err.message);
        next(err);
    }
});

/**
 * GET /api/images/models
 * Get available image generation models.
 */
router.get('/models', (_req, res) => {
    res.json({
        models: [
            {
                id: 'dall-e-3',
                name: 'DALL-E 3',
                description: 'High quality images with detailed prompts',
                sizes: ['1024x1024', '1024x1792', '1792x1024'],
                qualities: ['standard', 'hd'],
                styles: ['vivid', 'natural'],
                maxImages: 1,
            },
            {
                id: 'dall-e-2',
                name: 'DALL-E 2',
                description: 'Faster, lower cost image generation',
                sizes: ['256x256', '512x512', '1024x1024'],
                qualities: ['standard'],
                styles: [],
                maxImages: 10,
            },
        ],
    });
});

/**
 * Schema for image search requests.
 */
const searchSchema = {
    query: { required: true, type: 'string' },
    source: { required: false, type: 'string', enum: ['unsplash'] },
    page: { required: false, type: 'number' },
    per_page: { required: false, type: 'number' },
    orientation: { required: false, type: 'string', enum: ['landscape', 'portrait', 'squarish'] },
};

/**
 * POST /api/images/search
 * Search for images from external sources (e.g., Unsplash).
 * Currently supports Unsplash as the image source.
 */
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
            // Check if Unsplash is configured
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
