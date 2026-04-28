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

    test('podcast-video catalog excludes remote-build tools', async () => {
        const app = buildApp();

        const response = await request(app).get('/api/tools/available?taskType=podcast-video');

        expect(response.status).toBe(200);
        expect(response.body.meta.executionProfile).toBe('podcast-video');
        expect(response.body.data.map((tool) => tool.id)).toEqual(expect.arrayContaining([
            'web-fetch',
            'web-scrape',
            'image-generate',
        ]));
        expect(response.body.data.map((tool) => tool.id)).not.toContain('remote-command');
        expect(response.body.data.map((tool) => tool.id)).not.toContain('remote-workbench');
        expect(response.body.data.map((tool) => tool.id)).not.toContain('remote-cli-agent');
        expect(response.body.data.map((tool) => tool.id)).not.toContain('k3s-deploy');
    });

    test('remote-command tool details report runner target availability', async () => {
        const app = buildApp();

        const response = await request(app).get('/api/tools/remote-command');

        expect(response.status).toBe(200);
        expect(response.body.data.runtime.source).toBeDefined();
        expect(response.body.data.runtime.runnerAvailable).toBe(false);
        expect(response.body.data.runtime.commandCatalog).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'repo-map' }),
            expect.objectContaining({ id: 'changed-files' }),
            expect.objectContaining({ id: 'dependency-check' }),
            expect.objectContaining({ id: 'k8s-manifest-summary' }),
            expect.objectContaining({ id: 'focused-test' }),
            expect.objectContaining({ id: 'deploy-verify' }),
        ]));
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

    test('remote-workbench tool details expose structured actions and runner inventory', async () => {
        const app = buildApp();
        remoteRunnerService.registerRunner({
            runnerId: 'server-runner',
            capabilities: ['inspect', 'build', 'deploy'],
            metadata: {
                defaultCwd: '/srv/kimibuilt',
                shell: '/bin/bash',
                availableCliTools: ['kubectl', 'git'],
            },
        }, { readyState: 1, send: jest.fn() });

        const response = await request(app).get('/api/tools/remote-workbench');

        expect(response.status).toBe(200);
        expect(response.body.data.runtime.runnerAvailable).toBe(true);
        expect(response.body.data.runtime.structuredActions).toEqual(expect.arrayContaining([
            'grep',
            'read-file',
            'write-file',
            'apply-patch',
            'build',
            'deploy-verify',
        ]));
        expect(response.body.data.runtime.availableCliTools).toEqual(expect.arrayContaining(['kubectl', 'git']));
    });

    test('k3s-deploy tool details expose verification-oriented command catalog entries', async () => {
        const app = buildApp();

        const response = await request(app).get('/api/tools/k3s-deploy');

        expect(response.status).toBe(200);
        expect(response.body.data.runtime.commandCatalog).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'k8s-app-inventory' }),
            expect.objectContaining({ id: 'pod-debug' }),
            expect.objectContaining({ id: 'deploy-verify' }),
        ]));
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
