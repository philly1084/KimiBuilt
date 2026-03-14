/**
 * WebScrapeTool - Structured data extraction from web pages
 * Supports CSS selectors, XPath, and AI-powered extraction
 */

const { ToolBase } = require('../../ToolBase');

class WebScrapeTool extends ToolBase {
  constructor() {
    super({
      id: 'web-scrape',
      name: 'Web Scraper',
      description: 'Extract structured data from web pages using selectors or AI',
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
            description: 'CSS selectors for extraction',
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
            description: 'Wait for element before extracting (requires browser)'
          },
          javascript: {
            type: 'boolean',
            description: 'Execute JavaScript (requires headless browser)',
            default: false
          },
          browser: {
            type: 'boolean',
            description: 'Use headless browser for dynamic content',
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
      javascript = false,
      browser = false,
      timeout = 30000
    } = params;

    // For JavaScript-heavy sites, we'd need Puppeteer/Playwright
    // For now, implement static scraping with cheerio-like parsing
    
    let html;
    let finalUrl = url;
    
    if (browser) {
      // Would use Puppeteer here
      throw new Error('Browser-based scraping requires Puppeteer installation');
    } else {
      // Static fetch
      const fetchTool = this.resolveFetchTool(context);
      if (!fetchTool) {
        throw new Error('WebFetchTool not available');
      }
      
      const fetchResult = await fetchTool.execute({ url, timeout }, context);
      if (!fetchResult.success) {
        throw new Error(`Failed to fetch: ${fetchResult.error}`);
      }
      
      html = fetchResult.data.body;
      finalUrl = fetchResult.data.url;
    }

    tracker.recordRead(url, { type: 'html', size: html.length });

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    let extractedData = {};
    let method = 'static';

    // CSS Selector extraction
    if (selectors) {
      extractedData = await this.extractWithSelectors(html, selectors);
      method = 'css-selectors';
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

    return {
      url: finalUrl,
      title,
      data: extractedData,
      extractedAt: new Date().toISOString(),
      method,
      stats: {
        htmlSize: html.length,
        fieldsExtracted: Object.keys(extractedData).length
      }
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
