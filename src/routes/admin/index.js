/**
 * Admin Dashboard API Routes
 * RESTful API for the Agent SDK Dashboard
 */

const express = require('express');
const router = express.Router();

// Controllers
const promptsController = require('./prompts.controller');
const modelsController = require('./models.controller');
const logsController = require('./logs.controller');
const skillsController = require('./skills.controller');
const tracesController = require('./traces.controller');
const settingsController = require('./settings.controller');

// Dashboard controller is initialized with orchestrator in server.js
const getDashboardController = (req) => req.app.locals.dashboardController;

// API Routes

// Dashboard Overview
router.get('/stats', (req, res) => getDashboardController(req).getStats(req, res));
router.get('/health', (req, res) => getDashboardController(req).getHealth(req, res));
router.get('/activity', (req, res) => getDashboardController(req).getRecentActivity(req, res));

// Prompts Management
router.get('/prompts', promptsController.getAll);
router.get('/prompts/:id', promptsController.getById);
router.post('/prompts', promptsController.create);
router.put('/prompts/:id', promptsController.update);
router.delete('/prompts/:id', promptsController.remove);
router.post('/prompts/:id/test', promptsController.test);

// Models Configuration
router.get('/models', modelsController.getAll);
router.get('/models/:id', modelsController.getById);
router.put('/models/:id', modelsController.update);
router.post('/models/:id/activate', modelsController.activate);
router.get('/models/usage/stats', modelsController.getUsageStats);

// Logs
router.get('/logs', logsController.getAll);
router.get('/logs/stream', logsController.stream);
router.get('/logs/:id', logsController.getById);
router.post('/logs/clear', logsController.clear);
router.get('/logs/export/:format', logsController.export);

// Skills
router.get('/skills', skillsController.getAll);
router.get('/skills/:id', skillsController.getById);
router.put('/skills/:id', skillsController.update);
router.post('/skills/:id/enable', skillsController.enable);
router.post('/skills/:id/disable', skillsController.disable);
router.delete('/skills/:id', skillsController.remove);
router.get('/skills/search/query', skillsController.search);

// Traces
router.get('/traces', tracesController.getAll);
router.get('/traces/:id', tracesController.getById);
router.get('/traces/:id/timeline', tracesController.getTimeline);
router.delete('/traces/:id', tracesController.remove);
router.get('/traces/export/:format', tracesController.export);

// Settings
router.get('/settings', settingsController.getAll);
router.put('/settings', settingsController.update);
router.post('/settings/reset', settingsController.reset);
router.post('/settings/clear-cache', settingsController.clearCache);

// SDK Control
router.post('/sdk/execute', (req, res) => getDashboardController(req).executeTask(req, res));
router.post('/sdk/cancel/:taskId', (req, res) => getDashboardController(req).cancelTask(req, res));
router.get('/sdk/sessions', (req, res) => getDashboardController(req).getActiveSessions(req, res));
router.get('/sdk/session/:id', (req, res) => getDashboardController(req).getSessionDetails(req, res));
router.post('/sdk/session/:id/clear', (req, res) => getDashboardController(req).clearSession(req, res));

module.exports = router;
