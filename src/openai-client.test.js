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
        ['asset-search', {
            id: 'asset-search',
            name: 'Asset Search',
            description: 'Search indexed images, documents, artifacts, and workspace files',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string' },
                    kind: { type: 'string' },
                    sourceType: { type: 'string' },
                    includeContent: { type: 'boolean' },
                    refresh: { type: 'boolean' },
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
        ['agent-workload', {
            id: 'agent-workload',
            name: 'Agent Workload Manager',
            description: 'Create and manage deferred workloads',
            inputSchema: {
                type: 'object',
                required: ['action'],
                properties: {
                    action: { type: 'string' },
                    request: { type: 'string' },
                    workloadId: { type: 'string' },
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
        ['user-checkpoint', {
            id: 'user-checkpoint',
            name: 'User Checkpoint',
            description: 'Create a structured multiple-choice checkpoint before major work.',
            inputSchema: {
                type: 'object',
                required: ['question', 'options'],
                properties: {
                    title: { type: 'string' },
                    question: { type: 'string' },
                    options: { type: 'array' },
                },
            },
        }],
        ['document-workflow', {
            id: 'document-workflow',
            name: 'Document Workflow',
            description: 'Recommend, plan, and generate documents or slide decks from prompts and source material.',
            inputSchema: {
                type: 'object',
                required: ['action'],
                properties: {
                    action: { type: 'string' },
                    prompt: { type: 'string' },
                    format: { type: 'string' },
                    documentType: { type: 'string' },
                    sources: { type: 'array' },
                },
            },
        }],
        ['deep-research-presentation', {
            id: 'deep-research-presentation',
            name: 'Deep Research Presentation',
            description: 'Plan, research, source images, and generate a research-backed presentation in one workflow.',
            inputSchema: {
                type: 'object',
                properties: {
                    prompt: { type: 'string' },
                    documentType: { type: 'string' },
                    format: { type: 'string' },
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
        ['asset-search', { enabled: true, triggerPatterns: ['search assets', 'find earlier document'], requiresConfirmation: false }],
        ['file-read', { enabled: true, triggerPatterns: ['read file', 'open file'], requiresConfirmation: false }],
        ['file-write', { enabled: true, triggerPatterns: ['write file', 'save file'], requiresConfirmation: true }],
        ['file-search', { enabled: true, triggerPatterns: ['find file', 'search files'], requiresConfirmation: false }],
        ['file-mkdir', { enabled: true, triggerPatterns: ['create folder', 'mkdir'], requiresConfirmation: false }],
        ['agent-workload', { enabled: true, triggerPatterns: ['schedule this for later', 'daily agent', 'follow up tomorrow'], requiresConfirmation: false }],
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
        ['user-checkpoint', { enabled: true, triggerPatterns: ['ask a checkpoint question'], requiresConfirmation: false }],
        ['document-workflow', { enabled: true, triggerPatterns: ['generate document', 'make slides', 'create brief'], requiresConfirmation: false }],
        ['deep-research-presentation', { enabled: true, triggerPatterns: ['deep research presentation', 'research-backed slide deck'], requiresConfirmation: false }],
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

            if (id === 'document-workflow') {
                return {
                    success: true,
                    toolId: id,
                    data: {
                        action: params.action || 'generate',
                        document: {
                            id: 'doc-1',
                            filename: 'brief.html',
                            mimeType: 'text/html',
                            downloadUrl: '/api/documents/doc-1/download',
                        },
                    },
                };
            }

            if (id === 'deep-research-presentation') {
                return {
                    success: true,
                    toolId: id,
                    data: {
                        action: 'research_and_generate_presentation',
                        document: {
                            id: 'deck-1',
                            filename: 'research-deck.pptx',
                            mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                            downloadUrl: '/api/documents/deck-1/download',
                        },
                    },
                };
            }

            if (id === 'agent-workload') {
                return {
                    success: true,
                    toolId: id,
                    data: {
                        action: params.action,
                        message: 'Daily blockers summary created. Every day at 11:05 PM.',
                        workload: {
                            id: 'workload-1',
                            title: 'Daily blockers summary',
                            trigger: {
                                type: 'cron',
                                expression: '5 23 * * *',
                                timezone: 'America/Halifax',
                            },
                        },
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

    test('infers provider family from model and host for compatibility handling', () => {
        expect(__testUtils.inferProviderFamily({
            baseURL: 'https://api.groq.com/openai/v1',
            model: 'llama-3.3-70b-versatile',
        })).toBe('groq');
        expect(__testUtils.inferProviderFamily({
            baseURL: 'https://gateway.internal/v1',
            model: 'gemini-2.5-pro',
        })).toBe('gemini');
        expect(__testUtils.inferProviderFamily({
            baseURL: 'https://api.openai.com/v1',
            model: 'gpt-4o',
        })).toBe('openai');
    });

    test('skips chat reasoning_effort for Gemini and Groq providers', () => {
        expect(__testUtils.shouldSendReasoningEffort({
            baseURL: 'https://api.groq.com/openai/v1',
            model: 'llama-3.3-70b-versatile',
            api: 'chat',
        })).toBe(false);
        expect(__testUtils.shouldSendReasoningEffort({
            baseURL: 'https://gateway.internal/v1',
            model: 'gemini-2.5-pro',
            api: 'chat',
        })).toBe(false);
        expect(__testUtils.shouldSendReasoningEffort({
            baseURL: 'https://api.openai.com/v1',
            model: 'gpt-4o',
            api: 'chat',
        })).toBe(true);
    });

    test('accepts object-shaped tool arguments from provider tool calls', () => {
        expect(__testUtils.parseToolArguments({
            host: '77.42.44.98',
            command: 'hostname',
        })).toEqual({
            host: '77.42.44.98',
            command: 'hostname',
        });
    });

    test('repairs JSON-like tool arguments before parsing', () => {
        expect(__testUtils.parseToolArguments("command:'hostname', host:'77.42.44.98', options:['-f',], dryRun:False"))
            .toEqual({
                command: 'hostname',
                host: '77.42.44.98',
                options: ['-f'],
                dryRun: false,
            });
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

    test('carryover notes guidance explains durable note usage', () => {
        settingsController.settings.agentNotes = {
            enabled: true,
            displayName: 'Carryover Notes',
        };

        const guidance = __testUtils.buildAutomaticToolGuidance([
            { id: 'agent-notes-write' },
        ]);

        expect(guidance).toContain('durable user-wide carryover notes file');
        expect(guidance).toContain('Phil-specific collaboration facts');
        expect(guidance).toContain('under 4000 characters');
    });

    test('image guidance encourages saving verified real images for documents', () => {
        const guidance = __testUtils.buildAutomaticToolGuidance([
            { id: 'image-generate' },
            { id: 'image-search-unsplash' },
            { id: 'image-from-url' },
        ]);

        expect(guidance).toContain('up to 20 relevant Unsplash images');
        expect(guidance).toContain('batches of up to 20 direct image URLs');
        expect(guidance).toContain('prefer `image-search-unsplash` and `image-from-url` over `image-generate`');
        expect(guidance).toContain('research-backed reports, news pages, and current-events documents');
        expect(guidance).toContain('Default `image-generate` to one image');
        expect(guidance).toContain('prompt for one image, not a collage');
    });

    test('asset search guidance explains how to recover prior files and visuals', () => {
        const guidance = __testUtils.buildAutomaticToolGuidance([
            { id: 'asset-search' },
        ]);

        expect(guidance).toContain('find earlier images, PDFs, documents, uploaded artifacts, and workspace files');
        expect(guidance).toContain('kind:"image"');
        expect(guidance).toContain('includeContent: true');
    });

    test('checkpoint guidance forbids request_user_input when user-checkpoint is attached', () => {
        const guidance = __testUtils.buildAutomaticToolGuidance([
            { id: 'user-checkpoint' },
        ]);

        expect(guidance).toContain('Use `user-checkpoint` for a high-impact decision before major work');
        expect(guidance).toContain('do not call or mention `request_user_input`');
        expect(guidance).toContain('Do not tell the user that a questionnaire tool failed');
        expect(guidance).toContain('Do not claim that the inline survey card rendered');
        expect(guidance).toContain('Do not write a multi-question quiz or personality test as assistant text');
        expect(guidance).toContain('primary quick way to involve the user');
        expect(guidance).toContain('Prefer `user-checkpoint` over a prose "which option do you want?" message');
        expect(guidance).toContain('one card with one visible step at a time');
        expect(guidance).toContain('Supported step types are choice, multi-choice, text, date, time, and datetime');
    });

    test('extracts explicit web research queries for deterministic preflight', () => {
        expect(
            __testUtils.extractExplicitWebResearchQuery('Still not working, can you web research tigers and cats differences.'),
        ).toBe('tigers and cats differences');
        expect(
            __testUtils.extractExplicitWebResearchQuery('Please do research on the best static site hosts for docs.'),
        ).toBe('the best static site hosts for docs');
    });

    test('always selects the carryover notes tool when it is available and enabled', () => {
        settingsController.settings.agentNotes = {
            enabled: true,
            displayName: 'Carryover Notes',
        };

        const selectedTools = __testUtils.selectAutomaticToolDefinitions([
            { id: 'agent-notes-write' },
        ], 'Summarize the latest product direction.');

        expect(selectedTools.map((tool) => tool.id)).toContain('agent-notes-write');
    });

    test('does not select the carryover notes tool when it is disabled', () => {
        settingsController.settings.agentNotes = {
            enabled: false,
            displayName: 'Carryover Notes',
        };

        const selectedTools = __testUtils.selectAutomaticToolDefinitions([
            { id: 'agent-notes-write' },
        ], 'Summarize the latest product direction.');

        expect(selectedTools.map((tool) => tool.id)).not.toContain('agent-notes-write');
    });

    test('does not select the carryover notes tool inside an isolated session', () => {
        settingsController.settings.agentNotes = {
            enabled: true,
            displayName: 'Carryover Notes',
        };

        const selectedTools = __testUtils.selectAutomaticToolDefinitions([
            { id: 'agent-notes-write' },
        ], 'Summarize the latest product direction.', {
            toolContext: {
                sessionIsolation: true,
            },
        });

        expect(selectedTools.map((tool) => tool.id)).not.toContain('agent-notes-write');
    });

    test('selects asset-search when the prompt refers to earlier documents or images', () => {
        const selectedTools = __testUtils.selectAutomaticToolDefinitions([
            { id: 'asset-search' },
            { id: 'document-workflow' },
        ], 'Use the PDF we worked on earlier and the same image from before.');

        expect(selectedTools.map((tool) => tool.id)).toContain('asset-search');
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

    test('offers user-checkpoint alongside normal tools for web-chat when checkpoint budget remains', () => {
        const toolManager = createToolManager();
        const prompt = 'Build a web chat survey flow before doing the larger implementation.';
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            prompt,
            {
                toolContext: {
                    clientSurface: 'web-chat',
                    userCheckpointPolicy: {
                        enabled: true,
                        remaining: 2,
                        pending: null,
                    },
                },
            },
        );

        const selectedTools = __testUtils.selectAutomaticToolDefinitions(
            automaticTools,
            prompt,
            {
                toolContext: {
                    clientSurface: 'web-chat',
                    userCheckpointPolicy: {
                        enabled: true,
                        remaining: 2,
                        pending: null,
                    },
                },
            },
        );

        expect(selectedTools.map((tool) => tool.id)).toContain('user-checkpoint');
    });

    test('forces user-checkpoint for explicit questionnaire tool testing prompts', () => {
        const toolManager = createToolManager();
        const prompt = 'To test our tool can you ask me a multiple choice questionnaire?';
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            prompt,
            {
                toolContext: {
                    clientSurface: 'web-chat',
                    userCheckpointPolicy: {
                        enabled: true,
                        remaining: 2,
                        pending: null,
                    },
                },
            },
        );

        const selectedTools = __testUtils.selectAutomaticToolDefinitions(
            automaticTools,
            prompt,
            {
                toolContext: {
                    clientSurface: 'web-chat',
                    userCheckpointPolicy: {
                        enabled: true,
                        remaining: 2,
                        pending: null,
                    },
                },
            },
        );

        const toolChoice = __testUtils.buildAutomaticToolChoice(
            selectedTools,
            'responses',
            {
                prompt,
                toolContext: {
                    clientSurface: 'web-chat',
                    userCheckpointPolicy: {
                        enabled: true,
                        remaining: 2,
                        pending: null,
                    },
                },
            },
        );

        expect(selectedTools.map((tool) => tool.id)).toContain('user-checkpoint');
        expect(toolChoice).toEqual({
            type: 'function',
            name: 'user-checkpoint',
        });
    });

    test('forces user-checkpoint for inline survey card prompts and common questionnaire misspellings', () => {
        const toolManager = createToolManager();
        const prompt = 'Can you ask me these questions as a questionaire in the inline survey card?';
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            prompt,
            {
                toolContext: {
                    clientSurface: 'web-chat',
                    userCheckpointPolicy: {
                        enabled: true,
                        remaining: 2,
                        pending: null,
                    },
                },
            },
        );

        const selectedTools = __testUtils.selectAutomaticToolDefinitions(
            automaticTools,
            prompt,
            {
                toolContext: {
                    clientSurface: 'web-chat',
                    userCheckpointPolicy: {
                        enabled: true,
                        remaining: 2,
                        pending: null,
                    },
                },
            },
        );

        const toolChoice = __testUtils.buildAutomaticToolChoice(
            selectedTools,
            'responses',
            {
                prompt,
                toolContext: {
                    clientSurface: 'web-chat',
                    userCheckpointPolicy: {
                        enabled: true,
                        remaining: 2,
                        pending: null,
                    },
                },
            },
        );

        expect(__testUtils.hasExplicitUserCheckpointInteractionIntent(prompt)).toBe(true);
        expect(selectedTools.map((tool) => tool.id)).toContain('user-checkpoint');
        expect(toolChoice).toEqual({
            type: 'function',
            name: 'user-checkpoint',
        });
    });

    test('forces user-checkpoint for survey creation requests that should not become workload or research', () => {
        const toolManager = createToolManager();
        const prompt = 'Lets make plans. Give me some ideas in a survey of some things we could build';
        const toolContext = {
            clientSurface: 'web-chat',
            userCheckpointPolicy: {
                enabled: true,
                remaining: 2,
                pending: null,
            },
            workloadService: {
                isAvailable: () => true,
            },
        };

        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            prompt,
            { toolContext },
        );
        const selectedTools = __testUtils.selectAutomaticToolDefinitions(
            automaticTools,
            prompt,
            { toolContext },
        );
        const toolChoice = __testUtils.buildAutomaticToolChoice(
            selectedTools,
            'responses',
            { prompt, toolContext },
        );

        expect(__testUtils.hasExplicitUserCheckpointInteractionIntent(prompt)).toBe(true);
        expect(selectedTools.map((tool) => tool.id)).toContain('user-checkpoint');
        expect(toolChoice).toEqual({
            type: 'function',
            name: 'user-checkpoint',
        });
        expect(__testUtils.buildDeterministicPreflightActions(selectedTools, prompt)).toEqual([]);
    });

    test('forces user-checkpoint for direct survey requests that explicitly reject workload', () => {
        const toolManager = createToolManager();
        const prompt = 'can we do the survey no, no workload';
        const toolContext = {
            clientSurface: 'web-chat',
            userCheckpointPolicy: {
                enabled: true,
                remaining: 2,
                pending: null,
            },
            workloadService: {
                isAvailable: () => true,
            },
        };

        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            prompt,
            { toolContext },
        );
        const selectedTools = __testUtils.selectAutomaticToolDefinitions(
            automaticTools,
            prompt,
            { toolContext },
        );
        const toolChoice = __testUtils.buildAutomaticToolChoice(
            selectedTools,
            'responses',
            { prompt, toolContext },
        );

        expect(__testUtils.hasExplicitUserCheckpointInteractionIntent(prompt)).toBe(true);
        expect(toolChoice).toEqual({
            type: 'function',
            name: 'user-checkpoint',
        });
    });

    test('extracts a single checkpoint from a numbered prose questionnaire fallback', () => {
        const checkpoint = __testUtils.extractQuestionnaireCheckpointFromText([
            'Use these 5 and reply with the option letter for each.',
            '1. What should this server be mainly?',
            'A. Personal app host',
            'B. Staging/dev box',
            'C. Production platform',
            'D. Homelab / experiments',
            '2. What should I prioritize first?',
            'A. Fix broken workloads',
            'B. Clean up and simplify the cluster',
        ].join('\n'));

        expect(checkpoint).toEqual(expect.objectContaining({
            title: 'Quick choice',
            question: 'What should this server be mainly?',
            preamble: 'Pick the closest fit below and I will continue from there.',
            options: [
                expect.objectContaining({ id: 'a', label: 'Personal app host' }),
                expect.objectContaining({ id: 'b', label: 'Staging/dev box' }),
                expect.objectContaining({ id: 'c', label: 'Production platform' }),
                expect.objectContaining({ id: 'd', label: 'Homelab / experiments' }),
            ],
        }));
    });

    test('extracts a checkpoint from conversational question-1 prose with a reply footer', () => {
        const checkpoint = __testUtils.extractQuestionnaireCheckpointFromText([
            'Yes. We can do it one question at a time.',
            'Question 1: What do you want this questionnaire to be about?',
            'A. Planning',
            'B. Building',
            'C. Troubleshooting',
            'D. Just testing it',
            'Reply with A, B, C, or D.',
        ].join('\n'));

        expect(checkpoint).toEqual(expect.objectContaining({
            question: 'What do you want this questionnaire to be about?',
            options: [
                expect.objectContaining({ id: 'a', label: 'Planning' }),
                expect.objectContaining({ id: 'b', label: 'Building' }),
                expect.objectContaining({ id: 'c', label: 'Troubleshooting' }),
                expect.objectContaining({ id: 'd', label: 'Just testing it' }),
            ],
        }));
    });

    test('recovers a real user-checkpoint response from prose questionnaire output', () => {
        const recovered = __testUtils.maybeRecoverUserCheckpointResponse({
            response: {
                choices: [{
                    message: {
                        content: [
                            'Use these 5 and reply with the option letter for each.',
                            '1. What should this server be mainly?',
                            'A. Personal app host',
                            'B. Staging/dev box',
                            'C. Production platform',
                            'D. Homelab / experiments',
                        ].join('\n'),
                    },
                }],
            },
            selectedTools: [{ id: 'user-checkpoint' }],
            toolEvents: [],
            toolContext: {
                userCheckpointPolicy: {
                    enabled: true,
                    remaining: 2,
                    pending: null,
                },
            },
            model: 'gpt-test',
        });

        expect(recovered?.output?.[0]?.content?.[0]?.text || '').toContain('```survey');
        expect(recovered?._kimibuilt?.toolEvents?.[0]?.result?.toolId).toBe('user-checkpoint');
        expect(recovered?._kimibuilt?.toolEvents?.[0]?.result?.data?.recovered).toBe(true);
    });

    test('recovers a real user-checkpoint response from raw json questionnaire output', () => {
        const recovered = __testUtils.maybeRecoverUserCheckpointResponse({
            response: {
                choices: [{
                    message: {
                        content: [
                            'json',
                            '{',
                            '  "type": "survey",',
                            '  "id": "working-questaire-1",',
                            '  "title": "Quick Preferences",',
                            '  "questions": [',
                            '    {',
                            '      "id": "focus",',
                            '      "type": "single_choice",',
                            '      "prompt": "What should we focus on right now?",',
                            '      "options": [',
                            '        { "value": "plan", "label": "Planning a new project" },',
                            '        { "value": "build", "label": "Building something concrete" }',
                            '      ]',
                            '    },',
                            '    {',
                            '      "id": "output",',
                            '      "type": "multiple_choice",',
                            '      "prompt": "What outputs would be useful?",',
                            '      "options": [',
                            '        { "value": "code", "label": "Code snippet or script" },',
                            '        { "value": "doc", "label": "Documentation or notes" }',
                            '      ]',
                            '    }',
                            '  ]',
                            '}',
                            "That's the JSON for a working questionnaire.",
                        ].join('\n'),
                    },
                }],
            },
            selectedTools: [{ id: 'user-checkpoint' }],
            toolEvents: [],
            toolContext: {
                userCheckpointPolicy: {
                    enabled: true,
                    remaining: 2,
                    pending: null,
                },
            },
            model: 'gpt-test',
        });

        expect(recovered?.output?.[0]?.content?.[0]?.text || '').toContain('```survey');
        expect(recovered?._kimibuilt?.toolEvents?.[0]?.result?.toolId).toBe('user-checkpoint');
        expect(recovered?._kimibuilt?.toolEvents?.[0]?.result?.data?.checkpoint).toEqual(expect.objectContaining({
            id: 'working-questaire-1',
            title: 'Quick Preferences',
            steps: [
                expect.objectContaining({
                    id: 'focus',
                    inputType: 'choice',
                    options: [
                        expect.objectContaining({ id: 'plan', label: 'Planning a new project' }),
                        expect.objectContaining({ id: 'build', label: 'Building something concrete' }),
                    ],
                }),
                expect.objectContaining({
                    id: 'output',
                    inputType: 'multi-choice',
                    options: [
                        expect.objectContaining({ id: 'code', label: 'Code snippet or script' }),
                        expect.objectContaining({ id: 'doc', label: 'Documentation or notes' }),
                    ],
                }),
            ],
        }));
    });

    test('offers document-workflow for research-backed deck generation when document service is available', () => {
        const toolManager = createToolManager();
        const prompt = 'Research vacation pricing in Halifax and build a slide deck I can review.';
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            prompt,
            {
                toolContext: {
                    documentService: {},
                },
            },
        );

        const selectedTools = __testUtils.selectAutomaticToolDefinitions(
            automaticTools,
            prompt,
            {
                toolContext: {
                    documentService: {},
                },
            },
        );

        expect(selectedTools.map((tool) => tool.id)).toEqual(
            expect.arrayContaining(['web-search', 'document-workflow']),
        );
    });

    test('forces deep-research-presentation for explicit deep research deck requests', () => {
        const toolManager = createToolManager();
        const prompt = 'Do deep research on Halifax vacation pricing and make me a presentation I can review.';
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            prompt,
            {
                toolContext: {
                    documentService: {},
                },
            },
        );

        const selectedTools = __testUtils.selectAutomaticToolDefinitions(
            automaticTools,
            prompt,
            {
                toolContext: {
                    documentService: {},
                },
            },
        );
        const toolChoice = __testUtils.buildAutomaticToolChoice(
            selectedTools,
            'responses',
            {
                prompt,
                toolContext: {
                    documentService: {},
                },
            },
        );

        expect(selectedTools.map((tool) => tool.id)).toEqual(
            expect.arrayContaining(['deep-research-presentation', 'web-search', 'document-workflow']),
        );
        expect(toolChoice).toEqual({
            type: 'function',
            name: 'deep-research-presentation',
        });
    });

    test('suppresses user-checkpoint when a checkpoint is already pending', () => {
        const toolManager = createToolManager();
        const prompt = 'Refactor the web chat experience.';
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            prompt,
            {
                toolContext: {
                    clientSurface: 'web-chat',
                    userCheckpointPolicy: {
                        enabled: true,
                        remaining: 1,
                        pending: {
                            id: 'checkpoint-1',
                            question: 'Which direction?',
                        },
                    },
                },
            },
        );

        const selectedTools = __testUtils.selectAutomaticToolDefinitions(
            automaticTools,
            prompt,
            {
                toolContext: {
                    clientSurface: 'web-chat',
                    userCheckpointPolicy: {
                        enabled: true,
                        remaining: 1,
                        pending: {
                            id: 'checkpoint-1',
                            question: 'Which direction?',
                        },
                    },
                },
            },
        );

        expect(selectedTools.map((tool) => tool.id)).not.toContain('user-checkpoint');
    });

    test('suppresses user-checkpoint on survey response turns so the agent continues the work', () => {
        const toolManager = createToolManager();
        const prompt = 'Survey response (checkpoint-1): chose "Pricing tables" [pricing-tables].';
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            prompt,
            {
                toolContext: {
                    clientSurface: 'web-chat',
                    userCheckpointPolicy: {
                        enabled: true,
                        remaining: 1,
                        pending: null,
                    },
                },
            },
        );

        const selectedTools = __testUtils.selectAutomaticToolDefinitions(
            automaticTools,
            prompt,
            {
                toolContext: {
                    clientSurface: 'web-chat',
                    userCheckpointPolicy: {
                        enabled: true,
                        remaining: 1,
                        pending: null,
                    },
                },
            },
        );

        expect(selectedTools.map((tool) => tool.id)).not.toContain('user-checkpoint');
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

    test('selects agent-workload for recurring setup requests and forces the tool choice', () => {
        const toolManager = createToolManager();
        const prompt = 'Set up a daily agent workload to summarize blockers every day at 11:05 PM.';
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            prompt,
            {
                workloadService: {
                    isAvailable: () => true,
                },
            },
        );

        const selectedTools = __testUtils.selectAutomaticToolDefinitions(automaticTools, prompt);
        const toolChoice = __testUtils.buildAutomaticToolChoice(selectedTools, 'responses', { prompt });

        expect(selectedTools.map((tool) => tool.id)).toContain('agent-workload');
        expect(toolChoice).toEqual({
            type: 'function',
            name: 'agent-workload',
        });
    });

    test('selects agent-workload for time-first future prompts without requiring the word schedule', () => {
        const toolManager = createToolManager();
        const prompt = 'In 5 minutes can you do some research on ADHD and make a PDF document on it I can review.';
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            prompt,
            {
                workloadService: {
                    isAvailable: () => true,
                },
            },
        );

        const selectedTools = __testUtils.selectAutomaticToolDefinitions(automaticTools, prompt);
        const toolChoice = __testUtils.buildAutomaticToolChoice(selectedTools, 'responses', { prompt });

        expect(selectedTools.map((tool) => tool.id)).toContain('agent-workload');
        expect(toolChoice).toEqual({
            type: 'function',
            name: 'agent-workload',
        });
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

    test('prefers verified image tools over generation for real-image document requests', () => {
        const toolManager = createToolManager();
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            'Create a landing page with real images from Unsplash and this image URL https://example.com/photo.png.',
        );

        const selectedTools = __testUtils.selectAutomaticToolDefinitions(
            automaticTools,
            'Create a landing page with real images from Unsplash and this image URL https://example.com/photo.png.',
        );

        expect(selectedTools.map((tool) => tool.id)).toEqual(expect.arrayContaining([
            'image-search-unsplash',
            'image-from-url',
        ]));
        expect(selectedTools.map((tool) => tool.id)).not.toContain('image-generate');
    });

    test('selects research and real-image tools for news-style html document requests', () => {
        const toolManager = createToolManager();
        const prompt = 'Create an HTML news report on the latest EV tariffs with sourced visuals and current reporting.';
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            prompt,
        );

        const selectedTools = __testUtils.selectAutomaticToolDefinitions(
            automaticTools,
            prompt,
        );

        expect(selectedTools.map((tool) => tool.id)).toEqual(expect.arrayContaining([
            'web-search',
            'web-fetch',
            'image-search-unsplash',
        ]));
        expect(selectedTools.map((tool) => tool.id)).not.toContain('image-generate');
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
            { id: 'agent-workload' },
            { id: 'git-safe' },
            { id: 'k3s-deploy' },
            { id: 'remote-command' },
        ]);

        expect(guidance).toContain('local workspace repository as the source of truth');
        expect(guidance).toContain('git-safe remote-info');
        expect(guidance).toContain('missing project checkout on the remote host');
        expect(guidance).toContain('Keep `remote-command` available for one-off server configuration and troubleshooting');
        expect(guidance).toContain('prefer `agent-workload` even when the task will later execute remote commands on a server');
        expect(guidance).toContain('split them into separate `agent-workload` creations');
        expect(guidance).toContain('Do not use `remote-command` as a substitute scheduler');
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

    test('restricts notes sessions to web research tools only', () => {
        const toolManager = createToolManager();
        const automaticTools = __testUtils.buildAutomaticToolDefinitions(
            toolManager,
            'Put this 3D tic tac toe implementation plan on the page.',
            { executionProfile: 'notes' },
        );

        expect(automaticTools.map((tool) => tool.id).sort()).toEqual([
            'web-fetch',
            'web-scrape',
            'web-search',
        ]);
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

    test('adds a recent transcript anchor ahead of recalled memory for referential follow-ups', () => {
        const messages = __testUtils.buildMessages({
            input: 'yes do deep research on that',
            instructions: 'You are a helpful AI assistant.',
            recentTranscriptAnchor: '[Recent transcript anchor]\nuser: Research Halifax vacation pricing for a presentation.',
            contextMessages: ['Older memory about an unrelated project'],
        });

        expect(messages[1]).toEqual({
            role: 'system',
            content: '[Recent transcript anchor]\nuser: Research Halifax vacation pricing for a presentation.',
        });
        expect(messages[2].role).toBe('system');
        expect(messages[2].content).toContain('If it conflicts with the recent transcript or the user\'s current request, ignore it');
    });

    test('runs a direct required workload action for explicit scheduling prompts', async () => {
        const toolManager = createToolManager();
        const response = await __testUtils.runDirectRequiredToolAction({
            toolManager,
            requiredToolId: 'agent-workload',
            selectedTools: [{ id: 'agent-workload' }],
            prompt: 'Set up a daily agent workload to summarize blockers every day at 11:05 PM.',
            toolContext: {
                timezone: 'America/Halifax',
                workloadService: {
                    isAvailable: () => true,
                },
            },
            model: 'gpt-4o',
        });

        expect(response.output[0].content[0].text).toContain('Every day at 11:05 PM');
        expect(toolManager.executeTool).toHaveBeenCalledWith(
            'agent-workload',
            expect.objectContaining({
                action: 'create',
                title: 'Summarize Blockers',
                trigger: {
                    type: 'cron',
                    expression: '5 23 * * *',
                    timezone: 'America/Halifax',
                },
                metadata: expect.objectContaining({
                    createdFromScenario: true,
                    scenarioRequest: 'Set up a daily agent workload to summarize blockers every day at 11:05 PM.',
                }),
            }),
            expect.any(Object),
        );
    });

    test('reconstructs a fragmented workload request from recent transcript in direct required tool mode', async () => {
        const toolManager = createToolManager();
        const response = await __testUtils.runDirectRequiredToolAction({
            toolManager,
            requiredToolId: 'agent-workload',
            selectedTools: [{ id: 'agent-workload' }],
            prompt: 'run it five minutes from now',
            toolContext: {
                timezone: 'UTC',
                now: '2026-04-02T09:00:00.000Z',
                recentMessages: [
                    { role: 'user', content: 'gather information on the k3s cluster on the server' },
                ],
                workloadService: {
                    isAvailable: () => true,
                },
            },
            model: 'gpt-4o',
        });

        expect(response.output[0].content[0].text).toContain('Runs once at 2026-04-02T09:05:00.000Z');
        expect(toolManager.executeTool).toHaveBeenCalledWith(
            'agent-workload',
            expect.objectContaining({
                action: 'create',
                prompt: expect.stringContaining('gather information on the k3s cluster on the server'),
                trigger: {
                    type: 'once',
                    runAt: '2026-04-02T09:05:00.000Z',
                },
                metadata: expect.objectContaining({
                    scenarioRequest: expect.stringContaining('gather information on the k3s cluster on the server'),
                }),
            }),
            expect.any(Object),
        );
    });

    test('does not auto-use agent-workload while executing a deferred workload run', () => {
        expect(__testUtils.shouldAutoUseTool(
            'agent-workload',
            'run a cron later every day at 8 pm to summarize blockers',
            null,
            {
                toolContext: {
                    workloadRun: true,
                    clientSurface: 'workload',
                    workloadService: {
                        isAvailable: () => true,
                    },
                },
            },
        )).toBe(false);
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

    test('extracts chat content from array items that use content and value keys instead of text', () => {
        expect(__testUtils.getChatCompletionText({
            choices: [{
                message: {
                    content: [
                        { type: 'output_text', content: 'Hello ' },
                        { type: 'output_text', value: 'world' },
                    ],
                },
            }],
        })).toBe('Hello world');
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

    test('normalizes streamed chat completions into a populated final response', async () => {
        async function* streamChunks() {
            yield {
                id: 'chatcmpl-groq-1',
                object: 'chat.completion.chunk',
                created: 1710000000,
                model: 'llama-3.3-70b-versatile',
                choices: [{
                    index: 0,
                    delta: { content: 'Hello ' },
                    finish_reason: null,
                }],
            };
            yield {
                id: 'chatcmpl-groq-1',
                object: 'chat.completion.chunk',
                created: 1710000000,
                model: 'llama-3.3-70b-versatile',
                choices: [{
                    index: 0,
                    delta: { content: 'world' },
                    finish_reason: null,
                }],
            };
            yield {
                id: 'chatcmpl-groq-1',
                object: 'chat.completion.chunk',
                created: 1710000000,
                model: 'llama-3.3-70b-versatile',
                choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: 'stop',
                }],
            };
        }

        const events = [];
        for await (const event of __testUtils.normalizeChatCompletionsStream(streamChunks())) {
            events.push(event);
        }

        expect(events).toEqual([
            {
                type: 'response.output_text.delta',
                delta: 'Hello ',
            },
            {
                type: 'response.output_text.delta',
                delta: 'world',
            },
            {
                type: 'response.completed',
                response: {
                    id: 'chatcmpl-groq-1',
                    object: 'response',
                    created: 1710000000,
                    model: 'llama-3.3-70b-versatile',
                    output: [{
                        type: 'message',
                        role: 'assistant',
                        content: [{
                            type: 'text',
                            text: 'Hello world',
                        }],
                    }],
                    session_id: undefined,
                    metadata: {},
                },
            },
        ]);
    });
});
