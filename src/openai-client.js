const OpenAI = require('openai');
const { config } = require('./config');

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

function normalizeChatResponse(response) {
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
                        text: response.choices[0]?.message?.content || '',
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

async function createResponse({
    input,
    previousResponseId = null,
    contextMessages = [],
    instructions = null,
    stream = false,
    model = null,
}) {
    const openai = getClient();
    const messages = [];

    if (instructions) {
        messages.push({
            role: 'system',
            content: instructions,
        });
    }

    if (contextMessages.length > 0) {
        messages.push({
            role: 'system',
            content: `[Relevant context from memory]\n${contextMessages.join('\n---\n')}`,
        });
    }

    if (typeof input === 'string') {
        messages.push({
            role: 'user',
            content: input,
        });
    } else if (Array.isArray(input)) {
        messages.push(...input);
    } else {
        messages.push(input);
    }

    const params = {
        model: model || config.openai.model,
        messages,
        stream,
    };

    console.log(`[OpenAI] Creating chat completion: model=${params.model}, stream=${stream}, messages=${messages.length}`);
    console.log('[OpenAI] Full params:', JSON.stringify(params, null, 2));

    try {
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
};
