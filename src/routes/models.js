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
            .filter((m) => {
                const id = String(m.id || '').toLowerCase();
                return [
                    'gpt',
                    'claude',
                    'gemini',
                    'kimi',
                    'llama',
                    'mistral',
                    'qwen',
                    'phi',
                    'ollama',
                    'antigravity',
                    'deepseek',
                    'deepseak',
                ].some((token) => id.includes(token));
            })
            .filter(m => {
                const id = String(m.id || '').toLowerCase();
                return ![
                    'image',
                    'embedding',
                    'tts',
                    'transcribe',
                    'audio',
                    'realtime',
                    'vision-preview',
                    'preview-tools',
                    '-tools',
                ].some(token => id.includes(token));
            })
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
