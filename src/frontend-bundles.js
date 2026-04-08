const path = require('path').posix;
const { createZip, readZipEntries } = require('./utils/zip');
const { createUniqueFilename, stripHtml } = require('./utils/text');

const MAX_FRONTEND_BUNDLE_EXTRACTED_TEXT_CHARS = 20000;

const CONTENT_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.gif': 'image/gif',
    '.htm': 'text/html; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.webp': 'image/webp',
    '.xml': 'application/xml; charset=utf-8',
};

function inferFrontendTitle(content = '') {
    const match = String(content || '').match(/<title>\s*([^<]+)\s*<\/title>/i)
        || String(content || '').match(/<h1[^>]*>\s*([^<]+)\s*<\/h1>/i);
    return match?.[1]?.trim() || 'Frontend Demo';
}

function normalizeBundlePath(filePath = '') {
    const normalized = String(filePath || '')
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .replace(/^\/+/, '')
        .trim();
    if (!normalized) {
        return '';
    }

    const safePath = path.normalize(normalized);
    if (!safePath || safePath === '.' || safePath.startsWith('../') || safePath.includes('/../')) {
        return '';
    }

    return safePath;
}

function inferBundleLanguage(filePath = '') {
    const extension = path.extname(String(filePath || '').toLowerCase());
    switch (extension) {
    case '.css':
        return 'css';
    case '.js':
    case '.mjs':
        return 'javascript';
    case '.json':
        return 'json';
    case '.svg':
        return 'svg';
    case '.html':
    case '.htm':
        return 'html';
    default:
        return null;
    }
}

function normalizeFrontendRouting(value = '') {
    return String(value || '').trim().toLowerCase() === 'spa'
        ? 'spa'
        : 'multipage';
}

function resolveBundleSource(bundle = null) {
    return bundle?.files || bundle?.assets || bundle?.entries || null;
}

function normalizeFrontendBundle(bundle = null, content = '') {
    const files = [];
    const source = resolveBundleSource(bundle);

    if (Array.isArray(source)) {
        source.forEach((entry) => {
            if (!entry || typeof entry !== 'object') {
                return;
            }

            const fileContent = typeof entry.content === 'string'
                ? entry.content
                : (typeof entry.contents === 'string' ? entry.contents : '');
            const filePath = normalizeBundlePath(entry.path || entry.name || '');
            if (!filePath || !fileContent.trim()) {
                return;
            }

            files.push({
                path: filePath,
                language: String(entry.language || '').trim() || inferBundleLanguage(filePath),
                purpose: String(entry.purpose || '').trim() || null,
                content: fileContent,
            });
        });
    } else if (source && typeof source === 'object') {
        Object.entries(source).forEach(([filePath, fileContent]) => {
            const normalizedPath = normalizeBundlePath(filePath);
            if (!normalizedPath || typeof fileContent !== 'string' || !fileContent.trim()) {
                return;
            }

            files.push({
                path: normalizedPath,
                language: inferBundleLanguage(normalizedPath),
                purpose: null,
                content: fileContent,
            });
        });
    }

    if (!files.find((entry) => entry.path.toLowerCase() === 'index.html') && String(content || '').trim()) {
        files.unshift({
            path: 'index.html',
            language: 'html',
            purpose: 'Standalone demo entry point for preview and export.',
            content: String(content || '').trim(),
        });
    }

    const requestedEntry = normalizeBundlePath(bundle?.entry || bundle?.entryFile || 'index.html');
    const entry = files.find((file) => file.path === requestedEntry)
        ? requestedEntry
        : (files.find((file) => /\.html?$/i.test(file.path))?.path || 'index.html');

    return {
        entry,
        frameworkTarget: String(bundle?.frameworkTarget || bundle?.framework || 'static').trim().toLowerCase() || 'static',
        routing: normalizeFrontendRouting(bundle?.routing || bundle?.routeMode || bundle?.mode),
        files,
    };
}

