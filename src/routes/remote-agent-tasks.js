'use strict';

const express = require('express');

const router = express.Router();

function getOwnerId(req) {
    return String(req.user?.username || '').trim() || null;
}

function getService(req) {
    const service = req.app.locals.remoteAgentTaskService;
    if (!service) {
        const error = new Error('Remote agent task service is not initialized');
        error.statusCode = 503;
        throw error;
    }
    return service;
}

router.post('/remote-agent-tasks', async (req, res, next) => {
    try {
        const service = getService(req);
        const created = await service.createTask(req.body || {}, getOwnerId(req));
        res.status(201).json(created);
    } catch (error) {
        next(error);
    }
});

router.get('/remote-agent-tasks/:id', async (req, res, next) => {
    try {
        const service = getService(req);
        const task = service.getPublicTask(req.params.id, getOwnerId(req));
        if (!task) {
            return res.status(404).json({ error: { message: 'Remote agent task not found' } });
        }

        res.json({ task });
    } catch (error) {
        next(error);
    }
});

router.get('/remote-agent-tasks/:id/transcript', async (req, res, next) => {
    try {
        const service = getService(req);
        const transcript = service.getTranscript(req.params.id, getOwnerId(req));
        if (!transcript) {
            return res.status(404).json({ error: { message: 'Remote agent task not found' } });
        }

        res.json(transcript);
    } catch (error) {
        next(error);
    }
});

router.get('/remote-agent-tasks/:id/stream', async (req, res, next) => {
    try {
        const service = getService(req);
        const ownerId = getOwnerId(req);
        const token = String(req.query.token || '').trim();
        if (!service.validateStreamToken(req.params.id, ownerId, token)) {
            return res.status(403).json({
                error: {
                    message: 'Invalid remote agent task stream token',
                },
            });
        }

        const existingEvents = service.listTaskEvents(req.params.id, ownerId, req.query.after);
        if (existingEvents == null) {
            return res.status(404).json({ error: { message: 'Remote agent task not found' } });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();

        existingEvents.forEach((event) => {
            res.write(formatSseEvent(event));
        });

        const unsubscribe = service.subscribeToTask(req.params.id, ownerId, (event) => {
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

router.post('/remote-agent-tasks/:id/cancel', async (req, res, next) => {
    try {
        const service = getService(req);
        const result = await service.cancelTask(req.params.id, getOwnerId(req));
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
