jest.mock('./routes/admin/settings.controller', () => ({
    getEffectiveSshConfig: jest.fn(),
}));

const settingsController = require('./routes/admin/settings.controller');
const config = require('./config');
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

    test('expands a truncated follow-up from recent transcript before asking the model for a plain response', async () => {
        const llmClient = {
            createResponse: jest.fn().mockResolvedValue(buildResponse('Recovered answer', 'resp_recovered')),
            complete: jest.fn(),
        };
        const toolManager = {
            getTool: jest.fn(() => null),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({ id: 'session-followup-plain', metadata: {} }),
            getRecentMessages: jest.fn().mockResolvedValue([
                { role: 'user', content: 'give me a breakdown of the k3s cluster on the server' },
            ]),
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
            input: 'in five minutes from now',
            sessionId: 'session-followup-plain',
            stream: false,
        });

        expect(result.output).toBe('Recovered answer');
        expect(llmClient.createResponse).toHaveBeenCalledWith(expect.objectContaining({
            input: expect.stringContaining('give me a breakdown of the k3s cluster on the server'),
            instructions: expect.stringContaining('continue without asking the user to restate prior context'),
        }));
    });

    test('does not merge a concise standalone request into prior transcript context', async () => {
        const llmClient = {
            createResponse: jest.fn().mockResolvedValue(buildResponse('Pods answer', 'resp_pods')),
            complete: jest.fn(),
        };
        const toolManager = {
            getTool: jest.fn(() => null),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({ id: 'session-standalone-plain', metadata: {} }),
            getRecentMessages: jest.fn().mockResolvedValue([
                { role: 'user', content: 'give me a breakdown of the k3s cluster on the server' },
            ]),
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
            input: 'check pods',
            sessionId: 'session-standalone-plain',
            stream: false,
        });

        expect(llmClient.createResponse).toHaveBeenCalledWith(expect.objectContaining({
            input: 'check pods',
        }));
        expect(llmClient.createResponse).not.toHaveBeenCalledWith(expect.objectContaining({
            input: expect.stringContaining('give me a breakdown of the k3s cluster on the server. check pods'),
        }));
    });

    test('uses a deterministic remote health workflow for health report prompts without model synthesis', async () => {
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
            complete: jest.fn(),
        };
        const toolManager = {
            getTool: jest.fn((toolId) => (toolId === 'remote-command' ? { id: toolId } : null)),
            executeTool: jest.fn()
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: {
                        stdout: 'Hostname: ubuntu-32gb-fsn1-2\nArchitecture: aarch64\nOS: Ubuntu 24.04.4 LTS\n19:29:25 up 9 days',
                        stderr: '',
                        host: '10.0.0.5:22',
                    },
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: {
                        stdout: '/dev/sda1 301G 13G 276G 5% /\nMem: 32000 3300 14000 8 12000 27000',
                        stderr: '',
                        host: '10.0.0.5:22',
                    },
                }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({ id: 'session-health', metadata: {} }),
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
            input: 'can you remote into the server and get a health report',
            sessionId: 'session-health',
            stream: false,
        });

        expect(llmClient.createResponse).not.toHaveBeenCalled();
        expect(llmClient.complete).not.toHaveBeenCalled();
        expect(toolManager.executeTool).toHaveBeenCalledTimes(2);
        expect(result.trace.runtimeMode).toBe('deterministic-remote-health');
        expect(result.output).toContain('Server Health Report');
        expect(result.output).toContain('System Information');
        expect(result.output).toContain('Disk And Memory');
        expect(sessionStore.update).toHaveBeenCalledWith('session-health', expect.objectContaining({
            metadata: expect.objectContaining({
                controlState: expect.objectContaining({
                    workflow: expect.objectContaining({
                        type: 'remote-health-report',
                        status: 'completed',
                    }),
                }),
            }),
        }));
    });

    test('prefers agent-workload over deterministic remote health when the request is scheduled for later', async () => {
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
            complete: jest.fn(),
        };
        const toolManager = {
            getTool: jest.fn((toolId) => (
                toolId === 'remote-command' || toolId === 'agent-workload'
                    ? { id: toolId, description: toolId }
                    : null
            )),
            executeTool: jest.fn(async (toolId) => {
                if (toolId === 'agent-workload') {
                    return {
                        success: true,
                        toolId,
                        data: {
                            action: 'create_from_scenario',
                            message: 'Server health report created. Every day at 8:00 PM.',
                            workload: {
                                id: 'workload-1',
                                title: 'Server Health Report',
                                trigger: {
                                    type: 'cron',
                                    expression: '0 20 * * *',
                                    timezone: 'America/Halifax',
                                },
                            },
                        },
                    };
                }

                throw new Error(`Unexpected tool execution: ${toolId}`);
            }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({ id: 'session-scheduled-health', metadata: {} }),
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
            input: 'can you run a cron later every day at 8 pm to remote into the server and get a health report',
            sessionId: 'session-scheduled-health',
            toolContext: {
                timezone: 'America/Halifax',
            },
            stream: false,
        });

        expect(llmClient.createResponse).not.toHaveBeenCalled();
        expect(llmClient.complete).not.toHaveBeenCalled();
        expect(toolManager.executeTool).toHaveBeenCalledTimes(1);
        expect(toolManager.executeTool).toHaveBeenCalledWith(
            'agent-workload',
            expect.objectContaining({
                action: 'create',
                trigger: {
                    type: 'cron',
                    expression: '0 20 * * *',
                    timezone: 'America/Halifax',
                },
                metadata: expect.objectContaining({
                    createdFromScenario: true,
                    scenarioRequest: 'can you run a cron later every day at 8 pm to remote into the server and get a health report',
                }),
            }),
            expect.any(Object),
        );
        expect(result.trace.runtimeMode).toBe('direct-tool');
        expect(result.output).toContain('Every day at 8:00 PM');
        expect(result.output).not.toContain('Server Health Report\n\nSystem Information');
    });

    test('continues a truncated scheduled follow-up from recent transcript instead of asking for clarification', async () => {
        const llmClient = {
            createResponse: jest.fn(),
            complete: jest.fn(),
        };
        const toolManager = {
            getTool: jest.fn((toolId) => (
                toolId === 'agent-workload'
                    ? { id: toolId, description: toolId }
                    : null
            )),
            executeTool: jest.fn(async (toolId) => {
                if (toolId === 'agent-workload') {
                    return {
                        success: true,
                        toolId,
                        data: {
                            action: 'create',
                            message: 'K3s Cluster Breakdown created. Runs once at 2026-04-03T14:52:00.000Z.',
                            workload: {
                                id: 'workload-followup-1',
                                title: 'K3s Cluster Breakdown',
                                trigger: {
                                    type: 'once',
                                    runAt: '2026-04-03T14:52:00.000Z',
                                },
                            },
                        },
                    };
                }

                throw new Error(`Unexpected tool execution: ${toolId}`);
            }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({ id: 'session-followup-tool', metadata: {} }),
            getRecentMessages: jest.fn().mockResolvedValue([
                { role: 'user', content: 'give me a breakdown of the k3s cluster on the server' },
            ]),
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
            input: 'in five minutes from now',
            sessionId: 'session-followup-tool',
            stream: false,
            toolContext: {
                timezone: 'UTC',
                now: '2026-04-03T14:47:00.000Z',
            },
        });

        expect(toolManager.executeTool).toHaveBeenCalledWith(
            'agent-workload',
            expect.objectContaining({
                action: 'create',
                prompt: expect.stringContaining('give me a breakdown of the k3s cluster on the server'),
                trigger: {
                    type: 'once',
                    runAt: '2026-04-03T14:52:00.000Z',
                },
            }),
            expect.any(Object),
        );
        expect(llmClient.createResponse).not.toHaveBeenCalled();
        expect(result.output).toBe('K3s Cluster Breakdown created. Runs once at 2026-04-03T14:52:00.000Z.');
    });

    test('terminates immediately after a successful workload creation instead of replanning', async () => {
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
            complete: jest.fn(),
        };
        const toolManager = {
            getTool: jest.fn((toolId) => (
                toolId === 'remote-command' || toolId === 'agent-workload'
                    ? { id: toolId, description: toolId }
                    : null
            )),
            executeTool: jest.fn(async (toolId) => {
                if (toolId === 'agent-workload') {
                    return {
                        success: true,
                        toolId,
                        data: {
                            action: 'create',
                            message: 'Check Remote Time created. Runs once at 2026-04-03T20:05:00.000Z.',
                            workload: {
                                id: 'workload-1',
                                title: 'Check Remote Time',
                                trigger: {
                                    type: 'once',
                                    runAt: '2026-04-03T20:05:00.000Z',
                                },
                            },
                        },
                    };
                }

                throw new Error(`Unexpected tool execution: ${toolId}`);
            }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({ id: 'session-workload-terminal', metadata: {} }),
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
            input: 'can you run a cron later to check the time on the remote host in 5 minutes',
            sessionId: 'session-workload-terminal',
            metadata: {
                remoteBuildAutonomyApproved: true,
            },
            toolContext: {
                timezone: 'America/Halifax',
                now: '2026-04-03T20:00:00.000Z',
            },
            stream: false,
        });

        expect(toolManager.executeTool).toHaveBeenCalledTimes(1);
        expect(llmClient.createResponse).not.toHaveBeenCalled();
        expect(llmClient.complete).not.toHaveBeenCalled();
        expect(result.output).toBe('Check Remote Time created. Runs once at 2026-04-03T20:05:00.000Z.');
        expect(result.trace.runtimeMode).toBe('direct-tool');
    });

    test('streams a synthetic final response after successful workload creation', async () => {
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
            complete: jest.fn(),
        };
        const toolManager = {
            getTool: jest.fn((toolId) => (
                toolId === 'remote-command' || toolId === 'agent-workload'
                    ? { id: toolId, description: toolId }
                    : null
            )),
            executeTool: jest.fn(async (toolId) => {
                if (toolId === 'agent-workload') {
                    return {
                        success: true,
                        toolId,
                        data: {
                            action: 'create',
                            message: 'Check Remote Time created. Runs once at 2026-04-03T20:05:00.000Z.',
                            workload: {
                                id: 'workload-1',
                                title: 'Check Remote Time',
                                trigger: {
                                    type: 'once',
                                    runAt: '2026-04-03T20:05:00.000Z',
                                },
                            },
                        },
                    };
                }

                throw new Error(`Unexpected tool execution: ${toolId}`);
            }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({ id: 'session-workload-terminal-stream', metadata: {} }),
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
            input: 'can you run a cron later to check the time on the remote host in 5 minutes',
            sessionId: 'session-workload-terminal-stream',
            metadata: {
                remoteBuildAutonomyApproved: true,
            },
            toolContext: {
                timezone: 'America/Halifax',
                now: '2026-04-03T20:00:00.000Z',
            },
            stream: true,
        });

        expect(typeof result.response?.[Symbol.asyncIterator]).toBe('function');

        const events = [];
        for await (const event of result.response) {
            events.push(event);
        }

        expect(events.some((event) => event.type === 'response.output_text.delta')).toBe(true);
        expect(events.at(-1)).toMatchObject({
            type: 'response.completed',
            response: expect.objectContaining({
                metadata: expect.objectContaining({
                    terminalWorkloadCreation: true,
                }),
            }),
        });
    });

    test('retries the stored deterministic remote health workflow without planner or synthesis', async () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const storedSteps = [
            {
                tool: 'remote-command',
                reason: 'Collect system information for the remote server.',
                params: {
                    host: '10.0.0.5',
                    username: 'ubuntu',
                    port: 22,
                    command: "hostname && uname -m && (test -f /etc/os-release && sed -n '1,6p' /etc/os-release || true) && uptime",
                },
            },
            {
                tool: 'remote-command',
                reason: 'Collect disk and memory information for the remote server.',
                params: {
                    host: '10.0.0.5',
                    username: 'ubuntu',
                    port: 22,
                    command: 'df -h / && free -m',
                },
            },
        ];

        const llmClient = {
            createResponse: jest.fn(),
            complete: jest.fn(),
        };
        const toolManager = {
            getTool: jest.fn((toolId) => (toolId === 'remote-command' ? { id: toolId } : null)),
            executeTool: jest.fn()
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: { stdout: 'retry-system-info', stderr: '', host: '10.0.0.5:22' },
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: { stdout: 'retry-disk-memory', stderr: '', host: '10.0.0.5:22' },
                }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({
                id: 'session-retry-health',
                metadata: {
                    lastToolIntent: 'remote-command',
                    lastSshTarget: {
                        host: '10.0.0.5',
                        username: 'ubuntu',
                        port: 22,
                    },
                    remoteWorkingState: {
                        lastUpdated: new Date().toISOString(),
                        lastCommand: 'df -h / && free -m',
                    },
                    controlState: {
                        workflow: {
                            type: 'remote-health-report',
                            steps: storedSteps,
                        },
                    },
                },
            }),
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
            input: 'try again to remote command',
            sessionId: 'session-retry-health',
            stream: false,
        });

        expect(llmClient.createResponse).not.toHaveBeenCalled();
        expect(llmClient.complete).not.toHaveBeenCalled();
        expect(toolManager.executeTool).toHaveBeenNthCalledWith(
            1,
            'remote-command',
            storedSteps[0].params,
            expect.objectContaining({ sessionId: 'session-retry-health' }),
        );
        expect(toolManager.executeTool).toHaveBeenNthCalledWith(
            2,
            'remote-command',
            storedSteps[1].params,
            expect.objectContaining({ sessionId: 'session-retry-health' }),
        );
        expect(result.trace.runtimeMode).toBe('deterministic-remote-health');
        expect(result.output).toContain('retry-system-info');
        expect(result.output).toContain('retry-disk-memory');
    });

    test('deterministic remote health workflow ignores autonomy mode and still bypasses model synthesis', async () => {
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
            complete: jest.fn(),
        };
        const toolManager = {
            getTool: jest.fn((toolId) => (toolId === 'remote-command' ? { id: toolId } : null)),
            executeTool: jest.fn()
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: { stdout: 'system-info', stderr: '', host: '10.0.0.5:22' },
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: { stdout: 'disk-memory', stderr: '', host: '10.0.0.5:22' },
                }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({ id: 'session-auto-health', metadata: {} }),
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
            input: 'can you remote into the server and do a health report',
            sessionId: 'session-auto-health',
            executionProfile: 'remote-build',
            metadata: {
                remoteBuildAutonomyApproved: true,
            },
            stream: false,
        });

        expect(llmClient.createResponse).not.toHaveBeenCalled();
        expect(llmClient.complete).not.toHaveBeenCalled();
        expect(result.trace.runtimeMode).toBe('deterministic-remote-health');
        expect(result.output).toContain('Summary: Remote health inspection completed successfully.');
    });

    test('treats remote permission-grant replies as approval for the previous remote objective', async () => {
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
            complete: jest.fn(),
        };
        const toolManager = {
            getTool: jest.fn((toolId) => (toolId === 'remote-command' ? { id: toolId } : null)),
            executeTool: jest.fn()
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: { stdout: 'approved-system-info', stderr: '', host: '10.0.0.5:22' },
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: { stdout: 'approved-disk-memory', stderr: '', host: '10.0.0.5:22' },
                }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({
                id: 'session-approval-health',
                metadata: {
                    remoteBuildAutonomyApproved: true,
                    lastToolIntent: 'remote-command',
                    lastSshTarget: {
                        host: '10.0.0.5',
                        username: 'ubuntu',
                        port: 22,
                    },
                    controlState: {
                        lastRemoteObjective: 'can you remote into the server and get a health report',
                    },
                },
            }),
            getRecentMessages: jest.fn().mockResolvedValue([
                { role: 'user', content: 'can you remote into the server and get a health report' },
            ]),
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
            input: 'you can use remote command. i give you permission',
            sessionId: 'session-approval-health',
            executionProfile: 'remote-build',
            metadata: {
                remoteBuildAutonomyApproved: true,
            },
            stream: false,
        });

        expect(llmClient.createResponse).not.toHaveBeenCalled();
        expect(llmClient.complete).not.toHaveBeenCalled();
        expect(result.trace.runtimeMode).toBe('deterministic-remote-health');
        expect(result.output).toContain('Server Health Report');
        expect(result.output).not.toContain('you can use remote command. i give you permission');
        expect(sessionStore.appendMessages).toHaveBeenCalledWith('session-approval-health', [
            { role: 'user', content: 'you can use remote command. i give you permission' },
            expect.objectContaining({ role: 'assistant' }),
        ]);
    });

    test('passes reasoning effort into final response synthesis', async () => {
        const llmClient = {
            createResponse: jest.fn().mockResolvedValue(buildResponse('Synthesized answer', 'resp_reasoning')),
            complete: jest.fn(),
        };
        const orchestrator = new ConversationOrchestrator({
            llmClient,
            toolManager: null,
            sessionStore: null,
            memoryService: null,
        });

        await orchestrator.buildFinalResponse({
            input: 'Summarize the verified results.',
            objective: 'Summarize the verified results.',
            reasoningEffort: 'high',
            toolEvents: [{
                toolCall: {
                    function: {
                        name: 'web-fetch',
                    },
                },
                result: {
                    success: true,
                    data: {
                        text: 'Verified source material',
                    },
                },
            }],
        });

        expect(llmClient.createResponse).toHaveBeenCalledWith(expect.objectContaining({
            reasoningEffort: 'high',
        }));
    });

    test('fallback synthesis summarizes web-search results without dumping raw json', async () => {
        const llmClient = {
            createResponse: jest.fn().mockResolvedValue({
                id: 'resp_empty_search',
                model: 'gpt-test',
                choices: [{ message: {} }],
                metadata: {},
            }),
            complete: jest.fn(),
        };
        const orchestrator = new ConversationOrchestrator({
            llmClient,
            toolManager: null,
            sessionStore: null,
            memoryService: null,
        });

        const response = await orchestrator.buildFinalResponse({
            input: 'Find a great resort destination for April.',
            objective: 'Find a great resort destination for April.',
            toolEvents: [{
                toolCall: {
                    function: {
                        name: 'web-search',
                    },
                },
                reason: 'Find great places to resort in April.',
                result: {
                    success: true,
                    toolId: 'web-search',
                    data: {
                        query: 'best resorts in April',
                        engine: 'perplexity',
                        results: [
                            {
                                title: 'Maui Beach Resorts Guide',
                                url: 'https://example.com/maui',
                                snippet: 'Maui combines warm April weather, beach resorts, and direct flights from many North American hubs.',
                                source: 'example.com',
                            },
                            {
                                title: 'Cancun All-Inclusive Resorts',
                                url: 'https://travel.example/cancun',
                                snippet: 'Cancun is strong in April for reliable heat, resort density, and family-friendly packages.',
                                source: 'travel.example',
                            },
                        ],
                    },
                },
            }],
        });

        const text = response.output[0].content[0].text;
        expect(text).toContain('Based on the verified tool results');
        expect(text).toContain('Maui Beach Resorts Guide');
        expect(text).toContain('Cancun All-Inclusive Resorts');
        expect(text).not.toContain('{"query"');
        expect(text).not.toContain('[truncated');
    });

    test('fallback synthesis summarizes fetched page content instead of returning raw html', async () => {
        const llmClient = {
            createResponse: jest.fn().mockResolvedValue({
                id: 'resp_empty_fetch',
                model: 'gpt-test',
                choices: [{ message: {} }],
                metadata: {},
            }),
            complete: jest.fn(),
        };
        const orchestrator = new ConversationOrchestrator({
            llmClient,
            toolManager: null,
            sessionStore: null,
            memoryService: null,
        });

        const response = await orchestrator.buildFinalResponse({
            input: 'Review the Bicycle Thief homepage.',
            objective: 'Review the Bicycle Thief homepage.',
            toolEvents: [{
                toolCall: {
                    function: {
                        name: 'web-fetch',
                    },
                },
                reason: 'Fetch the Bicycle Thief homepage for review.',
                result: {
                    success: true,
                    toolId: 'web-fetch',
                    data: {
                        status: 200,
                        statusText: 'OK',
                        url: 'https://bicyclethief.ca',
                        headers: {
                            'content-type': 'text/html; charset=utf-8',
                        },
                        body: '<!DOCTYPE html><html><head><title>Bicycle Thief</title></head><body><main>Harbourfront restaurant in Halifax with seafood, pasta, and cocktails.</main></body></html>',
                    },
                },
            }],
        });

        const text = response.output[0].content[0].text;
        expect(text).toContain('Title: Bicycle Thief.');
        expect(text).toContain('Harbourfront restaurant in Halifax with seafood, pasta, and cocktails.');
        expect(text).toContain('Source: https://bicyclethief.ca.');
        expect(text).not.toContain('<html>');
    });

    test('fallback synthesis keeps verified research extracts when both search and fetched pages exist', async () => {
        const llmClient = {
            createResponse: jest.fn().mockResolvedValue({
                id: 'resp_empty_research',
                model: 'gpt-test',
                choices: [{ message: {} }],
                metadata: {},
            }),
            complete: jest.fn(),
        };
        const orchestrator = new ConversationOrchestrator({
            llmClient,
            toolManager: null,
            sessionStore: null,
            memoryService: null,
        });

        const response = await orchestrator.buildFinalResponse({
            input: 'Research the best project documentation hosts.',
            objective: 'Research the best project documentation hosts.',
            toolEvents: [
                {
                    toolCall: {
                        function: {
                            name: 'web-search',
                            arguments: JSON.stringify({ query: 'best project documentation hosts' }),
                        },
                    },
                    reason: 'Deterministic research preflight.',
                    result: {
                        success: true,
                        toolId: 'web-search',
                        data: {
                            query: 'best project documentation hosts',
                            results: [
                                {
                                    title: 'Docs hosting comparison',
                                    url: 'https://example.com/docs-hosting',
                                    snippet: 'Compares Vercel, Cloudflare Pages, Netlify, and GitHub Pages for docs sites.',
                                    source: 'example.com',
                                },
                            ],
                        },
                    },
                },
                {
                    toolCall: {
                        function: {
                            name: 'web-fetch',
                            arguments: JSON.stringify({ url: 'https://example.com/docs-hosting' }),
                        },
                    },
                    reason: 'Deterministic research follow-up on a top search result.',
                    result: {
                        success: true,
                        toolId: 'web-fetch',
                        data: {
                            url: 'https://example.com/docs-hosting',
                            body: '<html><head><title>Docs hosting comparison</title></head><body><main>Vercel offers fast previews, Cloudflare Pages is cost-efficient, Netlify is strong for workflow integrations, and GitHub Pages remains the simplest static option.</main></body></html>',
                        },
                    },
                },
            ],
        });

        const text = response.output[0].content[0].text;
        expect(text).toContain('Research dossier:');
        expect(text).toContain('Docs hosting comparison');
        expect(text).toContain('Search snippet: Compares Vercel, Cloudflare Pages, Netlify, and GitHub Pages for docs sites.');
        expect(text).toContain('Verified extract: Vercel offers fast previews, Cloudflare Pages is cost-efficient, Netlify is strong for workflow integrations, and GitHub Pages remains the simplest static option.');
    });

    test('tool synthesis unwraps assistant content arrays with stringified output_text payloads', async () => {
        const llmClient = {
            createResponse: jest.fn().mockResolvedValue({
                id: 'resp_wrapped_synthesis',
                model: 'gpt-test',
                choices: [{
                    message: {
                        role: 'assistant',
                        content: [
                            {
                                type: 'think',
                                think: 'Internal reasoning that should stay hidden.',
                            },
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    output_text: 'Remote build is reachable, Docker is installed, and BuildKit is not fully confirmed yet.',
                                    finish_reason: 'stop',
                                }),
                            },
                        ],
                    },
                }],
                metadata: {},
            }),
            complete: jest.fn(),
        };
        const orchestrator = new ConversationOrchestrator({
            llmClient,
            toolManager: null,
            sessionStore: null,
            memoryService: null,
        });

        const response = await orchestrator.buildFinalResponse({
            input: 'Can you check if remote build is on?',
            objective: 'Can you check if remote build is on?',
            toolEvents: [{
                toolCall: {
                    function: {
                        name: 'remote-command',
                    },
                },
                reason: 'Fallback for explicit server or remote-build intent.',
                result: {
                    success: true,
                    data: {
                        stdout: 'ubuntu-32gb-fsn1-2',
                    },
                },
            }],
        });

        const text = response.output[0].content[0].text;
        expect(text).toBe('Remote build is reachable, Docker is installed, and BuildKit is not fully confirmed yet.');
        expect(text).not.toContain('Based on the verified tool results');
    });

    test('tool synthesis retries with a compact prompt before falling back to backend placeholder text', async () => {
        const llmClient = {
            createResponse: jest.fn()
                .mockResolvedValueOnce({
                    id: 'resp_empty_tool_synthesis',
                    model: 'gpt-test',
                    choices: [{ message: {} }],
                    metadata: {},
                })
                .mockResolvedValueOnce(buildResponse('The remote host is reachable, but Docker is not installed.', 'resp_compact_retry')),
            complete: jest.fn(),
        };
        const orchestrator = new ConversationOrchestrator({
            llmClient,
            toolManager: null,
            sessionStore: null,
            memoryService: null,
        });

        const response = await orchestrator.buildFinalResponse({
            input: 'Check the remote host.',
            objective: 'Check the remote host.',
            contextMessages: ['Remembered context that should not be needed for the retry.'],
            recentMessages: [{ role: 'assistant', content: 'Earlier transcript' }],
            toolEvents: [{
                toolCall: {
                    function: {
                        name: 'remote-command',
                    },
                },
                reason: 'Check the host for Docker availability.',
                result: {
                    success: true,
                    data: {
                        stdout: 'docker: command not found',
                        host: '10.0.0.5:22',
                    },
                },
            }],
        });

        const text = response.output[0].content[0].text;
        expect(text).toBe('The remote host is reachable, but Docker is not installed.');
        expect(text).not.toContain('Based on the verified tool results');
        expect(llmClient.createResponse).toHaveBeenCalledTimes(2);
        expect(llmClient.createResponse.mock.calls[1][0]).toEqual(expect.objectContaining({
            instructions: 'Return plain user-facing text only.',
            contextMessages: [],
            recentMessages: [],
        }));
    });

    test('tool synthesis prompt explicitly forbids wrapped JSON answers', async () => {
        const llmClient = {
            createResponse: jest.fn().mockResolvedValue(buildResponse('Plain tool synthesis answer', 'resp_tool_synthesis_prompt')),
            complete: jest.fn(),
        };
        const orchestrator = new ConversationOrchestrator({
            llmClient,
            toolManager: null,
            sessionStore: null,
            memoryService: null,
        });

        await orchestrator.buildFinalResponse({
            input: 'Can you check if remote build is on?',
            objective: 'Can you check if remote build is on?',
            toolEvents: [{
                toolCall: {
                    function: {
                        name: 'remote-command',
                    },
                },
                result: {
                    success: true,
                    data: {
                        stdout: 'ubuntu-32gb-fsn1-2',
                    },
                },
            }],
        });

        expect(llmClient.createResponse).toHaveBeenCalledWith(expect.objectContaining({
            input: expect.stringContaining('Return plain user-facing text only.'),
        }));
        expect(llmClient.createResponse).toHaveBeenCalledWith(expect.objectContaining({
            input: expect.stringContaining('`output_text`'),
        }));
    });

    test('tool synthesis prompt uses compact verified findings instead of raw tool result json blobs', async () => {
        const llmClient = {
            createResponse: jest.fn().mockResolvedValue(buildResponse('Compact synthesis answer', 'resp_compact_prompt')),
            complete: jest.fn(),
        };
        const orchestrator = new ConversationOrchestrator({
            llmClient,
            toolManager: null,
            sessionStore: null,
            memoryService: null,
        });

        const largeStdout = `${'A'.repeat(16000)} docker missing`;

        await orchestrator.buildFinalResponse({
            input: 'Check the remote host.',
            objective: 'Check the remote host.',
            toolEvents: [{
                toolCall: {
                    function: {
                        name: 'remote-command',
                    },
                },
                reason: 'Inspect Docker availability.',
                result: {
                    success: true,
                    data: {
                        stdout: largeStdout,
                        host: '10.0.0.5:22',
                    },
                },
            }],
        });

        const prompt = llmClient.createResponse.mock.calls[0][0].input;
        expect(prompt).toContain('Verified tool results:');
        expect(prompt).toContain('- remote-command: succeeded');
        expect(prompt).not.toContain(`"stdout": "${'A'.repeat(200)}`);
        expect(prompt.length).toBeLessThan(6000);
    });

    test('recovers missing file-write content from recent assistant html when the planner omits it', async () => {
        const llmClient = {
            createResponse: jest.fn().mockResolvedValue(buildResponse('Saved the HTML file.', 'resp_file_write')),
            complete: jest.fn().mockResolvedValue(JSON.stringify({
                steps: [
                    {
                        tool: 'file-write',
                        reason: 'Write the previously prepared Cuba/beaches HTML into a file in /app, since the user asked to go ahead with the HTML file.',
                        params: {
                            path: '/app/cuba-beaches.html',
                        },
                    },
                ],
            })),
        };
        const toolManager = {
            getTool: jest.fn((toolId) => (
                toolId === 'file-write'
                    ? { id: toolId, description: 'Write a file' }
                    : null
            )),
            executeTool: jest.fn().mockResolvedValue({
                success: true,
                toolId: 'file-write',
                data: {
                    path: '/app/cuba-beaches.html',
                    bytesWritten: 84,
                },
            }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({
                id: 'session-file-write',
                metadata: {},
            }),
            getRecentMessages: jest.fn().mockResolvedValue([
                {
                    role: 'assistant',
                    content: [
                        'Here is the full HTML:',
                        '```html',
                        '<!DOCTYPE html>',
                        '<html>',
                        '<body>',
                        '<h1>Cuba Beaches</h1>',
                        '<p>Warm water and bright sand.</p>',
                        '</body>',
                        '</html>',
                        '```',
                    ].join('\n'),
                },
            ]),
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
            input: 'Go ahead and save that Cuba beaches HTML file to /app/cuba-beaches.html.',
            sessionId: 'session-file-write',
            stream: false,
        });

        expect(toolManager.executeTool).toHaveBeenCalledWith(
            'file-write',
            expect.objectContaining({
                path: '/app/cuba-beaches.html',
                content: expect.stringContaining('<h1>Cuba Beaches</h1>'),
            }),
            expect.objectContaining({
                executionProfile: 'default',
                sessionId: 'session-file-write',
            }),
        );
        expect(result.output).toBe('Saved the HTML file.');
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
                        tool: 'remote-command',
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
                ['remote-command', 'docker-exec', 'web-search', 'web-fetch', 'file-read', 'file-search', 'tool-doc-read', 'code-sandbox']
                    .includes(toolId)
                    ? { id: toolId }
                    : null
            )),
            executeTool: jest.fn().mockResolvedValue({
                success: true,
                toolId: 'remote-command',
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
            'remote-command',
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

    test('pins remote-build remote-command steps to the trusted SSH target when the planner invents a bogus host', async () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '162.55.163.199',
            port: 22,
            username: 'root',
            password: 'secret',
            privateKeyPath: '',
        });

        const llmClient = {
            createResponse: jest.fn().mockResolvedValue(buildResponse('The remote apply step ran on the configured server.', 'resp_remote_pinned_host')),
            complete: jest.fn().mockResolvedValue(JSON.stringify({
                steps: [
                    {
                        tool: 'remote-command',
                        reason: 'Apply the fetched HTML to the live ConfigMap.',
                        params: {
                            host: 'web-fetch.body',
                            command: 'kubectl apply -f /tmp/website-html.yaml',
                        },
                    },
                ],
            })),
        };
        const toolManager = {
            getTool: jest.fn((toolId) => (
                ['remote-command', 'docker-exec', 'web-search', 'web-fetch', 'file-read', 'file-search', 'tool-doc-read', 'code-sandbox']
                    .includes(toolId)
                    ? { id: toolId }
                    : null
            )),
            executeTool: jest.fn().mockResolvedValue({
                success: true,
                toolId: 'remote-command',
                data: {
                    stdout: 'configmap/website-html configured',
                    stderr: '',
                    host: '162.55.163.199:22',
                },
            }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({
                id: 'session-remote-pinned-host',
                metadata: {
                    lastToolIntent: 'remote-command',
                    lastSshTarget: {
                        host: '162.55.163.199',
                        username: 'root',
                        port: 22,
                    },
                },
            }),
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
            input: 'Replace the deployed HTML on the remote server and restart the website workload.',
            sessionId: 'session-remote-pinned-host',
            executionProfile: 'remote-build',
            stream: false,
        });

        expect(toolManager.executeTool).toHaveBeenCalledWith(
            'remote-command',
            expect.objectContaining({
                host: '162.55.163.199',
                username: 'root',
                port: 22,
                command: 'kubectl apply -f /tmp/website-html.yaml',
            }),
            expect.any(Object),
        );
    });

    test('repairs invalid final responses that deny remote tools after successful remote execution', async () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const llmClient = {
            createResponse: jest.fn()
                .mockResolvedValueOnce(buildResponse(
                    'I successfully connected to your server, but I don\'t have any remote execution tools available in this turn to run more commands.',
                    'resp_invalid_remote',
                ))
                .mockResolvedValueOnce(buildResponse(
                    'I connected to the server and completed the verified remote check. If you want me to continue, I need the next concrete server task rather than assuming tool access is missing.',
                    'resp_repaired_remote',
                )),
            complete: jest.fn().mockResolvedValue(JSON.stringify({ steps: [] })),
        };
        const toolManager = {
            getTool: jest.fn((toolId) => (
                ['remote-command', 'web-search', 'web-fetch', 'file-read', 'file-search', 'tool-doc-read']
                    .includes(toolId)
                    ? { id: toolId, description: toolId }
                    : null
            )),
            executeTool: jest.fn().mockResolvedValue({
                success: true,
                toolId: 'remote-command',
                data: {
                    stdout: 'host-a\naarch64\nup 2 days',
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
            input: 'Use remote-build to inspect the server.',
            sessionId: 'session-remote',
            executionProfile: 'remote-build',
            stream: false,
        });

        expect(toolManager.executeTool).toHaveBeenCalledTimes(1);
        expect(toolManager.executeTool).toHaveBeenCalledWith(
            'remote-command',
            expect.objectContaining({
                command: expect.stringContaining('uname -m'),
            }),
            expect.objectContaining({
                executionProfile: 'remote-build',
                sessionId: 'session-remote',
            }),
        );
        expect(toolManager.executeTool.mock.calls[0][1].command).toContain('/etc/os-release');
        expect(llmClient.createResponse).toHaveBeenCalledTimes(2);
        expect(llmClient.createResponse.mock.calls[1][0]).toEqual(expect.objectContaining({
            enableAutomaticToolCalls: false,
        }));
        expect(llmClient.createResponse.mock.calls[1][0].input).toContain('Previous invalid draft:');
        expect(result.output).toBe('I connected to the server and completed the verified remote check. If you want me to continue, I need the next concrete server task rather than assuming tool access is missing.');
        expect(result.trace.runtimeMode).toBe('repaired-final');
        expect(result.trace.executionTrace.map((entry) => entry.name)).toContain('Response repair');
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
                            tool: 'remote-command',
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
                            tool: 'remote-command',
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
                ['remote-command', 'docker-exec', 'web-search', 'web-fetch', 'file-read', 'file-search', 'tool-doc-read', 'code-sandbox']
                    .includes(toolId)
                    ? { id: toolId, description: toolId }
                    : null
            )),
            executeTool: jest.fn()
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: {
                        stdout: 'node-1 Ready',
                        stderr: '',
                        host: '10.0.0.5:22',
                    },
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
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
            'remote-command',
            expect.objectContaining({ command: 'kubectl get nodes -o wide' }),
            expect.objectContaining({ executionProfile: 'remote-build' }),
        );
        expect(toolManager.executeTool).toHaveBeenNthCalledWith(
            2,
            'remote-command',
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
                            tool: 'remote-command',
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
                            tool: 'remote-command',
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
                ['remote-command', 'docker-exec', 'web-search', 'web-fetch', 'file-read', 'file-search', 'tool-doc-read', 'code-sandbox']
                    .includes(toolId)
                    ? { id: toolId, description: toolId }
                    : null
            )),
            executeTool: jest.fn()
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: { stdout: 'host-a\naarch64', stderr: '', host: '10.0.0.5:22' },
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
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

    test('defaults remote-build autonomy on from config even without frontend approval metadata', async () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const llmClient = {
            createResponse: jest.fn().mockResolvedValue(buildResponse('Remote inspection completed.', 'resp_default_remote_auto')),
            complete: jest.fn()
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [
                        {
                            tool: 'remote-command',
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
                            tool: 'remote-command',
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
                ['remote-command', 'docker-exec', 'web-search', 'web-fetch', 'file-read', 'file-search', 'tool-doc-read', 'code-sandbox']
                    .includes(toolId)
                    ? { id: toolId, description: toolId }
                    : null
            )),
            executeTool: jest.fn()
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: { stdout: 'host-a\naarch64', stderr: '', host: '10.0.0.5:22' },
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: { stdout: 'kube-system traefik Running', stderr: '', host: '10.0.0.5:22' },
                }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({ id: 'session-config-remote', metadata: {} }),
            getOrCreate: jest.fn().mockResolvedValue({ id: 'session-config-remote', metadata: {} }),
            getRecentMessages: jest.fn().mockResolvedValue([]),
            recordResponse: jest.fn().mockResolvedValue(undefined),
            appendMessages: jest.fn().mockResolvedValue(undefined),
            update: jest.fn().mockResolvedValue(undefined),
        };
        const memoryService = {
            process: jest.fn().mockResolvedValue([]),
            rememberResponse: jest.fn(),
        };

        const originalDefault = config.config.runtime.remoteBuildAutonomyDefault;
        config.config.runtime.remoteBuildAutonomyDefault = true;

        try {
            const orchestrator = new ConversationOrchestrator({
                llmClient,
                toolManager,
                sessionStore,
                memoryService,
            });

            const result = await orchestrator.executeConversation({
                input: 'Inspect the cluster state on the server.',
                sessionId: 'session-config-remote',
                executionProfile: 'remote-build',
                stream: false,
            });

            expect(toolManager.executeTool).toHaveBeenCalledTimes(2);
            expect(result.response.metadata.executionTrace.find((entry) => entry.name === 'Remote-build autonomy approved')).toMatchObject({
                details: expect.objectContaining({
                    approved: true,
                    source: 'config',
                }),
            });
        } finally {
            config.config.runtime.remoteBuildAutonomyDefault = originalDefault;
        }
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
                    steps: [{ tool: 'remote-command', reason: 'Round 1', params: { command: 'echo round-1' } }],
                }))
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [{ tool: 'remote-command', reason: 'Round 2', params: { command: 'echo round-2' } }],
                }))
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [{ tool: 'remote-command', reason: 'Round 3', params: { command: 'echo round-3' } }],
                }))
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [{ tool: 'remote-command', reason: 'Round 4', params: { command: 'echo round-4' } }],
                }))
                .mockResolvedValueOnce(JSON.stringify({ steps: [] })),
        };

        const toolManager = {
            getTool: jest.fn((toolId) => (
                ['remote-command', 'docker-exec', 'web-search', 'web-fetch', 'file-read', 'file-search', 'tool-doc-read', 'code-sandbox']
                    .includes(toolId)
                    ? { id: toolId, description: toolId }
                    : null
            )),
            executeTool: jest.fn()
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: { stdout: 'round-1', stderr: '', host: '10.0.0.5:22' },
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: { stdout: 'round-2', stderr: '', host: '10.0.0.5:22' },
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: { stdout: 'round-3', stderr: '', host: '10.0.0.5:22' },
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
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

    test('stops autonomous remote-build work within a round when the time budget is exhausted', async () => {
        const originalMaxMs = config.runtime.remoteBuildMaxAutonomousMs;
        const nowSpy = jest.spyOn(Date, 'now');
        let currentNow = 1760000000000;
        nowSpy.mockImplementation(() => currentNow);
        config.runtime.remoteBuildMaxAutonomousMs = 1000;

        try {
            settingsController.getEffectiveSshConfig.mockReturnValue({
                enabled: true,
                host: '10.0.0.5',
                port: 22,
                username: 'ubuntu',
                password: 'secret',
                privateKeyPath: '',
            });

            const llmClient = {
                createResponse: jest.fn().mockImplementation(async () => {
                    currentNow += 50;
                    return buildResponse('Stopped after the budget ran out during the round.', 'resp_budget_stop');
                }),
                complete: jest.fn().mockImplementation(async () => {
                    currentNow += 100;
                    return JSON.stringify({
                        steps: [
                            {
                                tool: 'remote-command',
                                reason: 'Inspect the ingress first',
                                params: {
                                    command: 'kubectl get ingress -A',
                                },
                            },
                            {
                                tool: 'remote-command',
                                reason: 'Reload nginx after the ingress check',
                                params: {
                                    command: 'sudo nginx -s reload',
                                },
                            },
                        ],
                    });
                }),
            };

            const toolManager = {
                getTool: jest.fn((toolId) => (
                    ['remote-command', 'docker-exec', 'web-search', 'web-fetch', 'file-read', 'file-search', 'tool-doc-read', 'code-sandbox']
                        .includes(toolId)
                        ? { id: toolId, description: toolId }
                        : null
                )),
                executeTool: jest.fn().mockImplementation(async () => {
                    currentNow += 1200;
                    return {
                        success: true,
                        toolId: 'remote-command',
                        duration: 1200,
                        data: {
                            stdout: 'ok',
                            stderr: '',
                            host: '10.0.0.5:22',
                        },
                    };
                }),
            };
            const sessionStore = {
                get: jest.fn().mockResolvedValue({ id: 'session-budget-stop', metadata: {} }),
                getOrCreate: jest.fn().mockResolvedValue({ id: 'session-budget-stop', metadata: {} }),
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
                input: 'Use remote-build to keep going through the routine server checks.',
                sessionId: 'session-budget-stop',
                executionProfile: 'remote-build',
                stream: false,
                metadata: {
                    remoteBuildAutonomyApproved: true,
                },
            });

            expect(toolManager.executeTool).toHaveBeenCalledTimes(1);
            expect(result.response.metadata.executionTrace.find((entry) => entry.name === 'Execution round 1')).toMatchObject({
                details: expect.objectContaining({
                    plannedToolCalls: 2,
                    toolCalls: 1,
                    skippedPlannedSteps: 1,
                    budgetExceeded: true,
                }),
            });
            expect(result.response.metadata.executionTrace.find((entry) => entry.name === 'Autonomous execution time budget reached')).toMatchObject({
                details: expect.objectContaining({
                    phase: 'during-round',
                    maxDurationMs: 1000,
                }),
            });
        } finally {
            config.runtime.remoteBuildMaxAutonomousMs = originalMaxMs;
            nowSpy.mockRestore();
        }
    });

    test('extends the autonomous round budget when remote-build work is still productive', async () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const originalRounds = config.config.runtime.remoteBuildMaxAutonomousRounds;
        const originalToolCalls = config.config.runtime.remoteBuildMaxAutonomousToolCalls;
        const originalMaxMs = config.config.runtime.remoteBuildMaxAutonomousMs;
        const originalExtensionUses = config.config.runtime.remoteBuildBudgetExtensionMaxUses;
        const originalExtensionRounds = config.config.runtime.remoteBuildBudgetExtensionRounds;
        const originalExtensionToolCalls = config.config.runtime.remoteBuildBudgetExtensionToolCalls;
        const originalExtensionMs = config.config.runtime.remoteBuildBudgetExtensionMs;

        config.config.runtime.remoteBuildMaxAutonomousRounds = 2;
        config.config.runtime.remoteBuildMaxAutonomousToolCalls = 4;
        config.config.runtime.remoteBuildMaxAutonomousMs = 120000;
        config.config.runtime.remoteBuildBudgetExtensionMaxUses = 1;
        config.config.runtime.remoteBuildBudgetExtensionRounds = 2;
        config.config.runtime.remoteBuildBudgetExtensionToolCalls = 4;
        config.config.runtime.remoteBuildBudgetExtensionMs = 60000;

        try {
            const llmClient = {
                createResponse: jest.fn().mockResolvedValue(buildResponse('Remote work completed after the adaptive round extension.', 'resp_round_extension')),
                complete: jest.fn()
                    .mockResolvedValueOnce(JSON.stringify({
                        steps: [{ tool: 'remote-command', reason: 'Round 1', params: { command: 'echo round-1' } }],
                    }))
                    .mockResolvedValueOnce(JSON.stringify({
                        steps: [{ tool: 'remote-command', reason: 'Round 2', params: { command: 'echo round-2' } }],
                    }))
                    .mockResolvedValueOnce(JSON.stringify({
                        steps: [{ tool: 'remote-command', reason: 'Round 3', params: { command: 'echo round-3' } }],
                    }))
                    .mockResolvedValueOnce(JSON.stringify({
                        steps: [{ tool: 'remote-command', reason: 'Round 4', params: { command: 'echo round-4' } }],
                    }))
                    .mockResolvedValueOnce(JSON.stringify({ steps: [] })),
            };

            const toolManager = {
                getTool: jest.fn((toolId) => (
                    ['remote-command', 'docker-exec', 'web-search', 'web-fetch', 'file-read', 'file-search', 'tool-doc-read', 'code-sandbox']
                        .includes(toolId)
                        ? { id: toolId, description: toolId }
                        : null
                )),
                executeTool: jest.fn()
                    .mockResolvedValueOnce({
                        success: true,
                        toolId: 'remote-command',
                        data: { stdout: 'round-1', stderr: '', host: '10.0.0.5:22' },
                    })
                    .mockResolvedValueOnce({
                        success: true,
                        toolId: 'remote-command',
                        data: { stdout: 'round-2', stderr: '', host: '10.0.0.5:22' },
                    })
                    .mockResolvedValueOnce({
                        success: true,
                        toolId: 'remote-command',
                        data: { stdout: 'round-3', stderr: '', host: '10.0.0.5:22' },
                    })
                    .mockResolvedValueOnce({
                        success: true,
                        toolId: 'remote-command',
                        data: { stdout: 'round-4', stderr: '', host: '10.0.0.5:22' },
                    }),
            };
            const sessionStore = {
                get: jest.fn().mockResolvedValue({ id: 'session-round-extension', metadata: {} }),
                getOrCreate: jest.fn().mockResolvedValue({ id: 'session-round-extension', metadata: {} }),
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
                input: 'Keep going on the server until the build work is complete.',
                sessionId: 'session-round-extension',
                executionProfile: 'remote-build',
                stream: false,
            });

            expect(toolManager.executeTool).toHaveBeenCalledTimes(4);
            expect(result.response.metadata.executionTrace.find((entry) => entry.name === 'Autonomous execution budget extended')).toMatchObject({
                details: expect.objectContaining({
                    reason: 'round-limit',
                    addedRounds: 2,
                }),
            });
        } finally {
            config.config.runtime.remoteBuildMaxAutonomousRounds = originalRounds;
            config.config.runtime.remoteBuildMaxAutonomousToolCalls = originalToolCalls;
            config.config.runtime.remoteBuildMaxAutonomousMs = originalMaxMs;
            config.config.runtime.remoteBuildBudgetExtensionMaxUses = originalExtensionUses;
            config.config.runtime.remoteBuildBudgetExtensionRounds = originalExtensionRounds;
            config.config.runtime.remoteBuildBudgetExtensionToolCalls = originalExtensionToolCalls;
            config.config.runtime.remoteBuildBudgetExtensionMs = originalExtensionMs;
        }
    });

    test('continues autonomous remote-build work after a recoverable remote-command failure', async () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const llmClient = {
            createResponse: jest.fn().mockResolvedValue(buildResponse('Recovered from the missing service name and kept troubleshooting.', 'resp_recoverable')),
            complete: jest.fn()
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [{
                        tool: 'remote-command',
                        reason: 'Check the expected Gitea service first',
                        params: {
                            command: 'systemctl status gitea --no-pager',
                        },
                    }],
                }))
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [{
                        tool: 'remote-command',
                        reason: 'List matching services after the missing unit failure',
                        params: {
                            command: 'systemctl list-units --type=service --all | grep -i gitea || true',
                        },
                    }],
                }))
                .mockResolvedValueOnce(JSON.stringify({ steps: [] })),
        };

        const toolManager = {
            getTool: jest.fn((toolId) => (
                ['remote-command', 'docker-exec', 'web-search', 'web-fetch', 'file-read', 'file-search', 'tool-doc-read', 'code-sandbox']
                    .includes(toolId)
                    ? { id: toolId, description: toolId }
                    : null
            )),
            executeTool: jest.fn()
                .mockResolvedValueOnce({
                    success: false,
                    toolId: 'remote-command',
                    error: 'Unit gitea.service could not be found.',
                    data: {
                        host: '10.0.0.5:22',
                        stderr: 'Unit gitea.service could not be found.',
                    },
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: {
                        host: '10.0.0.5:22',
                        stdout: 'gitea-web.service loaded inactive dead',
                        stderr: '',
                    },
                }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({ id: 'session-recoverable-remote', metadata: {} }),
            getOrCreate: jest.fn().mockResolvedValue({ id: 'session-recoverable-remote', metadata: {} }),
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
            input: 'Use remote-build to troubleshoot Gitea on the server and keep going through the obvious next steps.',
            sessionId: 'session-recoverable-remote',
            executionProfile: 'remote-build',
            stream: false,
        });

        expect(toolManager.executeTool).toHaveBeenCalledTimes(2);
        expect(toolManager.executeTool).toHaveBeenNthCalledWith(
            1,
            'remote-command',
            expect.objectContaining({ command: 'systemctl status gitea --no-pager' }),
            expect.objectContaining({ executionProfile: 'remote-build' }),
        );
        expect(toolManager.executeTool).toHaveBeenNthCalledWith(
            2,
            'remote-command',
            expect.objectContaining({ command: 'systemctl list-units --type=service --all | grep -i gitea || true' }),
            expect.objectContaining({ executionProfile: 'remote-build' }),
        );
        expect(result.response.metadata.executionTrace.map((entry) => entry.name)).toContain('Recoverable remote failure after round 1');
        expect(sessionStore.update).toHaveBeenLastCalledWith('session-recoverable-remote', expect.objectContaining({
            metadata: expect.objectContaining({
                lastToolIntent: 'remote-command',
                remoteWorkingState: expect.objectContaining({
                    lastCommand: 'systemctl list-units --type=service --all | grep -i gitea || true',
                    lastCommandSucceeded: true,
                }),
            }),
        }));
    });

    test('allows re-running the same remote verification command after an intervening fix', async () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const verificationCommand = 'curl -IkfsS --max-time 20 https://git.example.com';
        const llmClient = {
            createResponse: jest.fn().mockResolvedValue(buildResponse('Verified the endpoint again after the restart.', 'resp_reverify')),
            complete: jest.fn()
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [{
                        tool: 'remote-command',
                        reason: 'Verify the endpoint first',
                        params: {
                            command: verificationCommand,
                        },
                    }],
                }))
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [{
                        tool: 'remote-command',
                        reason: 'Restart Gitea before re-checking the endpoint',
                        params: {
                            command: 'sudo systemctl restart gitea-web',
                        },
                    }],
                }))
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [{
                        tool: 'remote-command',
                        reason: 'Re-run the same endpoint verification after the restart',
                        params: {
                            command: verificationCommand,
                        },
                    }],
                }))
                .mockResolvedValueOnce(JSON.stringify({ steps: [] })),
        };

        const toolManager = {
            getTool: jest.fn((toolId) => (
                ['remote-command', 'docker-exec', 'web-search', 'web-fetch', 'file-read', 'file-search', 'tool-doc-read', 'code-sandbox']
                    .includes(toolId)
                    ? { id: toolId, description: toolId }
                    : null
            )),
            executeTool: jest.fn()
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: { host: '10.0.0.5:22', stdout: 'HTTP/2 502', stderr: '' },
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: { host: '10.0.0.5:22', stdout: '', stderr: '' },
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: { host: '10.0.0.5:22', stdout: 'HTTP/2 200', stderr: '' },
                }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({ id: 'session-reverify-remote', metadata: {} }),
            getOrCreate: jest.fn().mockResolvedValue({ id: 'session-reverify-remote', metadata: {} }),
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
            input: 'Use remote-build to troubleshoot Git access on the server and keep going until it works.',
            sessionId: 'session-reverify-remote',
            executionProfile: 'remote-build',
            stream: false,
        });

        expect(toolManager.executeTool).toHaveBeenCalledTimes(3);
        expect(toolManager.executeTool.mock.calls[0][1].command).toBe(verificationCommand);
        expect(toolManager.executeTool.mock.calls[1][1].command).toBe('sudo systemctl restart gitea-web');
        expect(toolManager.executeTool.mock.calls[2][1].command).toBe(verificationCommand);
        expect(result.response.metadata.toolEvents).toHaveLength(3);
    });

    test('continues remote website updates when the planner repeats the generic baseline command', async () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const baselineCommand = "hostname && uname -m && (test -f /etc/os-release && sed -n '1,3p' /etc/os-release || true) && uptime";
        const llmClient = {
            createResponse: jest.fn().mockResolvedValue(buildResponse('Inspected the deployed website source and kept the remote update moving.', 'resp_remote_website_followup')),
            complete: jest.fn()
                .mockResolvedValueOnce('I should inspect the server first.')
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [{
                        tool: 'remote-command',
                        reason: 'Repeat the generic server inspection first',
                        params: {
                            command: baselineCommand,
                        },
                    }],
                }))
                .mockResolvedValueOnce(JSON.stringify({ steps: [] })),
        };

        const toolManager = {
            getTool: jest.fn((toolId) => (
                ['remote-command', 'docker-exec', 'web-search', 'web-fetch', 'file-read', 'file-search', 'tool-doc-read', 'code-sandbox']
                    .includes(toolId)
                    ? { id: toolId, description: toolId }
                    : null
            )),
            executeTool: jest.fn()
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: {
                        host: '10.0.0.5:22',
                        stdout: 'host-a\naarch64\nNAME="Ubuntu"\n 12:00 up 1 day',
                        stderr: '',
                    },
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: {
                        host: '10.0.0.5:22',
                        stdout: '/root/website.html',
                        stderr: '',
                    },
                }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({ id: 'session-remote-website-followup', metadata: {} }),
            getOrCreate: jest.fn().mockResolvedValue({ id: 'session-remote-website-followup', metadata: {} }),
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
            input: 'Update the website gallery on the cluster to use bikini/swimwear images and restart the workload.',
            sessionId: 'session-remote-website-followup',
            executionProfile: 'remote-build',
            metadata: {
                remoteBuildAutonomyApproved: true,
            },
            stream: false,
        });

        expect(toolManager.executeTool).toHaveBeenCalledTimes(2);
        expect(toolManager.executeTool.mock.calls[0][1].command).toBe(baselineCommand);
        expect(toolManager.executeTool.mock.calls[1][1].command).toContain("test -f /root/website.html");
        expect(toolManager.executeTool.mock.calls[1][1].command).toContain("find /root /srv /var/www -maxdepth 3 -type f");
        expect(result.response.metadata.executionTrace.find((entry) => entry.name === 'Plan round 2')).toMatchObject({
            details: {
                stepCount: 1,
                steps: [
                    expect.objectContaining({
                        tool: 'remote-command',
                    }),
                ],
            },
        });
    });

    test('switches from remote artifact curl failures to local web-fetch and remote apply for website updates', async () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const artifactUrl = '/api/artifacts/3ee64601-2cb4-43e1-b56b-973bc2856419/download';
        const llmClient = {
            createResponse: jest.fn().mockResolvedValue(buildResponse('Transferred the generated landing page content through the local runtime and applied it remotely.', 'resp_remote_artifact_transfer')),
            complete: jest.fn()
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [{
                        tool: 'remote-command',
                        reason: 'Replace the placeholder `website-html` ConfigMap content with the generated landing page artifact that the live pod is still missing.',
                        params: {
                            command: `curl -fsSL https://api${artifactUrl}`,
                        },
                    }],
                }))
                .mockResolvedValueOnce(JSON.stringify({ steps: [] }))
                .mockResolvedValueOnce(JSON.stringify({ steps: [] })),
        };

        const toolManager = {
            getTool: jest.fn((toolId) => (
                ['remote-command', 'docker-exec', 'web-search', 'web-fetch', 'file-read', 'file-search', 'tool-doc-read', 'code-sandbox']
                    .includes(toolId)
                    ? { id: toolId, description: toolId }
                    : null
            )),
            executeTool: jest.fn()
                .mockResolvedValueOnce({
                    success: false,
                    toolId: 'remote-command',
                    error: 'curl: (6) Could not resolve host: api',
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'web-fetch',
                    data: {
                        status: 200,
                        body: '<!DOCTYPE html><html><body><main>Transferred landing page</main></body></html>',
                        url: `http://localhost:3000${artifactUrl}`,
                    },
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: {
                        stdout: 'website-html\nindex.html',
                        stderr: '',
                    },
                }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({ id: 'session-remote-artifact-transfer', metadata: {} }),
            getOrCreate: jest.fn().mockResolvedValue({ id: 'session-remote-artifact-transfer', metadata: {} }),
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
            input: 'Replace the deployed HTML with the generated landing page and publish it online.',
            sessionId: 'session-remote-artifact-transfer',
            executionProfile: 'remote-build',
            metadata: {
                remoteBuildAutonomyApproved: true,
            },
            instructions: `Generated artifacts:\n- website.html (html) -> ${artifactUrl}`,
            stream: false,
        });

        expect(toolManager.executeTool).toHaveBeenCalledTimes(3);
        expect(toolManager.executeTool).toHaveBeenNthCalledWith(
            1,
            'remote-command',
            expect.objectContaining({
                command: expect.stringContaining(`https://api${artifactUrl}`),
            }),
            expect.any(Object),
        );
        expect(toolManager.executeTool).toHaveBeenNthCalledWith(
            2,
            'web-fetch',
            { url: artifactUrl },
            expect.any(Object),
        );
        expect(toolManager.executeTool).toHaveBeenNthCalledWith(
            3,
            'remote-command',
            expect.objectContaining({
                command: expect.stringContaining('Transferred landing page'),
            }),
            expect.any(Object),
        );
        expect(result.response.metadata.executionTrace.map((entry) => entry.name)).toContain('Recoverable remote failure after round 1');
    });

    test('prefers deterministic remote workload inspection after svc or ingress is treated as a deployment name', async () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const llmClient = {
            createResponse: jest.fn().mockResolvedValue(buildResponse('Re-inspected the cluster resources with the corrected Kubernetes command.', 'resp_remote_workload_inspection')),
            complete: jest.fn()
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [{
                        tool: 'remote-command',
                        reason: 'Inspect the website deployment before replacing the live page.',
                        params: {
                            command: 'kubectl get deployment svc ingress -A',
                        },
                    }],
                }))
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [{
                        tool: 'remote-command',
                        reason: 'Retry the same website deployment inspection.',
                        params: {
                            command: 'kubectl get deployment svc ingress -A',
                        },
                    }],
                }))
                .mockResolvedValueOnce(JSON.stringify({ steps: [] })),
        };

        const toolManager = {
            getTool: jest.fn((toolId) => (
                ['remote-command', 'docker-exec', 'web-search', 'web-fetch', 'file-read', 'file-search', 'tool-doc-read', 'code-sandbox']
                    .includes(toolId)
                    ? { id: toolId, description: toolId }
                    : null
            )),
            executeTool: jest.fn()
                .mockResolvedValueOnce({
                    success: false,
                    toolId: 'remote-command',
                    error: 'Error from server (NotFound): deployments.apps "svc" not found\nError from server (NotFound): deployments.apps "ingress" not found',
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: {
                        stdout: 'default   deployment.apps/website\ndefault   service/website\ndefault   ingress.networking.k8s.io/website',
                        stderr: '',
                    },
                }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({ id: 'session-remote-workload-inspection', metadata: {} }),
            getOrCreate: jest.fn().mockResolvedValue({ id: 'session-remote-workload-inspection', metadata: {} }),
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
            input: 'Replace the live website HTML on the cluster and verify the workload before changing it.',
            sessionId: 'session-remote-workload-inspection',
            executionProfile: 'remote-build',
            metadata: {
                remoteBuildAutonomyApproved: true,
            },
            stream: false,
        });

        expect(toolManager.executeTool).toHaveBeenCalledTimes(2);
        expect(toolManager.executeTool).toHaveBeenNthCalledWith(
            1,
            'remote-command',
            expect.objectContaining({
                command: 'kubectl get deployment svc ingress -A',
            }),
            expect.any(Object),
        );
        expect(toolManager.executeTool).toHaveBeenNthCalledWith(
            2,
            'remote-command',
            expect.objectContaining({
                command: expect.stringContaining('kubectl get deployment,svc,ingress -A'),
            }),
            expect.any(Object),
        );
        expect(toolManager.executeTool.mock.calls[1][1].command).toContain('kubectl get configmap -A');
        expect(toolManager.executeTool.mock.calls[1][1].command).toContain('kubectl get pods -A -o wide');
    });

    test('prefers body verification after a title-only remote website verification failure', async () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const llmClient = {
            createResponse: jest.fn().mockResolvedValue(buildResponse('Verified the deployed page by checking mounted HTML and the public response body.', 'resp_remote_body_verification')),
            complete: jest.fn()
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [{
                        tool: 'remote-command',
                        reason: 'Verify the pod and public titles for the deployed website.',
                        params: {
                            command: 'echo "--- pod title ---"; echo; echo "--- public title ---"',
                        },
                    }],
                }))
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [{
                        tool: 'remote-command',
                        reason: 'Retry the same title-based verification.',
                        params: {
                            command: 'echo "--- pod title ---"; echo; echo "--- public title ---"',
                        },
                    }],
                }))
                .mockResolvedValueOnce(JSON.stringify({ steps: [] })),
        };

        const toolManager = {
            getTool: jest.fn((toolId) => (
                ['remote-command', 'docker-exec', 'web-search', 'web-fetch', 'file-read', 'file-search', 'tool-doc-read', 'code-sandbox']
                    .includes(toolId)
                    ? { id: toolId, description: toolId }
                    : null
            )),
            executeTool: jest.fn()
                .mockResolvedValueOnce({
                    success: false,
                    toolId: 'remote-command',
                    error: '--- pod title ---\n\n--- public title ---',
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: {
                        stdout: '--- pod file: /usr/share/nginx/html/index.html ---\n512\n<!DOCTYPE html><html><body><main>Bikini storefront</main></body></html>\n--- public response ---\nHTTP/2 200\n<!DOCTYPE html><html><body><main>Bikini storefront</main></body></html>',
                        stderr: '',
                    },
                }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({ id: 'session-remote-body-verification', metadata: {} }),
            getOrCreate: jest.fn().mockResolvedValue({ id: 'session-remote-body-verification', metadata: {} }),
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
            input: 'Verify the deployed website HTML on the pod and the public host after the rollout.',
            sessionId: 'session-remote-body-verification',
            executionProfile: 'remote-build',
            metadata: {
                remoteBuildAutonomyApproved: true,
            },
            stream: false,
        });

        expect(toolManager.executeTool).toHaveBeenCalledTimes(2);
        expect(toolManager.executeTool).toHaveBeenNthCalledWith(
            1,
            'remote-command',
            expect.objectContaining({
                command: 'echo "--- pod title ---"; echo; echo "--- public title ---"',
            }),
            expect.any(Object),
        );
        expect(toolManager.executeTool).toHaveBeenNthCalledWith(
            2,
            'remote-command',
            expect.objectContaining({
                command: expect.stringContaining('--- public response ---'),
            }),
            expect.any(Object),
        );
        expect(toolManager.executeTool.mock.calls[1][1].command).toContain('kubectl exec -n "$ns" "$pod"');
        expect(toolManager.executeTool.mock.calls[1][1].command).toContain('sed -n "1,40p"');
    });

    test('follows a crashing init container describe step with kubectl logs instead of handing off the next tool call', async () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const llmClient = {
            createResponse: jest.fn().mockResolvedValue(buildResponse('Fetched the failing init container logs and continued troubleshooting.', 'resp_init_logs')),
            complete: jest.fn()
                .mockResolvedValueOnce(JSON.stringify({
                    steps: [{
                        tool: 'remote-command',
                        reason: 'Describe the crashing Gitea pod first',
                        params: {
                            command: 'kubectl describe pod -n gitea gitea-5479f795f8-pk2dp',
                        },
                    }],
                }))
                .mockResolvedValueOnce(JSON.stringify({ steps: [] }))
                .mockResolvedValueOnce(JSON.stringify({ steps: [] })),
        };

        const describeOutput = [
            'Name:         gitea-5479f795f8-pk2dp',
            'Namespace:    gitea',
            'Init Containers:',
            '  init-directories:',
            '    State:          Terminated',
            '      Reason:       Completed',
            '  init-app-ini:',
            '    State:          Waiting',
            '      Reason:       CrashLoopBackOff',
            '    Last State:     Terminated',
            '      Reason:       Error',
            '      Exit Code:    1',
            'Containers:',
            '  gitea:',
            '    State: Waiting',
        ].join('\n');

        const toolManager = {
            getTool: jest.fn((toolId) => (
                ['remote-command', 'docker-exec', 'web-search', 'web-fetch', 'file-read', 'file-search', 'tool-doc-read', 'code-sandbox']
                    .includes(toolId)
                    ? { id: toolId, description: toolId }
                    : null
            )),
            executeTool: jest.fn()
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: {
                        host: '10.0.0.5:22',
                        stdout: describeOutput,
                        stderr: '',
                    },
                })
                .mockResolvedValueOnce({
                    success: true,
                    toolId: 'remote-command',
                    data: {
                        host: '10.0.0.5:22',
                        stdout: '/usr/sbinx/config_environment.sh: not found',
                        stderr: '',
                    },
                }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({ id: 'session-init-logs', metadata: {} }),
            getOrCreate: jest.fn().mockResolvedValue({ id: 'session-init-logs', metadata: {} }),
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
            input: 'You have root access on the whole cluster. Can you solve this issue with the crashing Gitea init container?',
            sessionId: 'session-init-logs',
            executionProfile: 'remote-build',
            metadata: {
                remoteBuildAutonomyApproved: true,
            },
            stream: false,
        });

        expect(toolManager.executeTool).toHaveBeenCalledTimes(2);
        expect(toolManager.executeTool.mock.calls[0][1].command).toBe('kubectl describe pod -n gitea gitea-5479f795f8-pk2dp');
        expect(toolManager.executeTool.mock.calls[1][1].command).toContain("kubectl logs -n 'gitea' 'gitea-5479f795f8-pk2dp' -c 'init-app-ini' --previous");
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

    test('surfaces user-checkpoint to planners for web-chat decision gates', async () => {
        const llmClient = {
            createResponse: jest.fn(),
            complete: jest.fn().mockResolvedValue(JSON.stringify({ steps: [] })),
        };
        const orchestrator = new ConversationOrchestrator({
            llmClient,
            toolManager: {
                getTool: jest.fn((toolId) => (
                    ['user-checkpoint', 'architecture-design'].includes(toolId)
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const objective = 'Plan the system architecture and ask me which direction to take before you start major implementation.';
        const toolPolicy = orchestrator.buildToolPolicy({
            objective,
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
            toolContext: {
                userCheckpointPolicy: {
                    enabled: true,
                    remaining: 2,
                    pending: null,
                },
            },
        });

        await orchestrator.planToolUse({
            objective,
            executionProfile: 'default',
            toolPolicy,
        });

        const plannerPrompt = llmClient.complete.mock.calls[0]?.[0] || '';
        const runtimeInstructions = orchestrator.buildRuntimeInstructions({
            executionProfile: 'default',
            allowedToolIds: toolPolicy.allowedToolIds,
            toolPolicy,
        });

        expect(toolPolicy.candidateToolIds).toContain('user-checkpoint');
        expect(toolPolicy.userCheckpointPolicy).toEqual(expect.objectContaining({
            enabled: true,
            remaining: 2,
        }));
        expect(plannerPrompt).toContain('Every `user-checkpoint` step must include a non-empty `params.question` string');
        expect(plannerPrompt).toContain('inline survey card with clickable options');
        expect(runtimeInstructions).toContain('inline popup-style survey card with clickable choices');
    });

    test('suppresses user-checkpoint when a survey is already pending', () => {
        const orchestrator = new ConversationOrchestrator({
            llmClient: {
                createResponse: jest.fn(),
                complete: jest.fn(),
            },
            toolManager: {
                getTool: jest.fn((toolId) => (
                    toolId === 'user-checkpoint'
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const toolPolicy = orchestrator.buildToolPolicy({
            objective: 'Plan the refactor and ask me first before doing major work.',
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
            toolContext: {
                userCheckpointPolicy: {
                    enabled: true,
                    remaining: 1,
                    pending: {
                        id: 'checkpoint-1',
                        question: 'Choose a direction',
                    },
                },
            },
        });

        expect(toolPolicy.candidateToolIds).not.toContain('user-checkpoint');
        expect(toolPolicy.userCheckpointPolicy.pending).toEqual(expect.objectContaining({
            id: 'checkpoint-1',
        }));
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

    test('forces a direct Perplexity-backed web-search action for current-info prompts like weather', () => {
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

        const objective = 'What is the weather in Halifax today?';
        const toolPolicy = orchestrator.buildToolPolicy({
            objective,
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
        });
        const directAction = orchestrator.buildDirectAction({
            objective,
            toolPolicy,
        });

        expect(toolPolicy.candidateToolIds).toContain('web-search');
        expect(directAction).toEqual({
            tool: 'web-search',
            reason: 'Current-information request should start with Perplexity-backed web search.',
            params: expect.objectContaining({
                engine: 'perplexity',
                query: 'What is the weather in Halifax today',
                timeRange: 'day',
            }),
        });
    });

    test('prefers document-workflow once verified research pages exist for a requested slide deck', () => {
        const orchestrator = new ConversationOrchestrator({
            llmClient: {
                createResponse: jest.fn(),
                complete: jest.fn(),
            },
            toolManager: {
                getTool: jest.fn((toolId) => (
                    ['web-search', 'web-fetch', 'document-workflow'].includes(toolId)
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const objective = 'Research vacation pricing in Halifax and build a slide deck I can review.';
        const toolPolicy = orchestrator.buildToolPolicy({
            objective,
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
        });
        const directAction = orchestrator.buildDirectAction({
            objective,
            toolPolicy,
            toolEvents: [
                {
                    toolCall: {
                        function: {
                            name: 'web-search',
                            arguments: JSON.stringify({ query: 'vacation pricing in Halifax' }),
                        },
                    },
                    result: {
                        success: true,
                        toolId: 'web-search',
                        data: {
                            query: 'vacation pricing in Halifax',
                            results: [
                                {
                                    title: 'Nova Scotia Travel Packages',
                                    url: 'https://travel.example.com/packages',
                                    source: 'travel.example.com',
                                    snippet: 'Weekend package from $799 with optional flights.',
                                },
                            ],
                        },
                    },
                },
                {
                    toolCall: {
                        function: {
                            name: 'web-fetch',
                            arguments: JSON.stringify({ url: 'https://travel.example.com/packages' }),
                        },
                    },
                    result: {
                        success: true,
                        toolId: 'web-fetch',
                        data: {
                            url: 'https://travel.example.com/packages',
                            title: 'Nova Scotia Travel Packages',
                            body: '<html><body><main>Weekend package: $799. Flights from Halifax start at $214.</main></body></html>',
                        },
                    },
                },
            ],
        });

        expect(toolPolicy.candidateToolIds).toEqual(
            expect.arrayContaining(['web-search', 'document-workflow']),
        );
        expect(directAction).toEqual(expect.objectContaining({
            tool: 'document-workflow',
            params: expect.objectContaining({
                action: 'generate',
                prompt: objective,
                sources: expect.arrayContaining([
                    expect.objectContaining({
                        sourceUrl: 'https://travel.example.com/packages',
                        kind: 'web-fetch',
                        content: expect.stringContaining('Weekend package: $799. Flights from Halifax start at $214.'),
                    }),
                ]),
            }),
        }));
    });

    test('forces a direct blind web-scrape action for explicit sensitive image scraping requests', () => {
        const orchestrator = new ConversationOrchestrator({
            llmClient: {
                createResponse: jest.fn(),
                complete: jest.fn(),
            },
            toolManager: {
                getTool: jest.fn((toolId) => (
                    toolId === 'web-scrape'
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const toolPolicy = orchestrator.buildToolPolicy({
            objective: 'Scrape images from https://example.com/gallery without exposing the agent to the adult content.',
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
        });
        const directAction = orchestrator.buildDirectAction({
            objective: 'Scrape images from https://example.com/gallery without exposing the agent to the adult content.',
            toolPolicy,
        });

        expect(directAction).toEqual({
            tool: 'web-scrape',
            reason: 'Explicit scrape request with a direct URL should start with deterministic web scraping.',
            params: expect.objectContaining({
                url: 'https://example.com/gallery',
                browser: true,
                captureImages: true,
                blindImageCapture: true,
            }),
        });
    });

    test('forces a direct image-generation action for explicit image creation requests', () => {
        const orchestrator = new ConversationOrchestrator({
            llmClient: {
                createResponse: jest.fn(),
                complete: jest.fn(),
            },
            toolManager: {
                getTool: jest.fn((toolId) => (
                    toolId === 'image-generate'
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const toolPolicy = orchestrator.buildToolPolicy({
            objective: 'Make a hypercar image and put it in a PDF brochure.',
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
        });
        const directAction = orchestrator.buildDirectAction({
            objective: 'Make a hypercar image and put it in a PDF brochure.',
            toolPolicy,
        });

        expect(directAction).toEqual({
            tool: 'image-generate',
            reason: 'Explicit image-generation request should start by materializing reusable image artifacts.',
            params: {
                prompt: 'Make a hypercar image',
            },
        });
    });

    test('notes synthesis instructions keep repaired answers on the page instead of drifting into workspace writes', () => {
        const orchestrator = new ConversationOrchestrator({
            llmClient: {
                createResponse: jest.fn(),
                complete: jest.fn(),
            },
            toolManager: {
                getTool: jest.fn(() => null),
            },
        });

        const instructions = orchestrator.buildRuntimeInstructions({
            baseInstructions: 'Base continuity',
            executionProfile: 'notes',
            allowedToolIds: ['web-search'],
            toolEvents: [{
                toolCall: { function: { name: 'web-search' } },
                reason: 'Research cats',
                result: { success: true, data: { results: [{ title: 'Cat', url: 'https://example.com' }] } },
            }],
            toolPolicy: {
                allowedToolIds: ['web-search'],
                hasReachableSshTarget: false,
            },
        });

        expect(instructions).toContain('Lilly-style block-based notes document');
        expect(instructions).toContain('edit the current page itself through block updates');
        expect(instructions).toContain('Prefer returning `notes-actions` or page-ready notes content');
        expect(instructions).toContain('Only stay in planning/chat mode');
        expect(instructions).toContain('Do not mention `/app`');
        expect(instructions).toContain('Do not use `file-write` or `file-mkdir`');
    });

    test('notes tool policy is restricted to web research tools for page-edit requests', () => {
        const orchestrator = new ConversationOrchestrator({
            llmClient: {
                createResponse: jest.fn(),
                complete: jest.fn(),
            },
            toolManager: {
                getTool: jest.fn((toolId) => (
                    ['web-search', 'web-fetch', 'web-scrape', 'file-read', 'file-search', 'file-write', 'file-mkdir', 'remote-command', 'document-workflow'].includes(toolId)
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const toolPolicy = orchestrator.buildToolPolicy({
            objective: 'Put this 3D tic tac toe implementation plan on the page and organize the notes.',
            executionProfile: 'notes',
            toolManager: orchestrator.toolManager,
        });

        expect(toolPolicy.allowedToolIds).toEqual(['web-search', 'web-fetch', 'web-scrape']);
        expect(toolPolicy.candidateToolIds).toEqual([]);
    });

    test('falls back to web-search planning when planner output is not valid json', async () => {
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

    test('does not let a generic cluster deployment request collapse into kubectl pod listing fallback', async () => {
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
            complete: jest.fn().mockResolvedValue('I should probably inspect the cluster first.'),
        };
        const orchestrator = new ConversationOrchestrator({
            llmClient,
            toolManager: {
                getTool: jest.fn((toolId) => (
                    ['remote-command', 'web-search'].includes(toolId)
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const toolPolicy = orchestrator.buildToolPolicy({
            objective: 'Can you please set this up on the cluster and deploy it into a pod if needed?',
            executionProfile: 'remote-build',
            toolManager: orchestrator.toolManager,
        });

        const plan = await orchestrator.planToolUse({
            objective: 'Can you please set this up on the cluster and deploy it into a pod if needed?',
            executionProfile: 'remote-build',
            toolPolicy,
        });

        expect(plan).toEqual([
            expect.objectContaining({
                tool: 'remote-command',
                params: expect.objectContaining({
                    command: expect.stringContaining('uname -m'),
                }),
            }),
        ]);
        expect(plan[0].params.command).not.toContain('kubectl get nodes -o wide');
        expect(plan[0].params.command).not.toContain('kubectl get pods -A');
    });

    test('repairs malformed planner params for agent-workload steps', async () => {
        const llmClient = {
            createResponse: jest.fn(),
            complete: jest.fn().mockResolvedValue(JSON.stringify({
                steps: [
                    {
                        tool: 'agent-workload',
                        reason: 'Schedule a deferred task to check the time on remote host in 5 minutes',
                        params: {
                            action: 'remote-command',
                            command: 'date',
                            name: 'time-check',
                            schedule: 'in 5 minutes',
                        },
                    },
                ],
            })),
        };
        const orchestrator = new ConversationOrchestrator({
            llmClient,
            toolManager: {
                getTool: jest.fn((toolId) => (
                    ['agent-workload', 'remote-command'].includes(toolId)
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const toolPolicy = orchestrator.buildToolPolicy({
            objective: 'can you run a cron later to check the time on the remote host in 5 minutes',
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
        });

        const plan = await orchestrator.planToolUse({
            objective: 'can you run a cron later to check the time on the remote host in 5 minutes',
            executionProfile: 'default',
            toolPolicy,
            session: {
                metadata: {
                    timezone: 'America/Halifax',
                },
            },
            toolContext: {
                timezone: 'America/Halifax',
                now: '2026-04-02T09:00:00.000Z',
            },
        });

        expect(plan).toEqual([
            expect.objectContaining({
                tool: 'agent-workload',
                params: expect.objectContaining({
                    action: 'create',
                    trigger: {
                        type: 'once',
                        runAt: '2026-04-02T09:05:00.000Z',
                    },
                    metadata: expect.objectContaining({
                        createdFromScenario: true,
                        scenarioRequest: 'can you run a cron later to check the time on the remote host in 5 minutes',
                    }),
                }),
            }),
        ]);
    });

    test('repairs simple planner params for user-checkpoint steps', async () => {
        const llmClient = {
            createResponse: jest.fn(),
            complete: jest.fn().mockResolvedValue(JSON.stringify({
                steps: [
                    {
                        tool: 'user-checkpoint',
                        reason: 'Need one decision before major work.',
                        params: {
                            prompt: 'Which direction should I take?',
                            options: [
                                'Refactor auth flow first',
                                'Prototype the UI first',
                            ],
                        },
                    },
                ],
            })),
        };
        const orchestrator = new ConversationOrchestrator({
            llmClient,
            toolManager: {
                getTool: jest.fn((toolId) => (
                    toolId === 'user-checkpoint'
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const toolPolicy = orchestrator.buildToolPolicy({
            objective: 'Plan the next implementation steps and ask me first before major work.',
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
            toolContext: {
                userCheckpointPolicy: {
                    enabled: true,
                    remaining: 2,
                    pending: null,
                },
            },
        });

        const plan = await orchestrator.planToolUse({
            objective: 'Plan the next implementation steps and ask me first before major work.',
            executionProfile: 'default',
            toolPolicy,
        });

        expect(plan).toEqual([
            expect.objectContaining({
                tool: 'user-checkpoint',
                params: expect.objectContaining({
                    question: 'Which direction should I take?',
                    options: [
                        { label: 'Refactor auth flow first' },
                        { label: 'Prototype the UI first' },
                    ],
                }),
            }),
        ]);
    });

    test('does not shortcut multi-job scheduling requests into a single direct workload action', () => {
        const orchestrator = new ConversationOrchestrator({
            llmClient: {
                createResponse: jest.fn(),
                complete: jest.fn(),
            },
            toolManager: {
                getTool: jest.fn((toolId) => (
                    ['agent-workload', 'remote-command'].includes(toolId)
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const objective = 'can you setup a couple cron jobs on the local system to reach out to the server and do security updates and checks';
        const toolPolicy = orchestrator.buildToolPolicy({
            objective,
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
        });

        const directAction = orchestrator.buildDirectAction({
            objective,
            toolPolicy,
            toolContext: {
                timezone: 'America/Halifax',
            },
        });

        expect(toolPolicy.candidateToolIds).toContain('agent-workload');
        expect(directAction).toBeNull();
    });

    test('does not offer agent-workload during deferred workload execution', () => {
        const orchestrator = new ConversationOrchestrator({
            llmClient: {
                createResponse: jest.fn(),
                complete: jest.fn(),
            },
            toolManager: {
                getTool: jest.fn((toolId) => (
                    ['agent-workload', 'remote-command'].includes(toolId)
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const toolPolicy = orchestrator.buildToolPolicy({
            objective: 'run a cron later every day at 8 pm to remote into the server and get a health report',
            executionProfile: 'remote-build',
            metadata: {
                workloadRun: true,
                clientSurface: 'workload',
            },
            toolManager: orchestrator.toolManager,
        });

        expect(toolPolicy.candidateToolIds).not.toContain('agent-workload');
        expect(toolPolicy.candidateToolIds).toContain('remote-command');
    });

    test('does not offer agent-workload when only a prior turn contained the schedule', () => {
        const orchestrator = new ConversationOrchestrator({
            llmClient: {
                createResponse: jest.fn(),
                complete: jest.fn(),
            },
            toolManager: {
                getTool: jest.fn((toolId) => (
                    toolId === 'agent-workload'
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const toolPolicy = orchestrator.buildToolPolicy({
            objective: 'gather information on the k3s cluster on the server',
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
            recentMessages: [
                { role: 'user', content: 'run it five minutes from now' },
            ],
            toolContext: {
                timezone: 'UTC',
                now: '2026-04-02T09:00:00.000Z',
            },
        });

        expect(toolPolicy.candidateToolIds).not.toContain('agent-workload');
    });

    test('builds a workload direct action from a schedule-only follow-up using recent transcript', () => {
        const orchestrator = new ConversationOrchestrator({
            llmClient: {
                createResponse: jest.fn(),
                complete: jest.fn(),
            },
        });

        const directAction = orchestrator.buildDirectAction({
            objective: 'run it five minutes from now',
            session: {
                metadata: {
                    timezone: 'UTC',
                },
            },
            recentMessages: [
                { role: 'user', content: 'gather information on the k3s cluster on the server' },
            ],
            toolPolicy: {
                candidateToolIds: ['agent-workload'],
            },
            toolContext: {
                timezone: 'UTC',
                now: '2026-04-02T09:00:00.000Z',
            },
        });

        expect(directAction).toEqual(expect.objectContaining({
            tool: 'agent-workload',
            params: expect.objectContaining({
                action: 'create',
                prompt: expect.stringContaining('gather information on the k3s cluster on the server'),
                trigger: {
                    type: 'once',
                    runAt: '2026-04-02T09:05:00.000Z',
                },
            }),
        }));
    });

    test('prefers remote-command over local file tools for remote website replacement prompts without explicit local artifacts', () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const orchestrator = new ConversationOrchestrator({
            llmClient: {
                createResponse: jest.fn(),
                complete: jest.fn(),
            },
            toolManager: {
                getTool: jest.fn((toolId) => (
                    ['remote-command', 'web-search', 'web-fetch', 'file-read', 'file-search', 'file-write', 'tool-doc-read']
                        .includes(toolId)
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const toolPolicy = orchestrator.buildToolPolicy({
            objective: 'Create a whole new HTML file, replace the existing website on the cluster, and restart the workload.',
            executionProfile: 'remote-build',
            toolManager: orchestrator.toolManager,
        });

        expect(toolPolicy.candidateToolIds).toContain('remote-command');
        expect(toolPolicy.candidateToolIds).not.toContain('web-fetch');
        expect(toolPolicy.candidateToolIds).not.toContain('file-read');
        expect(toolPolicy.candidateToolIds).not.toContain('file-search');
        expect(toolPolicy.candidateToolIds).not.toContain('file-write');
    });

    test('keeps remote website replacement on remote-command and exposes local web-fetch when project memory includes internal artifact downloads', () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const orchestrator = new ConversationOrchestrator({
            llmClient: {
                createResponse: jest.fn(),
                complete: jest.fn(),
            },
            toolManager: {
                getTool: jest.fn((toolId) => (
                    ['remote-command', 'web-search', 'web-fetch', 'file-read', 'file-search', 'file-write', 'tool-doc-read']
                        .includes(toolId)
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const toolPolicy = orchestrator.buildToolPolicy({
            objective: 'Use the replacement artifact to replace the existing website on the cluster and restart the workload.',
            instructions: 'Generated artifacts:\n- website.html (html) -> /api/artifacts/3ee64601-2cb4-43e1-b56b-973bc2856419/download',
            executionProfile: 'remote-build',
            toolManager: orchestrator.toolManager,
        });

        expect(toolPolicy.candidateToolIds).toContain('remote-command');
        expect(toolPolicy.candidateToolIds).toContain('web-fetch');
        expect(toolPolicy.candidateToolIds).not.toContain('file-read');
        expect(toolPolicy.candidateToolIds).not.toContain('file-search');
        expect(toolPolicy.candidateToolIds).not.toContain('file-write');
    });

    test('does not treat remembered generated html filenames as explicit local files for deployed website follow-ups', () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const orchestrator = new ConversationOrchestrator({
            llmClient: {
                createResponse: jest.fn(),
                complete: jest.fn(),
            },
            toolManager: {
                getTool: jest.fn((toolId) => (
                    ['remote-command', 'web-search', 'web-fetch', 'file-read', 'file-search', 'file-write', 'tool-doc-read']
                        .includes(toolId)
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const toolPolicy = orchestrator.buildToolPolicy({
            objective: 'Replace the deployed HTML with the full beach gallery markup and publish it online.',
            instructions: 'Generated artifacts:\n- beach-inspired-unsplash-gallery-html-s3v73n.html (html)\n- website.html (html) -> /api/artifacts/3ee64601-2cb4-43e1-b56b-973bc2856419/download',
            executionProfile: 'remote-build',
            toolManager: orchestrator.toolManager,
        });

        expect(toolPolicy.candidateToolIds).toContain('remote-command');
        expect(toolPolicy.candidateToolIds).toContain('web-fetch');
        expect(toolPolicy.candidateToolIds).not.toContain('file-read');
        expect(toolPolicy.candidateToolIds).not.toContain('file-search');
        expect(toolPolicy.candidateToolIds).not.toContain('file-write');
    });

    test('falls back to ssh planning for remote-build prompts', async () => {
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
        });

        expect(plan).toEqual([
            expect.objectContaining({
                tool: 'remote-command',
                params: expect.objectContaining({
                    command: 'kubectl get nodes -o wide && kubectl get pods -A',
                }),
            }),
        ]);
    });

    test('falls back to remote-command when it is the only remote tool available', async () => {
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
                    ['remote-command', 'web-search'].includes(toolId)
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
        });

        expect(plan).toEqual([
            expect.objectContaining({
                tool: 'remote-command',
                params: expect.objectContaining({
                    command: 'kubectl get nodes -o wide && kubectl get pods -A',
                }),
            }),
        ]);
    });

    test('repairs planner-provided remote-command steps that omit params.command', async () => {
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
            complete: jest.fn().mockResolvedValue(JSON.stringify({
                steps: [
                    {
                        tool: 'remote-command',
                        reason: 'Reconnect to the existing default server target, verify architecture with `uname -m`, and confirm the Gitea endpoint https://git.example.com is reachable from the server before attempting auth.',
                        params: {},
                    },
                ],
            })),
        };
        const orchestrator = new ConversationOrchestrator({
            llmClient,
            toolManager: {
                getTool: jest.fn((toolId) => (
                    ['remote-command', 'ssh-execute', 'web-search'].includes(toolId)
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const toolPolicy = orchestrator.buildToolPolicy({
            objective: 'Reconnect to the server and test https://git.example.com auth flow.',
            executionProfile: 'remote-build',
            toolManager: orchestrator.toolManager,
        });

        const plan = await orchestrator.planToolUse({
            objective: 'Reconnect to the server and test https://git.example.com auth flow.',
            executionProfile: 'remote-build',
            toolPolicy,
        });

        expect(plan).toEqual([
            expect.objectContaining({
                tool: 'remote-command',
                params: expect.objectContaining({
                    command: expect.stringContaining('curl -IkfsS --max-time 20'),
                }),
            }),
        ]);
        expect(plan[0].params.command).toContain('uname -m');
        expect(plan[0].params.command).toContain('https://git.example.com');
    });

    test('normalizes missing remote-command commands before execution', async () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const llmClient = {
            createResponse: jest.fn().mockResolvedValue(buildResponse('Remote baseline completed.', 'resp_remote_baseline')),
            complete: jest.fn().mockResolvedValue(JSON.stringify({
                steps: [
                    {
                        tool: 'remote-command',
                        reason: 'Reconnect to the server and verify Ubuntu architecture before continuing.',
                        params: {},
                    },
                ],
            })),
        };
        const toolManager = {
            getTool: jest.fn((toolId) => (
                ['remote-command', 'web-search', 'web-fetch', 'file-read', 'file-search', 'tool-doc-read']
                    .includes(toolId)
                    ? { id: toolId, description: toolId }
                    : null
            )),
            executeTool: jest.fn().mockResolvedValue({
                success: true,
                toolId: 'remote-command',
                data: {
                    stdout: 'host-a\naarch64\nNAME=\"Ubuntu\"',
                    stderr: '',
                    host: '10.0.0.5:22',
                },
            }),
        };
        const sessionStore = {
            get: jest.fn().mockResolvedValue({ id: 'session-remote-normalized', metadata: {} }),
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
            input: 'Reconnect to the Ubuntu server and continue the remote-build setup.',
            sessionId: 'session-remote-normalized',
            executionProfile: 'remote-build',
            stream: false,
        });

        expect(toolManager.executeTool).toHaveBeenCalledWith(
            'remote-command',
            expect.objectContaining({
                command: expect.stringContaining('uname -m'),
            }),
            expect.objectContaining({
                executionProfile: 'remote-build',
                sessionId: 'session-remote-normalized',
            }),
        );
    });

    test('does not offer code-sandbox for generic remote-build tasks', () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const orchestrator = new ConversationOrchestrator({
            llmClient: {
                createResponse: jest.fn(),
                complete: jest.fn(),
            },
            toolManager: {
                getTool: jest.fn((toolId) => (
                    ['remote-command', 'code-sandbox'].includes(toolId)
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const toolPolicy = orchestrator.buildToolPolicy({
            objective: 'Inspect the k3s cluster state on the server and continue setup.',
            executionProfile: 'remote-build',
            toolManager: orchestrator.toolManager,
        });

        expect(toolPolicy.candidateToolIds).toContain('remote-command');
        expect(toolPolicy.candidateToolIds).not.toContain('code-sandbox');
    });

    test('offers code-sandbox for remote-build tasks only when local code execution is explicit', () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const orchestrator = new ConversationOrchestrator({
            llmClient: {
                createResponse: jest.fn(),
                complete: jest.fn(),
            },
            toolManager: {
                getTool: jest.fn((toolId) => (
                    ['remote-command', 'code-sandbox'].includes(toolId)
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const toolPolicy = orchestrator.buildToolPolicy({
            objective: 'SSH into the server, then run this code snippet in a sandbox locally to verify output.',
            executionProfile: 'remote-build',
            toolManager: orchestrator.toolManager,
        });

        expect(toolPolicy.candidateToolIds).toContain('code-sandbox');
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
                    ['remote-command'].includes(toolId)
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

        expect(toolPolicy.candidateToolIds).toContain('remote-command');
        expect(runtimeInstructions).toContain('verify architecture with `uname -m`');
        expect(runtimeInstructions).toContain('`find`/`grep -R` for `rg`');
        expect(runtimeInstructions).toContain('`docker compose` for `docker-compose`');
        expect(plannerPrompt).toContain('find/grep instead of rg');
        expect(plannerPrompt).toContain('do not repeat the same command back-to-back');
        expect(plannerPrompt).toContain('non-empty `params.command` string');
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

    test('promotes security, design, and database tools into the default execution profile', () => {
        const orchestrator = new ConversationOrchestrator({
            llmClient: {
                createResponse: jest.fn(),
                complete: jest.fn(),
            },
            toolManager: {
                getTool: jest.fn((toolId) => (
                    [
                        'security-scan',
                        'architecture-design',
                        'uml-generate',
                        'api-design',
                        'schema-generate',
                        'migration-create',
                    ].includes(toolId)
                        ? { id: toolId, description: toolId }
                        : null
                )),
            },
        });

        const securityPolicy = orchestrator.buildToolPolicy({
            objective: 'Run a security audit on this code.',
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
        });
        const architecturePolicy = orchestrator.buildToolPolicy({
            objective: 'Design the system architecture for a multi-tenant SaaS app.',
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
        });
        const umlPolicy = orchestrator.buildToolPolicy({
            objective: 'Generate a UML class diagram for these services.',
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
        });
        const apiPolicy = orchestrator.buildToolPolicy({
            objective: 'Create an OpenAPI design for the billing API.',
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
        });
        const schemaPolicy = orchestrator.buildToolPolicy({
            objective: 'Generate a database schema and DDL for orders and invoices.',
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
        });
        const migrationPolicy = orchestrator.buildToolPolicy({
            objective: 'Create a migration for the schema change.',
            executionProfile: 'default',
            toolManager: orchestrator.toolManager,
        });

        expect(securityPolicy.candidateToolIds).toContain('security-scan');
        expect(architecturePolicy.candidateToolIds).toContain('architecture-design');
        expect(umlPolicy.candidateToolIds).toContain('uml-generate');
        expect(apiPolicy.candidateToolIds).toContain('api-design');
        expect(schemaPolicy.candidateToolIds).toContain('schema-generate');
        expect(migrationPolicy.candidateToolIds).toContain('migration-create');
    });
});
