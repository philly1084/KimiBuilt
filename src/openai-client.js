const OpenAI = require('openai');
const { config } = require('./config');
const settingsController = require('./routes/admin/settings.controller');
const { PROMOTED_LOCAL_TOOL_IDS } = require('./tool-execution-profiles');

let chatClient = null;

const IMAGE_MODEL_KEYWORDS = [
    'gemini',
    'image-generation',
    'gpt-image',
    'dall-e',
    'flux',
    'sdxl',
    'stable-diffusion',
    'diffusion',
    'recraft',
    'ideogram',
    'midjourney',
    'imagen',
    'image-gen',
    'text-to-image',
];

const OFFICIAL_OPENAI_IMAGE_MODELS = [
    'gpt-image-1.5',
    'gpt-image-1-mini',
    'gpt-image-1',
];

function getClient() {
    if (!chatClient) {
        chatClient = new OpenAI({
            apiKey: config.openai.apiKey,
            baseURL: config.openai.baseURL,
        });
    }
    return chatClient;
}

function normalizeModelId(modelId = '') {
    return String(modelId || '').trim();
}

function shouldUseResponsesAPI() {
    try {
        const parsed = new URL(String(config.openai.baseURL || 'https://api.openai.com/v1'));
        return /(^|\.)openai\.com$/i.test(parsed.hostname);
    } catch (_error) {
        return false;
    }
}

const AUTO_TOOL_ALLOWLIST = new Set([
    'web-fetch',
    'web-search',
    'web-scrape',
    'image-generate',
    'image-search-unsplash',
    'image-from-url',
    'file-read',
    'file-write',
    'file-search',
    'file-mkdir',
    'git-safe',
    'ssh-execute',
    'remote-command',
    'k3s-deploy',
    'docker-exec',
    'code-sandbox',
    'security-scan',
    ...PROMOTED_LOCAL_TOOL_IDS,
    'tool-doc-read',
]);

const AUTO_TOOL_MAX_ROUNDS = 6;
const SYNTHETIC_STREAM_CHUNK_SIZE = 120;
const TERMINAL_FINISH_REASONS = new Set(['stop', 'length', 'content_filter']);

class ToolOrchestrationError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = 'ToolOrchestrationError';
        this.code = 'tool_orchestration_failed';
        this.status = 502;
        this.statusCode = 502;
        this.model = options.model || null;
        this.cause = options.cause || null;
    }
}

function hasDedicatedMediaConfig() {
    return Boolean(normalizeModelId(config.media.apiKey));
}

function getImageProviderConfig() {
    if (hasDedicatedMediaConfig()) {
        return {
            apiKey: config.media.apiKey,
            baseURL: config.media.baseURL,
            imageModel: config.media.imageModel,
            source: 'official-openai',
        };
    }

    return {
        apiKey: config.openai.apiKey,
        baseURL: config.openai.baseURL,
        imageModel: config.openai.imageModel,
        source: 'gateway',
    };
}

function isLikelyImageModel(model = {}) {
    const id = normalizeModelId(typeof model === 'string' ? model : model.id).toLowerCase();
    const owner = String(model.owned_by || '').toLowerCase();
    if (!id) return false;

    if (IMAGE_MODEL_KEYWORDS.some((keyword) => id.includes(keyword))) {
        return true;
    }

    return owner.includes('image');
}

function uniqueById(models = []) {
    const seen = new Set();
    return models.filter((model) => {
        const id = normalizeModelId(model.id);
        if (!id || seen.has(id)) {
            return false;
        }
        seen.add(id);
        return true;
    });
}

function sortImageModels(models = []) {
    const configured = normalizeModelId(getImageProviderConfig().imageModel);

    return [...models].sort((a, b) => {
        const aId = normalizeModelId(a.id);
        const bId = normalizeModelId(b.id);
        const aConfigured = configured && aId === configured ? 1 : 0;
        const bConfigured = configured && bId === configured ? 1 : 0;
        if (aConfigured !== bConfigured) {
            return bConfigured - aConfigured;
        }

        const aNb = /-nb$/i.test(aId) ? 1 : 0;
        const bNb = /-nb$/i.test(bId) ? 1 : 0;
        if (aNb !== bNb) {
            return bNb - aNb;
        }

        return aId.localeCompare(bId);
    });
}

function getImageModelMetadata(modelId, ownedBy = 'openai') {
    const normalized = normalizeModelId(modelId);
    const lower = normalized.toLowerCase();

    if (lower.includes('gemini')) {
        return {
            id: normalized,
            name: normalized,
            description: 'Gemini image generation via OpenAI-compatible gateway',
            owned_by: ownedBy,
            sizes: ['1024x1024'],
            qualities: [],
            styles: [],
            maxImages: 1,
        };
    }

    if (lower.includes('dall-e-3')) {
        return {
            id: normalized,
            name: normalized,
            description: 'High quality image generation',
            owned_by: ownedBy,
            sizes: ['1024x1024', '1024x1792', '1792x1024'],
            qualities: ['standard', 'hd'],
            styles: ['vivid', 'natural'],
            maxImages: 1,
        };
    }

    if (lower.includes('dall-e-2')) {
        return {
            id: normalized,
            name: normalized,
            description: 'Fast image generation',
            owned_by: ownedBy,
            sizes: ['256x256', '512x512', '1024x1024'],
            qualities: ['standard'],
            styles: [],
            maxImages: 10,
        };
    }

    if (lower.includes('gpt-image')) {
        return {
            id: normalized,
            name: normalized,
            description: 'Official OpenAI image generation',
            owned_by: ownedBy,
            sizes: ['1024x1024', '1536x1024', '1024x1536', 'auto'],
            qualities: ['low', 'medium', 'high', 'auto'],
            styles: [],
            maxImages: 10,
        };
    }

    return {
        id: normalized,
        name: normalized,
        description: 'Image generation model',
        owned_by: ownedBy,
        sizes: ['1024x1024'],
        qualities: [],
        styles: [],
        maxImages: 1,
    };
}

function toImageUrl(image = {}) {
    if (image.url) {
        return image.url;
    }
    if (image.b64_json) {
        return `data:image/png;base64,${image.b64_json}`;
    }
    return null;
}

function parseErrorMessage(errorBody, status) {
    try {
        const parsed = JSON.parse(errorBody);
        return parsed.error?.message || parsed.message || errorBody || `Image generation failed with HTTP ${status}`;
    } catch (_error) {
        return errorBody || `Image generation failed with HTTP ${status}`;
    }
}

async function postImageGeneration(params) {
    const imageProvider = getImageProviderConfig();
    const configuredBaseURL = String(imageProvider.baseURL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const candidateBaseURLs = [configuredBaseURL];

    if (/\/v1$/i.test(configuredBaseURL) && imageProvider.source !== 'official-openai') {
        candidateBaseURLs.push(configuredBaseURL.replace(/\/v1$/i, ''));
    }

    let lastError = null;

    for (const baseURL of candidateBaseURLs) {
        const response = await fetch(`${baseURL}/images/generations`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${imageProvider.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(params),
        });

        if (response.ok) {
            return response.json();
        }

        const errorBody = await response.text();
        const error = new Error(parseErrorMessage(errorBody, response.status));
        error.status = response.status;
        error.baseURL = baseURL;
        error.provider = imageProvider.source;
        lastError = error;

        if (response.status !== 404) {
            throw error;
        }
    }

    throw lastError || new Error('Image generation failed.');
}

async function listModels() {
    const openai = getClient();
    console.log(`[OpenAI] Fetching models from: ${config.openai.baseURL}`);

    try {
        const response = await openai.models.list();
        const models = response.data || [];
        console.log(`[OpenAI] Successfully fetched ${models.length} models`);

        if (models.length > 0) {
            console.log(`[OpenAI] Available models: ${models.map((model) => model.id).join(', ')}`);
        }

        return models;
    } catch (err) {
        console.error('[OpenAI] Failed to list models:', err.message);
        console.error('[OpenAI] Error details:', err.code, err.type);
        return [];
    }
}

function listOfficialImageModels() {
    const configured = normalizeModelId(getImageProviderConfig().imageModel);
    const modelIds = uniqueById(
        [configured, ...OFFICIAL_OPENAI_IMAGE_MODELS]
            .filter(Boolean)
            .map((modelId) => ({ id: modelId })),
    ).map((model) => getImageModelMetadata(model.id, 'openai'));

    return sortImageModels(modelIds);
}

async function listImageModels() {
    if (hasDedicatedMediaConfig()) {
        return listOfficialImageModels();
    }

    const discovered = uniqueById(
        (await listModels())
            .filter((model) => isLikelyImageModel(model))
            .map((model) => getImageModelMetadata(model.id, model.owned_by || 'openai')),
    );

    if (discovered.length > 0) {
        return sortImageModels(discovered);
    }

    return sortImageModels(uniqueById(
        [config.openai.imageModel]
            .filter(Boolean)
            .map((modelId) => getImageModelMetadata(modelId, 'openai')),
    ));
}

async function resolveImageModel(requestedModel = null) {
    const availableModels = await listImageModels();
    const requested = normalizeModelId(requestedModel);
    const configured = normalizeModelId(getImageProviderConfig().imageModel);

    if (requested) {
        const exactMatch = availableModels.find((model) => model.id === requested);
        if (exactMatch) {
            return { modelId: exactMatch.id, availableModels };
        }

        return { modelId: requested, availableModels };
    }

    if (configured) {
        const configuredMatch = availableModels.find((model) => model.id === configured);
        if (configuredMatch) {
            return { modelId: configuredMatch.id, availableModels };
        }

        return { modelId: configured, availableModels };
    }

    if (availableModels.length > 0) {
        return { modelId: availableModels[0].id, availableModels };
    }

    const message = hasDedicatedMediaConfig()
        ? 'No media image model is configured. Set OPENAI_MEDIA_IMAGE_MODEL.'
        : 'No image generation model is configured. Set OPENAI_IMAGE_MODEL or expose image models from the gateway.';
    const error = new Error(message);
    error.status = 503;
    throw error;
}

function normalizeMessageContent(content) {
    if (typeof content === 'string') {
        return content;
    }

    if (Array.isArray(content)) {
        return content
            .map((item) => {
                if (typeof item === 'string') {
                    return item;
                }

                if (item?.type === 'text') {
                    return item.text || '';
                }

                return item?.text || '';
            })
            .join('');
    }

    return '';
}

function buildMessages({
    input,
    instructions = null,
    contextMessages = [],
    recentMessages = [],
}) {
    const messages = [];
    const inputMessages = Array.isArray(input) ? input : null;
    const inputSystemMessages = inputMessages
        ? inputMessages
            .filter((entry) => entry?.role === 'system')
            .map((entry) => normalizeMessageContent(entry.content))
            .filter(Boolean)
        : [];
    const mergedInstructions = [instructions, ...inputSystemMessages]
        .filter(Boolean)
        .join('\n\n');

    if (mergedInstructions) {
        messages.push({
            role: 'system',
            content: mergedInstructions,
        });
    }

    if (contextMessages.length > 0) {
        messages.push({
            role: 'system',
            content: `[Supplemental recalled memory]\nUse this only as supporting context when it helps resolve references or recover older details.\n${contextMessages.join('\n---\n')}`,
        });
    }

    if (recentMessages.length > 0) {
        messages.push(...recentMessages
            .filter((entry) => ['user', 'assistant', 'system', 'tool'].includes(entry?.role))
            .map((entry) => ({
                role: entry.role,
                content: normalizeMessageContent(entry.content),
            }))
            .filter((entry) => entry.content));
    }

    if (typeof input === 'string') {
        messages.push({
            role: 'user',
            content: input,
        });
    } else if (inputMessages) {
        messages.push(...inputMessages.filter((entry) => entry?.role !== 'system'));
    } else {
        messages.push(input);
    }

    return messages;
}

function getLastUserText(messages = []) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role === 'user') {
            return normalizeMessageContent(messages[index].content);
        }
    }

    return '';
}

