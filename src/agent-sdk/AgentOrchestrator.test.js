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
});
