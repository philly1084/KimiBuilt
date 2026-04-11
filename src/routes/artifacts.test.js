const express = require('express');
const request = require('supertest');
const { createFrontendBundleArchive } = require('../frontend-bundles');

jest.mock('../session-store', () => ({
    sessionStore: {
        resolveOwnedSession: jest.fn(),
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

jest.mock('../runtime-tool-manager', () => ({
    ensureRuntimeToolManager: jest.fn(),
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

    test('serves stored preview html for non-html artifacts', async () => {
        artifactService.getArtifact.mockResolvedValue({
            id: 'artifact-text-1',
            sessionId: 'session-1',
            filename: 'notes.txt',
            extension: 'txt',
            mimeType: 'text/plain',
            previewHtml: '<pre>Preview me</pre>',
            contentBuffer: Buffer.from('raw-content'),
            metadata: {},
        });
        sessionStore.getOwned.mockResolvedValue({
            id: 'session-1',
            metadata: { ownerId: 'phill' },
        });

        const response = await request(buildApp()).get('/api/artifacts/artifact-text-1/preview');

        expect(response.status).toBe(200);
        expect(response.text).toContain('<pre>Preview me</pre>');
        expect(response.headers['content-type']).toContain('text/html');
        expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });

    test('serves bundled html artifact previews from the server', async () => {
        artifactService.getArtifact.mockResolvedValue({
            id: 'artifact-site-1',
            sessionId: 'session-1',
            filename: 'newsroom.html',
            extension: 'html',
            previewHtml: '<!DOCTYPE html><html><body><h1>Front Page</h1></body></html>',
            contentBuffer: Buffer.from('<!DOCTYPE html><html><body><h1>Front Page</h1></body></html>'),
            metadata: {
                type: 'frontend',
                bundle: {
                    entry: 'index.html',
                    files: [
                        {
                            path: 'index.html',
                            language: 'html',
                            purpose: 'Home',
                            content: '<!DOCTYPE html><html><body><a href="world.html">World</a><h1>Front Page</h1></body></html>',
                        },
                        {
                            path: 'world.html',
                            language: 'html',
                            purpose: 'World',
                            content: '<!DOCTYPE html><html><body><h1>World Desk</h1></body></html>',
                        },
                        {
                            path: 'styles.css',
                            language: 'css',
                            purpose: 'Styles',
                            content: 'body { color: #111; }',
                        },
                    ],
                },
            },
        });
        sessionStore.getOwned.mockResolvedValue({
            id: 'session-1',
            metadata: { ownerId: 'phill' },
        });

        const previewResponse = await request(buildApp()).get('/api/artifacts/artifact-site-1/preview');
        const assetResponse = await request(buildApp()).get('/api/artifacts/artifact-site-1/preview/styles.css');

        expect(previewResponse.status).toBe(200);
        expect(previewResponse.text).toContain('Front Page');
        expect(previewResponse.headers['cross-origin-resource-policy']).toBe('cross-origin');
        expect(previewResponse.headers['origin-agent-cluster']).toBe('?0');
        expect(assetResponse.status).toBe(200);
        expect(assetResponse.text).toContain('color: #111');
        expect(assetResponse.headers['content-type']).toContain('text/css');
        expect(assetResponse.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });

    test('downloads a bundled html artifact as a zip archive', async () => {
        artifactService.getArtifact.mockResolvedValue({
            id: 'artifact-site-1',
            sessionId: 'session-1',
            filename: 'newsroom.html',
            extension: 'html',
            previewHtml: '<!DOCTYPE html><html><body><h1>Front Page</h1></body></html>',
            contentBuffer: Buffer.from('<!DOCTYPE html><html><body><h1>Front Page</h1></body></html>'),
            metadata: {
                type: 'frontend',
                bundle: {
                    entry: 'index.html',
                    files: [
                        {
                            path: 'index.html',
                            language: 'html',
                            purpose: 'Home',
                            content: '<!DOCTYPE html><html><body><h1>Front Page</h1></body></html>',
                        },
                        {
                            path: 'world.html',
                            language: 'html',
                            purpose: 'World',
                            content: '<!DOCTYPE html><html><body><h1>World Desk</h1></body></html>',
                        },
                    ],
                },
            },
        });
        sessionStore.getOwned.mockResolvedValue({
            id: 'session-1',
            metadata: { ownerId: 'phill' },
        });

        const response = await request(buildApp()).get('/api/artifacts/artifact-site-1/bundle');

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain('application/zip');
        expect(response.headers['content-disposition']).toContain('newsroom.zip');
    });

    test('serves preview pages from stored zip site artifacts', async () => {
        artifactService.getArtifact.mockResolvedValue({
            id: 'artifact-site-zip-1',
            sessionId: 'session-1',
            filename: 'newsroom-preview.zip',
            extension: 'zip',
            mimeType: 'application/zip',
            contentBuffer: createFrontendBundleArchive({
                entry: 'index.html',
                files: [
                    {
                        path: 'index.html',
                        language: 'html',
                        purpose: 'Home',
                        content: '<!DOCTYPE html><html><body><nav><a href="./world/index.html">World</a></nav><main><h1>Front Page</h1></main></body></html>',
                    },
                    {
                        path: 'world/index.html',
                        language: 'html',
                        purpose: 'World',
                        content: '<!DOCTYPE html><html><body><main><h1>World Desk</h1></main></body></html>',
                    },
                ],
            }),
            metadata: {
                siteBundle: {
                    entry: 'index.html',
                    fileCount: 2,
                    pageCount: 2,
                    files: [
                        { path: 'index.html' },
                        { path: 'world/index.html' },
                    ],
                },
            },
        });
        sessionStore.getOwned.mockResolvedValue({
            id: 'session-1',
            metadata: { ownerId: 'phill' },
        });

        const response = await request(buildApp()).get('/api/artifacts/artifact-site-zip-1/site/world/');

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain('text/html');
        expect(response.text).toContain('World Desk');
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

    test('serves bundled html previews with a preview base and rewritten asset paths', async () => {
        artifactService.getArtifact.mockResolvedValue({
            id: 'artifact-1',
            sessionId: 'session-1',
            filename: 'newsroom.html',
            extension: 'html',
            mimeType: 'text/html',
            contentBuffer: Buffer.from('<!DOCTYPE html><html><body>fallback</body></html>'),
            metadata: {
                type: 'frontend',
                title: 'Newsroom',
                bundle: {
                    entry: 'index.html',
                    files: [
                        {
                            path: 'index.html',
                            language: 'html',
                            purpose: 'Front page',
                            content: '<!DOCTYPE html><html><head><link rel="stylesheet" href="/styles/site.css"></head><body><nav><a href="world.html">World</a></nav><main><h1>Front Page</h1></main></body></html>',
                        },
                        {
                            path: 'world.html',
                            language: 'html',
                            purpose: 'World page',
                            content: '<!DOCTYPE html><html><body><main><h1>World Desk</h1></main></body></html>',
                        },
                        {
                            path: 'styles/site.css',
                            language: 'css',
                            purpose: 'Shared styles',
                            content: 'body { background-image: url(/images/paper.png); }',
                        },
                    ],
                },
            },
        });
        sessionStore.getOwned.mockResolvedValue({
            id: 'session-1',
            metadata: { ownerId: 'phill' },
        });

        const previewResponse = await request(buildApp()).get('/api/artifacts/artifact-1/preview');
        expect(previewResponse.status).toBe(200);
        expect(previewResponse.text).toContain('<base href="/api/artifacts/artifact-1/preview/">');
        expect(previewResponse.text).toContain('href="/api/artifacts/artifact-1/preview/styles/site.css"');
        expect(previewResponse.text).toContain('href="world.html"');
        expect(previewResponse.headers['cross-origin-resource-policy']).toBe('cross-origin');
        expect(previewResponse.headers['origin-agent-cluster']).toBe('?0');

        const cssResponse = await request(buildApp()).get('/api/artifacts/artifact-1/preview/styles/site.css');
        expect(cssResponse.status).toBe(200);
        expect(cssResponse.text).toContain('url(/api/artifacts/artifact-1/preview/images/paper.png)');
        expect(cssResponse.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });

    test('downloads a generated site bundle as zip', async () => {
        artifactService.getArtifact.mockResolvedValue({
            id: 'artifact-1',
            sessionId: 'session-1',
            filename: 'newsroom.html',
            extension: 'html',
            mimeType: 'text/html',
            contentBuffer: Buffer.from('<!DOCTYPE html><html><body>fallback</body></html>'),
            metadata: {
                type: 'frontend',
                title: 'Newsroom',
                bundle: {
                    entry: 'index.html',
                    files: [
                        {
                            path: 'index.html',
                            language: 'html',
                            purpose: 'Front page',
                            content: '<!DOCTYPE html><html><body><h1>Front Page</h1></body></html>',
                        },
                        {
                            path: 'world.html',
                            language: 'html',
                            purpose: 'World page',
                            content: '<!DOCTYPE html><html><body><h1>World Desk</h1></body></html>',
                        },
                    ],
                },
            },
        });
        sessionStore.getOwned.mockResolvedValue({
            id: 'session-1',
            metadata: { ownerId: 'phill' },
        });

        const response = await request(buildApp()).get('/api/artifacts/artifact-1/bundle');

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toMatch(/application\/zip/);
        expect(response.headers['content-disposition']).toContain('newsroom.zip');
        expect(Number(response.headers['content-length'] || 0)).toBeGreaterThan(0);
    });
});
