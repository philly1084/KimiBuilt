'use strict';

const { Router } = require('express');

const router = Router();

function getOwnerId(req) {
    return String(req.user?.username || '').trim() || null;
}

function getService(req) {
    return req.app.locals.agentWorkloadService;
}

function handleUnavailable(res) {
    return res.status(503).json({
        error: {
            message: 'Deferred workloads require an active Postgres-backed session store',
        },
    });
}

router.post('/sessions/:id/workloads', async (req, res, next) => {
    try {
        const service = getService(req);
        if (!service?.isAvailable()) {
            return handleUnavailable(res);
        }

        const workload = await service.createWorkload({
            ...req.body,
            sessionId: req.params.id,
        }, getOwnerId(req));

        res.status(201).json(workload);
    } catch (error) {
        next(error);
    }
});

router.get('/sessions/:id/workloads', async (req, res, next) => {
    try {
        const service = getService(req);
        if (!service?.isAvailable()) {
            return handleUnavailable(res);
        }

        const workloads = await service.listSessionWorkloads(req.params.id, getOwnerId(req));
        res.json({
            sessionId: req.params.id,
            workloads,
            count: workloads.length,
        });
    } catch (error) {
        next(error);
    }
});

router.patch('/workloads/:id', async (req, res, next) => {
    try {
        const service = getService(req);
        if (!service?.isAvailable()) {
            return handleUnavailable(res);
        }

        const workload = await service.updateWorkload(req.params.id, getOwnerId(req), req.body || {});
        if (!workload) {
            return res.status(404).json({ error: { message: 'Workload not found' } });
        }

        res.json(workload);
    } catch (error) {
        next(error);
    }
});

router.get('/workloads/:id/project', async (req, res, next) => {
    try {
        const service = getService(req);
        if (!service?.isAvailable()) {
            return handleUnavailable(res);
        }

        const project = await service.getProjectPlan(req.params.id, getOwnerId(req));
        if (!project) {
            return res.status(404).json({ error: { message: 'Project workload not found' } });
        }

        res.json({
            workloadId: req.params.id,
            project,
        });
    } catch (error) {
        next(error);
    }
});

router.patch('/workloads/:id/project', async (req, res, next) => {
    try {
        const service = getService(req);
        if (!service?.isAvailable()) {
            return handleUnavailable(res);
        }

        const updated = await service.updateProjectPlan(
            req.params.id,
            getOwnerId(req),
            req.body?.project || req.body || {},
            {
                changeReason: req.body?.changeReason || req.body?.change_reason || null,
            },
        );
        if (!updated) {
            return res.status(404).json({ error: { message: 'Project workload not found' } });
        }

        res.json(updated);
    } catch (error) {
        next(error);
    }
});

router.post('/workloads/:id/run', async (req, res, next) => {
    try {
        const service = getService(req);
        if (!service?.isAvailable()) {
            return handleUnavailable(res);
        }

        const run = await service.runWorkloadNow(req.params.id, getOwnerId(req), {
            reason: 'manual',
            metadata: req.body?.metadata || {},
        });
        if (!run) {
            return res.status(404).json({ error: { message: 'Workload not found' } });
        }

        res.status(202).json(run);
    } catch (error) {
        next(error);
    }
});

router.post('/workloads/:id/pause', async (req, res, next) => {
    try {
        const service = getService(req);
        if (!service?.isAvailable()) {
            return handleUnavailable(res);
        }

        const workload = await service.pauseWorkload(req.params.id, getOwnerId(req));
        if (!workload) {
            return res.status(404).json({ error: { message: 'Workload not found' } });
        }

        res.json(workload);
    } catch (error) {
        next(error);
    }
});

router.post('/workloads/:id/resume', async (req, res, next) => {
    try {
        const service = getService(req);
        if (!service?.isAvailable()) {
            return handleUnavailable(res);
        }

        const workload = await service.resumeWorkload(req.params.id, getOwnerId(req));
        if (!workload) {
            return res.status(404).json({ error: { message: 'Workload not found' } });
        }

        res.json(workload);
    } catch (error) {
        next(error);
    }
});

router.delete('/workloads/:id', async (req, res, next) => {
    try {
        const service = getService(req);
        if (!service?.isAvailable()) {
            return handleUnavailable(res);
        }

        const deleted = await service.deleteWorkload(req.params.id, getOwnerId(req));
        if (!deleted) {
            return res.status(404).json({ error: { message: 'Workload not found' } });
        }

        res.status(204).end();
    } catch (error) {
        next(error);
    }
});

router.get('/workloads/:id/runs', async (req, res, next) => {
    try {
        const service = getService(req);
        if (!service?.isAvailable()) {
            return handleUnavailable(res);
        }

        const runs = await service.listRunsForWorkload(
            req.params.id,
            getOwnerId(req),
            Number.isFinite(Number(req.query.limit)) ? Math.max(1, Math.min(Number(req.query.limit), 100)) : 50,
        );
        res.json({
            workloadId: req.params.id,
            runs,
            count: runs.length,
        });
    } catch (error) {
        next(error);
    }
});

router.get('/runs/:id', async (req, res, next) => {
    try {
        const service = getService(req);
        if (!service?.isAvailable()) {
            return handleUnavailable(res);
        }

        const run = await service.getRun(req.params.id, getOwnerId(req));
        if (!run) {
            return res.status(404).json({ error: { message: 'Run not found' } });
        }

        res.json(run);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
