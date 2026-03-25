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

    test('keeps remote website replacement on remote-command when project memory includes internal artifact downloads', () => {
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
        expect(toolPolicy.candidateToolIds).not.toContain('web-fetch');
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
