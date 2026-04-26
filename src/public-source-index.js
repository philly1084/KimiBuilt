const fs = require('fs/promises');
const path = require('path');
const { config } = require('./config');

const MANIFEST_VERSION = 1;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
const VERIFY_TIMEOUT_MS = 12000;
const VERIFY_GET_BYTES = 32768;

const SOURCE_KINDS = Object.freeze([
    'public_api',
    'dashboard',
    'news_feed',
    'rss_feed',
    'data_portal',
    'open_data',
    'download',
    'web_page',
]);

const AUTH_TYPES = Object.freeze([
    'none',
    'api_key',
    'oauth',
    'token',
    'session',
    'unknown',
]);

const STATUSES = Object.freeze([
    'candidate',
    'verified',
    'stale',
    'broken',
    'blocked',
    'retired',
]);

function resolvePublicSourceIndexPath(value = process.env.KIMIBUILT_PUBLIC_SOURCE_INDEX_PATH || '') {
    const configured = String(value || '').trim();
    if (!configured) {
        return path.join(config.persistence.dataDir, 'public-source-index', 'catalog.json');
    }

    return path.isAbsolute(configured)
        ? path.normalize(configured)
        : path.resolve(process.cwd(), configured);
}

function clampLimit(value, fallback = DEFAULT_LIST_LIMIT) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.max(1, Math.min(Math.trunc(parsed), MAX_LIST_LIMIT));
}

