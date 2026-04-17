'use strict';

const { cancelForegroundTurn } = require('./foreground-turn-state');

describe('foreground-turn-state', () => {
    test('marks a cancelled foreground turn as settled and transcript-safe when no partial output exists', async () => {
        const sessionStore = {
            upsertMessage: jest.fn().mockResolvedValue(null),
            updateControlState: jest.fn().mockResolvedValue(null),
            get: jest.fn().mockResolvedValue({ id: 'session-1' }),
        };

        await cancelForegroundTurn(sessionStore, 'session-1', {
            requestId: 'request-1',
            userMessageId: 'user-1',
            assistantMessageId: 'assistant-1',
            clientSurface: 'web-chat',
            taskType: 'chat',
            status: 'running',
            userTimestamp: '2026-04-16T10:00:00.000Z',
            assistantTimestamp: '2026-04-16T10:00:00.001Z',
        });

        expect(sessionStore.upsertMessage).toHaveBeenCalledWith('session-1', expect.objectContaining({
            id: 'assistant-1',
            role: 'assistant',
            content: 'Stopped.',
            metadata: expect.objectContaining({
                cancelled: true,
                pendingForeground: false,
                excludeFromTranscript: true,
                stopReason: 'user_cancelled',
            }),
        }));
        expect(sessionStore.updateControlState).toHaveBeenCalledWith('session-1', {
            foregroundTurn: null,
        });
    });
});
