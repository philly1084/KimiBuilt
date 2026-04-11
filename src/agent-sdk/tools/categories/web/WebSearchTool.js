/**
 * WebSearchTool - Search or research the web using Perplexity APIs.
 */

const { ToolBase } = require('../../ToolBase');
const { config } = require('../../../../config');
const { normalizeDomainList } = require('./research-site-policy');

const DEFAULT_SEARCH_LIMIT = Math.min(config.search.defaultLimit, config.search.maxLimit);
const DEFAULT_MAX_TOKENS = 10000;
const DEFAULT_MAX_TOKENS_PER_PAGE = 4096;
const RESEARCH_MODES = Object.freeze([
  'search',
  'fast-search',
  'pro-search',
  'deep-research',
  'advanced-deep-research',
]);

function normalizeDomainFilterEntry(value = '') {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const negate = raw.startsWith('-');
  const normalized = normalizeDomainList([negate ? raw.slice(1) : raw])[0] || '';
  if (!normalized) {
    return '';
  }

  return negate ? `-${normalized}` : normalized;
}

function normalizeSearchDomainFilters(values = []) {
  const input = Array.isArray(values) ? values : [values];
  return Array.from(new Set(
    input
      .map((value) => normalizeDomainFilterEntry(value))
      .filter(Boolean),
  ));
}

function normalizeLanguageFilter(values = []) {
  const input = Array.isArray(values) ? values : [values];
  return Array.from(new Set(
    input
      .map((value) => String(value || '').trim().toLowerCase())
      .filter((value) => /^[a-z]{2}$/.test(value)),
  ));
}

function normalizeDateFilter(value = '') {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeUserLocation(userLocation = null, region = 'us-en') {
  const countryFromRegion = String(region || 'us-en').split('-')[0].toUpperCase();
  const raw = userLocation && typeof userLocation === 'object' && !Array.isArray(userLocation)
    ? userLocation
    : {};

  const normalized = {
    country: String(raw.country || countryFromRegion || 'US').trim().toUpperCase(),
    region: String(raw.region || '').trim(),
    city: String(raw.city || '').trim(),
  };

  const latitude = Number(raw.latitude);
  const longitude = Number(raw.longitude);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    normalized.latitude = latitude;
    normalized.longitude = longitude;
  }

  if (!normalized.country || normalized.country.length !== 2) {
    normalized.country = 'US';
  }

  return normalized;
}

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === null || entry === undefined) {
        return false;
      }
      if (Array.isArray(entry)) {
        return entry.length > 0;
      }
      if (typeof entry === 'string') {
        return entry.trim().length > 0;
      }
      if (typeof entry === 'object') {
        return Object.keys(entry).length > 0;
      }
      return true;
    }),
  );
}

