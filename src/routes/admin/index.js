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
const callController = (controller, method) => (req, res, next) =>
  controller[method](req, res, next);

// API Routes

// Dashboard Overview
router.get('/stats', (req, res) => getDashboardController(req).getStats(req, res));
router.get('/health', (req, res) => getDashboardController(req).getHealth(req, res));
router.get('/activity', (req, res) => getDashboardController(req).getRecentActivity(req, res));

// Prompts Management
router.get('/prompts', callController(promptsController, 'getAll'));
router.get('/prompts/:id', callController(promptsController, 'getById'));
router.get('/prompts/:id/history', callController(promptsController, 'getHistory'));
router.post('/prompts', callController(promptsController, 'create'));
router.put('/prompts/:id', callController(promptsController, 'update'));
router.delete('/prompts/:id', callController(promptsController, 'remove'));
router.post('/prompts/:id/test', callController(promptsController, 'test'));

// Models Configuration
router.get('/models', callController(modelsController, 'getAll'));
router.get('/models/:id', callController(modelsController, 'getById'));
router.put('/models/:id', callController(modelsController, 'update'));
router.post('/models/:id/activate', callController(modelsController, 'activate'));
router.get('/models/usage/stats', callController(modelsController, 'getUsageStats'));

// Logs
router.get('/logs', callController(logsController, 'getAll'));
router.get('/logs/stream', callController(logsController, 'stream'));
router.get('/logs/:id', callController(logsController, 'getById'));
router.post('/logs/clear', callController(logsController, 'clear'));
router.get('/logs/export/:format', callController(logsController, 'export'));

// Skills
router.get('/skills', callController(skillsController, 'getAll'));
router.get('/skills/categories/list', callController(skillsController, 'getCategories'));
router.get('/skills/stats/overview', callController(skillsController, 'getStats'));
router.get('/skills/:id', callController(skillsController, 'getById'));
router.put('/skills/:id', callController(skillsController, 'update'));
router.post('/skills/:id/enable', callController(skillsController, 'enable'));
router.post('/skills/:id/disable', callController(skillsController, 'disable'));
router.post('/skills/:id/execute', callController(skillsController, 'execute'));
router.delete('/skills/:id', callController(skillsController, 'remove'));
router.get('/skills/search/query', callController(skillsController, 'search'));

// Traces
router.get('/traces', callController(tracesController, 'getAll'));
router.get('/traces/:id', callController(tracesController, 'getById'));
router.get('/traces/:id/timeline', callController(tracesController, 'getTimeline'));
router.delete('/traces/:id', callController(tracesController, 'remove'));
router.get('/traces/export/:format', callController(tracesController, 'export'));

// Settings
router.get('/settings', callController(settingsController, 'getAll'));
router.put('/settings', callController(settingsController, 'update'));
router.post('/settings/reset', callController(settingsController, 'reset'));
router.post('/settings/clear-cache', callController(settingsController, 'clearCache'));

// SDK Control
router.post('/sdk/execute', (req, res) => getDashboardController(req).executeTask(req, res));
router.post('/sdk/cancel/:taskId', (req, res) => getDashboardController(req).cancelTask(req, res));
router.get('/sdk/sessions', (req, res) => getDashboardController(req).getActiveSessions(req, res));
router.get('/sdk/session/:id', (req, res) => getDashboardController(req).getSessionDetails(req, res));
router.post('/sdk/session/:id/clear', (req, res) => getDashboardController(req).clearSession(req, res));

module.exports = router;
