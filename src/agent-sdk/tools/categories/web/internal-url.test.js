jest.mock('../../../../config', () => ({
  config: {
    port: 3000,
  },
}));

jest.mock('../../../../routes/admin/settings.controller', () => ({
  settings: {
    api: {
      baseURL: 'http://localhost:3000',
    },
  },
}));

const settingsController = require('../../../../routes/admin/settings.controller');
const {
  getApiBaseUrl,
  isLoopbackBaseUrl,
  normalizeBrowserReachableUrl,
  resolveInternalUrl,
  selectApiBaseUrl,
} = require('./internal-url');

describe('internal URL resolution', () => {
  const originalApiBaseUrl = process.env.API_BASE_URL;

  afterEach(() => {
    if (originalApiBaseUrl == null) {
      delete process.env.API_BASE_URL;
    } else {
      process.env.API_BASE_URL = originalApiBaseUrl;
    }
    settingsController.settings.api.baseURL = 'http://localhost:3000';
  });

  beforeEach(() => {
    delete process.env.API_BASE_URL;
  });

  test('detects loopback base URLs across common host forms', () => {
    expect(isLoopbackBaseUrl('http://localhost:3000')).toBe(true);
    expect(isLoopbackBaseUrl('https://127.0.0.1/api')).toBe(true);
    expect(isLoopbackBaseUrl('0.0.0.0:3000')).toBe(true);
    expect(isLoopbackBaseUrl('http://[::1]:3000')).toBe(true);
    expect(isLoopbackBaseUrl('https://kimibuilt.secdevsolutions.help')).toBe(false);
  });

  test('selects public environment base when saved settings are still loopback', () => {
    expect(selectApiBaseUrl(
      'http://localhost:3000',
      'https://kimibuilt.secdevsolutions.help',
      'http://localhost:3000',
    )).toBe('https://kimibuilt.secdevsolutions.help');
  });

  test('keeps an explicit non-loopback admin setting ahead of the environment fallback', () => {
    expect(selectApiBaseUrl(
      'https://admin-configured.example.com',
      'https://kimibuilt.secdevsolutions.help',
      'http://localhost:3000',
    )).toBe('https://admin-configured.example.com');
  });

  test('getApiBaseUrl normalizes the selected base URL', () => {
    process.env.API_BASE_URL = 'https://kimibuilt.secdevsolutions.help';

    expect(getApiBaseUrl()).toBe('https://kimibuilt.secdevsolutions.help/');
  });

  test('resolves relative API and artifact paths against the selected base URL', () => {
    process.env.API_BASE_URL = 'https://kimibuilt.secdevsolutions.help';

    expect(resolveInternalUrl('/api/artifacts/site/sandbox?view=1#top')).toBe(
      'https://kimibuilt.secdevsolutions.help/api/artifacts/site/sandbox?view=1#top',
    );
    expect(resolveInternalUrl('artifacts/site/download')).toBe(
      'https://kimibuilt.secdevsolutions.help/api/artifacts/site/download',
    );
  });

  test('rewrites accidental api-host artifact URLs without losing query or hash', () => {
    process.env.API_BASE_URL = 'https://kimibuilt.secdevsolutions.help';

    expect(resolveInternalUrl('https://api/api/artifacts/site/sandbox?view=1#top')).toBe(
      'https://kimibuilt.secdevsolutions.help/api/artifacts/site/sandbox?view=1#top',
    );
    expect(resolveInternalUrl('https://api/artifacts/site/download?raw=1')).toBe(
      'https://kimibuilt.secdevsolutions.help/api/artifacts/site/download?raw=1',
    );
  });

  test('normalizes host-only loopback browser targets while leaving external URLs alone', () => {
    expect(normalizeBrowserReachableUrl('localhost:3000/health')).toBe('http://localhost:3000/health');
    expect(normalizeBrowserReachableUrl('https://example.com/report')).toBe('https://example.com/report');
  });
});
