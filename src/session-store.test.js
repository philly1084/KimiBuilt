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

    test('getOrCreateOwned persists owner metadata for new sessions', async () => {
        const store = new SessionStore();
        store.initialized = true;
        store.usePostgres = false;

        const session = await store.getOrCreateOwned('session-owned', { mode: 'chat' }, 'phill');

        expect(session.id).toBe('session-owned');
        expect(session.metadata.ownerId).toBe('phill');
        expect(session.metadata.ownerType).toBe('user');
    });

    test('getOwned claims an unowned legacy session for the requesting owner', async () => {
        const store = new SessionStore();
        store.initialized = true;
        store.usePostgres = false;
        await store.create({ mode: 'chat' }, 'legacy-session');

        const session = await store.getOwned('legacy-session', 'phill');

        expect(session.metadata.ownerId).toBe('phill');
        expect((await store.get('legacy-session')).metadata.ownerId).toBe('phill');
    });

    test('list filters sessions by owner while preserving visible legacy sessions', async () => {
        const store = new SessionStore();
        store.initialized = true;
        store.usePostgres = false;

        await store.create({ mode: 'chat', ownerId: 'phill' }, 'owned-a');
        await store.create({ mode: 'chat', ownerId: 'other-user' }, 'owned-b');
        await store.create({ mode: 'chat' }, 'legacy');

        const sessions = await store.list({ ownerId: 'phill' });
        const ids = sessions.map((session) => session.id);

        expect(ids).toEqual(expect.arrayContaining(['owned-a', 'legacy']));
        expect(ids).not.toContain('owned-b');
    });
});
