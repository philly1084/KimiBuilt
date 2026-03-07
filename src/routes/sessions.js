const { Router } = require('express');
const { sessionStore } = require('../session-store');
const { memoryService } = require('../memory/memory-service');

const router = Router();

/**
 * POST /api/sessions
 * Create a new session.
 */
router.post('/', (req, res) => {
    const { metadata } = req.body || {};
    const session = sessionStore.create(metadata);
    res.status(201).json(session);
});

/**
 * GET /api/sessions
 * List all sessions.
 */
router.get('/', (_req, res) => {
    const sessions = sessionStore.list();
    res.json({ sessions, count: sessions.length });
});

/**
 * GET /api/sessions/:id
 * Get a session by ID.
 */
router.get('/:id', (req, res) => {
    const session = sessionStore.get(req.params.id);
    if (!session) {
        return res.status(404).json({ error: { message: 'Session not found' } });
    }
    res.json(session);
});

/**
 * PATCH /api/sessions/:id
 * Update session metadata such as saved agent configuration.
 */
router.patch('/:id', (req, res) => {
    const { metadata } = req.body || {};
    const session = sessionStore.update(req.params.id, { metadata: metadata || {} });

    if (!session) {
        return res.status(404).json({ error: { message: 'Session not found' } });
    }

    res.json(session);
});

/**
 * DELETE /api/sessions/:id
 * Delete a session and its associated memories.
 */
router.delete('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const session = sessionStore.get(id);
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }

        // Clean up memories in Qdrant
        await memoryService.forget(id);

        // Remove from session store
        sessionStore.delete(id);

        res.status(204).end();
    } catch (err) {
        next(err);
    }
});

module.exports = router;
