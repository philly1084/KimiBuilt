/**
 * API Client - Canvas API (HTTP + WebSocket)
 * Backend URL: http://localhost:3000
 */

class CanvasAPI {
    constructor(baseURL = 'http://localhost:3000') {
        this.baseURL = baseURL;
        this.ws = null;
        this.wsCallbacks = {};
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.sessionId = null;
    }

    /**
     * Get full API URL
     * @param {string} path 
     * @returns {string}
     */
    _getURL(path) {
        return `${this.baseURL}${path}`;
    }

    /**
     * Send canvas request via HTTP POST
     * @param {Object} params 
     * @param {string} params.message - The prompt message
     * @param {string} [params.sessionId] - Optional session ID
     * @param {string} [params.canvasType] - 'code' | 'document' | 'diagram'
     * @param {string} [params.existingContent] - Optional existing content
     * @returns {Promise<Object>}
     */
    async sendCanvasRequest({ message, sessionId, canvasType = 'code', existingContent }) {
        const payload = {
            message,
            sessionId: sessionId || this.sessionId,
            canvasType,
            existingContent
        };

        try {
            const response = await fetch(this._getURL('/api/canvas'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            // Update session ID
            if (data.sessionId) {
                this.sessionId = data.sessionId;
            }

            return data;
        } catch (error) {
            console.error('Canvas API Error:', error);
            throw error;
        }
    }

    /**
     * Connect to WebSocket
     * @returns {Promise<WebSocket>}
     */
    connectWebSocket() {
        return new Promise((resolve, reject) => {
            const wsURL = this.baseURL.replace(/^http/, 'ws');
            
            try {
                this.ws = new WebSocket(wsURL);

                this.ws.onopen = () => {
                    console.log('WebSocket connected');
                    this.reconnectAttempts = 0;
                    this._triggerCallback('open');
                    resolve(this.ws);
                };

                this.ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        this._handleWebSocketMessage(data);
                    } catch (error) {
                        console.error('WebSocket message parse error:', error);
                    }
                };

                this.ws.onclose = (event) => {
                    console.log('WebSocket closed:', event.code, event.reason);
                    this._triggerCallback('close', event);
                    this._attemptReconnect();
                };

                this.ws.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    this._triggerCallback('error', error);
                    reject(error);
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Handle incoming WebSocket messages
     * @param {Object} data 
     */
    _handleWebSocketMessage(data) {
        // Update session ID if provided
        if (data.sessionId) {
            this.sessionId = data.sessionId;
        }

        // Trigger type-specific callback
        if (data.type && this.wsCallbacks[data.type]) {
            this.wsCallbacks[data.type].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error('WebSocket callback error:', error);
                }
            });
        }

        // Trigger general message callback
        this._triggerCallback('message', data);
    }

    /**
     * Attempt to reconnect WebSocket
     */
    _attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`WebSocket reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
            
            setTimeout(() => {
                this.connectWebSocket().catch(error => {
                    console.error('WebSocket reconnect failed:', error);
                });
            }, this.reconnectDelay * this.reconnectAttempts);
        }
    }

    /**
     * Send message via WebSocket
     * @param {Object} params 
     * @param {string} params.message - The prompt message
     * @param {string} [params.sessionId] - Optional session ID
     * @param {string} [params.canvasType] - 'code' | 'document' | 'diagram'
     * @param {string} [params.existingContent] - Optional existing content
     * @returns {boolean}
     */
    sendWebSocketMessage({ message, sessionId, canvasType = 'code', existingContent }) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.error('WebSocket is not connected');
            return false;
        }

        const payload = {
            type: 'canvas',
            sessionId: sessionId || this.sessionId,
            payload: {
                message,
                canvasType,
                existingContent
            }
        };

        try {
            this.ws.send(JSON.stringify(payload));
            return true;
        } catch (error) {
            console.error('WebSocket send error:', error);
            return false;
        }
    }

    /**
     * Register WebSocket event callback
     * @param {string} event - Event type: 'open', 'close', 'error', 'message', 'done'
     * @param {Function} callback 
     * @returns {Function} Unsubscribe function
     */
    on(event, callback) {
        if (!this.wsCallbacks[event]) {
            this.wsCallbacks[event] = [];
        }
        this.wsCallbacks[event].push(callback);

        return () => {
            const index = this.wsCallbacks[event].indexOf(callback);
            if (index > -1) {
                this.wsCallbacks[event].splice(index, 1);
            }
        };
    }

    /**
     * Trigger callbacks for an event
     * @param {string} event 
     * @param {*} data 
     */
    _triggerCallback(event, data) {
        if (this.wsCallbacks[event]) {
            this.wsCallbacks[event].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`WebSocket ${event} callback error:`, error);
                }
            });
        }
    }

    /**
     * Disconnect WebSocket
     */
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    /**
     * Check if WebSocket is connected
     * @returns {boolean}
     */
    isConnected() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    /**
     * Get current session ID
     * @returns {string|null}
     */
    getSessionId() {
        return this.sessionId;
    }

    /**
     * Set session ID
     * @param {string} sessionId 
     */
    setSessionId(sessionId) {
        this.sessionId = sessionId;
    }

    /**
     * Clear session
     */
    clearSession() {
        this.sessionId = null;
    }

    /**
     * Health check - verify API is accessible
     * @returns {Promise<boolean>}
     */
    async healthCheck() {
        try {
            const response = await fetch(this._getURL('/api/health'), {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });
            return response.ok;
        } catch (error) {
            console.error('Health check failed:', error);
            return false;
        }
    }

    /**
     * Stream canvas request (Server-Sent Events)
     * @param {Object} params 
     * @param {Function} onChunk - Callback for each chunk
     * @param {Function} onComplete - Callback when complete
     * @param {Function} onError - Callback on error
     */
    async streamCanvasRequest(params, onChunk, onComplete, onError) {
        try {
            const response = await fetch(this._getURL('/api/canvas/stream'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream'
                },
                body: JSON.stringify({
                    ...params,
                    sessionId: params.sessionId || this.sessionId
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                
                if (done) {
                    onComplete?.();
                    break;
                }

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            onChunk?.(data);
                        } catch (e) {
                            // Handle non-JSON data (raw content)
                            onChunk?.({ type: 'content', data: line.slice(6) });
                        }
                    }
                }
            }
        } catch (error) {
            onError?.(error);
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CanvasAPI;
}