function normalizeFrontendHandoff(handoff = null, metadata = {}, content = '') {
    const targetFramework = String(
        handoff?.targetFramework
        || handoff?.framework
        || metadata.frameworkTarget
        || metadata.framework
        || 'static'
    ).trim() || 'static';

    const componentMap = Array.isArray(handoff?.componentMap)
        ? handoff.componentMap
            .map((entry) => ({
                name: String(entry?.name || '').trim(),
                purpose: String(entry?.purpose || '').trim(),
                targetPath: normalizeBundlePath(entry?.targetPath || '') || null,
            }))
            .filter((entry) => entry.name && entry.purpose)
        : [];

    const integrationSteps = Array.isArray(handoff?.integrationSteps)
        ? handoff.integrationSteps
            .map((entry) => String(entry || '').trim())
            .filter(Boolean)
        : [];

    return {
        summary: String(
            handoff?.summary
            || metadata.summary
            || 'Portable frontend demo with a standalone preview and repo-ready file guidance.'
        ).trim() || 'Portable frontend demo with a standalone preview and repo-ready file guidance.',
        targetFramework,
        componentMap,
        integrationSteps: integrationSteps.length > 0
            ? integrationSteps
            : [
                'Keep the generated demo as a visual reference first, then split it into project components.',
                'Move shared colors, spacing, and typography into your design system tokens.',
                'Replace demo copy, mock data, and inline scripts with live project data and components.',
            ],
        entryFile: normalizeBundlePath(handoff?.entryFile || 'index.html') || 'index.html',
        sourceType: /<html\b/i.test(String(content || '')) ? 'standalone-html' : 'markup-fragment',
    };
}

function buildFrontendFallbackMetadata(content = '') {
    const title = inferFrontendTitle(content);
    return {
        type: 'frontend',
        title,
        language: 'html',
        frameworkTarget: 'static',
        previewMode: 'iframe',
        bundle: normalizeFrontendBundle(null, content),
        handoff: normalizeFrontendHandoff({ summary: `Standalone frontend demo for ${title}.` }, {}, content),
    };
}

function normalizeFrontendMetadata(metadata = {}, content = '') {
    const normalized = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? { ...metadata }
        : {};

    return {
        ...normalized,
        type: 'frontend',
        title: String(normalized.title || '').trim() || inferFrontendTitle(content),
        language: String(normalized.language || 'html').trim() || 'html',
        frameworkTarget: String(normalized.frameworkTarget || normalized.framework || 'static').trim() || 'static',
        previewMode: 'iframe',
        bundle: normalizeFrontendBundle(normalized.bundle, content),
        handoff: normalizeFrontendHandoff(normalized.handoff, normalized, content),
    };
}

function getFrontendBundleFile(bundle = null, requestedPath = '') {
    const normalizedBundle = normalizeFrontendBundle(bundle);
    const targetPath = normalizeBundlePath(requestedPath);
    const candidates = targetPath
        ? [
            targetPath,
            targetPath.endsWith('/') ? `${targetPath.replace(/\/+$/g, '')}/index.html` : `${targetPath}/index.html`,
            !path.extname(targetPath) ? `${targetPath}.html` : '',
        ].filter(Boolean)
        : [normalizedBundle.entry];

    for (const candidate of candidates) {
        const file = normalizedBundle.files.find((entry) => entry.path === candidate);
        if (file) {
            return file;
        }
    }

    if (normalizedBundle.routing === 'spa' && targetPath && !path.extname(targetPath)) {
        return normalizedBundle.files.find((entry) => entry.path === normalizedBundle.entry) || null;
    }

    return null;
}

function hasFrontendBundleFiles(bundle = null) {
    return Array.isArray(bundle?.files) && bundle.files.length > 0;
}

function hasFrontendBundleArchive(bundle = null) {
    return hasFrontendBundleFiles(bundle) && bundle.files.length > 1;
}

function createFrontendBundleArchive(bundle = null) {
    const normalizedBundle = normalizeFrontendBundle(bundle);
    return createZip(normalizedBundle.files.map((file) => ({
        name: file.path,
        data: file.content,
    })));
}

function buildFrontendBundleExtractedText(bundle = null) {
    const normalized = normalizeFrontendBundle(bundle);
    const parts = [];

    for (const file of normalized.files) {
        const source = String(file.content || '');
        if (!source.trim()) {
            continue;
        }

        const body = /\.html?$/i.test(file.path)
            ? stripHtml(source)
            : source;
        if (!body.trim()) {
            continue;
        }

        parts.push(`[${file.path}]\n${body.trim()}`);
        if (parts.join('\n\n').length >= MAX_FRONTEND_BUNDLE_EXTRACTED_TEXT_CHARS) {
            break;
        }
    }

    return parts.join('\n\n').slice(0, MAX_FRONTEND_BUNDLE_EXTRACTED_TEXT_CHARS);
}

