const { v4: uuidv4 } = require('uuid');
const { stripNullCharacters } = require('./utils/text');
const { parseLenientJson } = require('./utils/lenient-json');

const COLLAPSIBLE_ARTIFACT_FORMATS = new Set(['pdf', 'docx', 'xlsx', 'xml', 'html', 'power-query']);
const COLLAPSIBLE_ARTIFACT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.xml', '.html', '.htm', '.pq', '.m'];

function offsetIsoTimestamp(timestamp = null, offsetMs = 0) {
    const parsed = timestamp ? new Date(timestamp) : new Date();
    const baseTime = Number.isNaN(parsed.getTime()) ? Date.now() : parsed.getTime();
    return new Date(baseTime + Math.max(0, offsetMs)).toISOString();
}

function parseToolArguments(rawArgs) {
    if (!rawArgs) {
        return {};
    }

    if (typeof rawArgs === 'object') {
        return rawArgs;
    }

    if (typeof rawArgs !== 'string') {
        return {};
    }

    return parseLenientJson(rawArgs) || {};
}

function buildSurveyFenceContent(checkpoint = null) {
    if (!checkpoint || typeof checkpoint !== 'object') {
        return '';
    }

    try {
        return `\`\`\`survey\n${JSON.stringify(checkpoint, null, 2)}\n\`\`\``;
    } catch (_error) {
        return '';
    }
}

function buildSurveyDisplayContentFromToolEvents(toolEvents = []) {
    const checkpointEvent = [...(Array.isArray(toolEvents) ? toolEvents : [])]
        .reverse()
        .find((event) => (
            (event?.toolCall?.function?.name || event?.result?.toolId || '') === 'user-checkpoint'
            && event?.result?.success !== false
        ));

    if (!checkpointEvent) {
        return '';
    }

    const data = checkpointEvent?.result?.data || {};
    const checkpoint = data.checkpoint && typeof data.checkpoint === 'object'
        ? data.checkpoint
        : (data && typeof data === 'object' ? data : null);
    const surveyFence = buildSurveyFenceContent(checkpoint);
    if (!surveyFence) {
        const message = String(data.message || '').trim();
        return /```(?:survey|kb-survey)\s*[\s\S]*?```/i.test(message) ? message : '';
    }

    return surveyFence;
}

function shouldCollapseArtifactTranscript(artifact) {
    const format = String(artifact?.format || '').toLowerCase();
    const filename = String(artifact?.filename || '').toLowerCase();
    return COLLAPSIBLE_ARTIFACT_FORMATS.has(format)
        || COLLAPSIBLE_ARTIFACT_EXTENSIONS.some((ext) => filename.endsWith(ext));
}

function buildArtifactSummary(artifacts = []) {
    const files = (Array.isArray(artifacts) ? artifacts : []).filter(shouldCollapseArtifactTranscript);
    if (files.length === 0) {
        return '';
    }

    if (files.length === 1) {
        return `Created ${files[0].filename}. Use Download below.`;
    }

    return `Created ${files.length} files. Use Download below.`;
}

function extractHostLabel(value = '') {
    try {
        return new URL(String(value || '').trim()).hostname.replace(/^www\./i, '');
    } catch (_error) {
        return '';
    }
}

function normalizeUnsplashResult(image) {
    if (!image || typeof image !== 'object') {
        return null;
    }

    const urls = image.urls || {};
    const regular = urls.regular || image.url || urls.full || urls.small || image.thumbUrl || '';
    const small = urls.small || image.thumbUrl || regular;
    if (!regular && !small) {
        return null;
    }

    const authorName = image.author?.name || image.author || '';
    const authorLink = image.author?.link || image.authorLink || '';
    const unsplashLink = image.links?.html || image.unsplashLink || '';
    const description = image.description || image.altDescription || image.alt || '';

    return {
        id: image.id || `unsplash-${Math.random().toString(36).slice(2, 10)}`,
        description,
        altDescription: description,
        urls: {
            small,
            regular,
        },
        author: {
            name: authorName,
            link: authorLink || unsplashLink,
        },
        links: {
            html: unsplashLink,
        },
    };
}

function normalizeSearchResult(result) {
    if (!result || typeof result !== 'object' || !result.url) {
        return null;
    }

    return {
        title: result.title || result.url,
        url: result.url,
        snippet: result.snippet || '',
        source: result.source || '',
        publishedAt: result.publishedAt || '',
    };
}

