const crypto = require('crypto');
const { config } = require('../config');

function base64UrlEncode(input) {
    return Buffer.from(input)
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function base64UrlDecode(input) {
    const normalized = String(input || '')
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    const padded = normalized + '==='.slice((normalized.length + 3) % 4);
    return Buffer.from(padded, 'base64').toString('utf8');
}

function signJwt(payload, secret) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = crypto
        .createHmac('sha256', secret)
        .update(`${encodedHeader}.${encodedPayload}`)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

    return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyJwt(token, secret) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) {
        throw new Error('Invalid token format');
    }

    const [encodedHeader, encodedPayload, signature] = parts;
    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(`${encodedHeader}.${encodedPayload}`)
        .digest();
    const providedSignature = Buffer.from(
        signature.replace(/-/g, '+').replace(/_/g, '/').padEnd(signature.length + ((4 - signature.length % 4) % 4), '='),
        'base64',
    );

    if (
        providedSignature.length !== expectedSignature.length
        || !crypto.timingSafeEqual(providedSignature, expectedSignature)
    ) {
        throw new Error('Invalid token signature');
    }

    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (payload.exp && Date.now() >= payload.exp * 1000) {
        throw new Error('Token expired');
    }

    return payload;
}

function parseCookies(cookieHeader = '') {
    return String(cookieHeader || '')
        .split(';')
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .reduce((acc, chunk) => {
            const separator = chunk.indexOf('=');
            if (separator === -1) {
                return acc;
            }
            const key = decodeURIComponent(chunk.slice(0, separator).trim());
            const value = decodeURIComponent(chunk.slice(separator + 1).trim());
            acc[key] = value;
            return acc;
        }, {});
}

function serializeCookie(name, value, options = {}) {
    const parts = [`${name}=${encodeURIComponent(value)}`];

    if (options.maxAge != null) {
        parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
    }
    if (options.path) {
        parts.push(`Path=${options.path}`);
    }
    if (options.httpOnly) {
        parts.push('HttpOnly');
    }
    if (options.sameSite) {
        parts.push(`SameSite=${options.sameSite}`);
    }
    if (options.secure) {
        parts.push('Secure');
    }

    return parts.join('; ');
}

function isAuthEnabled() {
    return Boolean(
        config.auth.username
        && config.auth.password
        && config.auth.jwtSecret,
    );
}

function safeEqualString(left, right) {
    const leftBuffer = Buffer.from(String(left || ''));
    const rightBuffer = Buffer.from(String(right || ''));
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function getSafeReturnTo(value = '/') {
    const normalized = String(value || '/').trim();
    if (!normalized.startsWith('/') || normalized.startsWith('//') || normalized.startsWith('/login')) {
        return '/';
    }
    return normalized;
}

function createAuthToken(username) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + config.auth.tokenTtlSeconds;

    return {
        token: signJwt({
            sub: username,
            role: 'admin',
            iat: issuedAt,
            exp: expiresAt,
        }, config.auth.jwtSecret),
        expiresAt,
    };
}

function getTokenFromRequest(req) {
    const cookies = parseCookies(req.headers.cookie || '');
    const cookieToken = cookies[config.auth.cookieName];
    if (cookieToken) {
        return cookieToken;
    }

    const authHeader = req.headers.authorization || '';
    if (authHeader.toLowerCase().startsWith('bearer ')) {
        return authHeader.slice(7).trim();
    }

    return '';
}

function getAuthenticatedUser(req) {
    if (!isAuthEnabled()) {
        return { authenticated: true, user: { username: 'anonymous', role: 'open' } };
    }

    const token = getTokenFromRequest(req);
    if (!token) {
        return { authenticated: false, reason: 'missing_token' };
    }

    try {
        const payload = verifyJwt(token, config.auth.jwtSecret);
        return {
            authenticated: true,
            user: {
                username: payload.sub,
                role: payload.role || 'admin',
                exp: payload.exp,
            },
        };
    } catch (error) {
        return { authenticated: false, reason: error.message };
    }
}

function getAuthCookieOptions(req) {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const secure = config.nodeEnv === 'production' || forwardedProto === 'https' || req.secure;

    return {
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
        secure,
        maxAge: config.auth.tokenTtlSeconds,
    };
}

function setAuthCookie(res, token, req) {
    res.setHeader('Set-Cookie', serializeCookie(config.auth.cookieName, token, getAuthCookieOptions(req)));
}

function clearAuthCookie(res, req) {
    res.setHeader('Set-Cookie', serializeCookie(config.auth.cookieName, '', {
        ...getAuthCookieOptions(req),
        maxAge: 0,
    }));
}

function isApiRequest(req) {
    return req.path.startsWith('/api/') || req.path.startsWith('/v1/') || req.path === '/ws';
}

function requireAuth(req, res, next) {
    if (!isAuthEnabled()) {
        req.user = { username: 'anonymous', role: 'open' };
        return next();
    }

    const authState = getAuthenticatedUser(req);
    if (authState.authenticated) {
        req.user = authState.user;
        return next();
    }

    if (isApiRequest(req) || req.accepts(['json', 'html']) === 'json' || req.xhr) {
        return res.status(401).json({
            error: {
                message: 'Authentication required',
                code: authState.reason || 'unauthorized',
            },
        });
    }

    const returnTo = encodeURIComponent(getSafeReturnTo(req.originalUrl || req.url || '/'));
    return res.redirect(`/login?returnTo=${returnTo}`);
}

module.exports = {
    clearAuthCookie,
    createAuthToken,
    getAuthenticatedUser,
    getSafeReturnTo,
    isAuthEnabled,
    parseCookies,
    requireAuth,
    safeEqualString,
    setAuthCookie,
};
