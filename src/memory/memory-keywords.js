const STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from',
    'get', 'got', 'had', 'has', 'have', 'he', 'her', 'hers', 'him', 'his',
    'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'me', 'my',
    'of', 'on', 'or', 'our', 'ours', 'she', 'so', 'that', 'the', 'their',
    'them', 'then', 'there', 'these', 'they', 'this', 'those', 'to', 'too',
    'up', 'us', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who',
    'why', 'will', 'with', 'you', 'your', 'yours',
]);

const PROGRAMMING_STOPWORDS = new Set([
    'const', 'let', 'var', 'function', 'return', 'true', 'false', 'null',
    'undefined', 'async', 'await', 'class', 'new', 'this', 'else', 'try',
    'catch', 'finally', 'import', 'export', 'default', 'module', 'require',
]);

const PROGRAMMING_KEYWORDS = [
    'api', 'auth', 'backend', 'build', 'cache', 'cli', 'component', 'config',
    'controller', 'css', 'database', 'deploy', 'docker', 'endpoint', 'express',
    'frontend', 'git', 'html', 'javascript', 'jest', 'json', 'k3s', 'kubernetes',
    'middleware', 'migration', 'module', 'node', 'package', 'postgres', 'qdrant',
    'react', 'route', 'schema', 'session', 'test', 'typescript', 'ui', 'vite',
    'websocket',
];

const PROGRAMMING_EXTENSIONS = new Set([
    'cjs', 'css', 'env', 'html', 'js', 'jsx', 'json', 'md', 'mjs', 'sql', 'ts',
    'tsx', 'yaml', 'yml',
]);

function normalizeMemoryKeyword(keyword = '') {
    return String(keyword || '')
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\-_.:/# ]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeMemoryKeywords(keywords = [], limit = 16) {
    if (!Array.isArray(keywords)) {
        return [];
    }

    const seen = new Set();
    const normalized = [];

    for (const keyword of keywords) {
        const value = normalizeMemoryKeyword(keyword);
        if (!value || seen.has(value)) {
            continue;
        }

        seen.add(value);
        normalized.push(value);
        if (normalized.length >= limit) {
            break;
        }
    }

    return normalized;
}

function extractMemoryKeywords(text = '', limit = 12) {
    const normalizedText = String(text || '')
        .replace(/[^\p{L}\p{N}\-_.:/# ]+/gu, ' ')
        .toLowerCase();
    if (!normalizedText.trim()) {
        return [];
    }

    const seen = new Set();
    const keywords = [];
    const matches = normalizedText.match(/[\p{L}\p{N}\-_.:/#]{2,}/gu) || [];

    for (const match of matches) {
        const value = normalizeMemoryKeyword(match);
        if (!value || STOPWORDS.has(value) || seen.has(value)) {
            continue;
        }

        seen.add(value);
        keywords.push(value);
        if (keywords.length >= limit) {
            break;
        }
    }

    return keywords;
}

function extractProgrammingKeywords(text = '', limit = 12) {
    const source = String(text || '');
    if (!source.trim()) {
        return [];
    }

    const candidates = [];

    const pathMatches = source.match(/[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+/g) || [];
    for (const match of pathMatches) {
        const normalizedPath = normalizeMemoryKeyword(match.replace(/\\/g, '/'));
        if (normalizedPath) {
            candidates.push(normalizedPath);
        }

        const basename = match.split(/[\\/]/).filter(Boolean).pop() || '';
        if (basename) {
            candidates.push(basename);
        }
    }

    const fileMatches = source.match(/\b[A-Za-z0-9_.-]+\.(?:cjs|css|env|html|js|jsx|json|md|mjs|sql|ts|tsx|ya?ml)\b/gi) || [];
    for (const match of fileMatches) {
        candidates.push(match);
        const extension = match.split('.').pop()?.toLowerCase();
        if (PROGRAMMING_EXTENSIONS.has(extension)) {
            candidates.push(extension);
        }
    }

    for (const keyword of PROGRAMMING_KEYWORDS) {
        if (new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(source)) {
            candidates.push(keyword);
        }
    }

    const packageMatches = source.match(/@[a-z0-9_.-]+\/[a-z0-9_.-]+|[a-z0-9_.-]+(?:-[a-z0-9_.-]+)+/gi) || [];
    candidates.push(...packageMatches);

    const symbolMatches = source.match(/\b[A-Za-z_$][A-Za-z0-9_$]*\s*(?=\()/g) || [];
    for (const match of symbolMatches) {
        const normalized = normalizeMemoryKeyword(match);
        if (normalized.length > 2 && !PROGRAMMING_STOPWORDS.has(normalized)) {
            candidates.push(normalized);
        }
    }

    if (/\b(fail(?:ed|ing)?|error|bug|fix|debug|regression|exception|stack trace)\b/i.test(source)) {
        candidates.push('debugging');
    }
    if (/\b(test|tests|jest|coverage|assert|expect)\b/i.test(source)) {
        candidates.push('testing');
    }
    if (/\b(refactor|cleanup|rename|extract|deduplicate)\b/i.test(source)) {
        candidates.push('refactor');
    }

    return normalizeMemoryKeywords(candidates, limit);
}

function mergeMemoryKeywords(explicitKeywords = [], text = '', limit = 16) {
    return normalizeMemoryKeywords([
        ...normalizeMemoryKeywords(explicitKeywords, limit),
        ...extractProgrammingKeywords(text, limit),
        ...extractMemoryKeywords(text, limit),
    ], limit);
}

module.exports = {
    normalizeMemoryKeyword,
    normalizeMemoryKeywords,
    extractMemoryKeywords,
    extractProgrammingKeywords,
    mergeMemoryKeywords,
};
