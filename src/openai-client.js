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

const AUTO_TOOL_ALLOWLIST = new Set([
    'web-fetch',
    'web-search',
    'web-scrape',
    'ssh-execute',
    'docker-exec',
    'code-sandbox',
    'security-scan',
    'tool-doc-read',
]);

const AUTO_TOOL_MAX_ROUNDS = 3;
const SYNTHETIC_STREAM_CHUNK_SIZE = 120;

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

function shouldAutoUseTool(toolId, prompt = '', skill = null) {
    const normalizedPrompt = String(prompt || '').toLowerCase();
    if (!normalizedPrompt) {
        return false;
    }

    const hasUrl = /https?:\/\/\S+/i.test(prompt);
    const mentionsCode = /```|function\s+\w+|const\s+\w+|let\s+\w+|class\s+\w+|import\s+|<script\b|SELECT\b|FROM\b/i.test(prompt);

    const heuristics = {
        'web-fetch': hasUrl && /\b(fetch|open|read|inspect|visit|download|load|check|look at)\b/i.test(prompt),
        'web-search': /\b(search|look up|find|latest|recent|news|current|research|what is|who is)\b/i.test(prompt),
        'web-scrape': hasUrl && /\b(scrape|extract|parse|crawl|collect|get data|pull data)\b/i.test(prompt),
        'ssh-execute': /\b(ssh|server|remote host|remote server|remote machine|login to|log into|run on server|execute on server|deploy on server)\b/i.test(prompt),
        'docker-exec': /\b(docker|container|docker exec|run in container|inside container|inside docker)\b/i.test(prompt),
        'code-sandbox': /\b(sandbox|isolated|ephemeral|temp environment|run code|execute code|test this code|try this script)\b/i.test(prompt),
        'security-scan': mentionsCode && /\b(security|vulnerab|secret|audit|scan|xss|sql injection|path traversal)\b/i.test(prompt),
        'tool-doc-read': /\b(tool|tools|skill|skills)\b/i.test(prompt) && /\b(help|docs|documentation|how do i use|what can|capab|setup|parameters|args|usage)\b/i.test(prompt),
    };

    if (heuristics[toolId]) {
        return true;
    }

    if (Array.isArray(skill?.triggerPatterns)) {
        return skill.triggerPatterns.some((pattern) => promptMentionsPattern(normalizedPrompt, pattern));
    }

    return false;
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

function buildAutomaticToolDefinitions(toolManager, prompt = '') {
    if (!toolManager?.registry) {
        return [];
    }

    return Array.from(AUTO_TOOL_ALLOWLIST)
        .map((toolId) => {
            const tool = toolManager.getTool(toolId);
            const skill = toolManager.registry.getSkill(toolId);
            const available = tool && (!skill || skill.enabled !== false);

            if (!available || !shouldAutoUseTool(toolId, prompt, skill)) {
                return null;
            }

            return {
                id: toolId,
                skill,
                definition: {
                    type: 'function',
                    function: {
                        name: toolId,
                        description: tool.description || tool.name || toolId,
                        parameters: sanitizeToolSchema(tool.inputSchema),
                    },
                },
            };
        })
        .filter(Boolean);
}

function buildAutomaticToolGuidance(automaticTools = []) {
    if (!automaticTools.length) {
        return null;
    }

    const guidance = [
        'You can use the provided tools whenever they will improve accuracy or gather missing data.',
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

    if (automaticTools.some((entry) => entry.id === 'ssh-execute')) {
        guidance.push('- Use `ssh-execute` for remote server commands over SSH when the user asks you to inspect, deploy, configure, or troubleshoot a remote host.');
        const sshConfig = settingsController.getEffectiveSshConfig();
        const hasUsableSshDefaults = sshConfig.enabled
            && sshConfig.host
            && sshConfig.username
            && (sshConfig.password || sshConfig.privateKeyPath);

        if (hasUsableSshDefaults) {
            guidance.push(`- SSH defaults are configured for \`${sshConfig.username}@${sshConfig.host}:${sshConfig.port || 22}\`. Use these defaults unless the user asks for a different target.`);
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

async function runAutomaticToolLoop(openai, {
    model,
    messages,
    toolManager,
    toolContext = {},
}) {
    const prompt = getLastUserText(messages);
    const automaticTools = buildAutomaticToolDefinitions(toolManager, prompt);

    if (automaticTools.length === 0) {
        return null;
    }

    const availableTools = automaticTools.map((entry) => entry.definition);
    const workingMessages = [...messages];
    let finalResponse = null;
    const toolGuidance = buildAutomaticToolGuidance(automaticTools);

    if (toolGuidance) {
        workingMessages.push({
            role: 'system',
            content: toolGuidance,
        });
    }

    console.log(`[OpenAI] Automatic tools enabled for prompt. Candidates: ${automaticTools.map((entry) => entry.id).join(', ')}`);

    for (let round = 0; round < AUTO_TOOL_MAX_ROUNDS; round += 1) {
        finalResponse = await openai.chat.completions.create({
            model,
            messages: workingMessages,
            tools: availableTools,
            tool_choice: 'auto',
            stream: false,
        });

        const assistantMessage = finalResponse.choices[0]?.message || {};
        const toolCalls = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [];

        if (toolCalls.length === 0) {
            return finalResponse;
        }

        workingMessages.push({
            role: 'assistant',
            content: assistantMessage.content || '',
            tool_calls: toolCalls.map((toolCall) => normalizeToolCall(toolCall)),
        });

        for (const toolCall of toolCalls) {
            const result = await executeAutomaticToolCall(toolManager, toolCall, toolContext);
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

    return finalResponse;
}

function getChatCompletionText(response) {
    return normalizeMessageContent(response?.choices?.[0]?.message?.content || '');
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
    };
}

async function* normalizeStreamResponse(stream) {
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

        if (finishReason) {
            yield {
                type: 'response.completed',
                response: {
                    id: responseId,
                    model,
                    output: [],
                },
            };
        }
    }
}

async function* synthesizeStreamResponse(response) {
    const responseId = response?.id || `resp_${Date.now()}`;
    const model = response?.model || null;
    const text = getChatCompletionText(response);

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
            id: responseId,
            model,
            output: normalizeChatResponse({
                ...response,
                id: responseId,
                model,
            }).output,
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
        messages,
        stream,
    };

    console.log(`[OpenAI] Creating chat completion: model=${params.model}, stream=${stream}, messages=${messages.length}`);
    console.log('[OpenAI] Full params:', JSON.stringify(params, null, 2));

    try {
        if (enableAutomaticToolCalls && toolManager) {
            try {
                const toolResponse = await runAutomaticToolLoop(openai, {
                    model: params.model,
                    messages,
                    toolManager,
                    toolContext: {
                        previousResponseId,
                        ...toolContext,
                    },
                });

                if (toolResponse) {
                    console.log('[OpenAI] Automatic tool orchestration completed');
                    return stream ? synthesizeStreamResponse(toolResponse) : normalizeChatResponse(toolResponse);
                }
            } catch (toolError) {
                console.error('[OpenAI] Automatic tool orchestration failed:', toolError.message);
                console.warn(`[OpenAI] Falling back to a plain model response for '${params.model}'`);
            }
        }

        const response = await openai.chat.completions.create(params);
        return stream ? normalizeStreamResponse(response) : normalizeChatResponse(response);
    } catch (error) {
        console.error('[OpenAI] Error creating chat completion:', error.message);
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
        normalizeToolResultForModel,
        sanitizeToolSchema,
        shouldAutoUseTool,
        ToolOrchestrationError,
    },
};
