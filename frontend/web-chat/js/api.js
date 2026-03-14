/**
 * API Client for KimiBuilt AI Chat using OpenAI SDK
 * Handles API communication with the KimiBuilt backend
 */

// Configuration
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const CURRENT_HOSTNAME = window.location.hostname;
const CURRENT_ORIGIN = `${window.location.protocol}//${window.location.host}`;

const API_BASE_URL = LOCAL_HOSTNAMES.has(CURRENT_HOSTNAME)
    ? 'http://localhost:3000/v1'
    : `${CURRENT_ORIGIN}/v1`;
const API_KEY = 'any-key'; // Required by SDK but not validated by KimiBuilt
const BASE_URL_WITHOUT_API = API_BASE_URL.replace('/v1', '');

// Retry configuration
const RETRY_CONFIG = {
    maxRetries: 3,
    retryDelay: 1000, // Initial delay in ms
    retryMultiplier: 2,
    maxDelay: 10000
};

class OpenAIAPIClient extends EventTarget {
    constructor() {
        super();
        this.client = null;
        this.currentSessionId = null;
        this.modelsCache = null;
        this.modelsCacheExpiry = null;
        this.modelsCacheDuration = 5 * 60 * 1000; // 5 minutes
        this.retryCount = 0;
        this.abortControllers = new Map(); // Track abort controllers for cancellation
        
        // Initialize OpenAI client
        this.initClient();
    }
    
    initClient() {
        // Use fetch-only in the browser to avoid third-party SDK/CORS/tracking issues.
        this.client = null;
    }

    /**
     * Sleep utility for retry delays
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Calculate retry delay with exponential backoff
     */
    getRetryDelay(attempt) {
        const delay = RETRY_CONFIG.retryDelay * Math.pow(RETRY_CONFIG.retryMultiplier, attempt);
        return Math.min(delay, RETRY_CONFIG.maxDelay);
    }

