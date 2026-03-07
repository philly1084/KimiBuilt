const { Router } = require('express');
const { sessionStore } = require('../session-store');
const { memoryService } = require('../memory/memory-service');

const router = Router();

/**
 * POST /api/sessions
 * Create a new session.
 */
router.post('/', async (req, res, next) => {
    try {
    const { metadata } = req.body || {};
    const session = await sessionStore.create(metadata);
    res.status(201).json(session);
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/sessions
 * List all sessions.
 */
router.get('/', async (_req, res, next) => {
    try {
        const sessions = await sessionStore.list();
        res.json({ sessions, count: sessions.length });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/sessions/:id
 * Get a session by ID.
 */
router.get('/:id', async (req, res, next) => {
    try {
        const session = await sessionStore.get(req.params.id);
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }
        res.json(session);
    } catch (err) {
        next(err);
    }
});

/**
 * PATCH /api/sessions/:id
 * Update session metadata such as saved agent configuration.
 */
router.patch('/:id', async (req, res, next) => {
    try {
        const { metadata } = req.body || {};
        const session = await sessionStore.update(req.params.id, { metadata: metadata || {} });

        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }

        res.json(session);
    } catch (err) {
        next(err);
    }
});

/**
 * DELETE /api/sessions/:id
 * Delete a session and its associated memories.
 */
router.delete('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const session = await sessionStore.get(id);
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }

        // Clean up memories in Qdrant
        await memoryService.forget(id);

        // Remove from session store
        await sessionStore.delete(id);

        res.status(204).end();
    } catch (err) {
        next(err);
    }
});

module.exports = router;
