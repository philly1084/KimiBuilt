const { Router } = require('express');
const { searchImages, isConfigured } = require('../unsplash-client');

const router = Router();

/**
 * GET /api/unsplash/search
 * Search for images on Unsplash.
 */
router.get('/search', async (req, res, next) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                error: {
                    message: 'Unsplash is not configured. Please set UNSPLASH_ACCESS_KEY environment variable.',
                    type: 'configuration_error',
                },
            });
        }

        const {
            q: query,
            page = '1',
            per_page: perPage = '10',
            order_by: orderBy = 'relevant',
            orientation,
        } = req.query;

        if (!query) {
            return res.status(400).json({
                error: {
                    message: 'Missing required parameter: q (search query)',
                    type: 'invalid_request_error',
                },
            });
        }

        console.log(`[Unsplash] Searching: "${query}" (page: ${page}, perPage: ${perPage})`);

        const results = await searchImages(query, {
            page: parseInt(page, 10),
            perPage: parseInt(perPage, 10),
            orderBy,
            orientation,
        });

        res.json(results);
    } catch (err) {
        console.error('[Unsplash] Search error:', err.message);
        next(err);
    }
});

/**
 * GET /api/unsplash/health
 * Check Unsplash configuration status.
 */
router.get('/health', (_req, res) => {
    res.json({
        configured: isConfigured(),
        timestamp: new Date().toISOString(),
    });
});

module.exports = router;
