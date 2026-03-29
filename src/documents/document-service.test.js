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
    expect(String(document.content)).toContain('Business Letter');
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
});
