'use strict';

const express = require('express');
const request = require('supertest');

const toolsRouter = require('./tools');
const { remoteRunnerService } = require('../remote-runner/service');

describe('/api/tools routes', () => {
    beforeEach(() => {
        remoteRunnerService.runners.clear();
    });

    afterEach(() => {
        remoteRunnerService.runners.clear();
    });

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

    test('remote-command tool details expose online runner CLI inventory', async () => {
        const app = buildApp();
        remoteRunnerService.registerRunner({
            runnerId: 'server-runner',
            capabilities: ['inspect', 'deploy'],
            metadata: {
                defaultCwd: '/srv/kimibuilt',
                shell: '/bin/bash',
                cliTools: [
                    { name: 'kubectl', available: true, path: '/usr/local/bin/kubectl' },
                    { name: 'git', available: true, path: '/usr/bin/git' },
                    { name: 'rg', available: false, path: '' },
                ],
            },
        }, { readyState: 1, send: jest.fn() });

        const response = await request(app).get('/api/tools/remote-command');

        expect(response.status).toBe(200);
        expect(response.body.data.runtime.runnerAvailable).toBe(true);
        expect(response.body.data.runtime.availableCliTools).toEqual(expect.arrayContaining(['kubectl', 'git']));
        expect(response.body.data.runtime.cliTools).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'kubectl', path: '/usr/local/bin/kubectl' }),
            expect.objectContaining({ name: 'rg', available: false }),
        ]));
        expect(response.body.meta.runtime.remoteRunner.availableCliTools).toEqual(expect.arrayContaining(['kubectl', 'git']));
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
