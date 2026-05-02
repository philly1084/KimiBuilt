const { config } = require('../../../../config');
const settingsController = require('../../../../routes/admin/settings.controller');

function getApiBaseUrl() {
  const settingsBaseUrl = String(settingsController?.settings?.api?.baseURL || '').trim();
  const envBaseUrl = String(process.env.API_BASE_URL || '').trim();
  const fallbackBaseUrl = `http://localhost:${config.port || 3000}`;
  const configured = selectApiBaseUrl(settingsBaseUrl, envBaseUrl, fallbackBaseUrl);

  if (!configured) {
    return null;
  }

  try {
    return new URL(configured).toString();
  } catch (_error) {
    return null;
  }
}

function isLoopbackBaseUrl(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return false;
  }

  try {
    const parsed = new URL(normalized);
    return ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(
      String(parsed.hostname || '').trim().toLowerCase(),
    );
  } catch (_error) {
    return /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(?::\d+)?(?:\/|$)/i.test(normalized);
  }
}

function selectApiBaseUrl(settingsBaseUrl = '', envBaseUrl = '', fallbackBaseUrl = '') {
  const settingsValue = String(settingsBaseUrl || '').trim();
  const envValue = String(envBaseUrl || '').trim();
  const fallbackValue = String(fallbackBaseUrl || '').trim();

  if (envValue && (!settingsValue || isLoopbackBaseUrl(settingsValue))) {
    return envValue;
  }

  return settingsValue || envValue || fallbackValue;
}

function resolveInternalUrl(value, baseUrl = getApiBaseUrl()) {
  const normalized = String(value || '').trim();
  if (!normalized || !baseUrl) {
    return null;
  }

  if (/^\/api\/.+/i.test(normalized)) {
    return new URL(normalized, baseUrl).toString();
  }

  if (/^api\/.+/i.test(normalized)) {
    return new URL(`/${normalized}`, baseUrl).toString();
  }

  if (/^\/artifacts\/.+/i.test(normalized)) {
    return new URL(`/api${normalized}`, baseUrl).toString();
  }

  if (/^artifacts\/.+/i.test(normalized)) {
    return new URL(`/api/${normalized}`, baseUrl).toString();
  }

  try {
    const parsed = new URL(normalized);
    const hostname = String(parsed.hostname || '').toLowerCase();
    const pathname = parsed.pathname || '';

    if (hostname === 'api') {
      if (/^\/api\/.+/i.test(pathname)) {
        return new URL(`${pathname}${parsed.search || ''}${parsed.hash || ''}`, baseUrl).toString();
      }
      if (/^\/artifacts\/.+/i.test(pathname)) {
        return new URL(`/api${pathname}${parsed.search || ''}${parsed.hash || ''}`, baseUrl).toString();
      }
    }
  } catch (_error) {
    return null;
  }

  return null;
}

function normalizeBrowserReachableUrl(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return normalized;
  }

  const internalUrl = resolveInternalUrl(normalized);
  if (internalUrl) {
    return internalUrl;
  }

  if (/^(localhost|127\.0\.0\.1|\[?::1\]?)(?::\d+)?(?:\/|$)/i.test(normalized)) {
    return `http://${normalized}`;
  }

  return normalized;
}

module.exports = {
  getApiBaseUrl,
  isLoopbackBaseUrl,
  normalizeBrowserReachableUrl,
  resolveInternalUrl,
  selectApiBaseUrl,
};
