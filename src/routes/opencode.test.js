'use strict';

const express = require('express');
const request = require('supertest');

const opencodeRouter = require('./opencode');

function buildApp(service) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { username: 'phill' };
        next();
    });
    app.locals.opencodeService = service;
    app.use('/api', opencodeRouter);
    return app;
}

describe('/api/opencode routes', () => {
    test('creates a synchronous OpenCode run', async () => {
        const service = {
            createRun: jest.fn(async () => ({
                id: 'run-1',
                status: 'completed',
                workspacePath: 'C:/Users/phill/KimiBuilt',
                summary: 'Build fixed.',
            })),
        };

        const response = await request(buildApp(service))
            .post('/api/opencode/runs')
            .send({
                prompt: 'Fix the build.',
                workspacePath: 'C:/Users/phill/KimiBuilt',
            });

        expect(response.status).toBe(200);
        expect(service.createRun).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: 'Fix the build.',
                workspacePath: 'C:/Users/phill/KimiBuilt',
            }),
            'phill',
            { requirePersistence: true },
        );
        expect(response.body.data).toEqual(expect.objectContaining({
            id: 'run-1',
            status: 'completed',
        }));
    });

    test('returns 202 for asynchronous run creation', async () => {
        const service = {
            createRun: jest.fn(async () => ({
                id: 'run-async',
                status: 'queued',
            })),
        };

        const response = await request(buildApp(service))
            .post('/api/opencode/runs')
            .send({
                prompt: 'Fix the build.',
                async: true,
            });

        expect(response.status).toBe(202);
        expect(response.body.data).toEqual(expect.objectContaining({
            id: 'run-async',
            status: 'queued',
        }));
    });

    test('lists persisted run events over JSON', async () => {
        const service = {
            getRun: jest.fn(async () => ({
                id: 'run-1',
                status: 'running',
            })),
            listRunEvents: jest.fn(async () => ([
                {
                    id: '1',
                    eventType: 'queued',
                    payload: { target: 'local' },
                },
                {
                    id: '2',
                    eventType: 'completed',
                    payload: { diffCount: 2 },
                },
            ])),
        };

        const response = await request(buildApp(service))
            .get('/api/opencode/runs/run-1/events');

        expect(response.status).toBe(200);
        expect(service.listRunEvents).toHaveBeenCalledWith('run-1', 'phill', expect.any(Object));
        expect(response.body.data).toHaveLength(2);
        expect(response.body.data[1]).toEqual(expect.objectContaining({
            eventType: 'completed',
        }));
    });
});
