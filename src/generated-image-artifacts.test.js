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

describe('generated-image-artifacts', () => {
    beforeEach(() => {
        jest.clearAllMocks();
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

    test('persists inline generated images as session artifacts and returns reusable artifact urls', async () => {
        const result = await persistGeneratedImages({
            sessionId: 'session-1',
            sourceMode: 'image',
            prompt: 'Cuba beaches at sunset',
            model: 'kimi-k2-turbo-preview',
            images: [{
                url: 'data:image/png;base64,aGVsbG8=',
                b64_json: 'aGVsbG8=',
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
});
