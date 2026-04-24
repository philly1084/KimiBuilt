'use strict';

const express = require('express');
const request = require('supertest');

const toolsRouter = require('./tools');

describe('/api/tools routes', () => {
    function buildApp() {
        const app = express();
        app.use(express.json());
        app.locals.managedAppService = {
            isAvailable: jest.fn(() => true),
            kubernetesClient: {
                isConfigured: jest.fn(() => true),
            },
        };
        app.use('/api/tools', toolsRouter);
        return app;
    }

    test('includeAll exposes managed-app in the admin tool catalog', async () => {
        const app = buildApp();

        const response = await request(app).get('/api/tools/available?includeAll=true');

        expect(response.status).toBe(200);
        expect(response.body.meta.includeAllTools).toBe(true);
        expect(response.body.data.map((tool) => tool.id)).toContain('managed-app');
        expect(response.body.meta.runtime.managedApps.deployTarget).toBe('runner');
    });

    test('default frontend catalog keeps managed-app hidden from end-user surfaces', async () => {
        const app = buildApp();

        const response = await request(app).get('/api/tools/available');

        expect(response.status).toBe(200);
        expect(response.body.meta.includeAllTools).toBe(false);
        expect(response.body.data.map((tool) => tool.id)).not.toContain('managed-app');
    });

    test('managed-app tool details report the remote deployment provider with runner target', async () => {
        const app = buildApp();

        const response = await request(app).get('/api/tools/managed-app');

        expect(response.status).toBe(200);
        expect(response.body.data.runtime.provider).toBe('external-gitea-plus-remote-k3s-over-ssh');
        expect(response.body.data.runtime.deployTarget).toBe('runner');
        expect(response.body.data.runtime.runnerAvailable).toBe(false);
    });
});
