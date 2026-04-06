const fs = require('fs/promises');
const path = require('path');
const { glob } = require('glob');
const { artifactStore } = require('./artifacts/artifact-store');
const { postgres } = require('./postgres');
const {
    PROJECT_ROOT,
    getStateDirectory,
    resolvePreferredWritableFile,
} = require('./runtime-state-paths');

const ASSET_INDEX_VERSION = 1;
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;
const MAX_INDEXED_TEXT_CHARS = 4000;
const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const WORKSPACE_GLOB = '**/*.{png,jpg,jpeg,gif,webp,svg,avif,bmp,pdf,doc,docx,ppt,pptx,xls,xlsx,csv,tsv,md,markdown,txt,html,htm,json,yaml,yml,xml}';
const WORKSPACE_IGNORE_PATTERNS = Object.freeze([
    '**/node_modules/**',
    '**/.git/**',
    '**/coverage/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/.cache/**',
]);
const IMAGE_EXTENSIONS = new Set([
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'svg',
    'avif',
    'bmp',
]);
const DOCUMENT_EXTENSIONS = new Set([
    'pdf',
    'doc',
    'docx',
    'ppt',
    'pptx',
    'xls',
    'xlsx',
    'csv',
    'tsv',
    'md',
    'markdown',
    'txt',
    'html',
    'htm',
    'json',
    'yaml',
    'yml',
    'xml',
]);
const TEXT_DOCUMENT_EXTENSIONS = new Set([
    'csv',
    'tsv',
    'md',
    'markdown',
    'txt',
    'html',
    'htm',
    'json',
    'yaml',
    'yml',
    'xml',
]);
const MIME_BY_EXTENSION = Object.freeze({
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    avif: 'image/avif',
    bmp: 'image/bmp',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    md: 'text/markdown',
    markdown: 'text/markdown',
    txt: 'text/plain',
    html: 'text/html',
    htm: 'text/html',
    json: 'application/json',
    yaml: 'application/yaml',
    yml: 'application/yaml',
    xml: 'application/xml',
});

function getAssetIndexFilePath() {
    const configured = String(process.env.KIMIBUILT_ASSET_INDEX_PATH || '').trim();
    if (configured) {
        return path.resolve(PROJECT_ROOT, configured);
    }

    return resolvePreferredWritableFile(
        path.join(PROJECT_ROOT, 'asset-index.json'),
        ['asset-index.json'],
    );
}

function normalizePathKey(value = '') {
    return String(value || '')
        .trim()
        .replace(/\//g, path.sep)
        .toLowerCase();
}

function clampLimit(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return DEFAULT_SEARCH_LIMIT;
    }

    return Math.max(1, Math.min(Math.trunc(numeric), MAX_SEARCH_LIMIT));
}

