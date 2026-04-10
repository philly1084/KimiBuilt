jest.mock('../../../../config', () => ({
  config: {
    search: {
      perplexityApiKey: 'test-perplexity-key',
      perplexityBaseURL: 'https://api.perplexity.ai',
      defaultLimit: 12,
      maxLimit: 20,
    },
  },
}));

const { WebSearchTool } = require('./WebSearchTool');

describe('WebSearchTool', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [{
          title: 'OpenAI API docs',
          url: 'https://platform.openai.com/docs/overview',
          snippet: 'Official API documentation.',
          date: '2026-04-10T10:00:00Z',
        }],
      }),
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('passes normalized domain filters to the Perplexity search endpoint', async () => {
    const tool = new WebSearchTool();
    const tracker = {
      recordNetworkCall: jest.fn(),
    };

    const result = await tool.handler({
      query: 'latest OpenAI API best practices',
      domains: ['https://platform.openai.com/docs', 'www.developer.mozilla.org/en-US/'],
    }, {}, tracker);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, request] = global.fetch.mock.calls[0];
    const payload = JSON.parse(request.body);

    expect(payload.search_domain_filter).toEqual([
      'platform.openai.com',
      'developer.mozilla.org',
    ]);
    expect(result.domainFilter).toEqual([
      'platform.openai.com',
      'developer.mozilla.org',
    ]);
    expect(result.results).toEqual([
      expect.objectContaining({
        title: 'OpenAI API docs',
        source: 'platform.openai.com',
      }),
    ]);
    expect(tracker.recordNetworkCall).toHaveBeenCalledWith(
      'https://api.perplexity.ai/search',
      'POST',
      { results: 1 },
    );
  });
});