function normalizeString(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeArray(values = []) {
    const input = Array.isArray(values) ? values : String(values || '').split(',');
    return Array.from(new Set(input
        .map((value) => normalizeString(value))
        .filter(Boolean)));
}

function normalizeLowerArray(values = []) {
    return normalizeArray(values).map((value) => value.toLowerCase());
}

function normalizeKind(value = '') {
    const normalized = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
    return SOURCE_KINDS.includes(normalized) ? normalized : 'public_api';
}

function normalizeStatus(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    return STATUSES.includes(normalized) ? normalized : 'candidate';
}

function normalizeAuth(auth = {}) {
    const raw = auth && typeof auth === 'object' && !Array.isArray(auth) ? auth : {};
    const type = String(raw.type || raw.authType || '').trim().toLowerCase();
    return {
        type: AUTH_TYPES.includes(type) ? type : 'unknown',
        notes: normalizeString(raw.notes || raw.description || ''),
    };
}

function normalizeUrl(value = '') {
    const raw = normalizeString(value);
    if (!raw) {
        return '';
    }
    try {
        return new URL(raw).toString();
    } catch (_error) {
        return raw;
    }
}

function hostnameFromUrl(value = '') {
    try {
        return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
    } catch (_error) {
        return '';
    }
}

function slugify(value = '') {
    const slug = normalizeString(value)
        .toLowerCase()
        .replace(/https?:\/\//g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return slug || `source-${Date.now()}`;
}

function coerceIsoTimestamp(value = null, fallback = null) {
    const parsed = Date.parse(String(value || ''));
    if (Number.isFinite(parsed)) {
        return new Date(parsed).toISOString();
    }
    return fallback;
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

function normalizeEndpoint(endpoint = {}) {
    if (typeof endpoint === 'string') {
        return compactObject({
            url: normalizeUrl(endpoint),
            method: 'GET',
        });
    }

    const raw = endpoint && typeof endpoint === 'object' && !Array.isArray(endpoint) ? endpoint : {};
    return compactObject({
        name: normalizeString(raw.name || raw.label || ''),
        url: normalizeUrl(raw.url || raw.href || ''),
        path: normalizeString(raw.path || ''),
        method: normalizeString(raw.method || 'GET').toUpperCase(),
        description: normalizeString(raw.description || raw.notes || ''),
        params: raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params) ? raw.params : undefined,
    });
}

function normalizeExample(example = {}) {
    if (typeof example === 'string') {
        return { query: normalizeString(example) };
    }

    const raw = example && typeof example === 'object' && !Array.isArray(example) ? example : {};
    return compactObject({
        label: normalizeString(raw.label || raw.name || ''),
        query: normalizeString(raw.query || raw.prompt || ''),
        url: normalizeUrl(raw.url || ''),
        notes: normalizeString(raw.notes || ''),
    });
}

function inferFormatsFromContentType(contentType = '') {
    const normalized = String(contentType || '').toLowerCase();
    if (!normalized) {
        return [];
    }
    if (normalized.includes('json')) {
        return ['json'];
    }
    if (normalized.includes('rss') || normalized.includes('atom') || normalized.includes('xml')) {
        return ['xml'];
    }
    if (normalized.includes('csv')) {
        return ['csv'];
    }
    if (normalized.includes('html')) {
        return ['html'];
    }
    if (normalized.includes('text/plain')) {
        return ['txt'];
    }
    return [];
}

function normalizeEntry(entry = {}, previous = null) {
    const url = normalizeUrl(entry.url || entry.baseUrl || entry.homepage || previous?.url || '');
    const id = slugify(entry.id || entry.name || url || previous?.id || '');
    const now = new Date().toISOString();

    return {
        id,
        name: normalizeString(entry.name || previous?.name || id),
        kind: normalizeKind(entry.kind || previous?.kind),
        url,
        domain: normalizeString(entry.domain || previous?.domain || hostnameFromUrl(url)).toLowerCase(),
        description: normalizeString(entry.description || previous?.description || ''),
        topics: normalizeLowerArray(entry.topics || previous?.topics || []),
        tags: normalizeLowerArray(entry.tags || previous?.tags || []),
        formats: normalizeLowerArray(entry.formats || previous?.formats || []),
        endpoints: (Array.isArray(entry.endpoints) ? entry.endpoints : previous?.endpoints || [])
            .map(normalizeEndpoint)
            .filter((endpoint) => endpoint.url || endpoint.path),
        auth: normalizeAuth(entry.auth || previous?.auth || {}),
        rateLimit: normalizeString(entry.rateLimit || previous?.rateLimit || ''),
        freshness: normalizeString(entry.freshness || previous?.freshness || ''),
        termsUrl: normalizeUrl(entry.termsUrl || previous?.termsUrl || ''),
        docsUrl: normalizeUrl(entry.docsUrl || previous?.docsUrl || ''),
        sourceUrls: normalizeArray(entry.sourceUrls || previous?.sourceUrls || []).map(normalizeUrl),
        examples: (Array.isArray(entry.examples) ? entry.examples : previous?.examples || [])
            .map(normalizeExample)
            .filter((example) => example.query || example.url || example.label),
        notes: normalizeString(entry.notes || previous?.notes || ''),
        status: normalizeStatus(entry.status || previous?.status),
        httpStatus: Number.isFinite(Number(entry.httpStatus)) ? Number(entry.httpStatus) : previous?.httpStatus || null,
        contentType: normalizeString(entry.contentType || previous?.contentType || ''),
        verifiedAt: coerceIsoTimestamp(entry.verifiedAt, previous?.verifiedAt || null),
        lastCheckedAt: coerceIsoTimestamp(entry.lastCheckedAt, previous?.lastCheckedAt || null),
        createdAt: coerceIsoTimestamp(entry.createdAt, previous?.createdAt || now),
        updatedAt: coerceIsoTimestamp(entry.updatedAt, now),
    };
}

function buildSearchText(entry = {}) {
    return [
        entry.id,
        entry.name,
        entry.kind,
        entry.url,
        entry.domain,
        entry.description,
        entry.topics?.join(' '),
        entry.tags?.join(' '),
        entry.formats?.join(' '),
        entry.auth?.type,
        entry.rateLimit,
        entry.freshness,
        entry.docsUrl,
        entry.sourceUrls?.join(' '),
        entry.examples?.map((example) => [example.label, example.query, example.url, example.notes].join(' ')).join(' '),
        entry.notes,
        entry.status,
    ].filter(Boolean).join(' ').toLowerCase();
}

class PublicSourceIndexService {
    constructor(options = {}) {
        this.catalogPath = path.resolve(options.catalogPath || resolvePublicSourceIndexPath());
    }

    async ensureInitialized() {
        await fs.mkdir(path.dirname(this.catalogPath), { recursive: true });
        try {
            await fs.access(this.catalogPath);
        } catch (_error) {
            await this.writeCatalog({ entries: [] });
        }

        return {
            catalogPath: this.catalogPath,
        };
    }

    async readCatalog() {
        await this.ensureInitialized();
        try {
            const raw = await fs.readFile(this.catalogPath, 'utf8');
            const parsed = JSON.parse(raw);
            const entries = Array.isArray(parsed.entries)
                ? parsed.entries.map((entry) => normalizeEntry(entry)).filter((entry) => entry.id)
                : [];
            return {
                version: MANIFEST_VERSION,
                updatedAt: parsed.updatedAt || null,
                entries,
            };
        } catch (_error) {
            return {
                version: MANIFEST_VERSION,
                updatedAt: null,
                entries: [],
            };
        }
    }

    async writeCatalog(catalog = {}) {
        const payload = {
            version: MANIFEST_VERSION,
            updatedAt: new Date().toISOString(),
            entries: (Array.isArray(catalog.entries) ? catalog.entries : [])
                .map((entry) => normalizeEntry(entry))
                .sort((left, right) => left.name.localeCompare(right.name)),
        };
        await fs.mkdir(path.dirname(this.catalogPath), { recursive: true });
        const tempPath = `${this.catalogPath}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8');
        await fs.rename(tempPath, this.catalogPath);
        return payload;
    }

    async list(params = {}) {
        const catalog = await this.readCatalog();
        const limit = clampLimit(params.limit);
        const kind = normalizeString(params.kind).toLowerCase().replace(/[-\s]+/g, '_');
        const domain = normalizeString(params.domain).toLowerCase();
        const status = normalizeString(params.status).toLowerCase();
        const topics = normalizeLowerArray(params.topics || []);
        const tags = normalizeLowerArray(params.tags || []);

        const results = catalog.entries
            .filter((entry) => !kind || entry.kind === kind)
            .filter((entry) => !domain || entry.domain === domain || entry.domain.endsWith(`.${domain}`))
            .filter((entry) => !status || entry.status === status)
            .filter((entry) => topics.length === 0 || topics.every((topic) => entry.topics.includes(topic)))
            .filter((entry) => tags.length === 0 || tags.every((tag) => entry.tags.includes(tag)))
            .sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime())
            .slice(0, limit);

        return {
            catalogPath: this.catalogPath,
            count: results.length,
            results,
        };
    }

    async search(params = {}) {
        const query = normalizeString(params.query).toLowerCase();
        if (!query) {
            throw new Error('public-source-search requires a non-empty `query` string.');
        }

        const catalog = await this.readCatalog();
        const limit = clampLimit(params.limit);
        const kind = normalizeString(params.kind).toLowerCase().replace(/[-\s]+/g, '_');
        const domain = normalizeString(params.domain).toLowerCase();
        const status = normalizeString(params.status).toLowerCase();
        const terms = query.split(/\s+/).filter(Boolean);

        const results = catalog.entries
            .filter((entry) => !kind || entry.kind === kind)
            .filter((entry) => !domain || entry.domain === domain || entry.domain.endsWith(`.${domain}`))
            .filter((entry) => !status || entry.status === status)
            .map((entry) => {
                const searchText = buildSearchText(entry);
                const matchedTerms = terms.filter((term) => searchText.includes(term));
                const exactBoost = searchText.includes(query) ? 2 : 0;
                const score = matchedTerms.length + exactBoost;
                return score > 0
                    ? {
                        ...entry,
                        score,
                        matchedTerms,
                    }
                    : null;
            })
            .filter(Boolean)
            .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
            .slice(0, limit);

        return {
            query,
            count: results.length,
            results,
        };
    }

    async get(params = {}) {
        const id = normalizeString(params.id || params.sourceId || '');
        if (!id) {
            throw new Error('public-source-get requires `id`.');
        }

        const catalog = await this.readCatalog();
        const normalizedId = slugify(id);
        const entry = catalog.entries.find((candidate) => candidate.id === normalizedId || candidate.id === id);
        if (!entry) {
            throw new Error(`Public source not found: ${id}`);
        }

        return entry;
    }

    async upsert(params = {}) {
        const catalog = await this.readCatalog();
        const proposed = normalizeEntry(params);
        if (!proposed.url && proposed.endpoints.length === 0 && !proposed.docsUrl) {
            throw new Error('public-source-add requires at least `url`, `docsUrl`, or one endpoint.');
        }

        const existingIndex = catalog.entries.findIndex((entry) => entry.id === proposed.id);
        const previous = existingIndex >= 0 ? catalog.entries[existingIndex] : null;
        const entry = normalizeEntry({
            ...previous,
            ...params,
            id: proposed.id,
        }, previous);
        const entries = existingIndex >= 0
            ? catalog.entries.map((candidate, index) => (index === existingIndex ? entry : candidate))
            : [...catalog.entries, entry];
        await this.writeCatalog({ ...catalog, entries });

        return {
            action: existingIndex >= 0 ? 'updated' : 'created',
            entry,
        };
    }

    async refresh(params = {}, options = {}) {
        const id = normalizeString(params.id || params.sourceId || '');
        if (!id) {
            throw new Error('public-source-refresh requires `id`.');
        }

        const catalog = await this.readCatalog();
        const normalizedId = slugify(id);
        const index = catalog.entries.findIndex((candidate) => candidate.id === normalizedId || candidate.id === id);
        if (index < 0) {
            throw new Error(`Public source not found: ${id}`);
        }

        const entry = catalog.entries[index];
        const targetUrl = normalizeUrl(params.url || entry.url || entry.docsUrl || entry.endpoints[0]?.url || '');
        if (!targetUrl) {
            throw new Error('Public source has no URL to refresh.');
        }

        const verification = await this.verifyUrl(targetUrl, options);
        const formats = Array.from(new Set([
            ...entry.formats,
            ...inferFormatsFromContentType(verification.contentType),
        ]));
        const status = verification.ok ? 'verified' : (verification.blocked ? 'blocked' : 'broken');
        const now = new Date().toISOString();
        const updatedEntry = normalizeEntry({
            ...entry,
            status,
            httpStatus: verification.httpStatus,
            contentType: verification.contentType,
            formats,
            verifiedAt: verification.ok ? now : entry.verifiedAt,
            lastCheckedAt: now,
            notes: verification.error
                ? [entry.notes, `Last refresh error: ${verification.error}`].filter(Boolean).join(' ')
                : entry.notes,
        }, entry);

        const entries = catalog.entries.map((candidate, candidateIndex) => (
            candidateIndex === index ? updatedEntry : candidate
        ));
        await this.writeCatalog({ ...catalog, entries });

        return {
            entry: updatedEntry,
            verification,
        };
    }

    async verifyUrl(url, options = {}) {
        const fetchImpl = options.fetch || global.fetch;
        if (typeof fetchImpl !== 'function') {
            throw new Error('public-source-refresh requires fetch support in the runtime.');
        }

        const headers = {
            'User-Agent': 'KimiBuilt-Agent/1.0',
            Accept: 'application/json,text/csv,application/xml,text/xml,text/html,*/*;q=0.8',
        };
        const attempts = [
            { method: 'HEAD', headers },
            { method: 'GET', headers: { ...headers, Range: `bytes=0-${VERIFY_GET_BYTES - 1}` } },
        ];
        let lastError = null;

        for (const attempt of attempts) {
            let response = null;
            try {
                response = await fetchImpl(url, {
                    method: attempt.method,
                    headers: attempt.headers,
                    redirect: 'follow',
                    signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
                });
                const contentType = String(response.headers?.get?.('content-type') || '')
                    .split(';')[0]
                    .trim()
                    .toLowerCase();
                await this.cancelBody(response);

                if (attempt.method === 'HEAD' && [405, 501].includes(Number(response.status))) {
                    lastError = new Error(`HTTP ${response.status}`);
                    continue;
                }

                return {
                    ok: Boolean(response.ok),
                    blocked: [401, 403, 429].includes(Number(response.status)),
                    method: attempt.method,
                    url: response.url || url,
                    httpStatus: Number(response.status) || null,
                    contentType,
                };
            } catch (error) {
                await this.cancelBody(response);
                lastError = error;
            }
        }

        return {
            ok: false,
            blocked: false,
            method: '',
            url,
            httpStatus: null,
            contentType: '',
            error: lastError?.message || 'Verification failed.',
        };
    }

    async cancelBody(response) {
        try {
            if (typeof response?.body?.cancel === 'function') {
                await response.body.cancel();
            }
        } catch (_error) {
            // Best effort cleanup.
        }
    }
}

const publicSourceIndexService = new PublicSourceIndexService();

module.exports = {
    AUTH_TYPES,
    SOURCE_KINDS,
    STATUSES,
    PublicSourceIndexService,
    publicSourceIndexService,
    resolvePublicSourceIndexPath,
    normalizeEntry,
};
