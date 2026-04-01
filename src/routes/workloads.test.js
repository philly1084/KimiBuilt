'use strict';

const express = require('express');
const request = require('supertest');

const workloadsRouter = require('./workloads');

describe('/api workload routes', () => {
    function buildApp(service) {
        const app = express();
        app.use(express.json());
        app.locals.agentWorkloadService = service;
        app.use('/api', workloadsRouter);
        app.use((err, _req, res, _next) => {
            res.status(err.statusCode || 500).json({
                error: { message: err.message },
            });
        });
        return app;
    }

    test('returns 503 when deferred workloads are unavailable', async () => {
        const app = buildApp({
            isAvailable: jest.fn(() => false),
        });

        const response = await request(app).get('/api/sessions/session-1/workloads');

        expect(response.status).toBe(503);
        expect(response.body.error.message).toContain('Postgres');
    });

    test('creates a workload for a session', async () => {
        const service = {
            isAvailable: jest.fn(() => true),
            createWorkload: jest.fn(async (payload) => ({
                id: 'workload-1',
                ...payload,
            })),
        };
        const app = buildApp(service);

        const response = await request(app)
            .post('/api/sessions/session-1/workloads')
            .send({
                title: 'Daily brief',
                prompt: 'Summarize the latest blockers.',
                trigger: { type: 'manual' },
            });

        expect(response.status).toBe(201);
        expect(service.createWorkload).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session-1',
            title: 'Daily brief',
        }), null);
        expect(response.body.id).toBe('workload-1');
    });

    test('queues a manual run', async () => {
        const service = {
            isAvailable: jest.fn(() => true),
            runWorkloadNow: jest.fn(async () => ({
                id: 'run-1',
                workloadId: 'workload-1',
                reason: 'manual',
            })),
        };
        const app = buildApp(service);

        const response = await request(app)
            .post('/api/workloads/workload-1/run')
            .send({});

        expect(response.status).toBe(202);
        expect(service.runWorkloadNow).toHaveBeenCalledWith('workload-1', null, expect.objectContaining({
            reason: 'manual',
        }));
        expect(response.body.id).toBe('run-1');
    });

    test('lists workload runs', async () => {
        const service = {
            isAvailable: jest.fn(() => true),
            listRunsForWorkload: jest.fn(async () => ([
                { id: 'run-1', status: 'queued' },
                { id: 'run-2', status: 'completed' },
            ])),
        };
        const app = buildApp(service);

        const response = await request(app).get('/api/workloads/workload-1/runs?limit=2');

        expect(response.status).toBe(200);
        expect(service.listRunsForWorkload).toHaveBeenCalledWith('workload-1', null, 2);
        expect(response.body.count).toBe(2);
    });
});
