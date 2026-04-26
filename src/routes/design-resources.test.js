const express = require('express');
const request = require('supertest');

const designResourcesRouter = require('./design-resources');

describe('/api/design-resources routes', () => {
  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/design-resources', designResourcesRouter);
    return app;
  }

  test('searches design resources', async () => {
    const response = await request(buildApp())
      .get('/api/design-resources')
      .query({ q: 'font pairing', category: 'fonts' });

    expect(response.status).toBe(200);
    expect(response.body.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'google-fonts',
        fetchPlan: expect.objectContaining({
          tool: 'web-fetch',
        }),
      }),
    ]));
  });

  test('returns one fetch plan by id', async () => {
    const response = await request(buildApp())
      .get('/api/design-resources/lucide');

    expect(response.status).toBe(200);
    expect(response.body.source.id).toBe('lucide');
    expect(response.body.fetchPlan.params.url).toContain('lucide.dev');
    expect(response.body.fetchPlan.approvedDomains).toEqual(expect.arrayContaining(['lucide.dev']));
  });

  test('returns 404 for unknown resource ids', async () => {
    const response = await request(buildApp())
      .get('/api/design-resources/random-site');

    expect(response.status).toBe(404);
    expect(response.body.error.message).toContain('Design resource not found');
  });
});
