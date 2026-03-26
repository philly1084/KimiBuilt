jest.mock('../../../../routes/admin/settings.controller', () => ({
  settings: {
    api: {
      baseURL: 'http://localhost:3000',
    },
  },
}));

jest.mock('../../../../artifacts/artifact-service', () => ({
  artifactService: {
    getArtifact: jest.fn(),
  },
}));

const { WebFetchTool } = require('./WebFetchTool');
const { artifactService } = require('../../../../artifacts/artifact-service');

describe('WebFetchTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('resolves internal artifact api paths against the configured base url', () => {
    const tool = new WebFetchTool();
    const artifactId = '3ee64601-2cb4-43e1-b56b-973bc2856419';

    expect(tool.normalizeUrl(`/api/artifacts/${artifactId}/download`)).toBe(
      `http://localhost:3000/api/artifacts/${artifactId}/download`,
    );
    expect(tool.normalizeUrl(`api/artifacts/${artifactId}/download`)).toBe(
      `http://localhost:3000/api/artifacts/${artifactId}/download`,
    );
  });

  test('rewrites accidental https://api artifact urls to the configured base url', () => {
    const tool = new WebFetchTool();
    const artifactId = '3ee64601-2cb4-43e1-b56b-973bc2856419';

    expect(tool.normalizeUrl(`https://api/artifacts/${artifactId}/download`)).toBe(
      `http://localhost:3000/api/artifacts/${artifactId}/download`,
    );
    expect(tool.normalizeUrl(`https://api/api/artifacts/${artifactId}/download`)).toBe(
      `http://localhost:3000/api/artifacts/${artifactId}/download`,
    );
  });

  test('keeps normal external urls unchanged', () => {
    const tool = new WebFetchTool();

    expect(tool.normalizeUrl('https://example.com/path')).toBe('https://example.com/path');
  });

  test('reads internal artifact downloads directly without an authenticated HTTP round-trip', async () => {
    const tool = new WebFetchTool();
    const tracker = { recordNetworkCall: jest.fn() };
    const artifactId = '3ee64601-2cb4-43e1-b56b-973bc2856419';

    artifactService.getArtifact.mockResolvedValue({
      id: artifactId,
      mimeType: 'text/html; charset=utf-8',
      contentBuffer: Buffer.from('<html><body>gallery</body></html>', 'utf8'),
    });

    const result = await tool.handler({
      url: `/api/artifacts/${artifactId}/download`,
    }, {}, tracker);

    expect(artifactService.getArtifact).toHaveBeenCalledWith(artifactId, { includeContent: true });
    expect(result.status).toBe(200);
    expect(result.body).toContain('<html><body>gallery</body></html>');
    expect(tracker.recordNetworkCall).toHaveBeenCalledWith(
      `http://localhost:3000/api/artifacts/${artifactId}/download`,
      'GET',
      expect.objectContaining({
        status: 200,
        internalArtifact: true,
      }),
    );
  });
});
