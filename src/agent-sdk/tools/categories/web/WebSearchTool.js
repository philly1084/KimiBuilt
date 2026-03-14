/**
 * WebSearchTool - Search the web using DuckDuckGo or other search APIs
 */

const { ToolBase } = require('../../ToolBase');

class WebSearchTool extends ToolBase {
  constructor() {
    super({
      id: 'web-search',
      name: 'Web Search',
      description: 'Search the web using DuckDuckGo or configurable search APIs',
      category: 'web',
      version: '1.0.0',
      backend: {
        sideEffects: ['network'],
        sandbox: { network: true },
        timeout: 30000
      },
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: {
            type: 'string',
            description: 'Search query'
          },
          engine: {
            type: 'string',
            enum: ['duckduckgo', 'google', 'bing', 'brave'],
            default: 'duckduckgo',
            description: 'Search engine to use'
          },
          limit: {
            type: 'integer',
            description: 'Number of results',
            default: 10,
            maximum: 50
          },
          safeSearch: {
            type: 'boolean',
            description: 'Enable safe search',
            default: true
          },
          region: {
            type: 'string',
            description: 'Region code (e.g., us-en, uk-en)',
            default: 'us-en'
          },
          timeRange: {
            type: 'string',
            enum: ['day', 'week', 'month', 'year', 'all'],
            default: 'all',
            description: 'Time range for results'
          },
          includeSnippets: {
            type: 'boolean',
            default: true
          },
          includeUrls: {
            type: 'boolean',
            default: true
          }
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          engine: { type: 'string' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                url: { type: 'string' },
                snippet: { type: 'string' },
                source: { type: 'string' },
                publishedAt: { type: 'string' }
              }
            }
          },
          totalResults: { type: 'integer' },
          searchTime: { type: 'number' }
        }
      }
    });
  }

  async handler(params, context, tracker) {
    const {
      query,
      engine = 'duckduckgo',
      limit = 10,
      safeSearch = true,
      region = 'us-en',
      timeRange = 'all',
      includeSnippets = true
    } = params;

    const startTime = Date.now();

    let results;
    
    switch (engine) {
      case 'duckduckgo':
        results = await this.searchDuckDuckGo(query, limit, safeSearch, region, timeRange);
        break;
      case 'google':
        results = await this.searchGoogle(query, limit, safeSearch, timeRange);
        break;
      default:
        throw new Error(`Search engine '${engine}' not implemented`);
    }

    const searchTime = (Date.now() - startTime) / 1000;

    tracker.recordNetworkCall(
      `https://${engine}.com/search`,
      'GET',
      { results: results.length }
    );

    return {
      query,
      engine,
      results: results.slice(0, limit),
      totalResults: results.length,
      searchTime
    };
  }

  async searchDuckDuckGo(query, limit, safeSearch, region, timeRange) {
    // DuckDuckGo HTML scraping approach
    // Note: In production, use their API or a service like SerpAPI
    
    const safeParam = safeSearch ? '1' : '-1';
    const timeParam = this.getDuckDuckGoTimeParam(timeRange);
    
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=${region}&kp=${safeParam}${timeParam}`;
    
    const fetchTool = this.getFetchTool();
    const response = await fetchTool.execute({ url: searchUrl }, {});
    
    if (!response.success) {
      throw new Error(`Search failed: ${response.error}`);
    }

    return this.parseDuckDuckGoResults(response.data.body);
  }

  async searchGoogle(query, limit, safeSearch, timeRange) {
    // Google Custom Search API or scraping
    // Requires API key in production
    throw new Error('Google search requires API key configuration');
  }

  getDuckDuckGoTimeParam(timeRange) {
    const map = {
      day: '&df=d',
      week: '&df=w',
      month: '&df=m',
      year: '&df=y'
    };
    return map[timeRange] || '';
  }

  parseDuckDuckGoResults(html) {
    const results = [];
    
    // DuckDuckGo HTML result structure
    const resultRegex = /<div class="result[^"]*"[^>]*>.*?<\/div>\s*<\/div>/gs;
    const titleRegex = /<a[^>]*class="result__a"[^>]*>(.*?)<\/a>/s;
    const urlRegex = /<a[^>]*href="\/l\/\?[^&]*&u=([^"]*)"[^>]*>/;
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/s;
    
    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < 20) {
      const resultHtml = match[0];
      
      const titleMatch = resultHtml.match(titleRegex);
      const urlMatch = resultHtml.match(urlRegex);
      const snippetMatch = resultHtml.match(snippetRegex);
      
      if (titleMatch && urlMatch) {
        let url = decodeURIComponent(urlMatch[1]);
        
        results.push({
          title: this.stripHtml(titleMatch[1]),
          url: url,
          snippet: snippetMatch ? this.stripHtml(snippetMatch[1]) : '',
          source: new URL(url).hostname.replace(/^www\./, ''),
          publishedAt: null // DuckDuckGo doesn't consistently provide this
        });
      }
    }
    
    return results;
  }

  stripHtml(html) {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#x27;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .trim();
  }

  getFetchTool() {
    // In real implementation, would get from registry
    const { WebFetchTool } = require('./WebFetchTool');
    return new WebFetchTool();
  }
}

module.exports = { WebSearchTool };
