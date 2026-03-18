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
        await expect(store.getRecentMessages(updated)).resolves.toEqual([
            expect.objectContaining({ role: 'user', content: 'first' }),
            expect.objectContaining({ role: 'assistant', content: 'second' }),
        ]);
    });

    test('clears response lineage when the session model changes', async () => {
        const store = new SessionStore();
        store.initialized = true;
        store.usePostgres = false;
        const session = await store.create({ mode: 'chat', model: 'gpt-4o' });

        await store.recordResponse(session.id, 'resp_123');
        await store.appendMessages(session.id, [
            { role: 'user', content: 'use a tool' },
            { role: 'assistant', content: 'tool result' },
        ]);

        const updated = await store.syncModel(session.id, 'claude-sonnet-4');
        const recentMessages = await store.getRecentMessages(updated);

        expect(updated.metadata.model).toBe('claude-sonnet-4');
        expect(updated.previousResponseId).toBeNull();
        expect(recentMessages).toEqual([
            expect.objectContaining({ role: 'user', content: 'use a tool' }),
            expect.objectContaining({ role: 'assistant', content: 'tool result' }),
        ]);
    });
});
