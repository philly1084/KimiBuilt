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

    test('continues through multiple remote-build rounds after broad user approval', async () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const llmClient = {
            createResponse: jest.fn().mockResolvedValue(buildResponse('Cluster inspection completed and the obvious next checks were run.', 'resp_auto')),
            complete: jest.fn()
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [
                        {
                            tool: 'ssh-execute',
                            reason: 'Check node status first',
                            params: {
                                command: 'kubectl get nodes -o wide',
                            },
                        },
                    ],
                }))
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [
                        {
                            tool: 'ssh-execute',
                            reason: 'Check pods after confirming nodes',
                            params: {
                                command: 'kubectl get pods -A -o wide',
                            },
                        },
                    ],
                }))
                .mockResolvedValueOnce(JSON.stringify({ steps: [] })),
        };

        const toolManager = {
            getTool: jest.fn((toolId) => (
                ['ssh-execute', 'docker-exec', 'web-search', 'web-fetch', 'file-read', 'file-search', 'tool-doc-read', 'code-sandbox']
                    .includes(toolId)
                    ? { id: toolId, description: toolId }
                    : null
            )),
            executeTool: jest.fn()
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'ssh-execute',
                    data: {
                        stdout: 'node-1 Ready',
                        stderr: '',
                        host: '10.0.0.5:22',
                    },
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'ssh-execute',
                    data: {
                        stdout: 'kube-system traefik Running',
                        stderr: '',
                        host: '10.0.0.5:22',
                    },
                }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({ id: 'session-remote', metadata: {} }),
            getOrCreate: jest.fn().mockResolvedValue({ id: 'session-remote', metadata: {} }),
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
            input: 'Use remote-build to inspect the cluster and keep going with the obvious next steps.',
            sessionId: 'session-remote',
            executionProfile: 'remote-build',
            stream: false,
        });

        expect(llmClient.complete).toHaveBeenCalledTimes(3);
        expect(toolManager.executeTool).toHaveBeenCalledTimes(2);
        expect(toolManager.executeTool).toHaveBeenNthCalledWith(
            1,
            'ssh-execute',
            expect.objectContaining({ command: 'kubectl get nodes -o wide' }),
            expect.objectContaining({ executionProfile: 'remote-build' }),
        );
        expect(toolManager.executeTool).toHaveBeenNthCalledWith(
            2,
            'ssh-execute',
            expect.objectContaining({ command: 'kubectl get pods -A -o wide' }),
            expect.objectContaining({ executionProfile: 'remote-build' }),
        );
        expect(sessionStore.update).toHaveBeenCalledWith('session-remote', expect.objectContaining({
            metadata: expect.objectContaining({
                remoteBuildAutonomyApproved: true,
            }),
        }));
        expect(result.response.metadata.toolEvents).toHaveLength(2);
        expect(result.response.metadata.executionTrace.map((entry) => entry.name)).toEqual(expect.arrayContaining([
            'Remote-build autonomy approved',
            'Plan round 1',
            'Execution round 1',
            'Plan round 2',
            'Execution round 2',
        ]));
    });

    test('accepts frontend-provided remote-build autonomy approval', async () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const llmClient = {
            createResponse: jest.fn().mockResolvedValue(buildResponse('Remote inspection completed.', 'resp_frontend_auto')),
            complete: jest.fn()
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [
                        {
                            tool: 'ssh-execute',
                            reason: 'Inspect the node first',
                            params: {
                                command: 'hostname && uname -m',
                            },
                        },
                    ],
                }))
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [
                        {
                            tool: 'ssh-execute',
                            reason: 'Inspect pods after node verification',
                            params: {
                                command: 'kubectl get pods -A',
                            },
                        },
                    ],
                }))
                .mockResolvedValueOnce(JSON.stringify({ steps: [] })),
        };

        const toolManager = {
            getTool: jest.fn((toolId) => (
                ['ssh-execute', 'docker-exec', 'web-search', 'web-fetch', 'file-read', 'file-search', 'tool-doc-read', 'code-sandbox']
                    .includes(toolId)
                    ? { id: toolId, description: toolId }
                    : null
            )),
            executeTool: jest.fn()
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'ssh-execute',
                    data: { stdout: 'host-a\naarch64', stderr: '', host: '10.0.0.5:22' },
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'ssh-execute',
                    data: { stdout: 'kube-system traefik Running', stderr: '', host: '10.0.0.5:22' },
                }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({ id: 'session-frontend-remote', metadata: {} }),
            getOrCreate: jest.fn().mockResolvedValue({ id: 'session-frontend-remote', metadata: {} }),
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

        await orchestrator.executeConversation({
            input: 'Inspect the cluster state on the server.',
            sessionId: 'session-frontend-remote',
            executionProfile: 'remote-build',
            metadata: {
                remoteBuildAutonomyApproved: true,
                clientSurface: 'web-chat',
            },
            stream: false,
        });

        expect(toolManager.executeTool).toHaveBeenCalledTimes(2);
        expect(sessionStore.update).toHaveBeenCalledWith('session-frontend-remote', expect.objectContaining({
            metadata: expect.objectContaining({
                remoteBuildAutonomyApproved: true,
            }),
        }));
    });

    test('continues beyond the old three-round cap while remote-build work is still making progress', async () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const llmClient = {
            createResponse: jest.fn().mockResolvedValue(buildResponse('Remote work completed after multiple autonomous rounds.', 'resp_long_auto')),
            complete: jest.fn()
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [{ tool: 'ssh-execute', reason: 'Round 1', params: { command: 'echo round-1' } }],
                }))
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [{ tool: 'ssh-execute', reason: 'Round 2', params: { command: 'echo round-2' } }],
                }))
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [{ tool: 'ssh-execute', reason: 'Round 3', params: { command: 'echo round-3' } }],
                }))
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [{ tool: 'ssh-execute', reason: 'Round 4', params: { command: 'echo round-4' } }],
                }))
                .mockResolvedValueOnce(JSON.stringify({ steps: [] })),
        };

        const toolManager = {
            getTool: jest.fn((toolId) => (
                ['ssh-execute', 'docker-exec', 'web-search', 'web-fetch', 'file-read', 'file-search', 'tool-doc-read', 'code-sandbox']
                    .includes(toolId)
                    ? { id: toolId, description: toolId }
                    : null
            )),
            executeTool: jest.fn()
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'ssh-execute',
                    data: { stdout: 'round-1', stderr: '', host: '10.0.0.5:22' },
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'ssh-execute',
                    data: { stdout: 'round-2', stderr: '', host: '10.0.0.5:22' },
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'ssh-execute',
                    data: { stdout: 'round-3', stderr: '', host: '10.0.0.5:22' },
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'ssh-execute',
                    data: { stdout: 'round-4', stderr: '', host: '10.0.0.5:22' },
                }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({ id: 'session-long-remote', metadata: {} }),
            getOrCreate: jest.fn().mockResolvedValue({ id: 'session-long-remote', metadata: {} }),
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
            input: 'Use remote-build to keep going until the server work is done.',
            sessionId: 'session-long-remote',
            executionProfile: 'remote-build',
            stream: false,
        });

        expect(toolManager.executeTool).toHaveBeenCalledTimes(4);
        expect(llmClient.complete).toHaveBeenCalledTimes(5);
        expect(result.response.metadata.toolEvents).toHaveLength(4);
        expect(result.response.metadata.executionTrace.map((entry) => entry.name)).toEqual(expect.arrayContaining([
            'Plan round 4',
            'Execution round 4',
        ]));
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

    test('forces a direct Perplexity-backed web-search action for explicit research requests', () => {
        const orchestrator = new ConversationOrchestrator({
            llmClient: {
                createResponse: jest.fn(),
                complete: jest.fn(),
            },
            toolManager: {
                getTool: jest.fn((toolId) => (
                    toolId === 'web-search'
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const toolPolicy = orchestrator.buildToolPolicy({
            objective: 'Please do research on managed Postgres providers for startups.',
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
        });
        const directAction = orchestrator.buildDirectAction({
            objective: 'Please do research on managed Postgres providers for startups.',
            toolPolicy,
        });

        expect(directAction).toEqual({
            tool: 'web-search',
            reason: 'Explicit research request should start with Perplexity-backed web search.',
            params: expect.objectContaining({
                engine: 'perplexity',
                query: 'managed Postgres providers for startups',
            }),
        });
    });

    test('falls back to deterministic web-search planning for kimi when planner output is not valid json', async () => {
        const llmClient = {
            createResponse: jest.fn(),
            complete: jest.fn().mockResolvedValue('I should use web-search to research this topic.'),
        };
        const orchestrator = new ConversationOrchestrator({
            llmClient,
            toolManager: {
                getTool: jest.fn((toolId) => (
                    ['web-search', 'web-fetch'].includes(toolId)
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const toolPolicy = orchestrator.buildToolPolicy({
            objective: 'Please research the best managed Postgres providers for startups.',
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
        });

        const plan = await orchestrator.planToolUse({
            objective: 'Please research the best managed Postgres providers for startups.',
            executionProfile: 'default',
            toolPolicy,
            model: 'kimi-k2',
        });

        expect(plan).toEqual([
            expect.objectContaining({
                tool: 'web-search',
                params: expect.objectContaining({
                    engine: 'perplexity',
                    query: expect.stringContaining('managed Postgres providers for startups'),
                }),
            }),
        ]);
    });

    test('falls back to deterministic ssh planning for kimi remote-build prompts', async () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const llmClient = {
            createResponse: jest.fn(),
            complete: jest.fn().mockResolvedValue('I would inspect the cluster over SSH first.'),
        };
        const orchestrator = new ConversationOrchestrator({
            llmClient,
            toolManager: {
                getTool: jest.fn((toolId) => (
                    ['ssh-execute', 'remote-command', 'web-search'].includes(toolId)
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const toolPolicy = orchestrator.buildToolPolicy({
            objective: 'Inspect the k3s cluster state on the server.',
            executionProfile: 'remote-build',
            toolManager: orchestrator.toolManager,
        });

        const plan = await orchestrator.planToolUse({
            objective: 'Inspect the k3s cluster state on the server.',
            executionProfile: 'remote-build',
            toolPolicy,
            model: 'kimi-k2',
        });

        expect(plan).toEqual([
            expect.objectContaining({
                tool: 'ssh-execute',
                params: expect.objectContaining({
                    command: 'kubectl get nodes -o wide && kubectl get pods -A',
                }),
            }),
        ]);
    });

    test('includes Ubuntu and arm64 fallback guidance for remote-build SSH work', async () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const llmClient = {
            createResponse: jest.fn(),
            complete: jest.fn().mockResolvedValue(JSON.stringify({ steps: [] })),
        };
        const orchestrator = new ConversationOrchestrator({
            llmClient,
            toolManager: {
                getTool: jest.fn((toolId) => (
                    ['ssh-execute', 'remote-command'].includes(toolId)
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const toolPolicy = orchestrator.buildToolPolicy({
            objective: 'Use remote-build to inspect the k3s cluster and continue setup.',
            executionProfile: 'remote-build',
            toolManager: orchestrator.toolManager,
        });

        await orchestrator.planToolUse({
            objective: 'Use remote-build to inspect the k3s cluster and continue setup.',
            executionProfile: 'remote-build',
            toolPolicy,
        });

        const plannerPrompt = llmClient.complete.mock.calls[0]?.[0] || '';
        const runtimeInstructions = orchestrator.buildRuntimeInstructions({
            executionProfile: 'remote-build',
            allowedToolIds: toolPolicy.allowedToolIds,
            toolPolicy,
        });

        expect(toolPolicy.candidateToolIds).toContain('ssh-execute');
        expect(runtimeInstructions).toContain('verify architecture with `uname -m`');
        expect(runtimeInstructions).toContain('`find`/`grep -R` for `rg`');
        expect(runtimeInstructions).toContain('`docker compose` for `docker-compose`');
        expect(plannerPrompt).toContain('find/grep instead of rg');
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
