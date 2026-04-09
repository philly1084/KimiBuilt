const {
    isPublicChatModel,
    toPublicChatModelList,
} = require('./model-catalog');

describe('model-catalog', () => {
    test('keeps router-provided chat models even when the family is not hardcoded', () => {
        expect(isPublicChatModel('my-router/smart-chat-v2')).toBe(true);
        expect(toPublicChatModelList([
            { id: 'my-router/smart-chat-v2', owned_by: 'custom-router' },
        ])).toEqual([
            expect.objectContaining({
                id: 'my-router/smart-chat-v2',
                owned_by: 'custom-router',
            }),
        ]);
    });

    test('filters obvious non-chat models from the router list', () => {
        expect(toPublicChatModelList([
            { id: 'gpt-4o', owned_by: 'openai' },
            { id: 'text-embedding-3-large', owned_by: 'openai' },
            { id: 'gpt-image-1', owned_by: 'openai' },
            { id: 'whisper-1', owned_by: 'openai' },
            { id: 'omni-moderation-latest', owned_by: 'openai' },
        ])).toEqual([
            expect.objectContaining({
                id: 'gpt-4o',
            }),
        ]);
    });

    test('deduplicates repeated model ids from the provider list', () => {
        expect(toPublicChatModelList([
            { id: 'gpt-4o', owned_by: 'openai' },
            { id: 'gpt-4o', owned_by: 'openai' },
        ])).toHaveLength(1);
    });
});
