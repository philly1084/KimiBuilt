const { DocumentService } = require('./document-service');

describe('DocumentService', () => {
  test('generates html documents from templates with unique filenames', async () => {
    const service = new DocumentService({
      responses: {
        create: jest.fn(),
      },
    });

    const document = await service.generateFromTemplate('business-letter', {
      sender_name: 'Alice Example',
      recipient_name: 'Bob Example',
      subject: 'Quarterly planning',
      body: 'Hello Bob.\n\nHere is the current plan.',
    }, 'html');

    expect(document.filename).toMatch(/\.html$/);
    expect(document.filename).toMatch(/-[a-z0-9]{4,}\.html$/);
    expect(String(document.content)).toContain('<!DOCTYPE html>');
    expect(String(document.content)).toContain('document-hero');
    expect(String(document.content)).toContain('Production Lens');
  });

  test('routes pdf generation through the shared document design plan', async () => {
    const service = new DocumentService({
      responses: {
        create: jest.fn(),
      },
    });

    jest.spyOn(service.generators.pdf, 'generateFromContent').mockResolvedValue({
      buffer: Buffer.from('pdf-bytes'),
      metadata: {
        format: 'pdf',
        design: {
          blueprint: 'executive-brief',
          theme: 'executive',
          outlineItems: 3,
        },
      },
    });

    const document = await service.generateFromTemplate('executive-brief', {
      title: 'Q2 Decision Brief',
      subtitle: 'Expansion review',
      audience: 'Leadership',
      headline_summary: 'Approve the expansion plan.',
      current_state: 'Pipeline is ahead of target.',
      recommendation: 'Fund the launch and assign an owner.',
      key_metrics: 'Revenue growth: 18%\nCAC payback: 7 months',
      next_steps: 'Approve budget\nAssign owner',
    }, 'pdf', {
      tone: 'professional',
      length: 'medium',
    });

    expect(service.generators.pdf.generateFromContent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Q2 Decision Brief',
        documentType: 'executive-brief',
      }),
      expect.objectContaining({
        designPlan: expect.objectContaining({
          blueprint: expect.objectContaining({ id: 'executive-brief' }),
          theme: expect.objectContaining({ id: 'executive' }),
        }),
      }),
    );
    expect(document.metadata.design).toEqual(expect.objectContaining({
      blueprint: 'executive-brief',
      theme: 'executive',
    }));
  });

  test('stores generated presentations for later download', async () => {
    const service = new DocumentService({
      responses: {
        create: jest.fn(),
      },
    });

    jest.spyOn(service.aiGenerator, 'generatePresentationContent').mockResolvedValue({
      title: 'Launch Story',
      theme: 'executive',
      slides: [
        { layout: 'title', title: 'Launch Story', subtitle: 'Q2' },
        { layout: 'content', title: 'Momentum', bullets: ['Pipeline is growing'] },
      ],
    });
    jest.spyOn(service.generators.pptx, 'generateFromContent').mockResolvedValue({
      buffer: Buffer.from('pptx-bytes'),
      metadata: { slideCount: 2, theme: 'executive' },
    });

    const document = await service.aiGenerate('Build a launch presentation', {
      format: 'pptx',
      documentType: 'presentation',
      theme: 'executive',
    });

    expect(service.aiGenerator.generatePresentationContent).toHaveBeenCalled();
    expect(service.generators.pptx.generateFromContent).toHaveBeenCalled();
    expect(document.mimeType).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect(document.filename).toMatch(/\.pptx$/);
    expect(document.downloadUrl).toBe(`/api/documents/${document.id}/download`);
    expect(service.getDocument(document.id)?.contentBuffer).toEqual(Buffer.from('pptx-bytes'));
  });

  test('renders website slides as html presentation decks', async () => {
    const service = new DocumentService({
      responses: {
        create: jest.fn(),
      },
    });

    jest.spyOn(service.aiGenerator, 'generatePresentationContent').mockResolvedValue({
      title: 'Website Deck',
      subtitle: 'Narrative site slides',
      theme: 'product',
      slides: [
        { layout: 'title', title: 'Website Deck', subtitle: 'Narrative site slides' },
        {
          layout: 'chart',
          title: 'Growth',
          chart: {
            title: 'Growth',
            series: [
              { label: 'Jan', value: 12 },
              { label: 'Feb', value: 18 },
            ],
          },
        },
      ],
    });

    const document = await service.generatePresentation('Create website slides', {
      format: 'html',
      theme: 'product',
    });

    expect(document.mimeType).toBe('text/html');
    expect(document.filename).toMatch(/\.html$/);
    expect(String(document.content)).toContain('presentation-deck');
    expect(String(document.content)).toContain('Website Slides');
  });

  test('renders verified image urls inside html presentation decks', async () => {
    const service = new DocumentService({
      responses: {
        create: jest.fn(),
      },
    });

    const document = await service.generatePresentation({
      title: 'Visual Deck',
      subtitle: 'Verified imagery',
      theme: 'editorial',
      slides: [
        { layout: 'title', title: 'Visual Deck', subtitle: 'Verified imagery' },
        {
          layout: 'image',
          title: 'Waterfront',
          imageUrl: 'https://images.example.com/halifax.jpg',
          imageAlt: 'Halifax waterfront',
          imageSource: 'Jane Doe / Unsplash',
          bullets: ['Verified image source is embedded directly'],
        },
      ],
    }, {
      format: 'html',
      generateImages: false,
    });

    expect(document.mimeType).toBe('text/html');
    expect(String(document.content)).toContain('https://images.example.com/halifax.jpg');
    expect(String(document.content)).toContain('Halifax waterfront');
    expect(String(document.content)).toContain('Jane Doe / Unsplash');
  });

  test('renders template-driven website slides as html presentation decks', async () => {
    const service = new DocumentService({
      responses: {
        create: jest.fn(),
      },
    });

    const document = await service.generateFromTemplate('website-slides-storyboard', {
      title: 'Launch Storyboard',
      subtitle: 'Narrative launch site',
      slides: [
        {
          kicker: 'Hero',
          title: 'Design moves at the speed of thought',
          content: 'A visual-first opening scene for the launch.',
          imagePrompt: 'Immersive product hero',
        },
        {
          kicker: 'Proof',
          title: 'Built for teams shipping every day',
          bullets: ['Narrative-first scenes', 'Visual rhythm', 'Strong CTA'],
        },
      ],
    }, 'html', {
      theme: 'product',
    });

    expect(document.mimeType).toBe('text/html');
    expect(document.filename).toMatch(/\.html$/);
    expect(String(document.content)).toContain('presentation-deck');
    expect(String(document.content)).toContain('Launch Storyboard');
    expect(String(document.content)).toContain('Design moves at the speed of thought');
  });

  test('discovers premium built-in templates for briefs, data stories, and decks', async () => {
    const service = new DocumentService({
      responses: {
        create: jest.fn(),
      },
    });

    const templateIds = (await service.getTemplates()).map((template) => template.id);

    expect(templateIds).toEqual(expect.arrayContaining([
      'executive-brief',
      'pitch-deck-story',
      'data-story-report',
      'website-slides-storyboard',
    ]));
  });

  test('recommends pitch-deck workflow for investor prompts', () => {
    const service = new DocumentService({
      responses: {
        create: jest.fn(),
      },
    });

    const recommendation = service.recommendDocumentWorkflow({
      prompt: 'Create an investor pitch deck for our AI workflow startup',
      format: 'pptx',
    });

    expect(recommendation.inferredType).toBe('pitch-deck');
    expect(recommendation.pipeline).toBe('presentation');
    expect(recommendation.recommendedFormat).toBe('pptx');
    expect(recommendation.recommendedTemplates.map((template) => template.id)).toContain('pitch-deck-story');
  });

  test('keeps html-capable storyboard templates in recommendations for website slides', () => {
    const service = new DocumentService({
      responses: {
        create: jest.fn(),
      },
    });

    const recommendation = service.recommendDocumentWorkflow({
      prompt: 'Build website slides for our product launch story',
      documentType: 'website-slides',
      format: 'html',
    });

    expect(recommendation.recommendedFormat).toBe('html');
    expect(recommendation.recommendedTemplates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'website-slides-storyboard',
        formats: expect.arrayContaining(['html', 'pptx']),
      }),
    ]));
  });

  test('builds a website-slide production plan with slide outline items', () => {
    const service = new DocumentService({
      responses: {
        create: jest.fn(),
      },
    });

    const plan = service.buildDocumentPlan({
      prompt: 'Build website slides for our product launch story',
      documentType: 'website-slides',
      format: 'html',
    });

    expect(plan.inferredType).toBe('website-slides');
    expect(plan.outlineType).toBe('slides');
    expect(plan.recommendedFormat).toBe('html');
    expect(plan.outline[0]).toEqual(expect.objectContaining({
      layout: 'title',
      title: 'Title Slide',
    }));
    expect(plan.creativeDirection).toEqual(expect.objectContaining({
      id: expect.any(String),
      label: expect.any(String),
    }));
    expect(plan.themeSuggestion).toEqual(expect.any(String));
    expect(plan.humanizationNotes.length).toBeGreaterThan(0);
  });

  test('treats scaffold-like existing content as structure rather than final copy in production plans', () => {
    const service = new DocumentService({
      responses: {
        create: jest.fn(),
      },
    });

    const plan = service.buildDocumentPlan({
      prompt: 'Create a polished executive brief about expanding into Atlantic Canada',
      documentType: 'executive-brief',
      format: 'pdf',
      existingContent: '## Overview\n## Details\n{{company_name}}\nPlaceholder copy here',
    });

    expect(plan.sampleHandling).toEqual(expect.arrayContaining([
      expect.stringContaining('Treat the provided template'),
      expect.stringContaining('Do not simply recycle'),
    ]));
  });
});
