const STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from',
    'get', 'got', 'had', 'has', 'have', 'he', 'her', 'hers', 'him', 'his',
    'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'me', 'my',
    'of', 'on', 'or', 'our', 'ours', 'she', 'so', 'that', 'the', 'their',
    'them', 'then', 'there', 'these', 'they', 'this', 'those', 'to', 'too',
    'up', 'us', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who',
    'why', 'will', 'with', 'you', 'your', 'yours',
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

function mergeMemoryKeywords(explicitKeywords = [], text = '', limit = 16) {
    return normalizeMemoryKeywords([
        ...normalizeMemoryKeywords(explicitKeywords, limit),
        ...extractMemoryKeywords(text, limit),
    ], limit);
}

module.exports = {
    normalizeMemoryKeyword,
    normalizeMemoryKeywords,
    extractMemoryKeywords,
    mergeMemoryKeywords,
};
