'use strict';

const express = require('express');
const request = require('supertest');

const toolsRouter = require('./tools');

describe('/api/tools routes', () => {
    function buildApp() {
        const app = express();
        app.use(express.json());
        app.use('/api/tools', toolsRouter);
        return app;
    }

    test('includeAll keeps managed-app out of the tool catalog', async () => {
        const app = buildApp();

        const response = await request(app).get('/api/tools/available?includeAll=true');

        expect(response.status).toBe(200);
        expect(response.body.meta.includeAllTools).toBe(true);
        expect(response.body.data.map((tool) => tool.id)).not.toContain('managed-app');
        expect(response.body.meta.runtime.managedApps).toBeUndefined();
        expect(response.body.meta.runtime.remoteRunner).toBeDefined();
    });

    test('default frontend catalog keeps managed-app hidden from end-user surfaces', async () => {
        const app = buildApp();

        const response = await request(app).get('/api/tools/available');

        expect(response.status).toBe(200);
        expect(response.body.meta.includeAllTools).toBe(false);
        expect(response.body.data.map((tool) => tool.id)).not.toContain('managed-app');
    });

    test('remote-command tool details report runner target availability', async () => {
        const app = buildApp();

        const response = await request(app).get('/api/tools/remote-command');

        expect(response.status).toBe(200);
        expect(response.body.data.runtime.source).toBeDefined();
        expect(response.body.data.runtime.runnerAvailable).toBe(false);
    });

    test('managed-app details and invocation are disabled', async () => {
        const app = buildApp();

        const details = await request(app).get('/api/tools/managed-app');
        expect(details.status).toBe(404);
        expect(details.body.error).toContain('managed-app is disabled');

        const invoke = await request(app)
            .post('/api/tools/invoke')
            .send({ tool: 'managed-app', params: { action: 'list' } });
        expect(invoke.status).toBe(400);
        expect(invoke.body.error).toContain('remote-command');
    });
});
