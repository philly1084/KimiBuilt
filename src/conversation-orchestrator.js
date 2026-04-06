const EventEmitter = require('events');
const { createResponse } = require('./openai-client');
const { config } = require('./config');
const { extractResponseText } = require('./artifacts/artifact-service');
const settingsController = require('./routes/admin/settings.controller');
const {
    buildImagePromptFromArtifactRequest,
    hasExplicitImageGenerationIntent,
    resolveSshRequestContext,
    extractSshSessionMetadataFromToolEvents,
    canonicalizeRemoteToolId,
    isRemoteCommandToolId,
    isSuspiciousSshTargetHost,
} = require('./ai-route-utils');
const {
    buildProjectMemoryUpdate,
    mergeProjectMemory,
} = require('./project-memory');
const {
    buildLegacyControlMetadata,
    getSessionControlState,
    mergeControlState,
} = require('./runtime-control-state');
const {
    buildScopedSessionMetadata,
    resolveClientSurface,
    resolveSessionScope,
} = require('./session-scope');
const {
    USER_CHECKPOINT_TOOL_ID,
    normalizeCheckpointRequest,
} = require('./user-checkpoints');
const { parseLenientJson } = require('./utils/lenient-json');
const { stripNullCharacters } = require('./utils/text');
const {
    DEFAULT_EXECUTION_PROFILE,
    NOTES_EXECUTION_PROFILE,
    REMOTE_BUILD_EXECUTION_PROFILE,
    PROFILE_TOOL_ALLOWLISTS,
} = require('./tool-execution-profiles');
const { hasWorkloadIntent } = require('./workloads/natural-language');
const { buildCanonicalWorkloadAction } = require('./workloads/request-builder');
const SYNTHETIC_STREAM_CHUNK_SIZE = 120;
const MAX_PLAN_STEPS = 4;
const MAX_TOOL_RESULT_CHARS = config.memory.toolResultCharLimit;
const RECENT_TRANSCRIPT_LIMIT = config.memory.recentTranscriptLimit;
const MAX_STEP_SIGNATURE_REPEATS = 3;
const DOCUMENT_WORKFLOW_TOOL_ID = 'document-workflow';
const REMOTE_BLOCKING_ERROR_PATTERNS = [
    /no ssh host configured/i,
    /no ssh username configured/i,
    /no ssh password or private key configured/i,
    /permission denied/i,
    /all configured authentication methods failed/i,
    /could not resolve hostname/i,
    /name or service not known/i,
    /temporary failure in name resolution/i,
    /no route to host/i,
    /network is unreachable/i,
    /connection refused/i,
    /connection timed out/i,
    /operation timed out/i,
    /connection closed by remote host/i,
];

function getDefaultWorkloadTimezone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function hasMultiWorkloadSchedulingIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    const hasSchedulingLanguage = /\b(cron|job|jobs|schedule|scheduled|recurring|automation|task|tasks|workload|workloads)\b/.test(normalized);
    const hasMultiLanguage = /\b(couple|few|multiple|several|two|three)\b/.test(normalized)
        || /\bupdates?\b[\s\S]{0,20}\band\b[\s\S]{0,20}\bchecks?\b/.test(normalized);

    return hasSchedulingLanguage && hasMultiLanguage;
}

function normalizeExecutionProfile(value = '') {
    const normalized = String(value || '').trim().toLowerCase();

    if ([
        'notes',
        'notes-app',
        'notes_app',
        'notes-editor',
        'notes_editor',
    ].includes(normalized)) {
        return NOTES_EXECUTION_PROFILE;
    }

    if ([
        'remote-build',
        'remote_builder',
        'remote-builder',
        'server-build',
        'server-builder',
        'software-builder',
    ].includes(normalized)) {
        return REMOTE_BUILD_EXECUTION_PROFILE;
    }

    return DEFAULT_EXECUTION_PROFILE;
}

function normalizeMessageText(content = '') {
    if (typeof content === 'string') {
        return stripNullCharacters(content);
    }

    if (Array.isArray(content)) {
        return content
            .map((item) => {
                if (typeof item === 'string') {
                    return item;
                }

                if (item?.type === 'text' || item?.type === 'input_text' || item?.type === 'output_text') {
                    return stripNullCharacters(item.text || '');
                }

                return '';
            })
            .filter(Boolean)
            .join('\n');
    }

    return '';
}

function hasExplicitWebResearchIntentText(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(web research|research|look up|search for|search the web|browse the web|search online|browse online)\b/.test(normalized);
}

function hasCurrentInfoIntentText(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(latest|current|today|news|headlines?|weather|forecast|temperature)\b/.test(normalized);
}

function hasDocumentWorkflowIntentText(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return (
        /\b(document|doc|report|brief|proposal|guide|summary|one-pager|whitepaper|slides|presentation|deck|pptx|docx|pdf|html page|html document|web page)\b/.test(normalized)
        && /\b(create|make|generate|build|prepare|draft|write|assemble|compile|organize|inject|turn|convert|export)\b/.test(normalized)
    ) || (
        /\b(slides|presentation|deck|pptx|docx|pdf|html document|research brief)\b/.test(normalized)
        && /\b(research|look up|search|browse|scrape|extract|pricing|comparison|current|latest)\b/.test(normalized)
    );
}

function hasExplicitCheckpointRequestText(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(ask me first|check with me|run it by me|before you start|before doing|before making|before major work|before major changes?|before implementation|which direction|which approach|choose a direction|help me choose|decision|trade-?off|options?)\b/.test(normalized);
}

function hasSubstantialWorkIntentText(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(plan|planning|refactor|implement|implementation|build|create|generate|draft|design|deploy|migration|migrate|rewrite|organize|set up|setup|fix|debug|investigate|audit|review)\b/.test(normalized);
}

function normalizeUserCheckpointPlanOption(option = {}) {
    if (typeof option === 'string') {
        const label = option.trim();
        return label ? { label } : null;
    }

    if (!option || typeof option !== 'object') {
        return null;
    }

    const label = typeof option.label === 'string'
        ? option.label.trim()
        : (typeof option.title === 'string'
            ? option.title.trim()
            : (typeof option.text === 'string' ? option.text.trim() : ''));
    if (!label) {
        return null;
    }

    const description = typeof option.description === 'string'
        ? option.description.trim()
        : (typeof option.details === 'string' ? option.details.trim() : '');
    const id = typeof option.id === 'string' ? option.id.trim() : '';

    return {
        ...(id ? { id } : {}),
        label,
        ...(description ? { description } : {}),
    };
}

function normalizeUserCheckpointPlanStep(step = {}) {
    if (!step || typeof step !== 'object') {
        return null;
    }

    const question = typeof step.question === 'string'
        ? step.question.trim()
        : (typeof step.prompt === 'string'
            ? step.prompt.trim()
            : (typeof step.ask === 'string' ? step.ask.trim() : ''));
    if (!question) {
        return null;
    }

    const rawOptions = Array.isArray(step.options)
        ? step.options
        : (Array.isArray(step.choices) ? step.choices : []);
    const options = rawOptions
        .map((option) => normalizeUserCheckpointPlanOption(option))
        .filter(Boolean)
        .slice(0, 5);
    const inputType = typeof step.inputType === 'string'
        ? step.inputType.trim()
        : (typeof step.type === 'string'
            ? step.type.trim()
            : (typeof step.kind === 'string' ? step.kind.trim() : ''));
    const title = typeof step.title === 'string' ? step.title.trim() : '';
    const placeholder = typeof step.placeholder === 'string'
        ? step.placeholder.trim()
        : (typeof step.inputPlaceholder === 'string'
            ? step.inputPlaceholder.trim()
            : '');
    const freeTextLabel = typeof step.freeTextLabel === 'string'
        ? step.freeTextLabel.trim()
        : (typeof step.freeTextPrompt === 'string'
            ? step.freeTextPrompt.trim()
            : '');
    const id = typeof step.id === 'string' ? step.id.trim() : '';

    return {
        ...(id ? { id } : {}),
        ...(title ? { title } : {}),
        question,
        ...(inputType ? { inputType } : {}),
        ...(placeholder ? { placeholder } : {}),
        ...(typeof step.required === 'boolean' ? { required: step.required } : {}),
        ...(typeof step.allowMultiple === 'boolean' ? { allowMultiple: step.allowMultiple } : {}),
        ...(typeof step.multiple === 'boolean' ? { allowMultiple: step.multiple } : {}),
        ...(Number.isFinite(Number(step.maxSelections)) ? { maxSelections: Number(step.maxSelections) } : {}),
        ...(typeof step.allowFreeText === 'boolean' ? { allowFreeText: step.allowFreeText } : {}),
        ...(typeof step.allowText === 'boolean' ? { allowFreeText: step.allowText } : {}),
        ...(freeTextLabel ? { freeTextLabel } : {}),
        ...(options.length > 0 ? { options } : {}),
    };
}

function normalizeUserCheckpointPlanParams(step = {}) {
    const rawParams = step?.params && typeof step.params === 'object'
        ? { ...step.params }
        : {};
    const normalizedSteps = (Array.isArray(rawParams.steps) ? rawParams.steps : [])
        .map((entry) => normalizeUserCheckpointPlanStep(entry))
        .filter(Boolean)
        .slice(0, 6);
    const legacyStep = normalizeUserCheckpointPlanStep(rawParams);
    const baseParams = {
        ...rawParams,
        ...(typeof rawParams.title === 'string' && rawParams.title.trim()
            ? { title: rawParams.title.trim() }
            : {}),
        ...(typeof rawParams.preamble === 'string' && rawParams.preamble.trim()
            ? { preamble: rawParams.preamble.trim() }
            : {}),
        ...(typeof rawParams.whyThisMatters === 'string' && rawParams.whyThisMatters.trim()
            ? { whyThisMatters: rawParams.whyThisMatters.trim() }
            : {}),
        ...(normalizedSteps.length > 0
            ? { steps: normalizedSteps }
            : (legacyStep || {})),
    };

    try {
        const normalized = normalizeCheckpointRequest(baseParams);
        const { id: _unusedId, ...normalizedParams } = normalized;
        return normalizedParams;
    } catch (_error) {
        return baseParams;
    }
}

function inferRecallProfileFromText(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return 'default';
    }

    return /\b(web research|research|look up|search for|search the web|browse the web|search online|browse online|latest|current|today|news|headlines?|weather|forecast|temperature)\b/.test(normalized)
        ? 'research'
        : 'default';
}

function normalizeResearchFollowupPageCount() {
    return Math.max(2, Math.min(config.memory.researchFollowupPages, 8));
}

function normalizeResearchSearchResultCount() {
    return Math.max(8, Math.min(config.memory.researchSearchLimit, config.search.maxLimit));
}

function inferResearchTimeRangeFromText(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return 'all';
    }

    if (/\b(today|latest|current|breaking|news|headlines?|weather|forecast|temperature)\b/.test(normalized)) {
        return 'day';
    }

    if (/\b(this week|weekly|past week|last week)\b/.test(normalized)) {
        return 'week';
    }

    if (/\b(this month|monthly|past month|last month)\b/.test(normalized)) {
        return 'month';
    }

    return 'all';
}

function extractExplicitWebResearchQuery(text = '') {
    const prompt = String(text || '').trim();
    if (!prompt) {
        return null;
    }

    const patterns = [
        /\b(?:do|perform|run)\s+research\s+(?:on|about|into)?\s+(.+?)(?:[.?!]\s|[\r\n]|$)/i,
        /\bweb research\s+(.+?)(?:[.?!]\s|[\r\n]|$)/i,
        /\bresearch\s+(?:on|about|into)?\s+(.+?)(?:[.?!]\s|[\r\n]|$)/i,
        /\blook up\s+(.+?)(?:[.?!]\s|[\r\n]|$)/i,
        /\bsearch for\s+(.+?)(?:[.?!]\s|[\r\n]|$)/i,
        /\bsearch the web for\s+(.+?)(?:[.?!]\s|[\r\n]|$)/i,
    ];

    for (const pattern of patterns) {
        const match = prompt.match(pattern);
        if (match?.[1]) {
            return match[1].trim().replace(/[.?!]+$/g, '').trim();
        }
    }

    if (!hasExplicitWebResearchIntentText(prompt)) {
        return null;
    }

    return prompt
        .replace(/^(please|can you|could you|would you|help me|i need you to)\s+/i, '')
        .replace(/[.?!]+$/g, '')
        .trim();
}

function extractImplicitCurrentInfoQuery(text = '') {
    const prompt = String(text || '').trim();
    if (!prompt || !hasCurrentInfoIntentText(prompt)) {
        return null;
    }

    return prompt
        .replace(/^(please|can you|could you|would you|help me|i need you to|tell me|show me|find me|get me)\s+/i, '')
        .replace(/[.?!]+$/g, '')
        .trim();
}

function extractObjective(input = null, fallback = '') {
    if (typeof fallback === 'string' && fallback.trim()) {
        return fallback.trim();
    }

    if (typeof input === 'string') {
        return input.trim();
    }

    if (!Array.isArray(input)) {
        return '';
    }

    const lastUserMessage = input.filter((message) => message?.role === 'user').pop();
    return normalizeMessageText(lastUserMessage?.content || '').trim();
}

function unwrapCodeFence(text = '') {
    const trimmed = String(text || '').trim();
    const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return match ? match[1].trim() : trimmed;
}

function safeJsonParse(text = '') {
    return parseLenientJson(unwrapCodeFence(text));
}

