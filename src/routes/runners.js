'use strict';

const { Router } = require('express');
const { remoteRunnerService } = require('../remote-runner/service');

const router = Router();

function getOwnerId(req) {
  return String(req.user?.username || '').trim() || null;
}

function requireRunnerToken(req, res, next) {
  try {
    remoteRunnerService.authenticateRequest(req);
    next();
  } catch (error) {
    res.status(error.message.includes('Invalid') ? 401 : 503).json({
      error: {
        message: error.message,
      },
    });
  }
}

router.post('/runners/register', requireRunnerToken, (req, res, next) => {
  try {
    const runner = remoteRunnerService.registerRunner(req.body || {});
    res.status(201).json({
      runner,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/runners', (_req, res) => {
  res.json({
    runners: remoteRunnerService.listRunners(),
    count: remoteRunnerService.listRunners().length,
  });
});

router.get('/runners/jobs', (req, res) => {
  res.json({
    jobs: remoteRunnerService.listJobs({
      runnerId: req.query.runnerId,
      limit: req.query.limit,
    }),
  });
});

router.get('/runners/:id', (req, res) => {
  const runner = remoteRunnerService.getRunner(req.params.id);
  if (!runner) {
    return res.status(404).json({ error: { message: 'Runner not found' } });
  }
  return res.json({ runner });
});

router.post('/runners/:id/jobs', async (req, res, next) => {
  try {
    const result = await remoteRunnerService.dispatchCommand(req.params.id, req.body || {}, {
      ownerId: getOwnerId(req),
      sessionId: req.body?.sessionId || null,
    });
    res.status(202).json({
      result,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/runners/:id/jobs/:jobId', (req, res) => {
  const job = remoteRunnerService.getJob(req.params.jobId);
  if (!job || job.runnerId !== req.params.id) {
    return res.status(404).json({ error: { message: 'Runner job not found' } });
  }
  return res.json({ job });
});

module.exports = router;
