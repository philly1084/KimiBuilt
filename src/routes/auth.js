const express = require('express');
const {
    clearAuthCookie,
    createAuthToken,
    getAuthenticatedUser,
    getSafeReturnTo,
    isAuthEnabled,
    requireAuth,
    safeEqualString,
    setAuthCookie,
} = require('../auth/service');
const { config } = require('../config');

const router = express.Router();

router.get('/session', (req, res) => {
    const state = getAuthenticatedUser(req);
    res.json({
        enabled: isAuthEnabled(),
        authenticated: Boolean(state.authenticated),
        user: state.authenticated ? state.user : null,
    });
});

router.post('/login', (req, res) => {
    if (!isAuthEnabled()) {
        return res.status(400).json({
            error: {
                message: 'Authentication is not enabled on this server',
            },
        });
    }

    const { username = '', password = '', returnTo = '/' } = req.body || {};
    const validUsername = safeEqualString(username, config.auth.username);
    const validPassword = safeEqualString(password, config.auth.password);

    if (!validUsername || !validPassword) {
        return res.status(401).json({
            error: {
                message: 'Invalid username or password',
            },
        });
    }

    const { token, expiresAt } = createAuthToken(config.auth.username);
    setAuthCookie(res, token, req);

    return res.json({
        success: true,
        user: {
            username: config.auth.username,
            role: 'admin',
        },
        expiresAt,
        returnTo: getSafeReturnTo(returnTo),
    });
});

router.post('/logout', (req, res) => {
    clearAuthCookie(res, req);
    res.json({ success: true });
});

router.get('/protected-check', requireAuth, (req, res) => {
    res.json({
        success: true,
        user: req.user,
    });
});

module.exports = router;
