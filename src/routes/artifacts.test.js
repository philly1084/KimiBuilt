const express = require('express');
const request = require('supertest');

jest.mock('../session-store', () => ({
    sessionStore: {
        getOrCreateOwned: jest.fn(),
        getOwned: jest.fn(),
    },
}));

jest.mock('../artifacts/artifact-service', () => ({
    artifactService: {
        uploadArtifact: jest.fn(),
        generateArtifact: jest.fn(),
        getArtifact: jest.fn(),
        deleteArtifact: jest.fn(),
    },
}));

jest.mock('../utils/multipart', () => ({
    parseMultipartRequest: jest.fn(),
}));

jest.mock('../middleware/validate', () => ({
    validate: () => (_req, _res, next) => next(),
}));

const { sessionStore } = require('../session-store');
const { artifactService } = require('../artifacts/artifact-service');
const artifactsRouter = require('./artifacts');

describe('/api/artifacts route', () => {
    function buildApp() {
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.user = { username: 'phill' };
            next();
        });
        app.use('/api/artifacts', artifactsRouter);
        return app;
    }

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('blocks artifact fetch when the artifact session is not owned by the user', async () => {
        artifactService.getArtifact.mockResolvedValue({
            id: 'artifact-1',
            sessionId: 'session-other',
        });
        sessionStore.getOwned.mockResolvedValue(null);

        const response = await request(buildApp()).get('/api/artifacts/artifact-1');

        expect(response.status).toBe(404);
        expect(sessionStore.getOwned).toHaveBeenCalledWith('session-other', 'phill');
    });

    test('allows artifact download when the artifact session is owned by the user', async () => {
        artifactService.getArtifact.mockResolvedValue({
            id: 'artifact-1',
            sessionId: 'session-1',
            filename: 'report.txt',
            mimeType: 'text/plain',
            contentBuffer: Buffer.from('hello'),
        });
        sessionStore.getOwned.mockResolvedValue({
            id: 'session-1',
            metadata: { ownerId: 'phill' },
        });

        const response = await request(buildApp()).get('/api/artifacts/artifact-1/download');

        expect(response.status).toBe(200);
        expect(response.text).toBe('hello');
    });

    test('blocks artifact delete when the artifact session is not owned by the user', async () => {
        artifactService.getArtifact.mockResolvedValue({
            id: 'artifact-1',
            sessionId: 'session-other',
        });
        sessionStore.getOwned.mockResolvedValue(null);

        const response = await request(buildApp()).delete('/api/artifacts/artifact-1');

        expect(response.status).toBe(404);
        expect(artifactService.deleteArtifact).not.toHaveBeenCalled();
    });
});
