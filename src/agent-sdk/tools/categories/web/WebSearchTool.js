/**
 * WebSearchTool - Search the web using Perplexity Search API.
 */

const { ToolBase } = require('../../ToolBase');
const { config } = require('../../../../config');

class WebSearchTool extends ToolBase {
  constructor() {
    super({
      id: 'web-search',
      name: 'Web Search',
      description: 'Search the web using the configured Perplexity search provider',
      category: 'web',
      version: '1.1.0',
      backend: {
        sideEffects: ['network'],
        sandbox: { network: true },
        timeout: 30000,
      },
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: {
            type: 'string',
            description: 'Search query',
          },
          engine: {
            type: 'string',
            enum: ['perplexity'],
            default: 'perplexity',
            description: 'Search engine to use',
          },
          limit: {
            type: 'integer',
            description: 'Number of results',
            default: 10,
            maximum: 20,
          },
          safeSearch: {
            type: 'boolean',
            description: 'Safe search preference. Perplexity may apply its own safety handling.',
            default: true,
          },
          region: {
            type: 'string',
            description: 'Region hint such as us-en or uk-en',
            default: 'us-en',
          },
          timeRange: {
            type: 'string',
            enum: ['day', 'week', 'month', 'year', 'all'],
            default: 'all',
            description: 'Time range for results',
          },
          includeSnippets: {
            type: 'boolean',
            default: true,
          },
          includeUrls: {
            type: 'boolean',
            default: true,
          },
        },
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
                publishedAt: { type: 'string' },
              },
            },
          },
          totalResults: { type: 'integer' },
          searchTime: { type: 'number' },
        },
      },
    });
  }

  async handler(params, context, tracker) {
    const {
      query,
      engine = 'perplexity',
      limit = 10,
      safeSearch = true,
      region = 'us-en',
      timeRange = 'all',
      includeSnippets = true,
      includeUrls = true,
    } = params;

    if (engine !== 'perplexity') {
      throw new Error(`Search engine '${engine}' is not supported by this backend`);
    }

    const startTime = Date.now();
    const results = await this.searchPerplexity({
      query,
      limit,
      safeSearch,
      region,
      timeRange,
      includeSnippets,
      includeUrls,
    });
    const searchTime = (Date.now() - startTime) / 1000;

    tracker.recordNetworkCall(
      `${config.search.perplexityBaseURL.replace(/\/$/, '')}/search`,
      'POST',
      { results: results.length },
    );

    return {
      query,
      engine,
      results,
      totalResults: results.length,
      searchTime,
    };
  }

  async searchPerplexity({
    query,
    limit,
    region,
    timeRange,
    includeSnippets,
    includeUrls,
  }) {
    if (!config.search.perplexityApiKey) {
      throw new Error('Perplexity search is not configured. Set PERPLEXITY_API_KEY in the backend environment.');
    }

    const endpoint = `${config.search.perplexityBaseURL.replace(/\/$/, '')}/search`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.search.perplexityApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        max_results: Math.max(1, Math.min(Number(limit) || 10, 20)),
        search_domain_filter: [],
        country: this.mapRegionToCountry(region),
        search_recency_filter: this.mapTimeRange(timeRange),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Perplexity search failed (${response.status}): ${errorText || response.statusText}`);
    }

    const payload = await response.json();
    const results = Array.isArray(payload.results)
      ? payload.results
      : Array.isArray(payload.search_results)
        ? payload.search_results
        : [];

    return results.map((result) => this.normalizeResult(result, { includeSnippets, includeUrls }));
  }

  mapRegionToCountry(region = 'us-en') {
    const prefix = String(region).split('-')[0].toUpperCase();
    if (prefix.length === 2) {
      return prefix;
    }
    return 'US';
  }

  mapTimeRange(timeRange = 'all') {
    const map = {
      day: 'day',
      week: 'week',
      month: 'month',
      year: 'year',
    };
    return map[timeRange] || null;
  }

  normalizeResult(result = {}, { includeSnippets, includeUrls }) {
    const url = result.url || result.link || '';

    let source = '';
    if (url) {
      try {
        source = new URL(url).hostname.replace(/^www\./, '');
      } catch {
        source = '';
      }
    }

    return {
      title: result.title || result.name || 'Untitled result',
      url: includeUrls ? url : '',
      snippet: includeSnippets ? (result.snippet || result.description || '') : '',
      source,
      publishedAt: result.date || result.published_at || result.last_updated || null,
    };
  }
}

module.exports = { WebSearchTool };