class WebSearchTool extends ToolBase {
  constructor() {
    super({
      id: 'web-search',
      name: 'Web Search',
      description: 'Search or research the web using the configured Perplexity APIs',
      category: 'web',
      version: '1.2.0',
      backend: {
        sideEffects: ['network'],
        sandbox: { network: true },
        timeout: 120000,
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
          researchMode: {
            type: 'string',
            enum: RESEARCH_MODES,
            default: 'search',
            description: 'Perplexity mode: raw search or preset-based researched answer',
          },
          limit: {
            type: 'integer',
            description: 'Maximum results to return or use per Perplexity search pass',
            default: DEFAULT_SEARCH_LIMIT,
            maximum: config.search.maxLimit,
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
            enum: ['hour', 'day', 'week', 'month', 'year', 'all'],
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
          domains: {
            type: 'array',
            description: 'Optional domain filters for authoritative or approved search targets. Use a leading "-" to exclude a domain in research modes.',
            items: {
              type: 'string',
            },
          },
          languageFilter: {
            type: 'array',
            description: 'Optional ISO 639-1 language filters (for example ["en", "fr"]).',
            items: {
              type: 'string',
            },
          },
          maxTokens: {
            type: 'integer',
            description: 'Maximum extracted search tokens budget used by Perplexity.',
            default: DEFAULT_MAX_TOKENS,
          },
          maxTokensPerPage: {
            type: 'integer',
            description: 'Maximum extracted tokens per page used by Perplexity.',
            default: DEFAULT_MAX_TOKENS_PER_PAGE,
          },
          publishedAfter: {
            type: 'string',
            description: 'Only include results published after this MM/DD/YYYY date.',
          },
          publishedBefore: {
            type: 'string',
            description: 'Only include results published before this MM/DD/YYYY date.',
          },
          updatedAfter: {
            type: 'string',
            description: 'Only include results updated after this MM/DD/YYYY date.',
          },
          updatedBefore: {
            type: 'string',
            description: 'Only include results updated before this MM/DD/YYYY date.',
          },
          maxSteps: {
            type: 'integer',
            description: 'Optional override for Perplexity preset reasoning/tool steps in research modes.',
          },
          instructions: {
            type: 'string',
            description: 'Optional extra instructions appended to Perplexity researched modes.',
          },
          userLocation: {
            type: 'object',
            description: 'Optional geographic context for Perplexity research modes.',
            properties: {
              country: { type: 'string' },
              region: { type: 'string' },
              city: { type: 'string' },
              latitude: { type: 'number' },
              longitude: { type: 'number' },
            },
          },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          engine: { type: 'string' },
          researchMode: { type: 'string' },
          answer: { type: 'string' },
          domainFilter: {
            type: 'array',
            items: { type: 'string' },
          },
          searchQueries: {
            type: 'array',
            items: { type: 'string' },
          },
          citations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                url: { type: 'string' },
              },
            },
          },
          verifiedPages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                url: { type: 'string' },
                snippet: { type: 'string' },
              },
            },
          },
          relatedQuestions: {
            type: 'array',
            items: { type: 'string' },
          },
          provider: {
            type: 'object',
            properties: {
              endpoint: { type: 'string' },
              model: { type: 'string' },
              responseId: { type: 'string' },
            },
          },
          usage: {
            type: 'object',
          },
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
      researchMode = 'search',
      limit = DEFAULT_SEARCH_LIMIT,
      safeSearch = true,
      region = 'us-en',
      timeRange = 'all',
      includeSnippets = true,
      includeUrls = true,
      domains = [],
      languageFilter = [],
      maxTokens = DEFAULT_MAX_TOKENS,
      maxTokensPerPage = DEFAULT_MAX_TOKENS_PER_PAGE,
      publishedAfter = null,
      publishedBefore = null,
      updatedAfter = null,
      updatedBefore = null,
      maxSteps = null,
      instructions = '',
      userLocation = null,
    } = params;

    if (engine !== 'perplexity') {
      throw new Error(`Search engine '${engine}' is not supported by this backend`);
    }

    if (!RESEARCH_MODES.includes(researchMode)) {
      throw new Error(`Research mode '${researchMode}' is not supported by this backend`);
    }

    const domainFilter = normalizeSearchDomainFilters(domains);
    const normalizedLanguageFilter = normalizeLanguageFilter(languageFilter);
    const normalizedUserLocation = normalizeUserLocation(userLocation, region);
    const startTime = Date.now();
    const result = researchMode === 'search'
      ? await this.searchPerplexity({
        query,
        limit,
        safeSearch,
        region,
        timeRange,
        includeSnippets,
        includeUrls,
        domains: domainFilter,
        languageFilter: normalizedLanguageFilter,
        maxTokens,
        maxTokensPerPage,
        publishedAfter,
        publishedBefore,
        updatedAfter,
        updatedBefore,
        userLocation: normalizedUserLocation,
      })
      : await this.researchPerplexity({
        query,
        researchMode,
        limit,
        region,
        timeRange,
        includeSnippets,
        includeUrls,
        domains: domainFilter,
        languageFilter: normalizedLanguageFilter,
        maxTokens,
        maxTokensPerPage,
        publishedAfter,
        publishedBefore,
        updatedAfter,
        updatedBefore,
        maxSteps,
        instructions,
        userLocation: normalizedUserLocation,
      });
    const searchTime = (Date.now() - startTime) / 1000;

    tracker.recordNetworkCall(
      `${config.search.perplexityBaseURL.replace(/\/$/, '')}${result.provider?.endpoint || '/search'}`,
      'POST',
      {
        results: result.results.length,
        researchMode,
      },
    );

    return {
      query,
      engine,
      researchMode,
      domainFilter,
      answer: result.answer || '',
      citations: result.citations || [],
      verifiedPages: result.verifiedPages || [],
      relatedQuestions: result.relatedQuestions || [],
      searchQueries: result.searchQueries || [],
      provider: result.provider || null,
      usage: result.usage || null,
      results: result.results,
      totalResults: result.results.length,
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
    domains,
    languageFilter,
    maxTokens,
    maxTokensPerPage,
    publishedAfter,
    publishedBefore,
    updatedAfter,
    updatedBefore,
    userLocation,
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
      body: JSON.stringify(compactObject({
        query,
        max_results: Math.max(1, Math.min(Number(limit) || DEFAULT_SEARCH_LIMIT, config.search.maxLimit)),
        max_tokens: Math.max(1, Number(maxTokens) || DEFAULT_MAX_TOKENS),
        max_tokens_per_page: Math.max(1, Number(maxTokensPerPage) || DEFAULT_MAX_TOKENS_PER_PAGE),
        search_domain_filter: normalizeSearchDomainFilters(domains).filter((entry) => !entry.startsWith('-')),
        country: userLocation?.country || this.mapRegionToCountry(region),
        search_recency_filter: this.mapTimeRange(timeRange),
        search_language_filter: normalizeLanguageFilter(languageFilter),
        search_after_date_filter: normalizeDateFilter(publishedAfter),
        search_before_date_filter: normalizeDateFilter(publishedBefore),
        last_updated_after_filter: normalizeDateFilter(updatedAfter),
        last_updated_before_filter: normalizeDateFilter(updatedBefore),
      })),
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

    return {
      answer: '',
      citations: [],
      verifiedPages: [],
      relatedQuestions: [],
      searchQueries: Array.isArray(query) ? query.map((entry) => String(entry || '').trim()).filter(Boolean) : [String(query || '').trim()].filter(Boolean),
      results: results.map((result) => this.normalizeResult(result, { includeSnippets, includeUrls })),
      provider: {
        endpoint: '/search',
        model: '',
        responseId: payload.id || '',
      },
      usage: null,
    };
  }

  async researchPerplexity({
    query,
    researchMode,
    limit,
    region,
    timeRange,
    includeSnippets,
    includeUrls,
    domains,
    languageFilter,
    maxTokens,
    maxTokensPerPage,
    publishedAfter,
    publishedBefore,
    updatedAfter,
    updatedBefore,
    maxSteps,
    instructions,
    userLocation,
  }) {
    if (!config.search.perplexityApiKey) {
      throw new Error('Perplexity search is not configured. Set PERPLEXITY_API_KEY in the backend environment.');
    }

    const endpoint = `${config.search.perplexityBaseURL.replace(/\/$/, '')}/v1/agent`;
    const webSearchTool = compactObject({
      type: 'web_search',
      max_results_per_query: Math.max(1, Math.min(Number(limit) || DEFAULT_SEARCH_LIMIT, config.search.maxLimit)),
      max_tokens: Math.max(1, Number(maxTokens) || DEFAULT_MAX_TOKENS),
      max_tokens_per_page: Math.max(1, Number(maxTokensPerPage) || DEFAULT_MAX_TOKENS_PER_PAGE),
      filters: compactObject({
        search_domain_filter: normalizeSearchDomainFilters(domains),
        search_language_filter: normalizeLanguageFilter(languageFilter),
        search_recency_filter: this.mapTimeRange(timeRange),
        search_after_date_filter: normalizeDateFilter(publishedAfter),
        search_before_date_filter: normalizeDateFilter(publishedBefore),
        last_updated_after_filter: normalizeDateFilter(updatedAfter),
        last_updated_before_filter: normalizeDateFilter(updatedBefore),
      }),
      user_location: compactObject(userLocation || {
        country: this.mapRegionToCountry(region),
      }),
    });

    const tools = [webSearchTool];
    if (researchMode !== 'fast-search') {
      tools.push({ type: 'fetch_url' });
    }

    const requestBody = {
      preset: researchMode,
      input: query,
      tools,
    };

    if (Number.isFinite(Number(maxSteps)) && Number(maxSteps) > 0) {
      requestBody.max_steps = Math.trunc(Number(maxSteps));
    }

    if (instructions && String(instructions).trim()) {
      requestBody.instructions = String(instructions).trim();
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.search.perplexityApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Perplexity research failed (${response.status}): ${errorText || response.statusText}`);
    }

    const payload = await response.json();
    const output = Array.isArray(payload.output) ? payload.output : [];
    const searchResults = [];
    const verifiedPages = [];
    const searchQueries = [];
    let answer = '';
    const annotationCitations = [];

    output.forEach((entry) => {
      if (entry?.type === 'search_results') {
        if (Array.isArray(entry.queries)) {
          searchQueries.push(...entry.queries.map((value) => String(value || '').trim()).filter(Boolean));
        }
        if (Array.isArray(entry.results)) {
          searchResults.push(...entry.results.map((result) => this.normalizeResult(result, { includeSnippets, includeUrls })));
        }
        return;
      }

      if (entry?.type === 'fetch_url_results' && Array.isArray(entry.contents)) {
        verifiedPages.push(...entry.contents.map((item) => ({
          title: item?.title || item?.url || 'Verified page',
          url: includeUrls ? (item?.url || '') : '',
          snippet: includeSnippets ? (item?.snippet || '') : '',
        })));
        return;
      }

      if (entry?.type === 'message' && Array.isArray(entry.content)) {
        entry.content.forEach((item) => {
          if (item?.type !== 'output_text') {
            return;
          }
          if (item.text) {
            answer += (answer ? '\n\n' : '') + item.text;
          }
          if (Array.isArray(item.annotations)) {
            annotationCitations.push(...item.annotations
              .map((annotation) => ({
                title: annotation?.title || annotation?.url || 'Citation',
                url: annotation?.url || '',
              }))
              .filter((annotation) => annotation.url));
          }
        });
      }
    });

    const dedupedResults = this.dedupeResults(searchResults);
    const dedupedVerifiedPages = this.dedupeResults(verifiedPages);
    const citations = annotationCitations.length > 0
      ? this.dedupeCitations(annotationCitations)
      : this.dedupeCitations([
        ...dedupedVerifiedPages.map((page) => ({ title: page.title, url: page.url })),
        ...dedupedResults.map((result) => ({ title: result.title, url: result.url })),
      ]);

    return {
      answer: answer.trim(),
      citations,
      verifiedPages: dedupedVerifiedPages,
      relatedQuestions: Array.isArray(payload.related_questions)
        ? payload.related_questions.map((value) => String(value || '').trim()).filter(Boolean)
        : [],
      searchQueries: Array.from(new Set(searchQueries)),
      results: dedupedResults,
      provider: {
        endpoint: '/v1/agent',
        model: String(payload.model || '').trim(),
        responseId: String(payload.id || '').trim(),
      },
      usage: payload.usage || null,
    };
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
      hour: 'hour',
      day: 'day',
      week: 'week',
      month: 'month',
      year: 'year',
    };
    return map[timeRange] || null;
  }

  dedupeResults(results = []) {
    const deduped = [];
    const seen = new Set();

    (Array.isArray(results) ? results : []).forEach((result) => {
      const key = String(result?.url || `${result?.title || ''}::${result?.snippet || ''}`).trim();
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      deduped.push(result);
    });

    return deduped;
  }

  dedupeCitations(citations = []) {
    const deduped = [];
    const seen = new Set();

    (Array.isArray(citations) ? citations : []).forEach((citation) => {
      const url = String(citation?.url || '').trim();
      if (!url || seen.has(url)) {
        return;
      }
      seen.add(url);
      deduped.push({
        title: citation?.title || url,
        url,
      });
    });

    return deduped;
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
