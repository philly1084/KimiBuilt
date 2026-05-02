jest.mock('../../../../routes/admin/settings.controller', () => ({
  settings: {
    api: {
      baseURL: 'http://localhost:3000',
    },
  },
}));

const {
  assertNotAuthWall,
  buildInternalBrowserHeaders,
  normalizeBrowserUrl,
} = require('./browser-runtime');

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

  test('adds the frontend API key for internal API preview URLs', () => {
    const original = process.env.KIMIBUILT_FRONTEND_API_KEY;
    process.env.KIMIBUILT_FRONTEND_API_KEY = 'frontend-test-key';
    try {
      expect(buildInternalBrowserHeaders('http://localhost:3000/api/artifacts/site/sandbox')).toEqual({
        'x-api-key': 'frontend-test-key',
      });
      expect(buildInternalBrowserHeaders('https://example.com/api/artifacts/site/sandbox')).toEqual({});
    } finally {
      if (original == null) {
        delete process.env.KIMIBUILT_FRONTEND_API_KEY;
      } else {
        process.env.KIMIBUILT_FRONTEND_API_KEY = original;
      }
    }
  });

  test('treats missing-token auth pages as browser QA failures', () => {
    expect(() => assertNotAuthWall({
      title: '',
      text: '{"error":{"message":"Authentication required","code":"missing_token"}}',
      html: '',
    }, 'http://localhost:3000/api/artifacts/site/sandbox')).toThrow(/authentication wall/i);
  });
});
