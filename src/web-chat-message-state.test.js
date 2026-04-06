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

    test('stores checkpoint fallback display content as a bare survey fence without duplicated prose', () => {
        const messages = buildWebChatSessionMessages({
            userText: 'Please redesign the page.',
            assistantText: 'I need one decision before I continue.',
            toolEvents: [{
                toolCall: {
                    function: {
                        name: 'user-checkpoint',
                        arguments: JSON.stringify({
                            title: 'Choose a direction',
                            question: 'What visual and functional style should the new HTML follow?',
                        }),
                    },
                },
                result: {
                    success: true,
                    toolId: 'user-checkpoint',
                    data: {
                        checkpoint: {
                            id: 'checkpoint-redesign-style',
                            title: 'Choose a direction',
                            question: 'What visual and functional style should the new HTML follow?',
                            preamble: 'I need one decision before I continue with the main work.',
                            options: [
                                { id: 'minimal-modern', label: 'Minimal Modern' },
                                { id: 'bold-tech', label: 'Bold Tech' },
                            ],
                        },
                    },
                },
            }],
            timestamp: '2026-04-05T12:00:00.000Z',
        });

        expect(messages[1].metadata.displayContent.trim().startsWith('```survey')).toBe(true);
        expect(messages[1].metadata.displayContent).toContain('"question": "What visual and functional style should the new HTML follow?"');
        expect(messages[1].metadata.displayContent).not.toContain('Choose an option below and I will continue from there.');
    });

    test('preserves frontend-safe assistant metadata for agent replies', () => {
        const messages = buildWebChatSessionMessages({
            userText: 'Sketch the system layout.',
            assistantText: '### Architecture\n\n- Gateway\n- Services',
            assistantMetadata: {
                agentExecutor: true,
                taskType: 'chat',
                displayContent: '```survey\n{"id":"checkpoint-1","question":"Pick one.","options":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}\n```',
                trace: { steps: 4 },
            },
            timestamp: '2026-04-05T12:30:00.000Z',
        });

        expect(messages[1].metadata).toEqual(expect.objectContaining({
            agentExecutor: true,
            taskType: 'chat',
            displayContent: expect.stringContaining('```survey'),
        }));
        expect(messages[1].metadata.trace).toBeUndefined();
    });
});