function truncateText(value = '', limit = MAX_TOOL_RESULT_CHARS) {
    const text = String(value || '');
    if (text.length <= limit) {
        return text;
    }

    return `${text.slice(0, limit)}\n[truncated ${text.length - limit} chars]`;
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

function extractFetchBodyText(result = {}) {
    const body = String(result?.data?.body || '').trim();
    if (!body) {
        return '';
    }

    return /<html\b|<body\b|<article\b|<main\b|<section\b/i.test(body)
        ? stripHtmlToText(body)
        : body.replace(/\s+/g, ' ').trim();
}

function normalizeInlineText(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function deriveSourceLabel(url = '', fallback = '') {
    if (fallback) {
        return String(fallback).trim();
    }

    try {
        return new URL(String(url || '')).hostname.replace(/^www\./i, '');
    } catch (_error) {
        return '';
    }
}

function extractHtmlTitle(html = '') {
    const match = String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    return normalizeInlineText(match?.[1] || '');
}

function summarizeSearchResults(results = []) {
    if (!Array.isArray(results) || results.length === 0) {
        return '';
    }

    return results
        .slice(0, 3)
        .map((entry, index) => {
            const title = truncateText(normalizeInlineText(entry?.title || 'Untitled result'), 100);
            const url = String(entry?.url || '').trim();
            const source = deriveSourceLabel(url, entry?.source);
            const snippet = truncateText(normalizeInlineText(entry?.snippet || ''), 160);

            return [
                `${index + 1}. ${title}`,
                source ? `(${source})` : '',
                snippet ? `- ${snippet}` : '',
                url ? `[${url}]` : '',
            ].filter(Boolean).join(' ');
        })
        .join(' ');
}

function summarizeFetchedContent(data = {}) {
    const url = String(data?.url || '').trim();
    const status = Number.isFinite(Number(data?.status)) ? Number(data.status) : null;
    const statusText = normalizeInlineText(data?.statusText || '');
    const body = typeof data?.body === 'string' ? data.body : '';
    const contentType = String(data?.headers?.['content-type'] || data?.headers?.['Content-Type'] || '').trim().toLowerCase();
    const title = normalizeInlineText(data?.title || extractHtmlTitle(body));
    const rawSummary = contentType.includes('html') ? stripHtmlToText(body) : body;
    const bodyPreview = truncateText(normalizeInlineText(rawSummary), 220);

    return [
        status != null ? `${status}${statusText ? ` ${statusText}` : ''}.` : '',
        title ? `Title: ${truncateText(title, 120)}.` : '',
        bodyPreview ? `Summary: ${bodyPreview}.` : '',
        url ? `Source: ${url}.` : '',
    ].filter(Boolean).join(' ');
}

function summarizeObjectData(data = {}) {
    if (!data || typeof data !== 'object') {
        return '';
    }

    const preferredKeys = ['title', 'url', 'status', 'statusText', 'message', 'summary', 'text', 'content'];
    const pairs = preferredKeys
        .filter((key) => data[key] != null && typeof data[key] !== 'object')
        .slice(0, 4)
        .map((key) => `${key}: ${truncateText(normalizeInlineText(data[key]), 120)}`);

    if (pairs.length > 0) {
        return pairs.join('; ');
    }

    return truncateText(normalizeInlineText(JSON.stringify(data)), 220);
}

function deriveResearchSourceLabel(url = '', fallback = '') {
    const normalizedFallback = normalizeInlineText(fallback || '');
    if (normalizedFallback) {
        return normalizedFallback;
    }

    try {
        return new URL(String(url || '')).hostname.replace(/^www\./i, '');
    } catch (_error) {
        return '';
    }
}

function findSearchResultByUrl(searchResults = [], url = '') {
    const normalizedUrl = String(url || '').trim();
    if (!normalizedUrl || !Array.isArray(searchResults)) {
        return null;
    }

    return searchResults.find((entry) => String(entry?.url || '').trim() === normalizedUrl) || null;
}

function extractResearchSourceExcerpt(event = {}) {
    const toolId = event?.toolCall?.function?.name || event?.result?.toolId || '';
    const data = event?.result?.data || {};
    const excerptLimit = config.memory.researchSourceExcerptChars;

    if (toolId === 'web-scrape') {
        const direct = [
            data?.summary,
            data?.text,
            data?.content,
            data?.markdown,
        ].find((value) => typeof value === 'string' && value.trim());

        if (direct) {
            return truncateText(normalizeInlineText(direct), excerptLimit);
        }

        return truncateText(normalizeInlineText(stripHtmlToText(JSON.stringify(data?.data || {}))), excerptLimit);
    }

    return truncateText(normalizeInlineText(extractFetchBodyText(event?.result || {})), excerptLimit);
}

function shouldIncludeDocumentWorkflowContent(text = '') {
    return /\b(html|markdown|md)\b/i.test(String(text || ''))
        && /\b(file|page|write|save|inject|local)\b/i.test(String(text || ''));
}

function buildDocumentWorkflowSourcesFromToolEvents(toolEvents = []) {
    const events = Array.isArray(toolEvents) ? toolEvents : [];
    const lastSearchEvent = getLastSuccessfulToolEvent(events, 'web-search');
    const searchResults = Array.isArray(lastSearchEvent?.result?.data?.results)
        ? lastSearchEvent.result.data.results
        : [];
    const sources = [];
    const seen = new Set();

    for (const event of events) {
        const toolId = event?.toolCall?.function?.name || event?.result?.toolId || '';
        if (!['web-fetch', 'web-scrape'].includes(toolId) || event?.result?.success === false) {
            continue;
        }

        const data = event?.result?.data || {};
        const args = parseToolCallArguments(event?.toolCall?.function?.arguments || '{}');
        const url = String(data?.url || args?.url || '').trim();
        const searchResult = findSearchResultByUrl(searchResults, url);
        const title = normalizeInlineText(data?.title || searchResult?.title || url || `${toolId} source`);
        const sourceLabel = deriveResearchSourceLabel(url, searchResult?.source || data?.source || '');
        const excerpt = extractResearchSourceExcerpt(event);
        const snippet = truncateText(normalizeInlineText(searchResult?.snippet || data?.summary || ''), 260);
        const content = [
            snippet ? `Search snippet: ${snippet}` : '',
            excerpt ? `Verified content: ${excerpt}` : '',
        ].filter(Boolean).join('\n\n').trim();
        const dedupeKey = url || `${title}:${content}`;

        if (!content || seen.has(dedupeKey)) {
            continue;
        }

        seen.add(dedupeKey);
        sources.push({
            id: `verified-source-${sources.length + 1}`,
            title: title || `Verified source ${sources.length + 1}`,
            sourceLabel,
            sourceUrl: url,
            kind: toolId,
            content,
        });

        if (sources.length >= 6) {
            break;
        }
    }

    return sources;
}

function buildDocumentWorkflowGenerateParams({ objective = '', toolEvents = [] } = {}) {
    const params = {
        action: 'generate',
        prompt: objective,
        includeContent: shouldIncludeDocumentWorkflowContent(objective),
    };
    const sources = buildDocumentWorkflowSourcesFromToolEvents(toolEvents);

    if (sources.length > 0) {
        params.sources = sources;
    }

    return params;
}

function buildResearchDossierFromToolEvents({ objective = '', toolEvents = [] } = {}) {
    const events = Array.isArray(toolEvents) ? toolEvents : [];
    const lastSearchEvent = getLastSuccessfulToolEvent(events, 'web-search');
    const searchResults = Array.isArray(lastSearchEvent?.result?.data?.results)
        ? lastSearchEvent.result.data.results
        : [];
    const query = normalizeInlineText(
        lastSearchEvent?.result?.data?.query
        || parseToolCallArguments(lastSearchEvent?.toolCall?.function?.arguments || '{}').query
        || objective,
    );

    const sourceEntries = events
        .filter((event) => {
            const toolId = event?.toolCall?.function?.name || event?.result?.toolId || '';
            return (toolId === 'web-fetch' || toolId === 'web-scrape') && event?.result?.success !== false;
        })
        .map((event) => {
            const data = event?.result?.data || {};
            const args = parseToolCallArguments(event?.toolCall?.function?.arguments || '{}');
            const url = String(data?.url || args?.url || '').trim();
            const searchResult = findSearchResultByUrl(searchResults, url);
            const title = normalizeInlineText(data?.title || searchResult?.title || url);
            const snippet = truncateText(normalizeInlineText(searchResult?.snippet || ''), 260);
            const excerpt = extractResearchSourceExcerpt(event);
            const source = deriveResearchSourceLabel(url, searchResult?.source || data?.source || '');
            const toolId = event?.toolCall?.function?.name || event?.result?.toolId || '';

            if (!url || (!title && !snippet && !excerpt)) {
                return null;
            }

            return {
                url,
                title,
                snippet,
                excerpt,
                source,
                toolId,
            };
        })
        .filter(Boolean)
        .slice(0, 6);

    if (!query && searchResults.length === 0 && sourceEntries.length === 0) {
        return '';
    }

    const lines = [];
    if (query) {
        lines.push(`Research query: ${query}`);
    }

    if (searchResults.length > 0) {
        lines.push('Top search results:');
        searchResults.slice(0, 6).forEach((entry, index) => {
            const title = truncateText(normalizeInlineText(entry?.title || 'Untitled result'), 120);
            const url = String(entry?.url || '').trim();
            const source = deriveResearchSourceLabel(url, entry?.source || '');
            const snippet = truncateText(normalizeInlineText(entry?.snippet || ''), 220);
            lines.push([
                `${index + 1}. ${title}`,
                source ? `(${source})` : '',
                url ? `[${url}]` : '',
            ].filter(Boolean).join(' '));
            if (snippet) {
                lines.push(`   Snippet: ${snippet}`);
            }
        });
    }

    if (sourceEntries.length > 0) {
        lines.push('Verified source extracts:');
        sourceEntries.forEach((entry, index) => {
            lines.push([
                `${index + 1}. ${truncateText(entry.title || entry.url, 140)}`,
                entry.source ? `(${entry.source})` : '',
                `[${entry.url}]`,
                entry.toolId ? `via ${entry.toolId}` : '',
            ].filter(Boolean).join(' '));
            if (entry.snippet) {
                lines.push(`   Search snippet: ${entry.snippet}`);
            }
            if (entry.excerpt) {
                lines.push(`   Verified extract: ${entry.excerpt}`);
            }
        });
    }

    return lines.join('\n');
}

function hasUsableSshDefaults() {
    const sshConfig = settingsController.getEffectiveSshConfig();

    return Boolean(
        sshConfig.enabled
        && sshConfig.host
        && sshConfig.username
        && (sshConfig.password || sshConfig.privateKeyPath)
    );
}

function formatSshRuntimeTarget(target = null) {
    if (!target?.host) {
        return null;
    }

    const username = target.username ? `${target.username}@` : '';
    const port = target.port && Number(target.port) !== 22 ? `:${target.port}` : '';
    return `${username}${target.host}${port}`;
}

function hasAutonomousRemoteApproval(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return [
        /\b(do what you need|take it from here|handle it|run with it|finish it|finish setup|finish the setup|complete the setup)\b/,
        /\b(keep going|continue|proceed|go ahead|next steps|do the next steps|obvious next steps)\b/,
        /\b(start the build|continue the build|continue on the server|keep working on the server)\b/,
        /\b(solve|fix|resolve|repair)\b[\s\S]{0,24}\b(issue|problem|it|this)\b/,
        /\b(you have|use)\s+root access\b/,
    ].some((pattern) => pattern.test(normalized));
}

function isRemoteApprovalOnlyTurn(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    const grantsPermission = [
        /\b(i give you permission|you have permission|permission granted|i approve|approved|you are approved)\b/,
        /\b(go ahead and use|you can use|use)\b[\s\S]{0,20}\b(remote command|ssh|server access|remote access)\b/,
        /\b(can use|allowed to use)\b[\s\S]{0,20}\b(remote command|ssh|server access|remote access)\b/,
    ].some((pattern) => pattern.test(normalized));

    if (!grantsPermission) {
        return false;
    }

    return !/\b(health|report|summary|status|state|check|inspect|diagnose|debug|deploy|restart|install|fix|repair|update|change|configure|build|logs?|kubectl|pod|service|ingress)\b/.test(normalized);
}

function resolveRemoteObjectiveFromSession(rawObjective = '', session = null, recentMessages = []) {
    if (!isRemoteApprovalOnlyTurn(rawObjective)) {
        return rawObjective;
    }

    const controlState = getSessionControlState(session);
    const storedObjective = String(controlState.lastRemoteObjective || '').trim();
    if (storedObjective) {
        return storedObjective;
    }

    const transcript = Array.isArray(recentMessages) ? [...recentMessages] : [];
    for (let index = transcript.length - 1; index >= 0; index -= 1) {
        const message = transcript[index];
        if (message?.role !== 'user') {
            continue;
        }

        const candidate = normalizeMessageText(message.content || '').trim();
        if (candidate && !isRemoteApprovalOnlyTurn(candidate)) {
            return candidate;
        }
    }

    return rawObjective;
}

function isLikelyTranscriptDependentTurn(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    const shortTurn = normalized.length <= 120;
    const referentialCue = [
        /\b(it|that|this|them|those|same|again|there)\b/,
        /\b(the commands|what you listed|the one you listed|the ones you listed|what i asked|same task|same thing|that one)\b/,
        /^(?:do|run|schedule|set up|queue|create|make|get|fetch|check)\s+(?:it|that|this|them|those)\b/,
        /^(?:in|after|at|tomorrow|later|once|one[- ]time|daily|hourly|every)\b/,
        /\bfrom now\b/,
    ].some((pattern) => pattern.test(normalized));
    const openEndedCue = /\b(?:in|at|for|to|on|from|with|about|into|around|using|and|then)\s*$/.test(normalized);
    const weakStandaloneCue = shortTurn
        && (
            /^(?:continue|retry|again|later|tomorrow|same)\b/.test(normalized)
            || /^(?:do|run|make|schedule|set up|queue|create|get|fetch|check|use)\s*$/.test(normalized)
        );

    return (shortTurn && referentialCue) || openEndedCue || weakStandaloneCue;
}

function resolveTranscriptObjectiveFromSession(rawObjective = '', recentMessages = []) {
    const objective = String(rawObjective || '').trim();
    if (!isLikelyTranscriptDependentTurn(objective)) {
        return {
            objective,
            usedTranscriptContext: false,
        };
    }

    const transcript = Array.isArray(recentMessages) ? [...recentMessages] : [];
    let priorUserObjective = '';
    for (let index = transcript.length - 1; index >= 0; index -= 1) {
        const message = transcript[index];
        if (message?.role !== 'user') {
            continue;
        }

        const candidate = normalizeMessageText(message.content || '').trim();
        if (!candidate || candidate.toLowerCase() === objective.toLowerCase()) {
            continue;
        }
        if (isLikelyTranscriptDependentTurn(candidate)) {
            continue;
        }

        priorUserObjective = truncateText(candidate, 600);
        break;
    }

    if (!priorUserObjective) {
        return {
            objective,
            usedTranscriptContext: false,
        };
    }

    return {
        objective: `${priorUserObjective}. ${objective}`.trim(),
        usedTranscriptContext: true,
        priorUserObjective,
    };
}

function buildNotesSynthesisInstructions() {
    return [
        'You are editing a Lilly-style block-based notes document.',
        'In this notes interface, "page" means the current notes document unless the user explicitly says web page, site page, route, repo file, or server page.',
        'Your default job here is to edit the current page itself through block updates, not to create standalone HTML, artifact links, or workspace files.',
        'While notes mode is active, the only tools available for supporting work are `web-search`, `web-fetch`, and `web-scrape`.',
        'Do not attempt document generation, artifact creation, filesystem work, image generation, Git, deployments, remote/server commands, or any other tool category from this surface.',
        'Use web results only to improve the current page blocks or to answer the user in chat when they are planning instead of editing.',
        'If the user is asking to add, place, insert, rewrite, reorganize, or polish content on the page, answer as a notes-page edit, not as a workspace/file task.',
        'When the user asks for page changes, the final content should land on the page blocks, not in a separate artifact description.',
        'Only stay in planning/chat mode when the user is explicitly brainstorming, outlining, asking for options, or says not to edit the page yet.',
        'Prefer returning `notes-actions` or page-ready notes content over raw standalone HTML, local file paths, workspace write steps, or filesystem commentary.',
        'Do not use `file-write` or `file-mkdir` to satisfy a notes-page edit. Apply the content to the current page instead.',
        'When you return `notes-actions`, use this exact payload shape: `{ "assistant_reply": "...", "actions": [{ "op": "append_to_page", "blocks": [...] }] }`.',
        'Do not use a top-level `"notes-actions"` property. Do not use `"action"` in place of `"op"`.',
        'Do not use legacy ops like `replace-content`, `append-content`, or `prepend-content`. Use `rebuild_page`, `append_to_page`, `prepend_to_page`, `replace_block`, `insert_after`, or `update_block`.',
        'Available block palette includes `text`, `heading_1`, `heading_2`, `heading_3`, `bulleted_list`, `numbered_list`, `todo`, `toggle`, `quote`, `divider`, `callout`, `code`, `image`, `ai_image`, `bookmark`, `database`, `math`, `mermaid`, and `ai`.',
        'Use richer blocks intentionally: `callout` for takeaways or warnings, `bookmark` for sources, `database` for comparisons or trackers, `toggle` for optional detail, `mermaid` for process/structure, `image` or `ai_image` for visuals, `todo` for next steps, and `quote` for emphasized excerpts.',
        'Think in page roles, not just paragraphs: title/icon, focal summary, themed sections, supporting evidence, interactive detail, sources, and next steps.',
        'Avoid a long heading-then-paragraph ladder for the whole page. Break the rhythm with callouts, visuals, bookmarks, databases, toggles, quotes, and dividers where they add clarity.',
        'Research pages should read like compact knowledge hubs: lead with a summary callout, group findings by theme, and surface real sources as bookmarks instead of burying them in prose.',
        'If a substantial notes page only uses headings, plain text, and list blocks, do a palette audit before finalizing and check whether a richer block type would improve readability or interaction.',
        'Do not ship research, dashboard, documentation, or polished briefing pages as only plain headings and paragraphs unless the user explicitly asked for a minimal layout.',
        'Do not mention `/app`, local command execution, file-write, sandbox limits, or workspace access unless a verified tool result is directly about that and the user explicitly asked about it.',
        'Unless the user explicitly asked to export, download, save, or create a file/link, do not turn the answer into a standalone artifact or HTML file.',
    ].join('\n\n');
}

function hasAutonomyRevocation(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(ask me first|wait for me|hold on|stop here|pause here|don'?t continue|do not continue)\b/.test(normalized);
}

function extractFirstUrl(text = '') {
    const match = String(text || '').match(/https?:\/\/\S+/i);
    return match ? match[0].replace(/[),.;!?]+$/g, '') : null;
}

function shellQuote(value = '') {
    return `'${String(value || '').replace(/'/g, "'\\''")}'`;
}

function extractInternalArtifactUrl(text = '') {
    const source = String(text || '');
    if (!source.trim()) {
        return null;
    }

    const match = source.match(
        /https?:\/\/(?:api|[^\s"'`()]+)\/api\/artifacts\/[a-f0-9-]+\/download(?:\?inline=1)?|\/?api\/artifacts\/[a-f0-9-]+\/download(?:\?inline=1)?/i,
    );
    if (!match?.[0]) {
        return null;
    }

    return match[0].replace(/[),.;!?]+$/g, '');
}

function normalizeInlineFileContent(value) {
    if (value == null) {
        return undefined;
    }

    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }

    if (Array.isArray(value) || typeof value === 'object') {
        try {
            return JSON.stringify(value, null, 2);
        } catch (_error) {
            return String(value);
        }
    }

    return String(value);
}

function extractFencedCodeBlocks(text = '') {
    const source = String(text || '');
    const blocks = [];
    const pattern = /```([a-z0-9_-]*)\s*\n([\s\S]*?)```/gi;
    let match = pattern.exec(source);

    while (match) {
        blocks.push({
            language: String(match[1] || '').trim().toLowerCase(),
            content: String(match[2] || '').trim(),
        });
        match = pattern.exec(source);
    }

    return blocks;
}

function looksLikeStandaloneHtml(text = '') {
    return /<!doctype html>|<html\b|<body\b|<main\b|<article\b|<section\b|<header\b|<figure\b|<img\b|<h1\b/i.test(String(text || ''));
}

function inferFileWriteHint({ path = '', objective = '', reason = '' } = {}) {
    const extension = require('path').extname(String(path || '').trim().toLowerCase());
    const context = `${path}\n${objective}\n${reason}`.toLowerCase();

    const byExtension = {
        '.html': { kind: 'html', fenceLabels: ['html'] },
        '.htm': { kind: 'html', fenceLabels: ['html'] },
        '.json': { kind: 'json', fenceLabels: ['json'] },
        '.md': { kind: 'markdown', fenceLabels: ['md', 'markdown'] },
        '.markdown': { kind: 'markdown', fenceLabels: ['md', 'markdown'] },
        '.js': { kind: 'javascript', fenceLabels: ['js', 'javascript'] },
        '.mjs': { kind: 'javascript', fenceLabels: ['js', 'javascript'] },
        '.cjs': { kind: 'javascript', fenceLabels: ['js', 'javascript'] },
        '.ts': { kind: 'typescript', fenceLabels: ['ts', 'typescript'] },
        '.tsx': { kind: 'typescript', fenceLabels: ['tsx', 'typescript'] },
        '.css': { kind: 'css', fenceLabels: ['css'] },
        '.xml': { kind: 'xml', fenceLabels: ['xml'] },
        '.py': { kind: 'python', fenceLabels: ['py', 'python'] },
        '.sh': { kind: 'shell', fenceLabels: ['sh', 'bash', 'shell'] },
    };

    if (byExtension[extension]) {
        return byExtension[extension];
    }

    if (/\bhtml\b/.test(context)) {
        return { kind: 'html', fenceLabels: ['html'] };
    }

    if (/\bjson\b/.test(context)) {
        return { kind: 'json', fenceLabels: ['json'] };
    }

    return {
        kind: null,
        fenceLabels: [],
    };
}

function inferFileWriteContentFromRecentMessages({
    path = '',
    objective = '',
    reason = '',
    recentMessages = [],
} = {}) {
    const hint = inferFileWriteHint({ path, objective, reason });
    const preferredLabels = new Set(hint.fenceLabels);

    for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
        const message = recentMessages[index];
        const messageText = normalizeMessageText(message?.content || '').trim();
        if (!messageText) {
            continue;
        }

        const blocks = extractFencedCodeBlocks(messageText).filter((block) => block.content);
        if (hint.kind === 'html') {
            const htmlBlock = blocks.find((block) => preferredLabels.has(block.language) || looksLikeStandaloneHtml(block.content));
            if (htmlBlock) {
                return htmlBlock.content;
            }

            if (looksLikeStandaloneHtml(messageText)) {
                return messageText;
            }
            continue;
        }

        if (hint.kind === 'json') {
            const jsonBlock = blocks.find((block) => preferredLabels.has(block.language) || /^[\[{]/.test(block.content.trim()));
            if (jsonBlock) {
                return jsonBlock.content;
            }

            if (/^[\[{]/.test(messageText)) {
                return messageText;
            }
            continue;
        }

        if (preferredLabels.size > 0) {
            const labeledBlock = blocks.find((block) => preferredLabels.has(block.language));
            if (labeledBlock) {
                return labeledBlock.content;
            }
            continue;
        }

        if (blocks.length === 1) {
            return blocks[0].content;
        }
    }

    return undefined;
}

function normalizeFileWritePlanParams(step = {}, { objective = '', recentMessages = [] } = {}) {
    const rawParams = step?.params && typeof step.params === 'object'
        ? { ...step.params }
        : {};
    const pathCandidates = [
        rawParams.path,
        rawParams.filePath,
        rawParams.filepath,
        rawParams.filename,
        rawParams.targetPath,
        rawParams.destination,
        step?.path,
        step?.filePath,
        step?.filename,
        step?.targetPath,
    ];
    const resolvedPath = pathCandidates.find((value) => typeof value === 'string' && value.trim());
    if (resolvedPath) {
        rawParams.path = resolvedPath.trim();
    }

    const directContent = [
        rawParams.content,
        rawParams.contents,
        rawParams.text,
        rawParams.body,
        rawParams.data,
        rawParams.html,
        rawParams.source,
        rawParams.code,
        rawParams.markdown,
        rawParams.fileContent,
        step?.content,
        step?.text,
        step?.body,
        step?.data,
        step?.html,
        step?.code,
    ]
        .map((value) => normalizeInlineFileContent(value))
        .find((value) => typeof value === 'string');

    if (typeof directContent === 'string') {
        rawParams.content = directContent;
        return rawParams;
    }

    const inferredContent = inferFileWriteContentFromRecentMessages({
        path: rawParams.path || '',
        objective,
        reason: typeof step?.reason === 'string' ? step.reason.trim() : '',
        recentMessages,
    });
    if (typeof inferredContent === 'string') {
        rawParams.content = inferredContent;
    }

    return rawParams;
}

function normalizeAgentWorkloadPlanParams(step = {}, { objective = '', session = null, recentMessages = [], toolContext = {} } = {}) {
    const params = step?.params && typeof step.params === 'object'
        ? { ...step.params }
        : {};
    const scenarioRequest = String(
        params.request
        || params.scenario
        || params.description
        || objective
        || step?.reason
        || '',
    ).trim();

    if (!scenarioRequest) {
        return {
            action: 'list',
        };
    }

    const normalizedCreate = buildCanonicalWorkloadAction({
        ...params,
        request: scenarioRequest,
    }, {
        session,
        recentMessages,
        timezone: params.timezone
            || toolContext?.timezone
            || session?.metadata?.timezone
            || session?.metadata?.timeZone
            || getDefaultWorkloadTimezone(),
        now: toolContext?.now || null,
    });
    if (normalizedCreate) {
        return normalizedCreate;
    }

    return {
        action: 'create_from_scenario',
        request: scenarioRequest,
        timezone: params.timezone
            || toolContext?.timezone
            || session?.metadata?.timezone
            || session?.metadata?.timeZone
            || getDefaultWorkloadTimezone(),
    };
}

function buildUbuntuMasterRemoteCommand() {
    return "hostname && uname -m && (test -f /etc/os-release && sed -n '1,3p' /etc/os-release || true) && uptime";
}

function inferFallbackUnsplashQuery(text = '') {
    return String(text || '')
        .replace(/\b(please|can you|could you|would you|find|search|look up|browse|show|get|use|an|a|the|for|with|from|on|about|into|unsplash|image|images|photo|photos|hero|background|cover|visual|visuals)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
}

function inferBlindScrapeParams(text = '', firstUrl = '') {
    const prompt = String(text || '');
    const normalized = prompt.toLowerCase();
    const hasImageIntent = /\b(image|images|photo|photos|thumbnail|thumbnails|gallery|galleries|poster|posters|pics?)\b/i.test(prompt);
    const hasBlindIntent = /\b(blind|opaque|without exposing|without showing|without viewing|without looking at|do not show|don't show)\b/i.test(prompt);
    const hasSensitiveIntent = /\b(adult|explicit|nsfw|porn)\b/i.test(prompt);
    const captureImages = hasImageIntent || hasBlindIntent || hasSensitiveIntent;

    return {
        url: firstUrl,
        browser: true,
        ...(captureImages ? { captureImages: true, imageLimit: 12 } : {}),
        ...((captureImages && (hasBlindIntent || hasSensitiveIntent)) ? { blindImageCapture: true } : {}),
        ...(normalized.includes('javascript') ? { javascript: true } : {}),
    };
}

function inferFallbackSshCommand(text = '', executionProfile = DEFAULT_EXECUTION_PROFILE) {
    const source = String(text || '').trim();
    const normalized = source.toLowerCase();
    if (!normalized) {
        return null;
    }
    const hasInspectionIntent = /\b(check|inspect|verify|diagnose|debug|troubleshoot|status|state|health|healthy|look at|show|list|what'?s running|see what'?s wrong)\b/.test(normalized);

    const firstUrl = extractFirstUrl(source);
    if (firstUrl && /\b(curl|reach|reachable|endpoint|url|auth|login|gitea)\b/.test(normalized)) {
        return `hostname && uname -m && curl -IkfsS --max-time 20 ${shellQuote(firstUrl)}`;
    }

    if (/\b(health|status|healthy|uptime)\b/.test(normalized)) {
        return 'hostname && uptime && (df -h / || true) && (free -m || true)';
    }

    if (hasInspectionIntent && /\b(k3s|k8s|kubernetes|cluster|kubectl|nodes?)\b/.test(normalized)) {
        return 'kubectl get nodes -o wide && kubectl get pods -A';
    }

    if (hasInspectionIntent && /\b(pods?)\b/.test(normalized)) {
        return 'kubectl get pods -A';
    }

    if (hasInspectionIntent && /\b(namespaces?)\b/.test(normalized)) {
        return 'kubectl get namespaces';
    }

    if (/\b(docker|containers?)\b/.test(normalized)) {
        return 'docker ps';
    }

    if (executionProfile === REMOTE_BUILD_EXECUTION_PROFILE) {
        return buildUbuntuMasterRemoteCommand();
    }

    return null;
}

function hasExplicitLocalArtifactReference(text = '') {
    const source = String(text || '').trim();
    if (!source) {
        return false;
    }

    const normalized = source.toLowerCase();
    return /\b(attached artifact|uploaded artifact|local artifact|local file|local html|workspace|repo|repository|on the drive|from the drive|on disk|from disk|readable path|file path)\b/.test(normalized)
        || /[a-z]:\\[^"'`\s]+/i.test(source);
}

function hasRemoteWebsiteUpdateIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    const hasWebsiteTarget = /\b(website|web site|webpage|web page|landing page|homepage|home page|site|html|index\.html|page)\b/.test(normalized);
    const hasRemoteTarget = /\b(remote|server|cluster|k3s|k8s|kubernetes|kubectl|pod|deployment|deployed|workload|rollout|restart|redeploy|configmap|container|ingress|live|public|production|hosted|online)\b/.test(normalized);
    const hasWriteIntent = /\b(write|replace|overwrite|update|edit|change|deploy|redeploy|restart|publish|push|apply|rollout|create|generate|make)\b/.test(normalized);

    return hasWebsiteTarget && hasRemoteTarget && hasWriteIntent;
}

function hasInternalArtifactReference(text = '') {
    const source = String(text || '').trim();
    if (!source) {
        return false;
    }

    return /(?:^|[\s(])\/api\/artifacts\/[a-f0-9-]+\/download\b/i.test(source)
        || /(?:^|[\s(])api\/artifacts\/[a-f0-9-]+\/download\b/i.test(source)
        || /https?:\/\/api\/artifacts\/[a-f0-9-]+\/download\b/i.test(source)
        || /https?:\/\/[^/\s]+\/api\/artifacts\/[a-f0-9-]+\/download\b/i.test(source);
}

function buildRemoteWebsiteSourceInspectionCommand() {
    const configuredTargetDirectory = String(config.deploy.defaultTargetDirectory || '').trim().replace(/\\/g, '/');
    const targetDirectory = configuredTargetDirectory || '/opt/kimibuilt';

    return [
        'set -e',
        'hostname && uname -m',
        `echo "--- configured target directory: ${targetDirectory} ---"`,
        `if [ -d ${shellQuote(targetDirectory)} ]; then`,
        `  find ${shellQuote(targetDirectory)} -maxdepth 3 -type f \\( -name 'index.html' -o -name '*.html' -o -name '*.yaml' -o -name '*.yml' \\) 2>/dev/null | head -n 40`,
        `  if [ -d ${shellQuote(`${targetDirectory}/.git`)} ]; then cd -- ${shellQuote(targetDirectory)} && git status --short --branch; fi`,
        'else',
        `  echo "configured target directory not found: ${targetDirectory}"`,
        'fi',
        "(kubectl get configmap -A -o name 2>/dev/null | grep -Ei 'web|site|html|page|nginx|frontend' | head -n 20 || true)",
    ].join(' && ');
}

function buildRemoteWebsiteWorkloadInspectionCommand() {
    return [
        'hostname && uname -m',
        "(kubectl get deployment,svc,ingress -A 2>/dev/null | grep -Ei 'website|web|site|html|ingress' | head -n 40 || true)",
        "(kubectl get configmap -A 2>/dev/null | grep -Ei 'website|web|site|html|page' | head -n 40 || true)",
        "(kubectl get pods -A -o wide 2>/dev/null | grep -Ei 'website|web|site|html|nginx' | head -n 40 || true)",
    ].join(' && ');
}

function buildRemoteWebsiteBodyVerificationCommand() {
    return [
        'set -e',
        'ns=$(kubectl get deployment,svc,ingress -A -o custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name --no-headers 2>/dev/null | awk \'$2 ~ /website|web|site|ingress/ { print $1; exit }\')',
        'if [ -z "$ns" ]; then ns=default; fi',
        'pod=$(kubectl get pods -n "$ns" -o custom-columns=NAME:.metadata.name --no-headers 2>/dev/null | grep -Ei \'website|web|site|nginx\' | head -n 1 || true)',
        'if [ -n "$pod" ]; then kubectl exec -n "$ns" "$pod" -- sh -lc \'for f in /usr/share/nginx/html/index.html /usr/share/nginx/html/*.html /usr/share/nginx/html/*; do if [ -f "$f" ]; then echo "--- pod file: $f ---"; wc -c "$f"; sed -n "1,40p" "$f"; break; fi; done\'; fi',
        'host=$(kubectl get ingress -A -o jsonpath=\'{range .items[*]}{.spec.rules[0].host}{"\\n"}{end}\' 2>/dev/null | grep -v \'^$\' | head -n 1 || true)',
        'if [ -n "$host" ]; then echo "--- public response ---"; curl -ksS -D - --max-time 20 "https://$host" | sed -n "1,40p" || true; fi',
    ].join('\n');
}

function isMissingLocalHtmlArtifactEvent(event = null) {
    const toolId = canonicalizeRemoteToolId(event?.toolCall?.function?.name || event?.result?.toolId || '');
    const error = String(event?.result?.error || '').trim();
    const args = parseToolCallArguments(event?.toolCall?.function?.arguments || '{}');
    const path = String(args?.path || '').trim();

    return toolId === 'file-read'
        && event?.result?.success === false
        && /\b(enoent|no such file or directory)\b/i.test(error)
        && (!path || /\.(html?|css|js)$/i.test(path));
}

function normalizeShellCommand(command = '') {
    return String(command || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isGenericRemoteBaselineCommand(command = '') {
    return normalizeShellCommand(command) === normalizeShellCommand(buildUbuntuMasterRemoteCommand());
}

function hasRemoteWebsiteInspectionSignal(output = '') {
    const normalized = String(output || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return [
        '<!doctype html',
        '<html',
        'index.html',
        'website.html',
        '/var/www/',
        '/srv/',
        'configmap/',
    ].some((fragment) => normalized.includes(fragment));
}

function isInternalArtifactRemoteFetchFailure(error = '') {
    const normalized = String(error || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /could not resolve host:\s*api/i.test(normalized)
        || /failed to connect to (?:localhost|127\.0\.0\.1) port 3000/i.test(normalized)
        || /connection refused/i.test(normalized) && /\b(?:localhost|127\.0\.0\.1)\b/.test(normalized);
}

function isWebsiteResourceTypeAsDeploymentFailure(error = '') {
    const normalized = String(error || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /deployments\.apps\s+"svc"\s+not found/i.test(normalized)
        || /deployments\.apps\s+"ingress"\s+not found/i.test(normalized);
}

function isWebsiteTitleOnlyVerificationFailure(error = '') {
    const normalized = String(error || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return normalized.includes('--- pod title ---')
        || normalized.includes('--- public title ---');
}

function shouldPreferRemoteFollowupPlan(toolEvents = []) {
    const latestEvent = Array.isArray(toolEvents) && toolEvents.length > 0
        ? toolEvents[toolEvents.length - 1]
        : null;
    if (!latestEvent) {
        return false;
    }

    if (isMissingLocalHtmlArtifactEvent(latestEvent)) {
        return true;
    }

    const toolId = canonicalizeRemoteToolId(latestEvent?.toolCall?.function?.name || latestEvent?.result?.toolId || '');
    if (toolId === 'web-fetch' && latestEvent?.result?.success === true) {
        const args = parseToolCallArguments(latestEvent?.toolCall?.function?.arguments || '{}');
        const internalArtifactUrl = extractInternalArtifactUrl(args?.url || '');
        const body = typeof latestEvent?.result?.data?.body === 'string'
            ? latestEvent.result.data.body.trim()
            : '';

        return Boolean(internalArtifactUrl && body);
    }

    if (!isRemoteCommandToolId(toolId) || latestEvent?.result?.success !== false) {
        return false;
    }

    const error = latestEvent?.result?.error || '';
    return isInternalArtifactRemoteFetchFailure(error)
        || isWebsiteResourceTypeAsDeploymentFailure(error)
        || isWebsiteTitleOnlyVerificationFailure(error);
}

function getLastRemoteToolEvent(toolEvents = []) {
    for (let index = (Array.isArray(toolEvents) ? toolEvents.length : 0) - 1; index >= 0; index -= 1) {
        const event = toolEvents[index];
        if (isRemoteCommandToolId(event?.toolCall?.function?.name || event?.result?.toolId || '')) {
            return event;
        }
    }

    return null;
}

function getLastSuccessfulToolEvent(toolEvents = [], toolId = '') {
    const normalizedToolId = String(toolId || '').trim().toLowerCase();
    for (let index = (Array.isArray(toolEvents) ? toolEvents.length : 0) - 1; index >= 0; index -= 1) {
        const event = toolEvents[index];
        const eventToolId = String(event?.toolCall?.function?.name || event?.result?.toolId || '').trim().toLowerCase();
        if ((!normalizedToolId || eventToolId === normalizedToolId) && event?.result?.success !== false) {
            return event;
        }
    }

    return null;
}

function parseToolCallArguments(rawArguments = '{}') {
    if (!rawArguments) {
        return {};
    }

    return parseLenientJson(rawArguments) || {};
}

function extractRemoteWebsiteConfigMapName(toolEvents = []) {
    const patterns = [
        /`([a-z0-9.-]+)`\s+configmap/i,
        /\bconfigmap\/([a-z0-9.-]+)\b/i,
        /\b([a-z0-9.-]+)\s+configmap\b/i,
    ];

    for (let index = (Array.isArray(toolEvents) ? toolEvents.length : 0) - 1; index >= 0; index -= 1) {
        const event = toolEvents[index];
        const sources = [
            event?.reason || '',
            event?.toolCall?.function?.arguments || '',
            event?.result?.data?.stdout || '',
            event?.result?.data?.stderr || '',
            event?.result?.error || '',
        ];

        for (const source of sources) {
            const text = String(source || '');
            for (const pattern of patterns) {
                const match = text.match(pattern);
                if (match?.[1]) {
                    return match[1];
                }
            }
        }
    }

    return 'website-html';
}

function buildRemoteConfigMapApplyCommand(htmlBody = '', configMapName = 'website-html') {
    const body = String(htmlBody || '').trim();
    if (!body) {
        return buildRemoteWebsiteSourceInspectionCommand();
    }

    const encoded = Buffer.from(body, 'utf8').toString('base64');
    const safeConfigMapName = String(configMapName || 'website-html').trim() || 'website-html';
    const awkConfigMapName = safeConfigMapName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    return [
        'set -e',
        `cm=${shellQuote(safeConfigMapName)}`,
        `ns=$(kubectl get configmap -A -o custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name --no-headers 2>/dev/null | awk '$2 == "${awkConfigMapName}" { print $1; exit }')`,
        'if [ -z "$ns" ]; then echo "ConfigMap not found: $cm" >&2; exit 1; fi',
        'tmp_html=$(mktemp)',
        "cat <<'__KIMI_ARTIFACT_HTML_B64__' | base64 -d > \"$tmp_html\"",
        encoded,
        '__KIMI_ARTIFACT_HTML_B64__',
        'key=$(kubectl get configmap -n "$ns" "$cm" -o go-template=\'{{range $k,$v := .data}}{{printf "%s\\n" $k}}{{end}}\' 2>/dev/null | grep -Ei \'(^|/)(index\\.html?|website\\.html?|.*\\.html?)$\' | head -n 1 || true)',
        'if [ -z "$key" ]; then key=index.html; fi',
        'kubectl create configmap "$cm" -n "$ns" --from-file="$key=$tmp_html" -o yaml --dry-run=client | kubectl apply -f -',
        'rm -f "$tmp_html"',
        'kubectl get configmap -n "$ns" "$cm" -o jsonpath=\'{.metadata.name}{"\\n"}{range $k,$v := .data}{printf "%s\\n" $k}{end}\'',
    ].join('\n');
}

function parseKubernetesInitContainerFailure(output = '') {
    const text = String(output || '');
    if (!text || !/\bInit Containers:\b/.test(text) || !/\b(CrashLoopBackOff|Exit Code:\s*[1-9])\b/.test(text)) {
        return null;
    }

    const lines = text.split(/\r?\n/);
    let podName = null;
    let namespace = null;
    let inInitContainers = false;
    let currentInit = null;
    const initContainers = [];

    for (const rawLine of lines) {
        const line = String(rawLine || '');

        const podMatch = line.match(/^Name:\s+(\S+)/);
        if (podMatch) {
            podName = podMatch[1];
        }

        const namespaceMatch = line.match(/^Namespace:\s+(\S+)/);
        if (namespaceMatch) {
            namespace = namespaceMatch[1];
        }

        if (/^Init Containers:\s*$/.test(line)) {
            inInitContainers = true;
            currentInit = null;
            continue;
        }

        if (inInitContainers && /^[A-Z][A-Za-z ]+:\s*$/.test(line) && !/^Init Containers:\s*$/.test(line)) {
            inInitContainers = false;
            currentInit = null;
        }

        if (!inInitContainers) {
            continue;
        }

        const initMatch = line.match(/^\s{2}([A-Za-z0-9._-]+):\s*$/);
        if (initMatch) {
            currentInit = {
                name: initMatch[1],
                crashLoop: false,
                lastStateError: false,
                exitCode: 0,
            };
            initContainers.push(currentInit);
            continue;
        }

        if (!currentInit) {
            continue;
        }

        if (/Reason:\s+CrashLoopBackOff/.test(line)) {
            currentInit.crashLoop = true;
        }
        if (/Reason:\s+Error/.test(line)) {
            currentInit.lastStateError = true;
        }
        const exitCodeMatch = line.match(/Exit Code:\s+(\d+)/);
        if (exitCodeMatch) {
            currentInit.exitCode = Number(exitCodeMatch[1]) || 0;
        }
    }

    const failingInit = initContainers.find((container) => container.crashLoop || container.lastStateError || container.exitCode > 0);
    if (!podName || !namespace || !failingInit?.name) {
        return null;
    }

    return {
        podName,
        namespace,
        containerName: failingInit.name,
    };
}

function buildRemoteFollowupPlanFromToolEvents({ objective = '', instructions = '', executionProfile = DEFAULT_EXECUTION_PROFILE, toolPolicy = {}, toolEvents = [] } = {}) {
    const remoteToolId = getPreferredRemoteToolId(toolPolicy);
    if (executionProfile !== REMOTE_BUILD_EXECUTION_PROFILE || !remoteToolId) {
        return [];
    }

    const combinedContext = [objective, instructions].filter(Boolean).join('\n');
    const internalArtifactUrl = extractInternalArtifactUrl(combinedContext);

    if (hasRemoteWebsiteUpdateIntent(objective) && !hasExplicitLocalArtifactReference(objective)) {
        const missingLocalHtmlArtifact = [...(Array.isArray(toolEvents) ? toolEvents : [])]
            .reverse()
            .find((event) => isMissingLocalHtmlArtifactEvent(event));

        if (missingLocalHtmlArtifact) {
            return [{
                tool: remoteToolId,
                reason: 'A local HTML artifact could not be read. Inspect the remote website source and cluster ConfigMaps instead of blocking on the missing local file.',
                params: {
                    command: buildRemoteWebsiteSourceInspectionCommand(),
                },
            }];
        }

        const lastRemoteEvent = getLastRemoteToolEvent(toolEvents);
        if (internalArtifactUrl
            && toolPolicy.allowedToolIds?.includes('web-fetch')
            && lastRemoteEvent?.result?.success === false
            && isInternalArtifactRemoteFetchFailure(lastRemoteEvent?.result?.error || '')) {
            return [{
                tool: 'web-fetch',
                reason: 'The remote server cannot reach the app-local artifact endpoint. Fetch the artifact content locally in this runtime before sending it to the remote target.',
                params: {
                    url: internalArtifactUrl,
                },
            }];
        }

        if (lastRemoteEvent?.result?.success === false
            && isWebsiteResourceTypeAsDeploymentFailure(lastRemoteEvent?.result?.error || '')) {
            return [{
                tool: remoteToolId,
                reason: 'The previous command treated service or ingress resource types as deployment names. Re-inspect deployments, services, ingresses, pods, and ConfigMaps separately before changing the live website again.',
                params: {
                    command: buildRemoteWebsiteWorkloadInspectionCommand(),
                },
            }];
        }

        if (lastRemoteEvent?.result?.success === false
            && isWebsiteTitleOnlyVerificationFailure(lastRemoteEvent?.result?.error || '')) {
            return [{
                tool: remoteToolId,
                reason: 'The previous verification relied on page titles, which may be empty. Verify the mounted HTML body and public response content directly instead.',
                params: {
                    command: buildRemoteWebsiteBodyVerificationCommand(),
                },
            }];
        }

        const lastArtifactFetch = getLastSuccessfulToolEvent(toolEvents, 'web-fetch');
        const lastArtifactFetchArgs = parseToolCallArguments(lastArtifactFetch?.toolCall?.function?.arguments || '{}');
        const fetchedArtifactUrl = extractInternalArtifactUrl(lastArtifactFetchArgs?.url || '');
        const fetchedHtmlBody = typeof lastArtifactFetch?.result?.data?.body === 'string'
            ? lastArtifactFetch.result.data.body.trim()
            : '';

        if (internalArtifactUrl
            && fetchedArtifactUrl
            && normalizeShellCommand(fetchedArtifactUrl) === normalizeShellCommand(internalArtifactUrl)
            && fetchedHtmlBody) {
            return [{
                tool: remoteToolId,
                reason: 'Use the artifact content fetched locally by this runtime to update the remote website ConfigMap instead of asking the target server to curl the backend artifact URL.',
                params: {
                    command: buildRemoteConfigMapApplyCommand(
                        fetchedHtmlBody,
                        extractRemoteWebsiteConfigMapName(toolEvents),
                    ),
                },
            }];
        }
    }

    const lastRemoteEvent = getLastRemoteToolEvent(toolEvents);
    if (!lastRemoteEvent || lastRemoteEvent?.result?.success === false) {
        return [];
    }

    const lastArgs = parseToolCallArguments(lastRemoteEvent?.toolCall?.function?.arguments || '{}');

    const combinedOutput = [
        objective,
        lastArgs.command || '',
        lastRemoteEvent?.result?.data?.stdout || '',
        lastRemoteEvent?.result?.data?.stderr || '',
    ].join('\n');

    if (hasRemoteWebsiteUpdateIntent(objective) && !hasExplicitLocalArtifactReference(objective)) {
        const lastCommand = String(lastArgs.command || '').trim();
        const lastRemoteOutput = [
            lastRemoteEvent?.result?.data?.stdout || '',
            lastRemoteEvent?.result?.data?.stderr || '',
        ].join('\n');
        const alreadyInspectingRemoteSource = normalizeShellCommand(lastCommand) === normalizeShellCommand(buildRemoteWebsiteSourceInspectionCommand())
            || hasRemoteWebsiteInspectionSignal(lastRemoteOutput);

        if (!alreadyInspectingRemoteSource && isGenericRemoteBaselineCommand(lastCommand)) {
            return [{
                tool: remoteToolId,
                reason: 'The generic server baseline completed. Inspect the deployed website source or ConfigMap next so the page can be updated remotely.',
                params: {
                    command: buildRemoteWebsiteSourceInspectionCommand(),
                },
            }];
        }
    }

    const initFailure = parseKubernetesInitContainerFailure(combinedOutput);
    if (initFailure) {
        return [{
            tool: remoteToolId,
            reason: `Fetch failing init container logs for ${initFailure.namespace}/${initFailure.podName} after detecting an init container crash.`,
            params: {
                command: `kubectl logs -n ${shellQuote(initFailure.namespace)} ${shellQuote(initFailure.podName)} -c ${shellQuote(initFailure.containerName)} --previous || kubectl logs -n ${shellQuote(initFailure.namespace)} ${shellQuote(initFailure.podName)} -c ${shellQuote(initFailure.containerName)}`,
            },
        }];
    }

    return [];
}

function buildResearchFollowupPlanFromToolEvents({ objective = '', toolPolicy = {}, toolEvents = [] } = {}) {
    if (!hasExplicitWebResearchIntentText(objective) && !hasCurrentInfoIntentText(objective)) {
        return [];
    }

    const lastSearchEvent = getLastSuccessfulToolEvent(toolEvents, 'web-search');
    const searchResults = Array.isArray(lastSearchEvent?.result?.data?.results)
        ? lastSearchEvent.result.data.results
        : [];
    if (searchResults.length === 0) {
        return [];
    }

    const maxPages = normalizeResearchFollowupPageCount();
    const followupCandidates = [];
    const seen = new Set();

    for (const entry of searchResults) {
        const url = String(entry?.url || '').trim();
        if (!url || seen.has(url)) {
            continue;
        }

        seen.add(url);
        followupCandidates.push(url);
        if (followupCandidates.length >= maxPages) {
            break;
        }
    }

    if (followupCandidates.length === 0) {
        return [];
    }

    const preferRenderedFollowups = hasCurrentInfoIntentText(objective);
    if (preferRenderedFollowups && toolPolicy.candidateToolIds.includes('web-scrape')) {
        return followupCandidates.map((url) => ({
            tool: 'web-scrape',
            reason: 'Current-information research follow-up should verify top search results with rendered page scraping.',
            params: {
                url,
                browser: true,
                timeout: 20000,
            },
        }));
    }

    if (toolPolicy.candidateToolIds.includes('web-fetch')) {
        return followupCandidates.map((url) => ({
            tool: 'web-fetch',
            reason: 'Deterministic research follow-up should verify top search results with page fetches.',
            params: {
                url,
                timeout: 20000,
                cache: true,
            },
        }));
    }

    if (toolPolicy.candidateToolIds.includes('web-scrape')) {
        return followupCandidates.map((url) => ({
            tool: 'web-scrape',
            reason: 'Deterministic research follow-up should verify top search results with rendered page scraping.',
            params: {
                url,
                browser: true,
                timeout: 20000,
            },
        }));
    }

    return [];
}

function buildDocumentWorkflowFollowupPlanFromToolEvents({ objective = '', toolPolicy = {}, toolEvents = [] } = {}) {
    if (!hasDocumentWorkflowIntentText(objective)
        || !toolPolicy.candidateToolIds.includes(DOCUMENT_WORKFLOW_TOOL_ID)) {
        return [];
    }

    const params = buildDocumentWorkflowGenerateParams({
        objective,
        toolEvents,
    });

    if (!Array.isArray(params.sources) || params.sources.length === 0) {
        return [];
    }

    return [{
        tool: DOCUMENT_WORKFLOW_TOOL_ID,
        reason: 'Verified research results are ready to be compiled into the requested document or slide deck.',
        params,
    }];
}

function isInvalidRuntimeResponseText(text = '') {
    const normalized = String(text || '').trim().toLowerCase().replace(/[â€™]/g, '\'');
    if (!normalized) {
        return false;
    }

    return [
        'cli_help sub-agent',
        'generalist agent',
        'provided file-system tools',
        'current environment\'s available toolset',
        'current workspace in /app',
        'i do not have access to an ssh-execute tool',
        'i do not have a usable remote-build or ssh execution tool',
        'i can\'t access the remote server from this environment',
        'i cannot access the remote server from this environment',
        'this session is restricted from network/ssh access',
        'this session is restricted from network access',
        'no ssh/network path to the remote server',
        'no ssh path to the remote server',
        'i can\'t run remote-build',
        'i cannot run remote-build',
        'i can\'t connect via ssh',
        'i cannot connect via ssh',
        'i can\'t execute ssh from this session',
        'i cannot execute ssh from this session',
        'bwrap: no permissions to create a new namespace',
        'bwrap: no permissions to create a new na',
        'bwrap: no permissions',
        'basic local commands fail before any ssh attempt',
        'testing command execution first',
        'fails before any remote connection starts',
        'fails before any network connection starts',
        'workspace can execute anything locally',
        'launch a remote check from /app',
        'can\'t inspect config or launch a remote check from /app',
        'what i can do from this session',
        'what i cannot do in this session',
        'runtime exposes a writable file tool',
        'github/canva connector tools',
        'create a new local git repo in /app',
        'i cannot create a new repo from this exact turn',
        'run git init, builds, or normal shell commands',
        'modify the local filesystem',
        'the exact blocker is the runtime sandbox',
        'kernel does not allow non-privileged user namespaces',
        'i don\'t have any remote execution tools available',
        'i do not have any remote execution tools available',
        'remote execution tools available in this turn',
        'i don\'t have tool access in this session',
        'i do not have tool access in this session',
        'unfortunately i don\'t have tool access in this session',
    ].some((pattern) => normalized.includes(pattern));
}

function hasExplicitLocalSandboxIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(run|execute|test)\b[\s\S]{0,40}\b(code|script|snippet)\b/.test(normalized)
        || /\b(code sandbox|sandbox|locally|local code)\b/.test(normalized);
}

function hasOpencodeRepoWorkIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    const repoContext = /\b(this repo|the repo|repository|workspace|codebase|project|app|service|package|module)\b/.test(normalized);
    const codeWorkIntent = /\b(implement|implementation|fix|refactor|rewrite|update|modify|edit|patch|add|create|build|compile|test|run tests?|debug)\b/.test(normalized);
    const infraOnlyIntent = /\b(kubectl|kubernetes|k8s|deployment|deploy|rollout|restart|systemctl|journalctl|ingress|pod|cluster|node|server health|uptime|hostname|dns|tls|certificate|logs?)\b/.test(normalized)
        && !repoContext;

    return repoContext && codeWorkIntent && !infraOnlyIntent;
}

function inferOpencodeTarget(objective = '', session = null) {
    const normalized = String(objective || '').trim().toLowerCase();
    const sshContext = resolveSshRequestContext(objective, session);

    if ((sshContext.shouldTreatAsSsh || /\b(remote|server|ssh|host)\b/.test(normalized))
        && (hasUsableSshDefaults() || sshContext.target?.host)) {
        return 'remote-default';
    }

    return 'local';
}

function resolvePreferredOpencodeWorkspacePath({ session = null, toolContext = {}, target = 'local' } = {}) {
    const opencodeConfig = typeof settingsController.getEffectiveOpencodeConfig === 'function'
        ? settingsController.getEffectiveOpencodeConfig()
        : {};

    if (target === 'remote-default') {
        return String(
            toolContext?.remoteWorkspacePath
            || session?.metadata?.lastOpencodeWorkspacePath
            || opencodeConfig.remoteDefaultWorkspace
            || '',
        ).trim();
    }

    return String(
        toolContext?.workspacePath
        || toolContext?.repositoryPath
        || session?.metadata?.lastOpencodeWorkspacePath
        || config.deploy.defaultRepositoryPath
        || '',
    ).trim();
}

function hasArchitectureDesignIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(architecture|system design|service diagram|deployment diagram|architecture diagram|design the system)\b/.test(normalized);
}

function hasUmlDiagramIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(uml|class diagram|sequence diagram|activity diagram|use ?case diagram|state diagram|component diagram)\b/.test(normalized);
}

function hasApiDesignIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(api design|design api|openapi|swagger|graphql schema|rest api|grpc)\b/.test(normalized);
}

function hasSchemaDesignIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(database schema|design database|generate ddl|ddl\b|er diagram|entity relationship|orm schema)\b/.test(normalized);
}

function hasMigrationIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(create migration|generate migration|schema migration|database change|schema diff|migration)\b/.test(normalized);
}

function hasSecurityScanIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(security|vulnerab|audit|scan|secret)\b/.test(normalized);
}

function canRecoverFromInvalidRuntimeResponse({ output = '', toolEvents = [], toolPolicy = {} } = {}) {
    if (!isInvalidRuntimeResponseText(output) || !Array.isArray(toolPolicy?.candidateToolIds) || toolPolicy.candidateToolIds.length === 0) {
        return false;
    }

    if (!Array.isArray(toolEvents) || toolEvents.length === 0) {
        return true;
    }

    return !toolEvents.some((event) => {
        const toolName = String(event?.toolCall?.function?.name || '').trim().toLowerCase();
        const succeeded = event?.result?.success !== false;
        return succeeded && toolName !== 'code-sandbox';
    });
}

function isTerminalWorkloadCreationEvent(event = {}) {
    const toolName = String(event?.toolCall?.function?.name || event?.result?.toolId || '').trim().toLowerCase();
    const succeeded = event?.result?.success !== false;
    const action = String(event?.result?.data?.action || '').trim().toLowerCase();
    return succeeded
        && toolName === 'agent-workload'
        && (action === 'create' || action === 'create_from_scenario')
        && Boolean(event?.result?.data?.workload || event?.result?.data?.message);
}

function buildTerminalWorkloadCreationOutput(toolEvents = []) {
    const terminalEvent = [...(Array.isArray(toolEvents) ? toolEvents : [])]
        .reverse()
        .find((event) => isTerminalWorkloadCreationEvent(event));
    if (!terminalEvent) {
        return '';
    }

    const message = String(terminalEvent?.result?.data?.message || '').trim();
    if (message) {
        return message;
    }

    const title = String(terminalEvent?.result?.data?.workload?.title || '').trim();
    return title ? `${title} created.` : 'Deferred workload created.';
}

function shouldRepairInvalidRuntimeResponse({ output = '', toolEvents = [], toolPolicy = {} } = {}) {
    return isInvalidRuntimeResponseText(output)
        && Array.isArray(toolPolicy?.candidateToolIds)
        && toolPolicy.candidateToolIds.length > 0
        && Array.isArray(toolEvents)
        && toolEvents.length > 0;
}

function normalizeStepSignature(step = {}) {
    return JSON.stringify({
        tool: canonicalizeRemoteToolId(String(step?.tool || '').trim()),
        params: step?.params && typeof step.params === 'object' ? step.params : {},
    });
}

function extractExecutedStepSignature(toolEvent = {}) {
    const toolName = toolEvent?.toolCall?.function?.name || toolEvent?.result?.toolId || '';
    const params = parseToolCallArguments(toolEvent?.toolCall?.function?.arguments || '{}');

    return normalizeStepSignature({
        tool: toolName,
        params,
    });
}

function shouldSkipStepSignature(signature = '', signatureHistory = [], signatureCounts = new Map()) {
    if (!signature) {
        return false;
    }

    if (signatureHistory[signatureHistory.length - 1] === signature) {
        return true;
    }

    return (signatureCounts.get(signature) || 0) >= MAX_STEP_SIGNATURE_REPEATS;
}

function filterRepeatedPlanSteps(steps = [], signatureHistory = [], signatureCounts = new Map()) {
    const accepted = [];
    const plannedHistory = [...signatureHistory];
    const plannedCounts = new Map(signatureCounts);

    for (const step of Array.isArray(steps) ? steps : []) {
        const signature = normalizeStepSignature(step);
        if (shouldSkipStepSignature(signature, plannedHistory, plannedCounts)) {
            continue;
        }

        accepted.push(step);
        plannedHistory.push(signature);
        plannedCounts.set(signature, (plannedCounts.get(signature) || 0) + 1);
    }

    return accepted;
}

function recordExecutedStepSignatures(toolEvents = [], signatureHistory = [], signatureCounts = new Map()) {
    for (const event of Array.isArray(toolEvents) ? toolEvents : []) {
        const signature = extractExecutedStepSignature(event);
        if (!signature) {
            continue;
        }

        signatureHistory.push(signature);
        signatureCounts.set(signature, (signatureCounts.get(signature) || 0) + 1);
    }
}

function classifyToolFailure(event = {}, executionProfile = DEFAULT_EXECUTION_PROFILE) {
    if (!event || event?.result?.success !== false) {
        return null;
    }

    const rawToolId = event?.toolCall?.function?.name || event?.result?.toolId || '';
    const toolId = canonicalizeRemoteToolId(rawToolId);
    const error = String(event?.result?.error || '').trim();
    const isRemoteFailure = isRemoteCommandToolId(toolId);

    if (!isRemoteFailure) {
        if (executionProfile === REMOTE_BUILD_EXECUTION_PROFILE
            && toolId === 'file-read'
            && /\b(enoent|no such file or directory)\b/i.test(error)) {
            return {
                toolId,
                error,
                blocking: false,
                category: 'missing-local-file-recoverable',
            };
        }

        return {
            toolId,
            error,
            blocking: true,
            category: 'non-remote-tool-failure',
        };
    }

    const blocking = REMOTE_BLOCKING_ERROR_PATTERNS.some((pattern) => pattern.test(error));
    return {
        toolId,
        error,
        blocking,
        category: blocking ? 'remote-blocking' : 'remote-recoverable',
    };
}

function summarizeRoundFailures(toolEvents = [], executionProfile = DEFAULT_EXECUTION_PROFILE) {
    const failures = (Array.isArray(toolEvents) ? toolEvents : [])
        .map((event) => classifyToolFailure(event, executionProfile))
        .filter(Boolean);

    return {
        failures,
        anyFailed: failures.length > 0,
        blockingFailures: failures.filter((entry) => entry.blocking),
        recoverableFailures: failures.filter((entry) => !entry.blocking),
    };
}

function summarizeToolEventsForPlanner(toolEvents = []) {
    return (Array.isArray(toolEvents) ? toolEvents : [])
        .slice(-6)
        .map((event) => ({
            tool: event?.toolCall?.function?.name || '',
            reason: event?.reason || '',
            success: event?.result?.success !== false,
            error: event?.result?.error || '',
            data: event?.result?.data || null,
        }));
}

function toIsoTimestamp(value, fallback = null) {
    if (!value) {
        return fallback;
    }

    const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
    if (Number.isNaN(timestamp)) {
        return fallback;
    }

    return new Date(timestamp).toISOString();
}

function createExecutionTraceEntry({
    type = 'info',
    name = 'Runtime step',
    status = 'completed',
    details = {},
    startedAt = null,
    endedAt = null,
} = {}) {
    const startTime = startedAt || new Date().toISOString();
    const endTime = endedAt || startTime;

    return {
        type,
        name,
        status,
        startTime,
        endTime,
        duration: Math.max(0, new Date(endTime).getTime() - new Date(startTime).getTime()),
        details,
    };
}

function appendModelResponseTrace(executionTrace = [], response = null, {
    startedAt = null,
    phase = 'final-response',
} = {}) {
    if (!Array.isArray(executionTrace) || !response) {
        return;
    }

    const endedAt = new Date().toISOString();
    executionTrace.push(createExecutionTraceEntry({
        type: 'model_call',
        name: `Model response (${response.model || 'unknown'})`,
        startedAt,
        endedAt,
        details: {
            phase,
            responseId: response.id || null,
            outputPreview: truncateText(extractResponseText(response), 200),
        },
    }));
}

function summarizeToolEventForUser(event = {}) {
    const tool = String(event?.toolCall?.function?.name || event?.result?.toolId || 'tool').trim();
    const reason = String(event?.reason || '').trim();
    const result = event?.result || {};
    const success = result?.success !== false;
    const data = result?.data || {};
    const stdout = String(data?.stdout || '').trim();
    const stderr = String(data?.stderr || '').trim();
    const error = String(result?.error || '').trim();
    const exitCode = Number.isFinite(Number(data?.exitCode)) ? Number(data.exitCode) : null;
    let preview = '';

    if (tool === 'web-search') {
        preview = summarizeSearchResults(data?.results || []);
    } else if (tool === 'web-fetch') {
        preview = summarizeFetchedContent(data);
    } else if (stdout || stderr || error) {
        preview = truncateText(normalizeInlineText(stdout || stderr || error), 320);
    } else if (typeof data === 'string') {
        preview = truncateText(normalizeInlineText(data), 320);
    } else if (data && typeof data === 'object') {
        preview = summarizeObjectData(data);
    }

    if (!success) {
        return [
            `- ${tool}: failed`,
            reason ? `Reason: ${reason}.` : '',
            error ? `Error: ${error}.` : '',
            stderr && !error ? `Details: ${truncateText(normalizeInlineText(stderr), 220)}.` : '',
        ].filter(Boolean).join(' ');
    }

    return [
        `- ${tool}: succeeded`,
        reason ? `Reason: ${reason}.` : '',
        exitCode != null ? `Exit code: ${exitCode}.` : '',
        preview ? `Output: ${preview}.` : '',
    ].filter(Boolean).join(' ');
}

function buildRemoteCommandFallbackSynthesisText({ objective = '', toolEvents = [] } = {}) {
    const events = (Array.isArray(toolEvents) ? toolEvents : [])
        .filter((event) => isRemoteCommandToolId(event?.toolCall?.function?.name || event?.result?.toolId || ''));
    if (events.length === 0) {
        return '';
    }

    const sections = [
        objective ? `Remote execution summary for: ${truncateText(normalizeInlineText(objective), 240)}` : 'Remote execution summary',
    ];

    events.slice(0, 6).forEach((event, index) => {
        const reason = String(event?.reason || '').trim() || `Remote command ${index + 1}`;
        const result = event?.result || {};
        const stdout = stripNullCharacters(String(result?.data?.stdout || '')).trim();
        const stderr = stripNullCharacters(String(result?.data?.stderr || '')).trim();
        const error = stripNullCharacters(String(result?.error || '')).trim();

        if (result?.success === false) {
            sections.push(`${reason}\n\nError: ${error || 'Unknown remote command failure.'}`);
            return;
        }

        if (stdout) {
            sections.push(`${reason}\n\n\`\`\`text\n${truncateText(stdout, 2000)}\n\`\`\``);
        } else if (stderr) {
            sections.push(`${reason}\n\n\`\`\`text\n${truncateText(stderr, 800)}\n\`\`\``);
        } else {
            sections.push(`${reason}\n\nCommand completed successfully.`);
        }
    });

    const failures = events.filter((event) => event?.result?.success === false).length;
    sections.push(
        failures > 0
            ? `Summary: ${failures} remote command step${failures === 1 ? '' : 's'} failed.`
            : 'Summary: Remote commands completed successfully.',
    );

    return sections.join('\n\n');
}

function buildFallbackSynthesisText({ objective = '', toolEvents = [] } = {}) {
    const events = Array.isArray(toolEvents) ? toolEvents : [];
    if (events.length === 0) {
        return 'I completed the request, but the final answer could not be synthesized from the model response.';
    }

    const remoteOnlySummary = buildRemoteCommandFallbackSynthesisText({ objective, toolEvents: events });
    if (remoteOnlySummary) {
        return remoteOnlySummary;
    }

    const successes = events.filter((event) => event?.result?.success !== false).length;
    const failures = events.length - successes;
    const normalizedObjective = truncateText(normalizeInlineText(objective), 280);
    const researchDossier = buildResearchDossierFromToolEvents({ objective, toolEvents: events });
    const lines = [
        'Based on the verified tool results, here is the best available answer.',
        normalizedObjective ? `Request: ${normalizedObjective}` : '',
        `Tool calls completed: ${events.length}. Successful: ${successes}. Failed: ${failures}.`,
        '',
        researchDossier ? 'Research dossier:' : 'Verified findings:',
        researchDossier || '',
        ...events
            .filter((event) => !['web-search', 'web-fetch', 'web-scrape'].includes(event?.toolCall?.function?.name || event?.result?.toolId || ''))
            .slice(0, 8)
            .map((event) => summarizeToolEventForUser(event)),
    ];

    const omittedEvents = events
        .filter((event) => !['web-search', 'web-fetch', 'web-scrape'].includes(event?.toolCall?.function?.name || event?.result?.toolId || ''))
        .length - 8;
    if (omittedEvents > 0) {
        lines.push(`- Additional tool results omitted: ${omittedEvents}.`);
    }

    return lines.filter(Boolean).join('\n');
}

function buildVerifiedToolFindingsText(toolEvents = []) {
    return (Array.isArray(toolEvents) ? toolEvents : [])
        .slice(-12)
        .map((event) => summarizeToolEventForUser(event))
        .filter(Boolean)
        .join('\n');
}

function buildCompactToolSynthesisPrompt({ objective = '', taskType = 'chat', toolEvents = [] } = {}) {
    const events = Array.isArray(toolEvents) ? toolEvents : [];
    const researchDossier = buildResearchDossierFromToolEvents({ objective, toolEvents: events });
    const conciseFindings = buildVerifiedToolFindingsText(events);

    return [
        'Write the final user-facing answer using only these verified tool results.',
        'Return plain text only.',
        'If a tool failed, state the exact failure plainly.',
        `Task type: ${taskType}`,
        '',
        'User request:',
        objective || '(empty)',
        '',
        ...(researchDossier
            ? [
                'Research dossier:',
                researchDossier,
                '',
            ]
            : []),
        'Verified findings:',
        conciseFindings || '(none)',
    ].filter(Boolean).join('\n');
}

function isRemoteHealthWorkflowIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    const mentionsRemoteTarget = /\b(remote|server|host|machine|ssh)\b/.test(normalized);
    const looksLikeClusterHealth = /\b(k3s|k8s|kubernetes|kubectl|cluster|pod|deployment|namespace|ingress|service)\b/.test(normalized);
    const asksForHealthReport = /\bhealth report\b/.test(normalized)
        || /\bhealth summary\b/.test(normalized)
        || /\bstatus report\b/.test(normalized)
        || /\bserver state\b/.test(normalized)
        || (/\b(health|status|state)\b/.test(normalized) && /\b(report|summary|overview)\b/.test(normalized));

    return mentionsRemoteTarget && asksForHealthReport && !looksLikeClusterHealth;
}

function isRemoteRetryWorkflowIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(try again|retry|rerun|re-run|recheck)\b/.test(normalized)
        && /\b(remote|server|host|ssh|command)\b/.test(normalized);
}

function buildRemoteHealthWorkflowSteps(target = {}, toolId = 'remote-command') {
    const sharedParams = {
        host: target.host,
        ...(target.username ? { username: target.username } : {}),
        ...(target.port ? { port: target.port } : {}),
    };

    return [
        {
            tool: toolId,
            reason: 'Collect system information for the remote server.',
            params: {
                ...sharedParams,
                command: "hostname && uname -m && (test -f /etc/os-release && sed -n '1,6p' /etc/os-release || true) && uptime",
            },
        },
        {
            tool: toolId,
            reason: 'Collect disk and memory information for the remote server.',
            params: {
                ...sharedParams,
                command: 'df -h / && free -m',
            },
        },
    ];
}

function buildDeterministicRemoteWorkflow({ objective = '', session = null, toolPolicy = {} } = {}) {
    const remoteToolId = getPreferredRemoteToolId(toolPolicy);
    if (!remoteToolId) {
        return null;
    }

    if (hasWorkloadIntent(objective)) {
        return null;
    }

    const sshContext = resolveSshRequestContext(objective, session);
    const target = sshContext.target;
    if (!target?.host) {
        return null;
    }

    const storedWorkflow = getSessionControlState(session).workflow;
    if (isRemoteRetryWorkflowIntent(objective)
        && storedWorkflow?.type === 'remote-health-report'
        && Array.isArray(storedWorkflow.steps)
        && storedWorkflow.steps.length > 0) {
        return {
            type: 'remote-health-report',
            runtimeMode: 'deterministic-remote-health',
            source: 'stored-retry',
            steps: storedWorkflow.steps.map((step) => ({
                tool: canonicalizeRemoteToolId(step?.tool || remoteToolId),
                reason: String(step?.reason || '').trim(),
                params: step?.params && typeof step.params === 'object' ? { ...step.params } : {},
            })),
        };
    }

    if (!isRemoteHealthWorkflowIntent(objective)) {
        return null;
    }

    return {
        type: 'remote-health-report',
        runtimeMode: 'deterministic-remote-health',
        source: 'direct-intent',
        steps: buildRemoteHealthWorkflowSteps(target, remoteToolId),
    };
}

function getDeterministicWorkflowStepTitle(step = {}, index = 0) {
    const reason = String(step?.reason || '').toLowerCase();
    if (reason.includes('system information')) {
        return 'System Information';
    }
    if (reason.includes('disk and memory')) {
        return 'Disk And Memory';
    }
    return `Remote Command ${index + 1}`;
}

function buildDeterministicRemoteWorkflowOutput({ workflow = null, toolEvents = [] } = {}) {
    if (!workflow || workflow.type !== 'remote-health-report') {
        return buildFallbackSynthesisText({ toolEvents });
    }

    const sections = ['Server Health Report'];
    let failures = 0;

    toolEvents.forEach((event, index) => {
        const title = getDeterministicWorkflowStepTitle(workflow.steps?.[index] || event, index);
        const result = event?.result || {};
        const stdout = stripNullCharacters(String(result?.data?.stdout || '')).trim();
        const stderr = stripNullCharacters(String(result?.data?.stderr || '')).trim();
        const error = stripNullCharacters(String(result?.error || '')).trim();

        if (result?.success === false) {
            failures += 1;
            sections.push(`${title}\n\nError: ${error || 'Unknown remote command failure.'}`);
            return;
        }

        if (stdout) {
            sections.push(`${title}\n\n\`\`\`text\n${stdout}\n\`\`\``);
        }

        if (stderr) {
            sections.push(`${title} Warnings\n\n\`\`\`text\n${stderr}\n\`\`\``);
        }
    });

    sections.push(
        failures > 0
            ? `Summary: ${failures} remote health step${failures === 1 ? '' : 's'} failed.`
            : 'Summary: Remote health inspection completed successfully.',
    );

    return sections.filter(Boolean).join('\n\n');
}

function buildDeterministicWorkflowControlState(workflow = null, toolEvents = []) {
    return {
        workflow: {
            type: workflow?.type || 'unknown',
            version: 1,
            status: (Array.isArray(toolEvents) ? toolEvents : []).some((event) => event?.result?.success === false)
                ? 'partial'
                : 'completed',
            retryable: true,
            updatedAt: new Date().toISOString(),
            steps: Array.isArray(workflow?.steps)
                ? workflow.steps.map((step) => ({
                    tool: canonicalizeRemoteToolId(step?.tool || ''),
                    reason: String(step?.reason || '').trim(),
                    params: step?.params && typeof step.params === 'object' ? { ...step.params } : {},
                }))
                : [],
        },
    };
}

function isGenericRemoteFallbackStep(step = {}) {
    return isRemoteCommandToolId(step?.tool || '')
        && String(step?.reason || '').trim() === 'Fallback for explicit server or remote-build intent.';
}

function recoverEmptyModelResponse(response = null, {
    objective = '',
    toolEvents = [],
    executionProfile = DEFAULT_EXECUTION_PROFILE,
    runtimeMode = 'plain',
    phase = 'final-response',
} = {}) {
    const output = extractResponseText(response);
    if (output.trim()) {
        return response;
    }

    const shape = {
        responseKeys: response && typeof response === 'object' ? Object.keys(response).slice(0, 20) : [],
        choiceKeys: response?.choices?.[0] && typeof response.choices[0] === 'object' ? Object.keys(response.choices[0]).slice(0, 20) : [],
        messageKeys: response?.choices?.[0]?.message && typeof response.choices[0].message === 'object' ? Object.keys(response.choices[0].message).slice(0, 20) : [],
        outputItemCount: Array.isArray(response?.output) ? response.output.length : 0,
    };
    console.warn(`[ConversationOrchestrator] Empty model output during ${phase}. Falling back to verified tool summary. Shape=${JSON.stringify(shape)}`);

    return buildSyntheticResponse({
        output: buildFallbackSynthesisText({ objective, toolEvents }),
        responseId: response?.id || null,
        model: response?.model || null,
        metadata: {
            ...(response?.metadata && typeof response.metadata === 'object' ? response.metadata : {}),
            executionProfile,
            runtimeMode,
            toolEvents,
            emptyModelOutputRecovered: true,
            emptyModelOutputPhase: phase,
            rawResponseShape: shape,
        },
    });
}

function getRemoteBuildAutonomyBudget() {
    return {
        maxRounds: Math.max(1, Number(config.runtime?.remoteBuildMaxAutonomousRounds) || 8),
        maxToolCalls: Math.max(1, Number(config.runtime?.remoteBuildMaxAutonomousToolCalls) || 24),
        maxDurationMs: Math.max(1000, Number(config.runtime?.remoteBuildMaxAutonomousMs) || 120000),
    };
}

function getRemoteBuildAutonomyExtensionBudget() {
    return {
        maxUses: Math.max(0, Number(config.runtime?.remoteBuildBudgetExtensionMaxUses) || 0),
        rounds: Math.max(0, Number(config.runtime?.remoteBuildBudgetExtensionRounds) || 0),
        toolCalls: Math.max(0, Number(config.runtime?.remoteBuildBudgetExtensionToolCalls) || 0),
        durationMs: Math.max(0, Number(config.runtime?.remoteBuildBudgetExtensionMs) || 0),
    };
}

function normalizePositiveBudget(value, fallback) {
    const normalized = Number(value);
    if (Number.isFinite(normalized) && normalized > 0) {
        return normalized;
    }

    return fallback;
}

function countUniqueExecutedStepSignatures(toolEvents = []) {
    const signatures = new Set();

    for (const event of Array.isArray(toolEvents) ? toolEvents : []) {
        const signature = extractExecutedStepSignature(event);
        if (signature) {
            signatures.add(signature);
        }
    }

    return signatures.size;
}

function summarizeAutonomyProgress(toolEvents = [], failureSummary = null) {
    const events = Array.isArray(toolEvents) ? toolEvents : [];
    const summary = failureSummary || summarizeRoundFailures(events);
    const successfulToolCalls = events.filter((event) => event?.result?.success !== false).length;
    const failedToolCalls = events.length - successfulToolCalls;
    const uniqueStepSignatures = countUniqueExecutedStepSignatures(events);

    return {
        toolCalls: events.length,
        successfulToolCalls,
        failedToolCalls,
        uniqueStepSignatures,
        blockingFailures: summary?.blockingFailures?.length || 0,
        recoverableFailures: summary?.recoverableFailures?.length || 0,
        productive: events.length > 0
            && successfulToolCalls > 0
            && uniqueStepSignatures > 0
            && (summary?.blockingFailures?.length || 0) === 0,
    };
}

function maybeExtendAutonomyBudget({
    autonomyApproved = false,
    reason = 'progress',
    startedAt = Date.now(),
    round = 0,
    toolEvents = [],
    lastProgress = null,
    budgetState = {},
    extensionBudget = {},
    executionTrace = [],
} = {}) {
    if (!autonomyApproved) {
        return false;
    }

    if ((budgetState.extensionsUsed || 0) >= (extensionBudget.maxUses || 0)) {
        return false;
    }

    if ((extensionBudget.rounds || 0) <= 0
        && (extensionBudget.toolCalls || 0) <= 0
        && (extensionBudget.durationMs || 0) <= 0) {
        return false;
    }

    if (!lastProgress?.productive) {
        return false;
    }

    budgetState.extensionsUsed = (budgetState.extensionsUsed || 0) + 1;
    budgetState.maxRounds += extensionBudget.rounds || 0;
    budgetState.maxToolCalls += extensionBudget.toolCalls || 0;
    budgetState.autonomyDeadline += extensionBudget.durationMs || 0;

    executionTrace.push(createExecutionTraceEntry({
        type: 'budget',
        name: 'Autonomous execution budget extended',
        details: {
            reason,
            round,
            toolCalls: toolEvents.length,
            elapsedMs: Date.now() - startedAt,
            extensionsUsed: budgetState.extensionsUsed,
            maxExtensions: extensionBudget.maxUses || 0,
            addedRounds: extensionBudget.rounds || 0,
            addedToolCalls: extensionBudget.toolCalls || 0,
            addedDurationMs: extensionBudget.durationMs || 0,
            lastProgress: {
                toolCalls: lastProgress.toolCalls || 0,
                successfulToolCalls: lastProgress.successfulToolCalls || 0,
                failedToolCalls: lastProgress.failedToolCalls || 0,
                uniqueStepSignatures: lastProgress.uniqueStepSignatures || 0,
                blockingFailures: lastProgress.blockingFailures || 0,
                recoverableFailures: lastProgress.recoverableFailures || 0,
            },
            updatedBudget: {
                maxRounds: budgetState.maxRounds,
                maxToolCalls: budgetState.maxToolCalls,
                maxDurationMs: Math.max(0, budgetState.autonomyDeadline - startedAt),
            },
        },
    }));

    return true;
}

function getPreferredRemoteToolId(toolPolicy = {}) {
    const availableToolIds = Array.isArray(toolPolicy?.candidateToolIds) && toolPolicy.candidateToolIds.length > 0
        ? toolPolicy.candidateToolIds
        : Array.isArray(toolPolicy?.allowedToolIds)
            ? toolPolicy.allowedToolIds
            : [];

    if (availableToolIds.includes('remote-command')) {
        return 'remote-command';
    }

    if (availableToolIds.includes('ssh-execute')) {
        return 'ssh-execute';
    }

    return null;
}

function sanitizeValue(value, depth = 0) {
    if (value == null) {
        return value;
    }

    if (typeof value === 'string') {
        return truncateText(value, MAX_TOOL_RESULT_CHARS);
    }

    if (typeof value !== 'object') {
        return value;
    }

    if (depth >= 4) {
        return '[truncated]';
    }

    if (Array.isArray(value)) {
        return value.slice(0, 20).map((entry) => sanitizeValue(entry, depth + 1));
    }

    return Object.fromEntries(
        Object.entries(value)
            .slice(0, 30)
            .map(([key, entry]) => [key, sanitizeValue(entry, depth + 1)]),
    );
}

function normalizeToolResult(result, fallbackToolId, timing = {}) {
    const endTime = toIsoTimestamp(timing?.endedAt || result?.endedAt || result?.timestamp, new Date().toISOString());
    const explicitStartTime = toIsoTimestamp(timing?.startedAt || result?.startedAt, null);
    const fallbackStartTime = explicitStartTime
        || toIsoTimestamp(new Date(new Date(endTime).getTime() - Math.max(0, Number(result?.duration || 0))), endTime);
    const durationFromTimestamps = Math.max(0, new Date(endTime).getTime() - new Date(fallbackStartTime).getTime());

    return {
        success: result?.success !== false,
        toolId: result?.toolId || fallbackToolId,
        duration: Number(result?.duration || durationFromTimestamps || 0),
        data: sanitizeValue(result?.data),
        error: result?.error || null,
        timestamp: endTime,
        startedAt: fallbackStartTime,
        endedAt: endTime,
    };
}

function extractVerifiedImageEmbeds(toolEvents = []) {
    return toolEvents.flatMap((event) => {
        const data = event?.result?.data || {};
        const embeds = [];

        if (typeof data.markdownImage === 'string' && data.markdownImage.trim()) {
            embeds.push(data.markdownImage.trim());
        }

        if (Array.isArray(data.markdownImages)) {
            embeds.push(...data.markdownImages
                .filter((entry) => typeof entry === 'string' && entry.trim())
                .map((entry) => entry.trim()));
        }

        return embeds;
    });
}

function buildResearchMemoryNotesFromToolEvents({ objective = '', toolEvents = [] } = {}) {
    if (!hasExplicitWebResearchIntentText(objective)) {
        return [];
    }

    const searchResults = Array.isArray(getLastSuccessfulToolEvent(toolEvents, 'web-search')?.result?.data?.results)
        ? getLastSuccessfulToolEvent(toolEvents, 'web-search').result.data.results
        : [];
    const searchResultByUrl = new Map(
        searchResults
            .filter((entry) => String(entry?.url || '').trim())
            .map((entry) => [String(entry.url).trim(), entry]),
    );
    const seen = new Set();

    return toolEvents
        .filter((event) => event?.result?.success && ['web-fetch', 'web-scrape'].includes(event?.result?.toolId || event?.toolCall?.function?.name))
        .map((event) => {
            const result = event.result || {};
            const url = String(result?.data?.url || '').trim();
            if (!url || seen.has(url)) {
                return null;
            }

            seen.add(url);
            const searchMeta = searchResultByUrl.get(url) || {};
            const title = String(searchMeta.title || result?.data?.title || '').trim();
            const snippet = String(searchMeta.snippet || '').replace(/\s+/g, ' ').trim();
            const sourceNotes = (result.toolId === 'web-fetch'
                ? stripHtmlToText(String(result?.data?.body || ''))
                : (
                    String(result?.data?.content || result?.data?.text || '').trim()
                    || stripHtmlToText(JSON.stringify(result?.data?.data || {}))
                ))
                .slice(0, config.memory.researchSourceExcerptChars)
                .trim();

            if (!title && !snippet && !sourceNotes) {
                return null;
            }

            return [
                '[Research note]',
                `Query: ${objective}`,
                title ? `Title: ${title}` : null,
                `URL: ${url}`,
                snippet ? `Search snippet: ${snippet}` : null,
                sourceNotes ? `Source notes: ${sourceNotes}` : null,
            ].filter(Boolean).join('\n');
        })
        .filter(Boolean)
        .slice(0, normalizeResearchFollowupPageCount());
}

function buildSyntheticResponse({ output, responseId, model, metadata = {} }) {
    return {
        id: responseId || `resp_orch_${Date.now()}`,
        object: 'response',
        created: Math.floor(Date.now() / 1000),
        model: model || null,
        output: [
            {
                type: 'message',
                role: 'assistant',
                content: [
                    {
                        type: 'output_text',
                        text: output || '',
                    },
                ],
            },
        ],
        metadata,
    };
}

async function* createSyntheticStream(response = {}) {
    const text = extractResponseText(response);
    if (text) {
        for (let index = 0; index < text.length; index += SYNTHETIC_STREAM_CHUNK_SIZE) {
            yield {
                type: 'response.output_text.delta',
                delta: text.slice(index, index + SYNTHETIC_STREAM_CHUNK_SIZE),
            };
        }
    }

    yield {
        type: 'response.completed',
        response,
    };
}

class ConversationOrchestrator extends EventEmitter {
    constructor({
        llmClient,
        toolManager = null,
        sessionStore = null,
        memoryService = null,
        embedder = null,
        vectorStore = null,
    } = {}) {
        super();
        this.llmClient = llmClient || {
            createResponse: (params) => createResponse(params),
            complete: async (prompt, options = {}) => {
                const response = await createResponse({
                    input: prompt,
                    stream: false,
                    model: options.model || null,
                    reasoningEffort: options.reasoningEffort || null,
                });
                return extractResponseText(response);
            },
        };
        this.toolManager = toolManager;
        this.sessionStore = sessionStore;
        this.memoryService = memoryService;
        this.embedder = embedder;
        this.vectorStore = vectorStore;
    }

    async execute(taskConfig = {}) {
        const startedAt = Date.now();
        const sessionId = taskConfig.sessionId || `sdk-${Date.now()}`;
        const result = await this.executeConversation({
            input: taskConfig.input || taskConfig.prompt || '',
            sessionId,
            model: taskConfig.model || null,
            reasoningEffort: taskConfig.reasoningEffort || taskConfig.options?.reasoningEffort || null,
            instructions: taskConfig.instructions || null,
            executionProfile: taskConfig.options?.executionProfile || taskConfig.executionProfile || DEFAULT_EXECUTION_PROFILE,
            metadata: taskConfig.options || {},
            stream: false,
        });

        return {
            output: result.output,
            trace: result.trace,
            duration: Date.now() - startedAt,
            sessionId,
            response: result.response,
        };
    }

    async executeConversation({
        input,
        instructions = null,
        contextMessages = [],
        recentMessages = [],
        stream = false,
        model = null,
        reasoningEffort = null,
        toolManager = null,
        toolContext = {},
        loadContextMessages = true,
        loadRecentMessages = true,
        sessionId = 'default',
        ownerId = null,
        taskType = 'chat',
        metadata = {},
        executionProfile = DEFAULT_EXECUTION_PROFILE,
        memoryInput = '',
        requestedToolIds = [],
        toolBudget = null,
    } = {}) {
        const startedAt = Date.now();
        const setupStartedAt = new Date().toISOString();
        const resolvedProfile = normalizeExecutionProfile(executionProfile);
        const rawObjective = extractObjective(input, memoryInput);
        const runtimeToolManager = toolManager || this.toolManager;
        const clientSurface = resolveClientSurface({
            taskType,
            clientSurface: toolContext?.clientSurface || metadata?.clientSurface || metadata?.client_surface || '',
            metadata,
        }, null, taskType);
        const scopedSessionMetadata = buildScopedSessionMetadata({
            mode: taskType,
            taskType,
            clientSurface,
            memoryScope: toolContext?.memoryScope || metadata?.memoryScope || metadata?.memory_scope || '',
            transport: toolContext?.transport || metadata?.transport || '',
            metadata,
        });
        let executionTrace = [];
        const session = ownerId && this.sessionStore?.getOrCreateOwned
            ? await this.sessionStore.getOrCreateOwned(sessionId, scopedSessionMetadata, ownerId)
            : this.sessionStore?.getOrCreate
                ? await this.sessionStore.getOrCreate(sessionId, scopedSessionMetadata)
                : ownerId && this.sessionStore?.getOwned
                    ? await this.sessionStore.getOwned(sessionId, ownerId)
                    : (this.sessionStore?.get ? await this.sessionStore.get(sessionId) : null);
        const memoryScope = resolveSessionScope({
            ...scopedSessionMetadata,
            memoryScope: toolContext?.memoryScope || metadata?.memoryScope || metadata?.memory_scope || '',
        }, session || null);
        toolContext = {
            ...toolContext,
            ...(clientSurface ? { clientSurface } : {}),
            ...(memoryScope ? { memoryScope } : {}),
            ...(Array.isArray(toolContext?.memoryKeywords) ? { memoryKeywords: toolContext.memoryKeywords } : {}),
        };
        const resolvedRecentMessages = recentMessages.length > 0
            ? recentMessages
            : loadRecentMessages !== false && this.sessionStore?.getRecentMessages
                ? await this.sessionStore.getRecentMessages(sessionId, RECENT_TRANSCRIPT_LIMIT)
                : [];
        const memoryKeywords = Array.isArray(toolContext?.memoryKeywords)
            ? toolContext.memoryKeywords
            : (Array.isArray(metadata?.memoryKeywords) ? metadata.memoryKeywords : []);
        const memoryRecall = contextMessages.length > 0
            ? { contextMessages, trace: null }
            : loadContextMessages !== false && this.memoryService?.process
                ? await this.memoryService.process(sessionId, memoryInput || rawObjective, {
                    profile: inferRecallProfileFromText(memoryInput || rawObjective),
                    ownerId,
                    memoryScope,
                    memoryKeywords,
                    sourceSurface: clientSurface || memoryScope || null,
                    returnDetails: true,
                })
                : { contextMessages: [], trace: null };
        const resolvedContextMessages = Array.isArray(memoryRecall)
            ? memoryRecall
            : Array.isArray(memoryRecall?.contextMessages)
                ? memoryRecall.contextMessages
            : [];
        const memoryTrace = Array.isArray(memoryRecall) ? null : (memoryRecall?.trace || null);
        const remoteResolvedObjective = resolvedProfile === REMOTE_BUILD_EXECUTION_PROFILE
            ? resolveRemoteObjectiveFromSession(rawObjective, session, resolvedRecentMessages)
            : rawObjective;
        const transcriptObjective = resolveTranscriptObjectiveFromSession(remoteResolvedObjective, resolvedRecentMessages);
        const objective = transcriptObjective.objective;
        const effectiveInstructions = transcriptObjective.usedTranscriptContext
            ? [
                instructions || '',
                'The current user turn may be abbreviated or cut off. Use the recent transcript to resolve the intended task and continue without asking the user to restate prior context unless the transcript is genuinely insufficient.',
            ].filter(Boolean).join('\n\n')
            : instructions;

        const toolPolicy = this.buildToolPolicy({
            objective,
            instructions: effectiveInstructions,
            session,
            metadata,
            executionProfile: resolvedProfile,
            toolManager: runtimeToolManager,
            requestedToolIds,
            recentMessages: resolvedRecentMessages,
            toolContext,
        });

        this.emit('task:start', {
            task: { type: taskType, objective },
            sessionId,
            timestamp: Date.now(),
            metadata: {
                ...metadata,
                executionProfile: resolvedProfile,
                tools: toolPolicy.candidateToolIds,
            },
        });

        let finalResponse;
        let output;
        let toolEvents = [];
        let plan = [];
        let runtimeMode = 'plain';
        const traceModelResponse = (response, phase = 'final-response', startedAtOverride = null) => {
            appendModelResponseTrace(executionTrace, response, {
                phase,
                startedAt: startedAtOverride,
            });
        };
        const requestedAutonomyApproval = Boolean(
            metadata?.remoteBuildAutonomyApproved
            || metadata?.remote_build_autonomy_approved
            || metadata?.frontendRemoteBuildAutonomyApproved
            || metadata?.frontend_remote_build_autonomy_approved,
        );
        const autonomyApprovalSource = requestedAutonomyApproval
            ? 'frontend'
            : hasAutonomousRemoteApproval(objective)
                ? 'user'
                : session?.metadata?.remoteBuildAutonomyApproved
                    ? 'session'
                    : config.runtime.remoteBuildAutonomyDefault
                        ? 'config'
                    : null;
        const autonomyApproved = resolvedProfile === REMOTE_BUILD_EXECUTION_PROFILE
            && !hasAutonomyRevocation(objective)
            && (
                requestedAutonomyApproval
                || hasAutonomousRemoteApproval(objective)
                || Boolean(session?.metadata?.remoteBuildAutonomyApproved)
                || Boolean(config.runtime.remoteBuildAutonomyDefault)
            );
        const autonomyBudget = getRemoteBuildAutonomyBudget();
        const autonomyExtensionBudget = getRemoteBuildAutonomyExtensionBudget();
        const allowsDeterministicResearchFollowup = !autonomyApproved && hasExplicitWebResearchIntentText(objective);
        const hasCustomToolBudget = Number.isFinite(Number(toolBudget?.maxDurationMs)) && Number(toolBudget.maxDurationMs) > 0;
        const budgetState = {
            maxRounds: normalizePositiveBudget(
                toolBudget?.maxRounds,
                autonomyApproved ? autonomyBudget.maxRounds : (allowsDeterministicResearchFollowup ? 2 : 1),
            ),
            maxToolCalls: normalizePositiveBudget(
                toolBudget?.maxToolCalls,
                autonomyApproved ? autonomyBudget.maxToolCalls : MAX_PLAN_STEPS,
            ),
            autonomyDeadline: startedAt + normalizePositiveBudget(
                toolBudget?.maxDurationMs,
                autonomyApproved ? autonomyBudget.maxDurationMs : 1000,
            ),
            extensionsUsed: 0,
        };

        try {
            executionTrace.push(createExecutionTraceEntry({
                type: 'setup',
                name: 'Conversation setup',
                startedAt: setupStartedAt,
                endedAt: new Date().toISOString(),
                details: {
                    executionProfile: resolvedProfile,
                    contextMessages: resolvedContextMessages.length,
                    recentMessages: resolvedRecentMessages.length,
                    toolCandidates: toolPolicy.candidateToolIds.length,
                },
            }));

            if (resolvedProfile === REMOTE_BUILD_EXECUTION_PROFILE) {
                executionTrace.push(createExecutionTraceEntry({
                    type: 'approval',
                    name: autonomyApproved
                        ? 'Remote-build autonomy approved'
                        : 'Remote-build autonomy not approved',
                    details: {
                        approved: autonomyApproved,
                        source: autonomyApprovalSource || 'none',
                        maxAutonomousRounds: budgetState.maxRounds,
                        maxAutonomousToolCalls: budgetState.maxToolCalls,
                        maxAutonomousDurationMs: autonomyApproved ? autonomyBudget.maxDurationMs : 0,
                        maxAutonomousExtensions: autonomyExtensionBudget.maxUses || 0,
                    },
                }));
            }

            const deterministicWorkflow = buildDeterministicRemoteWorkflow({
                objective,
                session,
                toolPolicy,
            });

            if (deterministicWorkflow) {
                runtimeMode = deterministicWorkflow.runtimeMode;
                executionTrace.push(createExecutionTraceEntry({
                    type: 'planning',
                    name: 'Deterministic workflow selection',
                    details: {
                        workflow: deterministicWorkflow.type,
                        source: deterministicWorkflow.source,
                        stepCount: deterministicWorkflow.steps.length,
                    },
                }));

                const deterministicExecutionStartedAt = new Date().toISOString();
                const {
                    toolEvents: deterministicToolEvents,
                } = await this.executePlan({
                    plan: deterministicWorkflow.steps,
                    toolManager: runtimeToolManager,
                    sessionId,
                    executionProfile: resolvedProfile,
                    toolContext,
                    objective,
                    session,
                    recentMessages: resolvedRecentMessages,
                    executionTrace,
                    round: 1,
                });

                toolEvents = deterministicToolEvents;
                executionTrace.push(createExecutionTraceEntry({
                    type: 'execution',
                    name: 'Deterministic workflow execution',
                    startedAt: deterministicExecutionStartedAt,
                    endedAt: new Date().toISOString(),
                    status: deterministicToolEvents.some((event) => event?.result?.success === false) ? 'error' : 'completed',
                    details: {
                        workflow: deterministicWorkflow.type,
                        stepCount: deterministicToolEvents.length,
                    },
                }));

                finalResponse = this.withResponseMetadata(buildSyntheticResponse({
                    output: buildDeterministicRemoteWorkflowOutput({
                        workflow: deterministicWorkflow,
                        toolEvents,
                    }),
                    responseId: `resp_workflow_${Date.now()}`,
                    model: model || null,
                    metadata: {
                        deterministicWorkflow: true,
                        workflowType: deterministicWorkflow.type,
                        toolEvents,
                    },
                }), {
                    executionProfile: resolvedProfile,
                    runtimeMode,
                    toolEvents,
                    toolPolicy,
                    autonomyApproved,
                    executionTrace,
                });

                traceModelResponse(finalResponse, 'deterministic-workflow', deterministicExecutionStartedAt);
                output = extractResponseText(finalResponse);

                return this.completeConversationRun({
                    sessionId,
                    ownerId,
                    userText: rawObjective,
                    objective,
                    taskType,
                    executionProfile: resolvedProfile,
                    runtimeMode,
                    toolPolicy,
                    toolEvents,
                    output,
                    finalResponse,
                    startedAt,
                    metadata,
                    clientSurface,
                    memoryKeywords,
                    memoryTrace,
                    autonomyApproved,
                    executionTrace,
                    stream,
                    controlStatePatch: buildDeterministicWorkflowControlState(deterministicWorkflow, toolEvents),
                });
            }

            const executedStepSignatures = [];
            const executedStepSignatureCounts = new Map();
            let round = 0;
            let lastAutonomyProgress = null;

            while (true) {
                if (round >= budgetState.maxRounds) {
                    const extended = maybeExtendAutonomyBudget({
                        autonomyApproved,
                        reason: 'round-limit',
                        startedAt,
                        round,
                        toolEvents,
                        lastProgress: lastAutonomyProgress,
                        budgetState,
                        extensionBudget: autonomyExtensionBudget,
                        executionTrace,
                    });

                    if (!extended) {
                        executionTrace.push(createExecutionTraceEntry({
                            type: 'budget',
                            name: 'Autonomous execution round budget reached',
                            details: {
                                round,
                                maxRounds: budgetState.maxRounds,
                                toolCalls: toolEvents.length,
                                maxToolCalls: budgetState.maxToolCalls,
                                elapsedMs: Date.now() - startedAt,
                                maxDurationMs: (autonomyApproved || hasCustomToolBudget) ? Math.max(0, budgetState.autonomyDeadline - startedAt) : 0,
                                extensionsUsed: budgetState.extensionsUsed,
                                maxExtensions: autonomyExtensionBudget.maxUses || 0,
                            },
                        }));
                        break;
                    }
                }

                if ((autonomyApproved || hasCustomToolBudget) && Date.now() >= budgetState.autonomyDeadline) {
                    const extended = maybeExtendAutonomyBudget({
                        autonomyApproved,
                        reason: 'time-limit-before-round',
                        startedAt,
                        round,
                        toolEvents,
                        lastProgress: lastAutonomyProgress,
                        budgetState,
                        extensionBudget: autonomyExtensionBudget,
                        executionTrace,
                    });

                    if (extended) {
                        continue;
                    }

                    executionTrace.push(createExecutionTraceEntry({
                        type: 'budget',
                        name: 'Autonomous execution time budget reached',
                        details: {
                            round,
                            phase: 'before-round',
                            maxRounds: budgetState.maxRounds,
                            toolCalls: toolEvents.length,
                            maxToolCalls: budgetState.maxToolCalls,
                            elapsedMs: Date.now() - startedAt,
                            maxDurationMs: Math.max(0, budgetState.autonomyDeadline - startedAt),
                            extensionsUsed: budgetState.extensionsUsed,
                            maxExtensions: autonomyExtensionBudget.maxUses || 0,
                        },
                    }));
                    break;
                }

                if (toolEvents.length >= budgetState.maxToolCalls) {
                    const extended = maybeExtendAutonomyBudget({
                        autonomyApproved,
                        reason: 'tool-limit',
                        startedAt,
                        round,
                        toolEvents,
                        lastProgress: lastAutonomyProgress,
                        budgetState,
                        extensionBudget: autonomyExtensionBudget,
                        executionTrace,
                    });

                    if (extended) {
                        continue;
                    }

                    executionTrace.push(createExecutionTraceEntry({
                        type: 'budget',
                        name: 'Autonomous execution tool budget reached',
                        details: {
                            round,
                            maxRounds: budgetState.maxRounds,
                            toolCalls: toolEvents.length,
                            maxToolCalls: budgetState.maxToolCalls,
                            elapsedMs: Date.now() - startedAt,
                            maxDurationMs: (autonomyApproved || hasCustomToolBudget) ? Math.max(0, budgetState.autonomyDeadline - startedAt) : 0,
                            extensionsUsed: budgetState.extensionsUsed,
                            maxExtensions: autonomyExtensionBudget.maxUses || 0,
                        },
                    }));
                    break;
                }

                round += 1;
                let nextPlan = [];
                const planningStartedAt = new Date().toISOString();

                if (round === 1) {
                    const directAction = this.buildDirectAction({
                        objective,
                        session,
                        recentMessages: resolvedRecentMessages,
                        toolPolicy,
                        toolContext,
                        toolEvents,
                    });

                    if (directAction) {
                        runtimeMode = 'direct-tool';
                        nextPlan = [directAction];
                    }
                }

                if (nextPlan.length === 0 && toolPolicy.candidateToolIds.length > 0) {
                    nextPlan = await this.planToolUse({
                        objective,
                        instructions: effectiveInstructions,
                        contextMessages: resolvedContextMessages,
                        recentMessages: resolvedRecentMessages,
                        session,
                        toolContext,
                        executionProfile: resolvedProfile,
                        toolPolicy,
                        model,
                        reasoningEffort,
                        taskType,
                        toolEvents,
                        autonomyApproved,
                    });
                    if (nextPlan.length > 0 && runtimeMode === 'plain') {
                        runtimeMode = 'planned-tools';
                    }
                }

                nextPlan = filterRepeatedPlanSteps(nextPlan, executedStepSignatures, executedStepSignatureCounts);

                if (autonomyApproved) {
                    const guidedRemotePlan = filterRepeatedPlanSteps(
                        buildRemoteFollowupPlanFromToolEvents({
                            objective,
                            instructions,
                            executionProfile: resolvedProfile,
                            toolPolicy,
                            toolEvents,
                        }),
                        executedStepSignatures,
                        executedStepSignatureCounts,
                    );

                    if (guidedRemotePlan.length > 0
                        && (nextPlan.length === 0 || shouldPreferRemoteFollowupPlan(toolEvents))) {
                        nextPlan = guidedRemotePlan;
                        runtimeMode = 'guided-tools';
                    }
                }

                if (!autonomyApproved && nextPlan.length === 0) {
                    const guidedResearchPlan = filterRepeatedPlanSteps(
                        buildResearchFollowupPlanFromToolEvents({
                            objective,
                            toolPolicy,
                            toolEvents,
                        }),
                        executedStepSignatures,
                        executedStepSignatureCounts,
                    );

                    if (guidedResearchPlan.length > 0) {
                        nextPlan = guidedResearchPlan;
                        runtimeMode = 'guided-tools';
                    }
                }

                if (nextPlan.length === 0) {
                    const guidedDocumentPlan = filterRepeatedPlanSteps(
                        buildDocumentWorkflowFollowupPlanFromToolEvents({
                            objective,
                            toolPolicy,
                            toolEvents,
                        }),
                        executedStepSignatures,
                        executedStepSignatureCounts,
                    );

                    if (guidedDocumentPlan.length > 0) {
                        nextPlan = guidedDocumentPlan;
                        runtimeMode = 'guided-tools';
                    }
                }

                if (autonomyApproved && nextPlan.length > 0) {
                    const remainingToolBudget = Math.max(0, budgetState.maxToolCalls - toolEvents.length);
                    nextPlan = nextPlan.slice(0, remainingToolBudget);
                }

                if (autonomyApproved
                    && nextPlan.length > 0
                    && nextPlan.every((step) => isGenericRemoteFallbackStep(step))
                    && toolEvents.some((event) => isGenericRemoteFallbackStep({
                        tool: event?.toolCall?.function?.name || event?.result?.toolId || '',
                        reason: event?.reason || '',
                    }))) {
                    executionTrace.push(createExecutionTraceEntry({
                        type: 'planning',
                        name: `Stop repeated generic fallback after round ${round}`,
                        details: {
                            round,
                            reason: 'A generic remote fallback step already succeeded earlier in this run.',
                        },
                    }));
                    nextPlan = [];
                }

                executionTrace.push(createExecutionTraceEntry({
                    type: 'planning',
                    name: `Plan round ${round}`,
                    startedAt: planningStartedAt,
                    endedAt: new Date().toISOString(),
                    details: {
                        round,
                        autonomyApproved,
                        stepCount: nextPlan.length,
                        steps: nextPlan.map((step) => ({
                            tool: step.tool,
                            reason: step.reason,
                        })),
                    },
                }));

                if (nextPlan.length === 0) {
                    break;
                }

                if ((autonomyApproved || hasCustomToolBudget) && Date.now() >= budgetState.autonomyDeadline) {
                    const extended = maybeExtendAutonomyBudget({
                        autonomyApproved,
                        reason: 'time-limit-after-planning',
                        startedAt,
                        round,
                        toolEvents,
                        lastProgress: lastAutonomyProgress,
                        budgetState,
                        extensionBudget: autonomyExtensionBudget,
                        executionTrace,
                    });

                    if (extended) {
                        round -= 1;
                        continue;
                    }

                    executionTrace.push(createExecutionTraceEntry({
                        type: 'budget',
                        name: 'Autonomous execution time budget reached',
                        details: {
                            round,
                            phase: 'after-planning',
                            pendingPlanSteps: nextPlan.length,
                            maxRounds: budgetState.maxRounds,
                            toolCalls: toolEvents.length,
                            maxToolCalls: budgetState.maxToolCalls,
                            elapsedMs: Date.now() - startedAt,
                            maxDurationMs: Math.max(0, budgetState.autonomyDeadline - startedAt),
                            extensionsUsed: budgetState.extensionsUsed,
                            maxExtensions: autonomyExtensionBudget.maxUses || 0,
                        },
                    }));
                    break;
                }

                plan.push(...nextPlan);
                const executionStartedAt = new Date().toISOString();

                const {
                    toolEvents: roundToolEvents,
                    budgetExceeded,
                } = await this.executePlan({
                    plan: nextPlan,
                    toolManager: runtimeToolManager,
                    sessionId,
                    executionProfile: resolvedProfile,
                    toolContext,
                    objective,
                    session,
                    recentMessages: resolvedRecentMessages,
                    autonomyDeadline: (autonomyApproved || hasCustomToolBudget) ? budgetState.autonomyDeadline : null,
                    executionTrace,
                    round,
                });

                toolEvents.push(...roundToolEvents);
                recordExecutedStepSignatures(roundToolEvents, executedStepSignatures, executedStepSignatureCounts);

                const roundFailureSummary = summarizeRoundFailures(roundToolEvents, resolvedProfile);
                const roundFailed = roundFailureSummary.anyFailed;
                const blockingRoundFailure = roundFailureSummary.blockingFailures.length > 0;
                lastAutonomyProgress = summarizeAutonomyProgress(roundToolEvents, roundFailureSummary);
                executionTrace.push(createExecutionTraceEntry({
                    type: 'execution',
                    name: `Execution round ${round}`,
                    startedAt: executionStartedAt,
                    endedAt: new Date().toISOString(),
                    status: roundFailed ? 'error' : 'completed',
                    details: {
                        round,
                        plannedToolCalls: nextPlan.length,
                        toolCalls: roundToolEvents.length,
                        skippedPlannedSteps: Math.max(0, nextPlan.length - roundToolEvents.length),
                        failed: roundFailed,
                        budgetExceeded,
                        blockingFailure: blockingRoundFailure,
                        tools: roundToolEvents.map((event) => ({
                            tool: event?.toolCall?.function?.name || '',
                            success: event?.result?.success !== false,
                            reason: event?.reason || '',
                            error: event?.result?.error || null,
                        })),
                        failures: roundFailureSummary.failures.map((failure) => ({
                            tool: failure.toolId,
                            error: failure.error || null,
                            blocking: failure.blocking,
                            category: failure.category,
                        })),
                    },
                }));

                if (autonomyApproved && budgetExceeded) {
                    const extended = maybeExtendAutonomyBudget({
                        autonomyApproved,
                        reason: 'time-limit-during-round',
                        startedAt,
                        round,
                        toolEvents,
                        lastProgress: lastAutonomyProgress,
                        budgetState,
                        extensionBudget: autonomyExtensionBudget,
                        executionTrace,
                    });

                    if (extended) {
                        continue;
                    }

                    executionTrace.push(createExecutionTraceEntry({
                        type: 'budget',
                        name: 'Autonomous execution time budget reached',
                        details: {
                            round,
                            phase: 'during-round',
                            maxRounds: budgetState.maxRounds,
                            toolCalls: toolEvents.length,
                            maxToolCalls: budgetState.maxToolCalls,
                            elapsedMs: Date.now() - startedAt,
                            maxDurationMs: Math.max(0, budgetState.autonomyDeadline - startedAt),
                            skippedPlannedSteps: Math.max(0, nextPlan.length - roundToolEvents.length),
                            extensionsUsed: budgetState.extensionsUsed,
                            maxExtensions: autonomyExtensionBudget.maxUses || 0,
                        },
                    }));
                    break;
                }

                if (autonomyApproved && roundFailed && !blockingRoundFailure) {
                    executionTrace.push(createExecutionTraceEntry({
                        type: 'replan',
                        name: `Recoverable remote failure after round ${round}`,
                        details: {
                            round,
                            failures: roundFailureSummary.recoverableFailures.map((failure) => ({
                                tool: failure.toolId,
                                error: failure.error || null,
                            })),
                        },
                    }));
                }

                if (roundToolEvents.some((event) => isTerminalWorkloadCreationEvent(event))) {
                    runtimeMode = runtimeMode || 'direct-tool';
                    const terminalOutput = buildTerminalWorkloadCreationOutput(roundToolEvents);
                    finalResponse = this.withResponseMetadata(buildSyntheticResponse({
                        output: terminalOutput,
                        responseId: `resp_workload_${Date.now()}`,
                        model: model || null,
                        metadata: {
                            terminalWorkloadCreation: true,
                            toolEvents,
                        },
                    }), {
                        executionProfile: resolvedProfile,
                        runtimeMode,
                        toolEvents,
                        toolPolicy,
                        autonomyApproved,
                        executionTrace,
                    });
                    output = extractResponseText(finalResponse);
                    return this.completeConversationRun({
                        sessionId,
                        ownerId,
                        userText: rawObjective,
                        objective,
                        taskType,
                        executionProfile: resolvedProfile,
                        runtimeMode,
                        toolPolicy,
                        toolEvents,
                        output,
                        finalResponse,
                        startedAt,
                        metadata,
                        clientSurface,
                        memoryKeywords,
                        memoryTrace,
                        autonomyApproved,
                        executionTrace,
                        stream,
                    });
                }

                if (!autonomyApproved || blockingRoundFailure || roundToolEvents.length === 0) {
                    break;
                }
            }

            const finalResponseStartedAt = new Date().toISOString();
            finalResponse = await this.buildFinalResponse({
                input: transcriptObjective.usedTranscriptContext ? objective : input,
                objective,
                instructions: effectiveInstructions,
                contextMessages: resolvedContextMessages,
                recentMessages: resolvedRecentMessages,
                model,
                reasoningEffort,
                taskType,
                executionProfile: resolvedProfile,
                toolPolicy,
                toolEvents,
                runtimeMode,
                autonomyApproved,
                executionTrace,
            });
            traceModelResponse(finalResponse, toolEvents.length > 0 ? 'tool-synthesis' : 'direct-response', finalResponseStartedAt);

            output = extractResponseText(finalResponse);
            if (canRecoverFromInvalidRuntimeResponse({ output, toolEvents, toolPolicy })) {
                const recoveryPlan = this.buildFallbackPlan({
                    objective,
                    session,
                    toolContext,
                    executionProfile: resolvedProfile,
                    toolPolicy,
                    toolEvents,
                    model,
                });
                const filteredRecoveryPlan = filterRepeatedPlanSteps(
                    recoveryPlan,
                    executedStepSignatures,
                    executedStepSignatureCounts,
                );

                if (filteredRecoveryPlan.length > 0) {
                    runtimeMode = 'recovered-tools';
                    const recoveryPlanningStartedAt = new Date().toISOString();
                    executionTrace.push(createExecutionTraceEntry({
                        type: 'planning',
                        name: 'Recovery plan',
                        startedAt: recoveryPlanningStartedAt,
                        endedAt: new Date().toISOString(),
                        details: {
                            invalidModelResponse: true,
                            stepCount: filteredRecoveryPlan.length,
                            steps: filteredRecoveryPlan.map((step) => ({
                                tool: step.tool,
                                reason: step.reason,
                            })),
                        },
                    }));

                    const recoveryExecutionStartedAt = new Date().toISOString();
                    const {
                        toolEvents: recoveryToolEvents,
                    } = await this.executePlan({
                        plan: filteredRecoveryPlan,
                        toolManager: runtimeToolManager,
                        sessionId,
                        executionProfile: resolvedProfile,
                        toolContext,
                        objective,
                        session,
                        recentMessages: resolvedRecentMessages,
                        executionTrace,
                    });
                    toolEvents.push(...recoveryToolEvents);
                    recordExecutedStepSignatures(recoveryToolEvents, executedStepSignatures, executedStepSignatureCounts);
                    executionTrace.push(createExecutionTraceEntry({
                        type: 'execution',
                        name: 'Recovery execution',
                        startedAt: recoveryExecutionStartedAt,
                        endedAt: new Date().toISOString(),
                        status: recoveryToolEvents.some((event) => event?.result?.success === false) ? 'error' : 'completed',
                        details: {
                            toolCalls: recoveryToolEvents.length,
                            tools: recoveryToolEvents.map((event) => ({
                                tool: event?.toolCall?.function?.name || '',
                                success: event?.result?.success !== false,
                                error: event?.result?.error || null,
                            })),
                        },
                    }));

                    const recoveredResponseStartedAt = new Date().toISOString();
                    finalResponse = await this.buildFinalResponse({
                        input,
                        objective,
                        instructions,
                        contextMessages: resolvedContextMessages,
                        recentMessages: resolvedRecentMessages,
                        model,
                        reasoningEffort,
                        taskType,
                        executionProfile: resolvedProfile,
                        toolPolicy,
                        toolEvents,
                        runtimeMode,
                        autonomyApproved,
                        executionTrace,
                    });
                    traceModelResponse(finalResponse, 'recovery-synthesis', recoveredResponseStartedAt);
                    output = extractResponseText(finalResponse);
                }
            }

            if (shouldRepairInvalidRuntimeResponse({ output, toolEvents, toolPolicy })) {
                runtimeMode = 'repaired-final';
                const repairStartedAt = new Date().toISOString();
                const previousInvalidOutput = output;

                finalResponse = await this.repairInvalidFinalResponse({
                    invalidOutput: previousInvalidOutput,
                    objective,
                    instructions,
                    contextMessages: resolvedContextMessages,
                    recentMessages: resolvedRecentMessages,
                    model,
                    reasoningEffort,
                    taskType,
                    executionProfile: resolvedProfile,
                    toolPolicy,
                    toolEvents,
                    runtimeMode,
                    autonomyApproved,
                    executionTrace,
                });
                traceModelResponse(finalResponse, 'repair', repairStartedAt);
                output = extractResponseText(finalResponse);
                executionTrace.push(createExecutionTraceEntry({
                    type: 'repair',
                    name: 'Response repair',
                    startedAt: repairStartedAt,
                    endedAt: new Date().toISOString(),
                    details: {
                        reason: 'Invalid tool-availability claim after verified tool execution',
                        previousOutput: truncateText(previousInvalidOutput, 800),
                    },
                }));
            }

            return this.completeConversationRun({
                sessionId,
                ownerId,
                userText: rawObjective,
                objective,
                taskType,
                executionProfile: resolvedProfile,
                runtimeMode,
                toolPolicy,
                toolEvents,
                output,
                finalResponse,
                startedAt,
                metadata,
                clientSurface,
                memoryKeywords,
                memoryTrace,
                autonomyApproved,
                executionTrace,
                stream,
                controlStatePatch: {},
            });
        } catch (error) {
            this.emit('task:error', {
                task: { type: taskType, objective },
                sessionId,
                timestamp: Date.now(),
                error: error.message,
                stack: error.stack,
                metadata: {
                    ...metadata,
                    executionProfile: resolvedProfile,
                },
            });
            throw error;
        }
    }

    buildToolPolicy({
        objective = '',
        instructions = '',
        session = null,
        metadata = {},
        executionProfile = DEFAULT_EXECUTION_PROFILE,
        toolManager = null,
        requestedToolIds = [],
        recentMessages = [],
        toolContext = {},
    }) {
        const baseAllowedToolIds = (PROFILE_TOOL_ALLOWLISTS[executionProfile] || PROFILE_TOOL_ALLOWLISTS[DEFAULT_EXECUTION_PROFILE])
            .filter((toolId) => toolManager?.getTool?.(toolId));
        const requested = Array.isArray(requestedToolIds)
            ? requestedToolIds.map((toolId) => String(toolId || '').trim()).filter(Boolean)
            : [];
        const allowedToolIds = requested.length > 0
            ? baseAllowedToolIds.filter((toolId) => requested.includes(toolId))
            : baseAllowedToolIds;
        const prompt = `${objective || ''}\n${instructions || ''}`.toLowerCase();
        const candidates = new Set();
        const remoteToolId = getPreferredRemoteToolId({ allowedToolIds });
        const userCheckpointPolicy = toolContext?.userCheckpointPolicy && typeof toolContext.userCheckpointPolicy === 'object'
            ? toolContext.userCheckpointPolicy
            : {};
        const canUseUserCheckpoint = allowedToolIds.includes(USER_CHECKPOINT_TOOL_ID)
            && userCheckpointPolicy.enabled === true
            && Number(userCheckpointPolicy.remaining || 0) > 0
            && !userCheckpointPolicy.pending;
        const hasUrl = /https?:\/\//i.test(prompt);
        const hasExplicitWebResearchIntent = hasExplicitWebResearchIntentText(prompt);
        const hasExplicitScrapeIntent = /\b(scrape|extract|selector|structured|parse)\b/.test(prompt);
        const hasImageIntent = /\b(image|images|visual|visuals|illustration|illustrations|photo|photos|hero image|background image|cover image)\b/.test(prompt);
        const hasUnsplashIntent = /\bunsplash\b/.test(prompt);
        const hasImageUrlIntent = hasImageIntent && /\b(url|link)\b/.test(prompt);
        const hasDirectImageUrl = /https?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg)(?:\?\S*)?/i.test(prompt);
        const hasArchitectureIntent = hasArchitectureDesignIntent(prompt);
        const hasUmlIntent = hasUmlDiagramIntent(prompt);
        const hasApiIntent = hasApiDesignIntent(prompt);
        const hasSchemaIntent = hasSchemaDesignIntent(prompt);
        const hasMigrationChangeIntent = hasMigrationIntent(prompt);
        const hasSecurityIntent = hasSecurityScanIntent(prompt);
        const hasDocumentWorkflowIntent = hasDocumentWorkflowIntentText(prompt);
        const hasOpencodeIntent = hasOpencodeRepoWorkIntent(prompt);
        const inferredWorkload = buildCanonicalWorkloadAction({
            request: objective,
        }, {
            session,
            recentMessages,
            timezone: toolContext?.timezone
                || session?.metadata?.timezone
                || session?.metadata?.timeZone
                || getDefaultWorkloadTimezone(),
            now: toolContext?.now || null,
        });
        const hasWorkloadSetupIntent = hasWorkloadIntent(`${objective || ''}\n${instructions || ''}`)
            || inferredWorkload?.trigger?.type === 'cron'
            || inferredWorkload?.trigger?.type === 'once';
        const isDeferredWorkloadRun = metadata?.workloadRun === true || metadata?.clientSurface === 'workload';
        const hasExplicitLocalArtifacts = hasExplicitLocalArtifactReference(objective);
        const remoteWebsiteUpdateIntent = hasRemoteWebsiteUpdateIntent(prompt);
        const hasInternalArtifactUrl = hasInternalArtifactReference(`${objective || ''}\n${instructions || ''}`);
        const shouldPreferRemoteWebsiteSource = executionProfile === REMOTE_BUILD_EXECUTION_PROFILE
            && remoteWebsiteUpdateIntent
            && !hasExplicitLocalArtifacts;
        const sshContext = resolveSshRequestContext(objective, session);
        const hasSshDefaults = hasUsableSshDefaults();
        const hasReachableSshTarget = Boolean(hasSshDefaults || sshContext.target?.host);

        if (executionProfile === REMOTE_BUILD_EXECUTION_PROFILE) {
            if (!isDeferredWorkloadRun && hasWorkloadSetupIntent && allowedToolIds.includes('agent-workload')) {
                candidates.add('agent-workload');
            }
            [
                'web-search',
                'tool-doc-read',
            ].forEach((toolId) => allowedToolIds.includes(toolId) && candidates.add(toolId));

            if (allowedToolIds.includes('web-fetch')
                && (hasInternalArtifactUrl
                    || !shouldPreferRemoteWebsiteSource
                    || (!hasInternalArtifactUrl && (hasUrl || hasExplicitWebResearchIntent)))) {
                candidates.add('web-fetch');
            }

            if (!shouldPreferRemoteWebsiteSource) {
                ['file-read', 'file-search'].forEach((toolId) => allowedToolIds.includes(toolId) && candidates.add(toolId));
            }

            if (remoteToolId && (sshContext.shouldTreatAsSsh || executionProfile === REMOTE_BUILD_EXECUTION_PROFILE)) {
                candidates.add(remoteToolId);
            }
            if (hasOpencodeIntent && allowedToolIds.includes('opencode-run')) {
                candidates.add('opencode-run');
            }
            if (allowedToolIds.includes('docker-exec')) {
                candidates.add('docker-exec');
            }
            if (allowedToolIds.includes('code-sandbox') && hasExplicitLocalSandboxIntent(prompt)) {
                candidates.add('code-sandbox');
            }
            if (hasArchitectureIntent && allowedToolIds.includes('architecture-design')) {
                candidates.add('architecture-design');
            }
            if (hasUmlIntent && allowedToolIds.includes('uml-generate')) {
                candidates.add('uml-generate');
            }
            if (hasApiIntent && allowedToolIds.includes('api-design')) {
                candidates.add('api-design');
            }
            if (hasSchemaIntent && allowedToolIds.includes('schema-generate')) {
                candidates.add('schema-generate');
            }
            if (hasMigrationChangeIntent && allowedToolIds.includes('migration-create')) {
                candidates.add('migration-create');
            }
            if (hasSecurityIntent && allowedToolIds.includes('security-scan')) {
                candidates.add('security-scan');
            }
            if (hasDocumentWorkflowIntent && allowedToolIds.includes(DOCUMENT_WORKFLOW_TOOL_ID)) {
                candidates.add(DOCUMENT_WORKFLOW_TOOL_ID);
            }
            if (hasImageIntent && allowedToolIds.includes('image-generate')) {
                candidates.add('image-generate');
            }
            if (hasUnsplashIntent && allowedToolIds.includes('image-search-unsplash')) {
                candidates.add('image-search-unsplash');
            }
            if ((hasImageUrlIntent || hasDirectImageUrl) && allowedToolIds.includes('image-from-url')) {
                candidates.add('image-from-url');
            }
            if (!shouldPreferRemoteWebsiteSource
                && allowedToolIds.includes('file-write')
                && /\b(write|create|update|edit|save|patch|fix)\b/.test(prompt)) {
                candidates.add('file-write');
            }
            if (!shouldPreferRemoteWebsiteSource
                && allowedToolIds.includes('file-mkdir')
                && /\b(create|make|mkdir)\b/.test(prompt)) {
                candidates.add('file-mkdir');
            }
        } else {
            if (!isDeferredWorkloadRun && hasWorkloadSetupIntent && allowedToolIds.includes('agent-workload')) {
                candidates.add('agent-workload');
            }
            if (remoteToolId && (sshContext.shouldTreatAsSsh || /\b(remote server|remote host|remote machine)\b/.test(prompt))) {
                candidates.add(remoteToolId);
            }
            if ((hasExplicitWebResearchIntent || /\b(latest|current|today|news|headlines?|weather|forecast|temperature|research|look up|search|browse)\b/.test(prompt)) && allowedToolIds.includes('web-search')) {
                candidates.add('web-search');
            }
            if (hasExplicitScrapeIntent) {
                if (allowedToolIds.includes('web-search')) {
                    candidates.add('web-search');
                }
                if (allowedToolIds.includes('web-scrape')) {
                    candidates.add('web-scrape');
                }
            }
            if (hasExplicitWebResearchIntent && hasUrl && allowedToolIds.includes('web-fetch')) {
                candidates.add('web-fetch');
            }
            if (hasUrl && allowedToolIds.includes('web-fetch')) {
                candidates.add(hasExplicitScrapeIntent && allowedToolIds.includes('web-scrape')
                    ? 'web-scrape'
                    : 'web-fetch');
            }
            if (hasImageIntent && /\b(generate|create|make|design)\b/.test(prompt) && allowedToolIds.includes('image-generate')) {
                candidates.add('image-generate');
            }
            if ((hasUnsplashIntent || (hasImageIntent && /\b(search|find|browse|reference|stock)\b/.test(prompt))) && allowedToolIds.includes('image-search-unsplash')) {
                candidates.add('image-search-unsplash');
            }
            if ((hasImageUrlIntent || hasDirectImageUrl) && allowedToolIds.includes('image-from-url')) {
                candidates.add('image-from-url');
            }
            if (/\b(read|open|show|print|cat)\b[\s\S]{0,40}\bfile\b/.test(prompt) && allowedToolIds.includes('file-read')) {
                candidates.add('file-read');
            }
            if (/\b(find|search|locate|list)\b[\s\S]{0,40}\bfiles?\b/.test(prompt) && allowedToolIds.includes('file-search')) {
                candidates.add('file-search');
            }
            if (/\b(write|save|create|update|edit)\b[\s\S]{0,40}\bfile\b/.test(prompt) && allowedToolIds.includes('file-write')) {
                candidates.add('file-write');
            }
            if (/\b(create|make|mkdir)\b[\s\S]{0,40}\b(folder|directory)\b/.test(prompt) && allowedToolIds.includes('file-mkdir')) {
                candidates.add('file-mkdir');
            }
            if (/\b(git|github)\b[\s\S]{0,80}\b(status|diff|branch|stage|add|commit|push|save and push|save-and-push)\b/.test(prompt)
                && allowedToolIds.includes('git-safe')) {
                candidates.add('git-safe');
            }
            if (/\b(deploy|rollout|apply|set image|update image|sync)\b[\s\S]{0,60}\b(k3s|k8s|kubernetes|kubectl|manifest|deployment|helm)\b/.test(prompt)
                && allowedToolIds.includes('k3s-deploy')) {
                candidates.add('k3s-deploy');
            }
            if (/\btool\b[\s\S]{0,40}\b(help|doc|docs|documentation|how)\b/.test(prompt) && allowedToolIds.includes('tool-doc-read')) {
                candidates.add('tool-doc-read');
            }
            if (hasArchitectureIntent && allowedToolIds.includes('architecture-design')) {
                candidates.add('architecture-design');
            }
            if (hasUmlIntent && allowedToolIds.includes('uml-generate')) {
                candidates.add('uml-generate');
            }
            if (hasApiIntent && allowedToolIds.includes('api-design')) {
                candidates.add('api-design');
            }
            if (hasSchemaIntent && allowedToolIds.includes('schema-generate')) {
                candidates.add('schema-generate');
            }
            if (hasMigrationChangeIntent && allowedToolIds.includes('migration-create')) {
                candidates.add('migration-create');
            }
            if (hasSecurityIntent && allowedToolIds.includes('security-scan')) {
                candidates.add('security-scan');
            }
            if (hasDocumentWorkflowIntent && allowedToolIds.includes(DOCUMENT_WORKFLOW_TOOL_ID)) {
                candidates.add(DOCUMENT_WORKFLOW_TOOL_ID);
            }
        }

        if (canUseUserCheckpoint && (candidates.size > 0 || hasExplicitCheckpointRequestText(prompt) || hasSubstantialWorkIntentText(prompt))) {
            candidates.add(USER_CHECKPOINT_TOOL_ID);
        }

        return {
            executionProfile,
            allowedToolIds,
            candidateToolIds: allowedToolIds.filter((toolId) => candidates.has(toolId)),
            hasSshDefaults,
            hasReachableSshTarget,
            sshRuntimeTarget: formatSshRuntimeTarget(sshContext.target),
            userCheckpointPolicy: {
                enabled: userCheckpointPolicy.enabled === true,
                remaining: Math.max(0, Number(userCheckpointPolicy.remaining) || 0),
                pending: userCheckpointPolicy.pending || null,
            },
            toolDescriptions: Object.fromEntries(
                allowedToolIds.map((toolId) => [
                    toolId,
                    toolManager?.getTool?.(toolId)?.description
                        || toolManager?.getTool?.(toolId)?.name
                        || toolId,
                ]),
            ),
        };
    }

    buildDirectAction({ objective = '', session = null, recentMessages = [], toolPolicy = {}, toolContext = {}, toolEvents = [] }) {
        const researchQuery = extractExplicitWebResearchQuery(objective);
        const currentInfoQuery = !researchQuery ? extractImplicitCurrentInfoQuery(objective) : null;
        const searchQuery = researchQuery || currentInfoQuery;
        const firstUrl = extractFirstUrl(objective);
        const remoteToolId = getPreferredRemoteToolId(toolPolicy);
        const documentWorkflowParams = buildDocumentWorkflowGenerateParams({
            objective,
            toolEvents,
        });
        const hasGroundedDocumentSources = Array.isArray(documentWorkflowParams.sources)
            && documentWorkflowParams.sources.length > 0;
        const shouldForcePlannerForMultiWorkload = toolPolicy.candidateToolIds.includes('agent-workload')
            && hasMultiWorkloadSchedulingIntent(objective);
        const normalizedCreate = toolPolicy.candidateToolIds.includes('agent-workload')
            ? buildCanonicalWorkloadAction({
                request: objective,
            }, {
                session,
                recentMessages,
                timezone: toolContext?.timezone
                    || session?.metadata?.timezone
                    || session?.metadata?.timeZone
                    || getDefaultWorkloadTimezone(),
                now: toolContext?.now || null,
            })
            : null;
        if (toolPolicy.candidateToolIds.includes('agent-workload')
            && !shouldForcePlannerForMultiWorkload
            && (
                hasWorkloadIntent(objective)
                || normalizedCreate?.trigger?.type === 'cron'
                || normalizedCreate?.trigger?.type === 'once'
            )) {
            if (normalizedCreate) {
                return {
                    tool: 'agent-workload',
                    reason: 'Explicit later or recurring-agent request should be converted into a persisted workload.',
                    params: normalizedCreate,
                };
            }

            return {
                tool: 'agent-workload',
                reason: 'Explicit later or recurring-agent request should be converted into a persisted workload.',
                params: {
                    action: 'create_from_scenario',
                    request: objective,
                    ...(toolContext?.now ? { now: toolContext.now } : {}),
                    timezone: toolContext?.timezone
                        || session?.metadata?.timezone
                        || session?.metadata?.timeZone
                        || getDefaultWorkloadTimezone(),
                },
            };
        }
        if (toolPolicy.candidateToolIds.includes(DOCUMENT_WORKFLOW_TOOL_ID)
            && hasDocumentWorkflowIntentText(objective)
            && hasGroundedDocumentSources) {
            return {
                tool: DOCUMENT_WORKFLOW_TOOL_ID,
                reason: 'Verified research results are already available, so the document workflow can generate the requested deliverable now.',
                params: documentWorkflowParams,
            };
        }
        if (toolPolicy.executionProfile !== REMOTE_BUILD_EXECUTION_PROFILE
            && toolPolicy.candidateToolIds.includes('web-search')
            && searchQuery) {
            return {
                tool: 'web-search',
                reason: researchQuery
                    ? 'Explicit research request should start with Perplexity-backed web search.'
                    : 'Current-information request should start with Perplexity-backed web search.',
                params: {
                    query: searchQuery,
                    engine: 'perplexity',
                    limit: normalizeResearchSearchResultCount(),
                    region: 'us-en',
                    timeRange: inferResearchTimeRangeFromText(objective),
                    includeSnippets: true,
                    includeUrls: true,
                },
            };
        }

        if (firstUrl
            && toolPolicy.candidateToolIds.includes('web-scrape')
            && /\b(scrape|extract|selector|structured|parse)\b/i.test(objective)) {
            return {
                tool: 'web-scrape',
                reason: 'Explicit scrape request with a direct URL should start with deterministic web scraping.',
                params: inferBlindScrapeParams(objective, firstUrl),
            };
        }

        if (toolPolicy.candidateToolIds.includes(DOCUMENT_WORKFLOW_TOOL_ID)
            && hasDocumentWorkflowIntentText(objective)
            && !searchQuery
            && !(firstUrl && /\b(scrape|extract|selector|structured|parse)\b/i.test(objective))) {
            return {
                tool: DOCUMENT_WORKFLOW_TOOL_ID,
                reason: 'Explicit document or slide deliverable should start with the document workflow.',
                params: documentWorkflowParams,
            };
        }

        if (toolPolicy.candidateToolIds.includes('image-generate') && hasExplicitImageGenerationIntent(objective)) {
            return {
                tool: 'image-generate',
                reason: 'Explicit image-generation request should start by materializing reusable image artifacts.',
                params: {
                    prompt: buildImagePromptFromArtifactRequest(objective),
                },
            };
        }

        if (toolPolicy.candidateToolIds.includes('opencode-run') && hasOpencodeRepoWorkIntent(objective)) {
            const target = inferOpencodeTarget(objective, session);
            const workspacePath = resolvePreferredOpencodeWorkspacePath({
                session,
                toolContext,
                target,
            });

            return {
                tool: 'opencode-run',
                reason: target === 'remote-default'
                    ? 'Repo-level code work on the remote workspace should start with the managed OpenCode runtime.'
                    : 'Repo-level code work should start with the managed OpenCode runtime.',
                params: {
                    prompt: objective,
                    target,
                    ...(workspacePath ? { workspacePath } : {}),
                },
            };
        }

        if (!remoteToolId) {
            return null;
        }

        const sshContext = resolveSshRequestContext(objective, session);
        if (!sshContext.directParams) {
            return null;
        }

        return {
            tool: remoteToolId,
            reason: 'Direct SSH command inferred from the user request.',
            params: sshContext.directParams,
        };
    }

    normalizePlannedStep(step = {}, { objective = '', session = null, executionProfile = DEFAULT_EXECUTION_PROFILE, recentMessages = [], toolContext = {} } = {}) {
        const normalizedStep = {
            tool: canonicalizeRemoteToolId(typeof step?.tool === 'string' ? step.tool.trim() : ''),
            reason: typeof step?.reason === 'string' ? step.reason.trim() : '',
            params: step?.params && typeof step.params === 'object' ? { ...step.params } : {},
        };

        if (normalizedStep.tool === 'agent-workload') {
            normalizedStep.params = normalizeAgentWorkloadPlanParams(step, {
                objective,
                session,
                recentMessages,
                toolContext,
            });
            return normalizedStep;
        }

        if (normalizedStep.tool === 'file-write') {
            normalizedStep.params = normalizeFileWritePlanParams(step, {
                objective,
                recentMessages,
            });
            return normalizedStep;
        }

        if (normalizedStep.tool === USER_CHECKPOINT_TOOL_ID) {
            normalizedStep.params = normalizeUserCheckpointPlanParams(step);
            return normalizedStep;
        }

        if (!isRemoteCommandToolId(normalizedStep.tool)) {
            return normalizedStep;
        }

        const sshContext = resolveSshRequestContext(objective, session);
        const trustedTarget = sshContext.target?.host ? sshContext.target : null;
        const plannedHost = typeof normalizedStep.params.host === 'string'
            ? normalizedStep.params.host.trim()
            : '';
        const shouldPinRemoteTarget = executionProfile === REMOTE_BUILD_EXECUTION_PROFILE && trustedTarget?.host;
        const shouldRepairSuspiciousHost = trustedTarget?.host
            && plannedHost
            && isSuspiciousSshTargetHost(plannedHost);

        if ((shouldPinRemoteTarget || !plannedHost || shouldRepairSuspiciousHost) && trustedTarget?.host) {
            normalizedStep.params.host = trustedTarget.host;
        }
        if ((shouldPinRemoteTarget || !normalizedStep.params.username || shouldRepairSuspiciousHost) && trustedTarget?.username) {
            normalizedStep.params.username = trustedTarget.username;
        }
        if ((shouldPinRemoteTarget || !normalizedStep.params.port || shouldRepairSuspiciousHost) && trustedTarget?.port) {
            normalizedStep.params.port = trustedTarget.port;
        }

        const existingCommand = typeof normalizedStep.params.command === 'string'
            ? normalizedStep.params.command.trim()
            : '';
        if (existingCommand) {
            normalizedStep.params.command = existingCommand;
            return normalizedStep;
        }

        const inferenceSource = [normalizedStep.reason, objective].filter(Boolean).join('\n');
        normalizedStep.params.command = sshContext.directParams?.command
            || inferFallbackSshCommand(inferenceSource, executionProfile)
            || (executionProfile === REMOTE_BUILD_EXECUTION_PROFILE
                ? buildUbuntuMasterRemoteCommand()
                : 'hostname && uptime && (df -h / || true) && (free -m || true)');

        return normalizedStep;
    }

    buildFallbackPlan({ objective = '', session = null, recentMessages = [], toolContext = {}, executionProfile = DEFAULT_EXECUTION_PROFILE, toolPolicy = {}, toolEvents = [] }) {
        if (!toolPolicy?.candidateToolIds?.length) {
            return [];
        }

        const prompt = String(objective || '').trim();
        const firstUrl = extractFirstUrl(prompt);
        const remoteToolId = getPreferredRemoteToolId(toolPolicy);
        const directAction = this.buildDirectAction({
            objective,
            session,
            recentMessages,
            toolPolicy,
            toolContext,
            toolEvents,
        });

        if (directAction) {
            return [directAction];
        }

        if (toolPolicy.candidateToolIds.includes('web-search') && hasExplicitWebResearchIntentText(prompt)) {
            const query = extractExplicitWebResearchQuery(prompt) || prompt;
            return [{
                tool: 'web-search',
                reason: 'Fallback for explicit research intent.',
                params: {
                    query,
                    engine: 'perplexity',
                    limit: normalizeResearchSearchResultCount(),
                    region: 'us-en',
                    timeRange: 'all',
                    includeSnippets: true,
                    includeUrls: true,
                },
            }];
        }

        if (firstUrl && /\b(scrape|extract|selector|structured|parse)\b/i.test(prompt) && toolPolicy.candidateToolIds.includes('web-scrape')) {
            return [{
                tool: 'web-scrape',
                reason: 'Deterministic fallback for explicit scrape intent.',
                params: inferBlindScrapeParams(prompt, firstUrl),
            }];
        }

        if (firstUrl && toolPolicy.candidateToolIds.includes('web-fetch')) {
            return [{
                tool: 'web-fetch',
                reason: 'Deterministic fallback for explicit URL retrieval.',
                params: {
                    url: firstUrl,
                },
            }];
        }

        if (toolPolicy.candidateToolIds.includes('image-from-url') && firstUrl && /\.(png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(firstUrl)) {
            return [{
                tool: 'image-from-url',
                reason: 'Deterministic fallback for explicit image URL usage.',
                params: {
                    url: firstUrl,
                },
            }];
        }

        if (toolPolicy.candidateToolIds.includes('image-search-unsplash') && /\bunsplash\b/i.test(prompt)) {
            const query = inferFallbackUnsplashQuery(prompt);
            if (query) {
                return [{
                    tool: 'image-search-unsplash',
                    reason: 'Deterministic fallback for explicit Unsplash request.',
                    params: {
                        query,
                        perPage: 6,
                    },
                }];
            }
        }

        if (toolPolicy.candidateToolIds.includes('image-generate') && hasExplicitImageGenerationIntent(prompt)) {
            return [{
                tool: 'image-generate',
                reason: 'Deterministic fallback for explicit image-generation intent.',
                params: {
                    prompt: buildImagePromptFromArtifactRequest(prompt),
                },
            }];
        }

        if (toolPolicy.candidateToolIds.includes(DOCUMENT_WORKFLOW_TOOL_ID) && hasDocumentWorkflowIntentText(prompt)) {
            return [{
                tool: DOCUMENT_WORKFLOW_TOOL_ID,
                reason: 'Deterministic fallback for explicit document or slide generation.',
                params: buildDocumentWorkflowGenerateParams({
                    objective: prompt,
                    toolEvents,
                }),
            }];
        }

        if (remoteToolId
            && (executionProfile === REMOTE_BUILD_EXECUTION_PROFILE
                || toolPolicy.hasReachableSshTarget
                || /\b(ssh|server|host|cluster|k3s|k8s|kubernetes|kubectl|deploy|deployment|docker)\b/i.test(prompt))) {
            const sshContext = resolveSshRequestContext(objective, session);
            const command = sshContext.directParams?.command || inferFallbackSshCommand(prompt, executionProfile);

            if (command) {
                return [{
                    tool: remoteToolId,
                    reason: 'Fallback for explicit server or remote-build intent.',
                    params: sshContext.target?.host
                        ? {
                            host: sshContext.target.host,
                            ...(sshContext.target.username ? { username: sshContext.target.username } : {}),
                            ...(sshContext.target.port ? { port: sshContext.target.port } : {}),
                            command,
                        }
                        : {
                            command,
                        },
                }];
            }
        }

        return [];
    }

    async planToolUse({
        objective = '',
        instructions = '',
        contextMessages = [],
        recentMessages = [],
        session = null,
        toolContext = {},
        executionProfile = DEFAULT_EXECUTION_PROFILE,
        toolPolicy = {},
        model = null,
        reasoningEffort = null,
        taskType = 'chat',
        toolEvents = [],
        autonomyApproved = false,
    }) {
        if (!toolPolicy.candidateToolIds.length) {
            return [];
        }

        const remoteToolId = getPreferredRemoteToolId(toolPolicy);
        const toolCatalog = toolPolicy.candidateToolIds
            .map((toolId) => `- ${toolId}: ${toolPolicy.toolDescriptions?.[toolId] || toolId}`)
            .join('\n');
        const planningPrompt = String(objective || '');
        const prompt = [
            'You are planning tool usage for an application-owned agent runtime.',
            'Return JSON only.',
            'If tools are unnecessary, return {"steps":[]}.',
            `Execution profile: ${executionProfile}`,
            `Task type: ${taskType}`,
            'Candidate tools:',
            toolCatalog,
            '',
            'User request:',
            objective || '(empty)',
            '',
            'Runtime instructions:',
            instructions || '(none)',
            '',
            'Supplemental recalled context:',
            Array.isArray(contextMessages) && contextMessages.length > 0 ? contextMessages.join('\n') : '(none)',
            '',
            'Recent transcript:',
            Array.isArray(recentMessages) && recentMessages.length > 0
                ? recentMessages.map((message) => `${message.role}: ${normalizeMessageText(message.content || '')}`).join('\n')
                : '(none)',
            '',
            'Verified tool results from this run so far:',
            toolEvents.length > 0
                ? JSON.stringify(summarizeToolEventsForPlanner(toolEvents), null, 2)
                : '(none)',
            '',
            'Return exactly this shape:',
            '{"steps":[{"tool":"tool-id","reason":"why","params":{}}]}',
            `Use at most ${MAX_PLAN_STEPS} steps.`,
            'Only use tools listed above.',
            'Do not invent SSH hosts, usernames, file paths, or credentials.',
            'Every `remote-command` step must include a non-empty `params.command` string.',
            'Use `opencode-run` for repo or workspace implementation, fix, refactor, build, compile, and test work when the request is about changing code rather than one-off host operations.',
            'Every `opencode-run` step must include a non-empty `params.prompt` string. Include `params.workspacePath` when the runtime or session already identifies the workspace, and use `params.target` set to `remote-default` only for remote repository work.',
            'Keep `remote-command` for kubectl, host inspection, package installs, logs, restarts, deployments, DNS, TLS, and other infrastructure operations.',
            'Every `agent-workload` step must use the deferred workload schema only: `{"tool":"agent-workload","reason":"why","params":{"action":"create_from_scenario","request":"the full original user request","timezone":"IANA/Zone"}}`.',
            'Do not parse the schedule, cron, or remote command yourself for `agent-workload`; pass the full original request and let the runtime canonicalize it.',
            'Do not use `command`, `name`, `schedule`, or remote-command style fields inside `agent-workload` params.',
            'If the user asks for a cron job, recurring schedule, reminder, or future run, prefer `agent-workload` instead of `remote-command` even when an SSH target is already available.',
            'If the user asks for multiple jobs or automations, split them into one `agent-workload` step per distinct task instead of combining everything into one workload.',
            'Every `user-checkpoint` step must include either a non-empty `params.question` with concise choice `params.options`, or a short `params.steps` questionnaire.',
            'Use `user-checkpoint` when one high-impact user decision would materially change the plan, implementation scope, architecture, or final output before major work.',
            'On web-chat, treat `user-checkpoint` as the primary quick way to involve the user when one concise decision or direction check would help.',
            'On web-chat, prefer `user-checkpoint` over asking a blocking multiple-choice question in plain assistant text because it renders as an inline survey card with clickable options.',
            'Keep `user-checkpoint` to one card with one visible step at a time. Prefer 1 question by default, or a short 2 to 4 step questionnaire when the user explicitly wants structured intake.',
            'Supported step types are choice, multi-choice, text, date, time, and datetime. For choice steps, use mutually exclusive, actionable options and leave the free-text field enabled when helpful.',
            'Do not turn `user-checkpoint` into a long questionnaire, a page of questions, or more than 6 steps.',
            'Every `document-workflow` step must include `params.action` set to `recommend`, `plan`, `generate`, or `assemble`.',
            'Use `document-workflow generate` for final briefs, reports, documents, HTML pages, and slide decks.',
            'When the user wants a research-backed deliverable, prefer `web-search` and `web-scrape` first, then `document-workflow` with grounded `sources` derived from the verified tool results.',
            'Set `document-workflow.params.includeContent` to `true` only when a later step needs the full textual body for `file-write`; otherwise prefer the stored document download URL.',
            ...(toolPolicy?.userCheckpointPolicy?.enabled
                ? [
                    `Checkpoint questions remaining in this session: ${Math.max(0, Number(toolPolicy.userCheckpointPolicy.remaining) || 0)}.`,
                    toolPolicy.userCheckpointPolicy.pending
                        ? 'A `user-checkpoint` is already pending. Do not plan another checkpoint until the user answers it.'
                        : 'If a checkpoint would unblock a major decision, you may use `user-checkpoint` instead of stopping with a prose question.',
                ]
                : []),
            'If a multi-job cron request omits exact times, you may pass one derived sub-request per job with conservative defaults in local time, such as daily at 9:00 AM for checks and every Monday at 2:00 AM for updates.',
            'Use `remote-command` for host cron only when the user explicitly asks to inspect or modify the server\'s own crontab.',
            'Every `file-write` step must include both `params.path` and the full file body as `params.content` in the same step.',
            '`file-write` is for local runtime files only. For remote hosts, deployed servers, or container-only paths, use `remote-command` or `docker-exec` instead.',
            'Do not return a `file-write` step that only points at a previous artifact or earlier file. If the full content is not already available in the prompt or recent transcript, choose a different tool or return no `file-write` step.',
            ...(executionProfile === REMOTE_BUILD_EXECUTION_PROFILE && hasRemoteWebsiteUpdateIntent(planningPrompt)
                ? [
                    'For remote website/page/HTML updates on a server or cluster, do not require a local artifact or local file read unless the user explicitly named one.',
                    'When the user asks to replace the page with a new file, you may generate the full replacement HTML yourself and write it remotely with `remote-command`.',
                    'If a local HTML artifact or local file read fails, pivot to the remote file, ConfigMap, or deployed content as the source of truth instead of stopping.',
                    'Do not infer an arbitrary live website path such as `/var/www/...` as the target. Prefer the configured deploy target directory, cluster ConfigMaps, or a path the user explicitly named.',
                    'Never run `git init`, create a new remote host repository, or choose a remote Git origin unless the user explicitly asked for that server-local Git workflow.',
                    'Internal artifact links like `/api/artifacts/...` are backend-local references, not public hosts. Do not turn them into `https://api/...`.',
                    'Do not treat `svc` or `ingress` as deployment names. Inspect deployments, services, ingresses, pods, and ConfigMaps separately.',
                    'When verifying the deployed site, do not rely on the HTML `<title>` alone. Compare body content, mounted file content, response snippets, or content length when titles may be empty.',
                    ...(hasInternalArtifactReference(`${objective || ''}\n${instructions || ''}`)
                        ? [
                            'If the runtime instructions or project memory include an internal artifact link and you need its contents, use local `web-fetch` from this runtime first, then send the fetched content to the remote target with `remote-command`.',
                            'Do not use `remote-command` to `curl` `api`, `localhost:3000`, `127.0.0.1:3000`, or `/api/artifacts/...` from the target server unless a verified tool result proves that endpoint is reachable from the target host.',
                        ]
                        : []),
                ]
                : []),
            ...(autonomyApproved && executionProfile === REMOTE_BUILD_EXECUTION_PROFILE
                ? [
                    'The user has already approved continuing through obvious next remote-build steps.',
                    'Treat the original user request as the active objective; intermediate failures discovered during troubleshooting are part of the same task, not separate tasks that require user approval.',
                    'Do not stop after a single inspection if the next server action is routine and clearly implied by the verified results.',
                    'Do not stop just to report an intermediate issue when you can inspect, test, or apply the next routine fix yourself.',
                    'Keep moving through setup, inspection, verification, and routine fixes without asking for confirmation between each step.',
                    'Prefer the next distinct action that most directly advances the original ask, not the safest-sounding minimal action.',
                    'Keep going until the goal is reached, a real blocker appears, or the autonomous runtime budget is exhausted.',
                    'Stop only when blocked by missing secrets, DNS/domain values, ambiguous product decisions, destructive resets/wipes, repeated tool failures, or an exhausted autonomy budget.',
                    'When verified remote tool results already exist, do not repeat the same command back-to-back without an intervening fix or new reason, and do not return {"steps":[]} unless the task is truly complete or genuinely blocked.',
                    'If the last remote step was only an initial inspection, return the next distinct remote step instead of ending the plan.',
                ]
                : []),
            ...(remoteToolId && toolPolicy.hasReachableSshTarget
                ? [
                    `For ${remoteToolId}, host, username, and port may be omitted when the runtime already has a configured default target or sticky session target.`,
                    `For server work, prefer trying ${remoteToolId} before asking the user for host details again.`,
                    'Assume a Linux server and prefer Ubuntu-friendly commands unless tool results prove otherwise.',
                    'For remote-build work, verify architecture with uname -m before installing binaries and prefer arm64/aarch64 assets when applicable.',
                    'For Kubernetes troubleshooting, if a pod describe or status result shows CrashLoopBackOff, an init container failure, or Exit Code > 0, the next step is usually kubectl logs for the failing container or init container rather than asking the user what to run next.',
                    'Prefer common built-ins and standard utilities. If a nonstandard tool may be missing, use a fallback such as find/grep instead of rg, ss instead of netstat, ip addr instead of ifconfig, and docker compose instead of docker-compose.',
                ]
                : remoteToolId
                    ? [
                        `${remoteToolId} is still available for this request even if the runtime target is not yet verified in this prompt.`,
                        `Do not claim ${remoteToolId} is unavailable; call it when SSH or remote-build work is requested and let the tool return the actual missing-target or credential error if configuration is incomplete.`,
                        'For Kubernetes pod failures, follow describe/status output with kubectl logs for the failing container before handing work back to the user.',
                        'When planning server commands, prefer Ubuntu-friendly standard utilities and avoid assuming rg, ifconfig, netstat, or docker-compose are installed.',
                      ]
                    : []),
        ].join('\n');

        const plannerOutput = await this.completeText(prompt, { model, reasoningEffort });
        const parsed = safeJsonParse(plannerOutput);
        const requestedSteps = (Array.isArray(parsed?.steps) ? parsed.steps : [])
            .slice(0, MAX_PLAN_STEPS)
            .map((step) => this.normalizePlannedStep(step, {
                objective,
                session,
                executionProfile,
                recentMessages,
                toolContext,
            }))
            .filter((step) => step.tool && toolPolicy.candidateToolIds.includes(step.tool));

        if (requestedSteps.length > 0) {
            return requestedSteps;
        }

        return this.buildFallbackPlan({
            objective,
            session,
            recentMessages,
            toolContext,
            executionProfile,
            toolPolicy,
            toolEvents,
        }).slice(0, MAX_PLAN_STEPS);
    }

    async executePlan({
        plan = [],
        toolManager = null,
        sessionId = 'default',
        executionProfile = DEFAULT_EXECUTION_PROFILE,
        toolContext = {},
        objective = '',
        session = null,
        recentMessages = [],
        autonomyDeadline = null,
        executionTrace = [],
        round = null,
    }) {
        const toolEvents = [];
        let budgetExceeded = false;
        if (!toolManager) {
            return {
                toolEvents,
                budgetExceeded,
            };
        }

        for (let index = 0; index < plan.length; index += 1) {
            if (Number.isFinite(autonomyDeadline) && Date.now() >= autonomyDeadline) {
                budgetExceeded = true;
                break;
            }

            const step = this.normalizePlannedStep(plan[index], {
                objective,
                session,
                executionProfile,
                recentMessages,
                toolContext,
            });
            const toolCall = {
                id: `tool_call_${index + 1}`,
                type: 'function',
                function: {
                    name: step.tool,
                    arguments: JSON.stringify(step.params || {}),
                },
            };
            const toolStartedAt = new Date().toISOString();

            try {
                const effectiveRecentMessages = Array.isArray(toolContext?.recentMessages)
                    ? toolContext.recentMessages
                    : recentMessages;
                const result = await toolManager.executeTool(step.tool, step.params || {}, {
                    sessionId,
                    executionProfile,
                    toolManager,
                    tools: {
                        get: (toolId) => toolManager.getTool(toolId),
                    },
                    timestamp: new Date().toISOString(),
                    ...toolContext,
                    recentMessages: effectiveRecentMessages,
                });
                const toolEndedAt = new Date().toISOString();
                const normalizedResult = normalizeToolResult(result, step.tool, {
                    startedAt: toolStartedAt,
                    endedAt: toolEndedAt,
                });

                toolEvents.push({
                    toolCall,
                    result: normalizedResult,
                    reason: step.reason,
                });
                executionTrace.push(createExecutionTraceEntry({
                    type: 'tool_call',
                    name: `Tool call (${step.tool})`,
                    startedAt: normalizedResult.startedAt,
                    endedAt: normalizedResult.endedAt,
                    status: normalizedResult.success ? 'completed' : 'error',
                    details: {
                        round,
                        reason: step.reason,
                        paramKeys: Object.keys(step.params || {}).sort(),
                        error: normalizedResult.error || null,
                    },
                }));
                budgetExceeded = budgetExceeded || (Number.isFinite(autonomyDeadline) && Date.now() >= autonomyDeadline);

                if (result?.success === false || budgetExceeded) {
                    break;
                }
            } catch (error) {
                const toolEndedAt = new Date().toISOString();
                const normalizedResult = normalizeToolResult({
                    success: false,
                    toolId: step.tool,
                    error: error.message,
                    startedAt: toolStartedAt,
                    endedAt: toolEndedAt,
                }, step.tool);
                toolEvents.push({
                    toolCall,
                    result: normalizedResult,
                    reason: step.reason,
                });
                executionTrace.push(createExecutionTraceEntry({
                    type: 'tool_call',
                    name: `Tool call (${step.tool})`,
                    startedAt: normalizedResult.startedAt,
                    endedAt: normalizedResult.endedAt,
                    status: 'error',
                    details: {
                        round,
                        reason: step.reason,
                        paramKeys: Object.keys(step.params || {}).sort(),
                        error: normalizedResult.error || null,
                    },
                }));
                budgetExceeded = budgetExceeded || (Number.isFinite(autonomyDeadline) && Date.now() >= autonomyDeadline);
                break;
            }
        }

        return {
            toolEvents,
            budgetExceeded,
        };
    }

    async repairInvalidFinalResponse({
        invalidOutput = '',
        objective = '',
        instructions = '',
        contextMessages = [],
        recentMessages = [],
        model = null,
        reasoningEffort = null,
        taskType = 'chat',
        executionProfile = DEFAULT_EXECUTION_PROFILE,
        toolPolicy = {},
        toolEvents = [],
        runtimeMode = 'plain',
        autonomyApproved = false,
        executionTrace = [],
    }) {
        const runtimeInstructions = this.buildRuntimeInstructions({
            baseInstructions: instructions,
            executionProfile,
            allowedToolIds: toolPolicy.allowedToolIds,
            toolEvents,
            toolPolicy,
        });

        const repairPrompt = [
            'The previous draft was invalid because it claimed runtime tools were unavailable after verified tool execution.',
            'Rewrite the answer using only the verified tool results below.',
            'Do not mention turn-level tool availability, missing tools, sandbox limits, or inability to execute commands.',
            'If additional work may still be needed, explain what remains based on the verified results and the user request without claiming the tool is unavailable.',
            'If a tool failed, state the exact tool failure plainly.',
            'When the request is research-heavy, synthesize across the verified sources and keep concrete facts, comparisons, and caveats instead of collapsing everything into a shallow summary.',
            `Task type: ${taskType}`,
            ...(taskType === NOTES_EXECUTION_PROFILE
                ? [
                    'This is a notes-surface request.',
                    'If the user is editing the page, return `notes-actions` or page-ready notes content, not raw standalone HTML or workspace/file instructions.',
                    'Do not mention local workspace writes, `/app`, or shell failures in the repaired answer.',
                ]
                : []),
            '',
            'User request:',
            objective || '(empty)',
            '',
            'Previous invalid draft:',
            invalidOutput || '(empty)',
            '',
            ...(extractVerifiedImageEmbeds(toolEvents).length > 0
                ? [
                    'Verified embeddable images:',
                    ...extractVerifiedImageEmbeds(toolEvents),
                    '',
                    'Reuse those image embeds directly when they satisfy the request.',
                    '',
                ]
                : []),
            ...(buildResearchDossierFromToolEvents({ objective, toolEvents })
                ? [
                    'Research dossier:',
                    buildResearchDossierFromToolEvents({ objective, toolEvents }),
                    '',
                ]
                : []),
            'Verified tool results:',
            buildVerifiedToolFindingsText(toolEvents) || '(none)',
        ].join('\n');

        const response = recoverEmptyModelResponse(await this.requestResponse({
            input: repairPrompt,
            instructions: runtimeInstructions,
            contextMessages,
            recentMessages,
            stream: false,
            model,
            reasoningEffort,
            enableAutomaticToolCalls: false,
        }), {
            objective,
            toolEvents,
            executionProfile,
            runtimeMode,
            phase: 'repair',
        });

        return this.withResponseMetadata(response, {
            executionProfile,
            runtimeMode,
            toolEvents,
            toolPolicy,
            autonomyApproved,
            executionTrace,
        });
    }

    async buildFinalResponse({
        input,
        objective = '',
        instructions = '',
        contextMessages = [],
        recentMessages = [],
        model = null,
        reasoningEffort = null,
        taskType = 'chat',
        executionProfile = DEFAULT_EXECUTION_PROFILE,
        toolPolicy = {},
        toolEvents = [],
        runtimeMode = 'plain',
        autonomyApproved = false,
        executionTrace = [],
    }) {
        const runtimeInstructions = this.buildRuntimeInstructions({
            baseInstructions: instructions,
            executionProfile,
            allowedToolIds: toolPolicy.allowedToolIds,
            toolEvents,
            toolPolicy,
        });

        if (toolEvents.length === 0) {
            const response = recoverEmptyModelResponse(await this.requestResponse({
                input,
                instructions: runtimeInstructions,
                contextMessages,
                recentMessages,
                stream: false,
                model,
                reasoningEffort,
                enableAutomaticToolCalls: false,
            }), {
                objective,
                toolEvents,
                executionProfile,
                runtimeMode,
                phase: 'direct-response',
            });

            return this.withResponseMetadata(response, {
                executionProfile,
                runtimeMode,
                toolEvents: [],
                toolPolicy,
                autonomyApproved,
                executionTrace,
            });
        }

        const verifiedToolFindings = buildVerifiedToolFindingsText(toolEvents) || '(none)';
        const synthesisPrompt = [
            'Use the verified tool results below to answer the user.',
            'If a tool failed, state the exact failure plainly.',
            'Return plain user-facing text only.',
            'Do not return JSON, assistant wrapper objects, tool call objects, or fields like `role`, `content`, `type`, `name`, `parameters`, `output_text`, or `finish_reason`.',
            'Do not wrap the final answer in code fences.',
            'Do not generate SVG placeholders, HTML overlays, or fake image mockups when verified image URLs are available.',
            'If the request is research-heavy, synthesize across the verified sources with concrete detail, cross-source comparison, and caveats instead of flattening the findings into one thin paragraph.',
            ...(taskType === NOTES_EXECUTION_PROFILE
                ? [
                    'This is a notes-surface request.',
                    'If the user is editing the page, return `notes-actions` or page-ready notes content, not raw standalone HTML or workspace/file instructions.',
                    'Do not mention local workspace writes, `/app`, shell startup problems, or generic sandbox limitations unless a verified tool result is directly about that.',
                ]
                : []),
            ...(autonomyApproved && executionProfile === REMOTE_BUILD_EXECUTION_PROFILE
                ? [
                    'The user has already approved continuing through obvious remote-build steps.',
                    'Summarize the work completed in this run and only ask for input if you hit a real blocker or need an external decision.',
                    'Do not turn routine next troubleshooting steps into homework for the user when the runtime could have executed them in this run.',
                ]
                : []),
            `Task type: ${taskType}`,
            '',
            'User request:',
            objective || '(empty)',
            '',
            ...(extractVerifiedImageEmbeds(toolEvents).length > 0
                ? [
                    'Verified embeddable images:',
                    ...extractVerifiedImageEmbeds(toolEvents),
                    '',
                    'Reuse those image embeds directly when they satisfy the request.',
                    '',
                ]
                : []),
            ...(buildResearchDossierFromToolEvents({ objective, toolEvents })
                ? [
                    'Research dossier:',
                    buildResearchDossierFromToolEvents({ objective, toolEvents }),
                    '',
                ]
                : []),
            'Verified tool results:',
            verifiedToolFindings,
        ].join('\n');

        console.log(`[ConversationOrchestrator] Tool synthesis request: toolEvents=${toolEvents.length}, autonomyApproved=${autonomyApproved}, findingsChars=${verifiedToolFindings.length}, contextMessages=${contextMessages.length}, recentMessages=${recentMessages.length}`);

        let response = await this.requestResponse({
            input: synthesisPrompt,
            instructions: runtimeInstructions,
            contextMessages,
            recentMessages,
            stream: false,
            model,
            reasoningEffort,
            enableAutomaticToolCalls: false,
        });

        if (!extractResponseText(response).trim()) {
            console.warn(`[ConversationOrchestrator] Tool synthesis returned empty output; retrying with compact prompt. toolEvents=${toolEvents.length}, autonomyApproved=${autonomyApproved}`);
            response = await this.requestResponse({
                input: buildCompactToolSynthesisPrompt({
                    objective,
                    taskType,
                    toolEvents,
                }),
                instructions: 'Return plain user-facing text only.',
                contextMessages: [],
                recentMessages: [],
                stream: false,
                model,
                reasoningEffort,
                enableAutomaticToolCalls: false,
            });
        }

        response = recoverEmptyModelResponse(response, {
            objective,
            toolEvents,
            executionProfile,
            runtimeMode,
            phase: 'tool-synthesis',
        });

        return this.withResponseMetadata(response, {
            executionProfile,
            runtimeMode,
            toolEvents,
            toolPolicy,
            autonomyApproved,
            executionTrace,
        });
    }

    buildRuntimeInstructions({ baseInstructions = '', executionProfile = DEFAULT_EXECUTION_PROFILE, allowedToolIds = [], toolEvents = [], toolPolicy = {} }) {
        const remoteToolId = getPreferredRemoteToolId(toolPolicy);
        const userCheckpointPolicy = toolPolicy?.userCheckpointPolicy || {};
        const canUseUserCheckpoint = allowedToolIds.includes(USER_CHECKPOINT_TOOL_ID)
            && userCheckpointPolicy.enabled === true
            && Number(userCheckpointPolicy.remaining || 0) > 0
            && !userCheckpointPolicy.pending;
        const parts = [
            String(baseInstructions || '').trim(),
            `Execution profile: ${executionProfile}.`,
        ];

        if (executionProfile === NOTES_EXECUTION_PROFILE) {
            parts.push(buildNotesSynthesisInstructions());
        }

        if (allowedToolIds.length > 0) {
            parts.push(`Runtime-available tools for this request: ${allowedToolIds.join(', ')}.`);
            parts.push('Do not claim tools are unavailable if they are listed as runtime-available tools.');
        }

        if (canUseUserCheckpoint) {
            parts.push('Use `user-checkpoint` when one high-impact decision would materially change the plan before major implementation, refactoring, or other long multi-step work.');
            parts.push('On web-chat, treat `user-checkpoint` as the primary quick way to involve the user when one concise choice or direction check would help.');
            parts.push('On web-chat, `user-checkpoint` renders as an inline popup-style survey card with clickable choices, so prefer it over a plain-text multiple-choice question.');
            parts.push('Keep checkpoint surveys concise: one card with one visible step at a time. Prefer 1 question by default, or a short 2 to 4 step questionnaire when the user explicitly wants structured intake.');
            parts.push('Supported step types are choice, multi-choice, text, date, time, and datetime. For choice steps, use 2 to 4 strong options and leave the free-text field available when helpful.');
            parts.push('Do not turn checkpoints into long questionnaires, pages of questions, or more than 6 steps.');
        } else if (userCheckpointPolicy.enabled === true && userCheckpointPolicy.pending) {
            parts.push('A `user-checkpoint` is already pending for this session. Do not ask another survey question until the user answers it.');
        }

        if (allowedToolIds.includes('architecture-design')) {
            parts.push('Use `architecture-design` when the user asks for architecture recommendations, system design, or deployment/component overviews.');
        }

        if (allowedToolIds.includes('uml-generate')) {
            parts.push('Use `uml-generate` for class, sequence, activity, component, or state diagrams instead of hand-writing ad hoc diagram syntax.');
        }

        if (allowedToolIds.includes('api-design')) {
            parts.push('Use `api-design` for REST, OpenAPI, GraphQL, or gRPC contract design work.');
        }

        if (allowedToolIds.includes('schema-generate')) {
            parts.push('Use `schema-generate` for DDL, ORM schema generation, or ER-style database design output.');
        }

        if (allowedToolIds.includes('migration-create')) {
            parts.push('Use `migration-create` when the user asks for schema diffs or migration up/down scripts.');
        }

        if (allowedToolIds.includes('security-scan')) {
            parts.push('Use `security-scan` for code audits, secret detection, and vulnerability checks when code is available in the request.');
        }

        if (allowedToolIds.includes('git-safe')) {
            parts.push('Use `git-safe` for restricted local repository save flows: status, add, commit, push, and save-and-push.');
            parts.push('Use `git-safe remote-info` when you need to verify the current branch, HEAD revision, upstream tracking, or configured remotes before pushing.');
            parts.push('Treat the local workspace repository as the source of truth for authoring and GitHub pushes unless the user explicitly says the canonical repo lives on the server.');
            parts.push('Do not claim generic local shell or sandbox limits for Git work when `git-safe` is available. Continue through the constrained Git tool path instead.');
        }

        if (allowedToolIds.includes('opencode-run')) {
            parts.push('Use `opencode-run` for long-form repository work: implementing changes, fixing bugs, refactoring, building, compiling, and testing in a codebase or workspace.');
            parts.push('Point `opencode-run` at the local workspace by default, or use `target: "remote-default"` when the request is clearly about the remote repository workspace.');
            parts.push('Keep `remote-command` for infrastructure work such as kubectl, logs, restarts, service inspection, package installs, and deployment operations.');
        }

        if (allowedToolIds.includes('web-scrape')) {
            parts.push('Use `web-scrape` for structured extraction from URLs. Prefer `browser: true` for JS-heavy pages or certificate/TLS problems.');
            parts.push('When browser rendering is enabled, `web-scrape` can execute `actions` such as click, fill, type, press, wait_for_selector, wait_for_timeout, hover, scroll, and select_option before extracting the final page state.');
            parts.push('Use `captureScreenshot: true` in browser mode when a visual snapshot of the rendered page would help later review or UI verification.');
            parts.push('When the user wants page images from sensitive or adult sites without exposing the model to the content, use `web-scrape` with `captureImages: true` and `blindImageCapture: true` so the backend stores opaque binary artifacts and only returns safe metadata.');
        }

        if (allowedToolIds.includes(DOCUMENT_WORKFLOW_TOOL_ID)) {
            parts.push('Use `document-workflow` to recommend, plan, and generate reports, briefs, HTML documents, and slide decks.');
            parts.push('For research-backed deliverables, gather verified facts with `web-search` and `web-scrape` first, then call `document-workflow generate` with grounded `sources` built from those verified results.');
            parts.push('Use `document-workflow assemble` when the goal is to compile source material into a straightforward document without heavy rewriting.');
            parts.push('Set `document-workflow includeContent: true` only when a later `file-write` step needs the full HTML or markdown body.');
        }

        if (toolEvents.length > 0) {
            parts.push('Use the verified tool results as the source of truth over guesses.');
            parts.push('When a verified tool result includes image URLs or markdown image snippets, you may embed them with standard markdown image syntax.');
            parts.push('Do not fabricate SVG overlays, inline HTML image placeholders, or other visual stand-ins when verified image URLs are available.');
        }

        if (remoteToolId && toolPolicy.hasReachableSshTarget) {
            parts.push(`SSH runtime target is already available${toolPolicy.sshRuntimeTarget ? ` (${toolPolicy.sshRuntimeTarget})` : ''}.`);
            parts.push(`For server work, try ${remoteToolId} against the configured default or sticky session target before asking for host details again.`);
            parts.push('Only ask for SSH connection details after an actual tool failure shows the target is missing or incorrect.');
            parts.push(`When calling ${remoteToolId}, always include a concrete command string. Omitting host/username/port is allowed when the runtime target is already configured, but omitting command is never allowed.`);
            parts.push('Prefer Ubuntu/Linux standard commands and verify architecture with `uname -m` before installing binaries or choosing downloads.');
            parts.push('For Kubernetes pod failures, follow describe/status output with `kubectl logs` for the failing container or init container instead of asking the user to run that next step.');
            parts.push('For remote website or HTML updates, prefer the remote file, ConfigMap, or deployed content as the source of truth unless the user explicitly provided a local artifact or path.');
            parts.push('If the user asks for a fresh replacement page, generate the full HTML and write it remotely instead of blocking on a missing local artifact.');
            parts.push('Use fallbacks when common extras are missing: `find`/`grep -R` for `rg`, `ss -tulpn` for `netstat`, `ip addr` for `ifconfig`, and `docker compose` for `docker-compose`.');
        } else if (remoteToolId) {
            parts.push(`${remoteToolId} is available for this request even if the target is not currently verified in the prompt context.`);
            parts.push(`Do not claim the SSH tool is unavailable. Try ${remoteToolId} for explicit SSH or remote-build work and report the concrete tool error if the runtime lacks a configured target.`);
            parts.push(`When calling ${remoteToolId}, always include a concrete command string.`);
            parts.push('When constructing remote commands, assume Ubuntu/Linux defaults first and avoid depending on nonstandard utilities unless you have verified they exist.');
        }

        if (allowedToolIds.includes('k3s-deploy')) {
            parts.push('Use `k3s-deploy` for standard remote deployment flows over SSH: sync a GitHub repo on the server, apply manifests, set deployment images, and check rollout status.');
            parts.push('Do not treat a missing project checkout on the remote host as a blocker for deployment work. `sync-repo` or `sync-and-apply` can clone the configured GitHub repo into the target directory.');
            parts.push('Keep raw SSH available for one-off server configuration and troubleshooting, but use `git-safe` plus `k3s-deploy` when the user wants code pushed to GitHub and then deployed.');
            parts.push('Prefer immutable delivery: local authoring and Git push, then CI or GitHub Actions, then k3s rollout. Avoid treating the live server as the place where software is created unless the user explicitly asks for that workflow.');
            parts.push('Never initialize a new Git repository on the remote host or adopt an arbitrary web root as the canonical project unless the user explicitly asked for that server-local workflow.');
        }

        return parts.filter(Boolean).join('\n\n');
    }

    withResponseMetadata(response = {}, metadata = {}) {
        const existing = response?.metadata && typeof response.metadata === 'object'
            ? response.metadata
            : {};

        return {
            ...response,
            metadata: {
                ...existing,
                ...metadata,
            },
        };
    }

    async completeConversationRun({
        sessionId,
        ownerId = null,
        userText = '',
        objective = '',
        taskType = 'chat',
        executionProfile = DEFAULT_EXECUTION_PROFILE,
        runtimeMode = 'plain',
        toolPolicy = {},
        toolEvents = [],
        output = '',
        finalResponse = {},
        startedAt = Date.now(),
        metadata = {},
        clientSurface = '',
        memoryKeywords = [],
        memoryTrace = null,
        autonomyApproved = false,
        executionTrace = [],
        stream = false,
        controlStatePatch = {},
    } = {}) {
        const tracedResponse = memoryTrace && config.memory.debugTrace
            ? this.withResponseMetadata(finalResponse, {
                memoryTrace,
                runtimeDiagnostics: this.memoryService?.getDiagnostics?.() || null,
            })
            : finalResponse;
        await this.persistConversationState({
            sessionId,
            ownerId,
            userText: userText || objective,
            objective,
            assistantText: output,
            responseId: tracedResponse.id,
            toolEvents,
            executionProfile,
            clientSurface,
            memoryKeywords,
            autonomyApproved,
            controlStatePatch,
        });

        const trace = {
            sessionId,
            taskType,
            executionProfile,
            runtimeMode,
            toolCount: toolEvents.length,
            tools: toolPolicy.candidateToolIds,
            duration: Date.now() - startedAt,
            timestamp: new Date().toISOString(),
            autonomyApproved,
            executionTrace,
            ...(memoryTrace && config.memory.debugTrace
                ? {
                    memoryTrace,
                    runtimeDiagnostics: this.memoryService?.getDiagnostics?.() || null,
                }
                : {}),
        };

        this.emit('task:complete', {
            task: { type: taskType, objective },
            sessionId,
            timestamp: Date.now(),
            result: {
                success: true,
                output,
                responseId: tracedResponse.id,
                trace,
                duration: trace.duration,
            },
        });

        if (stream) {
            return {
                success: true,
                sessionId,
                response: createSyntheticStream(tracedResponse),
                output,
                trace,
            };
        }

        return {
            success: true,
            sessionId,
            output,
            response: tracedResponse,
            trace,
        };
    }

    async persistConversationState({
        sessionId,
        ownerId = null,
        memoryScope = null,
        userText,
        objective = '',
        assistantText,
        responseId,
        toolEvents = [],
        executionProfile = DEFAULT_EXECUTION_PROFILE,
        clientSurface = '',
        memoryKeywords = [],
        autonomyApproved = false,
        controlStatePatch = {},
    }) {
        const currentSession = ownerId && this.sessionStore?.getOwned
            ? await this.sessionStore.getOwned(sessionId, ownerId)
            : this.sessionStore?.get
                ? await this.sessionStore.get(sessionId)
                : null;
        const resolvedMemoryScope = resolveSessionScope({
            mode: currentSession?.metadata?.taskType || currentSession?.metadata?.mode || '',
            taskType: currentSession?.metadata?.taskType || '',
            clientSurface: currentSession?.metadata?.clientSurface || currentSession?.metadata?.client_surface || '',
            memoryScope,
        }, currentSession || null);

        if (this.sessionStore?.recordResponse) {
            await this.sessionStore.recordResponse(sessionId, responseId);
        }

        if (this.memoryService?.rememberResponse) {
            this.memoryService.rememberResponse(sessionId, assistantText, {
                ...(ownerId ? { ownerId } : {}),
                ...(resolvedMemoryScope ? { memoryScope: resolvedMemoryScope } : {}),
                ...(clientSurface ? { sourceSurface: clientSurface } : {}),
                ...(Array.isArray(memoryKeywords) && memoryKeywords.length > 0 ? { memoryKeywords } : {}),
            });
        }

        if (this.memoryService?.rememberResearchNote) {
            const researchNotes = buildResearchMemoryNotesFromToolEvents({
                objective: userText,
                toolEvents,
            });
            await Promise.all(researchNotes.map((note) => this.memoryService.rememberResearchNote(
                sessionId,
                note,
                {
                    ...(ownerId ? { ownerId } : {}),
                    ...(resolvedMemoryScope ? { memoryScope: resolvedMemoryScope } : {}),
                    ...(clientSurface ? { sourceSurface: clientSurface } : {}),
                    ...(Array.isArray(memoryKeywords) && memoryKeywords.length > 0 ? { memoryKeywords } : {}),
                },
            )));
        }

        if (this.memoryService?.rememberLearnedSkill) {
            await this.memoryService.rememberLearnedSkill(sessionId, {
                objective,
                assistantText,
                toolEvents,
                metadata: {
                    ...(ownerId ? { ownerId } : {}),
                    ...(resolvedMemoryScope ? { memoryScope: resolvedMemoryScope } : {}),
                    ...(clientSurface ? { sourceSurface: clientSurface } : {}),
                    ...(Array.isArray(memoryKeywords) && memoryKeywords.length > 0 ? { memoryKeywords } : {}),
                },
            });
        }

        if (this.sessionStore?.appendMessages) {
            await this.sessionStore.appendMessages(sessionId, [
                { role: 'user', content: userText },
                { role: 'assistant', content: assistantText },
            ]);
        }

        const sshMetadata = extractSshSessionMetadataFromToolEvents(toolEvents);
        const nextControlState = mergeControlState(
            controlStatePatch,
            {
                ...(sshMetadata || {}),
                ...(executionProfile === REMOTE_BUILD_EXECUTION_PROFILE
                    && objective
                    && !isRemoteApprovalOnlyTurn(userText)
                    ? { lastRemoteObjective: objective }
                    : {}),
                ...(executionProfile === REMOTE_BUILD_EXECUTION_PROFILE
                    ? { autonomyApproved }
                    : {}),
            },
        );
        const legacyControlMetadata = buildLegacyControlMetadata(nextControlState);

        if (this.sessionStore?.updateControlState && Object.keys(nextControlState).length > 0) {
            await this.sessionStore.updateControlState(sessionId, nextControlState);
        }

        if (this.sessionStore?.update) {
            const projectMemory = mergeProjectMemory(
                currentSession?.metadata?.projectMemory || {},
                buildProjectMemoryUpdate({
                    userText,
                    assistantText,
                    toolEvents,
                }),
            );

            await this.sessionStore.update(sessionId, {
                metadata: {
                    ...legacyControlMetadata,
                    ...(executionProfile === REMOTE_BUILD_EXECUTION_PROFILE
                        ? { remoteBuildAutonomyApproved: autonomyApproved }
                        : {}),
                    projectMemory,
                },
            });
        }
    }

    async completeText(prompt, options = {}) {
        if (typeof this.llmClient?.complete === 'function') {
            return this.llmClient.complete(prompt, options);
        }

        const response = await this.requestResponse({
            input: prompt,
            stream: false,
            model: options.model || null,
            reasoningEffort: options.reasoningEffort || null,
            enableAutomaticToolCalls: false,
        });

        return extractResponseText(response);
    }

    async requestResponse(params = {}) {
        if (typeof this.llmClient?.createResponse === 'function') {
            return this.llmClient.createResponse(params);
        }

        console.warn('[ConversationOrchestrator] llmClient.createResponse is unavailable; falling back to openai-client.createResponse');
        return createResponse(params);
    }
}

module.exports = {
    ConversationOrchestrator,
    normalizeExecutionProfile,
    DEFAULT_EXECUTION_PROFILE,
    REMOTE_BUILD_EXECUTION_PROFILE,
};
