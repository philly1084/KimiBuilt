const fs = require('fs/promises');
const os = require('os');
const path = require('path');

jest.mock('./artifacts/artifact-service', () => ({
    artifactService: {
        createStoredArtifact: jest.fn(),
        serializeArtifact: jest.fn(),
    },
}));

jest.mock('./session-store', () => ({
    sessionStore: {
        update: jest.fn(),
    },
}));

const { artifactService } = require('./artifacts/artifact-service');
const { sessionStore } = require('./session-store');
const { persistGeneratedImages } = require('./generated-image-artifacts');

function buildPngBuffer({ width = 2, height = 2 } = {}) {
    const buffer = Buffer.alloc(32);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    return buffer;
}

describe('generated-image-artifacts', () => {
    let originalFetch;

    beforeEach(() => {
        jest.clearAllMocks();
        originalFetch = global.fetch;
        artifactService.createStoredArtifact.mockResolvedValue({
            id: 'artifact-1',
            sessionId: 'session-1',
            filename: 'generated-image-01.png',
            extension: 'png',
            mimeType: 'image/png',
            metadata: {},
        });
        artifactService.serializeArtifact.mockReturnValue({
            id: 'artifact-1',
            filename: 'generated-image-01.png',
            format: 'png',
            mimeType: 'image/png',
            downloadUrl: '/api/artifacts/artifact-1/download',
            metadata: {},
        });
        sessionStore.update.mockResolvedValue({});
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    test('persists inline generated images as session artifacts and returns reusable artifact urls', async () => {
        const result = await persistGeneratedImages({
            sessionId: 'session-1',
            sourceMode: 'image',
            prompt: 'Cuba beaches at sunset',
            model: 'kimi-k2-turbo-preview',
            images: [{
                url: `data:image/png;base64,${buildPngBuffer().toString('base64')}`,
                b64_json: buildPngBuffer().toString('base64'),
                revised_prompt: 'Cuba beaches at sunset, art deco poster style',
            }],
        });

        expect(artifactService.createStoredArtifact).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session-1',
            direction: 'generated',
            sourceMode: 'image',
            extension: 'png',
            mimeType: 'image/png',
            vectorize: false,
        }));
        expect(sessionStore.update).toHaveBeenCalledWith('session-1', {
            metadata: {
                lastGeneratedImageArtifactIds: ['artifact-1'],
            },
        });
        expect(result.images[0]).toEqual(expect.objectContaining({
            url: '/api/artifacts/artifact-1/download?inline=1',
            b64_json: null,
            artifactId: 'artifact-1',
        }));
        expect(result.artifacts[0]).toEqual(expect.objectContaining({
            id: 'artifact-1',
            inlinePath: '/api/artifacts/artifact-1/download?inline=1',
        }));
    });

    test('downloads remote generated image urls so they become reusable artifacts too', async () => {
        global.fetch = jest.fn(async () => ({
            ok: true,
            headers: {
                get: (name) => (String(name).toLowerCase() === 'content-type' ? 'image/png' : null),
            },
            arrayBuffer: async () => buildPngBuffer().buffer,
        }));

        const result = await persistGeneratedImages({
            sessionId: 'session-1',
            sourceMode: 'image',
            prompt: 'Editorial hero image',
            model: 'gpt-image-1',
            images: [{
                url: 'https://images.example.com/generated-hero.png',
                revised_prompt: 'Editorial hero image, clean and bold',
            }],
        });

        expect(global.fetch).toHaveBeenCalledWith('https://images.example.com/generated-hero.png', expect.objectContaining({
            method: 'GET',
        }));
        expect(artifactService.createStoredArtifact).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session-1',
            filename: expect.stringContaining('editorial-hero-image-01'),
        }));
        expect(result.images[0]).toEqual(expect.objectContaining({
            url: '/api/artifacts/artifact-1/download?inline=1',
            artifactId: 'artifact-1',
        }));
    });

    test('reads sandbox file urls when the provider returns local image paths', async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kimibuilt-image-'));
        const localImagePath = path.join(tempDir, 'generated-image.png');

        try {
            await fs.writeFile(localImagePath, buildPngBuffer());

            const result = await persistGeneratedImages({
                sessionId: 'session-1',
                sourceMode: 'image',
                prompt: 'Travel dashboard hero',
                model: 'gateway-image-model',
                images: [{
                    url: `sandbox:${localImagePath.replace(/\\/g, '/')}`,
                    revised_prompt: 'Travel dashboard hero, editorial collage',
                }],
            });

            expect(artifactService.createStoredArtifact).toHaveBeenCalledWith(expect.objectContaining({
                sessionId: 'session-1',
                extension: 'png',
                mimeType: 'image/png',
            }));
            expect(result.images[0]).toEqual(expect.objectContaining({
                url: '/api/artifacts/artifact-1/download?inline=1',
                artifactId: 'artifact-1',
            }));
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });

    test('persists alternate provider base64 image shapes', async () => {
        const result = await persistGeneratedImages({
            sessionId: 'session-1',
            sourceMode: 'image',
            prompt: 'Notebook cover',
            model: 'gateway-image-model',
            images: [{
                base64: buildPngBuffer().toString('base64').replace(/(.{8})/g, '$1\n'),
                mime_type: 'image/png',
                revisedPrompt: 'Notebook cover with clean geometry',
            }],
        });

        expect(artifactService.createStoredArtifact).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session-1',
            extension: 'png',
            mimeType: 'image/png',
            buffer: buildPngBuffer(),
        }));
        expect(result.artifactIds).toEqual(['artifact-1']);
        expect(result.images[0]).toEqual(expect.objectContaining({
            artifactId: 'artifact-1',
            revisedPrompt: 'Notebook cover with clean geometry',
        }));
    });

    test('falls back to a usable URL when a base64 field is truncated or invalid', async () => {
        global.fetch = jest.fn(async () => ({
            ok: true,
            headers: {
                get: (name) => (String(name).toLowerCase() === 'content-type' ? 'image/png' : null),
            },
            arrayBuffer: async () => buildPngBuffer().buffer,
        }));

        const result = await persistGeneratedImages({
            sessionId: 'session-1',
            sourceMode: 'image',
            prompt: 'Fallback image',
            model: 'gateway-image-model',
            images: [{
                url: 'https://images.example.com/fallback.png',
                b64_json: '[truncated 123 chars]',
                revised_prompt: 'Fallback image',
            }],
        });

        expect(global.fetch).toHaveBeenCalledWith('https://images.example.com/fallback.png', expect.objectContaining({
            method: 'GET',
        }));
        expect(result.images[0]).toEqual(expect.objectContaining({
            artifactId: 'artifact-1',
            url: '/api/artifacts/artifact-1/download?inline=1',
        }));
    });

    test('reports missing session ids as an artifact persistence skip reason', async () => {
        const result = await persistGeneratedImages({
            sessionId: '',
            sourceMode: 'image',
            prompt: 'Cat portrait',
            model: 'gateway-image-model',
            images: [{
                b64_json: buildPngBuffer().toString('base64'),
                revised_prompt: 'Cat portrait',
            }],
        });

        expect(artifactService.createStoredArtifact).not.toHaveBeenCalled();
        expect(result.artifactPersistence).toEqual(expect.objectContaining({
            sessionIdPresent: false,
            requested: 1,
            persisted: 0,
            skipped: 1,
            primaryReason: 'missing_session_id',
        }));
        expect(result.artifactPersistence.attempts[0]).toEqual(expect.objectContaining({
            status: 'skipped',
            reason: 'missing_session_id',
            payloadSource: 'inline_base64',
            hasDecodedImage: true,
        }));
    });

    test('reports undecodable provider URLs as an artifact persistence skip reason', async () => {
        global.fetch = jest.fn(async () => ({
            ok: true,
            headers: {
                get: (name) => (String(name).toLowerCase() === 'content-type' ? 'text/html' : null),
            },
            arrayBuffer: async () => Buffer.from('<html>not an image</html>').buffer,
        }));

        const result = await persistGeneratedImages({
            sessionId: 'session-1',
            sourceMode: 'image',
            prompt: 'Cat portrait',
            model: 'gateway-image-model',
            images: [{
                url: 'https://example.com/image.png',
                revised_prompt: 'Cat portrait',
            }],
        });

        expect(artifactService.createStoredArtifact).not.toHaveBeenCalled();
        expect(result.artifactPersistence).toEqual(expect.objectContaining({
            sessionIdPresent: true,
            requested: 1,
            persisted: 0,
            skipped: 1,
            primaryReason: 'no_decodable_image_payload',
        }));
        expect(result.artifactPersistence.attempts[0]).toEqual(expect.objectContaining({
            status: 'skipped',
            reason: 'no_decodable_image_payload',
            payloadSource: 'remote_url',
            hasSessionId: true,
            hasDecodedImage: false,
        }));
    });

    test('does not persist one-pixel placeholder image payloads as artifacts', async () => {
        const result = await persistGeneratedImages({
            sessionId: 'session-1',
            sourceMode: 'image',
            prompt: 'Tiny placeholder',
            model: 'gateway-image-model',
            images: [{
                b64_json: buildPngBuffer({ width: 1, height: 1 }).toString('base64'),
                revised_prompt: 'Tiny placeholder',
            }],
        });

        expect(artifactService.createStoredArtifact).not.toHaveBeenCalled();
        expect(result.images[0]).toEqual(expect.objectContaining({
            artifactId: null,
            b64_json: expect.any(String),
        }));
    });
});
