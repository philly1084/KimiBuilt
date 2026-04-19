'use strict';

const express = require('express');
const request = require('supertest');

const toolsRouter = require('./tools');

describe('/api/tools routes', () => {
    function buildApp(opencodeServiceOverrides = {}) {
        const app = express();
        app.use(express.json());
        app.locals.managedAppService = {
            isAvailable: jest.fn(() => true),
            kubernetesClient: {
                isConfigured: jest.fn(() => true),
            },
        };
        app.locals.opencodeService = {
            getExecutionCapabilities: jest.fn(() => ({
                anyReady: false,
                localReady: false,
                remoteReady: false,
            })),
            createRun: jest.fn(),
            runTool: jest.fn(async () => ({
                async: false,
                runId: 'run-1',
                status: 'completed',
                summary: 'Build fixed.',
            })),
            ...opencodeServiceOverrides,
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
        expect(response.body.meta.runtime.managedApps.deployTarget).toBe('ssh');
    });

    test('default frontend catalog keeps managed-app hidden from end-user surfaces', async () => {
        const app = buildApp();

        const response = await request(app).get('/api/tools/available');

        expect(response.status).toBe(200);
        expect(response.body.meta.includeAllTools).toBe(false);
        expect(response.body.data.map((tool) => tool.id)).not.toContain('managed-app');
    });

    test('tool invoke forwards the selected frontend model to opencode-run', async () => {
        const runTool = jest.fn(async () => ({
            async: false,
            runId: 'run-opencode-1',
            status: 'completed',
            summary: 'Build fixed.',
        }));
        const app = buildApp({
            runTool,
        });

        const response = await request(app)
            .post('/api/tools/invoke')
            .send({
                tool: 'opencode-run',
                model: 'gpt-5.4-mini',
                params: {
                    prompt: 'Fix the build in this repo.',
                    workspacePath: 'C:/Users/phill/KimiBuilt',
                    target: 'local',
                },
                taskType: 'chat',
                clientSurface: 'web-chat',
            });

        expect(response.status).toBe(200);
        expect(runTool).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: 'Fix the build in this repo.',
                workspacePath: 'C:/Users/phill/KimiBuilt',
                target: 'local',
                model: 'gpt-5.4-mini',
            }),
            expect.objectContaining({
                sessionId: expect.any(String),
            }),
        );
    });

    test('managed-app tool details report the remote ssh provider', async () => {
        const app = buildApp();

        const response = await request(app).get('/api/tools/managed-app');

        expect(response.status).toBe(200);
        expect(response.body.data.runtime.provider).toBe('external-gitea-plus-remote-k3s-over-ssh');
        expect(response.body.data.runtime.deployTarget).toBe('ssh');
    });
});
