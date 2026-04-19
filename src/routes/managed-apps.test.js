'use strict';

const express = require('express');
const request = require('supertest');

const managedAppsRouter = require('./managed-apps');

describe('/api managed app routes', () => {
    function buildApp(service) {
        const app = express();
        app.use(express.json());
        app.locals.managedAppService = service;
        app.use('/api', managedAppsRouter);
        app.use((err, _req, res, _next) => {
            res.status(err.statusCode || 500).json({
                error: { message: err.message },
            });
        });
        return app;
    }

    test('lists managed apps', async () => {
        const service = {
            isAvailable: jest.fn(() => true),
            listApps: jest.fn(async () => ([{ id: 'app-1', slug: 'arcade-demo' }])),
        };
        const app = buildApp(service);

        const response = await request(app).get('/api/managed-apps');

        expect(response.status).toBe(200);
        expect(service.listApps).toHaveBeenCalledWith(null, 50);
        expect(response.body.count).toBe(1);
    });

    test('creates a managed app', async () => {
        const service = {
            isAvailable: jest.fn(() => true),
            createApp: jest.fn(async () => ({
                app: { id: 'app-1', slug: 'arcade-demo' },
                message: 'Queued build.',
            })),
        };
        const app = buildApp(service);

        const response = await request(app)
            .post('/api/managed-apps')
            .send({
                action: 'create',
                appName: 'Arcade Demo',
            });

        expect(response.status).toBe(201);
        expect(service.createApp).toHaveBeenCalledWith(expect.objectContaining({
            appName: 'Arcade Demo',
        }), null, expect.objectContaining({
            sessionId: null,
        }));
        expect(response.body.app.slug).toBe('arcade-demo');
    });

    test('deploys a managed app', async () => {
        const service = {
            isAvailable: jest.fn(() => true),
            deployApp: jest.fn(async () => ({
                app: { id: 'app-1', slug: 'arcade-demo' },
                deployment: { namespace: 'app-arcade-demo' },
            })),
        };
        const app = buildApp(service);

        const response = await request(app)
            .post('/api/managed-apps/arcade-demo/deploy')
            .send({
                imageTag: 'sha-abcdef123456',
            });

        expect(response.status).toBe(202);
        expect(service.deployApp).toHaveBeenCalledWith(
            'arcade-demo',
            expect.objectContaining({ imageTag: 'sha-abcdef123456' }),
            null,
            expect.objectContaining({ sessionId: null }),
        );
    });
});
