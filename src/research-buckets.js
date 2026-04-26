const fs = require('fs/promises');
const path = require('path');
const { glob } = require('glob');
const { config } = require('./config');

const DEFAULT_CATEGORIES = Object.freeze([
    'images',
    'data',
    'graphs',
    'code',
    'audio',
    'videos',
    'docs',
    'notes',
    'refs',
]);
const MANIFEST_FILENAME = 'bucket.json';
const MANIFEST_VERSION = 1;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
const DEFAULT_READ_BYTES = 64 * 1024;
const MAX_READ_BYTES = 1024 * 1024;
const MAX_PREVIEW_CHARS = 4000;
const TEXT_EXTENSIONS = new Set([
    'css',
    'csv',
    'htm',
    'html',
    'js',
    'json',
    'jsx',
    'log',
    'markdown',
    'md',
    'mjs',
    'mmd',
    'py',
    'sql',
    'svg',
    'ts',
    'tsx',
    'tsv',
    'txt',
    'xml',
    'yaml',
    'yml',
]);
const MIME_BY_EXTENSION = Object.freeze({
    css: 'text/css',
    csv: 'text/csv',
    gif: 'image/gif',
    htm: 'text/html',
    html: 'text/html',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    js: 'text/javascript',
    json: 'application/json',
    m4a: 'audio/mp4',
    markdown: 'text/markdown',
    md: 'text/markdown',
    mjs: 'text/javascript',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    mmd: 'text/vnd.mermaid',
    mov: 'video/quicktime',
    pdf: 'application/pdf',
    png: 'image/png',
    svg: 'image/svg+xml',
    ts: 'text/typescript',
    tsv: 'text/tab-separated-values',
    txt: 'text/plain',
    wav: 'audio/wav',
    webm: 'video/webm',
    webp: 'image/webp',
    xml: 'application/xml',
    yaml: 'application/yaml',
    yml: 'application/yaml',
});

function resolveResearchBucketRoot(value = process.env.KIMIBUILT_RESEARCH_BUCKET_ROOT || '') {
    const configured = String(value || '').trim();
    if (!configured) {
        return path.join(config.persistence.dataDir, 'research-buckets', 'shared');
    }

    return path.isAbsolute(configured)
        ? path.normalize(configured)
        : path.resolve(process.cwd(), configured);
}

function normalizeSlashPath(value = '') {
    return String(value || '').replace(/\\/g, '/');
}

function normalizeTags(tags = []) {
    const values = Array.isArray(tags) ? tags : String(tags || '').split(',');
    return Array.from(new Set(
        values
            .map((tag) => String(tag || '').trim())
            .filter(Boolean),
    ));
}

function inferExtension(filePath = '') {
    return path.extname(String(filePath || '')).replace(/^\./, '').trim().toLowerCase();
}

function inferMimeType(filePath = '', fallback = '') {
    return String(fallback || '').trim() || MIME_BY_EXTENSION[inferExtension(filePath)] || 'application/octet-stream';
}

function isTextPath(filePath = '', mimeType = '') {
    const normalizedMime = String(mimeType || '').trim().toLowerCase();
    return normalizedMime.startsWith('text/')
        || normalizedMime.includes('json')
        || normalizedMime.includes('xml')
        || normalizedMime.includes('yaml')
        || TEXT_EXTENSIONS.has(inferExtension(filePath));
}

function clampLimit(value, fallback = DEFAULT_LIST_LIMIT, max = MAX_LIST_LIMIT) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.max(1, Math.min(Math.trunc(parsed), max));
}

function clampMaxBytes(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_READ_BYTES;
    }

    return Math.max(1, Math.min(Math.trunc(parsed), MAX_READ_BYTES));
}

function truncatePreview(value = '') {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= MAX_PREVIEW_CHARS) {
        return text;
    }

    return `${text.slice(0, MAX_PREVIEW_CHARS)}...`;
}

function createEmptyManifest(rootPath = '') {
    return {
        version: MANIFEST_VERSION,
        rootPath,
        updatedAt: null,
        categories: [...DEFAULT_CATEGORIES],
        entries: [],
    };
}

function normalizeEntry(entry = {}) {
    return {
        path: normalizeSlashPath(entry.path).trim(),
        category: String(entry.category || '').trim() || inferCategoryFromPath(entry.path),
        mimeType: String(entry.mimeType || '').trim() || inferMimeType(entry.path),
        sizeBytes: Number.isFinite(Number(entry.sizeBytes)) ? Number(entry.sizeBytes) : 0,
        createdAt: entry.createdAt || null,
        updatedAt: entry.updatedAt || entry.createdAt || null,
        tags: normalizeTags(entry.tags),
        description: String(entry.description || '').trim(),
        preview: truncatePreview(entry.preview || ''),
    };
}

