const { extractArtifact } = require('./artifact-extractor');

describe('extractArtifact', () => {
    test('preserves Mermaid line breaks for preview and reuse', async () => {
        const result = await extractArtifact({
            filename: 'cats-flow.mmd',
            mimeType: 'text/vnd.mermaid',
            buffer: Buffer.from('flowchart TD\nA["Cats"]\nB["Observe them cleaning"]\nA --> B', 'utf8'),
        });

        expect(result).toEqual(expect.objectContaining({
            format: 'mermaid',
            extractedText: 'flowchart TD\nA["Cats"]\nB["Observe them cleaning"]\nA --> B',
            previewHtml: expect.stringContaining('A[&quot;Cats&quot;]'),
        }));
        expect(result.previewHtml).toContain('\nB[&quot;Observe them cleaning&quot;]');
    });
});
