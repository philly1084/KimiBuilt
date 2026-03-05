const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { sessionStore } = require('../session-store');
const { generateImage } = require('../openai-client');

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
        if (!sessionId) {
            const session = sessionStore.create({ mode: 'image' });
            sessionId = session.id;
        }

        const session = sessionStore.get(sessionId);
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
        sessionStore.recordResponse(sessionId, `img_${Date.now()}`);

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

module.exports = router;
