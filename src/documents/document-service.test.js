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
});
