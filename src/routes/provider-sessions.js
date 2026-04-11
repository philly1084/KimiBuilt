'use strict';

const express = require('express');

const router = express.Router();

function getOwnerId(req) {
    return String(req.user?.username || '').trim() || null;
}

function getService(req) {
    const service = req.app.locals.providerSessionService;
    if (!service) {
        const error = new Error('Provider session service is not initialized');
        error.statusCode = 503;
        throw error;
    }
    return service;
}

router.get('/provider-capabilities', async (req, res, next) => {
    try {
        const service = getService(req);
        const data = await service.listCapabilities(getOwnerId(req));
        res.json({ data });
    } catch (error) {
        next(error);
    }
});

router.post('/provider-sessions', async (req, res, next) => {
    try {
        const service = getService(req);
        const created = await service.createSession(req.body || {}, getOwnerId(req));
        res.status(201).json(created);
    } catch (error) {
        next(error);
    }
});

router.get('/provider-sessions/:id', async (req, res, next) => {
    try {
        const service = getService(req);
        const session = service.getPublicSession(req.params.id, getOwnerId(req));
        if (!session) {
            return res.status(404).json({ error: { message: 'Provider session not found' } });
        }

        res.json({ session });
    } catch (error) {
        next(error);
    }
});

router.get('/provider-sessions/:id/stream', async (req, res, next) => {
    try {
        const service = getService(req);
        const ownerId = getOwnerId(req);
        const token = String(req.query.token || '').trim();
        if (!service.validateStreamToken(req.params.id, ownerId, token)) {
            return res.status(403).json({
                error: {
                    message: 'Invalid provider session stream token',
                },
            });
        }

        const existingEvents = service.listSessionEvents(req.params.id, ownerId, req.query.after);
        if (existingEvents == null) {
            return res.status(404).json({ error: { message: 'Provider session not found' } });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();

        existingEvents.forEach((event) => {
            res.write(formatSseEvent(event));
        });

        const unsubscribe = service.subscribeToSession(req.params.id, ownerId, (event) => {
            res.write(formatSseEvent(event));
        });

        const keepAlive = setInterval(() => {
            res.write(': keepalive\n\n');
        }, 15000);

        req.on('close', () => {
            clearInterval(keepAlive);
            unsubscribe?.();
            res.end();
        });
    } catch (error) {
        next(error);
    }
});

router.post('/provider-sessions/:id/input', async (req, res, next) => {
    try {
        const service = getService(req);
        const result = await service.sendInput(req.params.id, getOwnerId(req), req.body?.data || '');
        res.json(result);
    } catch (error) {
        next(error);
    }
});

router.post('/provider-sessions/:id/signal', async (req, res, next) => {
    try {
        const service = getService(req);
        const result = await service.sendSignal(req.params.id, getOwnerId(req), req.body?.signal || 'SIGINT');
        res.json(result);
    } catch (error) {
        next(error);
    }
});

router.post('/provider-sessions/:id/resize', async (req, res, next) => {
    try {
        const service = getService(req);
        const result = await service.resizeSession(req.params.id, getOwnerId(req), req.body?.cols, req.body?.rows);
        res.json(result);
    } catch (error) {
        next(error);
    }
});

router.delete('/provider-sessions/:id', async (req, res, next) => {
    try {
        const service = getService(req);
        const result = await service.deleteSession(req.params.id, getOwnerId(req));
        res.json(result);
    } catch (error) {
        next(error);
    }
});

function formatSseEvent(event = {}) {
    return [
        `id: ${event.cursor}`,
        `event: ${event.type || 'message'}`,
        `data: ${JSON.stringify(event)}`,
        '',
    ].join('\n');
}

module.exports = router;
