'use strict';

const express = require('express');
const request = require('supertest');

const remoteAgentTasksRouter = require('./remote-agent-tasks');

describe('remote agent task routes', () => {
    let app;
    let service;

    beforeEach(() => {
        service = {
            createTask: jest.fn(async () => ({
                task: {
                    id: 'ragent_1',
                    sessionId: 'ps_1',
                    status: 'running',
                    reasoning: {
                        summary: 'Starting gemini-cli',
                        data: {
                            providerId: 'gemini-cli',
                            targetId: 'k3s-prod',
                            cwd: '/srv/apps/my-app',
                            sshCommand: 'ssh deploy@example.com',
                            progressMarkers: [
                                'REMOTE_AGENT_PLAN',
                                'REMOTE_AGENT_PROGRESS',
                                'REMOTE_AGENT_RESULT',
                            ],
                        },
                    },
                },
                streamUrl: '/admin/remote-agent-tasks/ragent_1/stream?token=stream-token',
            })),
            getPublicTask: jest.fn(() => ({
                id: 'ragent_1',
                status: 'running',
            })),
            getTranscript: jest.fn(() => ({
                task: { id: 'ragent_1' },
                transcript: [{ type: 'output', data: 'ok' }],
            })),
            validateStreamToken: jest.fn(() => false),
            listTaskEvents: jest.fn(() => []),
            subscribeToTask: jest.fn(() => jest.fn()),
            cancelTask: jest.fn(async () => ({ success: true, task: { id: 'ragent_1', status: 'cancelled' } })),
        };

        app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.user = { username: 'phill' };
            next();
        });
        app.locals.remoteAgentTaskService = service;
        app.use('/admin', remoteAgentTasksRouter);
    });

    test('creates a remote agent task and returns the task stream URL', async () => {
        const response = await request(app)
            .post('/admin/remote-agent-tasks')
            .send({
                providerId: 'gemini-cli',
                targetId: 'k3s-prod',
                cwd: '/srv/apps/my-app',
                task: 'Verify rollout',
            });

        expect(response.status).toBe(201);
        expect(service.createTask).toHaveBeenCalledWith({
            providerId: 'gemini-cli',
            targetId: 'k3s-prod',
            cwd: '/srv/apps/my-app',
            task: 'Verify rollout',
        }, 'phill');
        expect(response.body.task.sessionId).toBe('ps_1');
        expect(response.body.streamUrl).toBe('/admin/remote-agent-tasks/ragent_1/stream?token=stream-token');
    });

    test('polls a remote agent task', async () => {
        const response = await request(app).get('/admin/remote-agent-tasks/ragent_1');

        expect(response.status).toBe(200);
        expect(response.body.task).toEqual({
            id: 'ragent_1',
            status: 'running',
        });
    });

    test('returns a transcript for a remote agent task', async () => {
        const response = await request(app).get('/admin/remote-agent-tasks/ragent_1/transcript');

        expect(response.status).toBe(200);
        expect(response.body.transcript).toEqual([{ type: 'output', data: 'ok' }]);
    });

    test('rejects remote agent stream requests with an invalid token', async () => {
        const response = await request(app)
            .get('/admin/remote-agent-tasks/ragent_1/stream?token=wrong-token');

        expect(response.status).toBe(403);
        expect(response.body.error.message).toBe('Invalid remote agent task stream token');
    });

    test('cancels a remote agent task', async () => {
        const response = await request(app).post('/admin/remote-agent-tasks/ragent_1/cancel');

        expect(response.status).toBe(200);
        expect(service.cancelTask).toHaveBeenCalledWith('ragent_1', 'phill');
        expect(response.body.task.status).toBe('cancelled');
    });
});
