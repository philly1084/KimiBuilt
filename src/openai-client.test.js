const { __testUtils } = require('./openai-client');

function createToolManager() {
    const tools = new Map([
        ['web-fetch', {
            id: 'web-fetch',
            name: 'Web Fetch',
            description: 'Fetch a URL',
            inputSchema: {
                type: 'object',
                required: ['url'],
                properties: {
                    url: { type: 'string' },
                    body: { type: ['string', 'object'] },
                },
            },
        }],
        ['web-search', {
            id: 'web-search',
            name: 'Web Search',
            description: 'Search the web',
            inputSchema: {
                type: 'object',
                required: ['query'],
                properties: {
                    query: { type: 'string' },
                },
            },
        }],
        ['web-scrape', {
            id: 'web-scrape',
            name: 'Web Scrape',
            description: 'Scrape a web page',
            inputSchema: {
                type: 'object',
                required: ['url'],
                properties: {
                    url: { type: 'string' },
                    selectors: {
                        type: 'object',
                        additionalProperties: {
                            type: 'object',
                            properties: {
                                selector: { type: 'string' },
                            },
                        },
                    },
                },
            },
        }],
        ['security-scan', {
            id: 'security-scan',
            name: 'Security Scan',
            description: 'Scan source for issues',
            inputSchema: {
                type: 'object',
                required: ['source'],
                properties: {
                    source: { type: 'string' },
                    language: { type: 'string' },
                },
            },
        }],
    ]);

    const skills = new Map([
        ['web-fetch', { enabled: true, triggerPatterns: ['fetch', 'load page'] }],
        ['web-search', { enabled: true, triggerPatterns: ['search', 'look up'] }],
        ['web-scrape', { enabled: true, triggerPatterns: ['scrape', 'extract from'] }],
        ['security-scan', { enabled: true, triggerPatterns: ['security check', 'audit code'] }],
    ]);

    return {
        getTool: (id) => tools.get(id),
        registry: {
            getSkill: (id) => skills.get(id),
        },
    };
}

describe('openai-client automatic tool orchestration helpers', () => {
    test('sanitizes union schema types into a single tool-compatible type', () => {
        expect(__testUtils.sanitizeToolSchema({
            type: 'object',
            properties: {
                body: { type: ['string', 'object'] },
            },
        })).toEqual({
            type: 'object',
            properties: {
                body: { type: 'string' },
            },
        });
    });

    test('selects web scraping tools only when the prompt looks like a scrape task', () => {
        const toolManager = createToolManager();
        const selectedTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            'Scrape https://example.com and extract the product prices',
        );

        expect(selectedTools.map((tool) => tool.id)).toContain('web-scrape');
        expect(selectedTools.map((tool) => tool.id)).not.toContain('security-scan');
    });

    test('selects security scan when the prompt includes code and security intent', () => {
        const toolManager = createToolManager();
        const selectedTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            'Audit this code for secrets:\n```js\nconst apiKey = "sk-test-123";\n```',
        );

        expect(selectedTools.map((tool) => tool.id)).toContain('security-scan');
    });

    test('truncates oversized tool payloads before returning them to the model loop', () => {
        const normalized = __testUtils.normalizeToolResultForModel({
            success: true,
            toolId: 'web-fetch',
            data: {
                body: 'a'.repeat(13050),
            },
        }, 'web-fetch');

        expect(normalized.data.body.length).toBeLessThan(12550);
        expect(normalized.data.body).toContain('[truncated');
    });

    test('builds prompt messages with supplemental memory and recent session transcript', () => {
        const messages = __testUtils.buildMessages({
            input: 'Use the same directory as before.',
            instructions: 'You are a helpful AI assistant.',
            contextMessages: ['Earlier the user worked with C:\\repo\\scripts'],
            recentMessages: [
                { role: 'user', content: 'Work in C:\\repo\\scripts and list the files.' },
                { role: 'assistant', content: 'I will work in C:\\repo\\scripts.' },
            ],
        });

        expect(messages[0]).toEqual({
            role: 'system',
            content: 'You are a helpful AI assistant.',
        });
        expect(messages[1].role).toBe('system');
        expect(messages[1].content).toContain('Supplemental recalled memory');
        expect(messages[2]).toEqual({
            role: 'user',
            content: 'Work in C:\\repo\\scripts and list the files.',
        });
        expect(messages[3]).toEqual({
            role: 'assistant',
            content: 'I will work in C:\\repo\\scripts.',
        });
        expect(messages[4]).toEqual({
            role: 'user',
            content: 'Use the same directory as before.',
        });
    });

    test('merges route instructions with client-provided system prompts instead of stacking them', () => {
        const messages = __testUtils.buildMessages({
            input: [
                { role: 'system', content: 'You are editing a notes page.' },
                { role: 'user', content: 'Summarize the page.' },
            ],
            instructions: 'You are a helpful AI assistant.',
        });

        expect(messages[0]).toEqual({
            role: 'system',
            content: 'You are a helpful AI assistant.\n\nYou are editing a notes page.',
        });
        expect(messages[1]).toEqual({
            role: 'user',
            content: 'Summarize the page.',
        });
        expect(messages).toHaveLength(2);
    });
});
