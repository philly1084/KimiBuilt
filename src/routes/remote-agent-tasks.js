'use strict';

const express = require('express');

const router = express.Router();
const { admit, limited } = require('./remote-ops-limits');
const streams = new Set();
router.use((req, res, next) => {
    const cancelling = req.method === 'POST' && req.path.endsWith('/cancel');
    const delay = admit(getOwnerId(req), cancelling ? 'legacy-cancel' : 'legacy-remote', { max: cancelling ? 6 : 30 });
    if (delay) return limited(res, delay);
    if (req.method === 'GET' && !req.path.endsWith('/stream')) {
        const pollDelay = admit(`${getOwnerId(req)}:${req.path}`, 'legacy-poll', { max: 1, windowMs: 10000 });
        if (pollDelay) return limited(res, pollDelay);
    }
    next();
});

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
            return res.status(404).json({ error: { message: 'Remote agent task not found' }, stopPolling: true });
        }

        res.json({ task });
    } catch (error) {
        next(error);
    }
});

router.get('/remote-agent-tasks/:id/transcript', async (req, res, next) => {
    try {
        const service = getService(req);
        const transcript = service.getTranscript(req.params.id, getOwnerId(req), req.query.after, req.query.limit);
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

        const streamKey = `${ownerId}:${req.params.id}`;
        if (streams.has(streamKey) || streams.size >= 32) return limited(res, 15, 'Only one stream per owned task is allowed.');
        streams.add(streamKey);
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();

        existingEvents.forEach((event) => {
            if (res.writableLength > 256 * 1024) { res.destroy(); return; }
            res.write(formatSseEvent(event));
        });
        if (existingEvents.some(event => event.type === 'exit' || (event.type === 'status' && ['completed', 'cancelled', 'failed', 'terminated', 'timed_out'].includes(event.status)))) {
            streams.delete(streamKey);
            return res.end();
        }

        const unsubscribe = service.subscribeToTask(req.params.id, ownerId, (event) => {
            if (res.writableLength > 256 * 1024) { res.destroy(); return; }
            res.write(formatSseEvent(event));
            if (event.type === 'exit' || (event.type === 'status' && ['completed', 'cancelled', 'failed', 'terminated', 'timed_out'].includes(event.status))) res.end();
        });

        const keepAlive = setInterval(() => {
            res.write(': keepalive\n\n');
        }, 15000);
        const deadline = setTimeout(() => res.end(), 300000);

        res.on('close', () => {
            streams.delete(streamKey);
            clearTimeout(deadline);
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
        if (error.statusCode === 404) return res.status(404).json({ success: false, error: 'Remote agent task not found', stopPolling: true });
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
