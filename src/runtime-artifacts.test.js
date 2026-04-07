const { extractArtifactsFromToolEvents, mergeRuntimeArtifacts } = require('./runtime-artifacts');

describe('runtime artifact helpers', () => {
    test('extracts nested document-workflow artifacts from successful tool events', () => {
        const artifacts = extractArtifactsFromToolEvents([{
            toolCall: {
                function: {
                    name: 'document-workflow',
                },
            },
            result: {
                success: true,
                data: {
                    document: {
                        id: 'doc-1',
                        filename: 'mission-control.html',
                        mimeType: 'text/html',
                        downloadUrl: '/api/documents/doc-1/download',
                        metadata: { format: 'html' },
                    },
                },
            },
        }]);

        expect(artifacts).toEqual([
            expect.objectContaining({
                id: 'doc-1',
                filename: 'mission-control.html',
                format: 'html',
                mimeType: 'text/html',
                downloadUrl: '/api/documents/doc-1/download',
            }),
        ]);
    });

    test('deduplicates runtime artifacts across tool and generated sources', () => {
        const merged = mergeRuntimeArtifacts(
            [{
                id: 'doc-1',
                filename: 'mission-control.html',
                mimeType: 'text/html',
                downloadUrl: '/api/documents/doc-1/download',
            }],
            [{
                id: 'doc-1',
                filename: 'mission-control.html',
                mimeType: 'text/html',
                downloadUrl: '/api/documents/doc-1/download',
            }, {
                id: 'artifact-2',
                filename: 'mission-control.pdf',
                mimeType: 'application/pdf',
                downloadUrl: '/api/artifacts/artifact-2/download',
            }],
        );

        expect(merged).toEqual([
            expect.objectContaining({ id: 'doc-1' }),
            expect.objectContaining({ id: 'artifact-2', format: 'pdf' }),
        ]);
    });
});
