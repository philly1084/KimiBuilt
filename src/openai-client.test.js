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
        ['git-safe', {
            id: 'git-safe',
            name: 'Git Save And Push',
            description: 'Restricted local git operations',
            inputSchema: {
                type: 'object',
                required: ['action'],
                properties: {
                    action: { type: 'string' },
                    repositoryPath: { type: 'string' },
                    message: { type: 'string' },
                    paths: { type: 'array' },
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
        ['k3s-deploy', {
            id: 'k3s-deploy',
            name: 'K3s Deploy',
            description: 'Restricted k3s deployment flow over SSH',
            inputSchema: {
                type: 'object',
                required: ['action'],
                properties: {
                    action: { type: 'string' },
                    repositoryUrl: { type: 'string' },
                    targetDirectory: { type: 'string' },
                    manifestsPath: { type: 'string' },
                },
            },
        }],
    ]);

    const skills = new Map([
        ['web-fetch', { enabled: true, triggerPatterns: ['fetch', 'load page'], requiresConfirmation: false }],
        ['web-search', { enabled: true, triggerPatterns: ['search', 'look up'], requiresConfirmation: false }],
        ['web-scrape', { enabled: true, triggerPatterns: ['scrape', 'extract from'], requiresConfirmation: true }],
        ['image-generate', { enabled: true, triggerPatterns: ['generate image', 'create image'], requiresConfirmation: false }],
        ['image-search-unsplash', { enabled: true, triggerPatterns: ['unsplash', 'image search'], requiresConfirmation: false }],
        ['image-from-url', { enabled: true, triggerPatterns: ['image url', 'embed image'], requiresConfirmation: false }],
        ['file-read', { enabled: true, triggerPatterns: ['read file', 'open file'], requiresConfirmation: false }],
        ['file-write', { enabled: true, triggerPatterns: ['write file', 'save file'], requiresConfirmation: true }],
        ['file-search', { enabled: true, triggerPatterns: ['find file', 'search files'], requiresConfirmation: false }],
        ['file-mkdir', { enabled: true, triggerPatterns: ['create folder', 'mkdir'], requiresConfirmation: false }],
        ['git-safe', { enabled: true, triggerPatterns: ['git push', 'commit to github', 'save and push'], requiresConfirmation: true }],
        ['security-scan', { enabled: true, triggerPatterns: ['security check', 'audit code'], requiresConfirmation: false }],
        ['architecture-design', { enabled: true, triggerPatterns: ['design architecture', 'system design'], requiresConfirmation: false }],
        ['uml-generate', { enabled: true, triggerPatterns: ['generate uml', 'class diagram'], requiresConfirmation: false }],
        ['api-design', { enabled: true, triggerPatterns: ['design api', 'openapi'], requiresConfirmation: false }],
        ['schema-generate', { enabled: true, triggerPatterns: ['database schema', 'generate ddl'], requiresConfirmation: true }],
        ['migration-create', { enabled: true, triggerPatterns: ['create migration', 'schema migration'], requiresConfirmation: true }],
        ['ssh-execute', { enabled: true, triggerPatterns: ['ssh', 'remote command'], requiresConfirmation: true }],
        ['remote-command', { enabled: true, triggerPatterns: ['remote command', 'execute remotely'], requiresConfirmation: true }],
        ['k3s-deploy', { enabled: true, triggerPatterns: ['deploy to k3s', 'kubectl apply', 'rollout status'], requiresConfirmation: true }],
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

            if (id === 'k3s-deploy') {
                return {
                    success: true,
                    toolId: id,
                    data: {
                        action: params.action,
                        stdout: 'deployment.apps/backend configured',
                        stderr: '',
                        host: 'default-host:22',
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

    test('uses responses mode automatically for official OpenAI hosts', () => {
        expect(__testUtils.resolveOpenAIApiMode({
            baseURL: 'https://api.openai.com/v1',
            requestedMode: 'auto',
        })).toBe('responses');
    });

    test('uses chat mode automatically for custom hosts', () => {
        expect(__testUtils.resolveOpenAIApiMode({
            baseURL: 'https://api.groq.com/openai/v1',
            requestedMode: 'auto',
        })).toBe('chat');
    });

    test('allows forcing chat mode regardless of host', () => {
        expect(__testUtils.resolveOpenAIApiMode({
            baseURL: 'https://api.openai.com/v1',
            requestedMode: 'chat',
        })).toBe('chat');
        expect(__testUtils.shouldUseResponsesAPI({
            baseURL: 'https://api.openai.com/v1',
            requestedMode: 'chat',
        })).toBe(false);
    });

    test('allows forcing responses mode regardless of host', () => {
        expect(__testUtils.resolveOpenAIApiMode({
            baseURL: 'https://api.groq.com/openai/v1',
            requestedMode: 'responses',
        })).toBe('responses');
        expect(__testUtils.shouldUseResponsesAPI({
            baseURL: 'https://api.groq.com/openai/v1',
            requestedMode: 'responses',
        })).toBe(true);
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
            additionalProperties: false,
        });
    });

    test('defaults object schemas with named properties to disallow extra arguments', () => {
        expect(__testUtils.sanitizeToolSchema({
            type: 'object',
            properties: {
                payload: {
                    type: 'object',
                    properties: {
                        title: { type: 'string' },
                    },
                },
                metadata: {
                    type: 'object',
                },
            },
        })).toEqual({
            type: 'object',
            properties: {
                payload: {
                    type: 'object',
                    properties: {
                        title: { type: 'string' },
                    },
                    additionalProperties: false,
                },
                metadata: {
                    type: 'object',
                },
            },
            additionalProperties: false,
        });
    });

    test('enriches automatic tool descriptions with trigger and confirmation guidance', () => {
        const toolManager = createToolManager();
        const selectedTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            'Check the remote build host',
        );
        const remoteCommand = selectedTools.find((tool) => tool.id === 'remote-command');

        expect(remoteCommand).toBeTruthy();
        expect(remoteCommand.description).toContain('Execute remote server commands over SSH');
        expect(remoteCommand.description).toContain('"remote command"');
        expect(remoteCommand.description).toContain('Confirm before destructive or state-changing use');
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
            { id: 'file-read', skill: { requiresConfirmation: false } },
            { id: 'file-write', skill: { requiresConfirmation: true } },
            { id: 'file-mkdir', skill: { requiresConfirmation: false } },
        ]);

        expect(guidance).toContain('source of truth for tool availability');
        expect(guidance).toContain('tool definitions are attached');
        expect(guidance).toContain('file-mkdir');
        expect(guidance).toContain('full file body as `content`');
        expect(guidance).toContain('container-only paths');
        expect(guidance).toContain('confirm the action first');
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
                    limit: 10,
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

    test('builds deterministic blind scrape actions for explicit sensitive image scraping requests', () => {
        const actions = __testUtils.buildDeterministicPreflightActions(
            [
                { id: 'web-scrape' },
            ],
            'Scrape images from https://example.com/gallery without exposing the agent to the adult content.',
        );

        expect(actions).toEqual([
            {
                toolId: 'web-scrape',
                params: expect.objectContaining({
                    url: 'https://example.com/gallery',
                    browser: true,
                    captureImages: true,
                    blindImageCapture: true,
                    imageLimit: 12,
                }),
            },
        ]);
    });

    test('builds deterministic image-generation preflight actions for mixed image-and-pdf requests', () => {
        const actions = __testUtils.buildDeterministicPreflightActions(
            [
                { id: 'image-generate' },
            ],
            'Make a hypercar image and put it in a PDF brochure.',
        );

        expect(actions).toEqual([
            {
                toolId: 'image-generate',
                params: {
                    prompt: 'Make a hypercar image',
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

    test('selects git-safe and k3s-deploy for explicit repo and cluster operations', () => {
        jest.spyOn(settingsController, 'getEffectiveSshConfig').mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const toolManager = createToolManager();
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            'Commit the latest files to GitHub and deploy the updated image to k3s.',
            { executionProfile: 'remote-build' },
        );

        const selectedTools = __testUtils.selectAutomaticToolDefinitions(
            automaticTools,
            'Commit the latest files to GitHub and deploy the updated image to k3s.',
        );

        expect(selectedTools.map((tool) => tool.id)).toEqual(expect.arrayContaining([
            'git-safe',
            'k3s-deploy',
        ]));
    });

    test('deterministic research preflight fetches top pages and stores distilled notes', async () => {
        const memoryService = {
            rememberResearchNote: jest.fn().mockResolvedValue('note-1'),
        };
        const toolManager = {
            executeTool: jest.fn(async (toolId, params) => {
                if (toolId === 'web-search') {
                    return {
                        success: true,
                        toolId,
                        data: {
                            results: [
                                {
                                    title: 'Tiger article',
                                    url: 'https://example.com/tiger',
                                    snippet: 'Tigers are large cats.',
                                },
                                {
                                    title: 'Cat article',
                                    url: 'https://example.com/cat',
                                    snippet: 'Cats are smaller felines.',
                                },
                            ],
                        },
                    };
                }

                if (toolId === 'web-fetch') {
                    return {
                        success: true,
                        toolId,
                        data: {
                            url: params.url,
                            body: `<html><head><title>${params.url}</title></head><body><main>Important research facts about ${params.url}</main></body></html>`,
                        },
                    };
                }

                throw new Error(`Unexpected tool: ${toolId}`);
            }),
            getTool: jest.fn(),
        };

        const result = await __testUtils.runDeterministicToolPreflight({
            toolManager,
            automaticTools: [
                { id: 'web-search' },
                { id: 'web-fetch' },
            ],
            prompt: 'Please web research tigers and cats differences.',
            toolContext: {
                sessionId: 'session-1',
                memoryService,
            },
        });

        expect(result.toolEvents.map((event) => event.toolCall.function.name)).toEqual([
            'web-search',
            'web-fetch',
            'web-fetch',
        ]);
        expect(result.summaryMessage).toEqual(expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('[Research dossier]'),
        }));
        expect(result.summaryMessage.content).toContain('Top search results:');
        expect(result.summaryMessage.content).toContain('Verified source extracts:');
        expect(result.summaryMessage.content).toContain('Important research facts about https://example.com/tiger');
        expect(memoryService.rememberResearchNote).toHaveBeenCalledTimes(2);
        expect(memoryService.rememberResearchNote.mock.calls[0][1]).toContain('[Research note]');
        expect(memoryService.rememberResearchNote.mock.calls[0][1]).toContain('Query: tigers and cats differences');
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

    test('does not force a single tool for combined git push and k3s deploy requests', () => {
        expect(__testUtils.buildAutomaticToolChoice(
            [{ id: 'git-safe' }, { id: 'k3s-deploy' }, { id: 'remote-command' }],
            'responses',
            {
                prompt: 'Commit the latest files to GitHub and deploy them to k3s.',
            },
        )).toBe('auto');
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

    test('does not expose remote-command when SSH defaults are not configured', () => {
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

        expect(selectedTools.map((tool) => tool.id)).not.toContain('remote-command');
    });

    test('exposes remote-command even without explicit SSH intent if defaults exist', () => {
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

        expect(selectedTools.map((tool) => tool.id)).toContain('remote-command');
        expect(selectedTools.map((tool) => tool.id)).not.toContain('ssh-execute');
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
            { id: 'remote-command' },
        ]);

        expect(guidance).toContain('run_shell_command');
        expect(guidance).toContain('actual SSH error');
    });

    test('git and k3s guidance keeps ssh for config while clarifying repo source of truth', () => {
        const guidance = __testUtils.buildAutomaticToolGuidance([
            { id: 'git-safe' },
            { id: 'k3s-deploy' },
            { id: 'remote-command' },
        ]);

        expect(guidance).toContain('local workspace repository as the source of truth');
        expect(guidance).toContain('git-safe remote-info');
        expect(guidance).toContain('missing project checkout on the remote host');
        expect(guidance).toContain('Keep `remote-command` available for one-off server configuration and troubleshooting');
        expect(guidance).toContain('Do not claim generic local shell or sandbox limits for Git work');
        expect(guidance).toContain('Do not infer an arbitrary live website path such as `/var/www/...` as the target');
        expect(guidance).toContain('Never run `git init`, create a new remote host repository');
    });

    test('detects ssh as a required tool for explicit ssh prompts', () => {
        expect(__testUtils.promptHasExplicitSshIntent('Can you ssh into root@77.42.44.98 and check its health?')).toBe(true);
    });

    test('detects remote-command phrasing as remote execution intent', () => {
        expect(__testUtils.promptHasExplicitSshIntent('Run a remote command on root@77.42.44.98 to check its health.')).toBe(true);
        expect(__testUtils.promptHasExplicitSshIntent('Execute remotely on root@77.42.44.98 and check its health.')).toBe(true);
    });

    test('runs explicit ssh requests directly through remote-command without asking the model for tool selection', async () => {
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
            requiredToolId: 'remote-command',
            selectedTools,
            prompt: 'Can you ssh into root@77.42.44.98 and check its health?',
            toolContext: {},
            model: 'gemini-test',
        });

        expect(response.output[0].content[0].text).toContain('SSH command completed on 77.42.44.98:22.');
        expect(response.output[0].content[0].text).toContain('STDOUT:');
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
        );
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

    test('runs explicit web-scrape requests directly for sensitive image capture flows', async () => {
        const toolManager = createToolManager();
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            'Scrape images from https://example.com/gallery without exposing the agent to the adult content.',
        );
        const selectedTools = __testUtils.selectAutomaticToolDefinitions(
            automaticTools,
            'Scrape images from https://example.com/gallery without exposing the agent to the adult content.',
        );

        const response = await __testUtils.runDirectRequiredToolAction({
            toolManager,
            requiredToolId: 'web-scrape',
            selectedTools,
            prompt: 'Scrape images from https://example.com/gallery without exposing the agent to the adult content.',
            toolContext: {},
            model: 'gemini-test',
        });

        expect(response.output[0].content[0].text).toContain('Web scrape completed for https://example.com/gallery.');
        expect(toolManager.executeTool).toHaveBeenCalledWith(
            'web-scrape',
            expect.objectContaining({
                url: 'https://example.com/gallery',
                browser: true,
                captureImages: true,
                blindImageCapture: true,
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

        expect(automaticTools.some((tool) => tool.id === 'remote-command')).toBe(false);
    });

    test('exposes remote-command to the automatic tool catalog for remote build sessions', () => {
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

        expect(automaticTools.some((tool) => tool.id === 'remote-command')).toBe(true);
        expect(automaticTools.some((tool) => tool.id === 'ssh-execute')).toBe(false);
    });

    test('does not expose local file write tools to notes sessions', () => {
        const toolManager = createToolManager();
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            'Put this 3D tic tac toe implementation plan on the page.',
            { executionProfile: 'notes' },
        );

        expect(automaticTools.some((tool) => tool.id === 'file-write')).toBe(false);
        expect(automaticTools.some((tool) => tool.id === 'file-mkdir')).toBe(false);
    });

    test('does not create a deterministic remote-command preflight for generic cluster deployment wording', () => {
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
            'can you please set this up on the cluster. you will find everything you need on that cluster to deploy, you can move it to a pod on the cluster if you would like.',
            { executionProfile: 'remote-build' },
        );

        const actions = __testUtils.buildDeterministicPreflightActions(
            automaticTools,
            'can you please set this up on the cluster. you will find everything you need on that cluster to deploy, you can move it to a pod on the cluster if you would like.',
        );

        expect(actions).toEqual([]);
    });

    test('prefers remote-command and suppresses local file tools for remote website replacement prompts', () => {
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
            'Create a whole new HTML file, replace the existing website on the cluster, and restart the workload.',
            { executionProfile: 'remote-build' },
        );

        const selectedTools = __testUtils.selectAutomaticToolDefinitions(
            automaticTools,
            'Create a whole new HTML file, replace the existing website on the cluster, and restart the workload.',
        );

        expect(selectedTools.map((tool) => tool.id)).toContain('remote-command');
        expect(selectedTools.map((tool) => tool.id)).not.toContain('web-fetch');
        expect(selectedTools.map((tool) => tool.id)).not.toContain('file-read');
        expect(selectedTools.map((tool) => tool.id)).not.toContain('file-search');
        expect(selectedTools.map((tool) => tool.id)).not.toContain('file-write');
    });

    test('does not auto-select web-fetch for remote website replacement prompts with internal artifact links', () => {
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
            'Use https://api/artifacts/3ee64601-2cb4-43e1-b56b-973bc2856419/download to replace the website on the cluster and restart the workload.',
            { executionProfile: 'remote-build' },
        );

        const selectedTools = __testUtils.selectAutomaticToolDefinitions(
            automaticTools,
            'Use https://api/artifacts/3ee64601-2cb4-43e1-b56b-973bc2856419/download to replace the website on the cluster and restart the workload.',
        );

        expect(selectedTools.map((tool) => tool.id)).toContain('remote-command');
        expect(selectedTools.map((tool) => tool.id)).not.toContain('web-fetch');
    });

    test('treats deployed html follow-ups as remote website work instead of local artifact work', () => {
        jest.spyOn(settingsController, 'getEffectiveSshConfig').mockReturnValue({
            enabled: true,
            host: '77.42.44.98',
            port: 22,
            username: 'root',
            password: 'secret',
            privateKeyPath: '',
        });

        const toolManager = createToolManager();
        const prompt = 'Replace the deployed HTML with the full beach gallery markup and publish it online.';
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            prompt,
            { executionProfile: 'remote-build' },
        );

        const selectedTools = __testUtils.selectAutomaticToolDefinitions(
            automaticTools,
            prompt,
        );

        expect(selectedTools.map((tool) => tool.id)).toContain('remote-command');
        expect(selectedTools.map((tool) => tool.id)).not.toContain('web-fetch');
        expect(selectedTools.map((tool) => tool.id)).not.toContain('file-read');
        expect(selectedTools.map((tool) => tool.id)).not.toContain('file-search');
        expect(selectedTools.map((tool) => tool.id)).not.toContain('file-write');
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

    test('extracts text from object-shaped chat message content', () => {
        expect(__testUtils.normalizeMessageContent({ text: 'hello' })).toBe('hello');
        expect(__testUtils.getChatCompletionText({
            choices: [{
                message: {
                    content: { text: 'final answer' },
                },
            }],
        })).toBe('final answer');
    });

    test('extracts Gemini-style chat content from message parts', () => {
        expect(__testUtils.getChatCompletionText({
            choices: [{
                message: {
                    parts: [{ text: 'Gemini answer' }],
                },
            }],
        })).toBe('Gemini answer');
    });

    test('extracts Gemini-style chat content from candidates payloads', () => {
        expect(__testUtils.getChatCompletionText({
            candidates: [{
                content: {
                    parts: [{ text: 'Candidate answer' }],
                },
            }],
        })).toBe('Candidate answer');
    });

    test('extracts responses text from both output_text and text content items', () => {
        expect(__testUtils.getResponseApiText({
            output: [{
                type: 'message',
                role: 'assistant',
                content: [
                    { type: 'text', text: 'Hello ' },
                    { type: 'output_text', text: 'world' },
                ],
            }],
        })).toBe('Hello world');
    });
});
