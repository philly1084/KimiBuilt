/**
 * API Client for KimiBuilt AI Chat
 * Handles WebSocket and HTTP API communication with robust error handling
 */

const API_BASE_URL = 'http://localhost:3000';
const WS_URL = 'ws://localhost:3000/ws';

class APIClient extends EventTarget {
    constructor() {
        super();
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.isConnecting = false;
        this.currentSessionId = null;
        this.eventSource = null;
        this.useWebSocket = true;
        this.heartbeatInterval = null;
        this.connectionTimeout = null;
        this.messageQueue = [];
        
        // Model cache
        this.modelsCache = null;
        this.modelsCacheExpiry = null;
        this.modelsCacheDuration = 5 * 60 * 1000; // 5 minutes
    }

    // ============================================
    // WebSocket Connection
    // ============================================

    connect() {
        if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
            return;
        }

        this.isConnecting = true;
        this.dispatchEvent(new CustomEvent('connectionChange', { 
            detail: { status: 'connecting' } 
        }));

        // Set connection timeout
        this.connectionTimeout = setTimeout(() => {
            if (this.isConnecting) {
                console.warn('Connection timeout, falling back to HTTP');
                this.isConnecting = false;
                this.useWebSocket = false;
                this.dispatchEvent(new CustomEvent('fallbackToHTTP'));
                this.dispatchEvent(new CustomEvent('connectionChange', { 
                    detail: { status: 'connected' } // Consider connected via HTTP
                }));
            }
        }, 5000);

        try {
            this.ws = new WebSocket(WS_URL);

            this.ws.onopen = () => {
                console.log('WebSocket connected');
                this.isConnecting = false;
                this.reconnectAttempts = 0;
                this.useWebSocket = true;
                
                clearTimeout(this.connectionTimeout);
                
                this.dispatchEvent(new CustomEvent('connectionChange', { 
                    detail: { status: 'connected' } 
                }));
                
                // Start heartbeat
                this.startHeartbeat();
                
                // Process any queued messages
                this.processMessageQueue();
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleWebSocketMessage(data);
                } catch (error) {
                    console.error('Failed to parse WebSocket message:', error);
                }
            };

            this.ws.onclose = (event) => {
                console.log('WebSocket disconnected', event.code, event.reason);
                this.cleanupConnection();
                
                this.dispatchEvent(new CustomEvent('connectionChange', { 
                    detail: { status: 'disconnected' } 
                }));
                
                // Only attempt reconnect if it wasn't a clean close
                if (!event.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.attemptReconnect();
                } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                    this.useWebSocket = false;
                    this.dispatchEvent(new CustomEvent('fallbackToHTTP'));
                }
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.isConnecting = false;
                clearTimeout(this.connectionTimeout);
                
                this.dispatchEvent(new CustomEvent('connectionChange', { 
                    detail: { status: 'disconnected' } 
                }));
                