function buildFrontendBundleArtifact(bundle = null, title = 'Frontend Bundle') {
    const normalized = normalizeFrontendBundle(bundle);
    const entryFile = normalized.files.find((file) => file.path === normalized.entry)
        || normalized.files.find((file) => /\.html?$/i.test(file.path))
        || normalized.files[0];

    return {
        filename: createUniqueFilename(title, 'zip', 'frontend-bundle'),
        format: 'zip',
        mimeType: 'application/zip',
        buffer: createFrontendBundleArchive(normalized),
        previewHtml: String(entryFile?.content || ''),
        extractedText: buildFrontendBundleExtractedText(normalized),
        metadata: {
            title,
            frameworkTarget: normalized.frameworkTarget,
            previewMode: 'site',
            siteBundle: buildFrontendBundleSummary(normalized),
        },
    };
}

function buildFrontendBundlePreviewUrl(artifactId = '', relativePath = '') {
    const encodedId = encodeURIComponent(String(artifactId || '').trim());
    const normalizedPath = String(relativePath || '').trim().replace(/^\/+/, '');
    const base = `/api/artifacts/${encodedId}/preview/`;
    return normalizedPath ? `${base}${normalizedPath}` : base;
}

function injectBundleBaseHref(content = '', baseHref = '') {
    const source = String(content || '');
    if (!source || !baseHref || /<base\b/i.test(source)) {
        return source;
    }

    const baseTag = `<base href="${baseHref}">`;
    if (/<head[^>]*>/i.test(source)) {
        return source.replace(/<head([^>]*)>/i, `<head$1>\n${baseTag}`);
    }

    return source.replace(/<!doctype html>/i, (match) => `${match}\n<head>${baseTag}</head>`);
}

function readFrontendBundleArchive(buffer = Buffer.alloc(0)) {
    return readZipEntries(buffer);
}

function resolveFrontendBundleContentType(filePath = '') {
    return CONTENT_TYPES[path.extname(String(filePath || '').toLowerCase())] || 'text/plain; charset=utf-8';
}

