describe('PostgresManager', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    function loadManager({ queryImpl }) {
        const end = jest.fn().mockResolvedValue(undefined);
        const query = jest.fn(queryImpl);

        jest.doMock('pg', () => ({
            Pool: jest.fn(() => ({
                query,
                end,
                on: jest.fn(),
            })),
        }));
        jest.doMock('./config', () => ({
            config: {
                postgres: {
                    url: null,
                    host: 'localhost',
                    port: 5432,
                    database: 'kimibuilt',
                    user: 'kimibuilt',
                    password: 'wrong-password',
                    ssl: false,
                },
            },
        }));

        const { PostgresManager } = require('./postgres');
        return {
            manager: new PostgresManager(),
            query,
            end,
        };
    }

    test('disables persistence and sanitizes password auth failures', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        const authError = new Error('password authentication failed for user "kimibuilt"');
        authError.code = '28P01';
        const { manager, end } = loadManager({
            queryImpl: jest.fn().mockRejectedValue(authError),
        });

        await expect(manager.initialize()).resolves.toBe(false);

        expect(manager.enabled).toBe(false);
        expect(manager.getStatus()).toMatchObject({
            enabled: false,
            initialized: false,
            unavailableReason: 'Postgres password authentication failed for user "kimibuilt"',
        });
        expect(end).toHaveBeenCalledTimes(1);
        await expect(manager.query('SELECT 1')).rejects.toMatchObject({
            message: 'Postgres password authentication failed for user "kimibuilt"',
            statusCode: 503,
        });
    });
});
