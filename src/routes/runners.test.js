'use strict';

const express = require('express');
const request = require('supertest');
const runnersRouter = require('./runners');
const { remoteRunnerService } = require('../remote-runner/service');

describe('/api/runners routes', () => {
  const originalToken = remoteRunnerService.config.token;

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api', runnersRouter);
    return app;
  }

  beforeEach(() => {
    remoteRunnerService.config.token = 'runner-secret';
    remoteRunnerService.runners.clear();
    remoteRunnerService.jobs.clear();
    remoteRunnerService.pending.clear();
  });

  afterAll(() => {
    remoteRunnerService.config.token = originalToken;
    remoteRunnerService.runners.clear();
    remoteRunnerService.jobs.clear();
    remoteRunnerService.pending.clear();
  });

  test('registers runners only with the shared runner token', async () => {
    const app = buildApp();

    const rejected = await request(app)
      .post('/api/runners/register')
      .set('Authorization', 'Bearer wrong')
      .send({ runnerId: 'deploy-1' });
    expect(rejected.status).toBe(401);

    const accepted = await request(app)
      .post('/api/runners/register')
      .set('Authorization', 'Bearer runner-secret')
      .send({
        runnerId: 'deploy-1',
        capabilities: ['inspect', 'deploy'],
        allowedRoots: ['/opt'],
      });
    expect(accepted.status).toBe(201);
    expect(accepted.body.runner).toEqual(expect.objectContaining({
      runnerId: 'deploy-1',
      capabilities: ['inspect', 'deploy'],
      allowedRoots: ['/opt'],
    }));
  });

  test('lists registered runners', async () => {
    const app = buildApp();
    remoteRunnerService.registerRunner({
      runnerId: 'deploy-1',
      capabilities: ['inspect'],
    });

    const response = await request(app).get('/api/runners');

    expect(response.status).toBe(200);
    expect(response.body.runners).toEqual([
      expect.objectContaining({
        runnerId: 'deploy-1',
      }),
    ]);
  });
});
