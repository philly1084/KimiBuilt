'use strict';

const {
    abortForegroundRequest,
    clearForegroundRequest,
    getForegroundRequest,
    registerForegroundRequest,
} = require('./foreground-request-registry');

describe('foreground-request-registry', () => {
    afterEach(() => {
        const entry = getForegroundRequest({ sessionId: 'session-1' });
        if (entry) {
            entry.dispose();
        }

        clearForegroundRequest({ sessionId: 'session-1' });
        clearForegroundRequest({ requestId: 'request-1' });
    });

    test('registers, aborts, and clears a foreground request', () => {
        const entry = registerForegroundRequest({
            sessionId: 'session-1',
            requestId: 'request-1',
            ownerId: 'phill',
            clientSurface: 'web-chat',
            taskType: 'chat',
            assistantMessageId: 'assistant-1',
        });

        expect(entry).toEqual(expect.objectContaining({
            sessionId: 'session-1',
            requestId: 'request-1',
            ownerId: 'phill',
            clientSurface: 'web-chat',
            taskType: 'chat',
            assistantMessageId: 'assistant-1',
        }));
        expect(getForegroundRequest({ sessionId: 'session-1' })).toBe(entry);
        expect(getForegroundRequest({ requestId: 'request-1' })).toBe(entry);

        const abortResult = abortForegroundRequest({
            sessionId: 'session-1',
            requestId: 'request-1',
            ownerId: 'phill',
            reason: 'user_cancelled',
        });

        expect(abortResult).toEqual(expect.objectContaining({
            cancelled: true,
            active: true,
            requestId: 'request-1',
            sessionId: 'session-1',
            reason: 'user_cancelled',
        }));
        expect(entry.signal.aborted).toBe(true);

        expect(clearForegroundRequest({ requestId: 'request-1' })).toBe(true);
        expect(getForegroundRequest({ sessionId: 'session-1' })).toBeNull();
        expect(getForegroundRequest({ requestId: 'request-1' })).toBeNull();
    });
});
