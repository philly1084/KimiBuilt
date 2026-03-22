jest.mock('./artifact-store', () => ({
    artifactStore: {
        create: jest.fn(),
        updateProcessing: jest.fn(),
        listBySession: jest.fn(),
        get: jest.fn(),
        delete: jest.fn(),
        deleteBySession: jest.fn(),
    },
}));

jest.mock('./artifact-renderer', () => ({
    renderArtifact: jest.fn(),
}));

jest.mock('../openai-client', () => ({
    createResponse: jest.fn(),
}));

jest.mock('../memory/vector-store', () => ({
    vectorStore: {
        store: jest.fn(),
        deleteArtifact: jest.fn(),
    },
}));

jest.mock('../postgres', () => ({
    postgres: {
        enabled: true,
        initialize: jest.fn().mockResolvedValue(true),
        query: jest.fn().mockResolvedValue({ rows: [] }),
    },
}));

const { artifactService } = require('./artifact-service');
const { artifactStore } = require('./artifact-store');
const { postgres } = require('../postgres');
const { renderArtifact } = require('./artifact-renderer');
const { createResponse } = require('../openai-client');

describe('ArtifactService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        artifactStore.create.mockResolvedValue({
            id: 'artifact-1',
            sessionId: 'session-1',
            filename: 'test.txt',
            extension: 'txt',
            mimeType: 'text/plain',
            sizeBytes: 4,
            extractedText: 'test',
            previewHtml: '',
            metadata: {},
            vectorizedAt: null,
        });
        artifactStore.updateProcessing.mockResolvedValue({
            id: 'artifact-1',
            sessionId: 'session-1',
            filename: 'test.txt',
            extension: 'txt',
            mimeType: 'text/plain',
            sizeBytes: 4,
            extractedText: 'test',
            previewHtml: '',
            metadata: {},
            vectorizedAt: null,
        });
        renderArtifact.mockResolvedValue({
            filename: 'out.html',
            format: 'html',
            mimeType: 'text/html',
            buffer: Buffer.from('<!DOCTYPE html><html><body>ok</body></html>'),
            extractedText: 'ok',
            previewHtml: '<!DOCTYPE html><html><body>ok</body></html>',
            metadata: { title: 'Test' },
        });
    });

    test('ensures a backing session row exists before storing an artifact', async () => {
        await artifactService.createStoredArtifact({
            sessionId: 'session-1',
            direction: 'generated',
            sourceMode: 'chat',
            filename: 'test.txt',
            extension: 'txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('test'),
            extractedText: 'test',
            previewHtml: '',
            metadata: {},
            vectorize: false,
        });

        expect(postgres.initialize).toHaveBeenCalled();
        expect(postgres.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO sessions'),
            ['session-1', null, '{}'],
        );
        expect(artifactStore.create).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session-1',
        }));
    });

    test('uses multi-pass generation for html-family artifacts', async () => {
        createResponse
            .mockResolvedValueOnce({
                id: 'resp-plan',
                output: [{
                    type: 'message',
                    content: [{ text: JSON.stringify({
                        title: 'Operations Runbook',
                        sections: [
                            { heading: 'Overview', purpose: 'Summarize the objective', keyPoints: ['Scope'], targetLength: 'short' },
                            { heading: 'Implementation', purpose: 'Explain the work', keyPoints: ['Steps'], targetLength: 'medium' },
                        ],
                    }) }],
                }],
            })
            .mockResolvedValueOnce({
                id: 'resp-expand',
                output: [{
                    type: 'message',
                    content: [{ text: JSON.stringify({
                        title: 'Operations Runbook',
                        sections: [
                            { heading: 'Overview', content: 'Overview content', level: 1 },
                            { heading: 'Implementation', content: 'Implementation content', level: 1 },
                        ],
                    }) }],
                }],
            })
            .mockResolvedValueOnce({
                id: 'resp-compose',
                output: [{
                    type: 'message',
                    content: [{ text: '<!DOCTYPE html><html><body><h1>Operations Runbook</h1></body></html>' }],
                }],
            });

        const result = await artifactService.generateArtifact({
            session: { previousResponseId: 'prev-1', metadata: {} },
            sessionId: 'session-1',
            mode: 'chat',
            prompt: 'Create a polished operations runbook for cluster setup.',
            format: 'pdf',
            artifactIds: [],
            existingContent: '',
            model: 'gpt-5.3',
        });

        expect(createResponse).toHaveBeenCalledTimes(3);
        expect(renderArtifact).toHaveBeenCalledWith(expect.objectContaining({
            format: 'pdf',
            title: 'Operations Runbook',
            content: expect.stringContaining('<html'),
        }));
        expect(artifactStore.create).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({
                generationStrategy: 'multi-pass',
                generationPasses: ['plan', 'expand', 'compose'],
                sectionCount: 2,
            }),
        }));
        expect(result.responseId).toBe('resp-compose');
    });
});
