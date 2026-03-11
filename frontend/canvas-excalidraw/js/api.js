/**
 * API Module - Backend integration using OpenAI SDK
 * Updated: Uses OpenAI SDK to connect to KimiBuilt backend at /v1
 */

class OpenAICanvasAPI {
    constructor(baseUrl = 'http://localhost:3000/v1') {
        this.baseURL = baseUrl;
        this.client = null;
        this.sessionId = null;
        this.sdkAvailable = false;
        try {
            this.selectedModel = localStorage.getItem('kimi-canvas-model') || 'gpt-4o';
        } catch {
            this.selectedModel = 'gpt-4o';
        }

        // Check if OpenAI SDK is available and working
        this.initSDK();
    }
    
    initSDK() {
        // Try to initialize OpenAI SDK with proper error handling
        if (typeof window.OpenAI !== 'undefined') {
            try {
                this.client = new window.OpenAI({
                    baseURL: this.baseURL,
                    apiKey: 'any-key',
                    dangerouslyAllowBrowser: true,
                });
                this.sdkAvailable = true;
                console.log('OpenAI SDK initialized successfully');
            } catch (error) {
                console.warn('Failed to initialize OpenAI SDK, will use fetch fallback:', error);
                this.client = null;
                this.sdkAvailable = false;
            }
        } else {
            console.log('OpenAI SDK not available, using fetch fallback');
            this.sdkAvailable = false;
        }
    }

    setSelectedModel(model) {
        this.selectedModel = model;
        try {
            localStorage.setItem('kimi-canvas-model', model);
        } catch {}
    }

    getSelectedModel() {
        return this.selectedModel;
    }

    async chat(messages) {
        const params = {
            model: this.selectedModel,
            messages,
            stream: false,
        };

        if (this.sessionId) {
            params.session_id = this.sessionId;
        }

        if (!this.client) {
            const response = await fetch(`${this.baseURL}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
            });

            if (!response.ok) {
                throw await this.buildRequestError(response);
            }

            const data = await response.json();
            if (data.session_id) {
                this.sessionId = data.session_id;
            }

            return {
                content: data.choices?.[0]?.message?.content || '',
                sessionId: this.sessionId,
                responseId: data.id,
            };
        }

        const response = await this.client.chat.completions.create(params);
        if (response.session_id) {
            this.sessionId = response.session_id;
        }

        return {
            content: response.choices?.[0]?.message?.content || '',
            sessionId: this.sessionId,
            responseId: response.id,
        };
    }

    // Generate diagram (uses chat completions with special prompt)
    async generateDiagram(message, existingContent = null) {
        const messages = [
            {
                role: 'system',
                content: 'You are an AI canvas assistant. Generate structured content for a canvas interface. Respond with valid JSON containing elements array.'
            },
            {
                role: 'user',
                content: existingContent 
                    ? `${message}\n\nExisting content:\n${existingContent}`
                    : message
            }
        ];

        const params = {
            model: this.selectedModel,
            messages,
            stream: false,
        };

        if (this.sessionId) {
            params.session_id = this.sessionId;
        }

        // Use fetch if SDK not available
        if (!this.client) {
            try {
                const response = await fetch(`${this.baseURL}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(params),
                });
                
                if (!response.ok) {
                    throw await this.buildRequestError(response);
                }
                
                const data = await response.json();
                const content = data.choices?.[0]?.message?.content || '';
                
                if (data.session_id) {
                    this.sessionId = data.session_id;
                }
                
                return {
                    content,
                    sessionId: this.sessionId,
                    responseId: data.id,
                };
            } catch (error) {
                console.error('Diagram generation error:', error);
                throw error;
            }
        }

        const response = await this.client.chat.completions.create(params);
        
        // Parse the response content as JSON
        const content = response.choices[0]?.message?.content || '';
        
        // Update session ID if returned
        if (response.session_id) {
            this.sessionId = response.session_id;
        }

        return {
            content,
            sessionId: this.sessionId,
            responseId: response.id,
        };
    }

    // Generate image
    async generateImage(options) {
        const { prompt, model, size, quality, style, n } = options;
        
        const params = {
            prompt,
            n: n || 1,
            size: size || '1024x1024',
        };

        if (model) params.model = model;
        if (quality) params.quality = quality;
        if (style) params.style = style;
        if (this.sessionId) params.sessionId = this.sessionId;

        try {
            const baseUrl = this.baseURL.replace(/\/v1$/, '');
            const response = await fetch(`${baseUrl}/api/images`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
            });

            if (!response.ok) {
                throw await this.buildRequestError(response);
            }

            const data = await response.json();

            if (data.sessionId) {
                this.sessionId = data.sessionId;
            }

            return data;
        } catch (error) {
            console.error('Image generation error:', error);
            throw error;
        }
    }

    // Get models
    async getModels() {
        // Use fetch if SDK not available
        if (!this.client) {
            try {
                const response = await fetch(`${this.baseURL}/models`);
                if (response.ok) {
                    const data = await response.json();
                    return this.filterModels(data.data || []).map(m => ({
                        id: m.id,
                        name: m.id,
                        provider: m.owned_by || 'unknown'
                    }));
                }
            } catch (error) {
                console.warn('Failed to fetch models:', error);
            }
            return this.getDefaultModels();
        }
        
        try {
            const response = await this.client.models.list();
            return this.filterModels(response.data || []).map(m => ({
                id: m.id,
                name: m.id,
                provider: m.owned_by || 'unknown'
            }));
        } catch (error) {
            console.error('Error fetching models:', error);
            return this.getDefaultModels();
        }
    }

    // Get image models from backend
    async getImageModels() {
        try {
            const baseUrl = this.baseURL.replace(/\/v1$/, '');
            const response = await fetch(`${baseUrl}/api/images/models`);
            if (!response.ok) {
                throw await this.buildRequestError(response);
            }

            const data = await response.json();
            return data.models || [];
        } catch (error) {
            console.warn('Failed to fetch image models:', error.message);
            return [{ id: '', name: 'Gateway Default', description: 'Use the backend default image model' }];
        }
    }

    // Health check (custom)
    async checkHealth() {
        try {
            const baseUrl = this.baseURL.replace('/v1', '');
            const response = await fetch(`${baseUrl}/health`);
            if (response.ok) {
                const data = await response.json();
                return { connected: true, data };
            }
            return { connected: false, error: 'Health check failed' };
        } catch (error) {
            return { connected: false, error: error.message };
        }
    }
    
    // WebSocket Methods (kept for compatibility)
    connectWebSocket() {
        // WebSocket not needed with OpenAI SDK - using HTTP requests
        console.log('WebSocket not used with OpenAI SDK mode');
    }
    
    disconnect() {
        // No-op for OpenAI SDK mode
    }

    getDefaultModels() {
        return [
            { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
            { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'anthropic' },
            { id: 'claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', provider: 'anthropic' }
        ];
    }

    filterModels(models = []) {
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

    async buildRequestError(response) {
        let message = `HTTP ${response.status}`;

        try {
            const data = await response.json();
            message = data?.error?.message || data?.message || message;
        } catch {}

        return new Error(message);
    }
}

// Create global instance
// Auto-detect backend URL
const localHostnames = new Set(['localhost', '127.0.0.1', '[::1]']);
const currentHost = window.location.hostname;
const currentOrigin = `${window.location.protocol}//${window.location.host}`;
const autoBaseUrl = localHostnames.has(currentHost)
    ? 'http://localhost:3000/v1'
    : `${currentOrigin}/v1`;

window.apiManager = new OpenAICanvasAPI(autoBaseUrl);

