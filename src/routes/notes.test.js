'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../session-store', () => ({
    sessionStore: {
        getUserPreferences: jest.fn(),
        patchUserPreferences: jest.fn(),
    },
}));

const { sessionStore } = require('../session-store');
const notesRouter = require('./notes');

describe('/api/notes route', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    function buildApp() {
        const app = express();
        app.use(express.json({ limit: '25mb' }));
        app.use((req, _res, next) => {
            req.user = { username: 'phill' };
            next();
        });
        app.use('/api/notes', notesRouter);
        return app;
    }

    test('loads persisted notes data for the authenticated user', async () => {
        sessionStore.getUserPreferences.mockResolvedValue({
            data: JSON.stringify({
                pages: [{ id: 'page-1', title: 'Remote page', blocks: [] }],
                trash: [],
            }),
            currentPageId: 'page-1',
            globalModel: 'gpt-5.4-mini',
            updatedAt: '2026-04-25T10:00:00.000Z',
        });

        const response = await request(buildApp()).get('/api/notes');

        expect(response.status).toBe(200);
        expect(sessionStore.getUserPreferences).toHaveBeenCalledWith('phill', 'notes');
        expect(response.body).toEqual(expect.objectContaining({
            currentPageId: 'page-1',
            globalModel: 'gpt-5.4-mini',
            synced: true,
        }));
        expect(response.body.data).toEqual(expect.objectContaining({
            pages: [expect.objectContaining({ id: 'page-1', title: 'Remote page' })],
            trash: [],
            currentSpaceId: 'private',
        }));
        expect(response.body.data.spaces).toEqual([
            expect.objectContaining({ id: 'private', name: 'Private' }),
        ]);
    });

    test('persists the complete notes payload and selected page', async () => {
        const notesData = {
            pages: [{ id: 'page-1', title: 'Synced page', blocks: [] }],
            trash: [{ id: 'page-2', title: 'Deleted page', blocks: [] }],
            spaces: [{ id: 'private', name: 'Private' }],
            currentSpaceId: 'private',
        };
        sessionStore.patchUserPreferences.mockImplementation(async (_ownerId, _namespace, patch) => patch);

        const response = await request(buildApp())
            .put('/api/notes')
            .send({
                data: notesData,
                currentPageId: 'page-1',
                globalModel: 'gpt-5.4-mini',
            });

        expect(response.status).toBe(200);
        expect(sessionStore.patchUserPreferences).toHaveBeenCalledWith(
            'phill',
            'notes',
            expect.objectContaining({
                data: expect.any(String),
                currentPageId: 'page-1',
                globalModel: 'gpt-5.4-mini',
            }),
        );
        const savedPatch = sessionStore.patchUserPreferences.mock.calls[0][2];
        expect(JSON.parse(savedPatch.data)).toEqual(expect.objectContaining({
            pages: notesData.pages,
            trash: notesData.trash,
            spaces: notesData.spaces,
            currentSpaceId: 'private',
        }));
        expect(response.body.data.pages).toHaveLength(1);
        expect(response.body.currentPageId).toBe('page-1');
    });

    test('clears remote notes data permanently', async () => {
        sessionStore.patchUserPreferences.mockResolvedValue({});

        const response = await request(buildApp()).delete('/api/notes');

        expect(response.status).toBe(204);
        expect(sessionStore.patchUserPreferences).toHaveBeenCalledWith('phill', 'notes', {
            data: null,
            currentPageId: null,
            globalModel: null,
            updatedAt: null,
        });
    });
});
