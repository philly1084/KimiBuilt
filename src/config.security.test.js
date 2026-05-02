'use strict';

function withCleanConfigEnv(overrides, callback) {
    const originalEnv = { ...process.env };
    jest.resetModules();
    process.env = {
        ...originalEnv,
        OPENAI_API_KEY: 'test-key',
        LILLYBUILT_AUTH_USERNAME: '',
        LILLYBUILT_AUTH_PASSWORD: '',
        LILLYBUILT_JWT_SECRET: '',
        KIMIBUILT_AUTH_USERNAME: '',
        KIMIBUILT_AUTH_PASSWORD: '',
        KIMIBUILT_JWT_SECRET: '',
        KIMIBUILT_AUTH_REQUIRED: '',
        KIMIBUILT_ALLOWED_ORIGINS: '',
        CORS_ALLOWED_ORIGINS: '',
        KIMIBUILT_ALLOW_QUERY_TOKENS: '',
        ...overrides,
    };

    try {
        callback(require('./config'));
    } finally {
        process.env = originalEnv;
        jest.resetModules();
    }
}

describe('security config', () => {
    test('production requires complete auth configuration by default', () => {
        withCleanConfigEnv({ NODE_ENV: 'production' }, ({ validate }) => {
            expect(() => validate()).toThrow(/auth is required/i);
        });
    });

    test('development permits open mode when auth is unset', () => {
        withCleanConfigEnv({ NODE_ENV: 'development' }, ({ validate, config }) => {
            expect(config.security.authRequired).toBe(false);
            expect(() => validate()).not.toThrow();
        });
    });

    test('parses security allowlists and query-token policy from env', () => {
        withCleanConfigEnv({
            NODE_ENV: 'production',
            LILLYBUILT_AUTH_USERNAME: 'admin',
            LILLYBUILT_AUTH_PASSWORD: 'secret',
            LILLYBUILT_JWT_SECRET: 'jwt-secret',
            KIMIBUILT_ALLOWED_ORIGINS: 'https://one.example, https://two.example/',
            KIMIBUILT_ALLOW_QUERY_TOKENS: 'true',
        }, ({ config }) => {
            expect(config.security.allowedOrigins).toEqual([
                'https://one.example',
                'https://two.example/',
            ]);
            expect(config.security.allowQueryTokens).toBe(true);
        });
    });
});
