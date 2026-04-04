const { buildWebChatSessionMessages } = require('./web-chat-message-state');

describe('buildWebChatSessionMessages', () => {
    test('assigns strictly increasing timestamps within one exchange', () => {
        const messages = buildWebChatSessionMessages({
            userText: 'Question first',
            assistantText: 'Answer second',
            artifacts: [{
                id: 'artifact-1',
                filename: 'report.pdf',
                format: 'pdf',
            }],
            timestamp: '2026-04-04T15:00:00.000Z',
        });

        expect(messages).toHaveLength(3);
        expect(messages.map((message) => message.role)).toEqual([
            'user',
            'assistant',
            'assistant',
        ]);

        const timestamps = messages.map((message) => new Date(message.timestamp).getTime());
        expect(timestamps[0]).toBeLessThan(timestamps[1]);
        expect(timestamps[1]).toBeLessThan(timestamps[2]);
    });
});