function rewriteRootRelativeFrontendPaths(content = '', previewBasePath = '') {
    const prefix = `/${String(previewBasePath || '').replace(/^\/+|\/+$/g, '')}`;
    if (!prefix || prefix === '/') {
        return String(content || '');
    }

    return String(content || '')
        .replace(/(\b(?:href|src|action|poster)=["'])\/(?!\/|api\/)([^"']*)(["'])/gi, `$1${prefix}/$2$3`)
        .replace(/url\((['"]?)\/(?!\/|api\/)([^'")]+)\1\)/gi, `url($1${prefix}/$2$1)`);
}

function hasExplicitFrontendBundle(metadata = {}) {
    const source = metadata?.siteBundle || metadata?.bundle || null;
    if (!source || typeof source !== 'object') {
        return false;
    }

    if (Array.isArray(source.files)) {
        return source.files.length > 0;
    }

    return source.files && typeof source.files === 'object'
        ? Object.keys(source.files).length > 0
        : false;
}

function getArtifactFrontendBundle(artifact = {}, options = {}) {
    const fallbackContent = options.includeFallbackContent === false
        ? ''
        : String(
            artifact?.previewHtml
            || (artifact?.mimeType === 'text/html' && Buffer.isBuffer(artifact?.contentBuffer)
                ? artifact.contentBuffer.toString('utf8')
                : ''),
        );

    return normalizeFrontendBundle(
        artifact?.metadata?.siteBundle || artifact?.metadata?.bundle || null,
        fallbackContent,
    );
}

function buildFrontendBundleSummary(bundle = null, content = '') {
    const normalized = normalizeFrontendBundle(bundle, content);
    if (!normalized || normalized.files.length === 0) {
        return null;
    }

    const htmlPages = normalized.files.filter((file) => /\.html?$/i.test(file.path));
    return {
        entry: normalized.entry,
        frameworkTarget: normalized.frameworkTarget,
        routing: normalized.routing,
        fileCount: normalized.files.length,
        htmlPageCount: htmlPages.length,
        files: normalized.files.map((file) => ({
            path: file.path,
            language: file.language,
            purpose: file.purpose,
        })),
    };
}

function sanitizeFrontendArtifactMetadata(metadata = {}, content = '') {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return {};
    }

    const next = { ...metadata };
    if (next.bundle) {
        next.bundle = buildFrontendBundleSummary(next.bundle, content) || next.bundle;
    }
    if (next.siteBundle) {
        next.siteBundle = buildFrontendBundleSummary(next.siteBundle, content) || next.siteBundle;
    }

    return next;
}

function resolveArtifactFrontendBundleFile(artifact = {}, requestedPath = '') {
    let entries;
    try {
        entries = readFrontendBundleArchive(artifact?.contentBuffer || Buffer.alloc(0));
    } catch (_error) {
        return null;
    }
    const bundle = getArtifactFrontendBundle(artifact, { includeFallbackContent: false });
    const entryPath = normalizeBundlePath(bundle.entry || 'index.html') || 'index.html';
    const targetPath = normalizeBundlePath(requestedPath);
    const candidates = targetPath
        ? [
            targetPath,
            targetPath.endsWith('/') ? `${targetPath.replace(/\/+$/g, '')}/index.html` : `${targetPath}/index.html`,
            !path.extname(targetPath) ? `${targetPath}.html` : '',
        ].filter(Boolean)
        : [entryPath];
    const resolvedPath = candidates.find((candidate) => entries.has(candidate));
    if (!resolvedPath) {
        return null;
    }

    let contentBuffer = entries.get(resolvedPath);
    if (/\.html?$/i.test(resolvedPath)) {
        const html = contentBuffer.toString('utf8');
        const directory = path.dirname(resolvedPath);
        const baseHref = buildFrontendBundlePreviewUrl(
            artifact.id,
            directory && directory !== '.'
                ? `${directory.replace(/\/+$/g, '')}/`
                : '',
        );
        contentBuffer = Buffer.from(injectBundleBaseHref(
            rewriteRootRelativeFrontendPaths(html, buildFrontendBundlePreviewUrl(artifact.id)),
            baseHref,
        ), 'utf8');
    }

    return {
        path: resolvedPath,
        contentType: resolveFrontendBundleContentType(resolvedPath),
        contentBuffer,
    };
}

function extractRequestedSitePageCount(text = '') {
    const normalized = String(text || '').toLowerCase();
    const ranged = normalized.match(/\b(\d{1,2})\s*(?:or|to|-)\s*(\d{1,2})\s+pages?\b/);
    if (ranged) {
        return Math.max(2, Math.min(10, Number(ranged[2]) || Number(ranged[1]) || 0)) || null;
    }

    const direct = normalized.match(/\b(\d{1,2})\s+pages?\b/);
    if (!direct) {
        return null;
    }

    return Math.max(2, Math.min(10, Number(direct[1]) || 0)) || null;
}

function isComplexFrontendBundleRequest(text = '', existingContent = '') {
    const normalized = `${String(text || '')}\n${String(existingContent || '')}`.toLowerCase();
    if (!normalized.trim()) {
        return false;
    }

    if (/\bvite\b/.test(normalized)) {
        return true;
    }

    const hasSiteCue = /\b(website|site|microsite|news site|newsroom|frontend demo|site prototype|site mockup)\b/.test(normalized);
    const hasComplexityCue = /\b(multi[- ]page|multiple pages|full website|full site|complete website|site map|sitemap|navigation|routes?|sub[- ]agents?|delegate|parallel)\b/.test(normalized)
        || /\b\d{1,2}\s+pages?\b/.test(normalized);

    return hasSiteCue && hasComplexityCue;
}

module.exports = {
    buildFrontendBundleArtifact,
    buildFrontendBundleSummary,
    buildFrontendFallbackMetadata,
    buildFrontendBundlePreviewUrl,
    createFrontendBundleArchive,
    extractRequestedSitePageCount,
    getArtifactFrontendBundle,
    getFrontendBundleFile,
    hasExplicitFrontendBundle,
    hasFrontendBundleArchive,
    hasFrontendBundleFiles,
    inferFrontendTitle,
    injectBundleBaseHref,
    isComplexFrontendBundleRequest,
    normalizeBundlePath,
    normalizeFrontendBundle,
    normalizeFrontendHandoff,
    normalizeFrontendMetadata,
    normalizeFrontendRouting,
    readFrontendBundleArchive,
    resolveArtifactFrontendBundleFile,
    resolveFrontendBundleContentType,
    rewriteRootRelativeFrontendPaths,
    sanitizeFrontendArtifactMetadata,
};
