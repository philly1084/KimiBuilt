const { Router } = require('express');
const { listModels } = require('../openai-client');

const router = Router();

/**
 * GET /api/models
 * Get list of available chat models.
 * Follows OpenAI models API standard.
 */
router.get('/', async (_req, res, next) => {
    try {
        const models = await listModels();
        
        // Filter to chat/completion models and format response
        const chatModels = models
            .filter(m => 
                m.id.includes('gpt') || 
                m.id.includes('claude') || 
                m.id.includes('llama') ||
                m.id.includes('mistral') ||
                m.id.includes('gemini')
            )
            .map(m => ({
                id: m.id,
                object: m.object || 'model',
                created: m.created || Math.floor(Date.now() / 1000),
                owned_by: m.owned_by || 'unknown',
            }));

        res.json({
            object: 'list',
            data: chatModels,
        });
    } catch (err) {
        console.error('[Models] Error:', err.message);
        next(err);
    }
});

module.exports = router;
