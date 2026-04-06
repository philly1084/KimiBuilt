'use strict';

const crypto = require('crypto');

const { config } = require('../config');
const settingsController = require('../routes/admin/settings.controller');

function resolveLoopbackApiBaseURL() {
    return `http://127.0.0.1:${config.port || 3000}`;
}

function normalizeBaseURL(value = '', fallback = '') {
    const candidate = String(value || '').trim();
    if (!candidate) {
        return String(fallback || '').trim();
    }

    try {
        const parsed = new URL(candidate);
        parsed.pathname = String(parsed.pathname || '').replace(/\/+$/, '');
        return parsed.toString().replace(/\/+$/, '');
    } catch (_error) {
        return String(fallback || '').trim();
    }
}

function isLoopbackBaseURL(value = '') {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return true;
    }

    try {
        const parsed = new URL(normalized);
        return ['127.0.0.1', 'localhost', '0.0.0.0'].includes(String(parsed.hostname || '').trim().toLowerCase());
    } catch (_error) {
        return /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(normalized);
    }
}

function resolveConfiguredApiBaseURL() {
    const settingsBaseURL = String(settingsController?.settings?.api?.baseURL || '').trim();
    return normalizeBaseURL(settingsBaseURL || process.env.API_BASE_URL || '', resolveLoopbackApiBaseURL());
}

function resolveOpenCodeGatewayApiBaseURL({ target = 'local' } = {}) {
    if (String(target || '').trim().toLowerCase() === 'local') {
        return resolveLoopbackApiBaseURL();
    }

    return resolveConfiguredApiBaseURL();
}

function resolveOpenCodeGatewayBaseURL({ target = 'local' } = {}) {
    const apiBaseURL = resolveOpenCodeGatewayApiBaseURL({ target });
    return `${String(apiBaseURL || '').replace(/\/+$/, '')}/v1`;
}

function assertRemoteGatewayBaseURLReachable() {
    const apiBaseURL = resolveOpenCodeGatewayApiBaseURL({ target: 'remote-default' });
    if (isLoopbackBaseURL(apiBaseURL)) {
        const error = new Error('Remote OpenCode runs require API_BASE_URL or dashboard api.baseURL to point at a non-local KimiBuilt host');
        error.statusCode = 503;
        throw error;
    }

    return apiBaseURL;
}

function resolveOpenCodeGatewayApiKey() {
    const explicit = String(config.opencode.gatewayApiKey || process.env.OPENCODE_GATEWAY_API_KEY || '').trim();
    if (explicit) {
        return explicit;
    }

    const seed = [
        'kimibuilt-opencode-gateway',
        config.auth.jwtSecret,
        config.openai.apiKey,
        config.openai.baseURL,
    ].filter(Boolean).join('|');

    if (!seed) {
        return '';
    }

    return crypto.createHash('sha256').update(seed).digest('hex');
}

function safeCompare(left = '', right = '') {
    const leftBuffer = Buffer.from(String(left || ''));
    const rightBuffer = Buffer.from(String(right || ''));
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function readGatewayToken(req = {}) {
    const authHeader = String(req.headers?.authorization || '').trim();
    if (/^bearer\s+/i.test(authHeader)) {
        return authHeader.replace(/^bearer\s+/i, '').trim();
    }

    return String(req.headers?.['x-api-key'] || '').trim();
}

function isAuthorizedOpenCodeGatewayRequest(req = {}) {
    const expected = resolveOpenCodeGatewayApiKey();
    const provided = readGatewayToken(req);
    if (!expected || !provided) {
        return false;
    }

    return safeCompare(provided, expected);
}

module.exports = {
    assertRemoteGatewayBaseURLReachable,
    isAuthorizedOpenCodeGatewayRequest,
    isLoopbackBaseURL,
    normalizeBaseURL,
    resolveConfiguredApiBaseURL,
    resolveLoopbackApiBaseURL,
    resolveOpenCodeGatewayApiBaseURL,
    resolveOpenCodeGatewayApiKey,
    resolveOpenCodeGatewayBaseURL,
};