    /**
     * Determine if an error is retryable
     */
    isRetryableError(error) {
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
    parseErrorMessage(error, response) {
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
    // Chat Methods
    // ============================================

    /**
     * Stream chat with the AI using OpenAI SDK or fetch fallback
     * @param {Array} messages - Array of messages in OpenAI format [{role, content}, ...]
     * @param {string} model - Model ID to use
     * @param {AbortSignal} signal - Optional abort signal for cancellation
     * @returns {AsyncGenerator} - Yields delta content
     */
    async *streamChat(messages, model = 'gpt-4o', signal = null) {
        const params = {
            model,
            messages,
            stream: true,
        };
        
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
            // Use fetch if SDK not available
            if (!this.client) {
                yield* this.streamChatWithFetch(params, controller.signal, requestId);
                return;
            }

            yield* this.streamChatWithSDK(params, controller.signal, requestId);
        } finally {
            this.abortControllers.delete(requestId);
        }
    }

    /**
     * Stream chat using fetch fallback with retry logic
     */
    async *streamChatWithFetch(params, signal, requestId) {
        let lastError = null;
        
        for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    const delay = this.getRetryDelay(attempt - 1);
                    console.log(`Retrying stream chat (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}) after ${delay}ms`);
                    yield { type: 'retry', attempt: attempt + 1, maxAttempts: RETRY_CONFIG.maxRetries + 1 };
                    await this.sleep(delay);
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

                const responseSessionId = response.headers.get('X-Session-Id');
                if (responseSessionId) {
                    this.currentSessionId = responseSessionId;
                }
                
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
                                    
                                    const content = parsed.choices?.[0]?.delta?.content || '';
                                    if (content) {
                                        yield { type: 'delta', content };
                                    }
                                    
                                    // Check finish reason
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
                if (!this.isRetryableError(error)) {
                    const message = this.parseErrorMessage(error, error.response);
                    yield { type: 'error', error: message, status: error.status, details: error.details };
                    yield { type: 'done', sessionId: this.currentSessionId };
                    return;
                }
                
                // Last attempt failed
                if (attempt === RETRY_CONFIG.maxRetries) {
                    const message = this.parseErrorMessage(error, error.response);
                    yield { type: 'error', error: message, status: error.status, details: error.details, retriesExhausted: true };
                    yield { type: 'done', sessionId: this.currentSessionId };
                    return;
                }
            }
        }
    }

    /**
     * Stream chat using OpenAI SDK
     */
    async *streamChatWithSDK(params, signal, requestId) {
        try {
            const stream = await this.client.chat.completions.create(params, {
                signal: signal
            });
            
            for await (const chunk of stream) {
                // Check if aborted
                if (signal?.aborted) {
                    yield { type: 'error', error: 'Request cancelled', cancelled: true };
                    yield { type: 'done', sessionId: this.currentSessionId };
                    return;
                }
                
                const content = chunk.choices[0]?.delta?.content || '';
                if (content) {
                    yield {
                        type: 'delta',
                        content,
                    };
                }
                
                if (chunk.session_id) {
                    this.currentSessionId = chunk.session_id;
                }
                
                if (chunk.choices[0]?.finish_reason) {
                    yield {
                        type: 'done',
                        sessionId: this.currentSessionId,
                    };
                    return;
                }
            }
            
            // Ensure we always send done
            yield { type: 'done', sessionId: this.currentSessionId };
        } catch (error) {
            if (error.name === 'AbortError') {
                yield { type: 'error', error: 'Request cancelled', cancelled: true };
            } else {
                const message = this.parseErrorMessage(error);
                yield { type: 'error', error: message };
            }
            yield { type: 'done', sessionId: this.currentSessionId };
        }
    }

    /**
     * Cancel an ongoing request
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
     * Non-streaming chat with the AI
     * @param {Array} messages - Array of messages in OpenAI format
     * @param {string} model - Model ID to use
     * @returns {Object} - Response with content and sessionId
     */
    async chat(messages, model = 'gpt-4o') {
        const params = {
            model,
            messages,
            stream: false,
        };
        
        if (this.currentSessionId && !String(this.currentSessionId).startsWith('local_')) {
            params.session_id = this.currentSessionId;
        }

        // Use fetch if SDK not available
        if (!this.client) {
            return this.chatWithFetch(params);
        }

        try {
            const response = await this.client.chat.completions.create(params);
            
            if (response.session_id) {
                this.currentSessionId = response.session_id;
            }
            
            return {
                content: response.choices[0]?.message?.content || '',
                sessionId: this.currentSessionId,
            };
        } catch (error) {
            console.error('Chat error:', error);
            return {
                content: `[Error: ${this.parseErrorMessage(error)}]`,
                sessionId: this.currentSessionId,
                error: true
            };
        }
    }

    /**
     * Non-streaming chat with fetch fallback and retry
     */
    async chatWithFetch(params) {
        let lastError = null;
        
        for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    const delay = this.getRetryDelay(attempt - 1);
                    await this.sleep(delay);
                }

                const response = await fetch(`${API_BASE_URL}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(params),
                });
                
                if (!response.ok) {
                    const error = new Error(`HTTP ${response.status}`);
                    error.status = response.status;
                    throw error;
                }
                
                const data = await response.json();
                
                if (data.session_id || data.sessionId) {
                    this.currentSessionId = data.session_id || data.sessionId;
                }
                
                return {
                    content: data.choices?.[0]?.message?.content || '',
                    sessionId: this.currentSessionId,
                };
            } catch (error) {
                lastError = error;
                
                if (!this.isRetryableError(error) || attempt === RETRY_CONFIG.maxRetries) {
                    return {
                        content: `[Error: ${this.parseErrorMessage(error)}]`,
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

    async getModels(forceRefresh = false) {
        // Check cache first
        if (!forceRefresh && this.modelsCache && this.modelsCacheExpiry > Date.now()) {
            return this.modelsCache;
        }

        // Check localStorage cache (wrapped for Tracking Prevention compatibility)
        if (!forceRefresh) {
            let cached, cachedExpiry;
            try {
                cached = localStorage.getItem('kimibuilt_models_cache');
                cachedExpiry = localStorage.getItem('kimibuilt_models_cache_expiry');
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

        // Try fetch first if SDK not available
        if (!this.client) {
            try {
                const response = await fetch(`${API_BASE_URL}/models`);
                if (response.ok) {
                    const data = await response.json();
                    this.modelsCache = data;
                    this.modelsCacheExpiry = Date.now() + this.modelsCacheDuration;
                    return data;
                }
            } catch (e) {
                console.warn('Fetch fallback failed:', e);
            }
            return this.getDefaultModels();
        }

        try {
            const response = await this.client.models.list();
            
            // Format response to match OpenAI API structure
            const data = {
                object: 'list',
                data: response.data || [],
            };
            
            // Update cache
            this.modelsCache = data;
            this.modelsCacheExpiry = Date.now() + this.modelsCacheDuration;
            
            // Save to localStorage (wrapped for Tracking Prevention compatibility)
            try {
                localStorage.setItem('kimibuilt_models_cache', JSON.stringify(data));
                localStorage.setItem('kimibuilt_models_cache_expiry', String(this.modelsCacheExpiry));
            } catch (e) {
                // localStorage blocked by Tracking Prevention - continue without caching
            }
            
            return data;
        } catch (error) {
            console.error('Failed to fetch models:', error);
            
            // Return cached models if available
            if (this.modelsCache) {
                return this.modelsCache;
            }
            
            return this.getDefaultModels();
        }
    }

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

    async getImageModels() {
        const baseUrl = API_BASE_URL.replace('/v1', '');

        try {
            const response = await fetch(`${baseUrl}/api/images/models`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            return {
                object: 'list',
                data: (data.models || []).map((model) => ({
                    id: model.id,
                    object: 'model',
                    created: Date.now(),
                    owned_by: model.owned_by || 'openai',
                    metadata: model,
                })),
            };
        } catch (error) {
            console.warn('[API] Failed to fetch image models:', error.message);
            return {
                object: 'list',
                data: [
                    { id: '', object: 'model', created: Date.now(), owned_by: 'openai', metadata: { id: '', name: 'Gateway Default', sizes: ['1024x1024'], qualities: [], styles: [] } },
                ],
            };
        }
    }

    // ============================================
    // Image Generation API
    // ============================================

    /**
     * Generate images using the backend API
     * POST /api/images
     * @param {Object} options - Image generation options
     * @param {string} options.prompt - Image prompt (required)
     * @param {string} options.model - Model to use (optional, default: 'dall-e-3')
     * @param {string} options.size - Image size (optional, default: '1024x1024')
     * @param {string} options.quality - Image quality (optional, default: 'standard')
     * @param {string} options.style - Image style (optional, default: 'vivid')
     * @param {number} options.n - Number of images (optional, default: 1)
     * @param {string} options.sessionId - Session ID (optional)
     * @returns {Promise<Object>} - { sessionId, created, data: [{ url, revised_prompt }], model, size, quality, style }
     */
    async generateImage(options = {}) {
        const {
            prompt,
            model = null,
            size = '1024x1024',
            quality = 'standard',
            style = 'vivid',
            n = 1,
            sessionId = null
        } = options;

        const params = {
            prompt,
            model,
            size,
            quality,
            style,
            n: n || 1,
        };

        if (sessionId || this.currentSessionId) {
            params.sessionId = sessionId || this.currentSessionId;
        }

        let lastError = null;
        
        // Extract base URL without /v1
        const baseUrl = API_BASE_URL.replace('/v1', '');
        
        for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    await this.sleep(this.getRetryDelay(attempt - 1));
                }

                const response = await fetch(`${baseUrl}/api/images`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(params),
                });
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    const error = new Error(errorData.error?.message || `HTTP ${response.status}`);
                    error.status = response.status;
                    error.response = errorData;
                    throw error;
                }
                
                const data = await response.json();
                
                // Update current session ID if returned
                if (data.sessionId) {
                    this.currentSessionId = data.sessionId;
                }
                
                return data;
                
            } catch (error) {
                lastError = error;
                
                if (!this.isRetryableError(error) || attempt === RETRY_CONFIG.maxRetries) {
                    throw new Error(this.parseErrorMessage(error, error.response));
                }
            }
        }
        
        throw new Error(this.parseErrorMessage(lastError, lastError?.response));
    }

    /**
     * Search for images on Unsplash
     * GET /api/unsplash/search
     * @param {string} query - Search query
     * @param {Object} options - Search options
     * @param {number} options.page - Page number (default: 1)
     * @param {number} options.perPage - Results per page (default: 10, max: 30)
     * @param {string} options.orderBy - Sort order: 'relevant' or 'latest'
     * @param {string} options.orientation - Filter: 'landscape', 'portrait', or 'squarish'
     * @returns {Promise<Object>} - { source, query, total, total_pages, results: [...] }
     */
    async searchUnsplash(query, options = {}) {
        const {
            page = 1,
            perPage = 10,
            orderBy = 'relevant',
            orientation = null
        } = options;

        if (!query || query.trim() === '') {
            throw new Error('Search query is required');
        }

        // Extract base URL without /v1
        const baseUrl = API_BASE_URL.replace('/v1', '');
        
        const params = new URLSearchParams({
            q: query.trim(),
            page: String(page),
            per_page: String(Math.min(perPage, 30)),
            order_by: orderBy,
        });

        if (orientation) {
            params.append('orientation', orientation);
        }

        let lastError = null;
        
        for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    await this.sleep(this.getRetryDelay(attempt - 1));
                }

                const response = await fetch(`${baseUrl}/api/unsplash/search?${params.toString()}`, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                });
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    const error = new Error(errorData.error?.message || `HTTP ${response.status}`);
                    error.status = response.status;
                    error.response = errorData;
                    throw error;
                }
                
                return await response.json();
                
            } catch (error) {
                lastError = error;
                
                if (!this.isRetryableError(error) || attempt === RETRY_CONFIG.maxRetries) {
                    throw new Error(this.parseErrorMessage(error, error.response));
                }
            }
        }
        
        throw new Error(this.parseErrorMessage(lastError, lastError?.response));
    }

    /**
     * Get available image generation models
     * GET /api/images/models
     * @returns {Promise<Object>} - { models: [...] }
     */
    async getImageModelsFromAPI() {
        const response = await this.getImageModels();
        return response.data.map((model) => model.metadata || { id: model.id, name: model.id || 'Gateway Default' });
    }

    async getAvailableTools(category = null) {
        const params = new URLSearchParams();
        if (category) {
            params.set('category', category);
        }

        const url = `${BASE_URL_WITHOUT_API}/api/tools/available${params.toString() ? `?${params.toString()}` : ''}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
        });

        if (!response.ok) {
            throw new Error(`Failed to load tools: HTTP ${response.status}`);
        }

        const data = await response.json();
        return data.data || [];
    }

    async invokeTool(toolId, params = {}) {
        const response = await fetch(`${BASE_URL_WITHOUT_API}/api/tools/invoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tool: toolId,
                params,
                sessionId: this.currentSessionId,
            }),
        });

        if (!response.ok) {
            throw new Error(`Tool invocation failed: HTTP ${response.status}`);
        }

        const data = await response.json();
        return data.data;
    }

    // ============================================
    // Utility Methods
    // ============================================

    async checkHealth() {
        try {
            // Extract base URL without /v1
            const baseUrl = API_BASE_URL.replace('/v1', '');
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`${baseUrl}/health`, {
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

    clearModelsCache() {
        this.modelsCache = null;
        this.modelsCacheExpiry = null;
        try {
            localStorage.removeItem('kimibuilt_models_cache');
            localStorage.removeItem('kimibuilt_models_cache_expiry');
        } catch (e) {
            // localStorage blocked - nothing to clear
        }
    }

    setSessionId(sessionId) {
        this.currentSessionId = sessionId;
    }

    getSessionId() {
        return this.currentSessionId;
    }
}

// Create global API client instance
const apiClient = new OpenAIAPIClient();
window.apiClient = apiClient;

