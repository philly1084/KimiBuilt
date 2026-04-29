'use strict';

const { config } = require('../config');
const { createAuthToken, isAuthorizedFrontendApiRequest, requireAuth } = require('./service');

describe('auth service OpenCode gateway access', () => {
    const originalAuth = { ...config.auth };
    const originalGatewayApiKey = config.opencode.gatewayApiKey;
    const originalFrontendApiKey = process.env.KIMIBUILT_FRONTEND_API_KEY;

    beforeEach(() => {
        config.auth.username = 'admin';
        config.auth.password = 'secret';
        config.auth.jwtSecret = 'jwt-secret';
        config.auth.cookieName = 'kimibuilt_auth';
        config.auth.tokenTtlSeconds = 3600;
        config.opencode.gatewayApiKey = 'gateway-secret';
        process.env.KIMIBUILT_FRONTEND_API_KEY = 'frontend-secret';
    });

    afterEach(() => {
        Object.assign(config.auth, originalAuth);
        config.opencode.gatewayApiKey = originalGatewayApiKey;
        if (originalFrontendApiKey === undefined) {
            delete process.env.KIMIBUILT_FRONTEND_API_KEY;
        } else {
            process.env.KIMIBUILT_FRONTEND_API_KEY = originalFrontendApiKey;
        }
        jest.clearAllMocks();
    });

    test('allows OpenCode gateway bearer auth on /v1 requests', () => {
        const req = {
            path: '/v1/models',
            method: 'GET',
            headers: {
                authorization: 'Bearer gateway-secret',
            },
            secure: false,
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            redirect: jest.fn(),
        };
        const next = jest.fn();

        requireAuth(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.user).toEqual({
            username: 'opencode',
            role: 'internal-gateway',
        });
        expect(res.status).not.toHaveBeenCalled();
    });

    test('allows OpenCode gateway x-api-key auth on /v1 requests', () => {
        const req = {
            path: '/v1/images/generations',
            method: 'POST',
            headers: {
                'x-api-key': 'gateway-secret',
            },
            secure: false,
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            redirect: jest.fn(),
        };
        const next = jest.fn();

        requireAuth(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.user).toEqual({
            username: 'opencode',
            role: 'internal-gateway',
        });
        expect(res.status).not.toHaveBeenCalled();
    });

    test('allows OpenCode gateway auth on /openai/v1 requests', () => {
        const req = {
            path: '/openai/v1/images/generations',
            method: 'POST',
            headers: {
                'x-api-key': 'gateway-secret',
            },
            secure: false,
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            redirect: jest.fn(),
        };
        const next = jest.fn();

        requireAuth(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.user).toEqual({
            username: 'opencode',
            role: 'internal-gateway',
        });
        expect(res.status).not.toHaveBeenCalled();
    });

    test('does not allow the OpenCode gateway token outside /v1', () => {
        const req = {
            path: '/api/chat',
            method: 'POST',
            headers: {
                authorization: 'Bearer gateway-secret',
            },
            secure: false,
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            redirect: jest.fn(),
        };
        const next = jest.fn();

        requireAuth(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            error: {
                message: 'Authentication required',
                code: expect.any(String),
            },
        });
    });

    test('allows the frontend API token on standard CLI routes', () => {
        const req = {
            path: '/api/sessions',
            method: 'GET',
            headers: {
                authorization: 'Bearer frontend-secret',
            },
            secure: false,
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            redirect: jest.fn(),
        };
        const next = jest.fn();

        requireAuth(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.user).toEqual({
            username: 'frontend-api',
            role: 'frontend-api',
        });
    });

    test('allows the frontend API token on WebSocket upgrade URLs', () => {
        const req = {
            url: '/ws?access_token=frontend-secret',
            method: 'GET',
            headers: {},
            secure: false,
        };

        expect(isAuthorizedFrontendApiRequest(req)).toBe(true);
    });

    test('falls back to the gateway token when no dedicated frontend API key is configured', () => {
        delete process.env.KIMIBUILT_FRONTEND_API_KEY;

        const req = {
            path: '/api/sessions',
            method: 'GET',
            headers: {
                authorization: 'Bearer gateway-secret',
            },
            secure: false,
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            redirect: jest.fn(),
        };
        const next = jest.fn();

        requireAuth(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.user).toEqual({
            username: 'frontend-api',
            role: 'frontend-api',
        });
    });

    test('allows the frontend API token on provider session admin routes', () => {
        const req = {
            path: '/admin/provider-capabilities',
            method: 'GET',
            headers: {
                authorization: 'Bearer frontend-secret',
            },
            secure: false,
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            redirect: jest.fn(),
        };
        const next = jest.fn();

        requireAuth(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.user).toEqual({
            username: 'frontend-api',
            role: 'frontend-api',
        });
    });

    test('allows the frontend API token on remote agent task admin routes', () => {
        const req = {
            path: '/admin/remote-agent-tasks',
            method: 'POST',
            headers: {
                authorization: 'Bearer frontend-secret',
            },
            secure: false,
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            redirect: jest.fn(),
        };
        const next = jest.fn();

        requireAuth(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.user).toEqual({
            username: 'frontend-api',
            role: 'frontend-api',
        });
    });

    test('prefers the signed-in browser user over the frontend API token when both are present', () => {
        const auth = createAuthToken('phill');
        const req = {
            path: '/v1/chat/completions',
            method: 'POST',
            headers: {
                authorization: 'Bearer frontend-secret',
                cookie: `${config.auth.cookieName}=${auth.token}`,
            },
            secure: false,
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            redirect: jest.fn(),
        };
        const next = jest.fn();

        requireAuth(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.user).toMatchObject({
            username: 'phill',
            role: 'admin',
        });
    });

    test('prefers the signed-in browser user over the OpenCode gateway token when both are present', () => {
        const auth = createAuthToken('phill');
        const req = {
            path: '/v1/chat/completions',
            method: 'POST',
            headers: {
                authorization: 'Bearer gateway-secret',
                cookie: `${config.auth.cookieName}=${auth.token}`,
            },
            secure: false,
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            redirect: jest.fn(),
        };
        const next = jest.fn();

        requireAuth(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.user).toMatchObject({
            username: 'phill',
            role: 'admin',
        });
    });
});
