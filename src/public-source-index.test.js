const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { PublicSourceIndexService } = require('./public-source-index');

describe('PublicSourceIndexService', () => {
    let tempDir;
    let service;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kimibuilt-public-source-index-'));
        service = new PublicSourceIndexService({
            catalogPath: path.join(tempDir, 'catalog.json'),
        });
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    test('creates, normalizes, lists, and reads public source entries', async () => {
        const created = await service.upsert({
            name: 'SEC EDGAR Submissions API',
            kind: 'public-api',
            url: 'https://data.sec.gov/submissions/',
            description: 'Company filing metadata endpoint.',
            topics: ['Finance', 'Filings'],
            tags: ['SEC', 'EDGAR'],
            formats: ['JSON'],
            auth: { type: 'none' },
            freshness: 'near-real-time',
            examples: [{ query: 'company 10-K filings' }],
        });

        expect(created.action).toBe('created');
        expect(created.entry.id).toBe('sec-edgar-submissions-api');
        expect(created.entry.kind).toBe('public_api');
        expect(created.entry.domain).toBe('data.sec.gov');
        expect(created.entry.topics).toEqual(['finance', 'filings']);
        expect(created.entry.auth.type).toBe('none');

        const listed = await service.list({ kind: 'public_api', topics: ['finance'] });
        expect(listed.count).toBe(1);
        expect(listed.results[0].name).toBe('SEC EDGAR Submissions API');

        const entry = await service.get({ id: 'sec-edgar-submissions-api' });
        expect(entry.url).toBe('https://data.sec.gov/submissions/');
    });

    test('searches across metadata, examples, tags, and descriptions', async () => {
        await service.upsert({
            name: 'Federal Reserve Economic Data',
            kind: 'public_api',
            url: 'https://api.stlouisfed.org/fred/',
            description: 'Economic time series API.',
            topics: ['economics'],
            tags: ['macro', 'time series'],
            examples: [{ query: 'inflation data' }],
        });
        await service.upsert({
            name: 'NOAA Weather Alerts',
            kind: 'public_api',
            url: 'https://api.weather.gov/alerts',
            description: 'Weather alert endpoint.',
            topics: ['weather'],
        });

        const results = await service.search({ query: 'inflation macro data' });

        expect(results.count).toBe(1);
        expect(results.results[0]).toEqual(expect.objectContaining({
            id: 'federal-reserve-economic-data',
            matchedTerms: expect.arrayContaining(['inflation', 'macro', 'data']),
        }));
    });

    test('refresh verifies a URL and updates status, content type, and inferred formats', async () => {
        await service.upsert({
            name: 'Sample JSON API',
            kind: 'public_api',
            url: 'https://api.example.test/data',
            status: 'candidate',
        });

        const fetchMock = jest.fn(async (url, options = {}) => ({
            ok: true,
            status: 200,
            url,
            headers: {
                get: (name) => (String(name).toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null),
            },
            body: options.method === 'HEAD'
                ? null
                : { cancel: jest.fn(async () => {}) },
        }));

        const refreshed = await service.refresh({ id: 'sample-json-api' }, { fetch: fetchMock });

        expect(refreshed.verification.ok).toBe(true);
        expect(refreshed.entry.status).toBe('verified');
        expect(refreshed.entry.httpStatus).toBe(200);
        expect(refreshed.entry.contentType).toBe('application/json');
        expect(refreshed.entry.formats).toContain('json');
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.example.test/data',
            expect.objectContaining({ method: 'HEAD' }),
        );
    });

    test('rejects empty search and source entries without a usable URL', async () => {
        await expect(service.search({ query: '' })).rejects.toThrow('non-empty');
        await expect(service.upsert({ name: 'No URL' })).rejects.toThrow('requires at least');
    });
});
