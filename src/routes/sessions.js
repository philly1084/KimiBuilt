const { Router } = require('express');
const { sessionStore } = require('../session-store');
const { memoryService } = require('../memory/memory-service');
const { artifactService } = require('../artifacts/artifact-service');

const router = Router();

router.post('/', async (req, res, next) => {
    try {
        const { metadata } = req.body || {};
        const session = await sessionStore.create(metadata);
        res.status(201).json(session);
    } catch (err) {
        next(err);
    }
});

router.get('/', async (_req, res, next) => {
    try {
        const sessions = await sessionStore.list();
        res.json({ sessions, count: sessions.length });
    } catch (err) {
        next(err);
    }
});

router.get('/:id/artifacts', async (req, res, next) => {
    try {
        const session = await sessionStore.get(req.params.id);
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }

        const artifacts = await artifactService.listSessionArtifacts(req.params.id);
        res.json({ sessionId: req.params.id, artifacts, count: artifacts.length });
    } catch (err) {
        next(err);
    }
});

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

router.delete('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const session = await sessionStore.get(id);
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }

        await artifactService.deleteArtifactsForSession(id);
        await memoryService.forget(id);
        await sessionStore.delete(id);

        res.status(204).end();
    } catch (err) {
        next(err);
    }
});

module.exports = router;
