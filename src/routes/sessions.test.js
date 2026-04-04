'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../session-store', () => ({
    sessionStore: {
        create: jest.fn(),
        list: jest.fn(),
        getOwned: jest.fn(),
        getActiveOwnedSession: jest.fn(),
        getLatestOwnedSession: jest.fn(),
        setActiveSession: jest.fn(),
        listMessages: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        get: jest.fn(),
    },
}));

jest.mock('../memory/memory-service', () => ({
    memoryService: {
        forget: jest.fn(),
    },
}));

jest.mock('../artifacts/artifact-service', () => ({
    artifactService: {
        listSessionArtifacts: jest.fn(),
        deleteArtifactsForSession: jest.fn(),
    },
}));

const { sessionStore } = require('../session-store');
const sessionsRouter = require('./sessions');

describe('/api/sessions route', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('enriches session list responses with workload summaries', async () => {
        sessionStore.list.mockResolvedValue([
            {
                id: 'session-1',
                metadata: { mode: 'chat' },
                createdAt: '2026-04-01T09:00:00.000Z',
                updatedAt: '2026-04-01T09:05:00.000Z',
            },
        ]);
        sessionStore.getActiveOwnedSession.mockResolvedValue({
            id: 'session-1',
        });

        const app = express();
        app.locals.agentWorkloadService = {
            isAvailable: jest.fn(() => true),
            getSessionSummaries: jest.fn(async () => ({
                'session-1': {
                    queued: 2,
                    running: 1,
                    failed: 0,
                },
            })),
        };
        app.use('/api/sessions', sessionsRouter);

        const response = await request(app).get('/api/sessions');

        expect(response.status).toBe(200);
        expect(response.body.sessions).toEqual([
            expect.objectContaining({
                id: 'session-1',
                workloadSummary: {
                    queued: 2,
                    running: 1,
                    failed: 0,
                },
            }),
        ]);
        expect(response.body.activeSessionId).toBe('session-1');
    });

    test('persists active session selection for the authenticated user', async () => {
        sessionStore.getOwned.mockResolvedValue({
            id: 'session-1',
            metadata: { ownerId: 'phill' },
        });
        sessionStore.setActiveSession.mockResolvedValue({
            ownerId: 'phill',
            activeSessionId: 'session-1',
        });
        sessionStore.getActiveOwnedSession.mockResolvedValue({
            id: 'session-1',
            metadata: { ownerId: 'phill' },
        });

        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.user = { username: 'phill' };
            next();
        });
        app.use('/api/sessions', sessionsRouter);

        const response = await request(app)
            .put('/api/sessions/state')
            .send({ activeSessionId: 'session-1' });

        expect(response.status).toBe(200);
        expect(sessionStore.getOwned).toHaveBeenCalledWith('session-1', 'phill');
        expect(sessionStore.setActiveSession).toHaveBeenCalledWith('phill', 'session-1');
        expect(response.body.activeSessionId).toBe('session-1');
    });
});
