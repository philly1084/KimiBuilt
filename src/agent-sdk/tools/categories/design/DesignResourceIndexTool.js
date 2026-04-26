const { ToolBase } = require('../../ToolBase');
const { designResourceIndex } = require('../../../../design-resource-index');

class DesignResourceIndexTool extends ToolBase {
  constructor() {
    super({
      id: 'design-resource-search',
      name: 'Design Resource Search',
      description: 'Search a curated whitelist of safe design resource libraries for backgrounds, fonts, CSS styling, icons, and reusable website/document creation assets. Returns source metadata and web-fetch-ready fetch plans.',
      category: 'design',
      version: '1.0.0',
      backend: {
        sideEffects: [],
        sandbox: {},
        timeout: 10000,
      },
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['search', 'get', 'fetch_plan', 'categories', 'approved_domains'],
            default: 'search',
            description: 'Lookup action to perform.',
          },
          query: {
            type: 'string',
            description: 'Search text such as "hero backgrounds", "dashboard CSS", "font pairing", or "icons".',
          },
          category: {
            type: 'string',
            description: 'Optional category filter: backgrounds, fonts, styling, or icons.',
          },
          surface: {
            type: 'string',
            description: 'Optional target surface filter: website, document, presentation, or canvas.',
          },
          format: {
            type: 'string',
            description: 'Optional format filter such as css, json, photo, svg, or icons.',
          },
          resourceId: {
            type: 'string',
            description: 'Required for get and fetch_plan actions.',
          },
          limit: {
            type: 'integer',
            default: 10,
            description: 'Maximum number of results.',
          },
        },
      },
      outputSchema: {
        type: 'object',
      },
    });
  }

  async handler(params = {}) {
    const action = String(params.action || 'search').trim().toLowerCase();

    if (action === 'categories') {
      return {
        categories: designResourceIndex.getCategories(),
      };
    }

    if (action === 'approved_domains') {
      return {
        approvedDomains: designResourceIndex.getApprovedDomains(),
      };
    }

    if (action === 'get') {
      const source = designResourceIndex.getSource(params.resourceId || params.id);
      if (!source) {
        throw new Error(`Design resource not found: ${params.resourceId || params.id || ''}`);
      }

      return designResourceIndex.search({
        query: source.id,
        limit: 1,
      }).results[0];
    }

    if (action === 'fetch_plan') {
      const plan = designResourceIndex.getFetchPlan(params.resourceId || params.id);
      if (!plan) {
        throw new Error(`Design resource not found: ${params.resourceId || params.id || ''}`);
      }

      return plan;
    }

    return designResourceIndex.search({
      query: params.query || '',
      category: params.category || '',
      surface: params.surface || '',
      format: params.format || '',
      limit: params.limit || 10,
    });
  }
}

module.exports = { DesignResourceIndexTool };
