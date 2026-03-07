/**
 * Web CLI API Client
 * Uses OpenAI-compatible endpoints
 */

const API_BASE_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000/v1'
    : `${window.location.protocol}//${window.location.hostname}/v1`;

class WebCLIAPI {
    constructor() {
        this.sessionId = null;
        this.currentModel = 'gpt-4o';
        this.models = [];
    }

    async checkHealth() {
        try {
            const baseUrl = API_BASE_URL.replace('/v1', '');
            const response = await fetch(`${baseUrl}/health`, { timeout: 5000 });
            if (response.ok) {
                const data = await response.json();
                return { connected: true, data };
            }
            return { connected: false, error: 'Health check failed' };
        } catch (error) {
            return { connected: false, error: error.message };
        }
    }

    async getModels() {
        try {
            const response = await fetch(`${API_BASE_URL}/models`);
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
            { id: 'gpt-4o', name: 'GPT-4o' },
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
        ];
        return this.models;
    }

    async *streamChat(message, model = null, mode = 'chat') {
        const messages = [{ role: 'user', content: message }];
        const params = {
            model: model || this.currentModel,
            messages,
            stream: true,
        };

        if (this.sessionId) {
            params.session_id = this.sessionId;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
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
                            // Ignore parse errors
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Stream error:', error);
            yield { type: 'error', error: error.message };
        }
    }

    async sendCanvasRequest(message, canvasType = 'document', existingContent = '') {
        const baseUrl = API_BASE_URL.replace('/v1', '');
        const response = await fetch(`${baseUrl}/api/canvas`, {
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
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data.sessionId) {
            this.sessionId = data.sessionId;
        }
        return data;
    }

    async sendNotationRequest(notation, helperMode = 'expand', context = '') {
        const baseUrl = API_BASE_URL.replace('/v1', '');
        const response = await fetch(`${baseUrl}/api/notation`, {
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
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data.sessionId) {
            this.sessionId = data.sessionId;
        }
        return data;
    }

    setModel(model) {
        this.currentModel = model;
    }

    clearSession() {
        this.sessionId = null;
    }
}

const api = new WebCLIAPI();
