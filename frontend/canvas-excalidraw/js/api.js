/**
 * API Module - Backend integration
 * Enhanced: Added model selection and image generation support
 */

class APIManager {
    constructor() {
        this.baseUrl = 'http://localhost:3000';
        this.wsUrl = 'ws://localhost:3000/ws';
        this.ws = null;
        this.sessionId = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        
        // Default model
        this.selectedModel = localStorage.getItem('kimi-canvas-model') || 'gpt-4o';
        
        // Available models cache
        this.availableModels = [];
        this.imageModels = [];
    }
    
    // Get selected model
    getSelectedModel() {
        return this.selectedModel;
    }
    
    // Set selected model and save to localStorage
    setSelectedModel(model) {
        this.selectedModel = model;
        localStorage.setItem('kimi-canvas-model', model);
    }
    
    // Health check
    async checkHealth() {
        try {
            const response = await fetch(`${this.baseUrl}/health`);
            if (response.ok) {
                const data = await response.json();
                return { connected: true, data };
            }
            return { connected: false, error: 'Health check failed' };
        } catch (error) {
            return { connected: false, error: error.message };
        }
    }
    
    // Fetch available chat models
    async getModels() {
        try {
            const response = await fetch(`${this.baseUrl}/api/models`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            // Backend returns { object: 'list', data: [...] }
            this.availableModels = (data.data || []).map(m => ({
                id: m.id,
                name: m.id,
                provider: m.owned_by || 'unknown'
            }));
            return this.availableModels;
        } catch (error) {
            console.error('Error fetching models:', error);
            // Return default models if fetch fails
            return [
                { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
                { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
                { id: 'claude-3-opus', name: 'Claude 3 Opus', provider: 'anthropic' },
                { id: 'claude-3-sonnet', name: 'Claude 3 Sonnet', provider: 'anthropic' }
            ];
        }
    }
    
    // Fetch available image generation models
    async getImageModels() {
        try {
            const response = await fetch(`${this.baseUrl}/api/images/models`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            this.imageModels = data.models || [];
            return this.imageModels;
        } catch (error) {
            console.error('Error fetching image models:', error);
            // Return default image models if fetch fails
            return [
                { id: 'dall-e-3', name: 'DALL-E 3', provider: 'openai' },
                { id: 'dall-e-2', name: 'DALL-E 2', provider: 'openai' }
            ];
        }
    }
    
    // HTTP API Methods
    async generateDiagram(message, existingContent = null) {
        try {
            const response = await fetch(`${this.baseUrl}/api/canvas`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message,
                    sessionId: this.sessionId,
                    canvasType: 'diagram',
                    existingContent: existingContent,
                    model: this.selectedModel
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            if (data.sessionId) {
                this.sessionId = data.sessionId;
            }
            
            return data;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    }
    
    // Generate image
    async generateImage(options) {
        try {
            const response = await fetch(`${this.baseUrl}/api/images`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prompt: options.prompt,
                    model: options.model || 'dall-e-3',
                    size: options.size || '1024x1024',
                    quality: options.quality || 'standard',
                    style: options.style || 'vivid',
                    n: options.n || 1
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('Image generation error:', error);
            throw error;
        }
    }
    
    // WebSocket Methods
    connectWebSocket() {
        try {
            this.ws = new WebSocket(this.wsUrl);
            
            this.ws.onopen = () => {
                console.log('WebSocket connected');
                this.reconnectAttempts = 0;
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleWebSocketMessage(data);
                } catch (error) {
                    console.error('WebSocket message error:', error);
                }
            };
            
            this.ws.onclose = () => {
                console.log('WebSocket disconnected');
                this.attemptReconnect();
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
        } catch (error) {
            console.error('WebSocket connection error:', error);
        }
    }
    
    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => {
                console.log(`Reconnecting... Attempt ${this.reconnectAttempts}`);
                this.connectWebSocket();
            }, 1000 * this.reconnectAttempts);
        }
    }
    
    handleWebSocketMessage(data) {
        // Handle incoming WebSocket messages
        if (data.type === 'canvas' && data.payload) {
            window.app?.handleAIGeneratedDiagram(data.payload);
        }
    }
    
    sendCanvasMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'canvas',
                payload: {
                    message: message,
                    canvasType: 'diagram',
                    model: this.selectedModel
                }
            }));
        }
    }
    
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

// Create global instance
window.apiManager = new APIManager();
