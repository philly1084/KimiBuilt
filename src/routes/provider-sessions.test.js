'use strict';

const express = require('express');
const request = require('supertest');

const providerSessionsRouter = require('./provider-sessions');

describe('provider session routes', () => {
    let app;
    let service;

    beforeEach(() => {
        service = {
            listCapabilities: jest.fn(async () => ([
                {
                    providerId: 'codex-cli',
                    supportsSessions: true,
                },
            ])),
            createSession: jest.fn(async () => ({
                session: {
                    id: 'provider-session-1',
                    providerId: 'codex-cli',
                    cwd: 'C:\\repos\\demo',
                    status: 'starting',
                    supportsResize: false,
                },
                streamUrl: '/admin/provider-sessions/provider-session-1/stream?token=stream-token',
            })),
            getPublicSession: jest.fn(() => null),
            validateStreamToken: jest.fn(() => false),
            listSessionEvents: jest.fn(() => []),
            subscribeToSession: jest.fn(() => jest.fn()),
            sendInput: jest.fn(async () => ({ success: true })),
            sendSignal: jest.fn(async () => ({ success: true })),
            resizeSession: jest.fn(async () => ({ applied: false })),
            deleteSession: jest.fn(async () => ({ success: true })),
        };

        app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.user = { username: 'phill' };
            next();
        });
        app.locals.providerSessionService = service;
        app.use('/admin', providerSessionsRouter);
    });

    test('lists provider capabilities', async () => {
        const response = await request(app).get('/admin/provider-capabilities');

        expect(response.status).toBe(200);
        expect(service.listCapabilities).toHaveBeenCalledWith('phill');
        expect(response.body.data).toEqual([
            {
                providerId: 'codex-cli',
                supportsSessions: true,
            },
        ]);
    });

    test('creates a provider session and returns a stream URL', async () => {
        const response = await request(app)
            .post('/admin/provider-sessions')
            .send({
                providerId: 'codex-cli',
                cwd: 'C:\\repos\\demo',
                cols: 120,
                rows: 40,
            });

        expect(response.status).toBe(201);
        expect(service.createSession).toHaveBeenCalledWith({
            providerId: 'codex-cli',
            cwd: 'C:\\repos\\demo',
            cols: 120,
            rows: 40,
        }, 'phill');
        expect(response.body.streamUrl).toBe('/admin/provider-sessions/provider-session-1/stream?token=stream-token');
    });

    test('rejects provider stream requests with an invalid token', async () => {
        const response = await request(app)
            .get('/admin/provider-sessions/provider-session-1/stream?token=wrong-token');

        expect(response.status).toBe(403);
        expect(response.body.error.message).toBe('Invalid provider session stream token');
    });
});
