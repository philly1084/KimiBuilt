const express = require('express');
const request = require('supertest');

jest.mock('../middleware/validate', () => ({
  validate: () => (_req, _res, next) => next(),
}));

const documentsRouter = require('./documents');

describe('/api/documents route', () => {
  function buildApp(documentService, { artifactService = null, templateStore = null } = {}) {
    const app = express();
    app.use(express.json());
    app.locals.documentService = documentService;
    app.locals.artifactService = artifactService;
    app.locals.templateStore = templateStore;
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

  test('injects template store context for ai document generation', async () => {
    const documentService = {
      buildDocumentPlan: jest.fn().mockReturnValue({
        inferredType: 'executive-brief',
        outlineType: 'document',
      }),
      aiGenerate: jest.fn().mockResolvedValue({
        id: 'doc-1',
        filename: 'brief.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 1234,
        metadata: {},
        preview: [],
      }),
    };
    const app = buildApp(documentService);
    app.locals.templateStore = {
      buildPromptContext: jest.fn().mockReturnValue({
        context: '[Recursive template store]\n- Template 1: Executive Brief [executive-brief]',
        matches: [{ id: 'executive-brief', name: 'Executive Brief' }],
      }),
      noteTemplateUse: jest.fn().mockResolvedValue(undefined),
    };

    const response = await request(app)
      .post('/api/documents/ai-generate')
      .send({
        prompt: 'Write an executive brief for Q2 priorities',
      });

    expect(response.status).toBe(200);
    expect(documentService.aiGenerate).toHaveBeenCalledWith(
      'Write an executive brief for Q2 priorities',
      expect.objectContaining({
        templateContext: expect.stringContaining('[Recursive template store]'),
      }),
    );
    expect(response.body.templateMatches).toEqual([
      expect.objectContaining({ id: 'executive-brief' }),
    ]);
  });

  test('routes non-presentation html ai generation through the artifact pipeline', async () => {
    const documentService = {
      buildDocumentPlan: jest.fn().mockReturnValue({
        inferredType: 'report',
        outlineType: 'document',
        blueprint: { id: 'report' },
      }),
      shouldUsePresentationPipeline: jest.fn().mockReturnValue(false),
      aiGenerate: jest.fn(),
    };
    const runtimeArtifactService = {
      generateArtifact: jest.fn().mockResolvedValue({
        artifact: {
          id: 'artifact-1',
          filename: 'visual-brief.html',
          format: 'html',
          mimeType: 'text/html',
          sizeBytes: 2048,
          downloadUrl: '/api/artifacts/artifact-1/download',
          preview: { type: 'html', content: '<!DOCTYPE html><html><body><h1>Visual Brief</h1></body></html>' },
          metadata: {
            title: 'Visual Brief',
            generationStrategy: 'multi-pass',
          },
        },
      }),
    };

    const response = await request(buildApp(documentService, {
      artifactService: runtimeArtifactService,
    }))
      .post('/api/documents/ai-generate')
      .send({
        prompt: 'Create a visual HTML brief with multiple images for the campaign launch.',
        format: 'html',
        documentType: 'report',
        tone: 'professional',
        length: 'medium',
        options: {
          theme: 'editorial',
        },
      });

    expect(response.status).toBe(200);
    expect(runtimeArtifactService.generateArtifact).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'document',
      prompt: 'Create a visual HTML brief with multiple images for the campaign launch.',
      format: 'html',
      contextMessages: expect.arrayContaining([
        expect.stringContaining('[Document route preferences]'),
        expect.stringContaining('"blueprint"'),
      ]),
    }));
    expect(documentService.aiGenerate).not.toHaveBeenCalled();
    expect(response.body.document).toEqual(expect.objectContaining({
      id: 'artifact-1',
      filename: 'visual-brief.html',
      mimeType: 'text/html',
      size: 2048,
      metadata: expect.objectContaining({
        format: 'html',
        title: 'Visual Brief',
        generationStrategy: 'multi-pass',
      }),
    }));
    expect(response.body.downloadUrl).toBe('/api/artifacts/artifact-1/download');
  });

  test('keeps html presentation requests on the document service pipeline', async () => {
    const documentService = {
      buildDocumentPlan: jest.fn().mockReturnValue({
        inferredType: 'website-slides',
        outlineType: 'slides',
        blueprint: { id: 'website-slides' },
      }),
      shouldUsePresentationPipeline: jest.fn().mockReturnValue(true),
      aiGenerate: jest.fn().mockResolvedValue({
        id: 'doc-2',
        filename: 'website-slides.html',
        mimeType: 'text/html',
        size: 1234,
        metadata: { format: 'html' },
        preview: [],
      }),
    };
    const runtimeArtifactService = {
      generateArtifact: jest.fn(),
    };

    const response = await request(buildApp(documentService, {
      artifactService: runtimeArtifactService,
    }))
      .post('/api/documents/ai-generate')
      .send({
        prompt: 'Create website slides for the launch story.',
        format: 'html',
        documentType: 'website-slides',
      });

    expect(response.status).toBe(200);
    expect(documentService.aiGenerate).toHaveBeenCalledWith(
      'Create website slides for the launch story.',
      expect.objectContaining({
        documentType: 'website-slides',
        format: 'html',
      }),
    );
    expect(runtimeArtifactService.generateArtifact).not.toHaveBeenCalled();
    expect(response.body.downloadUrl).toBe('/api/documents/doc-2/download');
  });
});
