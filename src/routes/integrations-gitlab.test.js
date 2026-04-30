'use strict';

jest.mock('./admin/settings.controller', () => ({
    getEffectiveGitProviderConfig: jest.fn(() => ({
        webhookSecret: 'test-secret',
    })),
}));

const express = require('express');
const request = require('supertest');

const router = require('./integrations-gitlab');

describe('/api/integrations/gitlab', () => {
    function buildApp(service) {
        const app = express();
        app.use(express.json());
        app.locals.managedAppService = service;
        app.use('/api/integrations/gitlab', router);
        app.use((err, _req, res, _next) => {
            res.status(err.statusCode || 500).json({
                success: false,
                error: err.message,
            });
        });
        return app;
    }

    test('rejects webhook calls with the wrong secret', async () => {
        const app = buildApp({
            isAvailable: jest.fn(() => true),
            handleBuildEvent: jest.fn(),
        });

        const response = await request(app)
            .post('/api/integrations/gitlab/build-events')
            .set('X-KimiBuilt-Webhook-Secret', 'wrong')
            .send({ slug: 'arcade-demo' });

        expect(response.status).toBe(401);
    });

    test('forwards valid build events to the managed app service', async () => {
        const service = {
            isAvailable: jest.fn(() => true),
            handleBuildEvent: jest.fn(async () => ({
                app: { id: 'app-1', slug: 'arcade-demo' },
                deployed: true,
            })),
        };
        const app = buildApp(service);

        const response = await request(app)
            .post('/api/integrations/gitlab/build-events')
            .set('X-Gitlab-Token', 'test-secret')
            .send({
                repoOwner: 'agent-apps',
                repoName: 'arcade-demo',
                commitSha: 'abcdef123456',
                imageTag: 'sha-abcdef123456',
                buildStatus: 'success',
            });

        expect(response.status).toBe(200);
        expect(service.handleBuildEvent).toHaveBeenCalledWith(expect.objectContaining({
            repoName: 'arcade-demo',
            buildStatus: 'success',
        }));
        expect(response.body.success).toBe(true);
    });
});
