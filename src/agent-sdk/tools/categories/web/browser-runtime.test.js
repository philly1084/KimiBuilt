jest.mock('../../../../routes/admin/settings.controller', () => ({
  settings: {
    api: {
      baseURL: 'http://localhost:3000',
    },
  },
}));

const { normalizeBrowserUrl } = require('./browser-runtime');

describe('browser-runtime URL normalization', () => {
  test('resolves internal preview paths against the configured backend base url', () => {
    expect(normalizeBrowserUrl('/api/sandbox-workspaces/demo/preview/')).toBe(
      'http://localhost:3000/api/sandbox-workspaces/demo/preview/',
    );
    expect(normalizeBrowserUrl('/api/artifacts/artifact-site-1/sandbox')).toBe(
      'http://localhost:3000/api/artifacts/artifact-site-1/sandbox',
    );
  });

  test('rewrites accidental api host preview urls to the configured backend base url', () => {
    expect(normalizeBrowserUrl('https://api/api/artifacts/artifact-site-1/sandbox')).toBe(
      'http://localhost:3000/api/artifacts/artifact-site-1/sandbox',
    );
  });
});
