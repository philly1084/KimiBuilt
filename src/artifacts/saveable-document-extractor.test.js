const { extractSaveableDocumentArtifact } = require('./saveable-document-extractor');

describe('saveable document extractor', () => {
    test('extracts a complete HTML file from save-as prose', () => {
        const result = extractSaveableDocumentArtifact({
            assistantText: [
                'I can make it. Save this as `skydiving-research.html`.',
                '```html',
                '<!DOCTYPE html><html><head><title>Skydiving Research</title></head><body><main>Ready</main></body></html>',
                '```',
            ].join('\n'),
        });

        expect(result).toEqual(expect.objectContaining({
            format: 'html',
            filename: 'skydiving-research.html',
            title: 'skydiving-research',
            content: expect.stringContaining('<!DOCTYPE html>'),
        }));
        expect(result.content).not.toContain('I can make it');
    });

    test('ignores short non-document snippets', () => {
        expect(extractSaveableDocumentArtifact({
            assistantText: 'Use `<div>Hello</div>` inside your page.',
        })).toBeNull();
    });
});
