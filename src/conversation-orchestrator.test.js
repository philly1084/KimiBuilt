jest.mock('./routes/admin/settings.controller', () => ({
    getEffectiveSshConfig: jest.fn(),
}));

const settingsController = require('./routes/admin/settings.controller');
const {
    ConversationOrchestrator,
} = require('./conversation-orchestrator');

function buildResponse(text, id = 'resp_test') {
    return {
        id,
        model: 'gpt-test',
        output: [
            {
                type: 'message',
                role: 'assistant',
                content: [
                    {
                        type: 'output_text',
                        text,
                    },
                ],
            },
        ],
        metadata: {},
    };
}

describe('ConversationOrchestrator', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: false,
            host: '',
            port: 22,
            username: '',
            password: '',
            privateKeyPath: '',
        });
    });

    test('uses a plain model response when no tools are selected', async () => {
        const llmClient = {
            createResponse: jest.fn().mockResolvedValue(buildResponse('Plain answer', 'resp_plain')),
            complete: jest.fn(),
        };
        const toolManager = {
            getTool: jest.fn(() => null),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({ id: 'session-1', metadata: {} }),
            getRecentMessages: jest.fn().mockResolvedValue([{ role: 'assistant', content: 'Earlier answer' }]),
            recordResponse: jest.fn().mockResolvedValue(undefined),
            appendMessages: jest.fn().mockResolvedValue(undefined),
            update: jest.fn().mockResolvedValue(undefined),
        };
        const memoryService = {
            process: jest.fn().mockResolvedValue(['Remembered context']),
            rememberResponse: jest.fn(),
        };

        const orchestrator = new ConversationOrchestrator({
            llmClient,
            toolManager,
            sessionStore,
            memoryService,
        });

        const result = await orchestrator.executeConversation({
            input: 'Answer directly.',
            sessionId: 'session-1',
            stream: false,
        });

        expect(result.output).toBe('Plain answer');
        expect(llmClient.complete).not.toHaveBeenCalled();
        expect(llmClient.createResponse).toHaveBeenCalledWith(expect.objectContaining({
            input: 'Answer directly.',
            enableAutomaticToolCalls: false,
            contextMessages: ['Remembered context'],
            recentMessages: [{ role: 'assistant', content: 'Earlier answer' }],
        }));
        expect(sessionStore.recordResponse).toHaveBeenCalledWith('session-1', 'resp_plain');
        expect(memoryService.rememberResponse).toHaveBeenCalledWith('session-1', 'Plain answer');
    });

    test('plans and executes remote-build tool steps explicitly', async () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const llmClient = {
            createResponse: jest.fn().mockResolvedValue(buildResponse('Deployment is healthy.', 'resp_remote')),
            complete: jest.fn().mockResolvedValue(JSON.stringify({
                steps: [
                    {
                        tool: 'ssh-execute',
                        reason: 'Inspect service state on the remote host',
                        params: {
                            command: 'hostname && uptime',
                        },
                    },
                ],
            })),
        };
        const toolManager = {
            getTool: jest.fn((toolId) => (
                ['ssh-execute', 'docker-exec', 'web-search', 'web-fetch', 'file-read', 'file-search', 'tool-doc-read', 'code-sandbox']
                    .includes(toolId)
                    ? { id: toolId }
                    : null
            )),
            executeTool: jest.fn().mockResolvedValue({
                success: true,
                toolId: 'ssh-execute',
                data: {
                    stdout: 'host-a\nup 10 days',
                    stderr: '',
                    host: '10.0.0.5:22',
                },
            }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({ id: 'session-remote', metadata: {} }),
            getRecentMessages: jest.fn().mockResolvedValue([]),
            recordResponse: jest.fn().mockResolvedValue(undefined),
            appendMessages: jest.fn().mockResolvedValue(undefined),
            update: jest.fn().mockResolvedValue(undefined),
        };
        const memoryService = {
            process: jest.fn().mockResolvedValue([]),
            rememberResponse: jest.fn(),
        };

        const orchestrator = new ConversationOrchestrator({
            llmClient,
            toolManager,
            sessionStore,
            memoryService,
        });

        const result = await orchestrator.executeConversation({
            input: 'SSH into the remote server and check the deployment.',
            sessionId: 'session-remote',
            executionProfile: 'remote-build',
            stream: false,
        });

        expect(llmClient.complete).toHaveBeenCalledTimes(1);
        expect(toolManager.executeTool).toHaveBeenCalledWith(
            'ssh-execute',
            expect.objectContaining({
                command: 'hostname && uptime',
            }),
            expect.objectContaining({
                executionProfile: 'remote-build',
                sessionId: 'session-remote',
            }),
        );
        expect(result.response.metadata.toolEvents).toHaveLength(1);
        expect(result.response.metadata.executionProfile).toBe('remote-build');
        expect(result.output).toBe('Deployment is healthy.');
    });

    test('treats explicit web research and scrape requests as first-class tool intents', () => {
        const orchestrator = new ConversationOrchestrator({
            llmClient: {
                createResponse: jest.fn(),
                complete: jest.fn(),
            },
            toolManager: {
                getTool: jest.fn((toolId) => (
                    ['web-search', 'web-fetch', 'web-scrape'].includes(toolId)
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const researchPolicy = orchestrator.buildToolPolicy({
            objective: 'Can you do web research on this company for me?',
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
        });
        const scrapePolicy = orchestrator.buildToolPolicy({
            objective: 'Please scrape this site for the contact information.',
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
        });

        expect(researchPolicy.candidateToolIds).toContain('web-search');
        expect(scrapePolicy.candidateToolIds).toContain('web-search');
        expect(scrapePolicy.candidateToolIds).toContain('web-scrape');
    });

    test('treats image generation, unsplash, and direct image URLs as first-class tool intents', () => {
        const orchestrator = new ConversationOrchestrator({
            llmClient: {
                createResponse: jest.fn(),
                complete: jest.fn(),
            },
            toolManager: {
                getTool: jest.fn((toolId) => (
                    ['image-generate', 'image-search-unsplash', 'image-from-url'].includes(toolId)
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const generatePolicy = orchestrator.buildToolPolicy({
            objective: 'Generate a hero image for the landing page.',
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
        });
        const unsplashPolicy = orchestrator.buildToolPolicy({
            objective: 'Find me an Unsplash image for a coffee brand homepage.',
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
        });
        const urlPolicy = orchestrator.buildToolPolicy({
            objective: 'Use this image URL in the output: https://example.com/hero-image.png',
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
        });

        expect(generatePolicy.candidateToolIds).toContain('image-generate');
        expect(unsplashPolicy.candidateToolIds).toContain('image-search-unsplash');
        expect(urlPolicy.candidateToolIds).toContain('image-from-url');
    });
});
