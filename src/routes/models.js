const { Router } = require('express');
const { listModels } = require('../openai-client');
const { toPublicChatModelList } = require('../model-catalog');

const router = Router();

/**
 * GET /api/models
 * Get list of available chat models.
 * Follows OpenAI models API standard.
 */
router.get('/', async (_req, res, next) => {
    try {
        const models = await listModels();

        res.json({
            object: 'list',
            data: toPublicChatModelList(models),
        });
    } catch (err) {
        console.error('[Models] Error:', err.message);
        next(err);
    }
});

module.exports = router;
