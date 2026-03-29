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
});
