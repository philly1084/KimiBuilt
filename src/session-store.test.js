const { SessionStore } = require('./session-store');

describe('SessionStore recent message continuity', () => {
    test('does not inject a default business agent into new sessions', async () => {
        const store = new SessionStore();
        store.initialized = true;
        store.usePostgres = false;
        const session = await store.create({ mode: 'chat' });

        expect(session.metadata.agent).toBeUndefined();
    });

    test('appends and trims recent session messages', async () => {
        const store = new SessionStore();
        store.initialized = true;
        store.usePostgres = false;
        const session = await store.create({ mode: 'chat' });

        await store.appendMessages(session.id, [
            { role: 'user', content: 'first' },
            { role: 'assistant', content: 'second' },
        ]);

        const updated = await store.get(session.id);
        expect(store.getRecentMessages(updated)).toEqual([
            expect.objectContaining({ role: 'user', content: 'first' }),
            expect.objectContaining({ role: 'assistant', content: 'second' }),
        ]);
    });
});
