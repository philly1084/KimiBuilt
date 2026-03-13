/**
 * API Client for KimiBuilt Notes Notion
 * Mirrors web-chat API client for making AI calls to the backend
 * Supports streaming chat, model fetching, and health checks
 */

// ============================================
// Configuration
// ============================================

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const CURRENT_HOSTNAME = window.location.hostname;
const CURRENT_ORIGIN = `${window.location.protocol}//${window.location.host}`;

const API_BASE_URL = LOCAL_HOSTNAMES.has(CURRENT_HOSTNAME)
    ? 'http://localhost:3000/v1'
    : `${CURRENT_ORIGIN}/v1`;

const BASE_URL_WITHOUT_API = LOCAL_HOSTNAMES.has(CURRENT_HOSTNAME)
    ? 'http://localhost:3000'
    : CURRENT_ORIGIN;

// Retry configuration
const RETRY_CONFIG = {
    maxRetries: 3,
    retryDelay: 1000, // Initial delay in ms
    retryMultiplier: 2,
    maxDelay: 10000
};

// ============================================
// Utility Functions
// ============================================

/**
 * Sleep utility for retry delays
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate retry delay with exponential backoff
 */
function getRetryDelay(attempt) {
    const delay = RETRY_CONFIG.retryDelay * Math.pow(RETRY_CONFIG.retryMultiplier, attempt);
    return Math.min(delay, RETRY_CONFIG.maxDelay);
}

/**
 * Determine if an error is retryable
 */
function isRetryableError(error) {
    // Network errors are retryable
    if (error.name === 'TypeError' || error.name === 'NetworkError' || error.message?.includes('fetch')) {
        return true;
    }
    // 5xx server errors are retryable
    if (error.status >= 500 || error.status === 429) {
        return true;
    }
    // 4xx errors (except 429) are not retryable
    if (error.status >= 400 && error.status < 500) {
        return false;
    }
    return true;
}

/**
 * Parse error response to get user-friendly message
 */
function parseErrorMessage(error, response) {
    // Handle specific HTTP status codes
    if (response?.status === 400) {
        return 'Invalid request. Please check your message format and try again.';
    }
    if (response?.status === 401) {
        return 'Authentication failed. Please check your API key.';
    }
    if (response?.status === 403) {
        return 'Access denied. You may not have permission to use this feature.';
    }
    if (response?.status === 404) {
        return 'The requested resource was not found.';
    }
    if (response?.status === 429) {
        return 'Rate limit exceeded. Please wait a moment and try again.';
    }
    if (response?.status >= 500) {
        return 'Server error. Please try again later.';
    }
    
    // Network errors
    if (error.name === 'AbortError') {
        return 'Request was cancelled.';
    }
    if (error.name === 'TypeError' || error.message?.includes('fetch')) {
        return 'Network error. Please check your connection and try again.';
    }
    
    return error.message || 'An unexpected error occurred';
}

// ============================================
// NotesAPIClient Class
// ============================================

class NotesAPIClient {
    constructor() {
        this.currentSessionId = null;
        this.modelsCache = null;
        this.modelsCacheExpiry = null;
        this.modelsCacheDuration = 5 * 60 * 1000; // 5 minutes
        this.retryCount = 0;
        this.abortControllers = new Map(); // Track abort controllers for cancellation
    }

    // ============================================
    // Chat Methods
    // ============================================

