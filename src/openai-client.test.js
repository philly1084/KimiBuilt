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
        ['image-generate', {
            id: 'image-generate',
            name: 'Image Generator',
            description: 'Generate images from a prompt',
            inputSchema: {
                type: 'object',
                required: ['prompt'],
                properties: {
                    prompt: { type: 'string' },
                },
            },
        }],
        ['image-search-unsplash', {
            id: 'image-search-unsplash',
            name: 'Unsplash Image Search',
            description: 'Search Unsplash for images',
            inputSchema: {
                type: 'object',
                required: ['query'],
                properties: {
                    query: { type: 'string' },
                },
            },
        }],
        ['image-from-url', {
            id: 'image-from-url',
            name: 'Image URL Reference',
            description: 'Normalize a direct image URL',
            inputSchema: {
                type: 'object',
                required: ['url'],
                properties: {
                    url: { type: 'string' },
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
        ['architecture-design', {
            id: 'architecture-design',
            name: 'Architecture Designer',
            description: 'Generate architecture designs',
            inputSchema: {
                type: 'object',
                required: ['requirements'],
                properties: {
                    requirements: { type: 'string' },
                },
            },
        }],
        ['uml-generate', {
            id: 'uml-generate',
            name: 'UML Generator',
            description: 'Generate UML diagrams',
            inputSchema: {
                type: 'object',
                required: ['source'],
                properties: {
                    source: { type: 'string' },
                    type: { type: 'string' },
                },
            },
        }],
        ['api-design', {
            id: 'api-design',
            name: 'API Designer',
            description: 'Design API contracts',
            inputSchema: {
                type: 'object',
                required: ['name', 'resources'],
                properties: {
                    name: { type: 'string' },
                    resources: { type: 'array' },
                },
            },
        }],
        ['schema-generate', {
            id: 'schema-generate',
            name: 'Schema Generator',
            description: 'Generate database schemas',
            inputSchema: {
                type: 'object',
                required: ['entities'],
                properties: {
                    entities: { type: 'array' },
                },
            },
        }],
        ['migration-create', {
            id: 'migration-create',
            name: 'Migration Generator',
            description: 'Generate schema migrations',
            inputSchema: {
                type: 'object',
                required: ['from', 'to'],
                properties: {
                    from: { type: 'object' },
                    to: { type: 'object' },
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
        ['remote-command', {
            id: 'remote-command',
            name: 'Remote Command',
            description: 'Execute remote server commands over SSH',
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
        ['image-generate', { enabled: true, triggerPatterns: ['generate image', 'create image'] }],
        ['image-search-unsplash', { enabled: true, triggerPatterns: ['unsplash', 'image search'] }],
        ['image-from-url', { enabled: true, triggerPatterns: ['image url', 'embed image'] }],
        ['file-read', { enabled: true, triggerPatterns: ['read file', 'open file'] }],
        ['file-write', { enabled: true, triggerPatterns: ['write file', 'save file'] }],
        ['file-search', { enabled: true, triggerPatterns: ['find file', 'search files'] }],
        ['file-mkdir', { enabled: true, triggerPatterns: ['create folder', 'mkdir'] }],
        ['security-scan', { enabled: true, triggerPatterns: ['security check', 'audit code'] }],
        ['architecture-design', { enabled: true, triggerPatterns: ['design architecture', 'system design'] }],
        ['uml-generate', { enabled: true, triggerPatterns: ['generate uml', 'class diagram'] }],
        ['api-design', { enabled: true, triggerPatterns: ['design api', 'openapi'] }],
        ['schema-generate', { enabled: true, triggerPatterns: ['database schema', 'generate ddl'] }],
        ['migration-create', { enabled: true, triggerPatterns: ['create migration', 'schema migration'] }],
        ['ssh-execute', { enabled: true, triggerPatterns: ['ssh', 'remote command'] }],
        ['remote-command', { enabled: true, triggerPatterns: ['remote command', 'execute remotely'] }],
    ]);

    return {
        getTool: (id) => tools.get(id),
        executeTool: jest.fn(async (id, params) => {
            if (id === 'ssh-execute' || id === 'remote-command') {
                return {
                    success: true,
                    toolId: id,
                    data: {
                        stdout: 'host\nup 10 days',
                        stderr: '',
                        host: `${params.host || 'default-host'}:${params.port || 22}`,
                    },
                };
            }

            return {
                success: true,
                toolId: id,
                data: params,
            };
        }),
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
        expect(guidance).toContain('tool definitions are attached');
        expect(guidance).toContain('file-mkdir');
    });

    test('extracts explicit web research queries for deterministic preflight', () => {
        expect(
            __testUtils.extractExplicitWebResearchQuery('Still not working, can you web research tigers and cats differences.'),
        ).toBe('tigers and cats differences');
        expect(
            __testUtils.extractExplicitWebResearchQuery('Please do research on the best static site hosts for docs.'),
        ).toBe('the best static site hosts for docs');
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

    test('builds deterministic ssh preflight actions for explicit health checks', () => {
        const actions = __testUtils.buildDeterministicPreflightActions(
            [
                { id: 'ssh-execute' },
            ],
            'Can you ssh into root@77.42.44.98 and check its health?',
        );

        expect(actions).toEqual([
            {
                toolId: 'ssh-execute',
                params: {
                    host: '77.42.44.98',
                    username: 'root',
                    command: 'hostname && uptime && (df -h / || true) && (free -m || true)',
                },
            },
        ]);
    });

    test('prefers remote-command for deterministic ssh preflight when both SSH tools are available', () => {
        const actions = __testUtils.buildDeterministicPreflightActions(
            [
                { id: 'ssh-execute' },
                { id: 'remote-command' },
            ],
            'Can you ssh into root@77.42.44.98 and check its health?',
        );

        expect(actions).toEqual([
            {
                toolId: 'remote-command',
                params: {
                    host: '77.42.44.98',
                    username: 'root',
                    command: 'hostname && uptime && (df -h / || true) && (free -m || true)',
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

    test('selects image tools for generation, unsplash, and direct URL prompts', () => {
        const toolManager = createToolManager();
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            'Use an Unsplash image for the hero and embed this image URL https://example.com/photo.png.',
        );

        const selectedTools = __testUtils.selectAutomaticToolDefinitions(
            automaticTools,
            'Use an Unsplash image for the hero and embed this image URL https://example.com/photo.png.',
        );

        expect(selectedTools.map((tool) => tool.id)).toEqual(expect.arrayContaining([
            'image-search-unsplash',
            'image-from-url',
        ]));
    });

    test('selects promoted architecture, api, schema, and migration tools for matching prompts', () => {
        const toolManager = createToolManager();
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            'Design the system architecture, produce an OpenAPI spec, generate a database schema, and create a migration.',
        );

        const selectedTools = __testUtils.selectAutomaticToolDefinitions(
            automaticTools,
            'Design the system architecture, produce an OpenAPI spec, generate a database schema, and create a migration.',
        );

        expect(selectedTools.map((tool) => tool.id)).toEqual(expect.arrayContaining([
            'architecture-design',
            'api-design',
            'schema-generate',
            'migration-create',
        ]));
    });

    test('forces a specific tool when only one relevant tool remains', () => {
        expect(__testUtils.buildAutomaticToolChoice([{ id: 'web-search' }], 'responses')).toEqual({
            type: 'function',
            name: 'web-search',
        });
    });

    test('forces the required research tool when multiple tools are attached', () => {
        expect(__testUtils.buildAutomaticToolChoice(
            [{ id: 'web-search' }, { id: 'web-fetch' }],
            'responses',
            {
                prompt: 'Please research the latest managed Postgres options for startups.',
            },
        )).toEqual({
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

    test('exposes ssh-execute for explicit SSH intent without defaults', () => {
        jest.spyOn(settingsController, 'getEffectiveSshConfig').mockReturnValue({
            enabled: false,
            host: '',
            port: 22,
            username: '',
            password: '',
            privateKeyPath: '',
        });

        expect(__testUtils.shouldAutoUseTool('ssh-execute', 'SSH into root@77.42.44.98 and check its health.')).toBe(true);
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

    test('ssh tool guidance forbids made-up shell tool excuses', () => {
        jest.spyOn(settingsController, 'getEffectiveSshConfig').mockReturnValue({
            enabled: false,
            host: '',
            port: 22,
            username: '',
            password: '',
            privateKeyPath: '',
        });

        const guidance = __testUtils.buildAutomaticToolGuidance([
            { id: 'ssh-execute' },
        ]);

        expect(guidance).toContain('run_shell_command');
        expect(guidance).toContain('actual SSH error');
    });

    test('detects ssh as a required tool for explicit ssh prompts', () => {
        expect(__testUtils.promptHasExplicitSshIntent('Can you ssh into root@77.42.44.98 and check its health?')).toBe(true);
    });

    test('detects remote-command phrasing as remote execution intent', () => {
        expect(__testUtils.promptHasExplicitSshIntent('Run a remote command on root@77.42.44.98 to check its health.')).toBe(true);
        expect(__testUtils.promptHasExplicitSshIntent('Execute remotely on root@77.42.44.98 and check its health.')).toBe(true);
    });

    test('runs explicit ssh requests directly without asking the model for tool selection', async () => {
        jest.spyOn(settingsController, 'getEffectiveSshConfig').mockReturnValue({
            enabled: false,
            host: '',
            port: 22,
            username: '',
            password: '',
            privateKeyPath: '',
        });

        const toolManager = createToolManager();
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            'Can you ssh into root@77.42.44.98 and check its health?',
        );
        const selectedTools = __testUtils.selectAutomaticToolDefinitions(
            automaticTools,
            'Can you ssh into root@77.42.44.98 and check its health?',
        );

        const response = await __testUtils.runDirectRequiredToolAction({
            toolManager,
            requiredToolId: 'ssh-execute',
            selectedTools,
            prompt: 'Can you ssh into root@77.42.44.98 and check its health?',
            toolContext: {},
            model: 'gemini-test',
        });

        expect(response.output[0].content[0].text).toContain('SSH command completed on 77.42.44.98:22.');
        expect(response.output[0].content[0].text).toContain('STDOUT:');
        expect(toolManager.executeTool).toHaveBeenCalledWith(
            'ssh-execute',
            expect.objectContaining({
                host: '77.42.44.98',
                username: 'root',
                command: 'hostname && uptime && (df -h / || true) && (free -m || true)',
            }),
            expect.any(Object),
        );
    });

    test('runs explicit remote-command requests directly when that alias is selected', async () => {
        jest.spyOn(settingsController, 'getEffectiveSshConfig').mockReturnValue({
            enabled: false,
            host: '',
            port: 22,
            username: '',
            password: '',
            privateKeyPath: '',
        });

        const toolManager = createToolManager();
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            'Can you ssh into root@77.42.44.98 and check its health?',
        ).filter((tool) => tool.id !== 'ssh-execute');
        const selectedTools = __testUtils.selectAutomaticToolDefinitions(
            automaticTools,
            'Can you ssh into root@77.42.44.98 and check its health?',
        );

        const response = await __testUtils.runDirectRequiredToolAction({
            toolManager,
            requiredToolId: 'remote-command',
            selectedTools,
            prompt: 'Can you ssh into root@77.42.44.98 and check its health?',
            toolContext: {},
            model: 'gemini-test',
        });

        expect(response.output[0].content[0].text).toContain('SSH command completed on 77.42.44.98:22.');
        expect(toolManager.executeTool).toHaveBeenCalledWith(
            'remote-command',
            expect.objectContaining({
                host: '77.42.44.98',
                username: 'root',
                command: 'hostname && uptime && (df -h / || true) && (free -m || true)',
            }),
            expect.any(Object),
        );
    });

    test('does not expose ssh for generic automatic tool use just because defaults exist', () => {
        jest.spyOn(settingsController, 'getEffectiveSshConfig').mockReturnValue({
            enabled: true,
            host: '77.42.44.98',
            port: 22,
            username: 'root',
            password: 'secret',
            privateKeyPath: '',
        });

        const toolManager = createToolManager();
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            'Summarize the deployment approach for this project.',
        );

        expect(automaticTools.some((tool) => tool.id === 'ssh-execute')).toBe(false);
    });

    test('exposes ssh to the automatic tool catalog for remote build sessions', () => {
        jest.spyOn(settingsController, 'getEffectiveSshConfig').mockReturnValue({
            enabled: true,
            host: '77.42.44.98',
            port: 22,
            username: 'root',
            password: 'secret',
            privateKeyPath: '',
        });

        const toolManager = createToolManager();
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            'Summarize the deployment approach for this project.',
            { executionProfile: 'remote-build' },
        );

        expect(automaticTools.some((tool) => tool.id === 'ssh-execute')).toBe(true);
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
