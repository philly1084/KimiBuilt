'use strict';

const { config } = require('../config');
const { requireAuth } = require('./service');

describe('auth service OpenCode gateway access', () => {
    const originalAuth = { ...config.auth };
    const originalGatewayApiKey = config.opencode.gatewayApiKey;

    beforeEach(() => {
        config.auth.username = 'admin';
        config.auth.password = 'secret';
        config.auth.jwtSecret = 'jwt-secret';
        config.auth.cookieName = 'kimibuilt_auth';
        config.auth.tokenTtlSeconds = 3600;
        config.opencode.gatewayApiKey = 'gateway-secret';
    });

    afterEach(() => {
        Object.assign(config.auth, originalAuth);
        config.opencode.gatewayApiKey = originalGatewayApiKey;
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
});
