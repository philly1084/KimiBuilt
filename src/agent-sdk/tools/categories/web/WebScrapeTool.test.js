const { WebScrapeTool } = require('./WebScrapeTool');

describe('WebScrapeTool content extraction', () => {
    test('returns cleaned page text even when no selectors are provided', async () => {
        const tool = new WebScrapeTool();
        const fetchTool = {
            execute: jest.fn().mockResolvedValue({
                success: true,
                data: {
                    url: 'https://example.com/article',
                    body: '<!DOCTYPE html><html><head><title>Example Article</title><style>.hidden{display:none;}</style></head><body><main><h1>Headline</h1><p>Alpha beta gamma.</p></main><script>window.ignore = true;</script></body></html>',
                },
            }),
        };
        const context = {
            tools: {
                get: jest.fn().mockReturnValue(fetchTool),
            },
        };
        const tracker = {
            recordRead: jest.fn(),
        };

        const result = await tool.handler({
            url: 'https://example.com/article',
        }, context, tracker);

        expect(result.title).toBe('Example Article');
        expect(result.url).toBe('https://example.com/article');
        expect(result.content).toContain('Headline Alpha beta gamma.');
        expect(result.content).not.toContain('<main>');
        expect(result.content).not.toContain('window.ignore');
        expect(result.contentLength).toBe(result.content.length);
        expect(result.stats.contentChars).toBe(result.content.length);
    });
});