function normalizeText(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateText(value = '', limit = MAX_INDEXED_TEXT_CHARS) {
    const text = normalizeText(value);
    if (!text) {
        return '';
    }

    if (text.length <= limit) {
        return text;
    }

    return `${text.slice(0, limit)}...`;
}

function stripHtmlToText(html = '') {
    return String(html || '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, '\'')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

function inferExtension(filename = '', fallback = '') {
    const raw = path.extname(String(filename || '').trim()).replace(/^\./, '').toLowerCase();
    return raw || String(fallback || '').trim().replace(/^\./, '').toLowerCase();
}

function inferAssetKind({ mimeType = '', extension = '' } = {}) {
    const normalizedMime = String(mimeType || '').trim().toLowerCase();
    const normalizedExtension = inferExtension('', extension);

    if (normalizedMime.startsWith('image/') || IMAGE_EXTENSIONS.has(normalizedExtension)) {
        return 'image';
    }

    if (normalizedMime.startsWith('text/')
        || normalizedMime.includes('json')
        || normalizedMime.includes('xml')
        || normalizedMime.includes('yaml')
        || DOCUMENT_EXTENSIONS.has(normalizedExtension)) {
        return 'document';
    }

    return 'other';
}

function isTextDocumentExtension(extension = '') {
    return TEXT_DOCUMENT_EXTENSIONS.has(inferExtension('', extension));
}

function inferMimeType(filename = '', extension = '') {
    const resolvedExtension = inferExtension(filename, extension);
    return MIME_BY_EXTENSION[resolvedExtension] || 'application/octet-stream';
}

function deriveTitle(filename = '', metadata = {}) {
    const explicit = [
        metadata?.title,
        metadata?.label,
        metadata?.altText,
        metadata?.originalFilename,
    ].find((value) => typeof value === 'string' && value.trim());

    if (explicit) {
        return explicit.trim();
    }

    const basename = path.basename(String(filename || '').trim());
    const withoutExtension = basename.replace(/\.[^.]+$/u, '');
    return withoutExtension || basename || 'Untitled asset';
}

function buildArtifactDownloadUrl(id = '') {
    return `/api/artifacts/${id}/download`;
}

function buildArtifactInlineUrl(id = '') {
    return `/api/artifacts/${id}/download?inline=1`;
}

function tokenizeQuery(query = '') {
    return String(query || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2);
}

function normalizeWorkspaceRoots(configuredRoots = [], projectRoot = PROJECT_ROOT, stateDir = getStateDirectory()) {
    const configured = (Array.isArray(configuredRoots) ? configuredRoots : [])
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
    const roots = configured.length > 0
        ? configured
        : [projectRoot, stateDir];

    return Array.from(new Set(
        roots
            .map((entry) => path.resolve(entry))
            .filter(Boolean),
    ));
}

function createEmptyIndex() {
    return {
        version: ASSET_INDEX_VERSION,
        updatedAt: null,
        workspaceIndexedAt: null,
        artifactsIndexedAt: null,
        entries: [],
    };
}

function normalizeEntry(entry = {}) {
    const normalized = {
        id: String(entry.id || '').trim(),
        sourceType: String(entry.sourceType || '').trim() || 'workspace',
        kind: String(entry.kind || '').trim() || 'other',
        title: String(entry.title || '').trim() || 'Untitled asset',
        filename: String(entry.filename || '').trim() || '',
        absolutePath: entry.absolutePath ? path.resolve(String(entry.absolutePath)) : null,
        relativePath: String(entry.relativePath || '').trim() || null,
        artifactId: String(entry.artifactId || '').trim() || null,
        sessionId: String(entry.sessionId || '').trim() || null,
        ownerId: String(entry.ownerId || '').trim() || null,
        mimeType: String(entry.mimeType || '').trim() || '',
        extension: inferExtension(entry.filename, entry.extension),
        sizeBytes: Number.isFinite(Number(entry.sizeBytes)) ? Number(entry.sizeBytes) : 0,
        createdAt: entry.createdAt || null,
        updatedAt: entry.updatedAt || entry.createdAt || null,
        downloadUrl: String(entry.downloadUrl || '').trim() || null,
        inlineUrl: String(entry.inlineUrl || '').trim() || null,
        sourceMode: String(entry.sourceMode || '').trim() || null,
        direction: String(entry.direction || '').trim() || null,
        workspaceRoot: entry.workspaceRoot ? path.resolve(String(entry.workspaceRoot)) : null,
        tags: Array.isArray(entry.tags) ? entry.tags.map((tag) => String(tag || '').trim()).filter(Boolean) : [],
        contentPreview: truncateText(entry.contentPreview || ''),
        metadataSummary: truncateText(entry.metadataSummary || '', 800),
    };

    normalized.searchText = normalizeText([
        normalized.title,
        normalized.filename,
        normalized.relativePath,
        normalized.absolutePath,
        normalized.mimeType,
        normalized.extension,
        normalized.sourceMode,
        normalized.direction,
        normalized.tags.join(' '),
        normalized.metadataSummary,
        normalized.contentPreview,
    ].filter(Boolean).join(' ')).toLowerCase();

    return normalized;
}

function hasAssetReferenceIntent(text = '') {
    const normalized = String(text || '').trim();
    if (!normalized) {
        return false;
    }

    return [
        /\b(previous|earlier|prior|last|latest|same|that|those|these|uploaded|attached|generated|saved|working with|worked on)\b[\s\S]{0,50}\b(image|images|photo|photos|picture|pictures|document|documents|doc|docs|pdf|slide deck|deck|pptx|file|files|artifact|artifacts|attachment|attachments)\b/i,
        /\b(image|images|photo|photos|picture|pictures|document|documents|doc|docs|pdf|slide deck|deck|pptx|file|files|artifact|artifacts|attachment|attachments)\b[\s\S]{0,70}\b(from earlier|from before|from last time|we worked on|we were working with|you generated|you made|you created|uploaded|attached|saved)\b/i,
        /\b(find|search|locate|list|show|open|use|reuse|reference|pull up|look for)\b[\s\S]{0,40}\b(previous|earlier|uploaded|attached|generated|saved|artifact|image|document|pdf|file|attachment)\b/i,
        /\b(asset|assets)\b[\s\S]{0,20}\b(search|index|indexed|catalog|catalogue|manager)\b/i,
    ].some((pattern) => pattern.test(normalized));
}

function buildAssetManagerInstructions() {
    return [
        '[Indexed asset manager]',
        'When available in the runtime, use `asset-search` to find uploaded artifacts plus local workspace documents and images.',
        'Use `asset-search` first when the user refers to a previous, earlier, uploaded, attached, or generated file, image, document, PDF, or artifact.',
        'For images, prefer `kind: "image"` so you can quickly recover the right visual and reuse its `inlineUrl` or path.',
        'For documents, prefer `kind: "document"` and set `includeContent: true` when you need the stored text preview before deciding what to read or reuse.',
    ].join('\n');
}

class AssetManager {
    constructor(options = {}) {
        this.projectRoot = path.resolve(options.projectRoot || PROJECT_ROOT);
        this.stateDir = path.resolve(options.stateDir || getStateDirectory());
        this.indexFilePath = path.resolve(options.indexFilePath || getAssetIndexFilePath());
        this.artifactStore = options.artifactStore || artifactStore;
        this.postgres = options.postgres || postgres;
        this.workspaceRoots = normalizeWorkspaceRoots(
            options.workspaceRoots
            || String(process.env.KIMIBUILT_ASSET_ROOTS || '')
                .split(',')
                .map((entry) => entry.trim())
                .filter(Boolean),
            this.projectRoot,
            this.stateDir,
        );
    }

    async pathExists(targetPath = '') {
        try {
            await fs.access(targetPath);
            return true;
        } catch (_error) {
            return false;
        }
    }

    async readIndex() {
        try {
            const raw = await fs.readFile(this.indexFilePath, 'utf8');
            const parsed = JSON.parse(raw);
            const entries = Array.isArray(parsed?.entries) ? parsed.entries.map((entry) => normalizeEntry(entry)) : [];

            return {
                version: ASSET_INDEX_VERSION,
                updatedAt: parsed?.updatedAt || null,
                workspaceIndexedAt: parsed?.workspaceIndexedAt || null,
                artifactsIndexedAt: parsed?.artifactsIndexedAt || null,
                entries,
            };
        } catch (_error) {
            return createEmptyIndex();
        }
    }

    async writeIndex(index = createEmptyIndex()) {
        const payload = {
            version: ASSET_INDEX_VERSION,
            updatedAt: new Date().toISOString(),
            workspaceIndexedAt: index.workspaceIndexedAt || null,
            artifactsIndexedAt: index.artifactsIndexedAt || null,
            entries: Array.isArray(index.entries) ? index.entries.map((entry) => normalizeEntry(entry)) : [],
        };

        await fs.mkdir(path.dirname(this.indexFilePath), { recursive: true });
        const tempPath = `${this.indexFilePath}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8');
        await fs.rename(tempPath, this.indexFilePath);

        return payload;
    }

    async buildWorkspaceEntry(absolutePath, workspaceRoot) {
        if (normalizePathKey(absolutePath) === normalizePathKey(this.indexFilePath)
            || normalizePathKey(absolutePath) === normalizePathKey(`${this.indexFilePath}.tmp`)) {
            return null;
        }

        let stats;
        try {
            stats = await fs.stat(absolutePath);
        } catch (_error) {
            return null;
        }

        if (!stats.isFile()) {
            return null;
        }

        const filename = path.basename(absolutePath);
        const extension = inferExtension(filename);
        const kind = inferAssetKind({ extension });
        if (!['image', 'document'].includes(kind)) {
            return null;
        }

        let contentPreview = '';
        if (kind === 'document' && isTextDocumentExtension(extension) && stats.size <= MAX_TEXT_FILE_BYTES) {
            try {
                contentPreview = truncateText(await fs.readFile(absolutePath, 'utf8'));
            } catch (_error) {
                contentPreview = '';
            }
        }

        const relativeToProject = path.relative(this.projectRoot, absolutePath);
        const relativePath = !relativeToProject.startsWith('..') && !path.isAbsolute(relativeToProject)
            ? relativeToProject
            : path.relative(workspaceRoot, absolutePath);

        return normalizeEntry({
            id: `workspace:${normalizePathKey(absolutePath)}`,
            sourceType: 'workspace',
            kind,
            title: deriveTitle(filename),
            filename,
            absolutePath,
            relativePath,
            mimeType: inferMimeType(filename, extension),
            extension,
            sizeBytes: stats.size,
            createdAt: stats.birthtime instanceof Date ? stats.birthtime.toISOString() : null,
            updatedAt: stats.mtime instanceof Date ? stats.mtime.toISOString() : null,
            workspaceRoot,
            contentPreview,
            metadataSummary: relativePath,
        });
    }

    buildArtifactEntry(artifact = {}, ownerId = null) {
        const extension = inferExtension(artifact.filename, artifact.extension || artifact.format);
        const metadata = artifact.metadata && typeof artifact.metadata === 'object'
            ? artifact.metadata
            : {};
        const kind = inferAssetKind({
            mimeType: artifact.mimeType,
            extension,
        });
        const contentPreview = truncateText(
            artifact.extractedText
            || stripHtmlToText(artifact.previewHtml || ''),
        );
        const tags = Array.isArray(metadata.tags) ? metadata.tags : [];

        return normalizeEntry({
            id: `artifact:${artifact.id}`,
            sourceType: 'artifact',
            kind,
            title: deriveTitle(artifact.filename, metadata),
            filename: artifact.filename,
            artifactId: artifact.id,
            sessionId: artifact.sessionId,
            ownerId,
            mimeType: artifact.mimeType || inferMimeType(artifact.filename, extension),
            extension,
            sizeBytes: artifact.sizeBytes || 0,
            createdAt: artifact.createdAt || null,
            updatedAt: artifact.updatedAt || artifact.createdAt || null,
            downloadUrl: buildArtifactDownloadUrl(artifact.id),
            inlineUrl: kind === 'image' ? buildArtifactInlineUrl(artifact.id) : null,
            sourceMode: artifact.sourceMode || null,
            direction: artifact.direction || null,
            tags,
            contentPreview,
            metadataSummary: truncateText([
                metadata.label,
                metadata.originalFilename,
                metadata.generatedBy,
                metadata.sourcePrompt,
            ].filter(Boolean).join(' '), 800),
        });
    }

    async upsertArtifact(artifact = {}, options = {}) {
        if (!artifact?.id) {
            return null;
        }

        const index = await this.readIndex();
        const entry = this.buildArtifactEntry(
            artifact,
            options.ownerId || options.session?.metadata?.ownerId || null,
        );
        const nextEntries = index.entries.filter((candidate) => candidate.id !== entry.id);
        nextEntries.push(entry);
        await this.writeIndex({
            ...index,
            entries: nextEntries,
            artifactsIndexedAt: new Date().toISOString(),
        });
        return entry;
    }

    async removeArtifact(artifactId = '') {
        if (!artifactId) {
            return false;
        }

        const entryId = `artifact:${artifactId}`;
        const index = await this.readIndex();
        const nextEntries = index.entries.filter((entry) => entry.id !== entryId);
        if (nextEntries.length === index.entries.length) {
            return false;
        }

        await this.writeIndex({
            ...index,
            entries: nextEntries,
            artifactsIndexedAt: new Date().toISOString(),
        });
        return true;
    }

    async removeArtifactsForSession(sessionId = '') {
        const normalizedSessionId = String(sessionId || '').trim();
        if (!normalizedSessionId) {
            return 0;
        }

        const index = await this.readIndex();
        const nextEntries = index.entries.filter((entry) => !(entry.sourceType === 'artifact' && entry.sessionId === normalizedSessionId));
        const removed = index.entries.length - nextEntries.length;
        if (removed <= 0) {
            return 0;
        }

        await this.writeIndex({
            ...index,
            entries: nextEntries,
            artifactsIndexedAt: new Date().toISOString(),
        });
        return removed;
    }

    async upsertWorkspacePath(targetPath = '') {
        const absolutePath = path.resolve(String(targetPath || '').trim());
        const extension = inferExtension(absolutePath);
        if (!IMAGE_EXTENSIONS.has(extension) && !DOCUMENT_EXTENSIONS.has(extension)) {
            return null;
        }

        const workspaceRoot = this.workspaceRoots.find((root) => {
            const relative = path.relative(root, absolutePath);
            return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
        }) || this.projectRoot;
        const entry = await this.buildWorkspaceEntry(absolutePath, workspaceRoot);
        const index = await this.readIndex();
        const entryId = `workspace:${normalizePathKey(absolutePath)}`;
        const nextEntries = index.entries.filter((candidate) => candidate.id !== entryId);

        if (entry) {
            nextEntries.push(entry);
        }

        await this.writeIndex({
            ...index,
            entries: nextEntries,
            workspaceIndexedAt: new Date().toISOString(),
        });
        return entry;
    }

    async refreshWorkspaceIndex(existingIndex = null) {
        const index = existingIndex || await this.readIndex();
        const workspaceEntries = new Map();

        for (const workspaceRoot of this.workspaceRoots) {
            if (!await this.pathExists(workspaceRoot)) {
                continue;
            }

            const matches = await glob(WORKSPACE_GLOB, {
                cwd: workspaceRoot,
                absolute: true,
                nodir: true,
                ignore: WORKSPACE_IGNORE_PATTERNS,
            });

            for (const absolutePath of matches) {
                const entry = await this.buildWorkspaceEntry(absolutePath, workspaceRoot);
                if (entry) {
                    workspaceEntries.set(entry.id, entry);
                }
            }
        }

        const nextIndex = {
            ...index,
            entries: [
                ...index.entries.filter((entry) => entry.sourceType !== 'workspace'),
                ...workspaceEntries.values(),
            ],
            workspaceIndexedAt: new Date().toISOString(),
        };
        await this.writeIndex(nextIndex);

        return {
            index: nextIndex,
            count: workspaceEntries.size,
        };
    }

    async refreshArtifactIndex(existingIndex = null) {
        const index = existingIndex || await this.readIndex();
        const artifactRows = typeof this.artifactStore?.listAllWithSessions === 'function'
            ? await this.artifactStore.listAllWithSessions()
            : [];
        const artifactEntries = artifactRows.map((artifact) => this.buildArtifactEntry(artifact, artifact.ownerId || null));
        const nextIndex = {
            ...index,
            entries: [
                ...index.entries.filter((entry) => entry.sourceType !== 'artifact'),
                ...artifactEntries,
            ],
            artifactsIndexedAt: new Date().toISOString(),
        };
        await this.writeIndex(nextIndex);

        return {
            index: nextIndex,
            count: artifactEntries.length,
        };
    }

    async ensureIndex(options = {}) {
        let index = await this.readIndex();
        const refreshed = {
            workspace: false,
            artifacts: false,
        };
        const shouldRefreshWorkspace = options.refresh === true || !index.workspaceIndexedAt;
        const shouldRefreshArtifacts = (options.refresh === true || !index.artifactsIndexedAt)
            && Boolean(this.postgres?.enabled);

        if (shouldRefreshWorkspace) {
            const workspaceRefresh = await this.refreshWorkspaceIndex(index);
            index = workspaceRefresh.index;
            refreshed.workspace = true;
        }

        if (shouldRefreshArtifacts) {
            const artifactRefresh = await this.refreshArtifactIndex(index);
            index = artifactRefresh.index;
            refreshed.artifacts = true;
        }

        return {
            index,
            refreshed,
        };
    }

    scoreEntry(entry = {}, query = '', tokens = [], context = {}) {
        const normalizedQuery = normalizeText(query).toLowerCase();
        if (!normalizedQuery) {
            return entry.updatedAt ? new Date(entry.updatedAt).getTime() : 0;
        }

        const filename = String(entry.filename || '').toLowerCase();
        const title = String(entry.title || '').toLowerCase();
        const relativePath = String(entry.relativePath || '').toLowerCase();
        const absolutePath = String(entry.absolutePath || '').toLowerCase();
        const searchText = String(entry.searchText || '').toLowerCase();
        let score = 0;

        if (title.includes(normalizedQuery)) score += 30;
        if (filename.includes(normalizedQuery)) score += 25;
        if (relativePath.includes(normalizedQuery)) score += 20;
        if (absolutePath.includes(normalizedQuery)) score += 20;
        if (searchText.includes(normalizedQuery)) score += 10;

        tokens.forEach((token) => {
            if (title.includes(token)) score += 8;
            if (filename.includes(token)) score += 7;
            if (relativePath.includes(token) || absolutePath.includes(token)) score += 5;
            if (searchText.includes(token)) score += 2;
        });

        if (context.sessionId && entry.sessionId === context.sessionId) {
            score += 6;
        }

        if (entry.sourceType === 'artifact') {
            score += 2;
        }

        return score;
    }

    buildSearchResult(entry = {}, includeContent = false) {
        return {
            id: entry.id,
            sourceType: entry.sourceType,
            kind: entry.kind,
            title: entry.title,
            filename: entry.filename,
            absolutePath: entry.absolutePath,
            relativePath: entry.relativePath,
            artifactId: entry.artifactId,
            sessionId: entry.sessionId,
            mimeType: entry.mimeType,
            extension: entry.extension,
            sizeBytes: entry.sizeBytes,
            tags: entry.tags,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            downloadUrl: entry.downloadUrl,
            inlineUrl: entry.inlineUrl,
            ...(includeContent && entry.contentPreview
                ? { contentPreview: entry.contentPreview }
                : {}),
        };
    }

    async searchAssets(params = {}, context = {}) {
        const query = String(params.query || '').trim();
        const kind = ['image', 'document'].includes(String(params.kind || '').trim().toLowerCase())
            ? String(params.kind).trim().toLowerCase()
            : 'any';
        const sourceType = ['artifact', 'workspace'].includes(String(params.sourceType || '').trim().toLowerCase())
            ? String(params.sourceType).trim().toLowerCase()
            : 'any';
        const sessionId = String(params.sessionId || context.sessionId || '').trim() || null;
        const ownerId = String(context.ownerId || '').trim() || null;
        const includeContent = params.includeContent === true;
        const limit = clampLimit(params.limit);
        const { index, refreshed } = await this.ensureIndex({ refresh: params.refresh === true });
        const tokens = tokenizeQuery(query);

        const matches = index.entries
            .filter((entry) => sourceType === 'any' || entry.sourceType === sourceType)
            .filter((entry) => kind === 'any' || entry.kind === kind)
            .filter((entry) => !ownerId || entry.sourceType !== 'artifact' || !entry.ownerId || entry.ownerId === ownerId)
            .map((entry) => ({
                entry,
                score: this.scoreEntry(entry, query, tokens, { sessionId }),
            }))
            .filter((candidate) => !query || candidate.score > 0)
            .sort((left, right) => {
                if (right.score !== left.score) {
                    return right.score - left.score;
                }

                return new Date(right.entry.updatedAt || 0).getTime() - new Date(left.entry.updatedAt || 0).getTime();
            });

        const results = matches
            .slice(0, limit)
            .map((candidate) => this.buildSearchResult(candidate.entry, includeContent));

        return {
            query,
            kind,
            sourceType,
            sessionId,
            count: results.length,
            refreshed,
            results,
        };
    }
}

const assetManager = new AssetManager();

module.exports = {
    AssetManager,
    assetManager,
    buildAssetManagerInstructions,
    getAssetIndexFilePath,
    hasAssetReferenceIntent,
    inferAssetKind,
};
