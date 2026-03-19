const { validateTask } = require('./TaskSchema');

describe('TaskSchema', () => {
    test('accepts integer-typed task fields backed by JavaScript numbers', () => {
        const result = validateTask({
            type: 'chat',
            objective: 'Keep the conversation coherent.',
            context: {
                priority: 5,
            },
            constraints: {
                maxTokens: 4000,
                maxSteps: 10,
            },
            retryPolicy: {
                maxAttempts: 3,
                initialDelay: 1000,
                maxDelay: 60000,
            },
            metadata: {
                attempts: 0,
                tokensUsed: 0,
                executionTime: 0,
            },
        });

        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    test('still rejects floating-point values for integer fields', () => {
        const result = validateTask({
            type: 'chat',
            objective: 'Keep the conversation coherent.',
            context: {
                priority: 5.5,
            },
        });

        expect(result.valid).toBe(false);
        expect(result.errors).toContain('context.priority: expected integer, got float 5.5');
    });
});
