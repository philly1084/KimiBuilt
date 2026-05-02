const {
    extractUsageMetadataFromTrace,
} = require('./token-usage');

describe('token usage utilities', () => {
    test('aggregates usage from both model_call and llm-call trace entries', () => {
        const usage = extractUsageMetadataFromTrace([
            {
                type: 'model_call',
                details: {
                    usage: {
                        input_tokens: 10,
                        output_tokens: 5,
                        total_tokens: 15,
                    },
                },
            },
            {
                type: 'llm-call',
                metadata: {
                    tokens: {
                        input: 7,
                        output: 3,
                    },
                },
            },
            {
                type: 'tool-call',
                metadata: {
                    tokens: {
                        input: 999,
                        output: 999,
                    },
                },
            },
        ]);

        expect(usage).toEqual({
            promptTokens: 17,
            inputTokens: 17,
            completionTokens: 8,
            outputTokens: 8,
            totalTokens: 25,
        });
    });
});