                this.dispatchEvent(new CustomEvent('error', { 
                    detail: { message: 'WebSocket connection error' } 
                }));
            };

        } catch (error) {
            console.error('Failed to create WebSocket connection:', error);
            this.isConnecting = false;
            clearTimeout(this.connectionTimeout);
            this.attemptReconnect();
        }
    }

    disconnect() {
        this.reconnectAttempts = this.maxReconnectAttempts; // Prevent auto-reconnect
        this.cleanupConnection();
    }

    cleanupConnection() {
        this.isConnecting = false;
        clearTimeout(this.connectionTimeout);
        this.stopHeartbeat();
        
        if (this.ws) {
            try {
                this.ws.close();
            } catch (e) {
                // Ignore errors on close
            }
            this.ws = null;
        }
        
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
    }

    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('Max reconnect attempts reached, falling back to HTTP SSE');
            this.useWebSocket = false;
            this.dispatchEvent(new CustomEvent('fallbackToHTTP'));
            this.dispatchEvent(new CustomEvent('connectionChange', { 
                detail: { status: 'connected' } 
            }));
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        
        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        this.dispatchEvent(new CustomEvent('connectionChange', { 
            detail: { status: 'connecting' } 
        }));
        
        setTimeout(() => {
            this.connect();
        }, delay);
    }

    startHeartbeat() {
        // Send ping every 30 seconds to keep connection alive
        this.heartbeatInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    handleWebSocketMessage(data) {
        // Handle pong response
        if (data.type === 'pong') {
            return;
        }

        switch (data.type) {
            case 'session_created':
                this.currentSessionId = data.sessionId;
                this.dispatchEvent(new CustomEvent('sessionCreated', { 
                    detail: data 
                }));
                break;
                
            case 'delta':
                this.dispatchEvent(new CustomEvent('delta', { 
                    detail: { content: data.content } 
                }));
                break;
                
            case 'done':
                this.dispatchEvent(new CustomEvent('done', { 
                    detail: data 
                }));
                break;
                
            case 'error':
                this.dispatchEvent(new CustomEvent('error', { 
                    detail: { message: data.message } 
                }));
                break;
                
            default:
                console.log('Unknown message type:', data.type);
        }
    }

    isConnected() {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    // ============================================
    // Message Queue
    // ============================================

    queueMessage(payload) {
        this.messageQueue.push(payload);
    }

    processMessageQueue() {
        while (this.messageQueue.length > 0 && this.isConnected()) {
            const payload = this.messageQueue.shift();
            this.ws.send(JSON.stringify(payload));
        }
    }

    // ============================================
    // Chat Methods
    // ============================================

    sendMessage(message, sessionId = null, options = {}) {
        const payload = {
            type: 'chat',
            payload: { 
                message,
                ...(options.model && { model: options.model })
            }
        };

        if (sessionId) {
            payload.sessionId = sessionId;
        }

        if (this.useWebSocket && this.isConnected()) {
            this.ws.send(JSON.stringify(payload));
            return true;
        } else {
            // Fallback to HTTP SSE
            this.sendMessageHTTP(message, sessionId, options);
            return false;
        }
    }

    async sendMessageHTTP(message, sessionId = null, options = {}) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

            const response = await fetch(`${API_BASE_URL}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message,
                    sessionId,
                    stream: true,
                    ...(options.model && { model: options.model })
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                
                if (done) {
                    this.dispatchEvent(new CustomEvent('done', { 
                        detail: { sessionId: this.currentSessionId } 
                    }));
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Keep incomplete line in buffer

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') {
                            this.dispatchEvent(new CustomEvent('done', { 
                                detail: { sessionId: this.currentSessionId } 
                            }));
                        } else {
                            try {
                                const parsed = JSON.parse(data);
                                if (parsed.content) {
                                    this.dispatchEvent(new CustomEvent('delta', { 
                                        detail: { content: parsed.content } 
                                    }));
                                }
                            } catch (e) {
                                // Not JSON, treat as plain text
                                this.dispatchEvent(new CustomEvent('delta', { 
                                    detail: { content: data } 
                                }));
                            }
                        }
                    }
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error('HTTP chat request timed out');
                this.dispatchEvent(new CustomEvent('error', { 
                    detail: { message: 'Request timed out. Please try again.' } 
                }));
            } else {
                console.error('HTTP chat error:', error);
                this.dispatchEvent(new CustomEvent('error', { 
                    detail: { message: error.message } 
                }));
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

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await fetch(`${API_BASE_URL}/api/models`, {
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
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
            
            // Return default models as fallback
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
    }

    async getImageModels() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await fetch(`${API_BASE_URL}/api/images/models`, {
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Failed to fetch image models:', error);
            
            // Return default image models as fallback
            return {
                object: 'list',
                data: [
                    { id: 'dall-e-3', object: 'model', created: Date.now(), owned_by: 'openai' },
                    { id: 'dall-e-2', object: 'model', created: Date.now(), owned_by: 'openai' }
                ]
            };
        }
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

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout for image generation

            const response = await fetch(`${API_BASE_URL}/api/images`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prompt,
                    model,
                    size,
                    quality,
                    style,
                    n,
                    sessionId
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error('Image generation timed out');
                throw new Error('Image generation timed out. Please try again.');
            }
            console.error('Image generation error:', error);
            throw error;
        }
    }

    // ============================================
    // HTTP Sessions API
    // ============================================

    async getSessions() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await fetch(`${API_BASE_URL}/api/sessions`, {
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('Failed to fetch sessions:', error);
            throw error;
        }
    }

    async createSession(mode = 'chat') {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await fetch(`${API_BASE_URL}/api/sessions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ mode }),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('Failed to create session:', error);
            throw error;
        }
    }

    async deleteSession(sessionId) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}`, {
                method: 'DELETE',
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            return true;
        } catch (error) {
            console.error('Failed to delete session:', error);
            throw error;
        }
    }

    // ============================================
    // Utility Methods
    // ============================================

    async checkHealth() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`${API_BASE_URL}/health`, {
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
}

// Create global API client instance
const apiClient = new APIClient();
