const fs = require('fs/promises');
const os = require('os');
const path = require('path');

describe('SessionStore Postgres fallback', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    function loadStoreWithFailingPostgres() {
        const unavailable = new Error('Postgres password authentication failed for user "kimibuilt"');
        unavailable.statusCode = 503;

        const postgres = {
            enabled: true,
            initialize: jest.fn().mockResolvedValue(true),
            query: jest.fn(async () => {
                postgres.enabled = false;
                throw unavailable;
            }),
            healthCheck: jest.fn().mockResolvedValue(false),
        };

        jest.doMock('./postgres', () => ({ postgres }));

        const { SessionStore } = require('./session-store');
        return {
            postgres,
            store: new SessionStore(),
        };
    }

    test('switches to file-backed sessions when configured Postgres becomes unavailable', async () => {
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kimibuilt-session-pg-fallback-'));
        const { postgres, store } = loadStoreWithFailingPostgres();
        store.fallbackStoragePath = path.join(tempDir, 'sessions.json');

        const session = await store.create({ mode: 'chat', ownerId: 'phill' }, 'session-1');
        await store.appendMessages(session.id, [
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi' },
        ]);
        const recorded = await store.recordResponse(session.id, 'resp_1');

        expect(postgres.initialize).toHaveBeenCalledTimes(1);
        expect(store.isPersistent()).toBe(false);
        expect(recorded).toEqual(expect.objectContaining({
            id: 'session-1',
            previousResponseId: 'resp_1',
            messageCount: 1,
        }));
        await expect(store.listMessages(session.id, 10, 'phill')).resolves.toEqual([
            expect.objectContaining({ role: 'user', content: 'hello' }),
            expect.objectContaining({ role: 'assistant', content: 'hi' }),
        ]);
        await expect(fs.readFile(store.fallbackStoragePath, 'utf8')).resolves.toContain('session-1');
    });
});