function normalizeTriggerPattern(pattern = '') {
    return String(pattern || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function promptMentionsPattern(prompt, pattern) {
    const normalizedPrompt = normalizeTriggerPattern(prompt);
    const normalizedPattern = normalizeTriggerPattern(pattern);
    if (!normalizedPrompt || !normalizedPattern) {
        return false;
    }

    return normalizedPrompt.includes(normalizedPattern);
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

function normalizeExecutionProfile(value = '') {
    const normalized = String(value || '').trim().toLowerCase();

    if ([
        'remote-build',
        'remote_builder',
        'remote-builder',
        'server-build',
        'server-builder',
        'software-builder',
    ].includes(normalized)) {
        return 'remote-build';
    }

    return 'default';
}

function promptHasExplicitSshIntent(prompt = '') {
    const normalizedPrompt = String(prompt || '').toLowerCase();

    if (!normalizedPrompt) {
        return false;
    }

    return /\bssh\b/i.test(normalizedPrompt)
        || /\b(remote host|remote server|remote machine)\b/i.test(normalizedPrompt)
        || /\b(remote command|run remotely|execute remotely)\b/i.test(normalizedPrompt)
        || /\b(login to|log into|ssh into|ssh to|connect to)\b/i.test(normalizedPrompt)
        || (/\b(run|execute|deploy|inspect|troubleshoot|check)\b/i.test(normalizedPrompt)
            && /\b(over ssh|via ssh)\b/i.test(normalizedPrompt));
}

function extractExplicitSshTarget(prompt = '') {
    const text = String(prompt || '').trim();
    if (!text) {
        return null;
    }

    const loginMatch = text.match(/\b([a-z_][a-z0-9._-]*)@((?:\d{1,3}\.){3}\d{1,3}|(?:[a-z0-9-]+\.)+[a-z]{2,}|[a-z0-9.-]+)(?::(\d+))?/i);
    if (loginMatch) {
        return {
            username: loginMatch[1],
            host: loginMatch[2],
            port: loginMatch[3] ? Number(loginMatch[3]) : undefined,
        };
    }

    const hostMatch = text.match(/\b(?:(?:host|server|machine)\s+)?((?:\d{1,3}\.){3}\d{1,3}|(?:[a-z0-9-]+\.)+[a-z]{2,})\b(?::(\d+))?/i);
    if (hostMatch) {
        return {
            host: hostMatch[1],
            port: hostMatch[2] ? Number(hostMatch[2]) : undefined,
        };
    }

    return null;
}

function extractRequestedSshCommand(prompt = '') {
    const text = String(prompt || '').trim();
    if (!text) {
        return null;
    }
    const normalized = text.toLowerCase();
    const hasInspectionIntent = /\b(check|inspect|verify|diagnose|debug|troubleshoot|status|state|health|healthy|look at|show|list|see what'?s wrong)\b/.test(normalized);

    const quotedCommandPatterns = [
        /\b(?:run|execute)\s+`([^`]+)`/i,
        /\b(?:run|execute)\s+"([^"]+)"/i,
        /\b(?:run|execute)\s+'([^']+)'/i,
    ];

    for (const pattern of quotedCommandPatterns) {
        const match = text.match(pattern);
        if (match?.[1]) {
            return match[1].trim();
        }
    }

    if (/\b(?:check|inspect|verify|look at)\b[\s\S]{0,40}\b(?:health|status)\b/i.test(text)
        || /\bhealth check\b/i.test(text)) {
        return 'hostname && uptime && (df -h / || true) && (free -m || true)';
    }

    if (hasInspectionIntent && /\b(?:namespace|namespaces)\b/i.test(text) && /\b(kubernetes|k8s|cluster|kubectl)\b/i.test(text)) {
        return 'kubectl get namespaces';
    }

    if (hasInspectionIntent && /\b(?:pod|pods)\b/i.test(text) && /\b(kubernetes|k8s|cluster|kubectl)\b/i.test(text)) {
        return 'kubectl get pods -A';
    }

    return null;
}

function hasExplicitLocalArtifactReference(prompt = '') {
    const source = String(prompt || '').trim();
    if (!source) {
        return false;
    }

    const normalized = source.toLowerCase();
    return /\b(attached artifact|uploaded artifact|local artifact|local file|local html|workspace|repo|repository|on the drive|from the drive|on disk|from disk|readable path|file path)\b/.test(normalized)
        || /[a-z]:\\[^"'`\s]+/i.test(source);
}

function hasRemoteWebsiteUpdateIntent(prompt = '') {
    const normalized = String(prompt || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    const hasWebsiteTarget = /\b(website|web site|webpage|web page|landing page|homepage|home page|site|html|index\.html|page)\b/.test(normalized);
    const hasRemoteTarget = /\b(remote|server|cluster|k3s|k8s|kubernetes|kubectl|pod|deployment|deployed|workload|rollout|restart|redeploy|configmap|container|ingress|live|public|production|hosted|online)\b/.test(normalized);
    const hasWriteIntent = /\b(write|replace|overwrite|update|edit|change|deploy|redeploy|restart|publish|push|apply|rollout|create|generate|make)\b/.test(normalized);

    return hasWebsiteTarget && hasRemoteTarget && hasWriteIntent;
}

function hasInternalArtifactReference(prompt = '') {
    const source = String(prompt || '').trim();
    if (!source) {
        return false;
    }

    return /(?:^|[\s(])\/api\/artifacts\/[a-f0-9-]+\/download\b/i.test(source)
        || /(?:^|[\s(])api\/artifacts\/[a-f0-9-]+\/download\b/i.test(source)
        || /https?:\/\/api\/artifacts\/[a-f0-9-]+\/download\b/i.test(source)
        || /https?:\/\/[^/\s]+\/api\/artifacts\/[a-f0-9-]+\/download\b/i.test(source);
}

function shouldAutoUseTool(toolId, prompt = '', skill = null, options = {}) {
    const executionProfile = normalizeExecutionProfile(
        options?.executionProfile
        || options?.toolContext?.executionProfile,
    );

    if (toolId === 'k3s-deploy') {
        return hasUsableSshDefaults()
            && (executionProfile === 'remote-build' || /\b(k3s|kubernetes|kubectl|deployment|rollout|manifest|helm)\b/i.test(prompt));
    }

    if (toolId === 'ssh-execute' || toolId === 'remote-command') {
        return promptHasExplicitSshIntent(prompt)
            || (executionProfile === 'remote-build' && hasUsableSshDefaults());
    }
    return true;
}

function hasExplicitGitIntent(prompt = '') {
    const text = String(prompt || '').trim();
    if (!text) {
        return false;
    }

    return /\b(git|github)\b[\s\S]{0,80}\b(status|diff|branch|stage|add|commit|push|save and push|save-and-push)\b/i.test(text)
        || /\b(status|diff|branch|stage|add|commit|push)\b[\s\S]{0,40}\bgit\b/i.test(text);
}

function hasExplicitK3sDeployIntent(prompt = '') {
    const text = String(prompt || '').trim();
    if (!text) {
        return false;
    }

    return /\b(deploy|rollout|apply|set image|update image|sync)\b[\s\S]{0,60}\b(k3s|k8s|kubernetes|kubectl|manifest|deployment|helm)\b/i.test(text)
        || /\b(k3s|k8s|kubernetes|kubectl)\b[\s\S]{0,60}\b(deploy|rollout|apply|set image|manifest|deployment|sync)\b/i.test(text);
}

function hasExplicitWebResearchIntent(prompt = '') {
    const text = String(prompt || '').trim();
    if (!text) {
        return false;
    }

    return [
        /\bweb research\b/i,
        /\bresearch\b/i,
        /\blook up\b/i,
        /\bsearch for\b/i,
        /\bsearch the web\b/i,
        /\bbrowse (?:the )?web\b/i,
        /\bsearch online\b/i,
        /\bbrowse online\b/i,
    ].some((pattern) => pattern.test(text));
}

function extractExplicitWebResearchQuery(prompt = '') {
    const text = String(prompt || '').trim();
    if (!text) {
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
        const match = text.match(pattern);
        if (match?.[1]) {
            return match[1].trim();
        }
    }

    if (!hasExplicitWebResearchIntent(text)) {
        return null;
    }

    return text
        .replace(/^(please|can you|could you|would you|help me|i need you to)\s+/i, '')
        .replace(/[.?!]+$/g, '')
        .trim();
}

function extractFirstUrl(prompt = '') {
    const text = String(prompt || '');
    if (!text.trim()) {
        return null;
    }

    const match = text.match(/https?:\/\/[^\s<>"')]+/i);
    return match ? match[0].replace(/[),.;!?]+$/, '') : null;
}

function inferScrapeParams(prompt = '', firstUrl = '') {
    const text = String(prompt || '');
    const normalized = text.toLowerCase();
    const hasImageIntent = /\b(image|images|photo|photos|thumbnail|thumbnails|gallery|galleries|poster|posters|pics?)\b/i.test(text);
    const hasBlindIntent = /\b(blind|opaque|without exposing|without showing|without viewing|without looking at|do not show|don't show)\b/i.test(text);
    const hasSensitiveIntent = /\b(adult|explicit|nsfw|porn)\b/i.test(text);
    const captureImages = hasImageIntent || hasBlindIntent || hasSensitiveIntent;

    return {
        url: firstUrl,
        browser: true,
        ...(captureImages ? { captureImages: true, imageLimit: 12 } : {}),
        ...((captureImages && (hasBlindIntent || hasSensitiveIntent)) ? { blindImageCapture: true } : {}),
        ...(normalized.includes('javascript') ? { javascript: true } : {}),
    };
}

function extractRequestedDirectoryPath(prompt = '') {
    const text = String(prompt || '');
    if (!text.trim()) {
        return null;
    }

    const creationIntent = /\b(create|make|mkdir)\b[\s\S]{0,80}\b(folder|directory)\b/i.test(text)
        || /\b(folder|directory)\b[\s\S]{0,40}\b(called|named|name it)\b/i.test(text);

    if (!creationIntent) {
        return null;
    }

    const quotedMatch = text.match(/\b(?:folder|directory)\b[\s\S]{0,40}["'`]+([^"'`\r\n]+)["'`]+/i);
    if (quotedMatch?.[1]) {
        return quotedMatch[1].trim();
    }

    const namedMatch = text.match(/\b(?:called|named|name it)\s+([a-zA-Z0-9._/-]+)/i);
    if (namedMatch?.[1]) {
        return namedMatch[1].trim();
    }

    const directMatch = text.match(/\b(?:create|make|mkdir)\s+(?:a\s+)?(?:folder|directory)\s+(?:called\s+|named\s+)?([a-zA-Z0-9._/-]+)/i);
    if (directMatch?.[1]) {
        return directMatch[1].trim();
    }

    return null;
}

function hasExplicitArtifactGenerationIntentForPreflight(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(export|download|save|convert|turn\b[\s\S]{0,20}\binto|turn\b[\s\S]{0,20}\bas|format\b[\s\S]{0,20}\bas)\b/i.test(normalized)
        || /\b(create|make|generate|build|produce|render|prepare|draft)\b[\s\S]{0,60}\b(file|artifact|document|page|report|brief|pdf|html|docx|xml|spreadsheet|excel|workbook|mermaid|diagram|flowchart|sequence diagram|erd|class diagram|state diagram)\b/i.test(normalized)
        || /\b(as|into|in)\s+(?:an?\s+)?(?:pdf|html|docx|xml|spreadsheet|excel workbook|workbook|mermaid|mmd)\b/i.test(normalized)
        || /\b(pdf|html|docx|xml|spreadsheet|excel|workbook)\s+(?:file|document|artifact|export)\b/i.test(normalized);
}

function hasExplicitMermaidArtifactIntentForPreflight(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    if (/\b(mermaid|\.mmd\b)\b/i.test(normalized)) {
        return hasExplicitArtifactGenerationIntentForPreflight(normalized)
            || /\b(mermaid|mmd)\s+(?:file|artifact|diagram|chart|export)\b/i.test(normalized);
    }

    return /\b(create|make|generate|build|produce|render|export|draw)\b[\s\S]{0,60}\b(diagram|flowchart|sequence diagram|erd|entity relationship|class diagram|state diagram)\b/i.test(normalized)
        || /\b(diagram|flowchart|sequence diagram|erd|entity relationship|class diagram|state diagram)\s+(?:file|artifact|export)\b/i.test(normalized);
}

function inferRequestedOutputFormatForPreflight(text = '') {
    const normalized = String(text || '').toLowerCase();
    if (!normalized) {
        return null;
    }

    const hasArtifactIntent = hasExplicitArtifactGenerationIntentForPreflight(normalized);

    if ((/\b(power\s*query|\.(pq|m)\b)/.test(normalized) && hasArtifactIntent)
        || /\b(power\s*query)\s+(?:file|script|artifact|export)\b/.test(normalized)) {
        return 'power-query';
    }

    if ((/\b(xlsx|spreadsheet|excel|workbook)\b/.test(normalized) && hasArtifactIntent)
        || /\b(excel|spreadsheet|workbook)\s+(?:file|artifact|export)\b/.test(normalized)) {
        return 'xlsx';
    }

    if (/\bpdf\b/.test(normalized) && hasArtifactIntent) {
        return 'pdf';
    }

    if (/\b(docx|word document)\b/.test(normalized) && hasArtifactIntent) {
        return 'docx';
    }

    if (/\bxml\b/.test(normalized) && hasArtifactIntent) {
        return 'xml';
    }

    if (hasExplicitMermaidArtifactIntentForPreflight(normalized)) {
        return 'mermaid';
    }

    if (/\bhtml\b/.test(normalized) && hasArtifactIntent) {
        return 'html';
    }

    return null;
}

function hasImplicitImageArtifactFollowupReferenceForPreflight(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(last|latest|generated|previous|prior|same|those|these|this|earlier|above)\b[\s\S]{0,40}\b(images?|photos?|pictures?|illustrations?|renders?)\b/i.test(normalized)
        || /\b(images?|photos?|pictures?|illustrations?|renders?)\b[\s\S]{0,60}\b(from earlier|from before|from above|you made|you generated|we generated|from the last turn)\b/i.test(normalized)
        || /\b(use|put|place|include|embed|make|turn|convert|compile)\b[\s\S]{0,40}\b(those|these|the generated|the previous|the earlier)\b[\s\S]{0,20}\b(images?|photos?|pictures?)\b/i.test(normalized);
}

function hasExplicitImageGenerationIntentForPreflight(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    if (hasImplicitImageArtifactFollowupReferenceForPreflight(normalized)
        && !/\b(generate|create|make|render|design|draw|illustrate|produce|craft)\b/i.test(normalized)) {
        return false;
    }

    return /\b(generate|create|make|render|design|draw|illustrate|produce|craft)\b[\s\S]{0,50}\b(image|images|photo|photos|picture|pictures|illustration|illustrations|render|renders|artwork|cover image|cover art|poster)\b/i.test(normalized)
        || /\b(text[-\s]?to[-\s]?image|image generation)\b/i.test(normalized)
        || /\b(image|photo|picture|illustration|render|artwork|poster)\b[\s\S]{0,20}\b(of|showing|depicting|featuring)\b/i.test(normalized);
}

function shouldPreGenerateImagesForArtifactRequestForPreflight({
    text = '',
    outputFormat = null,
} = {}) {
    if (!['pdf', 'docx', 'html'].includes(String(outputFormat || '').trim().toLowerCase())) {
        return false;
    }

    return hasExplicitImageGenerationIntentForPreflight(text);
}

function buildImagePromptFromArtifactRequestForPreflight(text = '') {
    const prompt = String(text || '').trim();
    if (!prompt) {
        return '';
    }

    let cleaned = prompt
        .replace(/\b(?:and then|then|and)?\s*(?:put|place|embed|include|insert|compile|turn|convert)\b[\s\S]*$/i, '')
        .replace(/\b(?:for|into|in|as)\s+(?:an?\s+)?(?:pdf|docx|html|document|page|file|artifact|brochure|booklet|report|brief)\b[\s\S]*$/i, '')
        .replace(/\b(?:make|create|generate|build|produce|prepare)\b[\s\S]{0,20}\b(?:a|an)\s+(?:pdf|docx|html|document|page|file|artifact)\b[\s\S]*$/i, '')
        .trim();

    if (!cleaned || cleaned.length < 12) {
        cleaned = prompt;
    }

    return cleaned;
}

function buildDeterministicPreflightActions(automaticTools = [], prompt = '') {
    const availableToolIds = new Set(automaticTools.map((entry) => entry.id));
    const remoteToolId = availableToolIds.has('remote-command')
        ? 'remote-command'
        : (availableToolIds.has('ssh-execute') ? 'ssh-execute' : null);
    const actions = [];
    const firstUrl = extractFirstUrl(prompt);
    const webQuery = availableToolIds.has('web-search')
        ? extractExplicitWebResearchQuery(prompt)
        : null;
    const scrapeUrl = availableToolIds.has('web-scrape')
        && firstUrl
        && /\b(scrape|extract|selector|structured|parse)\b/i.test(prompt)
        ? firstUrl
        : null;
    const directoryPath = availableToolIds.has('file-mkdir')
        ? extractRequestedDirectoryPath(prompt)
        : null;
    const inferredOutputFormat = inferRequestedOutputFormatForPreflight(prompt);
    const imagePrompt = availableToolIds.has('image-generate')
        && shouldPreGenerateImagesForArtifactRequestForPreflight({ text: prompt, outputFormat: inferredOutputFormat })
        ? buildImagePromptFromArtifactRequestForPreflight(prompt)
        : null;
    const sshCommand = remoteToolId
        ? extractRequestedSshCommand(prompt)
        : null;
    const sshTarget = remoteToolId
        ? extractExplicitSshTarget(prompt)
        : null;

    if (webQuery) {
        actions.push({
            toolId: 'web-search',
            params: {
                query: webQuery,
                limit: normalizeResearchSearchResultCount(),
                region: 'us-en',
                timeRange: 'all',
                includeSnippets: true,
                includeUrls: true,
            },
        });
    }

    if (scrapeUrl) {
        actions.push({
            toolId: 'web-scrape',
            params: inferScrapeParams(prompt, scrapeUrl),
        });
    }

    if (directoryPath) {
        actions.push({
            toolId: 'file-mkdir',
            params: {
                path: directoryPath,
                recursive: true,
            },
        });
    }

    if (imagePrompt) {
        actions.push({
            toolId: 'image-generate',
            params: {
                prompt: imagePrompt,
            },
        });
    }

    if (sshCommand && promptHasExplicitSshIntent(prompt)) {
        actions.push({
            toolId: remoteToolId,
            params: {
                ...(sshTarget?.host ? { host: sshTarget.host } : {}),
                ...(sshTarget?.username ? { username: sshTarget.username } : {}),
                ...(sshTarget?.port ? { port: sshTarget.port } : {}),
                command: sshCommand,
            },
        });
    }

    return actions;
}

function normalizeResearchFollowupPageCount() {
    return Math.max(2, Math.min(config.memory.researchFollowupPages, 4));
}

function normalizeResearchSearchResultCount() {
    return Math.max(8, Math.min(config.memory.researchSearchLimit, 12));
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

function extractResearchFollowupCandidates(searchResult = {}, maxPages = normalizeResearchFollowupPageCount()) {
    const results = Array.isArray(searchResult?.data?.results) ? searchResult.data.results : [];
    const seen = new Set();

    return results
        .filter((entry) => {
            const url = String(entry?.url || '').trim();
            if (!url || seen.has(url)) {
                return false;
            }

            seen.add(url);
            return true;
        })
        .slice(0, maxPages);
}

function buildResearchMemoryNote({ query = '', candidate = {}, result = {} } = {}) {
    const sourceUrl = String(candidate?.url || result?.data?.url || '').trim();
    const title = String(candidate?.title || result?.data?.title || '').trim();
    const snippet = String(candidate?.snippet || '').replace(/\s+/g, ' ').trim();
    const textBody = result?.toolId === 'web-scrape'
        ? stripHtmlToText(JSON.stringify(result?.data?.data || {}))
        : extractFetchBodyText(result);
    const excerpt = textBody.slice(0, 1200).trim();

    if (!sourceUrl || (!title && !snippet && !excerpt)) {
        return null;
    }

    return [
        '[Research note]',
        query ? `Query: ${query}` : null,
        title ? `Title: ${title}` : null,
        `URL: ${sourceUrl}`,
        snippet ? `Search snippet: ${snippet}` : null,
        excerpt ? `Source notes: ${excerpt}` : null,
    ].filter(Boolean).join('\n');
}

async function maybeStoreResearchMemoryNote({ toolContext = {}, query = '', candidate = {}, result = {} } = {}) {
    if (!toolContext?.memoryService?.rememberResearchNote || !toolContext?.sessionId) {
        return;
    }

    const note = buildResearchMemoryNote({ query, candidate, result });
    if (!note) {
        return;
    }

    await toolContext.memoryService.rememberResearchNote(toolContext.sessionId, note, {
        sourceUrl: String(candidate?.url || result?.data?.url || '').trim(),
        sourceTitle: String(candidate?.title || result?.data?.title || '').trim(),
        query,
    });
}

async function runResearchFollowupPreflight({
    toolManager,
    searchEvent = null,
    automaticTools = [],
    toolContext = {},
}) {
    const availableToolIds = new Set((automaticTools || []).map((entry) => entry.id));
    const canFetch = availableToolIds.has('web-fetch');
    const canScrape = availableToolIds.has('web-scrape');
    const searchResult = searchEvent?.result || {};
    const query = String(searchEvent?.toolCall?.function?.arguments ? (parseToolArguments(searchEvent.toolCall.function.arguments).query || '') : '').trim();

    if ((!canFetch && !canScrape) || !searchResult?.success) {
        return [];
    }

    const followupCandidates = extractResearchFollowupCandidates(searchResult);
    const followupEvents = [];

    for (const candidate of followupCandidates) {
        let result = null;
        let toolId = null;
        let params = null;

        if (canFetch) {
            toolId = 'web-fetch';
            params = {
                url: candidate.url,
                timeout: 20000,
                cache: true,
            };
            result = await executeAutomaticToolCall(toolManager, {
                id: `research_fetch_${followupEvents.length + 1}`,
                type: 'function',
                function: {
                    name: toolId,
                    arguments: JSON.stringify(params),
                },
            }, toolContext);
        }

        if ((!result || result.success === false) && canScrape) {
            toolId = 'web-scrape';
            params = {
                url: candidate.url,
                browser: true,
                timeout: 20000,
            };
            result = await executeAutomaticToolCall(toolManager, {
                id: `research_scrape_${followupEvents.length + 1}`,
                type: 'function',
                function: {
                    name: toolId,
                    arguments: JSON.stringify(params),
                },
            }, toolContext);
        }

        if (!result || !toolId || !params) {
            continue;
        }

        const event = {
            toolCall: normalizeToolCall({
                id: `${toolId}_${followupEvents.length + 1}`,
                type: 'function',
                function: {
                    name: toolId,
                    arguments: JSON.stringify(params),
                },
            }),
            reason: 'Deterministic research follow-up on a top search result.',
            result,
        };
        followupEvents.push(event);

        if (result.success) {
            await maybeStoreResearchMemoryNote({
                toolContext,
                query,
                candidate,
                result,
            });
        }
    }

    return followupEvents;
}

function sanitizeToolSchema(schema) {
    if (!schema || typeof schema !== 'object') {
        return { type: 'object', properties: {} };
    }

    if (Array.isArray(schema)) {
        return schema.map((entry) => sanitizeToolSchema(entry));
    }

    const sanitized = {};
    const allowedKeys = [
        'type',
        'description',
        'enum',
        'default',
        'required',
        'properties',
        'items',
        'additionalProperties',
        'maximum',
        'minimum',
        'maxLength',
        'minLength',
    ];

    for (const key of allowedKeys) {
        if (schema[key] === undefined) {
            continue;
        }

        if (key === 'type' && Array.isArray(schema.type)) {
            sanitized.type = schema.type.find((entry) => entry !== 'null') || schema.type[0];
            continue;
        }

        if (key === 'properties' && schema.properties && typeof schema.properties === 'object') {
            sanitized.properties = Object.fromEntries(
                Object.entries(schema.properties).map(([propertyName, propertySchema]) => [
                    propertyName,
                    sanitizeToolSchema(propertySchema),
                ]),
            );
            continue;
        }

        if (key === 'items') {
            sanitized.items = sanitizeToolSchema(schema.items);
            continue;
        }

        if (key === 'additionalProperties' && typeof schema.additionalProperties === 'object') {
            sanitized.additionalProperties = sanitizeToolSchema(schema.additionalProperties);
            continue;
        }

        sanitized[key] = schema[key];
    }

    if (!sanitized.type && sanitized.properties) {
        sanitized.type = 'object';
    }

    return sanitized;
}

function buildAutomaticToolDefinitions(toolManager, prompt = '', options = {}) {
    if (!toolManager?.registry) {
        return [];
    }

    const hasRemoteCommandAlias = Boolean(toolManager.getTool('remote-command'));

    return Array.from(AUTO_TOOL_ALLOWLIST)
        .filter((toolId) => !(toolId === 'ssh-execute' && hasRemoteCommandAlias))
        .map((toolId) => {
            const tool = toolManager.getTool(toolId);
            const skill = toolManager.registry.getSkill(toolId);
            const available = tool && (!skill || skill.enabled !== false);

            if (!available || !shouldAutoUseTool(toolId, prompt, skill, options)) {
                return null;
            }

            return {
                id: toolId,
                skill,
                description: tool.description || tool.name || toolId,
                parameters: sanitizeToolSchema(tool.inputSchema),
                definition: {
                    type: 'function',
                    function: {
                        name: toolId,
                        description: tool.description || tool.name || toolId,
                        parameters: sanitizeToolSchema(tool.inputSchema),
                    },
                },
                chatDefinition: {
                    type: 'function',
                    function: {
                        name: toolId,
                        description: tool.description || tool.name || toolId,
                        parameters: sanitizeToolSchema(tool.inputSchema),
                    },
                },
                responseDefinition: {
                    type: 'function',
                    name: toolId,
                    description: tool.description || tool.name || toolId,
                    parameters: sanitizeToolSchema(tool.inputSchema),
                    strict: true,
                },
            };
        })
        .filter(Boolean);
}

function selectAutomaticToolDefinitions(automaticTools = [], prompt = '') {
    if (!automaticTools.length) {
        return [];
    }

    const availableToolIds = new Set(automaticTools.map((entry) => entry.id));
    const selectedIds = new Set();
    const normalizedPrompt = String(prompt || '').toLowerCase();
    const hasUrl = /https?:\/\//i.test(normalizedPrompt);
    const hasExplicitScrapeIntent = /\b(scrape|extract|selector|structured|parse)\b/i.test(normalizedPrompt);
    const hasWebResearchIntent = Boolean(
        hasExplicitWebResearchIntent(prompt)
        || /\b(latest|current|today|news|look up|search for|search the web|browse)\b/i.test(normalizedPrompt)
    );
    const hasImageIntent = /\b(image|images|visual|visuals|illustration|illustrations|photo|photos|hero image|background image|cover image)\b/i.test(normalizedPrompt);
    const hasUnsplashIntent = /\bunsplash\b/i.test(normalizedPrompt);
    const hasDirectImageUrl = /https?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg)(?:\?\S*)?/i.test(normalizedPrompt);
    const hasArchitectureIntent = /\b(architecture|system design|service diagram|deployment diagram|architecture diagram|design the system)\b/i.test(normalizedPrompt);
    const hasUmlIntent = /\b(uml|class diagram|sequence diagram|activity diagram|use ?case diagram|state diagram|component diagram)\b/i.test(normalizedPrompt);
    const hasApiDesignIntent = /\b(api design|design api|openapi|swagger|graphql schema|rest api|grpc)\b/i.test(normalizedPrompt);
    const hasSchemaIntent = /\b(database schema|design database|generate ddl|ddl\b|er diagram|entity relationship|orm schema)\b/i.test(normalizedPrompt);
    const hasMigrationIntent = /\b(create migration|generate migration|schema migration|database change|schema diff|migration)\b/i.test(normalizedPrompt);
    const remoteToolId = availableToolIds.has('remote-command')
        ? 'remote-command'
        : (availableToolIds.has('ssh-execute') ? 'ssh-execute' : null);
    const explicitLocalArtifact = hasExplicitLocalArtifactReference(prompt);
    const remoteWebsiteUpdateIntent = hasRemoteWebsiteUpdateIntent(prompt);
    const internalArtifactReference = hasInternalArtifactReference(prompt);
    const shouldPreferRemoteWebsiteSource = Boolean(remoteToolId && remoteWebsiteUpdateIntent && !explicitLocalArtifact);
    const shouldSuppressWebFetchForRemoteWebsite = shouldPreferRemoteWebsiteSource && internalArtifactReference;

    if (hasWebResearchIntent) {
        selectedIds.add('web-search');
    }

    if (hasExplicitScrapeIntent) {
        selectedIds.add('web-search');
        selectedIds.add('web-scrape');
    }

    if (hasUrl) {
        if (shouldSuppressWebFetchForRemoteWebsite) {
            // Keep website replacement flows on the remote SSH path instead of fetching
            // backend-local artifact links as if they were public internet URLs.
        } else if (hasExplicitScrapeIntent) {
            selectedIds.add('web-scrape');
        } else {
            selectedIds.add('web-fetch');
        }
    }

    if (hasImageIntent && /\b(generate|create|make|design)\b/i.test(normalizedPrompt)) {
        selectedIds.add('image-generate');
    }

    if (hasUnsplashIntent || (hasImageIntent && /\b(search|find|browse|reference|stock)\b/i.test(normalizedPrompt))) {
        selectedIds.add('image-search-unsplash');
    }

    if ((hasImageIntent && /\b(url|link|embed|use this)\b/i.test(normalizedPrompt)) || hasDirectImageUrl) {
        selectedIds.add('image-from-url');
    }

    if (!shouldPreferRemoteWebsiteSource && extractRequestedDirectoryPath(prompt)) {
        selectedIds.add('file-mkdir');
    }

    if (!shouldPreferRemoteWebsiteSource && /\b(read|open|show|print|cat)\b[\s\S]{0,40}\bfile\b/i.test(normalizedPrompt)) {
        selectedIds.add('file-read');
    }

    if (!shouldPreferRemoteWebsiteSource && /\b(write|save|create|update|edit)\b[\s\S]{0,40}\bfile\b/i.test(normalizedPrompt)) {
        selectedIds.add('file-write');
    }

    if (!shouldPreferRemoteWebsiteSource && /\b(find|search|locate|list)\b[\s\S]{0,40}\bfiles?\b/i.test(normalizedPrompt)) {
        selectedIds.add('file-search');
    }

    if (remoteToolId && (promptHasExplicitSshIntent(prompt) || shouldPreferRemoteWebsiteSource)) {
        selectedIds.add(remoteToolId);
    }

    if (hasExplicitK3sDeployIntent(prompt)) {
        selectedIds.add('k3s-deploy');
    }

    if (hasExplicitGitIntent(prompt)) {
        selectedIds.add('git-safe');
    }

    if (/\b(docker|container)\b/i.test(normalizedPrompt)) {
        selectedIds.add('docker-exec');
    }

    if (/\b(run|execute|test)\b[\s\S]{0,40}\b(code|script|snippet)\b/i.test(normalizedPrompt) || /\bsandbox\b/i.test(normalizedPrompt)) {
        selectedIds.add('code-sandbox');
    }

    if (/\b(security|vulnerab|audit|scan|secret)\b/i.test(normalizedPrompt)) {
        selectedIds.add('security-scan');
    }

    if (hasArchitectureIntent) {
        selectedIds.add('architecture-design');
    }

    if (hasUmlIntent) {
        selectedIds.add('uml-generate');
    }

    if (hasApiDesignIntent) {
        selectedIds.add('api-design');
    }

    if (hasSchemaIntent) {
        selectedIds.add('schema-generate');
    }

    if (hasMigrationIntent) {
        selectedIds.add('migration-create');
    }

    if (/\btool\b[\s\S]{0,40}\b(help|doc|docs|documentation|how)\b/i.test(normalizedPrompt)
        || /\bhow do i use\b[\s\S]{0,40}\btool\b/i.test(normalizedPrompt)) {
        selectedIds.add('tool-doc-read');
    }

    if (selectedIds.size === 0) {
        automaticTools.forEach((entry) => {
            const triggerPatterns = entry.skill?.triggerPatterns || [];
            if (triggerPatterns.some((pattern) => promptMentionsPattern(prompt, pattern))) {
                selectedIds.add(entry.id);
            }
        });
    }

    return automaticTools.filter((entry) => selectedIds.has(entry.id));
}

function inferRequiredAutomaticToolId(prompt = '', availableToolIdsInput = []) {
    const availableToolIds = new Set(Array.isArray(availableToolIdsInput) ? availableToolIdsInput : []);
    const remoteToolId = availableToolIds.has('remote-command')
        ? 'remote-command'
        : (availableToolIds.has('ssh-execute') ? 'ssh-execute' : 'remote-command');

    if (remoteToolId
        && hasRemoteWebsiteUpdateIntent(prompt)
        && !hasExplicitLocalArtifactReference(prompt)) {
        return remoteToolId;
    }

    if (promptHasExplicitSshIntent(prompt)) {
        return remoteToolId;
    }

    if (hasExplicitK3sDeployIntent(prompt) && availableToolIds.has('k3s-deploy')) {
        return 'k3s-deploy';
    }

    if (hasExplicitGitIntent(prompt) && availableToolIds.has('git-safe')) {
        return 'git-safe';
    }

    if (hasExplicitWebResearchIntent(prompt)) {
        return 'web-search';
    }

    if (extractFirstUrl(prompt) && /\b(scrape|extract|selector|structured|parse)\b/i.test(prompt)) {
        return 'web-scrape';
    }

    if (extractRequestedDirectoryPath(prompt)) {
        return 'file-mkdir';
    }

    return null;
}

function buildForcedToolChoice(toolId, api = 'responses') {
    return api === 'chat'
        ? {
            type: 'function',
            function: {
                name: toolId,
            },
        }
        : {
            type: 'function',
            name: toolId,
        };
}

function buildAutomaticToolChoice(selectedTools = [], api = 'responses', options = {}) {
    if (!selectedTools.length) {
        return 'none';
    }

    const prompt = String(options.prompt || '');
    const requiredToolId = inferRequiredAutomaticToolId(prompt, selectedTools.map((tool) => tool.id));
    if (requiredToolId && selectedTools.some((tool) => tool.id === requiredToolId)) {
        return buildForcedToolChoice(requiredToolId, api);
    }

    if (selectedTools.length === 1) {
        return buildForcedToolChoice(selectedTools[0].id, api);
    }

    return 'auto';
}

function buildAutomaticToolGuidance(automaticTools = [], options = {}) {
    if (!automaticTools.length) {
        return null;
    }

    const guidance = [
        'You can use the provided tools whenever they will improve accuracy or gather missing data.',
        'Treat the tool definitions attached to this request as the source of truth for tool availability.',
        'Do not claim tools are unavailable because of absent meta variables or guessed config names when the tool definitions are attached to the request.',
    ];

    if (automaticTools.some((entry) => entry.id === 'web-search')) {
        guidance.push('- Use `web-search` for finding current or relevant pages before answering.');
        guidance.push('- When the user explicitly asks for research, call `web-search` first. This backend routes it through the configured Perplexity provider.');
        guidance.push('- For explicit research requests, do not stop at search snippets. Verify the strongest search results with `web-fetch` or `web-scrape` and ground the answer in those source pages.');
    }

    if (automaticTools.some((entry) => entry.id === 'web-fetch')) {
        guidance.push('- Use `web-fetch` for simple static page retrieval when you only need raw content from a URL.');
    }

    if (automaticTools.some((entry) => entry.id === 'web-scrape')) {
        guidance.push('- Use `web-scrape` when the user asks to extract fields from a page. Set `browser: true` or `javascript: true` for dynamic sites, certificate/TLS issues, or rendered DOM content. Use `selectors` to pull structured fields and `waitForSelector` when a page must finish rendering.');
        guidance.push('- When the user wants page images from sensitive or adult sites without exposing the model to the content, use `web-scrape` with `captureImages: true` and `blindImageCapture: true` so the backend stores binary artifacts and returns only safe metadata.');
    }

    if (automaticTools.some((entry) => entry.id === 'image-generate')) {
        guidance.push('- Use `image-generate` to create visual assets and return hosted image URLs the user can reuse.');
    }

    if (automaticTools.some((entry) => entry.id === 'image-search-unsplash')) {
        guidance.push('- Use `image-search-unsplash` to find reference or stock images with attribution when the user asks for visuals, photography, or inspiration.');
    }

    if (automaticTools.some((entry) => entry.id === 'image-from-url')) {
        guidance.push('- Use `image-from-url` when the user provides or requests a direct image URL to embed in the answer.');
    }

    if (automaticTools.some((entry) => ['image-generate', 'image-search-unsplash', 'image-from-url'].includes(entry.id))) {
        guidance.push('- When verified image URLs are available from tools, embed those directly with markdown image syntax instead of fabricating SVG placeholders, overlays, or HTML mockups.');
    }

    if (automaticTools.some((entry) => entry.id === 'file-read')) {
        guidance.push('- Use `file-read` to inspect files from the local workspace when the user asks to read or review them.');
    }

    if (automaticTools.some((entry) => entry.id === 'file-search')) {
        guidance.push('- Use `file-search` to locate files in the workspace before answering filesystem questions.');
    }

    if (automaticTools.some((entry) => entry.id === 'file-write')) {
        guidance.push('- Use `file-write` to create or update local runtime files when the user asks for filesystem changes.');
        guidance.push('- Every `file-write` call must include both a `path` and the full file body as `content` in the same call. Do not call `file-write` with only a path.');
        guidance.push('- For remote hosts, deployed servers, or container-only paths, use `remote-command` or `docker-exec` instead of `file-write`.');
    }

    if (automaticTools.some((entry) => entry.id === 'file-mkdir')) {
        guidance.push('- Use `file-mkdir` to create folders or directories when the user asks for them.');
    }

    if (automaticTools.some((entry) => entry.id === 'git-safe')) {
        guidance.push('- Use `git-safe` for local repository save flows: inspect git status, stage files, commit, and push.');
        guidance.push('- Prefer `save-and-push` when the user clearly wants the latest local changes committed and pushed to GitHub.');
    }

    const remoteGuidanceToolId = automaticTools.some((entry) => entry.id === 'remote-command')
        ? 'remote-command'
        : (automaticTools.some((entry) => entry.id === 'ssh-execute') ? 'ssh-execute' : null);

    if (remoteGuidanceToolId) {
        guidance.push(`- Use \`${remoteGuidanceToolId}\` for remote server commands over SSH when the user asks you to inspect, deploy, configure, or troubleshoot a remote host.`);
        guidance.push(`- Do not refer to internal tool names like \`run_shell_command\` or claim you lack generic shell access when \`${remoteGuidanceToolId}\` is attached.`);
        guidance.push(`- Every \`${remoteGuidanceToolId}\` call must include a non-empty \`command\` string. Host, username, and port may be omitted only when runtime defaults already exist.`);
        guidance.push(`- Keep ownership of the original remote troubleshooting request. Treat intermediate failures as part of the same task and continue with the next reasonable command instead of asking the user to choose each step.`);
        guidance.push(`- If \`${remoteGuidanceToolId}\` fails, explain the actual SSH error from the tool result and ask only for the missing host or credentials if needed.`);
        guidance.push('- Ask for user input only when a tool result shows missing credentials or host details, a destructive action needs approval, or the next move depends on a real external decision.');
        guidance.push('- For reconnect or baseline remote checks, assume Ubuntu/Linux first and use a concrete command such as `hostname && uname -m && (test -f /etc/os-release && sed -n \'1,3p\' /etc/os-release || true) && uptime`.');
        guidance.push('- For Kubernetes troubleshooting, if `kubectl describe` or pod status output shows CrashLoopBackOff, an init container failure, or Exit Code > 0, follow it with `kubectl logs` for the failing container or init container instead of handing that next command back to the user.');
        guidance.push('- For remote website or HTML updates, prefer the remote file, ConfigMap, or deployed content as the source of truth unless the user explicitly provided a local artifact or local path.');
        guidance.push('- If the user asks for a fresh replacement page, generate the full HTML and write it remotely instead of blocking on a missing local artifact.');
        guidance.push('- Internal artifact references like `/api/artifacts/...` are backend-local links. Do not invent `https://api/...` from them.');
        const sshConfig = settingsController.getEffectiveSshConfig();

        if (hasUsableSshDefaults()) {
            guidance.push(`- SSH defaults are configured for \`${sshConfig.username}@${sshConfig.host}:${sshConfig.port || 22}\`. Use these defaults unless the user asks for a different target.`);
        } else {
            guidance.push('- No SSH defaults are configured, so use the host/username provided by the user when available.');
        }
    }

    if (automaticTools.some((entry) => entry.id === 'docker-exec')) {
        guidance.push('- Use `docker-exec` for commands that must run inside an existing Docker container.');
    }

    if (automaticTools.some((entry) => entry.id === 'k3s-deploy')) {
        guidance.push('- Use `k3s-deploy` for restricted deployment work over SSH: sync a GitHub repo on the server, apply manifests, set deployment images, and check rollout status.');
        guidance.push('- Prefer `k3s-deploy` over raw SSH when the task is a standard k3s deploy/update flow.');
    }

    if (automaticTools.some((entry) => entry.id === 'code-sandbox')) {
        guidance.push('- Use `code-sandbox` to run code in an isolated environment when you need to verify behavior without modifying the main system.');
    }

    if (automaticTools.some((entry) => entry.id === 'security-scan')) {
        guidance.push('- Use `security-scan` for code audits, secret detection, and vulnerability checks when code is present.');
    }

    if (automaticTools.some((entry) => entry.id === 'architecture-design')) {
        guidance.push('- Use `architecture-design` for architecture recommendations, deployment/component overviews, and system design documentation.');
    }

    if (automaticTools.some((entry) => entry.id === 'uml-generate')) {
        guidance.push('- Use `uml-generate` for UML, Mermaid, or PlantUML class/sequence/activity/component/state diagrams from code or descriptions.');
    }

    if (automaticTools.some((entry) => entry.id === 'api-design')) {
        guidance.push('- Use `api-design` for REST, OpenAPI, GraphQL, or gRPC contract design work.');
    }

    if (automaticTools.some((entry) => entry.id === 'schema-generate')) {
        guidance.push('- Use `schema-generate` for DDL, ORM schema generation, and ER-diagram style database design output.');
    }

    if (automaticTools.some((entry) => entry.id === 'migration-create')) {
        guidance.push('- Use `migration-create` when the user asks for migration up/down scripts or schema diff output.');
    }

    if (automaticTools.some((entry) => entry.id === 'tool-doc-read')) {
        guidance.push('- Use `tool-doc-read` when the user asks how a tool works, what parameters it takes, or what its setup/limitations are. Pass the target `toolId`.');
    }

    guidance.push('Prefer tools over guessing when the user asks for live web data, extraction, or verification.');

    return guidance.join('\n');
}

function trimString(value, maxLength = 12000) {
    if (typeof value !== 'string' || value.length <= maxLength) {
        return value;
    }

    const hiddenCharacters = value.length - maxLength;
    return `${value.slice(0, maxLength)}\n...[truncated ${hiddenCharacters} chars]`;
}

function sanitizeToolResultPayload(value, depth = 0) {
    if (value == null) {
        return value;
    }

    if (typeof value === 'string') {
        return trimString(value);
    }

    if (typeof value !== 'object') {
        return value;
    }

    if (depth >= 4) {
        return '[truncated]';
    }

    if (Array.isArray(value)) {
        return value.slice(0, 25).map((entry) => sanitizeToolResultPayload(entry, depth + 1));
    }

    const output = {};
    for (const [key, entry] of Object.entries(value).slice(0, 50)) {
        output[key] = sanitizeToolResultPayload(entry, depth + 1);
    }

    return output;
}

function normalizeToolResultForModel(result, fallbackToolId) {
    return {
        success: result?.success !== false,
        toolId: result?.toolId || fallbackToolId,
        duration: result?.duration || 0,
        data: sanitizeToolResultPayload(result?.data),
        error: result?.error || null,
        sideEffects: sanitizeToolResultPayload(result?.sideEffects || {}),
        timestamp: result?.timestamp || new Date().toISOString(),
    };
}

function buildToolExecutionContext(toolManager, context = {}) {
    return {
        ...context,
        toolManager,
        tools: {
            get: (toolId) => toolManager.getTool(toolId),
        },
    };
}

function normalizeToolCall(toolCall = {}) {
    return {
        id: toolCall.id,
        type: toolCall.type || 'function',
        function: {
            name: toolCall.function?.name,
            arguments: toolCall.function?.arguments || '{}',
        },
    };
}

function isTerminalFinishReason(finishReason = null) {
    if (!finishReason) {
        return false;
    }

    return TERMINAL_FINISH_REASONS.has(String(finishReason).toLowerCase());
}

function parseToolArguments(rawArguments = '{}') {
    if (!rawArguments) {
        return {};
    }

    try {
        return JSON.parse(rawArguments);
    } catch (error) {
        return {
            __parseError: `Invalid tool arguments: ${error.message}`,
            raw: rawArguments,
        };
    }
}

async function executeAutomaticToolCall(toolManager, toolCall, context = {}) {
    const toolId = toolCall.function?.name;

    if (!toolId || !AUTO_TOOL_ALLOWLIST.has(toolId)) {
        return {
            success: false,
            toolId: toolId || 'unknown',
            error: `Automatic execution is not allowed for tool '${toolId || 'unknown'}'`,
        };
    }

    const params = parseToolArguments(toolCall.function?.arguments || '{}');
    if (params.__parseError) {
        return {
            success: false,
            toolId,
            error: params.__parseError,
            rawArguments: trimString(params.raw || ''),
        };
    }

    try {
        const result = await toolManager.executeTool(
            toolId,
            params,
            buildToolExecutionContext(toolManager, context),
        );
        return normalizeToolResultForModel(result, toolId);
    } catch (error) {
        return {
            success: false,
            toolId,
            error: error.message,
        };
    }
}

async function runDeterministicToolPreflight({
    toolManager,
    automaticTools,
    prompt,
    toolContext = {},
}) {
    const actions = buildDeterministicPreflightActions(automaticTools, prompt);

    if (!actions.length) {
        return {
            toolEvents: [],
            summaryMessage: null,
        };
    }

    const toolEvents = [];
    console.log(`[OpenAI] Deterministic tool preflight: ${actions.map((action) => action.toolId).join(', ')}`);

    for (let index = 0; index < actions.length; index += 1) {
        const action = actions[index];
        const toolCall = {
            id: `preflight_${index + 1}`,
            type: 'function',
            function: {
                name: action.toolId,
                arguments: JSON.stringify(action.params),
            },
        };

        const result = await executeAutomaticToolCall(toolManager, toolCall, toolContext);
        const event = {
            toolCall: normalizeToolCall(toolCall),
            reason: action.toolId === 'web-search'
                ? 'Deterministic research preflight.'
                : 'Deterministic preflight action.',
            result,
        };
        toolEvents.push(event);

        if (action.toolId === 'web-search' && result.success) {
            const followupEvents = await runResearchFollowupPreflight({
                toolManager,
                searchEvent: event,
                automaticTools,
                toolContext,
            });
            if (followupEvents.length > 0) {
                toolEvents.push(...followupEvents);
            }
        }
    }

    return {
        toolEvents,
        summaryMessage: {
            role: 'system',
            content: `[Automatic tool results]\nUse these verified tool results when answering. If any tool result contains an error, explain that exact error plainly instead of claiming the tool is unavailable.\n${JSON.stringify(toolEvents, null, 2)}`,
        },
    };
}

function formatDirectToolResultMessage(toolEvent = {}) {
    const toolId = toolEvent?.toolCall?.function?.name || toolEvent?.result?.toolId || 'tool';
    const result = toolEvent?.result || {};

    if (toolId === 'ssh-execute' || toolId === 'remote-command') {
        if (!result.success) {
            return `SSH request failed: ${result.error || 'Unknown SSH error'}`;
        }

        const stdout = trimString(String(result?.data?.stdout || '').trim(), 8000);
        const stderr = trimString(String(result?.data?.stderr || '').trim(), 4000);
        const host = result?.data?.host || 'remote host';
        const sections = [
            `SSH command completed on ${host}.`,
        ];

        if (stdout) {
            sections.push(`STDOUT:\n${stdout}`);
        }

        if (stderr) {
            sections.push(`STDERR:\n${stderr}`);
        }

        return sections.join('\n\n');
    }

    if (!result.success) {
        return `${toolId} failed: ${result.error || 'Unknown error'}`;
    }

    if (toolId === 'web-scrape') {
        const scraped = result?.data || {};
        const sections = [
            `Web scrape completed for ${scraped.url || 'the requested page'}.`,
        ];

        if (scraped.title) {
            sections.push(`Title: ${scraped.title}`);
        }

        if (scraped.method) {
            sections.push(`Method: ${scraped.method}`);
        }

        if (scraped.data && Object.keys(scraped.data).length > 0) {
            sections.push(`Extracted data:\n${JSON.stringify(scraped.data, null, 2)}`);
        } else {
            sections.push(`Scrape result:\n${JSON.stringify(scraped, null, 2)}`);
        }

        return sections.join('\n\n');
    }

    return JSON.stringify(result?.data || {}, null, 2);
}

function buildDirectToolResponse(toolEvent, model = null) {
    return {
        id: `resp_tool_${Date.now()}`,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        model,
        output: [
            {
                type: 'message',
                role: 'assistant',
                content: [
                    {
                        type: 'output_text',
                        text: formatDirectToolResultMessage(toolEvent),
                    },
                ],
            },
        ],
        _kimibuilt: {
            toolEvents: [toolEvent],
        },
    };
}

async function runDirectRequiredToolAction({
    toolManager,
    requiredToolId,
    selectedTools = [],
    prompt = '',
    toolContext = {},
    model = null,
}) {
    if (!['ssh-execute', 'remote-command', 'web-scrape'].includes(requiredToolId)) {
        return null;
    }

    const actions = buildDeterministicPreflightActions(selectedTools, prompt)
        .filter((action) => action.toolId === requiredToolId);

    if (!actions.length) {
        return null;
    }

    const toolCall = {
        id: 'direct_required_tool_1',
        type: 'function',
        function: {
            name: requiredToolId,
            arguments: JSON.stringify(actions[0].params),
        },
    };

    const result = await executeAutomaticToolCall(toolManager, toolCall, toolContext);
    const toolEvent = {
        toolCall: normalizeToolCall(toolCall),
        result,
    };

    return buildDirectToolResponse(toolEvent, model);
}

function buildResponsesInput(messages = []) {
    return messages.map((message) => ({
        type: 'message',
        role: message.role,
        content: message.content,
    }));
}

function buildResponsesToolOutputItems(toolCalls = [], toolResults = []) {
    return toolCalls.map((toolCall, index) => ({
        type: 'function_call_output',
        call_id: toolCall.call_id,
        output: JSON.stringify(toolResults[index] || {
            success: false,
            toolId: toolCall.name || 'unknown',
            error: 'Tool output missing',
        }),
    }));
}

function getResponseApiText(response) {
    if (typeof response?.output_text === 'string') {
        return response.output_text;
    }

    if (!Array.isArray(response?.output)) {
        return '';
    }

    return response.output
        .filter((item) => item?.type === 'message' && item?.role === 'assistant')
        .flatMap((item) => item.content || [])
        .filter((content) => content?.type === 'output_text')
        .map((content) => content.text || '')
        .join('');
}

function getResponseFunctionCalls(response) {
    if (!Array.isArray(response?.output)) {
        return [];
    }

    return response.output.filter((item) => item?.type === 'function_call');
}

function isResponsesApiResponse(response) {
    return Boolean(response && (response.object === 'response' || Object.prototype.hasOwnProperty.call(response, 'output_text')));
}

function normalizeResponsesApiResponse(response) {
    const outputText = getResponseApiText(response);

    return {
        id: response.id,
        object: 'response',
        created: response.created_at,
        model: response.model,
        output: [
            {
                type: 'message',
                role: 'assistant',
                content: [
                    {
                        type: 'text',
                        text: outputText,
                    },
                ],
            },
        ],
        session_id: response.session_id,
        metadata: response?._kimibuilt || {},
    };
}

function isResponsesApiUnsupportedError(error) {
    const status = Number(error?.status || error?.statusCode || 0);
    const message = String(error?.message || '').toLowerCase();

    return status === 404
        || status === 405
        || message.includes('/responses')
        || message.includes('unknown url')
        || message.includes('not found')
        || message.includes('unsupported');
}

async function runAutomaticToolLoopWithResponses(openai, {
    model,
    messages,
    selectedTools,
    toolContext = {},
}) {
    const prompt = getLastUserText(messages);
    if (selectedTools.length === 0) {
        return null;
    }

    const workingMessages = [...messages];
    let finalResponse = null;
    const toolGuidance = buildAutomaticToolGuidance(selectedTools, { model });
    const toolEvents = [];

    if (toolGuidance) {
        workingMessages.push({
            role: 'system',
            content: toolGuidance,
        });
    }

    const preflight = await runDeterministicToolPreflight({
        toolManager: toolContext.toolManager || null,
        automaticTools: selectedTools,
        prompt,
        toolContext,
    });
    if (preflight.summaryMessage) {
        workingMessages.push(preflight.summaryMessage);
    }
    if (preflight.toolEvents.length > 0) {
        toolEvents.push(...preflight.toolEvents);
    }

    const remainingTools = selectedTools.filter((entry) => !preflight.toolEvents.some(
        (event) => event.toolCall?.function?.name === entry.id,
    ));

    if (remainingTools.length === 0) {
        finalResponse = await openai.responses.create({
            model,
            input: buildResponsesInput(workingMessages),
            tool_choice: 'none',
        });

        if (toolEvents.length > 0) {
            finalResponse._kimibuilt = {
                toolEvents,
            };
        }

        return finalResponse;
    }

    const seenToolCalls = new Set();
    let nextInput = buildResponsesInput(workingMessages);
    let previousResponseId = null;

    console.log(`[OpenAI] Automatic tools enabled for prompt. Candidates: ${remainingTools.map((entry) => entry.id).join(', ')}`);

    for (let round = 0; round < AUTO_TOOL_MAX_ROUNDS; round += 1) {
        finalResponse = await openai.responses.create({
            model,
            input: nextInput,
            previous_response_id: previousResponseId,
            tools: remainingTools.map((entry) => entry.responseDefinition),
            tool_choice: round === 0 ? buildAutomaticToolChoice(remainingTools, 'responses', { model, prompt }) : 'auto',
            parallel_tool_calls: false,
        });

        const toolCalls = getResponseFunctionCalls(finalResponse);

        if (toolCalls.length === 0) {
            if (toolEvents.length > 0) {
                finalResponse._kimibuilt = {
                    toolEvents,
                };
            }
            return finalResponse;
        }

        const signature = JSON.stringify(toolCalls.map((toolCall) => ({
            name: toolCall.name,
            args: toolCall.arguments,
        })));
        if (seenToolCalls.has(signature)) {
            console.warn('[OpenAI] Endless tool loop detected (duplicate calls), breaking early.');
            if (toolEvents.length > 0) {
                finalResponse._kimibuilt = { toolEvents };
            }
            return finalResponse;
        }
        seenToolCalls.add(signature);

        const toolResults = [];
        for (const toolCall of toolCalls) {
            const result = await executeAutomaticToolCall(toolContext.toolManager, {
                id: toolCall.id || toolCall.call_id,
                type: 'function',
                function: {
                    name: toolCall.name,
                    arguments: toolCall.arguments,
                },
            }, toolContext);
            toolResults.push(result);
            toolEvents.push({
                toolCall: normalizeToolCall({
                    id: toolCall.id || toolCall.call_id,
                    type: 'function',
                    function: {
                        name: toolCall.name,
                        arguments: toolCall.arguments,
                    },
                }),
                result,
            });
        }

        previousResponseId = finalResponse.id;
        nextInput = buildResponsesToolOutputItems(toolCalls, toolResults);
    }

    finalResponse = await openai.responses.create({
        model,
        input: nextInput,
        previous_response_id: previousResponseId,
        tools: remainingTools.map((entry) => entry.responseDefinition),
        tool_choice: 'none',
    });

    if (toolEvents.length > 0) {
        finalResponse._kimibuilt = {
            toolEvents,
        };
    }

    return finalResponse;
}

async function runAutomaticToolLoopWithChatCompletions(openai, {
    model,
    messages,
    selectedTools,
    toolContext = {},
}) {
    if (selectedTools.length === 0) {
        return null;
    }

    const prompt = getLastUserText(messages);
    const workingMessages = [...messages];
    let finalResponse = null;
    const toolGuidance = buildAutomaticToolGuidance(selectedTools, { model });
    const toolEvents = [];

    if (toolGuidance) {
        workingMessages.push({
            role: 'system',
            content: toolGuidance,
        });
    }

    const preflight = await runDeterministicToolPreflight({
        toolManager: toolContext.toolManager || null,
        automaticTools: selectedTools,
        prompt,
        toolContext,
    });
    if (preflight.summaryMessage) {
        workingMessages.push(preflight.summaryMessage);
    }
    if (preflight.toolEvents.length > 0) {
        toolEvents.push(...preflight.toolEvents);
    }

    const remainingTools = selectedTools.filter((entry) => !preflight.toolEvents.some(
        (event) => event.toolCall?.function?.name === entry.id,
    ));

    if (remainingTools.length === 0) {
        finalResponse = await openai.chat.completions.create({
            model,
            messages: workingMessages,
            stream: false,
        });

        if (toolEvents.length > 0) {
            finalResponse._kimibuilt = {
                toolEvents,
            };
        }

        return finalResponse;
    }

    const seenToolCalls = new Set();

    console.log(`[OpenAI] Automatic tools enabled for prompt. Candidates: ${remainingTools.map((entry) => entry.id).join(', ')}`);

    for (let round = 0; round < AUTO_TOOL_MAX_ROUNDS; round += 1) {
        finalResponse = await openai.chat.completions.create({
            model,
            messages: workingMessages,
            tools: remainingTools.map((entry) => entry.chatDefinition),
            tool_choice: round === 0 ? buildAutomaticToolChoice(remainingTools, 'chat', { model, prompt }) : 'auto',
            stream: false,
        });

        const assistantMessage = finalResponse.choices[0]?.message || {};
        const toolCalls = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [];

        if (toolCalls.length === 0) {
            if (toolEvents.length > 0) {
                finalResponse._kimibuilt = {
                    toolEvents,
                };
            }
            return finalResponse;
        }

        const signature = JSON.stringify(toolCalls.map((tc) => ({ name: tc.function?.name, args: tc.function?.arguments })));
        if (seenToolCalls.has(signature)) {
            console.warn('[OpenAI] Endless tool loop detected (duplicate calls), breaking early.');
            if (toolEvents.length > 0) {
                finalResponse._kimibuilt = { toolEvents };
            }
            return finalResponse;
        }
        seenToolCalls.add(signature);

        workingMessages.push({
            role: 'assistant',
            content: assistantMessage.content || '',
            tool_calls: toolCalls.map((toolCall) => normalizeToolCall(toolCall)),
        });

        for (const toolCall of toolCalls) {
            const result = await executeAutomaticToolCall(toolContext.toolManager, toolCall, toolContext);
            toolEvents.push({
                toolCall: normalizeToolCall(toolCall),
                result,
            });
            workingMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(result),
            });
        }
    }

    finalResponse = await openai.chat.completions.create({
        model,
        messages: workingMessages,
        stream: false,
    });

    if (toolEvents.length > 0) {
        finalResponse._kimibuilt = {
            toolEvents,
        };
    }

    return finalResponse;
}

async function runAutomaticToolLoop(openai, {
    model,
    messages,
    toolManager,
    toolContext = {},
}) {
    const prompt = getLastUserText(messages);
    const automaticTools = buildAutomaticToolDefinitions(toolManager, prompt, toolContext);
    const selectedTools = selectAutomaticToolDefinitions(automaticTools, prompt);

    if (selectedTools.length === 0) {
        return null;
    }

    const context = {
        ...toolContext,
        toolManager,
    };

    if (!shouldUseResponsesAPI()) {
        return runAutomaticToolLoopWithChatCompletions(openai, {
            model,
            messages,
            selectedTools,
            toolContext: context,
        });
    }

    try {
        return await runAutomaticToolLoopWithResponses(openai, {
            model,
            messages,
            selectedTools,
            toolContext: context,
        });
    } catch (error) {
        if (!isResponsesApiUnsupportedError(error)) {
            throw error;
        }

        console.warn(`[OpenAI] Responses API tool loop unavailable, falling back to chat completions: ${error.message}`);
        return runAutomaticToolLoopWithChatCompletions(openai, {
            model,
            messages,
            selectedTools,
            toolContext: context,
        });
    }
}

function getChatCompletionText(response) {
    return normalizeMessageContent(response?.choices?.[0]?.message?.content || '');
}

function getModelResponseText(response) {
    return isResponsesApiResponse(response)
        ? getResponseApiText(response)
        : getChatCompletionText(response);
}

function normalizeChatResponse(response) {
    const outputText = getChatCompletionText(response);

    return {
        id: response.id,
        object: 'response',
        created: response.created,
        model: response.model,
        output: [
            {
                type: 'message',
                role: 'assistant',
                content: [
                    {
                        type: 'text',
                        text: outputText,
                    },
                ],
            },
        ],
        session_id: response.session_id,
        metadata: response?._kimibuilt || {},
    };
}

function normalizeModelResponse(response) {
    return isResponsesApiResponse(response)
        ? normalizeResponsesApiResponse(response)
        : normalizeChatResponse(response);
}

async function* normalizeChatCompletionsStream(stream) {
    let responseId = null;
    let model = null;

    for await (const chunk of stream) {
        if (!responseId && chunk.id) {
            responseId = chunk.id;
        }
        if (!model && chunk.model) {
            model = chunk.model;
        }

        const delta = chunk.choices[0]?.delta?.content || '';
        const finishReason = chunk.choices[0]?.finish_reason;

        if (delta) {
            yield {
                type: 'response.output_text.delta',
                delta,
            };
        }

        if (isTerminalFinishReason(finishReason)) {
            yield {
                type: 'response.completed',
                response: {
                    id: responseId,
                    model,
                    output: [],
                    metadata: {},
                },
            };
        }
    }
}

async function* normalizeStreamResponse(stream) {
    for await (const chunk of stream) {
        if (chunk.type === 'response.output_text.delta' && chunk.delta) {
            yield {
                type: 'response.output_text.delta',
                delta: chunk.delta,
            };
        }

        if (chunk.type === 'response.completed' && chunk.response) {
            yield {
                type: 'response.completed',
                response: normalizeResponsesApiResponse(chunk.response),
            };
        }

        if (chunk.type === 'response.failed') {
            throw new Error(chunk.response?.error?.message || 'Response generation failed');
        }
    }
}

async function* synthesizeStreamResponse(response) {
    const responseId = response?.id || `resp_${Date.now()}`;
    const model = response?.model || null;
    const text = getModelResponseText(response);

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
        response: {
            ...normalizeModelResponse({
                ...response,
                id: responseId,
                model,
            }),
        },
    };
}

async function createResponse({
    input,
    previousResponseId = null,
    contextMessages = [],
    recentMessages = [],
    instructions = null,
    stream = false,
    model = null,
    toolManager = null,
    toolContext = {},
    enableAutomaticToolCalls = false,
    executionProfile = 'default',
}) {
    const openai = getClient();
    const messages = buildMessages({
        input,
        instructions,
        contextMessages,
        recentMessages,
    });

    const params = {
        model: model || config.openai.model,
        input: buildResponsesInput(messages),
        stream,
    };
    const prompt = getLastUserText(messages);

    console.log(`[OpenAI] Creating response: model=${params.model}, stream=${stream}, messages=${messages.length}`);
    console.log('[OpenAI] Full params:', JSON.stringify(params, null, 2));

    try {
        if (enableAutomaticToolCalls) {
            const requiredToolId = inferRequiredAutomaticToolId(prompt);

            if (requiredToolId && !toolManager) {
                throw new ToolOrchestrationError(
                    `Required tool '${requiredToolId}' is unavailable because the runtime tool manager is not initialized.`,
                    { model: params.model },
                );
            }
        }

        if (enableAutomaticToolCalls && toolManager) {
            let automaticTools = [];
            try {
                const toolExecutionContext = {
                    executionProfile,
                    previousResponseId,
                    ...toolContext,
                };
                automaticTools = buildAutomaticToolDefinitions(toolManager, prompt, toolExecutionContext);
                const selectedTools = selectAutomaticToolDefinitions(automaticTools, prompt);
                const requiredToolId = inferRequiredAutomaticToolId(prompt, automaticTools.map((tool) => tool.id));

                if (requiredToolId && !selectedTools.some((tool) => tool.id === requiredToolId)) {
                    throw new ToolOrchestrationError(`Required tool '${requiredToolId}' is unavailable for this request. Check tool setup and runtime registration.`, {
                        model: params.model,
                    });
                }

                const directToolResponse = await runDirectRequiredToolAction({
                    toolManager,
                    requiredToolId,
                    selectedTools,
                    prompt,
                    toolContext: toolExecutionContext,
                    model: params.model,
                });

                if (directToolResponse) {
                    console.log(`[OpenAI] Direct required tool execution completed for '${requiredToolId}'`);
                    return stream ? synthesizeStreamResponse(directToolResponse) : normalizeModelResponse(directToolResponse);
                }

                const toolResponse = await runAutomaticToolLoop(openai, {
                    model: params.model,
                    messages,
                    toolManager,
                    toolContext: toolExecutionContext,
                });

                if (toolResponse) {
                    console.log('[OpenAI] Automatic tool orchestration completed');
                    return stream ? synthesizeStreamResponse(toolResponse) : normalizeModelResponse(toolResponse);
                }
            } catch (toolError) {
                console.error('[OpenAI] Automatic tool orchestration failed:', toolError.message);
                const requiredToolId = inferRequiredAutomaticToolId(prompt, automaticTools.map((tool) => tool.id));
                if (requiredToolId) {
                    throw toolError instanceof ToolOrchestrationError
                        ? toolError
                        : new ToolOrchestrationError(toolError.message, {
                            model: params.model,
                            cause: toolError,
                        });
                }
                console.warn(`[OpenAI] Falling back to a plain model response for '${params.model}'`);
            }
        }

        if (shouldUseResponsesAPI()) {
            const response = await openai.responses.create(params);
            return stream ? normalizeStreamResponse(response) : normalizeModelResponse(response);
        }

        const chatParams = {
            model: params.model,
            messages,
            stream,
        };
        const response = await openai.chat.completions.create(chatParams);
        return stream ? normalizeChatCompletionsStream(response) : normalizeChatResponse(response);
    } catch (error) {
        console.error('[OpenAI] Error creating response:', error.message);
        console.error('[OpenAI] Error type:', error.type);
        console.error('[OpenAI] Error code:', error.code);
        throw error;
    }
}

async function generateImage({
    prompt,
    model = null,
    size = '1024x1024',
    quality = 'standard',
    style = 'vivid',
    n = 1,
}) {
    const { modelId, availableModels } = await resolveImageModel(model);
    const selectedModel = availableModels.find((entry) => entry.id === modelId) || getImageModelMetadata(modelId);

    const supportedSizes = Array.isArray(selectedModel.sizes) ? selectedModel.sizes : [];
    const supportedQualities = Array.isArray(selectedModel.qualities) ? selectedModel.qualities : [];
    const supportedStyles = Array.isArray(selectedModel.styles) ? selectedModel.styles : [];

    const params = {
        prompt,
        n: Math.min(n || 1, selectedModel.maxImages || 10),
        size: supportedSizes.includes(size) ? size : (supportedSizes[0] || size || '1024x1024'),
    };

    if (modelId) {
        params.model = modelId;
    }

    if (quality && supportedQualities.includes(quality)) {
        params.quality = quality;
    }

    if (style && supportedStyles.includes(style)) {
        params.style = style;
    }

    console.log(`[OpenAI] Generating image with provider=${getImageProviderConfig().source}, model=${params.model}, size=${params.size}, n=${params.n}`);

    const response = await postImageGeneration(params);

    return {
        created: response.created,
        model: params.model,
        size: params.size,
        quality: params.quality || null,
        style: params.style || null,
        data: (response.data || []).map((image) => ({
            url: toImageUrl(image),
            b64_json: image.b64_json,
            revised_prompt: image.revised_prompt,
        })),
    };
}

module.exports = {
    getClient,
    listModels,
    listImageModels,
    createResponse,
    generateImage,
    __testUtils: {
        buildMessages,
        buildAutomaticToolDefinitions,
        buildAutomaticToolGuidance,
        buildAutomaticToolChoice,
        buildDeterministicPreflightActions,
        buildResponsesInput,
        extractExplicitWebResearchQuery,
        extractRequestedDirectoryPath,
        getResponseApiText,
        normalizeModelResponse,
        normalizeToolResultForModel,
        runDeterministicToolPreflight,
        runDirectRequiredToolAction,
        sanitizeToolSchema,
        selectAutomaticToolDefinitions,
        shouldAutoUseTool,
        promptHasExplicitSshIntent,
        hasUsableSshDefaults,
        isTerminalFinishReason,
        ToolOrchestrationError,
    },
};
