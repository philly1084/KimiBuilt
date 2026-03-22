const OpenAI = require('openai');
const { config } = require('./config');
const settingsController = require('./routes/admin/settings.controller');

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
    'ssh-execute',
    'docker-exec',
    'code-sandbox',
    'security-scan',
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

    return null;
}

function shouldAutoUseTool(toolId, prompt = '', skill = null, options = {}) {
    const executionProfile = normalizeExecutionProfile(
        options?.executionProfile
        || options?.toolContext?.executionProfile,
    );

    if (toolId === 'ssh-execute' || toolId === 'remote-command') {
        return promptHasExplicitSshIntent(prompt)
            || (executionProfile === 'remote-build' && hasUsableSshDefaults());
    }
    return true;
}

function extractExplicitWebResearchQuery(prompt = '') {
    const text = String(prompt || '').trim();
    if (!text) {
        return null;
    }

    const patterns = [
        /\bweb research\s+(.+?)(?:[.?!]\s|[\r\n]|$)/i,
        /\bresearch\s+(.+?)(?:[.?!]\s|[\r\n]|$)/i,
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

    return null;
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

function buildDeterministicPreflightActions(automaticTools = [], prompt = '') {
    const availableToolIds = new Set(automaticTools.map((entry) => entry.id));
    const actions = [];
    const webQuery = availableToolIds.has('web-search')
        ? extractExplicitWebResearchQuery(prompt)
        : null;
    const directoryPath = availableToolIds.has('file-mkdir')
        ? extractRequestedDirectoryPath(prompt)
        : null;
    const sshCommand = availableToolIds.has('ssh-execute')
        ? extractRequestedSshCommand(prompt)
        : null;
    const sshTarget = availableToolIds.has('ssh-execute')
        ? extractExplicitSshTarget(prompt)
        : null;

    if (webQuery) {
        actions.push({
            toolId: 'web-search',
            params: {
                query: webQuery,
                limit: 5,
                region: 'us-en',
                timeRange: 'all',
                includeSnippets: true,
                includeUrls: true,
            },
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

    if (sshCommand && promptHasExplicitSshIntent(prompt)) {
        actions.push({
            toolId: 'ssh-execute',
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

    return Array.from(AUTO_TOOL_ALLOWLIST)
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

    const selectedIds = new Set();
    const normalizedPrompt = String(prompt || '').toLowerCase();
    const hasUrl = /https?:\/\//i.test(normalizedPrompt);
    const hasExplicitScrapeIntent = /\b(scrape|extract|selector|structured|parse)\b/i.test(normalizedPrompt);
    const hasWebResearchIntent = Boolean(
        extractExplicitWebResearchQuery(prompt)
        || /\b(latest|current|today|news|web research|research|look up|search for|search the web|browse)\b/i.test(normalizedPrompt)
    );
    const hasImageIntent = /\b(image|images|visual|visuals|illustration|illustrations|photo|photos|hero image|background image|cover image)\b/i.test(normalizedPrompt);
    const hasUnsplashIntent = /\bunsplash\b/i.test(normalizedPrompt);
    const hasDirectImageUrl = /https?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg)(?:\?\S*)?/i.test(normalizedPrompt);

    if (hasWebResearchIntent) {
        selectedIds.add('web-search');
    }

    if (hasExplicitScrapeIntent) {
        selectedIds.add('web-search');
        selectedIds.add('web-scrape');
    }

    if (hasUrl) {
        if (hasExplicitScrapeIntent) {
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

    if (extractRequestedDirectoryPath(prompt)) {
        selectedIds.add('file-mkdir');
    }

    if (/\b(read|open|show|print|cat)\b[\s\S]{0,40}\bfile\b/i.test(normalizedPrompt)) {
        selectedIds.add('file-read');
    }

    if (/\b(write|save|create|update|edit)\b[\s\S]{0,40}\bfile\b/i.test(normalizedPrompt)) {
        selectedIds.add('file-write');
    }

    if (/\b(find|search|locate|list)\b[\s\S]{0,40}\bfiles?\b/i.test(normalizedPrompt)) {
        selectedIds.add('file-search');
    }

    if (promptHasExplicitSshIntent(prompt)) {
        selectedIds.add('ssh-execute');
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

function buildAutomaticToolChoice(selectedTools = [], api = 'responses') {
    if (!selectedTools.length) {
        return 'none';
    }

    if (selectedTools.length === 1) {
        return api === 'chat'
            ? {
                type: 'function',
                function: {
                    name: selectedTools[0].id,
                },
            }
            : {
                type: 'function',
                name: selectedTools[0].id,
            };
    }

    return 'auto';
}

function inferRequiredAutomaticToolId(prompt = '') {
    if (promptHasExplicitSshIntent(prompt)) {
        return 'ssh-execute';
    }

    if (extractExplicitWebResearchQuery(prompt)) {
        return 'web-search';
    }

    if (extractRequestedDirectoryPath(prompt)) {
        return 'file-mkdir';
    }

    return null;
}

function buildAutomaticToolGuidance(automaticTools = []) {
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
    }

    if (automaticTools.some((entry) => entry.id === 'web-fetch')) {
        guidance.push('- Use `web-fetch` for simple static page retrieval when you only need raw content from a URL.');
    }

    if (automaticTools.some((entry) => entry.id === 'web-scrape')) {
        guidance.push('- Use `web-scrape` when the user asks to extract fields from a page. Set `browser: true` or `javascript: true` for dynamic sites, certificate/TLS issues, or rendered DOM content. Use `selectors` to pull structured fields and `waitForSelector` when a page must finish rendering.');
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
        guidance.push('- Use `file-write` to create or update files when the user asks for filesystem changes.');
    }

    if (automaticTools.some((entry) => entry.id === 'file-mkdir')) {
        guidance.push('- Use `file-mkdir` to create folders or directories when the user asks for them.');
    }

    if (automaticTools.some((entry) => entry.id === 'ssh-execute')) {
        guidance.push('- Use `ssh-execute` for remote server commands over SSH when the user asks you to inspect, deploy, configure, or troubleshoot a remote host.');
        guidance.push('- Do not refer to internal tool names like `run_shell_command` or claim you lack generic shell access when `ssh-execute` is attached.');
        guidance.push('- If `ssh-execute` fails, explain the actual SSH error from the tool result and ask only for the missing host or credentials if needed.');
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

    if (automaticTools.some((entry) => entry.id === 'code-sandbox')) {
        guidance.push('- Use `code-sandbox` to run code in an isolated environment when you need to verify behavior without modifying the main system.');
    }

    if (automaticTools.some((entry) => entry.id === 'security-scan')) {
        guidance.push('- Use `security-scan` for code audits, secret detection, and vulnerability checks when code is present.');
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
        toolEvents.push({
            toolCall: normalizeToolCall(toolCall),
            result,
        });
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

    if (toolId === 'ssh-execute') {
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
    if (requiredToolId !== 'ssh-execute') {
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
    const toolGuidance = buildAutomaticToolGuidance(selectedTools);
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
            tool_choice: round === 0 ? buildAutomaticToolChoice(remainingTools, 'responses') : 'auto',
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
    const toolGuidance = buildAutomaticToolGuidance(selectedTools);
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
            tool_choice: round === 0 ? buildAutomaticToolChoice(remainingTools, 'chat') : 'auto',
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
            try {
                const toolExecutionContext = {
                    executionProfile,
                    previousResponseId,
                    ...toolContext,
                };
                const automaticTools = buildAutomaticToolDefinitions(toolManager, prompt, toolExecutionContext);
                const selectedTools = selectAutomaticToolDefinitions(automaticTools, prompt);
                const requiredToolId = inferRequiredAutomaticToolId(prompt);

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
                if (inferRequiredAutomaticToolId(prompt)) {
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
