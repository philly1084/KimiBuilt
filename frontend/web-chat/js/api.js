/**
 * API Client for KimiBuilt AI Chat using OpenAI SDK
 * Handles API communication with the KimiBuilt backend
 */

// Configuration
// Auto-detect backend URL based on current host
const CURRENT_HOST = window.location.hostname;
const CURRENT_PROTOCOL = window.location.protocol;

// If running on localhost, use localhost:3000
// Otherwise use the same host with /v1 path
const API_BASE_URL = CURRENT_HOST === 'localhost' 
    ? 'http://localhost:3000/v1'
    : `${CURRENT_PROTOCOL}//${CURRENT_HOST}/v1`;
const API_KEY = 'any-key'; // Required by SDK but not validated by KimiBuilt

class OpenAIAPIClient extends EventTarget {
    constructor() {
        super();
        this.client = null;
        this.currentSessionId = null;
        this.modelsCache = null;
        this.modelsCacheExpiry = null;
        this.modelsCacheDuration = 5 * 60 * 1000; // 5 minutes
        
        // Initialize OpenAI client
        this.initClient();
    }
    
    initClient() {
        try {
            // Check if OpenAI SDK is loaded (may be blocked by Tracking Prevention)
            if (typeof OpenAI === 'undefined') {
                console.warn('OpenAI SDK not loaded (possibly blocked). Using fetch fallback.');
                return;
            }
            
            this.client = new OpenAI({
                baseURL: API_BASE_URL,
                apiKey: API_KEY,
                dangerouslyAllowBrowser: true,
            });
            
            console.log('OpenAI SDK client initialized');
        } catch (error) {
            console.error('Failed to initialize OpenAI client:', error);
        }
    }

    // ============================================
    // Chat Methods
    // ============================================

    /**
     * Stream chat with the AI using OpenAI SDK or fetch fallback
     * @param {Array} messages - Array of messages in OpenAI format [{role, content}, ...]
     * @param {string} model - Model ID to use
     * @returns {AsyncGenerator} - Yields delta content
     */
    async *streamChat(messages, model = 'gpt-4o') {
        const params = {
            model,
            messages,
            stream: true,
        };
        
        if (this.currentSessionId) {
            params.session_id = this.currentSessionId;
        }

        // Use fetch if SDK not available
        if (!this.client) {
            try {
                const response = await fetch(`${API_BASE_URL}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(params),
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\n');
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]') {
                                yield { type: 'done', sessionId: this.currentSessionId };
                                return;
                            }
                            try {
                                const parsed = JSON.parse(data);
                                const content = parsed.choices?.[0]?.delta?.content || '';
                                if (content) {
                                    yield { type: 'delta', content };
                                }
                            } catch (e) {}
                        }
                    }
                }
            } catch (error) {
                console.error('Stream chat error:', error);
                yield { type: 'delta', content: `[Error: ${error.message}]` };
                yield { type: 'done', sessionId: this.currentSessionId };
            }
            return;
        }

        try {
            const stream = await this.client.chat.completions.create(params);
            
            for await (const chunk of stream) {
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
                }
            }
        } catch (error) {
            console.error('Stream chat error:', error);
            throw error;
        }
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
        
        if (this.currentSessionId) {
            params.session_id = this.currentSessionId;
        }

        // Use fetch if SDK not available
        if (!this.client) {
            try {
                const response = await fetch(`${API_BASE_URL}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(params),
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const data = await response.json();
                
                if (data.session_id) {
                    this.currentSessionId = data.session_id;
                }
                
                return {
                    content: data.choices?.[0]?.message?.content || '',
                    sessionId: this.currentSessionId,
                };
            } catch (error) {
                console.error('Chat error:', error);
                return {
                    content: `[Error: ${error.message}]`,
                    sessionId: this.currentSessionId,
                };
            }
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
            throw error;
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
        // Image models are typically static, return defaults
        return {
            object: 'list',
            data: [
                { id: 'dall-e-3', object: 'model', created: Date.now(), owned_by: 'openai' },
                { id: 'dall-e-2', object: 'model', created: Date.now(), owned_by: 'openai' }
            ]
        };
    }

    // ============================================
    // Image Generation API
    // ============================================

    async generateImage(options = {}) {
        const {
            prompt,
            model = 'dall-e-3',
            size = '1024x1024',
            quality = 'standard',
            style = 'vivid',
            n = 1,
            sessionId = null
        } = options;

        const params = {
            model,
            prompt,
            n: n || 1,
            size: size || '1024x1024',
        };

        if (quality) params.quality = quality;
        if (style) params.style = style;
        if (sessionId || this.currentSessionId) {
            params.session_id = sessionId || this.currentSessionId;
        }

        // Use fetch if SDK not available
        if (!this.client) {
            try {
                const response = await fetch(`${API_BASE_URL}/images/generations`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(params),
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                return await response.json();
            } catch (error) {
                console.error('Image generation error:', error);
                throw error;
            }
        }

        try {
            const response = await this.client.images.generate(params);
            return response
        } catch (error) {
            console.error('Image generation error:', error);
            throw error;
        }
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
