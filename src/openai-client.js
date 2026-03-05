const OpenAI = require('openai');
const { config } = require('./config');

let client = null;

/**
 * Get or create the singleton OpenAI client.
 */
function getClient() {
    if (!client) {
        client = new OpenAI({
            apiKey: config.openai.apiKey,
            baseURL: config.openai.baseURL,
        });
    }
    return client;
}

/**
 * Get list of available models from the API.
 * @returns {Promise<Array>} List of models
 */
async function listModels() {
    const openai = getClient();
    try {
        const response = await openai.models.list();
        return response.data || [];
    } catch (err) {
        console.error('[OpenAI] Failed to list models:', err.message);
        // Return default models if API call fails
        return [
            { id: 'gpt-4o', object: 'model', owned_by: 'openai' },
            { id: 'gpt-4o-mini', object: 'model', owned_by: 'openai' },
            { id: 'gpt-4-turbo', object: 'model', owned_by: 'openai' },
            { id: 'gpt-3.5-turbo', object: 'model', owned_by: 'openai' },
        ];
    }
}

/**
 * Create a response using the OpenAI Response API.
 * Supports both streaming and non-streaming modes.
 *
 * @param {Object} options
 * @param {string} options.input - The user message or input
 * @param {string} [options.previousResponseId] - Previous response ID for conversation continuity
 * @param {string[]} [options.contextMessages] - Additional context (e.g. from memory retrieval)
 * @param {string} [options.instructions] - System-level instructions
 * @param {boolean} [options.stream] - Whether to stream the response
 * @param {string} [options.model] - Model to use (defaults to config.openai.model)
 * @returns {Promise<Object|AsyncIterable>} Response object or stream
 */
async function createResponse({
    input,
    previousResponseId = null,
    contextMessages = [],
    instructions = null,
    stream = false,
    model = null,
}) {
    const openai = getClient();

    // Build input array: context memories + user message
    const inputArray = [];

    // Inject retrieved memories as context
    if (contextMessages.length > 0) {
        inputArray.push({
            role: 'user',
            content: `[Relevant context from memory]\n${contextMessages.join('\n---\n')}`,
        });
    }

    // Add the actual user input
    if (typeof input === 'string') {
        inputArray.push({
            role: 'user',
            content: input,
        });
    } else {
        // Allow pre-structured input arrays
        inputArray.push(...(Array.isArray(input) ? input : [input]));
    }

    const params = {
        model: model || config.openai.model,
        input: inputArray,
    };

    if (previousResponseId) {
        params.previous_response_id = previousResponseId;
    }

    if (instructions) {
        params.instructions = instructions;
    }

    if (stream) {
        params.stream = true;
        return openai.responses.create(params);
    }

    return openai.responses.create(params);
}

/**
 * Generate images using DALL-E or compatible image generation API.
 * 
 * @param {Object} options
 * @param {string} options.prompt - The image description
 * @param {string} [options.model] - Model to use (dall-e-3, dall-e-2)
 * @param {string} [options.size] - Image size (1024x1024, 1024x1792, 1792x1024)
 * @param {string} [options.quality] - Image quality (standard, hd)
 * @param {string} [options.style] - Image style (vivid, natural)
 * @param {number} [options.n] - Number of images (1-10)
 * @returns {Promise<Object>} Image generation response
 */
async function generateImage({
    prompt,
    model = 'dall-e-3',
    size = '1024x1024',
    quality = 'standard',
    style = 'vivid',
    n = 1,
}) {
    const openai = getClient();
    
    const params = {
        model,
        prompt,
        n,
        size,
    };

    // dall-e-3 specific parameters
    if (model === 'dall-e-3') {
        params.quality = quality;
        params.style = style;
    }

    const response = await openai.images.generate(params);
    
    return {
        created: response.created,
        data: response.data.map(img => ({
            url: img.url,
            b64_json: img.b64_json,
            revised_prompt: img.revised_prompt,
        })),
    };
}

module.exports = { getClient, listModels, createResponse, generateImage };