    /**
     * Stream chat completions using Server-Sent Events (SSE)
     * @param {Array} messages - Array of messages in OpenAI format [{role, content}, ...]
     * @param {string} model - Model ID to use (default: 'gpt-4o')
     * @param {AbortSignal} signal - Optional abort signal for cancellation
     * @returns {AsyncGenerator} - Yields { type: 'delta', content }, { type: 'done' }, or { type: 'error', error }
     * 
     * @example
     * const client = new NotesAPIClient();
     * for await (const chunk of client.streamChat(messages, 'gpt-4o')) {
     *     if (chunk.type === 'delta') console.log(chunk.content);
     * }
     */
    async *streamChat(messages, model = 'gpt-4o', signal = null) {
        const params = {
            model,
            messages,
            stream: true,
        };
        
        // Include session ID if available and not a local session
        if (this.currentSessionId && !String(this.currentSessionId).startsWith('local_')) {
            params.session_id = this.currentSessionId;
        }

        // Create abort controller for this request
        const controller = new AbortController();
        const requestId = Date.now().toString();
        this.abortControllers.set(requestId, controller);
        
        // Link external signal if provided
        if (signal) {
            signal.addEventListener('abort', () => controller.abort());
        }

        try {
            yield* this._streamWithFetch(params, controller.signal, requestId);
        } finally {
            this.abortControllers.delete(requestId);
        }
    }

    /**
     * Internal method to stream chat using fetch with retry logic
     * @private
     */
    async *_streamWithFetch(params, signal, requestId) {
        let lastError = null;
        
        for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
            try {
                // Retry delay (except for first attempt)
                if (attempt > 0) {
                    const delay = getRetryDelay(attempt - 1);
                    console.log(`Retrying stream chat (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}) after ${delay}ms`);
                    yield { type: 'retry', attempt: attempt + 1, maxAttempts: RETRY_CONFIG.maxRetries + 1 };
                    await sleep(delay);
                }

                const response = await fetch(`${API_BASE_URL}/chat/completions`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Accept': 'text/event-stream'
                    },
                    body: JSON.stringify(params),
                    signal: signal
                });
                
                if (!response.ok) {
                    const error = new Error(`HTTP ${response.status}`);
                    error.status = response.status;
                    error.response = response;
                    
                    // Try to get error details from response
                    try {
                        const errorData = await response.json();
                        error.details = errorData;
                    } catch (e) {
                        // Ignore parsing errors
                    }
                    
                    throw error;
                }

                // Track session ID from response headers
                const responseSessionId = response.headers.get('X-Session-Id');
                if (responseSessionId) {
                    this.currentSessionId = responseSessionId;
                }
                
                // Set up SSE reading
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || ''; // Keep incomplete line in buffer
                        
                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                const data = line.slice(6);
                                
                                // Check for stream termination
                                if (data === '[DONE]') {
                                    yield { type: 'done', sessionId: this.currentSessionId };
                                    return;
                                }
                                
