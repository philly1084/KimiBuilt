'use strict';

const express = require('express');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const request = require('supertest');

jest.mock('./dashboard.controller', () => jest.fn().mockImplementation(function DashboardController(orchestrator) {
    this.orchestrator = orchestrator;
    this.getStats = jest.fn((_req, res) => res.json({ success: true, data: { source: 'stats' } }));
    this.getHealth = jest.fn((_req, res) => res.json({ success: true, data: { status: 'healthy' } }));
    this.getRecentActivity = jest.fn((_req, res) => res.json({ success: true, data: [] }));
    this.executeTask = jest.fn();
    this.cancelTask = jest.fn();
    this.getActiveSessions = jest.fn();
    this.getSessionDetails = jest.fn();
    this.clearSession = jest.fn();
}));

jest.mock('../../admin/runtime-monitor', () => ({
    setDashboardController: jest.fn(),
}));

const DashboardController = require('./dashboard.controller');
const { setDashboardController } = require('../../admin/runtime-monitor');
const settingsController = require('./settings.controller');
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

    test('updates a workload from the admin dashboard', async () => {
        const service = {
            isAvailable: jest.fn(() => true),
            updateAdminWorkload: jest.fn(async () => ({
                id: 'workload-1',
                title: 'Nightly review',
                prompt: 'Review the queue and flag failures.',
            })),
        };
        const app = buildApp(service);

        const response = await request(app)
            .patch('/api/admin/workloads/workload-1')
            .send({
                prompt: 'Review the queue and flag failures.',
            });

        expect(response.status).toBe(200);
        expect(service.updateAdminWorkload).toHaveBeenCalledWith('workload-1', {
            prompt: 'Review the queue and flag failures.',
        });
        expect(response.body.success).toBe(true);
        expect(response.body.data.prompt).toBe('Review the queue and flag failures.');
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

    test('creates a fallback dashboard controller when startup did not initialize one', async () => {
        const service = {
            isAvailable: jest.fn(() => true),
        };
        const app = buildApp(service);
        app.locals.conversationOrchestrator = { id: 'orchestrator-1' };

        const statsResponse = await request(app).get('/api/admin/stats');
        const activityResponse = await request(app).get('/api/admin/activity');
        const healthResponse = await request(app).get('/api/admin/health');

        expect(statsResponse.status).toBe(200);
        expect(activityResponse.status).toBe(200);
        expect(healthResponse.status).toBe(200);
        expect(DashboardController).toHaveBeenCalledTimes(1);
        expect(DashboardController).toHaveBeenCalledWith(app.locals.conversationOrchestrator);
        expect(setDashboardController).toHaveBeenCalledTimes(1);
        expect(app.locals.dashboardController).toBeTruthy();
    });

    test('uploads a podcast intro audio asset from the admin dashboard', async () => {
        const previousStateDir = process.env.KIMIBUILT_STATE_DIR;
        const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kimibuilt-admin-audio-'));
        process.env.KIMIBUILT_STATE_DIR = stateDir;
        settingsController.settings = settingsController.getDefaultSettings();
        const app = buildApp({ isAvailable: jest.fn(() => true) });

        try {
            const response = await request(app)
                .post('/api/admin/podcast-audio/intro')
                .attach('file', Buffer.from('audio-bytes'), 'intro.wav');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.storageDirectory).toBe(path.join(stateDir, 'podcast-audio'));
            expect(response.body.data.tracks.intro).toEqual(expect.objectContaining({
                configured: true,
                exists: true,
                originalFilename: 'intro.wav',
            }));
            expect(settingsController.settings.audioProcessing.podcastIntroPath).toContain('intro-');
        } finally {
            if (previousStateDir === undefined) {
                delete process.env.KIMIBUILT_STATE_DIR;
            } else {
                process.env.KIMIBUILT_STATE_DIR = previousStateDir;
            }
            await fs.rm(stateDir, { recursive: true, force: true });
        }
    });
});
