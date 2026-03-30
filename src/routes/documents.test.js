const express = require('express');
const request = require('supertest');

jest.mock('../middleware/validate', () => ({
  validate: () => (_req, _res, next) => next(),
}));

const documentsRouter = require('./documents');

describe('/api/documents route', () => {
  function buildApp(documentService) {
    const app = express();
    app.use(express.json());
    app.locals.documentService = documentService;
    app.use('/api/documents', documentsRouter);
    return app;
  }

  test('downloads a stored generated document', async () => {
    const documentService = {
      getDocument: jest.fn().mockReturnValue({
        id: 'doc-1',
        filename: 'launch-deck.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        metadata: { slideCount: 4 },
        contentBuffer: Buffer.from('pptx'),
      }),
    };

    const response = await request(buildApp(documentService)).get('/api/documents/doc-1/download');

    expect(response.status).toBe(200);
    expect(response.header['content-type']).toContain('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect(documentService.getDocument).toHaveBeenCalledWith('doc-1');
  });

  test('returns 404 when a stored document is missing', async () => {
    const documentService = {
      getDocument: jest.fn().mockReturnValue(null),
    };

    const response = await request(buildApp(documentService)).get('/api/documents/missing/download');

    expect(response.status).toBe(404);
  });

  test('lists document blueprints from the service', async () => {
    const documentService = {
      getBlueprints: jest.fn().mockReturnValue([
        { id: 'report', label: 'evidence-led report' },
        { id: 'website-slides', label: 'website slide deck' },
      ]),
    };

    const response = await request(buildApp(documentService)).get('/api/documents/blueprints');

    expect(response.status).toBe(200);
    expect(response.body.blueprints).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'report' }),
      expect.objectContaining({ id: 'website-slides' }),
    ]));
  });

  test('lists templates using normalized available formats', async () => {
    const documentService = {
      getTemplates: jest.fn().mockResolvedValue([
        {
          id: 'website-slides-storyboard',
          name: 'Website Slides Storyboard',
          category: 'creative',
          description: 'Storyboard deck',
          formats: ['pptx'],
          recommendedFormats: ['html', 'pptx'],
        },
      ]),
      getTemplateAvailableFormats: jest.fn().mockReturnValue(['pptx', 'html']),
      templateEngine: {
        getCategories: jest.fn().mockReturnValue(['creative']),
      },
    };

    const response = await request(buildApp(documentService)).get('/api/documents/templates');

    expect(response.status).toBe(200);
    expect(response.body.templates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'website-slides-storyboard',
        formats: ['pptx', 'html'],
        recommendedFormats: ['pptx', 'html'],
      }),
    ]));
  });

  test('returns workflow recommendations for a document request', async () => {
    const documentService = {
      recommendDocumentWorkflow: jest.fn().mockReturnValue({
        inferredType: 'pitch-deck',
        pipeline: 'presentation',
        recommendedFormat: 'pptx',
        recommendedTemplates: [{ id: 'pitch-deck-story', name: 'Pitch Deck Story' }],
      }),
    };

    const response = await request(buildApp(documentService))
      .post('/api/documents/recommend')
      .send({
        prompt: 'Create an investor pitch deck',
        format: 'pptx',
      });

    expect(response.status).toBe(200);
    expect(documentService.recommendDocumentWorkflow).toHaveBeenCalled();
    expect(response.body.recommendation).toEqual(expect.objectContaining({
      inferredType: 'pitch-deck',
      recommendedFormat: 'pptx',
    }));
  });

  test('returns a deterministic production plan for the request', async () => {
    const documentService = {
      buildDocumentPlan: jest.fn().mockReturnValue({
        inferredType: 'website-slides',
        outlineType: 'slides',
        titleSuggestion: 'Launch Story',
        outline: [{ index: 1, layout: 'title', title: 'Title Slide' }],
      }),
    };

    const response = await request(buildApp(documentService))
      .post('/api/documents/plan')
      .send({
        prompt: 'Build website slides for our launch',
        format: 'html',
      });

    expect(response.status).toBe(200);
    expect(documentService.buildDocumentPlan).toHaveBeenCalled();
    expect(response.body.plan).toEqual(expect.objectContaining({
      inferredType: 'website-slides',
      outlineType: 'slides',
    }));
  });
});
