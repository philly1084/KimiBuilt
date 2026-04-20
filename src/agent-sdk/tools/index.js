/**
 * Agent SDK Tools - Main Entry Point
 * Loads and registers all tool categories
 */

const { getUnifiedRegistry } = require('../registry/UnifiedRegistry');
const { getAgentBus } = require('../agents/AgentBus');
const { readToolDoc, getToolDocMetadata } = require('../tool-docs');
const { generateImage } = require('../../openai-client');
const { searchImages, isConfigured: isUnsplashConfigured } = require('../../unsplash-client');
const { persistGeneratedImages } = require('../../generated-image-artifacts');
const { persistGeneratedAudio } = require('../../generated-audio-artifacts');
const { artifactService } = require('../../artifacts/artifact-service');
const { assetManager } = require('../../asset-manager');
const { piperTtsService } = require('../../tts/piper-tts-service');
const { audioProcessingService } = require('../../audio/audio-processing-service');
const { podcastService } = require('../../podcast/podcast-service');
const { config } = require('../../config');
const { isDashboardRequest } = require('../../dashboard-template-catalog');
const { escapeHtml, normalizeWhitespace, stripHtml } = require('../../utils/text');
const { mergeMemoryKeywords, normalizeMemoryKeywords } = require('../../memory/memory-keywords');
const {
  AGENT_NOTES_CHAR_LIMIT,
  writeAgentNotesFile,
} = require('../../agent-notes');
const {
  hasSchedulingCue,
  summarizeTrigger,
} = require('../../workloads/natural-language');
const {
  buildCanonicalWorkloadPayload,
  extractWorkloadScenarioSource,
} = require('../../workloads/request-builder');
const {
  USER_CHECKPOINT_TOOL_ID,
  normalizeCheckpointRequest,
  buildUserCheckpointMessage,
} = require('../../user-checkpoints');
const { getHostnameFromUrl, normalizeDomainList } = require('./categories/web/research-site-policy');

const MAX_VERIFIED_REFERENCE_IMAGES = 20;
const IMAGE_REFERENCE_VERIFY_TIMEOUT_MS = 15000;
const DOCUMENT_WORKFLOW_TOOL_ID = 'document-workflow';
const DEEP_RESEARCH_PRESENTATION_TOOL_ID = 'deep-research-presentation';
const MAX_DOCUMENT_SOURCES = 8;
const MAX_DOCUMENT_SOURCE_CHARS = 4000;
const DEFAULT_DEEP_RESEARCH_PASSES = 3;
const MAX_DEEP_RESEARCH_PASSES = 6;
const MAX_DEEP_RESEARCH_SEARCH_LIMIT = Math.max(
  8,
  Number(config.search?.maxLimit || MAX_VERIFIED_REFERENCE_IMAGES),
);
const DEFAULT_DEEP_RESEARCH_SEARCH_LIMIT = Math.min(
  MAX_DEEP_RESEARCH_SEARCH_LIMIT,
  Math.max(1, Number(config.memory?.researchSearchLimit || 16)),
);
const DEFAULT_DEEP_RESEARCH_PAGES_PER_PASS = Math.min(
  8,
  Math.max(1, Number(config.memory?.researchFollowupPages || 6)),
);
const MAX_DEEP_RESEARCH_PAGES_PER_PASS = 8;
const DEFAULT_DEEP_RESEARCH_IMAGE_LIMIT = 4;
const MAX_DEEP_RESEARCH_IMAGE_LIMIT = 6;
const DEFAULT_IMAGE_SETTLE_DELAY_MS = 1500;
const DEFAULT_DEEP_RESEARCH_RECALL_TOP_K = 4;
const MAX_DEEP_RESEARCH_QUERY_KEYWORDS = 5;

// Tool categories
const { registerWebTools } = require('./categories/web');
const { registerDesignTools } = require('./categories/design');
const { registerDatabaseTools } = require('./categories/database');
const { registerSandboxTools } = require('./categories/sandbox');
// SSH tools
const { SSHExecuteTool } = require('./categories/ssh/SSHExecuteTool');
const { DockerExecTool } = require('./categories/ssh/DockerExecTool');
const { K3sDeployTool } = require('./categories/ssh/K3sDeployTool');
const { GitLocalTool } = require('./categories/system/GitLocalTool');

function normalizeCandidateUrl(value = '') {
  let candidate = String(value || '').trim();
  if (!candidate) {
    throw new Error('Image URL is required.');
  }

  const markdownMatch = candidate.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)|\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i);
  if (markdownMatch) {
    candidate = markdownMatch[1] || markdownMatch[2] || candidate;
  }

  const bracketMatch = candidate.match(/<(https?:\/\/[^>\s]+)>/i);
  if (bracketMatch?.[1]) {
    candidate = bracketMatch[1];
  }

  const plainUrlMatch = candidate.match(/https?:\/\/\S+/i);
  if (plainUrlMatch?.[0]) {
    candidate = plainUrlMatch[0];
  }

  while (/[),.;!?'"`\]]$/.test(candidate)) {
    const next = candidate.slice(0, -1);
    if (!next) break;
    candidate = next;
  }

  return candidate;
}

function deriveImageAltText(urlString = '', fallback = 'image') {
  try {
    const parsed = new URL(urlString);
    const fileName = parsed.pathname.split('/').pop() || '';
    const normalized = fileName
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[-_]+/g, ' ')
      .trim();

    return normalized || fallback;
  } catch (_error) {
    return fallback;
  }
}