function inferCategoryFromPath(filePath = '') {
    const first = normalizeSlashPath(filePath).split('/').find(Boolean) || '';
    return DEFAULT_CATEGORIES.includes(first) ? first : 'refs';
}

class ResearchBucketService {
    constructor(options = {}) {
        this.rootPath = path.resolve(options.rootPath || resolveResearchBucketRoot());
        this.manifestPath = path.join(this.rootPath, MANIFEST_FILENAME);
        this.categories = Array.isArray(options.categories) && options.categories.length > 0
            ? options.categories.map((category) => String(category || '').trim()).filter(Boolean)
            : [...DEFAULT_CATEGORIES];
    }

    getRootPath() {
        return this.rootPath;
    }

    async ensureInitialized() {
        await fs.mkdir(this.rootPath, { recursive: true });
        await Promise.all(this.categories.map((category) => fs.mkdir(path.join(this.rootPath, category), { recursive: true })));
        try {
            await fs.access(this.manifestPath);
        } catch (_error) {
            await this.writeManifest(createEmptyManifest(this.rootPath));
        }

        return {
            rootPath: this.rootPath,
            manifestPath: this.manifestPath,
            categories: [...this.categories],
        };
    }

    resolveSafePath(relativePath = '', options = {}) {
        const rawPath = String(relativePath || '').trim();
        if (!rawPath) {
            throw new Error('Research bucket path is required.');
        }
        if (path.isAbsolute(rawPath) || path.win32.isAbsolute(rawPath) || path.posix.isAbsolute(rawPath)) {
            throw new Error('Research bucket paths must be relative.');
        }

        const requestedCategory = String(options.category || '').trim();
        const slashPath = normalizeSlashPath(rawPath);
        const segments = slashPath.split('/').filter(Boolean);
        if (segments.length === 0) {
            throw new Error('Research bucket path is required.');
        }
        if (segments.some((segment) => segment === '..' || segment === '.' || segment.includes('\0'))) {
            throw new Error('Research bucket paths cannot include traversal segments.');
        }
        if (segments.some((segment) => ['.git', 'node_modules'].includes(segment.toLowerCase()))) {
            throw new Error('Research bucket paths cannot target .git or node_modules.');
        }

        const prefixedSegments = requestedCategory
            && this.categories.includes(requestedCategory)
            && segments[0] !== requestedCategory
            && !this.categories.includes(segments[0])
            ? [requestedCategory, ...segments]
            : segments;
        const normalizedRelativePath = prefixedSegments.join('/');
        const absolutePath = path.resolve(this.rootPath, ...prefixedSegments);
        const relativeToRoot = path.relative(this.rootPath, absolutePath);
        if (!relativeToRoot || relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
            throw new Error('Research bucket path escaped the bucket root.');
        }

        return {
            absolutePath,
            relativePath: normalizeSlashPath(relativeToRoot),
            category: this.categories.includes(prefixedSegments[0]) ? prefixedSegments[0] : inferCategoryFromPath(normalizedRelativePath),
        };
    }

    async readManifest() {
        await this.ensureInitialized();
        try {
            const raw = await fs.readFile(this.manifestPath, 'utf8');
            const parsed = JSON.parse(raw);
            return {
                version: MANIFEST_VERSION,
                rootPath: this.rootPath,
                updatedAt: parsed.updatedAt || null,
                categories: Array.isArray(parsed.categories) ? parsed.categories : [...this.categories],
                entries: Array.isArray(parsed.entries) ? parsed.entries.map((entry) => normalizeEntry(entry)).filter((entry) => entry.path) : [],
            };
        } catch (_error) {
            return createEmptyManifest(this.rootPath);
        }
    }

