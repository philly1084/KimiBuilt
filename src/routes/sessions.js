const { Router } = require('express');
const { sessionStore } = require('../session-store');
const { memoryService } = require('../memory/memory-service');
const { artifactService } = require('../artifacts/artifact-service');

const router = Router();

function getRequestOwnerId(req) {
    return String(req.user?.username || '').trim() || null;
}

router.post('/', async (req, res, next) => {
    try {
        const { metadata } = req.body || {};
        const session = await sessionStore.create({
            ...(metadata || {}),
            ownerId: getRequestOwnerId(req),
        });
        res.status(201).json(session);
    } catch (err) {
        next(err);
    }
});

router.get('/', async (req, res, next) => {
    try {
        const sessions = await sessionStore.list({
            ownerId: getRequestOwnerId(req),
        });
        const workloadService = req.app?.locals?.agentWorkloadService;
        const summaries = workloadService?.isAvailable?.()
            ? await workloadService.getSessionSummaries(
                sessions.map((session) => session.id),
                getRequestOwnerId(req),
            )
            : {};
        const enrichedSessions = sessions.map((session) => ({
            ...session,
            workloadSummary: summaries[session.id] || {
                queued: 0,
                running: 0,
                failed: 0,
            },
        }));
        res.json({ sessions: enrichedSessions, count: enrichedSessions.length });
    } catch (err) {
        next(err);
    }
});

router.get('/:id/artifacts', async (req, res, next) => {
    try {
        const session = await sessionStore.getOwned(req.params.id, getRequestOwnerId(req));
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }

        const artifacts = await artifactService.listSessionArtifacts(req.params.id);
        res.json({ sessionId: req.params.id, artifacts, count: artifacts.length });
    } catch (err) {
        next(err);
    }
});

router.get('/:id/messages', async (req, res, next) => {
    try {
        const limit = Number(req.query?.limit || 100);
        const session = await sessionStore.getOwned(req.params.id, getRequestOwnerId(req));
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }

        const messages = await sessionStore.listMessages(
            req.params.id,
            Number.isFinite(limit) ? Math.max(1, Math.min(limit, 500)) : 100,
            getRequestOwnerId(req),
        );
        res.json({ sessionId: req.params.id, messages, count: messages.length });
    } catch (err) {
        next(err);
    }
});

router.get('/:id', async (req, res, next) => {
    try {
        const session = await sessionStore.getOwned(req.params.id, getRequestOwnerId(req));
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
        const existing = await sessionStore.getOwned(req.params.id, getRequestOwnerId(req));
        if (!existing) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }

        const session = await sessionStore.update(req.params.id, { metadata: metadata || {} });
        res.json(session);
    } catch (err) {
        next(err);
    }
});

router.delete('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const session = await sessionStore.getOwned(id, getRequestOwnerId(req));
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
