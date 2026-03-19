const { AgentOrchestrator } = require('./AgentOrchestrator');

describe('AgentOrchestrator', () => {
    test('executes a string task input without requiring a vector store', async () => {
        const llmClient = {
            complete: jest.fn()
                .mockResolvedValueOnce(JSON.stringify({
                    complexity: 'low',
                    requiredTools: [],
                    estimatedSteps: 1,
                    challenges: [],
                }))
                .mockResolvedValueOnce('done'),
        };
        const embedder = {
            embed: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
        };

        const orchestrator = new AgentOrchestrator({
            llmClient,
            embedder,
        });

        const result = await orchestrator.execute('Keep this conversation organized.', {
            sessionId: 'session-1',
        });

        expect(result.success).toBe(true);
        expect(result.output).toBe('done');
        expect(result.sessionId).toBe('session-1');
        expect(result.task.objective).toBe('Keep this conversation organized.');
        expect(result.task.type).toBe('chat');
        expect(result.trace).toEqual(expect.objectContaining({
            taskId: result.task.id,
        }));
    });

    test('routes conversation execution through the orchestrator runtime path', async () => {
        const llmClient = {
            createResponse: jest.fn().mockResolvedValue({
                id: 'resp_1',
                model: 'gpt-test',
                output: [
                    {
                        type: 'message',
                        content: [{ text: 'Runtime answer' }],
                    },
                ],
            }),
            complete: jest.fn().mockResolvedValue(JSON.stringify({
                complexity: 'low',
                requiredTools: [],
                estimatedSteps: 1,
                challenges: [],
            })),
        };
        const embedder = {
            embed: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
        };

        const orchestrator = new AgentOrchestrator({
            llmClient,
            embedder,
        });

        const result = await orchestrator.executeConversation({
            sessionId: 'session-2',
            input: 'Keep the same context.',
            recentMessages: [
                { role: 'assistant', content: 'Earlier answer' },
            ],
            instructions: 'Be concise.',
            stream: false,
        });

        expect(result.success).toBe(true);
        expect(result.output).toBe('Runtime answer');
        expect(llmClient.createResponse).toHaveBeenCalledWith(expect.objectContaining({
            input: 'Keep the same context.',
            recentMessages: [
                { role: 'assistant', content: 'Earlier answer' },
            ],
        }));
    });

    test('persists transcript and tool results through orchestrator-owned services', async () => {
        const llmClient = {
            createResponse: jest.fn().mockResolvedValue({
                id: 'resp_2',
                model: 'gpt-test',
                output: [
                    {
                        type: 'message',
                        content: [{ text: 'Here is the result.' }],
                    },
                ],
                metadata: {
                    toolEvents: [
                        {
                            toolCall: {
                                id: 'call_1',
                                function: {
                                    name: 'web-search',
                                    arguments: '{"query":"latest update"}',
                                },
                            },
                            result: {
                                success: true,
                                toolId: 'web-search',
                                data: { results: ['a', 'b'] },
                            },
                        },
                    ],
                },
            }),
            complete: jest.fn().mockResolvedValue(JSON.stringify({
                complexity: 'low',
                requiredTools: [],
                estimatedSteps: 1,
                challenges: [],
            })),
        };
        const embedder = {
            embed: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
        };
        const sessionStore = {
            getRecentMessages: jest.fn().mockResolvedValue([
                { role: 'assistant', content: 'Previous turn' },
            ]),
            recordResponse: jest.fn().mockResolvedValue(undefined),
            appendMessages: jest.fn().mockResolvedValue(undefined),
        };
        const memoryService = {
            recall: jest.fn().mockResolvedValue([
                '[Past assistant message] Earlier context',
            ]),
            rememberResponse: jest.fn().mockResolvedValue(undefined),
            remember: jest.fn().mockResolvedValue(undefined),
        };

        const orchestrator = new AgentOrchestrator({
            llmClient,
            embedder,
            sessionStore,
            memoryService,
        });

        const result = await orchestrator.executeConversation({
            sessionId: 'session-3',
            input: 'Search for the latest update.',
            stream: false,
        });

        expect(result.success).toBe(true);
        expect(memoryService.recall).toHaveBeenCalledWith('Search for the latest update.', {
            sessionId: 'session-3',
        });
        expect(sessionStore.getRecentMessages).toHaveBeenCalledWith('session-3', 12);
        expect(sessionStore.recordResponse).toHaveBeenCalledWith('session-3', 'resp_2');
        expect(sessionStore.appendMessages).toHaveBeenCalledWith('session-3', expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'Search for the latest update.' }),
            expect.objectContaining({ role: 'tool' }),
            expect.objectContaining({ role: 'assistant', content: 'Here is the result.' }),
        ]));
        expect(memoryService.rememberResponse).toHaveBeenCalledWith('session-3', 'Here is the result.');
        expect(memoryService.remember).toHaveBeenCalledWith(
            'session-3',
            'Search for the latest update.',
            'user',
        );
        expect(memoryService.remember).toHaveBeenCalledWith(
            'session-3',
            expect.stringContaining('"tool":"web-search"'),
            'tool',
        );
    });

    test('degrades gracefully when memory and session persistence fail', async () => {
        const llmClient = {
            createResponse: jest.fn().mockResolvedValue({
                id: 'resp_3',
                model: 'gpt-test',
                output: [
                    {
                        type: 'message',
                        content: [{ text: 'Still answered.' }],
                    },
                ],
            }),
            complete: jest.fn().mockResolvedValue(JSON.stringify({
                complexity: 'low',
                requiredTools: [],
                estimatedSteps: 1,
                challenges: [],
            })),
        };
        const embedder = {
            embed: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
        };
        const sessionStore = {
            getRecentMessages: jest.fn().mockRejectedValue(new Error('session offline')),
            recordResponse: jest.fn().mockRejectedValue(new Error('write failed')),
            appendMessages: jest.fn().mockRejectedValue(new Error('append failed')),
        };
        const memoryService = {
            recall: jest.fn().mockRejectedValue(new Error('qdrant offline')),
            rememberResponse: jest.fn().mockRejectedValue(new Error('remember response failed')),
            remember: jest.fn().mockRejectedValue(new Error('remember failed')),
        };

        const orchestrator = new AgentOrchestrator({
            llmClient,
            embedder,
            sessionStore,
            memoryService,
        });

        const result = await orchestrator.executeConversation({
            sessionId: 'session-4',
            input: 'Can you still answer?',
            stream: false,
        });

        expect(result.success).toBe(true);
        expect(result.output).toBe('Still answered.');
        expect(llmClient.createResponse).toHaveBeenCalledWith(expect.objectContaining({
            contextMessages: [],
            recentMessages: [],
        }));
    });
});
