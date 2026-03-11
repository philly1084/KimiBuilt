/**
 * Web CLI API Client
 * Uses OpenAI-compatible endpoints with fetch only (no SDK)
 */

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const API_BASE_URL = LOCAL_HOSTNAMES.has(window.location.hostname)
    ? 'http://localhost:3000/v1'
    : `${window.location.protocol}//${window.location.host}/v1`;

// Default request timeout in milliseconds
const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

class WebCLIAPI {
    constructor() {
        this.sessionId = null;
        this.currentModel = 'gpt-4o';
        this.models = [];
        this.connectionStatus = 'unknown';
        this.lastHealthCheck = null;
    }

    /**
     * Create a fetch request with timeout support
     */
    async fetchWithTimeout(url, options = {}, timeout = DEFAULT_TIMEOUT) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error(`Request timeout after ${timeout}ms`);
            }
            throw error;
        }
    }

    /**
     * Retry a fetch request with exponential backoff
     */
    async fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
        let lastError;
        
        for (let i = 0; i <= retries; i++) {
            try {
                const response = await this.fetchWithTimeout(url, options);
                return response;
            } catch (error) {
                lastError = error;
                
                // Don't retry on client errors (4xx) except 429 (rate limit)
                if (error.message.includes('HTTP 4') && !error.message.includes('429')) {
                    throw error;
                }
                
                if (i < retries) {
                    const delay = RETRY_DELAY * Math.pow(2, i);
                    console.warn(`Request failed, retrying in ${delay}ms... (${i + 1}/${retries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        throw lastError;
    }

    async checkHealth() {
        try {
            const baseUrl = API_BASE_URL.replace('/v1', '');
            const response = await this.fetchWithTimeout(
                `${baseUrl}/health`, 
                { method: 'GET' },
                5000
            );
            
            if (response.ok) {
                const data = await response.json();
                this.connectionStatus = 'connected';
                this.lastHealthCheck = Date.now();
                return { 
                    connected: true, 
                    data,
                    suggestions: []
                };
            }
            
            this.connectionStatus = 'error';
            return { 
                connected: false, 
                error: `Health check failed: HTTP ${response.status}`,
                suggestions: [
                    'Check if the backend server is running',
                    'Verify the API_BASE_URL configuration',
                    'Check server logs for errors'
                ]
            };
        } catch (error) {
            this.connectionStatus = 'disconnected';
            return { 
                connected: false, 
                error: error.message,
                suggestions: [
                    'Check if the backend server is running on the correct port',
                    'Verify network connectivity',
                    'Check firewall settings',
                    'Try restarting the backend server'
                ]
            };
        }
    }

    async getModels() {
        try {
            const response = await this.fetchWithTimeout(
                `${API_BASE_URL}/models`,
                { method: 'GET' },
                10000
            );
            
            if (response.ok) {
                const data = await response.json();
                this.models = data.data || [];
                return this.models;
            }
        } catch (error) {
            console.warn('Failed to fetch models:', error);
        }
        
        // Fallback models
        this.models = [
            { id: 'gpt-4o', name: 'GPT-4o', description: 'Most capable multimodal model' },
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and cost-effective' },
            { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'High capability model' },
            { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: 'Fast and efficient' },
        ];
        return this.models;
    }

    async *streamChat(message, model = null, mode = 'chat', conversationHistory = []) {
        const messages = [
            ...conversationHistory,
            { role: 'user', content: message }
        ];
        
        const params = {
            model: model || this.currentModel,
            messages,
            stream: true,
        };

        if (this.sessionId) {
            params.session_id = this.sessionId;
        }

        try {
            const response = await this.fetchWithRetry(`${API_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
            });

            if (!response.ok) {
                const errorText = await response.text();
                let errorMessage = `HTTP ${response.status}: ${errorText}`;
                let suggestions = [];
                
                if (response.status === 401) {
                    errorMessage = 'Authentication failed. Please check your API key.';
                    suggestions = ['Verify API key configuration', 'Check if API key has expired'];
                } else if (response.status === 429) {
                    errorMessage = 'Rate limit exceeded. Please wait a moment.';
                    suggestions = ['Wait a few seconds before retrying', 'Consider reducing request frequency'];
                } else if (response.status === 500) {
                    errorMessage = 'Server error. The AI service may be experiencing issues.';
                    suggestions = ['Try again in a moment', 'Switch to a different model', 'Check server status'];
                }
                
                yield { type: 'error', error: errorMessage, suggestions };
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') {
                            yield { type: 'done', sessionId: this.sessionId };
                            return;
                        }
                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed.choices?.[0]?.delta?.content || '';
                            if (parsed.session_id) {
                                this.sessionId = parsed.session_id;
                            }
                            if (content) {
                                yield { type: 'delta', content };
                            }
                        } catch (e) {
                            // Ignore parse errors for malformed chunks
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Stream error:', error);
            let suggestions = ['Check your internet connection', 'Verify the backend is running'];
            
            if (error.message.includes('timeout')) {
                suggestions = ['The request took too long', 'Try a shorter message', 'Check server load'];
            }
            
            yield { type: 'error', error: error.message, suggestions };
        }
    }

    /**
     * Simple non-streaming message send (for compatibility)
     * Collects all streaming chunks and returns complete response
     */
    async sendMessage(message, onChunk = null, model = null) {
        const chunks = [];
        let fullContent = '';
        let tokens = 0;
        
        for await (const chunk of this.streamChat(message, model)) {
            if (chunk.type === 'delta') {
                fullContent += chunk.content;
                tokens += 1; // Approximate
                if (onChunk) {
                    onChunk(chunk);
                }
            } else if (chunk.type === 'error') {
                throw new Error(chunk.error);
            } else if (chunk.type === 'done') {
                break;
            }
        }
        
        return {
            content: fullContent,
            tokens: tokens,
            sessionId: this.sessionId
        };
    }

    async sendCanvasRequest(message, canvasType = 'document', existingContent = '') {
        const baseUrl = API_BASE_URL.replace('/v1', '');
        
        try {
            const response = await this.fetchWithRetry(`${baseUrl}/api/canvas`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message,
                    canvasType,
                    existingContent,
                    sessionId: this.sessionId,
                }),
            });

            if (!response.ok) {
                throw new Error(`Canvas request failed: HTTP ${response.status}`);
            }

            const data = await response.json();
            if (data.sessionId) {
                this.sessionId = data.sessionId;
            }
            return data;
        } catch (error) {
            console.error('Canvas error:', error);
            throw error;
        }
    }

    async sendNotationRequest(notation, helperMode = 'expand', context = '') {
        const baseUrl = API_BASE_URL.replace('/v1', '');
        
        try {
            const response = await this.fetchWithRetry(`${baseUrl}/api/notation`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    notation,
                    helperMode,
                    context,
                    sessionId: this.sessionId,
                }),
            });

            if (!response.ok) {
                throw new Error(`Notation request failed: HTTP ${response.status}`);
            }

            const data = await response.json();
            if (data.sessionId) {
                this.sessionId = data.sessionId;
            }
            return data;
        } catch (error) {
            console.error('Notation error:', error);
            throw error;
        }
    }

    async generateImage(prompt, options = {}) {
        const baseUrl = API_BASE_URL.replace('/v1', '');
        
        const {
            model = null,
            size = '1024x1024',
            quality = 'standard',
            style = 'vivid',
            n = 1
        } = options;
        
        try {
            const response = await this.fetchWithRetry(`${baseUrl}/api/images`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt,
                    model,
                    size,
                    quality,
                    style,
                    n,
                    sessionId: this.sessionId,
                }),
            }, 2); // Fewer retries for image generation (expensive)

            if (!response.ok) {
                if (response.status === 429) {
                    throw new Error('Image generation rate limit exceeded. Please wait a moment.');
                }
                throw new Error(`Image generation failed: HTTP ${response.status}`);
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

    async searchUnsplash(query, options = {}) {
        const baseUrl = API_BASE_URL.replace('/v1', '');
        
        const {
            page = 1,
            perPage = 10,
            orientation = null
        } = options;
        
        try {
            const params = new URLSearchParams({
                q: query,
                page: String(page),
                per_page: String(Math.min(perPage, 30)),
            });
            
            if (orientation) {
                params.append('orientation', orientation);
            }
            
            const response = await this.fetchWithTimeout(
                `${baseUrl}/api/unsplash/search?${params.toString()}`,
                { method: 'GET' },
                15000
            );

            if (!response.ok) {
                if (response.status === 503) {
                    throw new Error('Unsplash is not configured. Please set UNSPLASH_ACCESS_KEY.');
                }
                throw new Error(`Unsplash search failed: HTTP ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Unsplash search error:', error);
            throw error;
        }
    }

    async uploadFile(file, purpose = 'assistants') {
        // This is a stub for backend file upload
        // The file handler module handles client-side file processing
        console.log('File upload stub called:', { name: file.name, size: file.size, type: file.type, purpose });
        return {
            id: `file-${Date.now()}`,
            name: file.name,
            size: file.size,
            type: file.type,
            purpose: purpose,
            status: 'uploaded'
        };
    }

    setModel(model) {
        this.currentModel = model;
    }

    // Alias for checkHealth to match app expectations
    healthCheck() {
        return this.checkHealth();
    }

    clearSession() {
        this.sessionId = null;
    }
}

const api = new WebCLIAPI();