function hasLikelyImageExtension(urlString = '') {
  return /\.(png|jpe?g|gif|webp|svg|avif)(?:[?#].*)?$/i.test(String(urlString || '').trim());
}

function isImageMimeType(mimeType = '') {
  return String(mimeType || '').trim().toLowerCase().startsWith('image/');
}

function readImageMimeType(response) {
  return String(response?.headers?.get?.('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

async function cancelResponseBody(response) {
  try {
    if (typeof response?.body?.cancel === 'function') {
      await response.body.cancel();
    }
  } catch (_error) {
    // Ignore best-effort cleanup failures.
  }
}

async function verifyDirectImageUrl(urlString = '', timeoutMs = IMAGE_REFERENCE_VERIFY_TIMEOUT_MS) {
  if (typeof fetch !== 'function') {
    throw new Error('Image URL verification requires fetch support in the runtime.');
  }

  const headers = {
    'User-Agent': 'KimiBuilt-Agent/1.0',
    Accept: 'image/*,*/*;q=0.8',
  };
  const attempts = [
    { method: 'HEAD', headers },
    {
      method: 'GET',
      headers: {
        ...headers,
        Range: 'bytes=0-0',
      },
    },
  ];

  let lastError = null;

  for (const attempt of attempts) {
    let response;

    try {
      response = await fetch(urlString, {
        method: attempt.method,
        headers: attempt.headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const finalUrl = response.url || urlString;
      const mimeType = readImageMimeType(response);
      const verified = isImageMimeType(mimeType) || (!mimeType && hasLikelyImageExtension(finalUrl));
      await cancelResponseBody(response);

      if (!verified) {
        throw new Error(
          `URL did not resolve to a verified image file (content-type: ${mimeType || 'unknown'})`,
        );
      }

      return {
        url: finalUrl,
        mimeType: mimeType || null,
        verificationMethod: attempt.method,
      };
    } catch (error) {
      await cancelResponseBody(response);
      lastError = error;
    }
  }

  throw lastError || new Error('Failed to verify image URL.');
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

function normalizeFileWriteParams(params = {}) {
  const normalized = params && typeof params === 'object'
    ? { ...params }
    : {};
  const pathCandidates = [
    normalized.path,
    normalized.filePath,
    normalized.filepath,
    normalized.filename,
    normalized.targetPath,
    normalized.destination,
  ];
  const resolvedPath = pathCandidates.find((value) => typeof value === 'string' && value.trim());
  if (resolvedPath) {
    normalized.path = resolvedPath.trim();
  }

  if (!Object.prototype.hasOwnProperty.call(normalized, 'content')) {
    const contentCandidates = [
      normalized.contents,
      normalized.text,
      normalized.body,
      normalized.data,
      normalized.html,
      normalized.source,
      normalized.code,
      normalized.markdown,
      normalized.fileContent,
    ];
    const resolvedContent = contentCandidates
      .map((value) => normalizeInlineFileContent(value))
      .find((value) => typeof value === 'string');

    if (typeof resolvedContent === 'string') {
      normalized.content = resolvedContent;
    }
  } else {
    normalized.content = normalizeInlineFileContent(normalized.content);
  }

  return normalized;
}

function inferFileWriteArtifactExtension(targetPath = '') {
  const path = require('path');
  return path.extname(String(targetPath || '')).replace(/^\./, '').trim().toLowerCase() || 'txt';
}

function inferFileWriteArtifactMimeType(extension = '') {
  const normalized = String(extension || '').trim().toLowerCase();
  const mimeByExtension = {
    css: 'text/css',
    csv: 'text/csv',
    htm: 'text/html',
    html: 'text/html',
    js: 'text/javascript',
    json: 'application/json',
    markdown: 'text/markdown',
    md: 'text/markdown',
    mermaid: 'text/vnd.mermaid',
    mjs: 'text/javascript',
    mmd: 'text/vnd.mermaid',
    txt: 'text/plain',
    xml: 'application/xml',
    yaml: 'application/yaml',
    yml: 'application/yaml',
  };

  return mimeByExtension[normalized] || 'text/plain';
}

function buildFileWriteArtifactPreviewHtml(extension = '', content = '') {
  const normalizedExtension = String(extension || '').trim().toLowerCase();
  const source = String(content || '');

  if (!source) {
    return '';
  }

  if (normalizedExtension === 'html' || normalizedExtension === 'htm') {
    return source;
  }

  return `<pre>${escapeHtml(source.slice(0, 12000))}</pre>`;
}

async function persistFileWriteArtifact({
  sessionId,
  sourceMode = 'chat',
  targetPath = '',
  content = '',
} = {}) {
  if (!sessionId) {
    return null;
  }

  const path = require('path');
  const extension = inferFileWriteArtifactExtension(targetPath);
  const filename = path.basename(String(targetPath || '').trim()) || `generated-file.${extension}`;
  const normalizedContent = String(content || '').replace(/\r\n?/g, '\n');
  const storedArtifact = await artifactService.createStoredArtifact({
    sessionId,
    direction: 'generated',
    sourceMode,
    filename,
    extension,
    mimeType: inferFileWriteArtifactMimeType(extension),
    buffer: Buffer.from(normalizedContent, 'utf8'),
    extractedText: normalizedContent,
    previewHtml: buildFileWriteArtifactPreviewHtml(extension, normalizedContent),
    metadata: {
      createdByAgentTool: true,
      originalFilename: filename,
      toolId: 'file-write',
      ...(extension === 'mermaid' || extension === 'mmd'
        ? { mermaidSource: normalizedContent }
        : {}),
    },
    vectorize: false,
  });

  return artifactService.serializeArtifact(storedArtifact);
}

function resolveArtifactSourceMode(context = {}) {
  const route = String(context?.route || '').trim().toLowerCase();
  if (route === '/api/canvas') {
    return 'canvas';
  }
  if (route === '/api/notation') {
    return 'notation';
  }
  return String(context?.taskType || context?.mode || 'chat').trim() || 'chat';
}

function normalizeWorkloadAction(value = '') {
  return String(value || '').trim().toLowerCase() || 'create_from_scenario';
}

function resolveSessionWorkloadService(context = {}) {
  const service = context?.workloadService || null;
  if (!service?.isAvailable?.()) {
    throw new Error('Deferred workloads are unavailable. This feature requires an active Postgres-backed session store.');
  }

  const ownerId = String(context?.ownerId || '').trim();
  const sessionId = String(context?.sessionId || '').trim();
  if (!ownerId) {
    throw new Error('Deferred workloads require an authenticated owner context.');
  }
  if (!sessionId) {
    throw new Error('Deferred workloads require an active session context.');
  }

  return {
    service,
    ownerId,
    sessionId,
  };
}

function resolveManagedAppService(context = {}) {
  const service = context?.managedAppService || null;
  if (!service?.isAvailable?.()) {
    throw new Error('Managed apps are unavailable. This feature requires an active Postgres-backed session store.');
  }

  const ownerId = String(context?.ownerId || context?.userId || '').trim();
  if (!ownerId) {
    throw new Error('Managed apps require an authenticated owner context.');
  }

  return {
    service,
    ownerId,
    sessionId: String(context?.sessionId || '').trim() || null,
  };
}

function normalizeManagedAppRef(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function resolveManagedAppReference(params = {}) {
  const explicitRef = String(params.appRef || params.slug || params.id || params.app || '').trim();
  if (explicitRef) {
    return explicitRef;
  }

  return normalizeManagedAppRef(params.name || params.appName || params.title || '');
}

function hasExplicitManualWorkloadIntent(text = '') {
  const normalized = String(text || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return [
    /\bmanual\b/,
    /\bon[- ]demand\b/,
    /\bwhen i (?:run|trigger|start|launch) it\b/,
    /\bi(?:'d| would)? trigger it\b/,
    /\bdo not schedule\b/,
    /\bdon't schedule\b/,
    /\bwithout scheduling\b/,
    /\bnot scheduled\b/,
    /\bunscheduled\b/,
  ].some((pattern) => pattern.test(normalized));
}

function extractScenarioSource(params = {}) {
  return extractWorkloadScenarioSource(params);
}

function assertWorkloadSchedulingIntent(params = {}, context = {}) {
  const scenarioSource = extractScenarioSource(params);
  const triggerType = String(params.trigger?.type || '').trim().toLowerCase();
  const explicitManual = hasExplicitManualWorkloadIntent(scenarioSource);

  if (triggerType === 'cron' || triggerType === 'once') {
    return;
  }

  if (triggerType === 'manual') {
    if (!explicitManual) {
      throw new Error('Manual workload creation needs an explicit manual request. Add a time or recurrence for scheduled work.');
    }
    return;
  }

  if (hasSchedulingCue(scenarioSource)) {
    return;
  }

  if (explicitManual) {
    return;
  }

  throw new Error('Workload creation needs a schedule. Specify when it should run, or explicitly say it should be manual.');
}

function buildNormalizedWorkloadPayload(params = {}, context = {}, session = null) {
  const canonical = buildCanonicalWorkloadPayload(params, {
    session,
    recentMessages: context?.recentMessages || [],
    timezone: params.timezone || context?.timezone,
    now: params.now || context?.now,
  });

  return canonical || null;
}

function applyWorkloadExecutionPreferences(payload = {}, params = {}, context = {}) {
  const metadata = payload?.metadata && typeof payload.metadata === 'object'
    ? { ...payload.metadata }
    : {};
  const requestedModel = String(
    metadata.requestedModel
    || params.model
    || context.model
    || '',
  ).trim();

  if (!requestedModel) {
    return payload;
  }

  return {
    ...payload,
    metadata: {
      ...metadata,
      requestedModel,
    },
  };
}

function resolveDocumentService(context = {}) {
  const service = context?.documentService || null;
  if (!service?.recommendDocumentWorkflow
    || !service?.buildDocumentPlan
    || !service?.aiGenerate
    || !service?.assemble
    || !service?.generatePresentation) {
    throw new Error('Document workflows are unavailable because the document service is not initialized.');
  }

  return service;
}

function resolveOpenCodeService(context = {}) {
  const service = context?.opencodeService || null;
  if (!service?.runTool || !service?.createRun) {
    throw new Error('OpenCode runtime is unavailable because the service is not initialized.');
  }

  return service;
}

function resolvePodcastService(context = {}) {
  const service = context?.podcastService || podcastService;
  if (!service?.createPodcast) {
    throw new Error('Podcast workflows are unavailable because the podcast service is not initialized.');
  }

  return service;
}

function normalizeDocumentWorkflowAction(value = '') {
  return String(value || '').trim().toLowerCase() || 'recommend';
}

function truncateDocumentSourceText(value = '', limit = MAX_DOCUMENT_SOURCE_CHARS) {
  const text = String(value || '').trim();
  if (!text || text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} chars]`;
}

function normalizeDocumentSources(sources = []) {
  return (Array.isArray(sources) ? sources : [])
    .map((source, index) => {
      if (!source || typeof source !== 'object') {
        return null;
      }

      const content = truncateDocumentSourceText(
        source.content
        || source.text
        || source.body
        || source.summary
        || '',
      );

      if (!content) {
        return null;
      }

      const title = String(source.title || source.heading || source.label || '').trim();
      const sourceLabel = String(source.sourceLabel || source.source || source.site || '').trim();
      const sourceUrl = String(source.sourceUrl || source.url || '').trim();
      const kind = String(source.kind || source.type || '').trim();

      return {
        id: String(source.id || `source-${index + 1}`).trim(),
        title,
        sourceLabel,
        sourceUrl,
        kind,
        content,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_DOCUMENT_SOURCES);
}

function buildGroundedDocumentPrompt(prompt = '', sources = [], preferences = {}) {
  const normalizedPrompt = String(prompt || '').trim();
  const normalizedSources = normalizeDocumentSources(sources);
  const sections = [];

  if (normalizedPrompt) {
    sections.push(normalizedPrompt);
  }

  const preferenceLines = [
    preferences.title ? `Preferred title: ${String(preferences.title).trim()}` : '',
    preferences.subtitle ? `Preferred subtitle: ${String(preferences.subtitle).trim()}` : '',
    preferences.audience ? `Audience: ${String(preferences.audience).trim()}` : '',
    preferences.style ? `Style: ${String(preferences.style).trim()}` : '',
    preferences.theme ? `Theme: ${String(preferences.theme).trim()}` : '',
    preferences.format ? `Target format: ${String(preferences.format).trim()}` : '',
    preferences.documentType ? `Document type: ${String(preferences.documentType).trim()}` : '',
  ].filter(Boolean);

  if (preferenceLines.length > 0) {
    sections.push(preferenceLines.join('\n'));
  }

  if (normalizedSources.length > 0) {
    sections.push([
      'The source URLs were already discovered from verified research results.',
      'Do not ask the user to supply website lists or source URLs unless they explicitly want to constrain the source set.',
      'If more grounding is needed, continue with Perplexity-backed search, verify the strongest public pages with `web-fetch` first, and use `web-scrape` only when a page needs rendered or structured extraction before drafting.',
      'Use the verified source material below as working facts and source context.',
      'Preserve concrete numbers, names, links, dates, and pricing details unless the source material conflicts.',
      normalizedSources.map((source, index) => [
        `[Source ${index + 1}] ${source.title || source.sourceLabel || source.kind || source.id}`,
        source.sourceLabel ? `Label: ${source.sourceLabel}` : '',
        source.sourceUrl ? `URL: ${source.sourceUrl}` : '',
        source.kind ? `Kind: ${source.kind}` : '',
        `Content:\n${source.content}`,
      ].filter(Boolean).join('\n')).join('\n\n'),
    ].join('\n\n'));
  }

  return sections.filter(Boolean).join('\n\n').trim();
}

function isTextualDocumentMimeType(mimeType = '', filename = '') {
  const normalizedMime = String(mimeType || '').trim().toLowerCase();
  const normalizedFilename = String(filename || '').trim().toLowerCase();

  return normalizedMime.startsWith('text/')
    || normalizedMime.includes('json')
    || normalizedFilename.endsWith('.html')
    || normalizedFilename.endsWith('.htm')
    || normalizedFilename.endsWith('.md')
    || normalizedFilename.endsWith('.markdown');
}

function buildDocumentWorkflowResult(document = null, { includeContent = false } = {}) {
  if (!document) {
    return null;
  }

  const textualContent = isTextualDocumentMimeType(document.mimeType, document.filename)
    ? String(document.contentBuffer || document.content || '')
    : '';

  return {
    id: document.id,
    filename: document.filename,
    mimeType: document.mimeType,
    size: document.size,
    metadata: document.metadata || {},
    preview: document.preview || null,
    downloadUrl: document.downloadUrl || (document.id ? `/api/documents/${document.id}/download` : null),
    ...(textualContent
      ? {
        contentPreview: textualContent.slice(0, 4000),
        ...(includeContent ? { content: textualContent } : {}),
      }
      : {}),
  };
}

function buildArtifactWorkflowResult(result = null, { includeContent = false } = {}) {
  const artifact = result?.artifact || null;
  if (!artifact) {
    return null;
  }

  const textualContent = isTextualDocumentMimeType(artifact.mimeType, artifact.filename)
    ? String(result?.outputText || artifact.preview?.content || '')
    : '';

  return {
    id: artifact.id,
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    size: artifact.sizeBytes || 0,
    metadata: artifact.metadata || {},
    preview: artifact.preview || null,
    downloadUrl: artifact.downloadUrl || null,
    ...(artifact.previewUrl ? { previewUrl: artifact.previewUrl } : {}),
    ...(artifact.bundleDownloadUrl ? { bundleDownloadUrl: artifact.bundleDownloadUrl } : {}),
    ...(textualContent
      ? {
        contentPreview: textualContent.slice(0, 4000),
        ...(includeContent ? { content: textualContent } : {}),
      }
      : {}),
  };
}

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function normalizePositiveInteger(value, fallback, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }

  const normalized = Math.floor(numeric);
  if (!Number.isFinite(maximum) || maximum <= 0) {
    return normalized;
  }

  return Math.min(normalized, maximum);
}

function dedupeStringList(values = []) {
  const seen = new Set();
  const results = [];

  for (const value of Array.isArray(values) ? values : [values]) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(normalized);
  }

  return results;
}

function normalizeSourceText(value = '') {
  return truncateDocumentSourceText(normalizeWhitespace(stripHtml(String(value || ''))));
}

function normalizeDeepResearchImage(image = {}) {
  if (!image || typeof image !== 'object') {
    return null;
  }

  const url = String(image.url || image.imageUrl || '').trim();
  if (!url) {
    return null;
  }

  return {
    url,
    alt: String(image.alt || image.imageAlt || deriveImageAltText(url, 'image')).trim() || 'image',
    title: String(image.title || '').trim(),
    host: String(image.host || image.source || '').trim(),
    mimeType: String(image.mimeType || '').trim() || null,
    author: String(image.author || '').trim(),
    authorLink: String(image.authorLink || '').trim(),
    attribution: String(image.attribution || '').trim(),
    verified: image.verified === true,
    verificationMethod: String(image.verificationMethod || '').trim() || null,
    source: String(image.sourceKind || image.sourceType || image.source || '').trim() || 'image',
  };
}

function hasDeepResearchPresentationIntent(prompt = '') {
  const normalized = String(prompt || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const hasResearchIntent = /\b(deep research|research|look up|search the web|browse the web|search online|browse online|latest|current|today|news)\b/.test(normalized);
  const hasPresentationIntent = /\b(slides|presentation|slide deck|deck|pptx|website slides)\b/.test(normalized);
  return hasResearchIntent && hasPresentationIntent;
}

function deriveDeepResearchQueries({
  prompt = '',
  plan = null,
  researchQueries = [],
  passCount = DEFAULT_DEEP_RESEARCH_PASSES,
} = {}) {
  const outlineQueries = Array.isArray(plan?.outline)
    ? plan.outline
      .map((item) => item?.title || item?.heading || '')
      .filter((value) => value && !/^title slide$/i.test(String(value)))
      .slice(0, Math.max(0, passCount - 1))
      .map((label) => `${prompt} ${label}`.trim())
    : [];

  return dedupeStringList([
    ...researchQueries,
    prompt,
    plan?.titleSuggestion ? `${prompt} ${plan.titleSuggestion}` : '',
    ...outlineQueries,
  ]).slice(0, passCount);
}

function summarizeDeepResearchSourceForMemory(source = {}) {
  const content = String(source?.content || '').trim();
  if (!content) {
    return '';
  }

  const limit = Math.max(300, Math.min(Number(config.memory?.researchSourceExcerptChars || 2000), 1400));
  return content.length > limit ? `${content.slice(0, limit)}...` : content;
}

async function storeDeepResearchSourcesInMemory({
  context = {},
  prompt = '',
  query = '',
  passIndex = 0,
  sources = [],
} = {}) {
  if (!context?.memoryService?.rememberResearchNote || !context?.sessionId) {
    return [];
  }

  const writes = (Array.isArray(sources) ? sources : [])
    .filter((source) => source && typeof source === 'object' && (source.sourceUrl || source.title || source.content))
    .slice(0, DEFAULT_DEEP_RESEARCH_PAGES_PER_PASS)
    .map((source) => {
      const note = [
        '[Research note]',
        prompt ? `Objective: ${prompt}` : null,
        query ? `Query: ${query}` : null,
        `Pass: ${passIndex + 1}`,
        source.title ? `Title: ${String(source.title).trim()}` : null,
        source.sourceUrl ? `URL: ${String(source.sourceUrl).trim()}` : null,
        source.sourceLabel ? `Source: ${String(source.sourceLabel).trim()}` : null,
        `Source notes: ${summarizeDeepResearchSourceForMemory(source)}`,
      ].filter(Boolean).join('\n');

      return context.memoryService.rememberResearchNote(context.sessionId, note, {
        ...(context.ownerId ? { ownerId: context.ownerId } : {}),
        ...(context.memoryScope ? { memoryScope: context.memoryScope } : {}),
        ...(context.sourceSurface ? { sourceSurface: context.sourceSurface } : {}),
        ...(context.projectKey ? { projectKey: context.projectKey } : {}),
        sourceUrl: String(source.sourceUrl || '').trim(),
        sourceTitle: String(source.title || '').trim(),
        summary: String(source.title || source.sourceLabel || query || prompt || '').trim(),
        memoryKeywords: mergeMemoryKeywords([
          prompt,
          query,
          source.title,
          source.sourceLabel,
          source.kind,
        ].filter(Boolean), source.content || '', 20),
      });
    });

  if (writes.length === 0) {
    return [];
  }

  return Promise.allSettled(writes);
}

async function deriveDeepResearchProgressKeywords({
  context = {},
  prompt = '',
  query = '',
  sources = [],
} = {}) {
  const sourceKeywordSeed = normalizeMemoryKeywords(
    (Array.isArray(sources) ? sources : []).flatMap((source) => mergeMemoryKeywords([
      prompt,
      query,
      source?.title || '',
      source?.sourceLabel || '',
      source?.kind || '',
    ], source?.content || '', 12)),
    24,
  );

  if ((!context?.memoryService?.recallDetailed && !context?.memoryService?.recall) || !context?.sessionId) {
    return sourceKeywordSeed.slice(0, MAX_DEEP_RESEARCH_QUERY_KEYWORDS);
  }

  try {
    const recall = context.memoryService.recallDetailed
      ? await context.memoryService.recallDetailed(prompt || query, {
        sessionId: context.sessionId,
        ...(context.ownerId ? { ownerId: context.ownerId } : {}),
        ...(context.memoryScope ? { memoryScope: context.memoryScope } : {}),
        ...(context.sourceSurface ? { sourceSurface: context.sourceSurface } : {}),
        ...(context.projectKey ? { projectKey: context.projectKey } : {}),
        profile: 'research',
        objective: prompt || query,
        memoryKeywords: sourceKeywordSeed,
        topK: DEFAULT_DEEP_RESEARCH_RECALL_TOP_K,
      })
      : { entries: [] };

    const recallEntries = Array.isArray(recall?.entries) ? recall.entries : [];
    const recallKeywords = normalizeMemoryKeywords([
      ...recallEntries.flatMap((entry) => entry?.metadata?.keywords || []),
      ...recallEntries.flatMap((entry) => entry?.keywordOverlap || []),
      ...recallEntries.map((entry) => entry?.text || ''),
    ], 24);

    return normalizeMemoryKeywords([
      ...recallKeywords,
      ...sourceKeywordSeed,
    ], MAX_DEEP_RESEARCH_QUERY_KEYWORDS);
  } catch (_error) {
    return sourceKeywordSeed.slice(0, MAX_DEEP_RESEARCH_QUERY_KEYWORDS);
  }
}

function buildRefinedDeepResearchQuery({
  baseQuery = '',
  prompt = '',
  progressKeywords = [],
} = {}) {
  const normalizedBaseQuery = String(baseQuery || prompt || '').trim();
  if (!normalizedBaseQuery) {
    return '';
  }

  const loweredBaseQuery = normalizedBaseQuery.toLowerCase();
  const appendedKeywords = normalizeMemoryKeywords(progressKeywords, MAX_DEEP_RESEARCH_QUERY_KEYWORDS)
    .filter((keyword) => (
      keyword
      && keyword.length >= 3
      && !/^https?:/i.test(keyword)
      && !loweredBaseQuery.includes(keyword.toLowerCase())
    ))
    .slice(0, MAX_DEEP_RESEARCH_QUERY_KEYWORDS);

  return appendedKeywords.length > 0
    ? `${normalizedBaseQuery} ${appendedKeywords.join(' ')}`.trim()
    : normalizedBaseQuery;
}

function buildDeepResearchSourceFromFetch({
  fetched = {},
  searchResult = null,
  fallbackUrl = '',
  kind = 'web-fetch',
} = {}) {
  const url = String(fetched?.url || fallbackUrl || '').trim();
  const title = String(
    fetched?.title
    || searchResult?.title
    || url
    || 'Research source',
  ).trim();
  const sourceLabel = String(searchResult?.source || '').trim();
  const rawText = kind === 'web-scrape'
    ? (
      fetched?.summary
      || fetched?.text
      || fetched?.content
      || JSON.stringify(fetched?.data || {})
    )
    : (
      fetched?.body
      || fetched?.content
      || fetched?.text
      || ''
    );
  const content = normalizeSourceText(rawText);

  if (!content) {
    return null;
  }

  return {
    id: `${kind}-${url || title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    title,
    sourceLabel,
    sourceUrl: url,
    kind,
    content,
  };
}

function buildPresentationResearchPrompt({
  prompt = '',
  sources = [],
  recommendation = null,
  plan = null,
  params = {},
  format = 'pptx',
} = {}) {
  return buildGroundedDocumentPrompt(prompt, sources, {
    title: params.title || plan?.titleSuggestion || '',
    subtitle: params.subtitle || '',
    audience: params.audience || '',
    style: params.style || '',
    theme: params.theme || plan?.themeSuggestion || '',
    format,
    documentType: params.documentType || recommendation?.inferredType || 'presentation',
  });
}

function derivePresentationImageQueries({
  prompt = '',
  presentation = {},
  maxImages = DEFAULT_DEEP_RESEARCH_IMAGE_LIMIT,
} = {}) {
  const slides = Array.isArray(presentation?.slides) ? presentation.slides : [];
  const preferredSlides = slides
    .filter((slide) => slide && typeof slide === 'object' && (slide.layout === 'image' || slide.imagePrompt))
    .slice(0, maxImages);

  if (preferredSlides.length === 0) {
    return [];
  }

  return preferredSlides.map((slide, index) => ({
    slideIndex: slides.indexOf(slide),
    query: String(slide.imagePrompt || `${prompt} ${slide.title || `slide ${index + 1}`}`).trim(),
    title: String(slide.title || `Slide ${index + 1}`).trim(),
    caption: String(slide.caption || '').trim(),
  }));
}

function applyImagesToPresentation(presentation = {}, imagesBySlide = new Map()) {
  const slides = Array.isArray(presentation?.slides) ? presentation.slides : [];

  return {
    ...presentation,
    slides: slides.map((slide, index) => {
      const image = normalizeDeepResearchImage(imagesBySlide.get(index));
      if (!image) {
        return slide;
      }

      const attribution = image.attribution
        || (image.author ? `${image.author}${image.authorLink ? ' / Unsplash' : ''}` : image.host);

      return {
        ...slide,
        imageUrl: image.url,
        imageAlt: image.alt || slide.title || `Slide ${index + 1}`,
        imageSource: attribution || '',
        caption: slide.caption || (attribution ? `Image source: ${attribution}` : ''),
      };
    }),
  };
}

async function executeNestedTool(context = {}, toolId = '', params = {}) {
  const toolManager = context?.toolManager || null;
  if (!toolManager?.executeTool) {
    throw new Error(`${toolId} requires a nested tool manager in the execution context.`);
  }

  const nestedContext = context?.toolManager
    ? context
    : { ...context, toolManager };
  const result = await toolManager.executeTool(toolId, params, nestedContext);
  if (!result?.success) {
    throw new Error(result?.error || `${toolId} failed.`);
  }

  return result.data;
}

class ToolManager {
  constructor() {
    this.registry = getUnifiedRegistry();
    this.agentBus = getAgentBus();
    this.loadedTools = new Map();
    this.initialized = false;
  }

  /**
   * Initialize all tools
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    console.log('[ToolManager] Initializing tools...');

    // Register web tools
    this.registerWebTools();
    
    // Register SSH tools
    this.registerSSHTools();
    
    // Register design tools
    this.registerDesignTools();
    
    // Register database tools
    this.registerDatabaseTools();
    
    // Register sandbox tools
    this.registerSandboxTools();
    
    // Register system tools
    this.registerSystemTools();

    // Set up event listeners
    this.setupEventListeners();

    this.initialized = true;
    
    console.log(`[ToolManager] Initialized ${this.registry.getAllTools().length} tools`);
    
    return this;
  }

  /**
   * Register web scraping tools
   */
  registerWebTools() {
    try {
      const tools = registerWebTools();
      tools.forEach(tool => {
        this.loadedTools.set(tool.id, tool);
      });
      console.log('[ToolManager] Web tools registered');
    } catch (error) {
      console.error('[ToolManager] Failed to register web tools:', error.message);
    }
  }

  /**
   * Register SSH/remote tools
   */
  registerSSHTools() {
    try {
      const tools = [
        new SSHExecuteTool(),
        new SSHExecuteTool({
          id: 'remote-command',
          name: 'Remote Command',
          description: 'Execute remote server commands over SSH',
        }),
        new DockerExecTool(),
        new K3sDeployTool(),
      ];

      tools.forEach(tool => {
        const definition = this.createToolDefinition(tool, {
          frontend: {
            exposeToFrontend: tool.id !== 'ssh-execute',
            icon: 'terminal',
            requiresSetup: true // SSH needs key configuration
          },
          skill: {
            triggerPatterns: this.getSSHTriggerPatterns(tool.id),
            requiresConfirmation: true
          }
        });
        
        this.registry.register(definition);
        this.loadedTools.set(tool.id, tool);
      });

      console.log('[ToolManager] SSH tools registered');
    } catch (error) {
      console.error('[ToolManager] Failed to register SSH tools:', error.message);
    }
  }

  /**
   * Register design tools
   */
  registerDesignTools() {
    try {
      const tools = registerDesignTools();
      tools.forEach(tool => {
        this.loadedTools.set(tool.id, tool);
      });
      console.log('[ToolManager] Design tools registered');
    } catch (error) {
      console.error('[ToolManager] Failed to register design tools:', error.message);
    }
  }

  /**
   * Register database tools
   */
  registerDatabaseTools() {
    try {
      const tools = registerDatabaseTools();
      tools.forEach(tool => {
        this.loadedTools.set(tool.id, tool);
      });
      console.log('[ToolManager] Database tools registered');
    } catch (error) {
      console.error('[ToolManager] Failed to register database tools:', error.message);
    }
  }

  /**
   * Register sandbox tools
   */
  registerSandboxTools() {
    try {
      const tools = registerSandboxTools();
      tools.forEach(tool => {
        this.loadedTools.set(tool.id, tool);
      });
      console.log('[ToolManager] Sandbox tools registered');
    } catch (error) {
      console.error('[ToolManager] Failed to register sandbox tools:', error.message);
    }
  }

  /**
   * Register system tools
   */
  registerSystemTools() {
    // File system tools
    const fileTools = [
      {
        id: 'file-read',
        name: 'File Reader',
        category: 'system',
        description: 'Read file contents',
        backend: {
          handler: async (params) => {
            const fs = require('fs').promises;
            const content = await fs.readFile(params.path, 'utf8');
            return { content, path: params.path };
          },
          sideEffects: ['read'],
          timeout: 10000
        },
        inputSchema: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string' },
            encoding: { type: 'string', default: 'utf8' }
          }
        }
      },
      {
        id: 'file-write',
        name: 'File Writer',
        category: 'system',
        description: 'Write a full content string to a local runtime file. Requires both path and content in the same call. When a session is active, the written file is also mirrored into a downloadable artifact.',
        backend: {
          handler: async (params, context = {}) => {
            const path = require('path');
            const fs = require('fs').promises;
            const normalized = normalizeFileWriteParams(params);

            if (typeof normalized.path !== 'string' || !normalized.path.trim()) {
              throw new Error('file-write requires a non-empty `path` string.');
            }

            if (!Object.prototype.hasOwnProperty.call(normalized, 'content')) {
              throw new Error('file-write requires a `content` string. Provide the full file body in `content`; a path alone is not enough.');
            }

            if (typeof normalized.content !== 'string') {
              throw new Error('file-write `content` must be a string.');
            }

            const targetPath = path.resolve(normalized.path);
            let persistedArtifact = null;

            if (context.sessionId) {
              persistedArtifact = await persistFileWriteArtifact({
                sessionId: context.sessionId,
                sourceMode: resolveArtifactSourceMode(context),
                targetPath,
                content: normalized.content,
              });
            }

            try {
              await fs.mkdir(path.dirname(targetPath), { recursive: true });
              await fs.writeFile(targetPath, normalized.content, normalized.encoding || 'utf8');
            } catch (error) {
              if (persistedArtifact?.id && typeof artifactService.deleteArtifact === 'function') {
                try {
                  await artifactService.deleteArtifact(persistedArtifact.id);
                } catch (cleanupError) {
                  console.warn('[ToolManager] Failed to clean up persisted artifact after file-write error:', cleanupError.message);
                }
              }
              throw error;
            }

            let indexedAsset = null;
            try {
              indexedAsset = await assetManager.upsertWorkspacePath(targetPath, {
                sessionId: context.sessionId || null,
                ownerId: context.ownerId || context.userId || null,
              });
            } catch (error) {
              console.warn('[ToolManager] Failed to index written asset:', error.message);
            }
            return {
              path: targetPath,
              bytesWritten: Buffer.byteLength(normalized.content, normalized.encoding || 'utf8'),
              assetIndexed: Boolean(indexedAsset),
              artifactPersisted: Boolean(persistedArtifact),
              ...(persistedArtifact
                ? {
                  artifact: persistedArtifact,
                  artifacts: [persistedArtifact],
                }
                : {}),
            };
          },
          sideEffects: ['write'],
          timeout: 10000
        },
        inputSchema: {
          type: 'object',
          required: ['path', 'content'],
          properties: {
            path: {
              type: 'string',
              description: 'Local file path in this runtime. For remote hosts or container-only paths, use remote-command or docker-exec instead.'
            },
            content: {
              type: 'string',
              description: 'Full file contents to write in this same call.'
            },
            encoding: {
              type: 'string',
              default: 'utf8'
            }
          }
        }
      },
      {
        id: 'asset-search',
        name: 'Asset Search',
        category: 'system',
        description: 'Search the indexed asset catalog for previous images, documents, uploaded artifacts, and workspace files.',
        backend: {
          handler: async (params = {}, context = {}) => assetManager.searchAssets(params, {
            ownerId: context.ownerId || context.userId || null,
            sessionId: context.sessionId || null,
            sessionIsolation: context.sessionIsolation === true,
          }),
          sideEffects: ['read'],
          timeout: 30000
        },
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Keywords, filenames, or remembered phrases to match. Leave blank to list recent assets.'
            },
            kind: {
              type: 'string',
              enum: ['any', 'image', 'document'],
              default: 'any'
            },
            sourceType: {
              type: 'string',
              enum: ['any', 'artifact', 'workspace'],
              default: 'any'
            },
            sessionId: {
              type: 'string',
              description: 'Optional session id to narrow artifact matches.'
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 50,
              default: 10
            },
            includeContent: {
              type: 'boolean',
              description: 'Include stored text previews for document-like matches when available.'
            },
            refresh: {
              type: 'boolean',
              description: 'Refresh the asset index before searching when a very recent file is missing.'
            }
          },
          additionalProperties: false
        },
        skill: {
          triggerPatterns: [
            'find earlier image',
            'find previous document',
            'search uploaded file',
            'search assets',
            'asset manager',
            'find that pdf from before'
          ],
          requiresConfirmation: false
        },
        frontend: {
          exposeToFrontend: true,
          icon: 'folder-search'
        }
      },
      {
        id: 'agent-notes-write',
        name: 'Agent Notes Writer',
        category: 'system',
        description: 'Update the persistent carryover notes file used for durable project context, Phil preferences, personal-agent memory, and future-useful ideas.',
        backend: {
          handler: async (params) => {
            if (!Object.prototype.hasOwnProperty.call(params || {}, 'content')) {
              throw new Error('agent-notes-write requires a `content` string.');
            }
            if (typeof params.content !== 'string') {
              throw new Error('agent-notes-write `content` must be a string.');
            }
            const content = params.content;
            const saved = writeAgentNotesFile(content);
            return {
              path: saved.absoluteFilePath,
              filePath: saved.filePath,
              characters: saved.characterCount,
              characterLimit: saved.characterLimit,
              updatedAt: saved.updatedAt,
            };
          },
          sideEffects: ['write'],
          timeout: 10000
        },
        inputSchema: {
          type: 'object',
          required: ['content'],
          properties: {
            content: {
              type: 'string',
              description: `Full carryover notes file content. Rewrite the whole file compactly and keep it under ${AGENT_NOTES_CHAR_LIMIT} characters.`
            },
            reason: {
              type: 'string',
              description: 'Short explanation of why this durable note update matters for future sessions.'
            }
          }
        }
      },
      {
        id: 'file-search',
        name: 'File Search',
        category: 'system',
        description: 'Search for files by pattern',
        backend: {
          handler: async (params) => {
            const { glob } = require('glob');
            const files = await glob(params.pattern, { cwd: params.cwd });
            return { files, pattern: params.pattern };
          },
          sideEffects: ['read'],
          timeout: 30000
        },
        inputSchema: {
          type: 'object',
          required: ['pattern'],
          properties: {
            pattern: { type: 'string' },
            cwd: { type: 'string' }
          }
        }
      },
      {
        id: 'file-mkdir',
        name: 'Directory Creator',
        category: 'system',
        description: 'Create a folder or directory',
        backend: {
          handler: async (params) => {
            const path = require('path');
            const fs = require('fs').promises;
            const targetPath = path.resolve(params.path);
            await fs.mkdir(targetPath, { recursive: params.recursive !== false });
            return { path: targetPath, created: true };
          },
          sideEffects: ['write'],
          timeout: 10000
        },
        inputSchema: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string' },
            recursive: { type: 'boolean', default: true }
          }
        },
        skill: {
          triggerPatterns: ['create folder', 'create directory', 'make folder', 'make directory', 'mkdir'],
          requiresConfirmation: false
        }
      }
    ];

    // Code execution tools
    const codeTools = [
      {
        id: 'code-execute',
        name: 'Code Executor',
        category: 'system',
        description: 'Execute code in sandboxed environment',
        backend: {
          handler: async (params) => {
            // Would use sandboxed execution
            return { 
              note: 'Sandboxed execution not implemented',
              language: params.language,
              code: params.code.substring(0, 100) + '...'
            };
          },
          sideEffects: ['execute'],
          sandbox: { network: false, filesystem: 'readonly' },
          timeout: 30000
        },
        inputSchema: {
          type: 'object',
          required: ['language', 'code'],
          properties: {
            language: { 
              type: 'string',
              enum: ['javascript', 'python', 'bash', 'sql']
            },
            code: { type: 'string' },
            timeout: { type: 'integer', default: 30000 }
          }
        },
        skill: {
          triggerPatterns: ['run code', 'execute', 'run script', 'test code'],
          requiresConfirmation: true
        },
        frontend: {
          exposeToFrontend: false,
          icon: 'code',
          uiComponent: 'CodeExecutorPanel'
        }
      }
    ];

    const docsTools = [
      {
        id: 'tool-doc-read',
        name: 'Tool Doc Reader',
        category: 'system',
        description: 'Load detailed tool documentation only when explicitly requested',
        backend: {
          handler: async (params) => {
            const metadata = await getToolDocMetadata(params.toolId);
            if (!metadata.docAvailable) {
              throw new Error(`No documentation found for tool '${params.toolId}'`);
            }

            const doc = await readToolDoc(params.toolId);
            return {
              toolId: params.toolId,
              support: metadata.support,
              content: doc.content,
            };
          },
          sideEffects: ['read'],
          timeout: 10000
        },
        inputSchema: {
          type: 'object',
          required: ['toolId'],
          properties: {
            toolId: { type: 'string', description: 'Tool ID to load documentation for' }
          }
        },
        skill: {
          triggerPatterns: ['tool help', 'tool documentation', 'how do i use tool', 'what can this tool do'],
          requiresConfirmation: false
        },
        frontend: {
          exposeToFrontend: false,
          icon: 'book-open'
        }
      },
      {
        id: DOCUMENT_WORKFLOW_TOOL_ID,
        name: 'Document Workflow',
        category: 'system',
        description: 'Recommend, plan, and generate documents or slide decks, optionally grounded in verified research and scrape results.',
        backend: {
          handler: async (params = {}, context = {}) => {
            const documentService = resolveDocumentService(context);
            const action = normalizeDocumentWorkflowAction(params.action);
            const prompt = String(params.prompt || params.request || params.topic || '').trim();
            const documentType = String(params.documentType || params.document_type || '').trim();
            const tone = String(params.tone || 'professional').trim() || 'professional';
            const length = String(params.length || 'medium').trim() || 'medium';
            const formatPreference = String(params.format || '').trim().toLowerCase();
            const sources = normalizeDocumentSources(params.sources || []);
            const limit = Number.isFinite(Number(params.limit))
              ? Math.max(1, Math.min(Number(params.limit), 8))
              : 4;
            const recommendation = documentService.recommendDocumentWorkflow({
              prompt,
              documentType,
              format: formatPreference,
              limit,
            });
            const resolvedDocumentType = documentType || recommendation.inferredType || 'document';
            const resolvedFormat = formatPreference || recommendation.recommendedFormat || 'html';

            if (action === 'recommend') {
              return {
                action,
                recommendation,
                sourceCount: sources.length,
              };
            }

            if (action === 'plan') {
              return {
                action,
                plan: documentService.buildDocumentPlan({
                  prompt: buildGroundedDocumentPrompt(prompt, sources, {
                    title: params.title,
                    subtitle: params.subtitle,
                    audience: params.audience,
                    style: params.style,
                    theme: params.theme,
                    format: resolvedFormat,
                    documentType: resolvedDocumentType,
                  }),
                  documentType: resolvedDocumentType,
                  format: resolvedFormat,
                  tone,
                  length,
                }),
                sourceCount: sources.length,
              };
            }

            if (action === 'assemble') {
              if (sources.length === 0) {
                throw new Error('document-workflow assemble requires one or more source entries.');
              }

              const document = await documentService.assemble(
                sources.map((source) => ({
                  title: source.title || source.sourceLabel || source.id,
                  content: source.content,
                  text: source.content,
                  sourceUrl: source.sourceUrl,
                  sourceLabel: source.sourceLabel,
                })),
                {
                  format: resolvedFormat,
                  title: String(params.title || recommendation.blueprint?.label || 'Research Brief').trim() || 'Research Brief',
                },
              );

              return {
                action,
                sourceCount: sources.length,
                document: buildDocumentWorkflowResult(document, {
                  includeContent: params.includeContent === true,
                }),
              };
            }

            if (action === 'generate') {
              const structuredPresentation = params.presentation
                && typeof params.presentation === 'object'
                && !Array.isArray(params.presentation)
                ? params.presentation
                : null;
              const groundedPrompt = buildGroundedDocumentPrompt(prompt, sources, {
                title: params.title,
                subtitle: params.subtitle,
                audience: params.audience,
                style: params.style,
                theme: params.theme,
                format: resolvedFormat,
                documentType: resolvedDocumentType,
              });
              if (!groundedPrompt && !structuredPresentation) {
                throw new Error('document-workflow generate requires a prompt or grounded source material.');
              }

              if (structuredPresentation) {
                const document = await documentService.generatePresentation(structuredPresentation, {
                  format: resolvedFormat,
                  model: params.model || context.model || undefined,
                  title: params.title || structuredPresentation.title,
                  subtitle: params.subtitle || structuredPresentation.subtitle,
                  audience: params.audience,
                  style: params.style,
                  theme: params.theme || structuredPresentation.theme,
                  slideCount: params.slideCount,
                  generateImages: params.generateImages,
                  reasoningEffort: params.reasoningEffort || context.reasoningEffort || undefined,
                });

                return {
                  action,
                  recommendation,
                  sourceCount: sources.length,
                  document: buildDocumentWorkflowResult(document, {
                    includeContent: params.includeContent === true,
                  }),
                };
              }

              if (resolvedFormat === 'html'
                && isDashboardRequest(groundedPrompt)
                && context?.sessionId) {
                try {
                  const generatedArtifact = await artifactService.generateArtifact({
                    session: context.session || null,
                    sessionId: context.sessionId,
                    mode: context.clientSurface || 'chat',
                    prompt: groundedPrompt,
                    format: 'html',
                    artifactIds: [],
                    existingContent: '',
                    model: params.model || context.model || undefined,
                    reasoningEffort: params.reasoningEffort || context.reasoningEffort || undefined,
                  });

                  return {
                    action,
                    recommendation,
                    sourceCount: sources.length,
                    document: buildArtifactWorkflowResult(generatedArtifact, {
                      includeContent: params.includeContent === true,
                    }),
                  };
                } catch (error) {
                  console.warn(`[document-workflow] Dashboard HTML artifact generation failed, falling back to document service: ${error.message}`);
                }
              }

              const document = await documentService.aiGenerate(groundedPrompt, {
                documentType: resolvedDocumentType,
                tone,
                length,
                format: resolvedFormat,
                model: params.model || context.model || undefined,
                title: params.title,
                subtitle: params.subtitle,
                audience: params.audience,
                style: params.style,
                theme: params.theme,
                slideCount: params.slideCount,
                generateImages: params.generateImages,
              });

              return {
                action,
                recommendation,
                sourceCount: sources.length,
                document: buildDocumentWorkflowResult(document, {
                  includeContent: params.includeContent === true,
                }),
              };
            }

            throw new Error(`Unsupported document-workflow action: ${action}`);
          },
          sideEffects: ['write'],
          timeout: 45000
        },
        inputSchema: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['recommend', 'plan', 'generate', 'assemble']
            },
            prompt: { type: 'string' },
            request: { type: 'string' },
            topic: { type: 'string' },
            documentType: { type: 'string' },
            format: { type: 'string' },
            tone: { type: 'string' },
            length: { type: 'string' },
            title: { type: 'string' },
            subtitle: { type: 'string' },
            audience: { type: 'string' },
            style: { type: 'string' },
            theme: { type: 'string' },
            slideCount: { type: 'integer' },
            generateImages: { type: 'boolean' },
            model: { type: 'string' },
            presentation: { type: 'object' },
            includeContent: { type: 'boolean' },
            limit: { type: 'integer' },
            sources: {
              type: 'array',
              maxItems: MAX_DOCUMENT_SOURCES,
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  sourceLabel: { type: 'string' },
                  sourceUrl: { type: 'string' },
                  kind: { type: 'string' },
                  content: { type: 'string' },
                  text: { type: 'string' },
                  body: { type: 'string' },
                  summary: { type: 'string' },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false
        },
        skill: {
          triggerPatterns: [
            'generate document',
            'create report',
            'create brief',
            'build a deck',
            'make slides',
            'presentation',
            'document workflow',
            'research brief',
            'html document',
          ],
          requiresConfirmation: false
        },
        frontend: {
          exposeToFrontend: false,
          icon: 'file-text'
        }
      },
      {
        id: DEEP_RESEARCH_PRESENTATION_TOOL_ID,
        name: 'Deep Research Presentation',
        category: 'system',
        description: 'Plan a research-backed presentation, run multiple web research passes, gather verified image sources, and build the final deck in one ordered workflow.',
        backend: {
          handler: async (params = {}, context = {}) => {
            const documentService = resolveDocumentService(context);
            if (!documentService?.aiGenerator?.generatePresentationContent) {
              throw new Error('Deep research presentation generation requires the AI presentation generator.');
            }

            const prompt = String(params.prompt || params.request || params.topic || '').trim();
            if (!prompt) {
              throw new Error('deep-research-presentation requires a prompt, request, or topic.');
            }

            const format = String(params.format || 'pptx').trim().toLowerCase() || 'pptx';
            const documentType = String(params.documentType || 'presentation').trim() || 'presentation';
            const tone = String(params.tone || 'professional').trim() || 'professional';
            const length = String(params.length || 'medium').trim() || 'medium';
            const passCount = normalizePositiveInteger(params.researchPasses, DEFAULT_DEEP_RESEARCH_PASSES, MAX_DEEP_RESEARCH_PASSES);
            const searchLimit = normalizePositiveInteger(params.searchLimit, DEFAULT_DEEP_RESEARCH_SEARCH_LIMIT, MAX_DEEP_RESEARCH_SEARCH_LIMIT);
            const pagesPerPass = normalizePositiveInteger(params.pagesPerPass, DEFAULT_DEEP_RESEARCH_PAGES_PER_PASS, MAX_DEEP_RESEARCH_PAGES_PER_PASS);
            const imageLimit = normalizePositiveInteger(params.imageLimit, DEFAULT_DEEP_RESEARCH_IMAGE_LIMIT, MAX_DEEP_RESEARCH_IMAGE_LIMIT);
            const imageSettleDelayMs = normalizePositiveInteger(
              params.imageSettleDelayMs,
              DEFAULT_IMAGE_SETTLE_DELAY_MS,
              10000,
            );
            const imageMode = String(params.imageMode || 'auto').trim().toLowerCase() || 'auto';
            const searchDomains = normalizeDomainList(params.searchDomains || params.domains || []);
            const researchSafeScrape = params.researchSafeScrape !== false;
            const requestedResearchMode = String(params.researchMode || '').trim().toLowerCase();
            const researchMode = ['fast-search', 'pro-search', 'deep-research', 'advanced-deep-research'].includes(requestedResearchMode)
              ? requestedResearchMode
              : 'deep-research';

            const recommendationData = await executeNestedTool(context, DOCUMENT_WORKFLOW_TOOL_ID, {
              action: 'recommend',
              prompt,
              documentType,
              format,
              limit: params.limit,
            });
            const planData = await executeNestedTool(context, DOCUMENT_WORKFLOW_TOOL_ID, {
              action: 'plan',
              prompt,
              documentType,
              format,
              tone,
              length,
              title: params.title,
              subtitle: params.subtitle,
              audience: params.audience,
              style: params.style,
              theme: params.theme,
              limit: params.limit,
            });

            const recommendation = recommendationData?.recommendation || null;
            const plan = planData?.plan || null;
            const researchQueryPlan = deriveDeepResearchQueries({
              prompt,
              plan,
              researchQueries: params.researchQueries,
              passCount,
            });
            const sourcesByKey = new Map();
            const researchPasses = [];
            let progressKeywords = [];

            for (let passIndex = 0; passIndex < passCount; passIndex += 1) {
              const baseQuery = researchQueryPlan[passIndex] || researchQueryPlan[researchQueryPlan.length - 1] || prompt;
              const query = buildRefinedDeepResearchQuery({
                baseQuery,
                prompt,
                progressKeywords,
              });
              let searchData = null;
              const searchStartedAt = new Date().toISOString();
              try {
                searchData = await executeNestedTool(context, 'web-search', {
                  query,
                  engine: 'perplexity',
                  researchMode,
                  limit: searchLimit,
                  region: 'us-en',
                  timeRange: String(params.timeRange || 'all').trim().toLowerCase() || 'all',
                  includeSnippets: true,
                  includeUrls: true,
                  domains: searchDomains,
                });
              } catch (error) {
                researchPasses.push({
                  query,
                  status: 'failed',
                  searchStartedAt,
                  error: error.message,
                  verifiedCount: 0,
                  results: [],
                });
                continue;
              }

              const results = Array.isArray(searchData?.results) ? searchData.results : [];
              const verifiedSourcesThisPass = [];
              const passSummary = {
                query,
                status: 'completed',
                searchStartedAt,
                totalResults: Number(searchData?.totalResults || results.length || 0),
                verifiedCount: 0,
                results: [],
              };

              for (const result of results.slice(0, pagesPerPass)) {
                const url = String(result?.url || '').trim();
                if (!url) {
                  continue;
                }

                let fetched = null;
                let kind = 'web-fetch';
                let fetchError = null;

                try {
                  fetched = await executeNestedTool(context, 'web-fetch', {
                    url,
                    timeout: 20000,
                    cache: true,
                  });
                } catch (error) {
                  fetchError = error;
                  try {
                    const approvedHost = getHostnameFromUrl(url);
                    fetched = await executeNestedTool(context, 'web-scrape', {
                      url,
                      browser: true,
                      researchSafe: researchSafeScrape,
                      approvedDomains: approvedHost ? [approvedHost] : [],
                      respectRobotsTxt: researchSafeScrape,
                      timeout: 20000,
                    });
                    kind = 'web-scrape';
                  } catch (scrapeError) {
                    fetchError = scrapeError;
                  }
                }

                if (!fetched) {
                  passSummary.results.push({
                    url,
                    title: String(result?.title || url).trim(),
                    status: 'failed',
                    error: fetchError?.message || 'Unable to verify the result page.',
                  });
                  continue;
                }

                const source = buildDeepResearchSourceFromFetch({
                  fetched,
                  searchResult: result,
                  fallbackUrl: url,
                  kind,
                });
                if (!source) {
                  passSummary.results.push({
                    url,
                    title: String(result?.title || url).trim(),
                    status: 'skipped',
                    tool: kind,
                  });
                  continue;
                }

                const sourceKey = source.sourceUrl || source.id;
                if (!sourcesByKey.has(sourceKey)) {
                  sourcesByKey.set(sourceKey, source);
                }
                verifiedSourcesThisPass.push(source);

                passSummary.results.push({
                  url,
                  title: source.title,
                  status: 'verified',
                  tool: kind,
                  sourceLabel: source.sourceLabel,
                });
              }

              passSummary.verifiedCount = passSummary.results.filter((entry) => entry.status === 'verified').length;
              researchPasses.push(passSummary);

              await storeDeepResearchSourcesInMemory({
                context,
                prompt,
                query,
                passIndex,
                sources: verifiedSourcesThisPass,
              });

              progressKeywords = await deriveDeepResearchProgressKeywords({
                context,
                prompt,
                query,
                sources: Array.from(sourcesByKey.values()),
              });
            }

            const groundedSources = Array.from(sourcesByKey.values());
            const theme = String(params.theme || plan?.themeSuggestion || 'editorial').trim() || 'editorial';
            const groundedPrompt = buildPresentationResearchPrompt({
              prompt,
              sources: groundedSources,
              recommendation,
              plan,
              params,
              format,
            });
            const inferredSlideCount = typeof documentService.inferSlideCount === 'function'
              ? documentService.inferSlideCount(length)
              : undefined;
            const draftPresentation = await documentService.aiGenerator.generatePresentationContent(groundedPrompt, {
              documentType,
              tone,
              length,
              audience: params.audience || 'general audience',
              designPlan: plan,
              theme,
              style: params.style || theme,
              slideCount: params.slideCount || inferredSlideCount,
              model: params.model || context.model || undefined,
              reasoningEffort: params.reasoningEffort || context.reasoningEffort || undefined,
              includeImages: true,
              includeCharts: true,
            });

            const imagesBySlide = new Map();
            const imageQueries = derivePresentationImageQueries({
              prompt,
              presentation: draftPresentation,
              maxImages: imageLimit,
            });
            const imagePasses = [];

            for (const imageQuery of imageQueries) {
              let selectedImage = null;
              let imageSourceTool = '';
              let imageError = null;

              if (imageMode !== 'generated') {
                try {
                  const unsplashData = await executeNestedTool(context, 'image-search-unsplash', {
                    query: imageQuery.query,
                    perPage: 4,
                    orientation: 'landscape',
                  });
                  const candidate = Array.isArray(unsplashData?.images) ? unsplashData.images[0] : null;
                  if (candidate?.url) {
                    if (imageSettleDelayMs > 0) {
                      await delay(imageSettleDelayMs);
                    }
                    const verified = await executeNestedTool(context, 'image-from-url', {
                      url: candidate.url,
                      alt: candidate.alt || imageQuery.title,
                      title: imageQuery.title,
                    });
                    selectedImage = normalizeDeepResearchImage({
                      ...candidate,
                      ...(verified?.image || verified?.images?.[0] || {}),
                      attribution: candidate.author ? `${candidate.author} / Unsplash` : '',
                      sourceKind: 'image-search-unsplash',
                    });
                    imageSourceTool = 'image-search-unsplash';
                  }
                } catch (error) {
                  imageError = error;
                }
              }

              if (!selectedImage && imageMode !== 'stock') {
                try {
                  const generated = await executeNestedTool(context, 'image-generate', {
                    prompt: imageQuery.query,
                    alt: imageQuery.title,
                  });
                  const candidate = generated?.image || generated?.images?.[0] || null;
                  const candidateUrl = String(candidate?.url || '').trim();
                  if (candidateUrl) {
                    if (imageSettleDelayMs > 0) {
                      await delay(imageSettleDelayMs);
                    }
                    const verified = await executeNestedTool(context, 'image-from-url', {
                      url: candidateUrl,
                      alt: candidate.alt || imageQuery.title,
                      title: imageQuery.title,
                    });
                    selectedImage = normalizeDeepResearchImage({
                      ...candidate,
                      ...(verified?.image || verified?.images?.[0] || {}),
                      attribution: 'Generated image',
                      sourceKind: 'image-generate',
                    });
                    imageSourceTool = 'image-generate';
                  }
                } catch (error) {
                  imageError = error;
                }
              }

              if (selectedImage) {
                imagesBySlide.set(imageQuery.slideIndex, selectedImage);
              }

              imagePasses.push({
                slideIndex: imageQuery.slideIndex,
                title: imageQuery.title,
                query: imageQuery.query,
                status: selectedImage ? 'verified' : 'failed',
                tool: imageSourceTool || null,
                image: selectedImage,
                error: selectedImage ? null : (imageError?.message || 'No image source could be verified.'),
              });
            }

            const presentationWithImages = applyImagesToPresentation(draftPresentation, imagesBySlide);
            const finalDocument = await executeNestedTool(context, DOCUMENT_WORKFLOW_TOOL_ID, {
              action: 'generate',
              prompt,
              documentType,
              format,
              tone,
              length,
              title: params.title || presentationWithImages.title,
              subtitle: params.subtitle || presentationWithImages.subtitle,
              audience: params.audience,
              style: params.style,
              theme,
              slideCount: params.slideCount || inferredSlideCount,
              generateImages: imagesBySlide.size < imageQueries.length,
              model: params.model || context.model || undefined,
              reasoningEffort: params.reasoningEffort || context.reasoningEffort || undefined,
              includeContent: params.includeContent === true,
              sources: groundedSources,
              presentation: presentationWithImages,
            });

            return {
              action: 'research_and_generate_presentation',
              recommendation,
              plan,
              researchPasses,
              sourceCount: groundedSources.length,
              sources: groundedSources,
              draftPresentation: {
                title: presentationWithImages.title,
                subtitle: presentationWithImages.subtitle,
                theme: presentationWithImages.theme,
                slideCount: Array.isArray(presentationWithImages.slides) ? presentationWithImages.slides.length : 0,
                slides: (Array.isArray(presentationWithImages.slides) ? presentationWithImages.slides : []).map((slide, index) => ({
                  index: index + 1,
                  layout: slide.layout,
                  title: slide.title,
                  imageUrl: slide.imageUrl || '',
                  imagePrompt: slide.imagePrompt || '',
                })),
              },
              imagePasses,
              verifiedImageCount: imagesBySlide.size,
              images: Array.from(imagesBySlide.entries()).map(([slideIndex, image]) => ({
                slideIndex,
                ...image,
              })),
              document: finalDocument?.document || null,
            };
          },
          sideEffects: ['write', 'network'],
          timeout: 180000,
        },
        inputSchema: {
          type: 'object',
          required: [],
          properties: {
            prompt: { type: 'string' },
            request: { type: 'string' },
            topic: { type: 'string' },
            documentType: { type: 'string' },
            format: { type: 'string' },
            tone: { type: 'string' },
            length: { type: 'string' },
            title: { type: 'string' },
            subtitle: { type: 'string' },
            audience: { type: 'string' },
            style: { type: 'string' },
            theme: { type: 'string' },
            slideCount: { type: 'integer' },
            model: { type: 'string' },
            reasoningEffort: { type: 'string' },
            includeContent: { type: 'boolean' },
            limit: { type: 'integer' },
            researchPasses: { type: 'integer' },
            researchQueries: { type: 'array' },
            searchLimit: { type: 'integer' },
            searchDomains: {
              type: 'array',
              items: { type: 'string' },
            },
            pagesPerPass: { type: 'integer' },
            imageLimit: { type: 'integer' },
            imageMode: { type: 'string', enum: ['auto', 'stock', 'generated'] },
            imageSettleDelayMs: { type: 'integer' },
            researchSafeScrape: { type: 'boolean' },
            timeRange: { type: 'string', enum: ['day', 'week', 'month', 'year', 'all'] },
          },
          additionalProperties: false,
        },
        skill: {
          triggerPatterns: [
            'deep research presentation',
            'deep research deck',
            'research-backed presentation',
            'research-backed slide deck',
            'research slides',
            'research deck',
          ],
          requiresConfirmation: false,
        },
        frontend: {
          exposeToFrontend: false,
          icon: 'presentation',
        },
      }
    ];

    const mediaTools = [
      {
        id: 'image-generate',
        name: 'Image Generator',
        category: 'system',
        description: 'Generate a single image by default, or up to 5 when the caller explicitly requests multiple distinct outputs, and return reusable hosted image URLs',
        backend: {
          handler: async (params, context = {}) => {
            const requestedCount = Math.min(Math.max(Number(params.n) || 1, 1), 5);
            const response = await generateImage({
              prompt: params.prompt,
              model: params.model || null,
              size: params.size || '1536x1024',
              quality: params.quality || 'standard',
              style: params.style || 'vivid',
              n: requestedCount,
            });
            const persistedImages = await persistGeneratedImages({
              sessionId: context?.sessionId || '',
              sourceMode: 'chat',
              prompt: params.prompt,
              model: response.model || params.model || null,
              images: response.data || [],
            });

            const images = (persistedImages.images || []).map((image, index) => ({
              url: image.url,
              b64_json: image.b64_json,
              revisedPrompt: image.revised_prompt,
              artifactId: image.artifactId || null,
              downloadUrl: image.downloadUrl || null,
              inlinePath: image.inlinePath || null,
              alt: params.alt || `${params.prompt} ${index + 1}`.trim(),
            }));

            return {
              source: 'generated',
              prompt: params.prompt,
              model: response.model,
              count: images.length,
              requestedCount,
              image: images[0] || null,
              images,
              artifacts: persistedImages.artifacts || [],
              artifactIds: (persistedImages.artifactIds || []).slice(),
              markdownImage: images[0]?.url
                ? `![${images[0].alt}](${images[0].url})`
                : null,
              markdownImages: images
                .filter((image) => image.url)
                .map((image) => `![${image.alt}](${image.url})`),
            };
          },
          sideEffects: ['network'],
          timeout: 60000,
        },
        inputSchema: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string' },
            alt: { type: 'string' },
            model: { type: 'string' },
            size: { type: 'string' },
            quality: { type: 'string' },
            style: { type: 'string' },
            n: {
              type: 'integer',
              minimum: 1,
              maximum: 5,
              description: 'Number of distinct images to return. Default to 1 and only set this above 1 when the user explicitly asks for multiple images.',
            },
          },
        },
        skill: {
          triggerPatterns: ['generate image', 'make an image', 'create image', 'hero image', 'illustration'],
          requiresConfirmation: false,
        },
        frontend: {
          exposeToFrontend: true,
          icon: 'image',
        },
      },
      {
        id: 'image-search-unsplash',
        name: 'Unsplash Image Search',
        category: 'system',
        description: 'Search Unsplash for up to 20 verified stock images and return reusable image URLs with attribution',
        backend: {
          handler: async (params) => {
            if (!isUnsplashConfigured()) {
              throw new Error('Unsplash integration is not configured. Set UNSPLASH_ACCESS_KEY.');
            }

            const results = await searchImages(params.query, {
              page: params.page || 1,
              perPage: Math.min(Math.max(params.perPage || 10, 1), MAX_VERIFIED_REFERENCE_IMAGES),
              orientation: params.orientation,
            });

            const images = (results.results || []).map((image) => ({
              id: image.id,
              url: image.urls?.regular || image.urls?.full || image.urls?.small,
              thumbUrl: image.urls?.thumb || image.urls?.small,
              alt: image.altDescription || image.description || params.query,
              author: image.author?.name || image.user?.name || '',
              authorLink: image.author?.link || image.user?.links?.html || '',
              unsplashLink: image.links?.html || '',
            }));

            return {
              source: 'unsplash',
              query: params.query,
              total: results.total,
              totalPages: results.totalPages,
              images,
              markdownImages: images
                .filter((image) => image.url)
                .map((image) => `![${image.alt}](${image.url})`),
            };
          },
          sideEffects: ['network'],
          timeout: 30000,
        },
        inputSchema: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string' },
            page: { type: 'integer', minimum: 1 },
            perPage: { type: 'integer', minimum: 1, maximum: MAX_VERIFIED_REFERENCE_IMAGES },
            orientation: { type: 'string', enum: ['landscape', 'portrait', 'squarish'] },
          },
        },
        skill: {
          triggerPatterns: ['unsplash', 'stock photo', 'reference image', 'image search', 'photo search'],
          requiresConfirmation: false,
        },
        frontend: {
          exposeToFrontend: true,
          icon: 'image-plus',
        },
      },
      {
        id: 'speech-generate',
        name: 'Speech Generator',
        category: 'system',
        description: 'Synthesize speech with Piper, save the audio into the active session, and return reusable artifact URLs for downstream agent work.',
        backend: {
          handler: async (params = {}, context = {}) => {
            const sessionId = String(context?.sessionId || '').trim();
            if (!sessionId) {
              throw new Error('speech-generate requires an active session so the audio can be saved.');
            }

            const requestedText = String(params.text || params.prompt || '').trim();
            if (!requestedText) {
              throw new Error('speech-generate requires a `text` string.');
            }

            const synthesis = await piperTtsService.synthesize({
              text: requestedText,
              voiceId: params.voiceId || '',
            });

            const persistedAudio = await persistGeneratedAudio({
              sessionId,
              sourceMode: String(context?.clientSurface || context?.taskType || 'chat').trim() || 'chat',
              text: synthesis.text,
              title: params.title || '',
              filename: params.filename || '',
              provider: synthesis.voice?.provider || 'piper',
              voice: synthesis.voice || null,
              audioBuffer: synthesis.audioBuffer,
              mimeType: synthesis.contentType || 'audio/wav',
              metadata: {
                requestedText,
                createdByAgentTool: true,
              },
            });

            return {
              provider: synthesis.voice?.provider || 'piper',
              voice: synthesis.voice || null,
              text: synthesis.text,
              contentType: synthesis.contentType || 'audio/wav',
              artifact: persistedAudio.artifact || null,
              artifacts: persistedAudio.artifact ? [persistedAudio.artifact] : [],
              artifactIds: persistedAudio.artifactIds || [],
              audio: persistedAudio.audio || null,
            };
          },
          sideEffects: ['write', 'execute'],
          timeout: 60000,
        },
        inputSchema: {
          type: 'object',
          required: ['text'],
          properties: {
            text: { type: 'string' },
            prompt: { type: 'string' },
            title: { type: 'string' },
            filename: { type: 'string' },
            voiceId: { type: 'string' },
          },
          additionalProperties: false,
        },
        skill: {
          triggerPatterns: ['text to speech', 'tts', 'narration', 'voiceover', 'read aloud', 'save audio', 'piper'],
          requiresConfirmation: false,
        },
        frontend: {
          exposeToFrontend: false,
          icon: 'volume-2',
        },
      },
      {
        id: 'podcast',
        name: 'Podcast',
        category: 'system',
        description: 'Research a topic, script a two-host episode, synthesize both voices with Piper, and stitch the final podcast audio into a saved artifact.',
        backend: {
          handler: async (params = {}, context = {}) => {
            const service = resolvePodcastService(context);
            return service.createPodcast(params, context);
          },
          sideEffects: ['write', 'execute', 'network'],
          timeout: 900000,
        },
        inputSchema: {
          type: 'object',
          required: ['topic'],
          properties: {
            topic: { type: 'string' },
            prompt: { type: 'string' },
            subject: { type: 'string' },
            title: { type: 'string' },
            filename: { type: 'string' },
            durationMinutes: { type: 'integer', minimum: 3, maximum: 30 },
            audience: { type: 'string' },
            tone: { type: 'string' },
            hostAName: { type: 'string' },
            hostARole: { type: 'string' },
            hostAPersona: { type: 'string' },
            hostAVoiceId: { type: 'string' },
            hostAVoiceIds: {
              type: 'array',
              items: { type: 'string' },
            },
            hostBName: { type: 'string' },
            hostBRole: { type: 'string' },
            hostBPersona: { type: 'string' },
            hostBVoiceId: { type: 'string' },
            hostBVoiceIds: {
              type: 'array',
              items: { type: 'string' },
            },
            cycleHostVoices: { type: 'boolean' },
            sourceUrls: {
              type: 'array',
              items: { type: 'string' },
            },
            searchDomains: {
              type: 'array',
              items: { type: 'string' },
            },
            maxSources: { type: 'integer', minimum: 2, maximum: 6 },
            pauseMs: { type: 'integer', minimum: 100, maximum: 1200 },
            includeIntro: { type: 'boolean' },
            includeOutro: { type: 'boolean' },
            includeMusicBed: { type: 'boolean' },
            introPath: { type: 'string' },
            outroPath: { type: 'string' },
            musicBedPath: { type: 'string' },
            speechVolume: { type: 'number' },
            musicVolume: { type: 'number' },
            introVolume: { type: 'number' },
            outroVolume: { type: 'number' },
            enhanceSpeech: { type: 'boolean' },
            exportMp3: { type: 'boolean' },
            outputFormat: { type: 'string' },
            mp3BitrateKbps: { type: 'integer', minimum: 64, maximum: 320 },
            model: { type: 'string' },
            reasoningEffort: { type: 'string' },
            scriptTimeoutMs: { type: 'integer', minimum: 30000, maximum: 900000 },
            ttsTimeoutMs: { type: 'integer', minimum: 1000, maximum: 900000 },
            ttsChunkMaxChars: { type: 'integer', minimum: 250, maximum: 2400 },
            ttsConcurrency: { type: 'integer', minimum: 1, maximum: 24 },
            researchConcurrency: { type: 'integer', minimum: 1, maximum: 12 },
          },
          additionalProperties: false,
        },
        skill: {
          triggerPatterns: [
            'podcast',
            'podcast episode',
            'two host podcast',
            'research and script audio',
            'two agent voices',
            'podcast conversation',
          ],
          requiresConfirmation: false,
        },
        frontend: {
          exposeToFrontend: false,
          icon: 'mic',
        },
      },
      {
        id: 'image-from-url',
        name: 'Image URL Reference',
        category: 'system',
        description: 'Validate, verify, and normalize up to 20 direct image URLs so they can be saved and reused in document output',
        backend: {
          handler: async (params) => {
            const urlCandidates = [
              ...(Array.isArray(params.urls) ? params.urls : []),
              ...(params.url ? [params.url] : []),
            ];
            const normalizedUrls = urlCandidates
              .map((value) => {
                try {
                  return normalizeCandidateUrl(value);
                } catch (_error) {
                  return null;
                }
              })
              .filter((value, index, array) => value && array.indexOf(value) === index)
              .slice(0, MAX_VERIFIED_REFERENCE_IMAGES);

            if (normalizedUrls.length === 0) {
              throw new Error('Provide a direct image `url` or up to 20 image `urls`.');
            }

            const results = await Promise.allSettled(normalizedUrls.map(async (candidateUrl, index) => {
              const parsed = new URL(candidateUrl);
              if (!['http:', 'https:'].includes(parsed.protocol)) {
                throw new Error('Only http and https image URLs are supported.');
              }

              const verified = await verifyDirectImageUrl(parsed.toString());
              const alt = Array.isArray(params.alts) && typeof params.alts[index] === 'string'
                ? params.alts[index]
                : (params.alt || deriveImageAltText(verified.url, 'image'));

              return {
                url: verified.url,
                alt,
                title: params.title || '',
                host: new URL(verified.url).host,
                mimeType: verified.mimeType,
                verified: true,
                verificationMethod: verified.verificationMethod,
              };
            }));

            const images = [];
            const rejected = [];
            results.forEach((result, index) => {
              if (result.status === 'fulfilled') {
                images.push(result.value);
                return;
              }

              rejected.push({
                inputIndex: index + 1,
                error: result.reason?.message || 'Image verification failed.',
              });
            });

            if (images.length === 0) {
              throw new Error(rejected[0]?.error || 'Image verification failed.');
            }

            const primaryImage = images[0];
            return {
              source: 'url',
              verified: true,
              verifiedCount: images.length,
              image: primaryImage,
              images,
              rejected,
              normalizedUrl: primaryImage.url,
              markdownImage: `![${primaryImage.alt}](${primaryImage.url})`,
              markdownImages: images.map((image) => `![${image.alt}](${image.url})`),
            };
          },
          sideEffects: ['network'],
          timeout: 30000,
        },
        inputSchema: {
          type: 'object',
          required: [],
          properties: {
            url: { type: 'string' },
            urls: {
              type: 'array',
              description: 'Optional batch of up to 20 direct image URLs to verify and normalize in one call.',
            },
            alt: { type: 'string' },
            alts: {
              type: 'array',
              description: 'Optional alt-text array matching the order of `urls`.',
            },
            title: { type: 'string' },
          },
        },
        skill: {
          triggerPatterns: ['image url', 'use this image', 'embed image', 'reference image url'],
          requiresConfirmation: false,
        },
        frontend: {
          exposeToFrontend: true,
          icon: 'link',
        },
      },
    ];

    const workloadTools = [
      {
        id: 'agent-delegate',
        name: 'Sub-Agent Orchestrator',
        category: 'system',
        description: 'Spawn and track up to 3 bounded sub-agents for long-running background work in the current conversation. Sub-agents inherit the caller model, cannot spawn more sub-agents, and should use distinct write targets when they modify files.',
        backend: {
          handler: async (params = {}, context = {}) => {
            const { service, ownerId, sessionId } = resolveSessionWorkloadService(context);
            const action = normalizeWorkloadAction(params.action || 'spawn');

            if (action === 'spawn') {
              const orchestration = await service.spawnSubAgents(params, ownerId, {
                sessionId,
                model: context?.model || null,
                parentRunId: context?.runId || context?.parentRunId || null,
                subAgentDepth: context?.subAgentDepth || 0,
              });

              return {
                action,
                sessionId,
                orchestration,
                message: `Queued ${orchestration.taskCount} sub-agent task${orchestration.taskCount === 1 ? '' : 's'} in ${orchestration.orchestrationId}.`,
              };
            }

            if (action === 'status') {
              const orchestrationId = String(
                params.orchestrationId
                || params.orchestration_id
                || params.id
                || '',
              ).trim();
              if (!orchestrationId) {
                throw new Error('agent-delegate status requires an `orchestrationId`.');
              }

              const orchestration = await service.getSubAgentOrchestration(orchestrationId, ownerId, sessionId);
              if (!orchestration) {
                throw new Error('Sub-agent orchestration not found.');
              }

              return {
                action,
                sessionId,
                orchestration,
              };
            }

            if (action === 'list') {
              const orchestrations = await service.listSubAgentOrchestrations(sessionId, ownerId);
              return {
                action,
                sessionId,
                count: orchestrations.length,
                orchestrations,
              };
            }

            throw new Error(`Unsupported agent-delegate action: ${action}`);
          },
          sideEffects: ['write'],
          timeout: 15000,
        },
        inputSchema: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['spawn', 'status', 'list'],
            },
            title: { type: 'string' },
            name: { type: 'string' },
            orchestrationId: { type: 'string' },
            orchestration_id: { type: 'string' },
            maxRetries: { type: 'integer' },
            task: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                name: { type: 'string' },
                prompt: { type: 'string' },
                objective: { type: 'string' },
                request: { type: 'string' },
                mode: { type: 'string' },
                toolIds: {
                  type: 'array',
                  items: { type: 'string' },
                },
                executionProfile: { type: 'string' },
                execution_profile: { type: 'string' },
                allowSideEffects: { type: 'boolean' },
                maxRounds: { type: 'integer' },
                maxToolCalls: { type: 'integer' },
                maxDurationMs: { type: 'integer' },
                maxRetries: { type: 'integer' },
                lockKey: { type: 'string' },
                lock_key: { type: 'string' },
                writeTargets: {
                  type: 'array',
                  items: { type: 'string' },
                },
                write_targets: {
                  type: 'array',
                  items: { type: 'string' },
                },
                outputPath: { type: 'string' },
                output_path: { type: 'string' },
                targetPath: { type: 'string' },
                target_path: { type: 'string' },
                path: { type: 'string' },
                execution: { type: 'object' },
                metadata: { type: 'object' },
              },
              additionalProperties: false,
            },
            tasks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  name: { type: 'string' },
                  prompt: { type: 'string' },
                  objective: { type: 'string' },
                  request: { type: 'string' },
                  mode: { type: 'string' },
                  toolIds: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  executionProfile: { type: 'string' },
                  execution_profile: { type: 'string' },
                  allowSideEffects: { type: 'boolean' },
                  maxRounds: { type: 'integer' },
                  maxToolCalls: { type: 'integer' },
                  maxDurationMs: { type: 'integer' },
                  maxRetries: { type: 'integer' },
                  lockKey: { type: 'string' },
                  lock_key: { type: 'string' },
                  writeTargets: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  write_targets: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  outputPath: { type: 'string' },
                  output_path: { type: 'string' },
                  targetPath: { type: 'string' },
                  target_path: { type: 'string' },
                  path: { type: 'string' },
                  execution: { type: 'object' },
                  metadata: { type: 'object' },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
        skill: {
          triggerPatterns: [
            'sub-agent',
            'sub agent',
            'delegate task',
            'parallel task',
            'spawn worker',
          ],
          requiresConfirmation: false,
        },
        frontend: {
          exposeToFrontend: false,
          icon: 'layers',
        },
      },
      {
        id: 'agent-workload',
        name: 'Agent Workload Manager',
        category: 'system',
        description: 'Create and manage deferred agent workloads for later, recurring, and follow-up work tied to the current conversation session. For scheduled requests, pass the full user request and let the runtime extract the schedule and remote command details.',
        backend: {
          handler: async (params = {}, context = {}) => {
            const { service, ownerId, sessionId } = resolveSessionWorkloadService(context);
            const action = normalizeWorkloadAction(params.action);

            if (action === 'list') {
              const workloads = await service.listSessionWorkloads(sessionId, ownerId);
              return {
                action,
                sessionId,
                count: workloads.length,
                workloads,
              };
            }

            if (action === 'create_from_scenario') {
              const request = String(params.request || params.scenario || params.description || '').trim();
              const session = service.sessionStore?.getOwned
                ? await service.sessionStore.getOwned(sessionId, ownerId)
                : null;
              const normalized = buildNormalizedWorkloadPayload({
                ...params,
                ...(request ? { request } : {}),
              }, context, session);
              if (!normalized) {
                throw new Error('agent-workload create_from_scenario requires a `request` string or a structured workload payload.');
              }

              assertWorkloadSchedulingIntent(normalized.payload, context);

              const workload = await service.createWorkload(applyWorkloadExecutionPreferences({
                ...normalized.payload,
                sessionId,
              }, params, context), ownerId);

              return {
                action,
                sessionId,
                workload,
                scenario: normalized.scenario,
                message: `${workload.title} created. ${summarizeTrigger(workload.trigger || {})}.`,
              };
            }

            if (action === 'create') {
              const session = service.sessionStore?.getOwned
                ? await service.sessionStore.getOwned(sessionId, ownerId)
                : null;
              const normalized = buildNormalizedWorkloadPayload(params, context, session);
              const payload = normalized?.payload || params;
              assertWorkloadSchedulingIntent(payload, context);
              const workload = await service.createWorkload(applyWorkloadExecutionPreferences({
                ...payload,
                sessionId,
              }, params, context), ownerId);
              return {
                action,
                sessionId,
                workload,
                message: `${workload.title} created. ${summarizeTrigger(workload.trigger || {})}.`,
              };
            }

            if (action === 'run_now') {
              const run = await service.runWorkloadNow(
                params.idOrSlug || params.workloadId || params.callableSlug || '',
                ownerId,
                {
                  reason: 'manual',
                  metadata: params.metadata || {},
                },
              );
              if (!run) {
                throw new Error('Workload not found.');
              }

              return {
                action,
                sessionId,
                run,
                message: `Queued workload run ${run.id} for immediate execution.`,
              };
            }

            if (action === 'pause') {
              const workload = await service.pauseWorkload(
                params.idOrSlug || params.workloadId || params.callableSlug || '',
                ownerId,
              );
              if (!workload) {
                throw new Error('Workload not found.');
              }

              return {
                action,
                sessionId,
                workload,
                message: `${workload.title} paused.`,
              };
            }

            if (action === 'resume') {
              const workload = await service.resumeWorkload(
                params.idOrSlug || params.workloadId || params.callableSlug || '',
                ownerId,
              );
              if (!workload) {
                throw new Error('Workload not found.');
              }

              return {
                action,
                sessionId,
                workload,
                message: `${workload.title} resumed.`,
              };
            }

            if (action === 'delete') {
              const deleted = await service.deleteWorkload(
                params.idOrSlug || params.workloadId || params.callableSlug || '',
                ownerId,
              );
              if (!deleted) {
                throw new Error('Workload not found.');
              }

              return {
                action,
                sessionId,
                deleted: true,
                message: 'Workload deleted.',
              };
            }

            if (action === 'list_runs') {
              const workloadId = params.idOrSlug || params.workloadId || '';
              const runs = await service.listRunsForWorkload(
                workloadId,
                ownerId,
                Number.isFinite(Number(params.limit))
                  ? Math.max(1, Math.min(Number(params.limit), 100))
                  : 20,
              );

              return {
                action,
                sessionId,
                workloadId,
                count: runs.length,
                runs,
              };
            }

            if (action === 'get_project') {
              const workloadId = params.idOrSlug || params.workloadId || params.callableSlug || '';
              const project = await service.getProjectPlan(workloadId, ownerId);
              if (!project) {
                throw new Error('Project workload not found.');
              }

              return {
                action,
                sessionId,
                workloadId,
                project,
              };
            }

            if (action === 'update_project') {
              const workloadId = params.idOrSlug || params.workloadId || params.callableSlug || '';
              const updated = await service.updateProjectPlan(
                workloadId,
                ownerId,
                params.project || {},
                {
                  changeReason: params.changeReason || params.change_reason || null,
                },
              );
              if (!updated) {
                throw new Error('Project workload not found.');
              }

              return {
                action,
                sessionId,
                workloadId,
                workload: updated.workload,
                project: updated.project,
                message: 'Project plan updated.',
              };
            }

            throw new Error(`Unsupported agent-workload action: ${action}`);
          },
          sideEffects: ['write'],
          timeout: 15000,
        },
        inputSchema: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['create_from_scenario', 'create', 'list', 'run_now', 'pause', 'resume', 'delete', 'list_runs', 'get_project', 'update_project'],
            },
            request: { type: 'string' },
            scenario: { type: 'string' },
            description: { type: 'string' },
            title: { type: 'string' },
            prompt: { type: 'string' },
            execution: { type: 'object' },
            callableSlug: { type: 'string' },
            tool: { type: 'string' },
            command: { type: 'string' },
            schedule: { type: 'string' },
            mode: { type: 'string' },
            enabled: { type: 'boolean' },
            timezone: { type: 'string' },
            now: { type: 'string' },
            trigger: { type: 'object' },
            policy: { type: 'object' },
            stages: { type: 'array' },
            metadata: { type: 'object' },
            project: { type: 'object' },
            changeReason: { type: 'object' },
            host: { type: 'string' },
            username: { type: 'string' },
            port: { type: 'integer' },
            idOrSlug: { type: 'string' },
            workloadId: { type: 'string' },
            limit: { type: 'integer' },
          },
          additionalProperties: false,
        },
        skill: {
          triggerPatterns: [
            'schedule this for later',
            'set up a recurring agent',
            'create a daily workload',
            'follow up tomorrow',
            'run every weekday',
          ],
          requiresConfirmation: false,
        },
        frontend: {
          exposeToFrontend: false,
          icon: 'clock',
        },
      },
      {
        id: 'managed-app',
        name: 'Managed App Control Plane',
        category: 'system',
        description: 'Create, update, inspect, diagnose, reconcile, list, and deploy agent-created apps through the external Gitea control plane and the remote SSH/k3s deployment lane.',
        backend: {
          handler: async (params = {}, context = {}) => {
            const { service, ownerId, sessionId } = resolveManagedAppService(context);
            const action = String(params.action || '').trim().toLowerCase() || 'inspect';

            if (action === 'list') {
              const apps = await service.listApps(
                ownerId,
                Number.isFinite(Number(params.limit)) ? Number(params.limit) : 50,
              );
              return {
                action,
                count: apps.length,
                apps,
              };
            }

            if (action === 'inspect') {
              const result = await service.inspectApp(
                resolveManagedAppReference(params),
                ownerId,
              );
              if (!result) {
                throw new Error('Managed app not found.');
              }

              return {
                action,
                ...result,
              };
            }

            if (action === 'doctor') {
              const result = await service.doctorPlatform(
                params,
                ownerId,
                {
                  sessionId: params.sessionId || sessionId,
                  executionProfile: context?.executionProfile || '',
                },
              );

              return {
                action,
                ...result,
              };
            }

            if (action === 'reconcile') {
              const result = await service.reconcilePlatform(
                params,
                ownerId,
                {
                  sessionId: params.sessionId || sessionId,
                  executionProfile: context?.executionProfile || '',
                },
              );

              return {
                action,
                ...result,
              };
            }

            if (action === 'create') {
              return service.createApp({
                ...params,
                sessionId: params.sessionId || sessionId,
              }, ownerId, {
                sessionId: params.sessionId || sessionId,
                model: context?.model || '',
                executionProfile: context?.executionProfile || '',
              });
            }

            if (action === 'update') {
              const result = await service.updateApp(
                resolveManagedAppReference(params),
                {
                  ...params,
                  sessionId: params.sessionId || sessionId,
                },
                ownerId,
                {
                  sessionId: params.sessionId || sessionId,
                  model: context?.model || '',
                  executionProfile: context?.executionProfile || '',
                },
              );
              if (!result) {
                throw new Error('Managed app not found.');
              }
              return result;
            }

            if (action === 'deploy') {
              const result = await service.deployApp(
                resolveManagedAppReference(params),
                params,
                ownerId,
                {
                  sessionId: params.sessionId || sessionId,
                  executionProfile: context?.executionProfile || '',
                },
              );
              if (!result) {
                throw new Error('Managed app not found.');
              }
              return result;
            }

            throw new Error(`Unsupported managed-app action: ${action}`);
          },
          sideEffects: ['write', 'network'],
          timeout: 45000,
        },
        inputSchema: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['create', 'update', 'deploy', 'inspect', 'doctor', 'reconcile', 'list'],
            },
            appRef: { type: 'string' },
            app: { type: 'string' },
            id: { type: 'string' },
            slug: { type: 'string' },
            appName: { type: 'string' },
            name: { type: 'string' },
            title: { type: 'string' },
            prompt: { type: 'string' },
            sourcePrompt: { type: 'string' },
            requestedAction: { type: 'string' },
            deployRequested: { type: 'boolean' },
            deployTarget: { type: 'string', enum: ['ssh'] },
            deploymentTarget: { type: 'string', enum: ['ssh'] },
            target: { type: 'string', enum: ['ssh'] },
            imageTag: { type: 'string' },
            containerPort: { type: 'integer' },
            sessionId: { type: 'string' },
            limit: { type: 'integer' },
            platformNamespace: { type: 'string' },
            runnerScope: { type: 'string', enum: ['org', 'instance', 'repo'] },
            runnerLabels: { type: 'string' },
            runnerReplicas: { type: 'integer' },
            rotateRunnerToken: { type: 'boolean' },
            giteaInstanceUrl: { type: 'string' },
            repoOwner: { type: 'string' },
            repoName: { type: 'string' },
            metadata: { type: 'object' },
            files: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                  content: { type: 'string' },
                },
                required: ['path', 'content'],
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
        skill: {
          triggerPatterns: [
            'managed app',
            'create and deploy app',
            'build and deploy website',
            'deploy generated app',
            'publish this app to the cluster',
            'list managed apps',
            'managed app doctor',
            'gitea actions waiting',
            'gitea runner',
            'buildkit',
            'why are actions waiting',
            'repair gitea runner',
            'fix queued actions',
            'reconcile managed app platform',
          ],
          requiresConfirmation: false,
        },
        frontend: {
          exposeToFrontend: false,
          icon: 'rocket',
        },
      },
    ];

    const opencodeTools = [
      {
        id: 'opencode-run',
        name: 'OpenCode Run',
        category: 'system',
        description: 'Run long-form repository work through the managed OpenCode runtime using the configured KimiBuilt OpenAI-compatible gateway and model catalog.',
        backend: {
          handler: async (params = {}, context = {}) => {
            const service = resolveOpenCodeService(context);
            const requestedModel = String(params?.model || context?.model || '').trim();
            const effectiveParams = requestedModel && !String(params?.model || '').trim()
              ? {
                ...params,
                model: requestedModel,
              }
              : params;
            return service.runTool(effectiveParams, {
              ownerId: context?.ownerId || context?.userId || null,
              userId: context?.userId || context?.ownerId || null,
              sessionId: params.sessionId || context?.sessionId || null,
            });
          },
          sideEffects: ['write', 'execute'],
          timeout: 30000,
        },
        inputSchema: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string' },
            message: { type: 'string' },
            workspacePath: { type: 'string' },
            target: {
              type: 'string',
              enum: ['local', 'remote-default'],
            },
            sessionId: { type: 'string' },
            opencodeSessionId: { type: 'string' },
            agent: { type: 'string' },
            model: { type: 'string' },
            async: { type: 'boolean' },
            approvalMode: {
              type: 'string',
              enum: ['manual', 'auto'],
            },
            metadata: { type: 'object' },
          },
          additionalProperties: false,
        },
        skill: {
          triggerPatterns: [
            'use opencode',
            'run opencode',
            'implement in this repo',
            'fix this repo',
            'refactor this codebase',
            'build this project',
            'test this repo',
            'long form repo work',
          ],
          requiresConfirmation: false,
        },
        frontend: {
          exposeToFrontend: true,
          icon: 'wrench',
        },
      },
    ];

    const interactionTools = [
      {
        id: USER_CHECKPOINT_TOOL_ID,
        name: 'User Checkpoint',
        category: 'system',
        description: 'Primary quick user-involvement path for web chat: use a lightweight checkpoint card for a high-impact decision or a short structured questionnaire before or during major work. Keep it to one checkpoint card with one visible step at a time. Supports choice, multi-choice, text, date, time, and datetime prompts. Use this instead of `request_user_input`.',
        backend: {
          handler: async (params = {}, context = {}) => {
            const policy = context?.userCheckpointPolicy || {};
            const hasPendingCheckpoint = Boolean(policy?.pending?.id);
            const remainingQuestions = Number(policy?.remaining ?? 0);

            if (hasPendingCheckpoint) {
              throw new Error('A user checkpoint is already pending in this session.');
            }

            if (policy?.enabled !== true) {
              throw new Error('User checkpoints are only available in the web chat surface.');
            }

            if (remainingQuestions <= 0) {
              throw new Error('No checkpoint questions remain in this session. Continue with the best reasonable assumption.');
            }

            const checkpoint = normalizeCheckpointRequest(params);
            return {
              checkpoint,
              message: buildUserCheckpointMessage(checkpoint),
            };
          },
          sideEffects: [],
          timeout: 5000,
        },
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            preamble: { type: 'string' },
            question: { type: 'string' },
            prompt: { type: 'string' },
            ask: { type: 'string' },
            message: { type: 'string' },
            whyThisMatters: { type: 'string' },
            context: { type: 'string' },
            rationale: { type: 'string' },
            inputType: { type: 'string' },
            type: { type: 'string' },
            kind: { type: 'string' },
            placeholder: { type: 'string' },
            inputPlaceholder: { type: 'string' },
            freeTextPlaceholder: { type: 'string' },
            allowMultiple: { type: 'boolean' },
            multiple: { type: 'boolean' },
            maxSelections: { type: 'integer' },
            allowFreeText: { type: 'boolean' },
            allowText: { type: 'boolean' },
            freeTextLabel: { type: 'string' },
            options: {
              type: 'array',
              minItems: 2,
              maxItems: 5,
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  label: { type: 'string' },
                  description: { type: 'string' },
                },
                required: ['label'],
                additionalProperties: false,
              },
            },
            choices: {
              type: 'array',
              minItems: 2,
              maxItems: 5,
              items: {
                oneOf: [
                  { type: 'string' },
                  {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      label: { type: 'string' },
                      title: { type: 'string' },
                      text: { type: 'string' },
                      description: { type: 'string' },
                      details: { type: 'string' },
                    },
                    additionalProperties: false,
                  },
                ],
              },
            },
            steps: {
              type: 'array',
              minItems: 1,
              maxItems: 6,
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  question: { type: 'string' },
                  prompt: { type: 'string' },
                  ask: { type: 'string' },
                  inputType: { type: 'string' },
                  type: { type: 'string' },
                  kind: { type: 'string' },
                  placeholder: { type: 'string' },
                  inputPlaceholder: { type: 'string' },
                  freeTextPlaceholder: { type: 'string' },
                  required: { type: 'boolean' },
                  allowMultiple: { type: 'boolean' },
                  multiple: { type: 'boolean' },
                  maxSelections: { type: 'integer' },
                  allowFreeText: { type: 'boolean' },
                  allowText: { type: 'boolean' },
                  freeTextLabel: { type: 'string' },
                  options: {
                    type: 'array',
                    minItems: 2,
                    maxItems: 5,
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        label: { type: 'string' },
                        description: { type: 'string' },
                      },
                      required: ['label'],
                      additionalProperties: false,
                    },
                  },
                  choices: {
                    type: 'array',
                    minItems: 2,
                    maxItems: 5,
                    items: {
                      oneOf: [
                        { type: 'string' },
                        {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            label: { type: 'string' },
                            title: { type: 'string' },
                            text: { type: 'string' },
                            description: { type: 'string' },
                            details: { type: 'string' },
                          },
                          additionalProperties: false,
                        },
                      ],
                    },
                  },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
        skill: {
          triggerPatterns: ['clarify before major work', 'ask a checkpoint question', 'multiple choice question', 'questionnaire tool', 'questionaire', 'survey tool', 'test the questionnaire tool', 'quick user choice', 'quick checkpoint', 'involve the user quickly', 'ask me a survey', 'inline survey', 'survey card', 'checkpoint card', 'open ended question', 'time based question', 'questionnaire intake'],
          requiresConfirmation: false,
        },
        frontend: {
          exposeToFrontend: false,
          icon: 'list-checks',
        },
      },
    ];

    const systemToolInstances = [
      new GitLocalTool(),
    ];

    // Register all system tools
    [...fileTools, ...codeTools, ...docsTools, ...mediaTools, ...workloadTools, ...opencodeTools, ...interactionTools].forEach(def => {
      this.registry.register({
        ...def,
        version: '1.0.0',
        skill: def.skill || {
          triggerPatterns: [def.name.toLowerCase(), def.id.replace(/-/g, ' ')],
          autoApply: false
        },
        frontend: def.frontend || {
          exposeToFrontend: true,
          icon: 'settings'
        }
      });
    });

    systemToolInstances.forEach((tool) => {
      const definition = this.createToolDefinition(tool, {
        frontend: {
          exposeToFrontend: true,
          icon: tool.id === 'git-safe' ? 'git-branch' : 'settings',
        },
        skill: {
          triggerPatterns: [tool.name.toLowerCase(), tool.id.replace(/-/g, ' ')],
          requiresConfirmation: tool.id !== 'git-safe',
        },
      });

      this.registry.register(definition);
      this.loadedTools.set(tool.id, tool);
    });

    console.log('[ToolManager] System tools registered');
  }

  /**
   * Create tool definition with defaults
   */
  normalizeSkillTriggerPatterns(values = []) {
    return Array.from(new Set(
      (Array.isArray(values) ? values : [values])
        .map((value) => String(value || '')
          .trim()
          .toLowerCase()
          .replace(/[_-]+/g, ' ')
          .replace(/\s+/g, ' '))
        .filter(Boolean),
    ));
  }

  inferToolRequiresConfirmation(tool) {
    const sideEffects = new Set(
      Array.isArray(tool?.sideEffects)
        ? tool.sideEffects.map((effect) => String(effect || '').toLowerCase())
        : [],
    );
    const category = String(tool?.category || '').toLowerCase();

    return sideEffects.has('write')
      || sideEffects.has('execute')
      || category === 'ssh'
      || category === 'database';
  }

  createToolDefinition(tool, overrides = {}) {
    const base = tool.toDefinition();
    const defaultTriggerPatterns = this.normalizeSkillTriggerPatterns([
      tool.name,
      tool.id,
      tool.id ? tool.id.replace(/[-_]+/g, ' ') : '',
    ]);
    
    return {
      ...base,
      skill: {
        triggerPatterns: defaultTriggerPatterns,
        autoApply: false,
        requiresConfirmation: this.inferToolRequiresConfirmation(tool),
        ...overrides.skill
      },
      frontend: {
        exposeToFrontend: true,
        icon: 'tool',
        ...overrides.frontend
      }
    };
  }

  /**
   * Get trigger patterns for SSH tools
   */
  getSSHTriggerPatterns(toolId) {
    const patterns = {
      'ssh-execute': [
        'ssh',
        'bash',
        'shell',
        'remote command',
        'execute on server',
        'run on host',
        'run bash remotely',
      ],
      'remote-command': [
        'remote command',
        'run remotely',
        'execute remotely',
        'ssh',
        'kubectl',
        'k3s',
        'k8s',
        'rancher',
        'journalctl',
        'systemctl',
        'ingress',
        'deployment logs',
      ],
      'docker-exec': ['docker', 'container', 'run in container', 'docker exec'],
      'k3s-deploy': [
        'k3s deploy',
        'deploy to k3s',
        'kubectl apply',
        'rollout status',
        'set image',
        'sync repo to cluster',
        'apply manifests',
        'cluster rollout',
      ],
    };
    return patterns[toolId] || [toolId];
  }

  /**
   * Set up event listeners
   */
  setupEventListeners() {
    // Listen for tool invocations
    this.registry.on('tool:registered', ({ id }) => {
      console.log(`[ToolManager] Tool registered: ${id}`);
    });

    // Listen for skill updates
    this.registry.on('skill:updated', ({ id, skill }) => {
      console.log(`[ToolManager] Skill updated: ${id} (enabled: ${skill.enabled})`);
    });
  }

  /**
   * Get a tool instance
   */
  getTool(id) {
    return this.loadedTools.get(id) || this.registry.getTool(id);
  }

  /**
   * Execute a tool
   */
  async executeTool(id, params, context = {}) {
    const tool = this.getTool(id);
    
    if (!tool) {
      throw new Error(`Tool not found: ${id}`);
    }

    // Check if skill is enabled
    const skill = this.registry.getSkill(id);
    if (skill && !skill.enabled) {
      throw new Error(`Tool ${id} is disabled`);
    }

    const normalizedParams = id === 'file-write'
      ? normalizeFileWriteParams(params)
      : params;
    const effectiveContext = context?.toolManager
      ? context
      : { ...context, toolManager: this };

    // Execute either a ToolBase instance or a registry definition.
    let result;
    if (typeof tool.execute === 'function') {
      result = await tool.execute(normalizedParams, effectiveContext);
    } else if (typeof tool.backend?.handler === 'function') {
      const startedAt = Date.now();
      try {
        const data = await tool.backend.handler(normalizedParams, effectiveContext);
        result = {
          success: true,
          data,
          duration: Date.now() - startedAt,
          toolId: id,
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        result = {
          success: false,
          error: error.message,
          duration: Date.now() - startedAt,
          toolId: id,
          timestamp: new Date().toISOString(),
        };
      }
    } else {
      throw new Error(`Tool ${id} has no executable handler`);
    }
    
    // Record stats
    this.registry.recordInvocation(id, result, {
      ...effectiveContext,
      params: normalizedParams,
    });
    
    return result;
  }

  /**
   * Get all available tools for frontend
   */
  getFrontendTools() {
    return this.registry.getFrontendTools();
  }

  /**
   * Get all skills for admin
   */
  getAdminSkills() {
    return this.registry.getAllSkills();
  }

  /**
   * Get registry stats
   */
  getStats() {
    return {
      tools: this.registry.getAllTools().length,
      skills: this.registry.getAllSkills().length,
      categories: this.registry.getCategories(),
      byCategory: this.registry.getCategories().map(cat => ({
        name: cat,
        count: this.registry.getToolsByCategory(cat).length
      }))
    };
  }
}

// Singleton
let instance = null;

function getToolManager() {
  if (!instance) {
    instance = new ToolManager();
  }
  return instance;
}

module.exports = { ToolManager, getToolManager };