                                try {
                                    const parsed = JSON.parse(data);
                                    
                                    // Check for error in stream
                                    if (parsed.error) {
                                        throw new Error(parsed.error.message || 'Stream error');
                                    }
                                    
                                    // Extract content from delta
                                    const content = parsed.choices?.[0]?.delta?.content || '';
                                    if (content) {
                                        yield { type: 'delta', content };
                                    }
                                    
                                    // Check if generation is complete
                                    if (parsed.choices?.[0]?.finish_reason) {
                                        yield { type: 'done', sessionId: this.currentSessionId };
                                        return;
                                    }
                                } catch (e) {
                                    if (e.message !== 'Stream error') {
                                        // Ignore JSON parse errors for malformed chunks
                                        console.warn('Failed to parse stream chunk:', e);
                                    } else {
                                        throw e;
                                    }
                                }
                            }
                        }
                    }
                } finally {
                    reader.releaseLock();
                }
                
                // Success - reset retry count
                this.retryCount = 0;
                yield { type: 'done', sessionId: this.currentSessionId };
                return;
                
            } catch (error) {
                lastError = error;
                
                // Don't retry if aborted
                if (error.name === 'AbortError') {
                    yield { type: 'error', error: 'Request cancelled', cancelled: true };
                    return;
                }
                
                // Don't retry non-retryable errors
                if (!isRetryableError(error)) {
                    const message = parseErrorMessage(error, error.response);
                    yield { type: 'error', error: message, status: error.status, details: error.details };
                    yield { type: 'done', sessionId: this.currentSessionId };
                    return;
                }
                
                // Last attempt failed
                if (attempt === RETRY_CONFIG.maxRetries) {
                    const message = parseErrorMessage(error, error.response);
                    yield { type: 'error', error: message, status: error.status, details: error.details, retriesExhausted: true };
                    yield { type: 'done', sessionId: this.currentSessionId };
                    return;
                }
            }
        }
    }

    /**
     * Non-streaming chat completion
     * @param {Array} messages - Array of messages in OpenAI format
     * @param {string} model - Model ID to use (default: 'gpt-4o')
     * @returns {Promise<Object>} - Response with { content, sessionId, error? }
     * 
     * @example
     * const client = new NotesAPIClient();
     * const response = await client.chat(messages, 'gpt-4o');
     * console.log(response.content);
     */
    async chat(messages, model = 'gpt-4o') {
        const params = {
            model,
            messages,
            stream: false,
        };
        
        // Include session ID if available and not a local session
        if (this.currentSessionId && !String(this.currentSessionId).startsWith('local_')) {
            params.session_id = this.currentSessionId;
        }

        let lastError = null;
        
        for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
            try {
                // Retry delay (except for first attempt)
                if (attempt > 0) {
                    const delay = getRetryDelay(attempt - 1);
                    await sleep(delay);
                }

                const response = await fetch(`${API_BASE_URL}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(params),
                });
                
                if (!response.ok) {
                    const error = new Error(`HTTP ${response.status}`);
                    error.status = response.status;
                    error.response = response;
                    throw error;
                }
                
                const data = await response.json();
                
                // Track session ID from response
                if (data.session_id || data.sessionId) {
                    this.currentSessionId = data.session_id || data.sessionId;
                }
                
                return {
                    content: data.choices?.[0]?.message?.content || '',
                    sessionId: this.currentSessionId,
                };
                
            } catch (error) {
                lastError = error;
                
                // Don't retry non-retryable errors or if exhausted
                if (!isRetryableError(error) || attempt === RETRY_CONFIG.maxRetries) {
                    return {
                        content: `[Error: ${parseErrorMessage(error)}]`,
                        sessionId: this.currentSessionId,
                        error: true
                    };
                }
            }
        }
    }

    // ============================================
    // Model API
    // ============================================

    /**
     * Fetch available models with caching
     * @param {boolean} forceRefresh - Force refresh the cache
     * @returns {Promise<Object>} - List of available models
     * 
     * @example
     * const client = new NotesAPIClient();
     * const models = await client.getModels();
     * console.log(models.data);
     */
    async getModels(forceRefresh = false) {
        // Check in-memory cache first
        if (!forceRefresh && this.modelsCache && this.modelsCacheExpiry > Date.now()) {
            return this.modelsCache;
        }

        // Check localStorage cache (wrapped for Tracking Prevention compatibility)
        if (!forceRefresh) {
            let cached, cachedExpiry;
            try {
                cached = localStorage.getItem('notes_api_models_cache');
                cachedExpiry = localStorage.getItem('notes_api_models_cache_expiry');
            } catch (e) {
                // localStorage blocked by Tracking Prevention
                cached = null;
                cachedExpiry = null;
            }
            
            if (cached && cachedExpiry && parseInt(cachedExpiry) > Date.now()) {
                try {
                    this.modelsCache = JSON.parse(cached);
                    this.modelsCacheExpiry = parseInt(cachedExpiry);
                    return this.modelsCache;
                } catch (e) {
                    console.warn('Failed to parse cached models');
                }
            }
        }

        // Fetch from API
        try {
            const response = await fetch(`${API_BASE_URL}/models`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            // Format response to match OpenAI API structure
            const formattedData = {
                object: 'list',
                data: data.data || [],
            };
            
            // Update cache
            this.modelsCache = formattedData;
            this.modelsCacheExpiry = Date.now() + this.modelsCacheDuration;
            
            // Save to localStorage (wrapped for Tracking Prevention compatibility)
            try {
                localStorage.setItem('notes_api_models_cache', JSON.stringify(formattedData));
                localStorage.setItem('notes_api_models_cache_expiry', String(this.modelsCacheExpiry));
            } catch (e) {
                // localStorage blocked by Tracking Prevention - continue without caching
            }
            
            return formattedData;
            
        } catch (error) {
            console.error('Failed to fetch models:', error);
            
            // Return cached models if available
            if (this.modelsCache) {
                return this.modelsCache;
            }
            
            // Return default models as fallback
            return this.getDefaultModels();
        }
    }

    /**
     * Get default models as fallback
     * @private
     */
    getDefaultModels() {
        return {
            object: 'list',
            data: [
                { id: 'gpt-4o', object: 'model', created: Date.now(), owned_by: 'openai' },
                { id: 'gpt-4o-mini', object: 'model', created: Date.now(), owned_by: 'openai' },
                { id: 'claude-3-opus', object: 'model', created: Date.now(), owned_by: 'anthropic' },
                { id: 'claude-3-sonnet', object: 'model', created: Date.now(), owned_by: 'anthropic' }
            ]
        };
    }

    // ============================================
    // Utility Methods
    // ============================================

    /**
     * Check backend health
     * @returns {Promise<Object>} - { connected: boolean, data?, error? }
     * 
     * @example
     * const client = new NotesAPIClient();
     * const health = await client.checkHealth();
     * if (health.connected) console.log('Backend is healthy');
     */
    async checkHealth() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`${BASE_URL_WITHOUT_API}/health`, {
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                const data = await response.json();
                return { connected: true, data };
            }
            return { connected: false, error: 'Health check failed' };
        } catch (error) {
            return { connected: false, error: error.message };
        }
    }

    /**
     * Cancel an ongoing request
     * @param {string} requestId - The request ID to cancel
     * @returns {boolean} - True if cancelled, false if not found
     */
    cancelRequest(requestId) {
        const controller = this.abortControllers.get(requestId);
        if (controller) {
            controller.abort();
            this.abortControllers.delete(requestId);
            return true;
        }
        return false;
    }

    /**
     * Cancel all ongoing requests
     */
    cancelAllRequests() {
        for (const [requestId, controller] of this.abortControllers) {
            controller.abort();
        }
        this.abortControllers.clear();
    }

    /**
     * Clear the models cache
     */
    clearModelsCache() {
        this.modelsCache = null;
        this.modelsCacheExpiry = null;
        try {
            localStorage.removeItem('notes_api_models_cache');
            localStorage.removeItem('notes_api_models_cache_expiry');
        } catch (e) {
            // localStorage blocked - nothing to clear
        }
    }

    /**
     * Set the current session ID
     * @param {string} sessionId - The session ID to set
     */
    setSessionId(sessionId) {
        this.currentSessionId = sessionId;
    }

    /**
     * Get the current session ID
     * @returns {string|null} - The current session ID
     */
    getSessionId() {
        return this.currentSessionId;
    }

    /**
     * Filter models to only include chat models
     * @param {Array} models - Array of model objects
     * @returns {Array} - Filtered models
     */
    filterChatModels(models = []) {
        return models.filter((model) => {
            const id = String(model.id || '').toLowerCase();
            if (!id) return false;

            const looksLikeChatModel = [
                'gpt',
                'claude',
                'gemini',
                'kimi',
                'llama',
                'mistral',
                'qwen',
                'phi',
                'ollama',
                'antigravity',
            ].some((token) => id.includes(token));

            return looksLikeChatModel && !id.includes('image');
        });
    }
}

// ============================================
// Export
// ============================================

// Export for ES modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NotesAPIClient };
}

// Make available globally for browser
if (typeof window !== 'undefined') {
    window.NotesAPIClient = NotesAPIClient;
}
