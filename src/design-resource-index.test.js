const { DesignResourceIndex, SAFE_RESOURCE_SOURCES } = require('./design-resource-index');

describe('DesignResourceIndex', () => {
  test('searches safe design sources by category and query', () => {
    const index = new DesignResourceIndex(SAFE_RESOURCE_SOURCES);
    const result = index.search({
      query: 'hero background photos',
      category: 'background',
      surface: 'website',
      limit: 5,
    });

    expect(result.count).toBeGreaterThan(0);
    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'unsplash',
        fetchPlan: expect.objectContaining({
          tool: 'web-fetch',
          approvedDomains: expect.arrayContaining(['api.unsplash.com']),
        }),
      }),
    ]));
    expect(result.results.every((entry) => entry.category === 'backgrounds')).toBe(true);
  });

  test('returns fetch plans with approved domains and auth notes', () => {
    const index = new DesignResourceIndex(SAFE_RESOURCE_SOURCES);
    const plan = index.getFetchPlan('pexels');

    expect(plan.source.id).toBe('pexels');
    expect(plan.fetchPlan.params.url).toContain('api.pexels.com');
    expect(plan.fetchPlan.requiresAuth).toBe(true);
    expect(plan.fetchPlan.env).toEqual(expect.arrayContaining(['PEXELS_API_KEY']));
    expect(plan.fetchPlan.params.headers.Authorization).toContain('PEXELS_API_KEY');
  });

  test('collects only curated approved domains', () => {
    const index = new DesignResourceIndex(SAFE_RESOURCE_SOURCES);
    const domains = index.getApprovedDomains();

    expect(domains).toEqual(expect.arrayContaining([
      'developer.mozilla.org',
      'fonts.googleapis.com',
      'getbootstrap.com',
      'lucide.dev',
      'tailwindcss.com',
    ]));
    expect(domains).not.toContain('random.example.com');
  });
});
