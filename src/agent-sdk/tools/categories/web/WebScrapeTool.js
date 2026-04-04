/**
 * WebScrapeTool - Structured data extraction from web pages
 * Supports CSS selectors, XPath, and AI-powered extraction
 */

const { ToolBase } = require('../../ToolBase');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { config } = require('../../../../config');
const { artifactService } = require('../../../../artifacts/artifact-service');

const execFileAsync = promisify(execFile);
const DEFAULT_BROWSER_CANDIDATES = [
  config.artifacts.browserPath,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/snap/bin/chromium',
  'chromium',
  'chromium-browser',
  'google-chrome',
  'google-chrome-stable',
];

class WebScrapeTool extends ToolBase {
  constructor() {
    super({
      id: 'web-scrape',
      name: 'Web Scraper',
      description: 'Extract structured data from web pages using selectors, with optional headless-browser rendering for dynamic pages and TLS/certificate-problem sites',
      category: 'web',
      version: '1.0.0',
      backend: {
        sideEffects: ['network'],
        sandbox: { network: true },
        timeout: 60000
      },
      inputSchema: {
        type: 'object',
        required: ['url'],
        properties: {
          url: {
            type: 'string',
            description: 'URL to scrape'
          },
          selectors: {
            type: 'object',
            description: 'CSS selectors for structured extraction',
            additionalProperties: {
              type: 'object',
              properties: {
                selector: { type: 'string' },
                attribute: { type: 'string' },
                multiple: { type: 'boolean', default: false },
                transform: { type: 'string', enum: ['text', 'html', 'number', 'url'] }
              }
            }
          },
          xpath: {
            type: 'object',
            description: 'XPath expressions for extraction'
          },
          aiExtraction: {
            type: 'object',
            description: 'AI-powered extraction schema',
            properties: {
              enabled: { type: 'boolean', default: false },
              schema: {
                type: 'object',
                description: 'JSON schema describing what to extract'
              },
              prompt: {
                type: 'string',
                description: 'Additional extraction instructions'
              }
            }
          },
          waitForSelector: {
            type: 'string',
            description: 'Wait for a selector in the rendered DOM before extracting (browser mode)'
          },
          captureImages: {
            type: 'boolean',
            description: 'Extract image references from the page. When blindImageCapture is enabled, download them as opaque artifacts instead of exposing image content to the model.',
            default: false,
          },
          blindImageCapture: {
            type: 'boolean',
            description: 'Download captured images as binary artifacts and return only safe metadata such as artifact ids, filenames, and download paths.',
            default: false,
          },
          imageLimit: {
            type: 'integer',
            description: 'Maximum number of images to capture from the page',
            default: 12,
          },
          javascript: {
            type: 'boolean',
            description: 'Use the backend headless browser and rendered DOM for JavaScript-heavy pages',
            default: false
          },
          browser: {
            type: 'boolean',
            description: 'Force backend headless-browser rendering, useful for dynamic pages and certificate/TLS fetch failures',
            default: false
          },
          timeout: {
            type: 'integer',
            default: 30000
          }
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          title: { type: 'string' },
          content: { type: 'string' },
          contentLength: { type: 'integer' },
          data: { type: 'object' },
          extractedAt: { type: 'string' },
          method: { type: 'string' }
        }
      }
    });
  }

