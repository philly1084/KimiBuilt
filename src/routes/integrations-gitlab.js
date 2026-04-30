'use strict';

const { Router } = require('express');
const settingsController = require('./admin/settings.controller');

const router = Router();

function getExpectedSecret() {
    if (typeof settingsController.getEffectiveGitProviderConfig === 'function') {
        return String(settingsController.getEffectiveGitProviderConfig().webhookSecret || '').trim();
    }
    if (typeof settingsController.getEffectiveGitLabConfig === 'function') {
        return String(settingsController.getEffectiveGitLabConfig().webhookSecret || '').trim();
    }
    if (typeof settingsController.getEffectiveGiteaConfig === 'function') {
        return String(settingsController.getEffectiveGiteaConfig().webhookSecret || '').trim();
    }
    return '';
}

router.post('/build-events', async (req, res, next) => {
    try {
        const service = req.app.locals.managedAppService;
        if (!service?.isAvailable()) {
            return res.status(503).json({
                success: false,
                error: 'Managed app control plane is unavailable',
            });
        }

        const expectedSecret = getExpectedSecret();
        const providedSecret = String(
            req.get('x-kimibuilt-webhook-secret')
            || req.get('x-gitlab-token')
            || req.get('x-gitea-webhook-secret')
            || '',
        ).trim();

        if (!expectedSecret || providedSecret !== expectedSecret) {
            return res.status(401).json({
                success: false,
                error: 'Invalid build event secret',
            });
        }

        const result = await service.handleBuildEvent(req.body || {});
        res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
