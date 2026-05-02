'use strict';

const { config } = require('../config');

function normalizeOrigin(value = '') {
    return String(value || '').trim().replace(/\/+$/, '');
}

function buildCorsOptions(securityConfig = config.security) {
    const allowedOrigins = new Set(
        (securityConfig?.allowedOrigins || [])
            .map(normalizeOrigin)
            .filter(Boolean),
    );

    return {
        origin(origin, callback) {
            if (!origin) {
                return callback(null, true);
            }

            const normalizedOrigin = normalizeOrigin(origin);
            if (allowedOrigins.has('*') || allowedOrigins.has(normalizedOrigin)) {
                return callback(null, true);
            }

            const error = new Error('CORS origin denied');
            error.statusCode = 403;
            error.code = 'cors_origin_denied';
            return callback(error);
        },
        credentials: true,
    };
}

function getClientKey(req) {
    return String(
        req.ip
        || req.headers?.['x-forwarded-for']
        || req.socket?.remoteAddress
        || 'unknown',
    ).split(',')[0].trim() || 'unknown';
}

function createRateLimit(options = {}) {
    const windowMs = Math.max(1000, Number(options.windowMs || config.security.rateLimitWindowMs || 60000));
    const max = Math.max(1, Number(options.max || config.security.rateLimitMax || 120));
    const name = String(options.name || 'request').trim() || 'request';
    const skip = typeof options.skip === 'function' ? options.skip : () => false;
    const buckets = new Map();

    return (req, res, next) => {
        if (skip(req)) {
            return next();
        }

        const now = Date.now();
        const key = `${name}:${getClientKey(req)}`;
        const current = buckets.get(key);
        const bucket = current && current.resetAt > now
            ? current
            : { count: 0, resetAt: now + windowMs };

        bucket.count += 1;
        buckets.set(key, bucket);

        const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
        res.setHeader('RateLimit-Limit', String(max));
        res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
        res.setHeader('RateLimit-Reset', String(retryAfterSeconds));

        if (bucket.count > max) {
            res.setHeader('Retry-After', String(retryAfterSeconds));
            return res.status(429).json({
                error: {
                    message: 'Too many requests',
                    code: 'rate_limited',
                },
            });
        }

        return next();
    };
}

function isToolInvokePath(req = {}) {
    const path = String(req.originalUrl || req.url || req.path || '');
    return path === '/api/tools/invoke'
        || path.startsWith('/api/tools/invoke/')
        || path.startsWith('/api/tools/invoke?');
}

module.exports = {
    buildCorsOptions,
    createRateLimit,
    isToolInvokePath,
};