  async handler(params, context, tracker) {
    const {
      url,
      selectors,
      xpath,
      aiExtraction,
      waitForSelector,
      captureImages = false,
      blindImageCapture = false,
      imageLimit = 12,
      javascript = false,
      browser = false,
      timeout = 30000
    } = params;

    // For JavaScript-heavy sites, we'd need Puppeteer/Playwright
    // For now, implement static scraping with cheerio-like parsing
    
    let html;
    let finalUrl = url;
    
    if (browser || javascript) {
      html = await this.fetchWithBrowser(url, {
        timeout,
        waitForSelector,
      });
      finalUrl = this.normalizeUrl(url);
    } else {
      // Static fetch
      const fetchTool = this.resolveFetchTool(context);
      if (!fetchTool) {
        throw new Error('WebFetchTool not available');
      }
      
      const fetchResult = await fetchTool.execute({ url, timeout }, context);
      if (!fetchResult.success) {
        if (this.shouldFallbackToBrowser(fetchResult.error)) {
          html = await this.fetchWithBrowser(url, {
            timeout,
            waitForSelector,
          });
          finalUrl = this.normalizeUrl(url);
        } else {
          throw new Error(`Failed to fetch: ${fetchResult.error}`);
        }
      } else {
        html = fetchResult.data.body;
        finalUrl = fetchResult.data.url;
      }
    }

    tracker.recordRead(url, { type: 'html', size: html.length });

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';
    const content = this.extractPageText(html);

    let extractedData = {};
    let method = 'static';

    // CSS Selector extraction
    if (selectors) {
      extractedData = await this.extractWithSelectors(html, selectors);
      method = browser || javascript ? 'browser-css-selectors' : 'css-selectors';
    }

    // XPath extraction (if implemented)
    if (xpath) {
      // Would use xpath library
      extractedData.xpath = { note: 'XPath extraction requires additional library' };
    }

    // AI-powered extraction
    if (aiExtraction?.enabled) {
      const aiData = await this.extractWithAI(html, aiExtraction, context);
      extractedData = { ...extractedData, ...aiData };
      method = 'ai-assisted';
    }

    let imageCapture = null;
    if (captureImages || blindImageCapture) {
      imageCapture = await this.captureImages({
        html,
        pageUrl: finalUrl,
        context,
        blindImageCapture,
        imageLimit,
        timeout,
      });
    }

    return {
      url: finalUrl,
      title,
      content,
      contentLength: content.length,
      data: extractedData,
      imageCapture,
      extractedAt: new Date().toISOString(),
      method,
      stats: {
        htmlSize: html.length,
        contentChars: content.length,
        fieldsExtracted: Object.keys(extractedData).length,
        imagesCaptured: imageCapture?.count || 0,
      }
    };
  }

  async captureImages({ html, pageUrl, context = {}, blindImageCapture = false, imageLimit = 12, timeout = 30000 }) {
    const imageUrls = this.extractImageUrls(html, pageUrl, imageLimit);
    if (imageUrls.length === 0) {
      return {
        mode: blindImageCapture ? 'blind-artifacts' : 'listed',
        count: 0,
        items: [],
      };
    }

    if (!blindImageCapture) {
      return {
        mode: 'listed',
        count: imageUrls.length,
        items: imageUrls.map((url, index) => ({
          index: index + 1,
          sourceUrl: url,
        })),
      };
    }

    const sessionId = context.sessionId;
    if (!sessionId) {
      throw new Error('blindImageCapture requires a sessionId in the tool context');
    }

    const items = [];
    for (let index = 0; index < imageUrls.length; index += 1) {
      const sourceUrl = imageUrls[index];
      const downloaded = await this.downloadImageBinary(sourceUrl, timeout);
      const extension = this.resolveImageExtension(sourceUrl, downloaded.mimeType);
      const filename = `blind-image-${String(index + 1).padStart(2, '0')}.${extension}`;
      const stored = await artifactService.createStoredArtifact({
        sessionId,
        direction: 'generated',
        sourceMode: 'chat',
        filename,
        extension,
        mimeType: downloaded.mimeType,
        buffer: downloaded.buffer,
        extractedText: '',
        previewHtml: '',
        metadata: {
          blindCapture: true,
          sourceHost: this.getHostname(sourceUrl),
          sourceUrl,
          capturedFromPage: pageUrl,
          contentClassification: 'uninspected-sensitive-image',
        },
        vectorize: false,
      });

      items.push({
        index: index + 1,
        artifactId: stored.id,
        filename: stored.filename,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        sourceHost: this.getHostname(sourceUrl),
        downloadPath: `/api/artifacts/${stored.id}/download`,
        inlinePath: `/api/artifacts/${stored.id}/download?inline=1`,
      });
    }

    return {
      mode: 'blind-artifacts',
      count: items.length,
      items,
    };
  }

