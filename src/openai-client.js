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
    console.log(`[OpenAI] Fetching models from: ${config.openai.baseURL}`);
    
    try {
        const response = await openai.models.list();
        const models = response.data || [];
        console.log(`[OpenAI] Successfully fetched ${models.length} models`);
        
        if (models.length > 0) {
            console.log(`[OpenAI] Available models: ${models.map(m => m.id).join(', ')}`);
        }
        
        return models;
    } catch (err) {
        console.error('[OpenAI] Failed to list models:', err.message);
        console.error('[OpenAI] Error details:', err.code, err.type);
        
        // Return empty array - let frontend handle empty state
        return [];
    }
}

/**
 * Create a response using the OpenAI Chat Completions API.
 * Supports both streaming and non-streaming modes.
 * Compatible with n8n-openai-cli-gateway and standard OpenAI-compatible APIs.
 *
 * @param {Object} options
 * @param {string|Array} options.input - The user message or input array
 * @param {string} [options.previousResponseId] - Previous response ID for conversation continuity (unused, kept for compatibility)
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

    // Build messages array for Chat Completions API
    const messages = [];

    // Add system instructions if provided
    if (instructions) {
        messages.push({
            role: 'system',
            content: instructions,
        });
    }

    // Inject retrieved memories as context
    if (contextMessages.length > 0) {
        messages.push({
            role: 'system',
            content: `[Relevant context from memory]\n${contextMessages.join('\n---\n')}`,
        });
    }

    // Add the actual user input
    if (typeof input === 'string') {
        messages.push({
            role: 'user',
            content: input,
        });
    } else if (Array.isArray(input)) {
        // Input is already an array of messages
        messages.push(...input);
    } else {
        // Single message object
        messages.push(input);
    }

    const params = {
        model: model || config.openai.model,
        messages,
        stream,
    };

    console.log(`[OpenAI] Creating chat completion: model=${params.model}, stream=${stream}, messages=${messages.length}`);

    try {
        const response = await openai.chat.completions.create(params);
        
        // Normalize response format to match what the routes expect
        if (stream) {
            // For streaming, return an async iterable that yields normalized events
            return normalizeStreamResponse(response);
        } else {
            // For non-streaming, wrap the response to match expected format
            return normalizeChatResponse(response);
        }
    } catch (error) {
        console.error('[OpenAI] Error creating chat completion:', error.message);
        console.error('[OpenAI] Error type:', error.type);
        console.error('[OpenAI] Error code:', error.code);
        throw error;
    }
}

/**
 * Normalize Chat Completions API response to match the expected format
 * @param {Object} response - OpenAI chat completion response
 * @returns {Object} Normalized response
 */
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

/**
 * Normalize streaming Chat Completions response to yield expected event format
 * @param {AsyncIterable} stream - OpenAI stream
 * @returns {AsyncGenerator} Normalized events
 */
async function* normalizeStreamResponse(stream) {
    let responseId = null;
    let model = null;
    
    for await (const chunk of stream) {
        // Capture metadata from first chunk
        if (!responseId && chunk.id) {
            responseId = chunk.id;
        }
        if (!model && chunk.model) {
            model = chunk.model;
        }
        
        const delta = chunk.choices[0]?.delta?.content || '';
        const finishReason = chunk.choices[0]?.finish_reason;
        
        // Yield delta event
        if (delta) {
            yield {
                type: 'response.output_text.delta',
                delta,
            };
        }
        
        // Yield completion event
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