function stripHtmlToText(html = '') {
    return String(html || '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
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

function buildResearchSearchLookup(toolEvents = []) {
    const lookup = new Map();

    (Array.isArray(toolEvents) ? toolEvents : []).forEach((event) => {
        const toolId = event?.toolCall?.function?.name || event?.result?.toolId || '';
        if (toolId !== 'web-search' || event?.result?.success === false) {
            return;
        }

        const results = Array.isArray(event?.result?.data?.results)
            ? event.result.data.results
            : [];

        results.forEach((result) => {
            const normalized = normalizeSearchResult(result);
            if (normalized?.url && !lookup.has(normalized.url)) {
                lookup.set(normalized.url, normalized);
            }
        });
    });

    return lookup;
}

function normalizeResearchSourceEvent(event, searchLookup = new Map()) {
    const toolId = event?.toolCall?.function?.name || event?.result?.toolId || '';
    if ((toolId !== 'web-fetch' && toolId !== 'web-scrape') || event?.result?.success === false) {
        return null;
    }

    const args = parseToolArguments(event?.toolCall?.function?.arguments);
    const data = event?.result?.data || {};
    const url = data.url || args.url || '';
    if (!url) {
        return null;
    }

    const searchMeta = searchLookup.get(url) || null;
    const title = data.title || searchMeta?.title || url;
    const source = searchMeta?.source || '';
    const snippet = searchMeta?.snippet || '';
    const publishedAt = searchMeta?.publishedAt || '';
    const rawExcerpt = toolId === 'web-scrape'
        ? (data.summary || data.text || data.content || JSON.stringify(data.data || {}))
        : stripHtmlToText(data.body || '');
    const excerpt = String(rawExcerpt || '').replace(/\s+/g, ' ').trim().slice(0, 420);

    if (!snippet && !excerpt) {
        return null;
    }

    return {
        title,
        url,
        source,
        snippet,
        excerpt,
        publishedAt,
        toolId,
    };
}

function normalizeArtifactImage(image, fallbackPrompt = '', fallbackHost = '') {
    if (!image || typeof image !== 'object') {
        return null;
    }

    const downloadUrl = String(image.downloadUrl || image.downloadPath || '').trim();
    if (!downloadUrl) {
        return null;
    }

    const separator = downloadUrl.includes('?') ? '&' : '?';
    const inlineUrl = `${downloadUrl}${separator}inline=1`;
    const sourceHost = image.sourceHost || fallbackHost || '';
    const filename = image.filename || `captured-image-${image.index || 1}`;
    const alt = filename
        .replace(/\.[a-z0-9]{2,5}$/i, '')
        .replace(/[-_]+/g, ' ')
        .trim() || fallbackPrompt || 'Captured image';

    return {
        imageUrl: inlineUrl,
        thumbnailUrl: inlineUrl,
        downloadUrl,
        artifactId: image.artifactId || '',
        filename,
        mimeType: image.mimeType || '',
        sizeBytes: image.sizeBytes || 0,
        sourceHost,
        alt,
        prompt: fallbackPrompt || `Captured image from ${sourceHost || 'scraped page'}`,
        source: 'artifact',
    };
}

function buildToolSelectionMessages({ parentMessageId = '', toolEvents = [], timestamp = null } = {}) {
    if (!parentMessageId || !Array.isArray(toolEvents) || toolEvents.length === 0) {
        return [];
    }

    const nextMessages = [];
    const normalizedTimestamp = timestamp || new Date().toISOString();
    const searchLookup = buildResearchSearchLookup(toolEvents);

    toolEvents.forEach((event, index) => {
        const toolId = event?.toolCall?.function?.name || event?.result?.toolId || '';
        const args = parseToolArguments(event?.toolCall?.function?.arguments);
        const data = event?.result?.data || {};

        if (toolId === 'image-search-unsplash') {
            const results = (Array.isArray(data.images) ? data.images : [])
                .map((image) => normalizeUnsplashResult(image))
                .filter(Boolean);

            if (results.length === 0) {
                return;
            }

            nextMessages.push({
                id: `${parentMessageId}-unsplash-${index}`,
                parentMessageId,
                role: 'assistant',
                type: 'unsplash-search',
                content: `Unsplash options for "${data.query || args.query || 'image search'}"`,
                query: data.query || args.query || '',
                results,
                total: data.total || results.length,
                totalPages: data.totalPages || args.totalPages || 1,
                currentPage: args.page || 1,
                perPage: args.perPage || results.length || 6,
                orientation: args.orientation || null,
                excludeFromTranscript: true,
                timestamp: normalizedTimestamp,
            });
            return;
        }

        if (toolId === 'web-search') {
            const results = (Array.isArray(data.results) ? data.results : [])
                .map((result) => normalizeSearchResult(result))
                .filter(Boolean);

            if (results.length === 0) {
                return;
            }

            nextMessages.push({
                id: `${parentMessageId}-search-${index}`,
                parentMessageId,
                role: 'assistant',
                type: 'search-results',
                content: `Source pages for "${data.query || args.query || 'research'}"`,
                query: data.query || args.query || '',
                results,
                total: results.length,
                excludeFromTranscript: true,
                timestamp: normalizedTimestamp,
            });
            return;
        }

        if (toolId === 'web-scrape') {
            const imageCapture = data.imageCapture && typeof data.imageCapture === 'object'
                ? data.imageCapture
                : (event?.result?.imageCapture && typeof event.result.imageCapture === 'object'
                    ? event.result.imageCapture
                    : null);
            if (imageCapture?.mode !== 'blind-artifacts') {
                return;
            }

            const fallbackHost = extractHostLabel(data.url || args.url || '') || imageCapture.items?.[0]?.sourceHost || '';
            const results = (Array.isArray(imageCapture.items) ? imageCapture.items : [])
                .map((image) => normalizeArtifactImage(image, data.title || data.url || args.url || '', fallbackHost))
                .filter(Boolean);

            if (results.length === 0) {
                return;
            }

            nextMessages.push({
                id: `${parentMessageId}-artifact-${index}`,
                parentMessageId,
                role: 'assistant',
                type: 'image-selection',
                sourceKind: 'artifact',
                content: `Captured image options from ${fallbackHost || 'the scraped page'}`,
                prompt: data.title || data.url || args.url || '',
                sourceHost: fallbackHost,
                results,
                excludeFromTranscript: true,
                timestamp: normalizedTimestamp,
            });
        }
    });

    const searchEvent = [...toolEvents].reverse().find((event) => (
        (event?.toolCall?.function?.name || event?.result?.toolId || '') === 'web-search'
        && event?.result?.success !== false
    ));
    const researchSources = [];
    const seenResearchUrls = new Set();

    toolEvents.forEach((event) => {
        const normalized = normalizeResearchSourceEvent(event, searchLookup);
        if (!normalized || seenResearchUrls.has(normalized.url)) {
            return;
        }

        seenResearchUrls.add(normalized.url);
        researchSources.push(normalized);
    });

    if (researchSources.length > 0) {
        const searchArgs = parseToolArguments(searchEvent?.toolCall?.function?.arguments);
        const query = searchEvent?.result?.data?.query || searchArgs.query || '';

        nextMessages.push({
            id: `${parentMessageId}-research-sources`,
            parentMessageId,
            role: 'assistant',
            type: 'research-sources',
            content: `Verified source excerpts for "${query || 'research'}"`,
            query,
            results: researchSources,
            total: researchSources.length,
            excludeFromTranscript: true,
            timestamp: normalizedTimestamp,
        });
    }

    return nextMessages;
}

function buildArtifactGalleryMessage({ parentMessageId = '', artifacts = [], timestamp = null } = {}) {
    const nextArtifacts = (Array.isArray(artifacts) ? artifacts : [])
        .filter((artifact) => artifact && typeof artifact === 'object' && artifact.id);
    if (!parentMessageId || nextArtifacts.length === 0) {
        return null;
    }

    return {
        id: `${parentMessageId}-artifacts`,
        parentMessageId,
        role: 'assistant',
        type: 'artifact-gallery',
        content: buildArtifactSummary(nextArtifacts) || `Generated ${nextArtifacts.length} file${nextArtifacts.length === 1 ? '' : 's'}.`,
        artifacts: nextArtifacts,
        excludeFromTranscript: true,
        timestamp: timestamp || new Date().toISOString(),
    };
}

function buildWebChatAssistantEnvelope({
    toolEvents = [],
    artifacts = [],
    parentMessageId = '',
    timestamp = null,
} = {}) {
    const normalizedTimestamp = timestamp || new Date().toISOString();
    const surveyDisplayContent = buildSurveyDisplayContentFromToolEvents(toolEvents);
    const artifactSummary = buildArtifactSummary(artifacts);
    const assistantMetadata = {};

    if (surveyDisplayContent) {
        assistantMetadata.displayContent = surveyDisplayContent;
    } else if (artifactSummary) {
        assistantMetadata.displayContent = artifactSummary;
    }

    const auxiliaryMessages = [
        ...buildToolSelectionMessages({
            parentMessageId,
            toolEvents,
            timestamp: normalizedTimestamp,
        }),
    ];

    const artifactGalleryMessage = buildArtifactGalleryMessage({
        parentMessageId,
        artifacts,
        timestamp: normalizedTimestamp,
    });
    if (artifactGalleryMessage) {
        auxiliaryMessages.push(artifactGalleryMessage);
    }

    return {
        assistantMetadata,
        auxiliaryMessages,
    };
}

function buildWebChatSessionMessages({
    userText = '',
    assistantText = '',
    toolEvents = [],
    artifacts = [],
    timestamp = null,
} = {}) {
    const userTimestamp = offsetIsoTimestamp(timestamp, 0);
    const assistantTimestamp = offsetIsoTimestamp(userTimestamp, 1);
    const assistantMessageId = uuidv4();
    const { assistantMetadata, auxiliaryMessages } = buildWebChatAssistantEnvelope({
        toolEvents,
        artifacts,
        parentMessageId: assistantMessageId,
        timestamp: assistantTimestamp,
    });
    const sequencedAuxiliaryMessages = auxiliaryMessages.map((message, index) => ({
        ...message,
        timestamp: offsetIsoTimestamp(assistantTimestamp, index + 1),
    }));

    return [
        {
            id: uuidv4(),
            role: 'user',
            content: stripNullCharacters(String(userText || '')).trim(),
            timestamp: userTimestamp,
        },
        {
            id: assistantMessageId,
            role: 'assistant',
            content: stripNullCharacters(String(assistantText || '')).trim(),
            timestamp: assistantTimestamp,
            metadata: assistantMetadata,
        },
        ...sequencedAuxiliaryMessages,
    ].filter((message) => message.role && message.content);
}

module.exports = {
    buildArtifactSummary,
    buildWebChatAssistantEnvelope,
    buildWebChatSessionMessages,
};
