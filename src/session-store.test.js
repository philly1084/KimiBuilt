const { SessionStore } = require('./session-store');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

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

    test('strips null bytes from recent messages before persistence', async () => {
        const store = new SessionStore();
        store.initialized = true;
        store.usePostgres = false;
        const session = await store.create({ mode: 'chat' });

        await store.appendMessages(session.id, [
            { role: 'assistant', content: 'Hello\u0000 world' },
        ]);

        const updated = await store.get(session.id);
        await expect(store.getRecentMessages(updated)).resolves.toEqual([
            expect.objectContaining({ role: 'assistant', content: 'Hello world' }),
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

    test('listMessages returns the full persisted transcript, not just the recent continuity window', async () => {
        const store = new SessionStore();
        store.initialized = true;
        store.usePostgres = false;
        const session = await store.create({ mode: 'chat' });

        const transcript = Array.from({ length: 30 }, (_, index) => ({
            role: index % 2 === 0 ? 'user' : 'assistant',
            content: `message-${index + 1}`,
            timestamp: new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString(),
        }));

        await store.appendMessages(session.id, transcript);

        const listed = await store.listMessages(session.id, 100);
        const recent = await store.getRecentMessages(session.id);

        expect(listed).toHaveLength(30);
        expect(listed[0]).toEqual(expect.objectContaining({ content: 'message-1' }));
        expect(listed[29]).toEqual(expect.objectContaining({ content: 'message-30' }));
        expect(recent).toHaveLength(24);
        expect(recent[0]).toEqual(expect.objectContaining({ content: 'message-7' }));
    });

    test('preserves long html content in transcript persistence while trimming only recent continuity', async () => {
        const store = new SessionStore();
        store.initialized = true;
        store.usePostgres = false;
        const session = await store.create({ mode: 'chat' });
        const html = `<html><body>${'A'.repeat(6000)}</body></html>`;

        await store.appendMessages(session.id, [
            { role: 'assistant', content: html },
        ]);

        const listed = await store.listMessages(session.id, 10);
        const recent = await store.getRecentMessages(session.id, 10);

        expect(listed[0].content).toBe(html);
        expect(recent[0].content.length).toBeLessThan(html.length);
        expect(recent[0].content).toContain('[truncated');
    });

    test('persists fallback sessions and messages to disk across store instances', async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kimibuilt-session-store-'));
        const storagePath = path.join(tempDir, 'sessions.json');

        try {
            const store = new SessionStore();
            store.initialized = true;
            store.usePostgres = false;
            store.fallbackStoragePath = storagePath;
            store.fallbackLoaded = true;

            const session = await store.create({ mode: 'chat' }, 'persisted-session');
            await store.appendMessages(session.id, [
                { role: 'user', content: 'Build me a page' },
                { role: 'assistant', content: '<!DOCTYPE html><html><body>Saved</body></html>' },
            ]);
            await store.recordResponse(session.id, 'resp_123');

            const reloaded = new SessionStore();
            reloaded.fallbackStoragePath = storagePath;
            await reloaded.initialize();

            const loadedSession = await reloaded.get('persisted-session');
            const loadedMessages = await reloaded.listMessages('persisted-session', 10);

            expect(loadedSession).toEqual(expect.objectContaining({
                id: 'persisted-session',
                previousResponseId: 'resp_123',
            }));
            expect(loadedMessages).toHaveLength(2);
            expect(loadedMessages[1]).toEqual(expect.objectContaining({
                content: '<!DOCTYPE html><html><body>Saved</body></html>',
            }));
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });
});
