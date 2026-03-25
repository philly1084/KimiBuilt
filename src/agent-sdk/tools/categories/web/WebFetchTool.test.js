jest.mock('../../../../routes/admin/settings.controller', () => ({
  settings: {
    api: {
      baseURL: 'http://localhost:3000',
    },
  },
}));

const { WebFetchTool } = require('./WebFetchTool');

describe('WebFetchTool', () => {
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
});
