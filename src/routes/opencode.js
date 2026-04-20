'use strict';

const express = require('express');
const { config } = require('../config');

const router = express.Router();

function getOwnerId(req) {
    return String(req.user?.username || '').trim() || null;
}

function getService(req) {
    if (config.opencode.enabled === false) {
        const error = new Error('OpenCode is disabled');
        error.statusCode = 404;
        throw error;
    }

    const service = req.app.locals.opencodeService;
    if (!service) {
        const error = new Error('OpenCode service is not initialized');
        error.statusCode = 503;
        throw error;
    }
    return service;
}

router.post('/opencode/runs', async (req, res, next) => {
    try {
        const service = getService(req);
        const run = await service.createRun(req.body || {}, getOwnerId(req), {
            requirePersistence: true,
        });
        res.status((req.body || {}).async === true ? 202 : 200).json({
            success: true,
            data: run,
        });
    } catch (error) {
        next(error);
    }
});

router.get('/opencode/runs/:id', async (req, res, next) => {
    try {
        const service = getService(req);
        const run = await service.getRun(req.params.id, getOwnerId(req));
        if (!run) {
            return res.status(404).json({ success: false, error: 'OpenCode run not found' });
        }
        res.json({ success: true, data: run });
    } catch (error) {
        next(error);
    }
});

router.post('/opencode/runs/:id/cancel', async (req, res, next) => {
    try {
        const service = getService(req);
        const run = await service.cancelRun(req.params.id, getOwnerId(req));
        res.json({ success: true, data: run });
    } catch (error) {
        next(error);
    }
});

router.post('/opencode/runs/:id/permissions/:permissionId', async (req, res, next) => {
    try {
        const service = getService(req);
        const run = await service.respondToPermission(
            req.params.id,
            req.params.permissionId,
            req.body || {},
            getOwnerId(req),
        );
        res.json({ success: true, data: run });
    } catch (error) {
        next(error);
    }
});

router.get('/opencode/runs/:id/events', async (req, res, next) => {
    try {
        const service = getService(req);
        const ownerId = getOwnerId(req);
        const wantsSse = /\btext\/event-stream\b/i.test(String(req.get('accept') || ''))
            || ['1', 'true', 'yes'].includes(String(req.query.stream || '').trim().toLowerCase());
        const afterId = String(req.get('last-event-id') || req.query.after || '').trim() || null;

        if (!wantsSse) {
            const events = await service.listRunEvents(req.params.id, ownerId, {
                afterId,
                limit: req.query.limit,
            });
            return res.json({ success: true, data: events });
        }

        const run = await service.getRun(req.params.id, ownerId);
        if (!run) {
            return res.status(404).json({ success: false, error: 'OpenCode run not found' });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();

        const existingEvents = await service.listRunEvents(req.params.id, ownerId, {
            afterId,
            limit: 1000,
        });
        existingEvents.forEach((event) => {
            res.write(formatSseEvent(event));
        });

        const unsubscribe = service.subscribeToRunEvents(req.params.id, (event) => {
            if (afterId && Number(event.id) <= Number(afterId)) {
                return;
            }
            res.write(formatSseEvent(event));
        });

        const keepAlive = setInterval(() => {
            res.write(': keepalive\n\n');
        }, 15000);

        req.on('close', () => {
            clearInterval(keepAlive);
            unsubscribe();
            res.end();
        });
    } catch (error) {
        next(error);
    }
});

function formatSseEvent(event = {}) {
    return [
        `id: ${event.id}`,
        `event: ${event.eventType || 'message'}`,
        `data: ${JSON.stringify(event)}`,
        '',
    ].join('\n');
}

module.exports = router;
