const { __testUtils } = require('./openai-client');
const settingsController = require('./routes/admin/settings.controller');

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
        ['file-read', {
            id: 'file-read',
            name: 'File Reader',
            description: 'Read file contents',
            inputSchema: {
                type: 'object',
                required: ['path'],
                properties: {
                    path: { type: 'string' },
                },
            },
        }],
        ['file-write', {
            id: 'file-write',
            name: 'File Writer',
            description: 'Write file contents',
            inputSchema: {
                type: 'object',
                required: ['path', 'content'],
                properties: {
                    path: { type: 'string' },
                    content: { type: 'string' },
                },
            },
        }],
        ['file-search', {
            id: 'file-search',
            name: 'File Search',
            description: 'Search files',
            inputSchema: {
                type: 'object',
                required: ['pattern'],
                properties: {
                    pattern: { type: 'string' },
                },
            },
        }],
        ['file-mkdir', {
            id: 'file-mkdir',
            name: 'Directory Creator',
            description: 'Create directories',
            inputSchema: {
                type: 'object',
                required: ['path'],
                properties: {
                    path: { type: 'string' },
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
        ['ssh-execute', {
            id: 'ssh-execute',
            name: 'SSH Command',
            description: 'Execute commands on remote servers via SSH',
            inputSchema: {
                type: 'object',
                required: ['command'],
                properties: {
                    command: { type: 'string' },
                    host: { type: 'string' },
                },
            },
        }],
    ]);

    const skills = new Map([
        ['web-fetch', { enabled: true, triggerPatterns: ['fetch', 'load page'] }],
        ['web-search', { enabled: true, triggerPatterns: ['search', 'look up'] }],
        ['web-scrape', { enabled: true, triggerPatterns: ['scrape', 'extract from'] }],
        ['file-read', { enabled: true, triggerPatterns: ['read file', 'open file'] }],
        ['file-write', { enabled: true, triggerPatterns: ['write file', 'save file'] }],
        ['file-search', { enabled: true, triggerPatterns: ['find file', 'search files'] }],
        ['file-mkdir', { enabled: true, triggerPatterns: ['create folder', 'mkdir'] }],
        ['security-scan', { enabled: true, triggerPatterns: ['security check', 'audit code'] }],
        ['ssh-execute', { enabled: true, triggerPatterns: ['ssh', 'remote command'] }],
    ]);

    return {
        getTool: (id) => tools.get(id),
        registry: {
            getSkill: (id) => skills.get(id),
        },
    };
}

describe('openai-client automatic tool orchestration helpers', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

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

    test('selects general tools generically instead of using prompt heuristics', () => {
        const toolManager = createToolManager();
        const selectedTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            'Hello world',
        );

        expect(selectedTools.map((tool) => tool.id)).toContain('web-scrape');
        expect(selectedTools.map((tool) => tool.id)).toContain('security-scan');
    });

    test('provides security scan unconditionally', () => {
        const toolManager = createToolManager();
        const selectedTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            'Say hello',
        );

        expect(selectedTools.map((tool) => tool.id)).toContain('security-scan');
    });

    test('exposes filesystem tools automatically', () => {
        const toolManager = createToolManager();
        const selectedTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            '',
        );

        const ids = selectedTools.map((tool) => tool.id);
        expect(ids).toContain('file-mkdir');
        expect(ids).toContain('file-write');
    });

    test('filesystem tool guidance forbids invented availability excuses', () => {
        const guidance = __testUtils.buildAutomaticToolGuidance([
            { id: 'file-read' },
            { id: 'file-mkdir' },
        ]);

        expect(guidance).toContain('source of truth for tool availability');
        expect(guidance).toContain('AVAILABLE_TOOLS_JSON');
        expect(guidance).toContain('file-mkdir');
    });

    test('extracts explicit web research queries for deterministic preflight', () => {
        expect(
            __testUtils.extractExplicitWebResearchQuery('Still not working, can you web research tigers and cats differences.'),
        ).toBe('tigers and cats differences');
    });

    test('extracts requested folder names for deterministic preflight', () => {
        expect(
            __testUtils.extractRequestedDirectoryPath('Can you make a folder put our designs in, called folder'),
        ).toBe('folder');
    });

    test('builds deterministic preflight actions for mixed research and folder requests', () => {
        const actions = __testUtils.buildDeterministicPreflightActions(
            [
                { id: 'web-search' },
                { id: 'file-mkdir' },
            ],
            'Please web research tigers and cats differences. Then make a folder called folder.',
        );

        expect(actions).toEqual([
            {
                toolId: 'web-search',
                params: expect.objectContaining({
                    query: 'tigers and cats differences',
                }),
            },
            {
                toolId: 'file-mkdir',
                params: {
                    path: 'folder',
                    recursive: true,
                },
            },
        ]);
    });

    test('narrows tool exposure to relevant tools for the current prompt', () => {
        const toolManager = createToolManager();
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            'Please web research tigers and cats differences and make a folder called folder.',
        );

        const selectedTools = __testUtils.selectAutomaticToolDefinitions(
            automaticTools,
            'Please web research tigers and cats differences and make a folder called folder.',
        );

        expect(selectedTools.map((tool) => tool.id)).toEqual(['web-search', 'file-mkdir']);
    });

    test('forces a specific tool when only one relevant tool remains', () => {
        expect(__testUtils.buildAutomaticToolChoice([{ id: 'web-search' }], 'responses')).toEqual({
            type: 'function',
            name: 'web-search',
        });
    });

    test('exposes ssh-execute unconditionally when defaults exist', () => {
        jest.spyOn(settingsController, 'getEffectiveSshConfig').mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        expect(__testUtils.shouldAutoUseTool('ssh-execute', 'Say hello.')).toBe(true);
    });

    test('does not expose ssh-execute when SSH defaults are not configured', () => {
        jest.spyOn(settingsController, 'getEffectiveSshConfig').mockReturnValue({
            enabled: false,
            host: '',
            port: 22,
            username: '',
            password: '',
            privateKeyPath: '',
        });

        const toolManager = createToolManager();
        const selectedTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            'SSH into the server and run kubectl get pods',
        );

        expect(selectedTools.map((tool) => tool.id)).not.toContain('ssh-execute');
    });

    test('exposes ssh-execute even without explicit SSH intent if defaults exist', () => {
        jest.spyOn(settingsController, 'getEffectiveSshConfig').mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const toolManager = createToolManager();
        const selectedTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            'Say hello',
        );

        expect(selectedTools.map((tool) => tool.id)).toContain('ssh-execute');
    });

    test('treats tool_calls as non-terminal in streaming normalization logic', () => {
        expect(__testUtils.isTerminalFinishReason('tool_calls')).toBe(false);
        expect(__testUtils.isTerminalFinishReason('stop')).toBe(true);
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
