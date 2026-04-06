'use strict';

const express = require('express');
const request = require('supertest');

const adminRouter = require('./index');

describe('/api/admin workload routes', () => {
    function buildApp(service, opencodeService = null) {
        const app = express();
        app.use(express.json());
        app.locals.agentWorkloadService = service;
        app.locals.opencodeService = opencodeService;
        app.use('/api/admin', adminRouter);
        app.use((err, _req, res, _next) => {
            res.status(err.statusCode || 500).json({
                success: false,
                error: err.message,
            });
        });
        return app;
    }

    test('pauses a workload from the admin dashboard', async () => {
        const service = {
            isAvailable: jest.fn(() => true),
            pauseAdminWorkload: jest.fn(async () => ({
                id: 'workload-1',
                enabled: false,
            })),
        };
        const app = buildApp(service);

        const response = await request(app).post('/api/admin/workloads/workload-1/pause').send({});

        expect(response.status).toBe(200);
        expect(service.pauseAdminWorkload).toHaveBeenCalledWith('workload-1');
        expect(response.body.success).toBe(true);
        expect(response.body.data.enabled).toBe(false);
    });

    test('resumes a workload from the admin dashboard', async () => {
        const service = {
            isAvailable: jest.fn(() => true),
            resumeAdminWorkload: jest.fn(async () => ({
                id: 'workload-1',
                enabled: true,
            })),
        };
        const app = buildApp(service);

        const response = await request(app).post('/api/admin/workloads/workload-1/resume').send({});

        expect(response.status).toBe(200);
        expect(service.resumeAdminWorkload).toHaveBeenCalledWith('workload-1');
        expect(response.body.data.enabled).toBe(true);
    });

    test('deletes a workload from the admin dashboard', async () => {
        const service = {
            isAvailable: jest.fn(() => true),
            deleteAdminWorkload: jest.fn(async () => true),
        };
        const app = buildApp(service);

        const response = await request(app).delete('/api/admin/workloads/workload-1');

        expect(response.status).toBe(200);
        expect(service.deleteAdminWorkload).toHaveBeenCalledWith('workload-1');
        expect(response.body.success).toBe(true);
    });

    test('returns OpenCode runtime details for the admin dashboard', async () => {
        const opencodeService = {
            getAdminRuntimeDetails: jest.fn(async () => ({
                runtime: {
                    enabled: true,
                    defaultAgent: 'build',
                    defaultModel: 'gpt-4o',
                },
                gateway: {
                    baseURL: 'https://kimibuilt.example.com/v1',
                    localBaseURL: 'http://127.0.0.1:3000/v1',
                    authEnabled: true,
                    authMode: 'explicit',
                    remoteReachable: true,
                    remoteReachabilityError: null,
                },
                models: [
                    {
                        id: 'gpt-4o',
                        name: 'gpt-4o',
                        provider: 'openai',
                        isDefault: true,
                        isSmallModel: false,
                    },
                ],
            })),
        };
        const app = buildApp({
            isAvailable: jest.fn(() => true),
        }, opencodeService);

        const response = await request(app).get('/api/admin/opencode/runtime');

        expect(response.status).toBe(200);
        expect(opencodeService.getAdminRuntimeDetails).toHaveBeenCalledTimes(1);
        expect(response.body.success).toBe(true);
        expect(response.body.data.gateway.baseURL).toBe('https://kimibuilt.example.com/v1');
        expect(response.body.data.models[0].id).toBe('gpt-4o');
    });
});
