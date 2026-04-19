'use strict';

const { Router } = require('express');
const settingsController = require('./admin/settings.controller');

const router = Router();

router.post('/build-events', async (req, res, next) => {
    try {
        const service = req.app.locals.managedAppService;
        if (!service?.isAvailable()) {
            return res.status(503).json({
                success: false,
                error: 'Managed app control plane is unavailable',
            });
        }

        const giteaConfig = typeof settingsController.getEffectiveGiteaConfig === 'function'
            ? settingsController.getEffectiveGiteaConfig()
            : {};
        const expectedSecret = String(giteaConfig.webhookSecret || '').trim();
        const providedSecret = String(
            req.get('x-kimibuilt-webhook-secret')
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