  resolveFetchTool(context = {}) {
    const contextualTool = typeof context.tools?.get === 'function'
      ? context.tools.get('web-fetch')
      : null;

    if (contextualTool?.execute) {
      return contextualTool;
    }

    if (context.toolManager?.getTool) {
      const managerTool = context.toolManager.getTool('web-fetch');
      if (managerTool?.execute) {
        return managerTool;
      }
    }

    try {
      const { getToolManager } = require('../../index');
      const managerTool = getToolManager().getTool('web-fetch');
      if (managerTool?.execute) {
        return managerTool;
      }
    } catch (_error) {
      // Fall through to a direct tool instance.
    }

    try {
      const { WebFetchTool } = require('./WebFetchTool');
      return new WebFetchTool();
    } catch (_error) {
      return null;
    }
  }

  shouldFallbackToBrowser(errorMessage = '') {
    const normalized = String(errorMessage || '').toLowerCase();
    return [
      'unable_to_get_issuer_cert_locally',
      'self signed certificate',
      'certificate',
      'ssl',
      'tls',
    ].some((token) => normalized.includes(token));
  }

  async fetchWithBrowser(url, options = {}) {
    const browserPath = await this.resolveBrowserPath();
    if (!browserPath) {
      throw new Error('Headless browser is not installed in the backend container');
    }

    const normalizedUrl = this.normalizeUrl(url);
    const timeout = options.timeout || 30000;
    const virtualTimeBudget = Math.min(Math.max(timeout, 3000), 45000);
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kimibuilt-browser-'));

    try {
      const { stdout, stderr } = await execFileAsync(browserPath, [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-background-networking',
        '--disable-features=Translate,BackForwardCache',
        '--allow-running-insecure-content',
        '--ignore-certificate-errors',
        '--user-data-dir=' + userDataDir,
        `--virtual-time-budget=${virtualTimeBudget}`,
        '--dump-dom',
        normalizedUrl,
      ], {
        timeout,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      });

      const html = String(stdout || '').trim();
      if (!html) {
        const detail = String(stderr || '').trim();
        throw new Error(detail || `Browser returned empty DOM for ${normalizedUrl}`);
      }

      if (options.waitForSelector) {
        this.assertSelectorPresent(html, options.waitForSelector);
      }

      return html;
    } catch (error) {
      const detail = String(error.stderr || error.stdout || error.message || '').trim();
      throw new Error(`Browser fetch failed for ${normalizedUrl}: ${detail}`);
    } finally {
      await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async resolveBrowserPath() {
    for (const candidate of DEFAULT_BROWSER_CANDIDATES) {
      if (!candidate) continue;

      if (candidate.includes(path.sep)) {
        try {
          await fs.access(candidate);
          return candidate;
        } catch {
          continue;
        }
      }

      return candidate;
    }

    return null;
  }

  normalizeUrl(url) {
    const value = String(url || '').trim();
    if (!value) {
      throw new Error('URL is required');
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

  extractImageUrls(html, pageUrl, imageLimit = 12) {
    const matches = Array.from(String(html || '').matchAll(/<img\b[^>]*>/gi));
    const unique = new Set();
    const results = [];

    for (const match of matches) {
      const tag = match[0] || '';
      const candidate = this.extractImageSourceFromTag(tag);
      const normalized = this.normalizeImageCandidateUrl(candidate, pageUrl);
      if (!normalized || unique.has(normalized)) {
        continue;
      }

      unique.add(normalized);
      results.push(normalized);
      if (results.length >= Math.max(1, Math.min(Number(imageLimit) || 12, 50))) {
        break;
      }
    }

    return results;
  }

  extractImageSourceFromTag(tag = '') {
    const candidates = [
      /(?:src|data-src|data-lazy-src|data-original)=["']([^"']+)["']/i,
      /srcset=["']([^"']+)["']/i,
    ];

    for (const pattern of candidates) {
      const match = String(tag || '').match(pattern);
      if (!match?.[1]) {
        continue;
      }

      const value = match[1].split(',')[0].trim().split(/\s+/)[0].trim();
      if (value) {
        return value;
      }
    }

    return null;
  }

  normalizeImageCandidateUrl(candidate, pageUrl) {
    const value = String(candidate || '').trim();
    if (!value || value.startsWith('data:')) {
      return null;
    }

    try {
      const normalized = new URL(value, pageUrl).toString();
      return /^https?:\/\//i.test(normalized) ? normalized : null;
    } catch (_error) {
      return null;
    }
  }

  async downloadImageBinary(url, timeout = 30000) {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'LillyBuilt-Agent/1.0 (Blind Image Capture)',
        'Accept': 'image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to download image (${response.status}) from ${url}`);
    }

    const mimeType = String(response.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim() || 'application/octet-stream';
    const buffer = Buffer.from(await response.arrayBuffer());
    return { mimeType, buffer };
  }

  resolveImageExtension(url, mimeType = '') {
    const byMime = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'image/avif': 'avif',
    };

    if (byMime[mimeType]) {
      return byMime[mimeType];
    }

    try {
      const pathname = new URL(url).pathname || '';
      const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
      if (match?.[1]) {
        return match[1].toLowerCase();
      }
    } catch (_error) {
      // Ignore URL parsing errors here; caller already normalized the URL.
    }

    return 'bin';
  }

  getHostname(url = '') {
    try {
      return new URL(url).hostname.replace(/^www\./i, '');
    } catch (_error) {
      return '';
    }
  }

  assertSelectorPresent(html, selector) {
    const regex = this.selectorToRegex(selector);
    if (!regex.test(html)) {
      throw new Error(`Selector '${selector}' was not found in the rendered page`);
    }
  }

  async extractWithSelectors(html, selectors) {
    const results = {};
    
    for (const [key, config] of Object.entries(selectors)) {
      const { selector, attribute, multiple = false, transform = 'text' } = config;
      
      if (multiple) {
        results[key] = this.extractAllMatches(html, selector, attribute, transform);
      } else {
        results[key] = this.extractFirstMatch(html, selector, attribute, transform);
      }
    }
    
    return results;
  }

  extractFirstMatch(html, selector, attribute, transform) {
    // Simple regex-based CSS selector matching
    // In production, use cheerio or similar
    const regex = this.selectorToRegex(selector);
    const match = html.match(regex);
    
    if (!match) return null;
    
    let value = attribute ? this.extractAttribute(match[0], attribute) : match[1] || match[0];
    
    return this.transformValue(value, transform);
  }

  extractAllMatches(html, selector, attribute, transform) {
    const regex = this.selectorToRegex(selector);
    const matches = [];
    let match;
    
    while ((match = regex.exec(html)) !== null) {
      let value = attribute ? this.extractAttribute(match[0], attribute) : match[1] || match[0];
      matches.push(this.transformValue(value, transform));
    }
    
    return matches;
  }

  selectorToRegex(selector) {
    // Very basic selector to regex conversion
    // e.g., '.price' -> class="price" or class='price'
    // e.g., 'h1' -> <h1>...</h1>
    
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return new RegExp(`class=["'][^"']*${className}[^"']*["'][^>]*>([^<]*)`, 'gi');
    }
    
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      return new RegExp(`id=["']${id}["'][^>]*>([^<]*)`, 'i');
    }
    
    // Tag selector
    return new RegExp(`<${selector}[^>]*>([^<]*)</${selector}>`, 'i');
  }

  extractAttribute(tagHtml, attribute) {
    const regex = new RegExp(`${attribute}=["']([^"']*)["']`, 'i');
    const match = tagHtml.match(regex);
    return match ? match[1] : null;
  }

  transformValue(value, transform) {
    if (!value) return value;
    
    switch (transform) {
      case 'text':
        return this.stripHtml(value).trim();
      case 'html':
        return value;
      case 'number':
        return parseFloat(value.replace(/[^0-9.-]/g, ''));
      case 'url':
        return this.resolveUrl(value);
      default:
        return value;
    }
  }

  stripHtml(html) {
    return html.replace(/<[^>]*>/g, '');
  }

  extractPageText(html = '') {
    const text = String(html || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, '\'')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ')
      .trim();

    return text.slice(0, config.scrape.contentCharLimit);
  }

  resolveUrl(url) {
    // Basic URL resolution
    if (url.startsWith('http')) return url;
    if (url.startsWith('//')) return `https:${url}`;
    // Would need base URL for relative paths
    return url;
  }

  async extractWithAI(html, aiConfig, context) {
    // Would use LLM to extract structured data
    // This is a placeholder implementation
    return {
      aiExtracted: {
        note: 'AI extraction requires LLM integration',
        prompt: aiConfig.prompt,
        schema: aiConfig.schema
      }
    };
  }
}

module.exports = { WebScrapeTool };
