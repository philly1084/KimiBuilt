/**
 * API Client for KimiBuilt AI Chat using OpenAI SDK
 * Handles API communication with the KimiBuilt backend
 */

// Configuration
const API_BASE_URL = 'http://kimibuilt.local/v1'; // Update this to your KimiBuilt backend URL
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
            // Check if OpenAI SDK is loaded
            if (typeof OpenAI === 'undefined') {
                console.error('OpenAI SDK not loaded. Make sure the CDN script is included.');
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
     * Stream chat with the AI using OpenAI SDK
     * @param {Array} messages - Array of messages in OpenAI format [{role, content}, ...]
     * @param {string} model - Model ID to use
     * @returns {AsyncGenerator} - Yields delta content
     */
    async *streamChat(messages, model = 'gpt-4o') {
        if (!this.client) {
            throw new Error('OpenAI client not initialized');
        }

        const params = {
            model,
            messages,
            stream: true,
        };
        
        if (this.currentSessionId) {
            params.session_id = this.currentSessionId;
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
                
                // Extract session_id from the chunk if present (KimiBuilt extension)
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
        if (!this.client) {
            throw new Error('OpenAI client not initialized');
        }

        const params = {
            model,
            messages,
            stream: false,
        };
        
        if (this.currentSessionId) {
            params.session_id = this.currentSessionId;
        }

        try {
            const response = await this.client.chat.completions.create(params);
            
            // Extract session_id from response if present (KimiBuilt extension)
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

        // Check localStorage cache
        if (!forceRefresh) {
            const cached = localStorage.getItem('kimibuilt_models_cache');
            const cachedExpiry = localStorage.getItem('kimibuilt_models_cache_expiry');
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

        if (!this.client) {
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
            
            // Save to localStorage
            localStorage.setItem('kimibuilt_models_cache', JSON.stringify(data));
            localStorage.setItem('kimibuilt_models_cache_expiry', String(this.modelsCacheExpiry));
            
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
        if (!this.client) {
            throw new Error('OpenAI client not initialized');
        }

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

        try {
            const response = await this.client.images.generate(params);
            return response;
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
        localStorage.removeItem('kimibuilt_models_cache');
        localStorage.removeItem('kimibuilt_models_cache_expiry');
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
