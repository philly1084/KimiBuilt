/**
 * WebFetchTool - Basic HTTP fetching with retry, caching, and rate limiting
 */

const { ToolBase } = require('../../ToolBase');
const settingsController = require('../../../../routes/admin/settings.controller');

class WebFetchTool extends ToolBase {
  constructor() {
    super({
      id: 'web-fetch',
      name: 'Web Fetch',
      description: 'Fetch content from URLs with retry and caching',
      category: 'web',
      version: '1.0.0',
      backend: {
        sideEffects: ['network'],
        sandbox: { network: true },
        timeout: 30000
      },
      inputSchema: {
        type: 'object',
        required: ['url'],
        properties: {
          url: {
            type: 'string',
            description: 'URL to fetch',
            format: 'uri'
          },
          method: {
            type: 'string',
            enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
            default: 'GET',
            description: 'HTTP method'
          },
          headers: {
            type: 'object',
            description: 'Additional HTTP headers'
          },
          body: {
            type: ['string', 'object'],
            description: 'Request body (for POST/PUT)'
          },
          timeout: {
            type: 'integer',
            description: 'Request timeout in ms',
            default: 30000
          },
          retries: {
            type: 'integer',
            description: 'Number of retries on failure',
            default: 3
          },
          cache: {
            type: 'boolean',
            description: 'Enable response caching',
            default: true
          },
          cacheTtl: {
            type: 'integer',
            description: 'Cache TTL in seconds',
            default: 300
          },
          followRedirects: {
            type: 'boolean',
            description: 'Follow HTTP redirects',
            default: true
          },
          maxRedirects: {
            type: 'integer',
            description: 'Maximum redirects to follow',
            default: 5
          }
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'integer' },
          statusText: { type: 'string' },
          headers: { type: 'object' },
          body: { type: 'string' },
          url: { type: 'string' },
          cached: { type: 'boolean' },
          duration: { type: 'integer' }
        }
      }
    });

    // In-memory cache
    this.cache = new Map();
  }

  async handler(params, context, tracker) {
    const {
      url,
      method = 'GET',
      headers = {},
      body,
      timeout = 30000,
      retries = 3,
      cache = true,
      cacheTtl = 300,
      followRedirects = true,
      maxRedirects = 5
    } = params;

    const normalizedUrl = this.normalizeUrl(url);

    // Check cache first
    const cacheKey = this.getCacheKey({ ...params, url: normalizedUrl });
    if (cache && method === 'GET') {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        tracker.recordNetworkCall(normalizedUrl, method, { cached: true });
        return { ...cached, cached: true };
      }
    }

    // Default headers
    const defaultHeaders = {
      'User-Agent': 'LillyBuilt-Agent/1.0 (Automated Research Tool)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive'
    };

    const fetchHeaders = { ...defaultHeaders, ...headers };

    // Execute with retries
    let lastError;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const startTime = Date.now();
        
        const response = await this.fetchWithTimeout(normalizedUrl, {
          method,
          headers: fetchHeaders,
          body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
          redirect: followRedirects ? 'follow' : 'manual'
        }, timeout);

        const duration = Date.now() - startTime;
        const responseBody = await response.text();

        // Track side effect
        tracker.recordNetworkCall(normalizedUrl, method, {
          status: response.status,
          contentType: response.headers.get('content-type')
        });

        const result = {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: responseBody,
          url: response.url,
          duration,
          cached: false
        };

        // Cache successful GET requests
        if (cache && method === 'GET' && response.ok) {
          this.setCache(cacheKey, result, cacheTtl);
        }

        return result;

      } catch (error) {
        lastError = this.formatFetchError(error, normalizedUrl, timeout);
        tracker.recordNetworkCall(normalizedUrl, method, {
          failed: true,
          error: lastError.message,
        });
        
        if (attempt < retries - 1) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error(`Failed to fetch ${url} after ${retries} attempts`);
  }

  async fetchWithTimeout(url, options, timeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  normalizeUrl(url) {
    const value = String(url || '').trim();
    if (!value) {
      throw new Error('URL is required');
    }

    const internalResolved = this.resolveInternalUrl(value);
    if (internalResolved) {
      return internalResolved;
    }

    const withScheme = /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;

    try {
      const parsed = new URL(withScheme);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`Unsupported protocol: ${parsed.protocol}`);
      }
      return parsed.toString();
    } catch (error) {
      throw new Error(`Invalid URL '${value}': ${error.message}`);
    }
  }

  resolveInternalUrl(value) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return null;
    }

    const baseUrl = this.getApiBaseUrl();
    if (!baseUrl) {
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
          return new URL(pathname, baseUrl).toString();
        }
        if (/^\/artifacts\/.+/i.test(pathname)) {
          return new URL(`/api${pathname}`, baseUrl).toString();
        }
      }
    } catch (_error) {
      return null;
    }

    return null;
  }

  getApiBaseUrl() {
    const configured = String(settingsController?.settings?.api?.baseURL || process.env.API_BASE_URL || 'http://localhost:3000').trim();
    if (!configured) {
      return null;
    }

    try {
      return new URL(configured).toString();
    } catch (_error) {
      return null;
    }
  }

  formatFetchError(error, url, timeout) {
    if (error?.name === 'AbortError') {
      return new Error(`Request to ${url} timed out after ${timeout}ms`);
    }

    const causeCode = error?.cause?.code || error?.code || '';
    const causeMessage = error?.cause?.message || error?.message || 'Unknown network error';
    const detail = causeCode ? `${causeCode}: ${causeMessage}` : causeMessage;
    return new Error(`Network error fetching ${url}: ${detail}`);
  }

  getCacheKey(params) {
    return `${params.method}:${params.url}:${JSON.stringify(params.headers || {})}`;
  }

  getFromCache(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data;
  }

  setCache(key, data, ttlSeconds) {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + (ttlSeconds * 1000)
    });
    
    // Clean old cache entries periodically
    if (this.cache.size > 1000) {
      this.cleanCache();
    }
  }

  cleanCache() {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { WebFetchTool };
