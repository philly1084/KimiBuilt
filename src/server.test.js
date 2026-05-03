'use strict';

const request = require('supertest');

describe('server readiness', () => {
    const originalEnv = process.env;

    afterEach(() => {
        process.env = originalEnv;
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('keeps /ready degraded when boot initialization fails', async () => {
        process.env = {
            ...originalEnv,
            NODE_ENV: 'test',
        };

        jest.doMock('./session-store', () => ({
            sessionStore: {
                initialize: jest.fn(async () => {
                    throw new Error('boom');
                }),
                isPersistent: jest.fn(() => false),
                healthCheck: jest.fn(async () => true),
            },
        }));

        const { app, start, startupState } = require('./server');
        await start({ listen: false });

        const response = await request(app).get('/ready');

        expect(response.status).toBe(503);
        expect(response.body).toEqual(expect.objectContaining({
            status: 'degraded',
            error: 'boom',
        }));
        expect(startupState.ready).toBe(false);
        expect(startupState.status).toBe('degraded');
    });
});