    async writeManifest(manifest = createEmptyManifest(this.rootPath)) {
        const payload = {
            version: MANIFEST_VERSION,
            rootPath: this.rootPath,
            updatedAt: new Date().toISOString(),
            categories: [...this.categories],
            entries: Array.isArray(manifest.entries)
                ? manifest.entries.map((entry) => normalizeEntry(entry)).filter((entry) => entry.path)
                : [],
        };
        await fs.mkdir(this.rootPath, { recursive: true });
        const tempPath = `${this.manifestPath}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8');
        await fs.rename(tempPath, this.manifestPath);
        return payload;
    }

    async buildEntry(absolutePath, relativePath, manifestEntry = {}) {
        const stats = await fs.stat(absolutePath);
        const mimeType = inferMimeType(relativePath, manifestEntry.mimeType);
        let preview = manifestEntry.preview || '';
        if (stats.isFile() && isTextPath(relativePath, mimeType)) {
            try {
                const handle = await fs.open(absolutePath, 'r');
                try {
                    const buffer = Buffer.alloc(Math.min(stats.size, MAX_PREVIEW_CHARS * 2));
                    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
                    preview = truncatePreview(buffer.subarray(0, bytesRead).toString('utf8'));
                } finally {
                    await handle.close();
                }
            } catch (_error) {
                preview = '';
            }
        }

        return normalizeEntry({
            ...manifestEntry,
            path: relativePath,
            category: manifestEntry.category || inferCategoryFromPath(relativePath),
            mimeType,
            sizeBytes: stats.size,
            createdAt: stats.birthtime instanceof Date ? stats.birthtime.toISOString() : null,
            updatedAt: stats.mtime instanceof Date ? stats.mtime.toISOString() : null,
            preview,
        });
    }

    async refreshManifest() {
        await this.ensureInitialized();
        const previous = await this.readManifest();
        const previousByPath = new Map(previous.entries.map((entry) => [entry.path, entry]));
        const matches = await glob('**/*', {
            cwd: this.rootPath,
            absolute: true,
            nodir: true,
            ignore: [
                MANIFEST_FILENAME,
                `${MANIFEST_FILENAME}.tmp`,
                '**/.git/**',
                '**/node_modules/**',
            ],
        });
        const entries = [];
        for (const absolutePath of matches) {
            const relativePath = normalizeSlashPath(path.relative(this.rootPath, absolutePath));
            entries.push(await this.buildEntry(absolutePath, relativePath, previousByPath.get(relativePath) || {}));
        }
        return this.writeManifest({
            ...previous,
            entries: entries.sort((left, right) => left.path.localeCompare(right.path)),
        });
    }

    async list(params = {}) {
        const manifest = await this.refreshManifest();
        const category = String(params.category || '').trim();
        const query = String(params.query || '').trim().toLowerCase();
        const requestedTags = normalizeTags(params.tags).map((tag) => tag.toLowerCase());
        const limit = clampLimit(params.limit);

        const results = manifest.entries
            .filter((entry) => !category || entry.category === category)
            .filter((entry) => requestedTags.length === 0 || requestedTags.every((tag) => entry.tags.map((value) => value.toLowerCase()).includes(tag)))
            .filter((entry) => {
                if (!query) {
                    return true;
                }
                return [
                    entry.path,
                    entry.category,
                    entry.mimeType,
                    entry.description,
                    entry.tags.join(' '),
                    entry.preview,
                ].join(' ').toLowerCase().includes(query);
            })
            .sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime())
            .slice(0, limit);

        return {
            rootPath: this.rootPath,
            count: results.length,
            results,
        };
    }

    async search(params = {}) {
        const query = String(params.query || '').trim();
        if (!query) {
            throw new Error('research-bucket-search requires a non-empty `query` string.');
        }
        const manifest = await this.refreshManifest();
        const category = String(params.category || '').trim();
        const limit = clampLimit(params.limit);
        const includeSnippets = params.includeSnippets !== false;
        const normalizedQuery = query.toLowerCase();
        let allowedPaths = null;

        if (params.glob) {
            const safeGlob = this.validateSafeGlob(params.glob);
            const matches = await glob(safeGlob, {
                cwd: this.rootPath,
                absolute: false,
                nodir: true,
                ignore: [MANIFEST_FILENAME, `${MANIFEST_FILENAME}.tmp`, '**/.git/**', '**/node_modules/**'],
            });
            allowedPaths = new Set(matches.map((entry) => normalizeSlashPath(entry)));
        }

        const results = [];
        for (const entry of manifest.entries) {
            if (category && entry.category !== category) {
                continue;
            }
            if (allowedPaths && !allowedPaths.has(entry.path)) {
                continue;
            }

            const metadataText = [
                entry.path,
                entry.category,
                entry.mimeType,
                entry.description,
                entry.tags.join(' '),
                entry.preview,
            ].join(' ');
            let matched = metadataText.toLowerCase().includes(normalizedQuery);
            let snippet = '';

            if (isTextPath(entry.path, entry.mimeType)) {
                const { absolutePath } = this.resolveSafePath(entry.path);
                try {
                    const content = await fs.readFile(absolutePath, 'utf8');
                    const index = content.toLowerCase().indexOf(normalizedQuery);
                    if (index >= 0) {
                        matched = true;
                        if (includeSnippets) {
                            const start = Math.max(0, index - 120);
                            const end = Math.min(content.length, index + query.length + 120);
                            snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();
                        }
                    }
                } catch (_error) {
                    // Metadata matching still applies when content cannot be read as text.
                }
            }

            if (matched) {
                results.push({
                    ...entry,
                    ...(snippet ? { snippet } : {}),
                });
            }
        }

        return {
            query,
            count: Math.min(results.length, limit),
            results: results.slice(0, limit),
        };
    }

    validateSafeGlob(pattern = '') {
        const normalized = normalizeSlashPath(pattern).trim();
        if (!normalized) {
            throw new Error('Research bucket glob cannot be empty.');
        }
        if (path.isAbsolute(normalized) || path.win32.isAbsolute(normalized) || normalized.split('/').includes('..')) {
            throw new Error('Research bucket glob must stay inside the bucket.');
        }
        return normalized;
    }

    async read(params = {}) {
        const mode = String(params.mode || 'preview').trim().toLowerCase();
        if (!['preview', 'content', 'base64'].includes(mode)) {
            throw new Error('research-bucket-read mode must be "preview", "content", or "base64".');
        }
        const maxBytes = clampMaxBytes(params.maxBytes);
        const { absolutePath, relativePath } = this.resolveSafePath(params.path);
        const manifest = await this.refreshManifest();
        const entry = manifest.entries.find((candidate) => candidate.path === relativePath);
        if (!entry) {
            throw new Error('Research bucket file not found.');
        }
        const stats = await fs.stat(absolutePath);
        const metadata = {
            ...entry,
            truncated: stats.size > maxBytes,
            maxBytes,
        };

        if (mode === 'base64') {
            const buffer = await this.readBufferPrefix(absolutePath, maxBytes);
            return {
                ...metadata,
                encoding: 'base64',
                content: buffer.toString('base64'),
            };
        }

        if (!isTextPath(entry.path, entry.mimeType)) {
            return metadata;
        }

        if (mode === 'preview') {
            return {
                ...metadata,
                content: entry.preview,
            };
        }

        const buffer = await this.readBufferPrefix(absolutePath, maxBytes);
        return {
            ...metadata,
            encoding: 'utf8',
            content: buffer.toString('utf8'),
        };
    }

    async readBufferPrefix(absolutePath, maxBytes) {
        const handle = await fs.open(absolutePath, 'r');
        try {
            const stats = await handle.stat();
            const buffer = Buffer.alloc(Math.min(stats.size, maxBytes));
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            return buffer.subarray(0, bytesRead);
        } finally {
            await handle.close();
        }
    }

    async write(params = {}) {
        const encoding = String(params.encoding || 'utf8').trim().toLowerCase();
        if (!['utf8', 'base64'].includes(encoding)) {
            throw new Error('research-bucket-write encoding must be "utf8" or "base64".');
        }
        if (!Object.prototype.hasOwnProperty.call(params, 'content')) {
            throw new Error('research-bucket-write requires `content`.');
        }
        const { absolutePath, relativePath, category } = this.resolveSafePath(params.path, {
            category: params.category,
        });
        const content = encoding === 'base64'
            ? Buffer.from(String(params.content || ''), 'base64')
            : Buffer.from(String(params.content || ''), 'utf8');
        await this.ensureInitialized();
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, content);

        const manifest = await this.refreshManifest();
        const entries = manifest.entries.filter((entry) => entry.path !== relativePath);
        const entry = await this.buildEntry(absolutePath, relativePath, {
            category: String(params.category || '').trim() || category,
            mimeType: inferMimeType(relativePath, params.mimeType),
            tags: normalizeTags(params.tags),
            description: String(params.description || '').trim(),
        });
        entries.push(entry);
        await this.writeManifest({
            ...manifest,
            entries: entries.sort((left, right) => left.path.localeCompare(right.path)),
        });

        return {
            path: relativePath,
            absolutePath,
            bytesWritten: content.length,
            entry,
        };
    }

    async mkdir(params = {}) {
        const { absolutePath, relativePath, category } = this.resolveSafePath(params.path);
        await this.ensureInitialized();
        await fs.mkdir(absolutePath, { recursive: true });
        return {
            path: relativePath,
            absolutePath,
            category,
            created: true,
        };
    }
}

const researchBucketService = new ResearchBucketService();

module.exports = {
    DEFAULT_CATEGORIES,
    ResearchBucketService,
    researchBucketService,
    resolveResearchBucketRoot,
    isTextPath,
};
