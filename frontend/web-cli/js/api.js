/**
 * Web CLI API Client
 * Uses OpenAI-compatible endpoints with fetch only (no SDK)
 */

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const API_BASE_URL = LOCAL_HOSTNAMES.has(window.location.hostname)
    ? 'http://localhost:3000/v1'
    : `${window.location.protocol}//${window.location.host}/v1`;
const BASE_URL_WITHOUT_API = API_BASE_URL.replace('/v1', '');

// Default request timeout in milliseconds
const DEFAULT_TIMEOUT = 120000;
const CHAT_STREAM_TIMEOUT = 180000;
const LOCAL_MODEL_TIMEOUT = 300000;
const IMAGE_TIMEOUT = 240000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
const WEB_CLI_TASK_TYPE = 'chat';
const WEB_CLI_CLIENT_SURFACE = 'web-cli';
const WEB_CLI_REMOTE_BUILD_AUTONOMY_APPROVED = true;
const WEB_CLI_SESSION_ISOLATION = true;

class WebCLIAPI {
    constructor() {
        this.sessionId = null;
        this.currentModel = null;
        this.models = [];
        this.connectionStatus = 'unknown';
        this.lastHealthCheck = null;
    }

    async parseErrorResponse(response) {
        if (!response) {
            return '';
        }

        try {
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const data = await response.json();
                return data?.error?.message || data?.message || JSON.stringify(data);
            }

            return (await response.text()).trim();
        } catch (_error) {
            return '';
        }
    }

    isLikelyLocalModel(modelId = '') {
        return /(ollama|llama|mistral|qwen|phi|gemma|deepseek|deepseak|local)/i.test(String(modelId || ''));
    }

    getChatTimeout(modelId = null, stream = true) {
        const effectiveModel = modelId || this.currentModel || '';
        if (this.isLikelyLocalModel(effectiveModel)) {
            return LOCAL_MODEL_TIMEOUT;
        }
        return stream ? CHAT_STREAM_TIMEOUT : DEFAULT_TIMEOUT;
    }

    extractStreamSessionId(payload = {}) {
        return payload?.session_id
            || payload?.sessionId
            || payload?.response?.session_id
            || payload?.response?.sessionId
            || null;
    }

    extractStreamContent(payload = {}) {
        if (payload?.type === 'response.output_text.delta') {
            return String(payload.delta || '');
        }

        if (payload?.type === 'delta') {
            return String(payload.content || payload.delta || '');
        }

        return String(
            payload?.choices?.[0]?.delta?.content
            || payload?.output_text_delta
            || '',
        );
    }

    extractStreamProgress(payload = {}) {
        if (payload?.type !== 'progress') {
            return null;
        }

        const progress = payload.progress && typeof payload.progress === 'object'
            ? payload.progress
            : {};
        const phase = String(progress.phase || payload.phase || 'thinking').trim() || 'thinking';
        const detail = String(progress.detail || payload.detail || '').trim();

        return {
            ...progress,
            phase,
            detail,
        };
    }

    buildToolEventDetail(toolCall = {}, stage = 'started') {
        const rawToolName = String(
            toolCall?.function?.name
            || toolCall?.name
            || toolCall?.toolName
            || toolCall?.id
            || toolCall?.call_id
            || 'tool',
        ).trim();
        const toolName = rawToolName.replace(/[_-]+/g, ' ').trim() || 'tool';
        const normalizedStage = String(stage || '').toLowerCase().includes('done') ? 'completed' : 'started';

        return {
            type: 'tool_event',
            stage: normalizedStage,
            toolName: rawToolName,
            detail: normalizedStage === 'completed'
                ? `Finished ${toolName}`
                : `Running ${toolName}`,
            item: toolCall,
        };
    }

    extractStreamToolEvents(payload = {}) {
        const events = [];
        const choiceToolCalls = payload?.choices?.[0]?.delta?.tool_calls;
        if (Array.isArray(choiceToolCalls)) {
            choiceToolCalls.forEach((toolCall) => {
                events.push(this.buildToolEventDetail(toolCall, 'started'));
            });
        }

        if (Array.isArray(payload?.tool_calls)) {
            payload.tool_calls.forEach((toolCall) => {
                events.push(this.buildToolEventDetail(toolCall, 'started'));
            });
        }

        if ((payload?.type === 'response.output_item.added' || payload?.type === 'response.output_item.done')
            && payload?.item) {
            events.push(this.buildToolEventDetail(payload.item, payload.type.endsWith('.done') ? 'done' : 'started'));
        }

        return events;
    }

    extractCompletedToolEvents(payload = {}) {
        return Array.isArray(payload?.toolEvents)
            ? payload.toolEvents
            : (Array.isArray(payload?.tool_events) ? payload.tool_events : []);
    }

    extractArtifacts(payload = {}) {
        return Array.isArray(payload?.artifacts) ? payload.artifacts : [];
    }

    isTerminalStreamPayload(payload = {}) {
        const finishReason = String(payload?.choices?.[0]?.finish_reason || '').toLowerCase();
        return payload?.type === 'done'
            || payload?.type === 'response.completed'
            || ['stop', 'length', 'content_filter'].includes(finishReason);
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
    async fetchWithRetry(url, options = {}, retries = MAX_RETRIES, timeout = DEFAULT_TIMEOUT) {
        let lastError;
        
        for (let i = 0; i <= retries; i++) {
            try {
                const response = await this.fetchWithTimeout(url, options, timeout);
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
                if (this.models.length > 0) {
                    const modelExists = this.currentModel && this.models.some((model) => model.id === this.currentModel);
                    if (!modelExists) {
                        this.currentModel = this.models[0].id;
                    }
                }
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
        if (!this.currentModel) {
            this.currentModel = this.models[0].id;
        }
        return this.models;
    }

    async *streamChat(message, model = null, mode = 'chat', conversationHistory = [], options = {}) {
        await this.ensureSession({ title: options.sessionTitle || 'Voxel CLI' });

        const messages = [
            ...(Array.isArray(options.systemMessages) ? options.systemMessages : []),
            ...conversationHistory,
            { role: 'user', content: message }
        ];
        
        const params = {
            model: model || this.currentModel,
            messages,
            stream: true,
            enableConversationExecutor: true,
            taskType: WEB_CLI_TASK_TYPE,
            clientSurface: WEB_CLI_CLIENT_SURFACE,
            memoryScope: WEB_CLI_CLIENT_SURFACE,
            metadata: {
                remoteBuildAutonomyApproved: WEB_CLI_REMOTE_BUILD_AUTONOMY_APPROVED,
                enableConversationExecutor: true,
                clientSurface: WEB_CLI_CLIENT_SURFACE,
                memoryScope: WEB_CLI_CLIENT_SURFACE,
                sessionIsolation: WEB_CLI_SESSION_ISOLATION,
                ...(options.metadata && typeof options.metadata === 'object' ? options.metadata : {}),
            },
        };

        if (this.sessionId) {
            params.session_id = this.sessionId;
        }

        try {
            const response = await this.fetchWithRetry(`${API_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream',
                },
                body: JSON.stringify(params),
            }, MAX_RETRIES, this.getChatTimeout(params.model, true));

            if (!response.ok) {
                const errorText = await this.parseErrorResponse(response);
                let errorMessage = errorText || `HTTP ${response.status}`;
                let suggestions = [];
                
                if (response.status === 401) {
                    errorMessage = 'Authentication failed. Please check your API key.';
                    suggestions = ['Verify API key configuration', 'Check if API key has expired'];
                } else if (response.status === 429) {
                    errorMessage = errorText || 'Rate limit exceeded. Please wait a moment.';
                    suggestions = ['Wait a few seconds before retrying', 'Consider reducing request frequency'];
                } else if (response.status >= 500) {
                    errorMessage = errorText || 'Server error. The AI service may be experiencing issues.';
                    suggestions = ['Try again in a moment', 'Switch to a different model', 'Check server status'];
                }
                
                yield { type: 'error', error: errorMessage, suggestions };
                return;
            }

            const responseSessionId = response.headers.get('X-Session-Id');
            if (responseSessionId) {
                this.sessionId = responseSessionId;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let pendingDone = {
                sessionId: this.sessionId,
                artifacts: [],
                toolEvents: [],
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') {
                            yield { type: 'done', ...pendingDone, sessionId: this.sessionId || pendingDone.sessionId };
                            return;
                        }
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.error) {
                                yield {
                                    type: 'error',
                                    error: parsed.error.message || parsed.error || 'Stream error',
                                    suggestions: ['Retry the request', 'Check backend logs if the problem persists'],
                                };
                                return;
                            }
                            const content = this.extractStreamContent(parsed);
                            const streamSessionId = this.extractStreamSessionId(parsed);
                            this.sessionId = streamSessionId || this.sessionId;
                            pendingDone.sessionId = this.sessionId || pendingDone.sessionId;
                            const completedToolEvents = this.extractCompletedToolEvents(parsed);
                            if (completedToolEvents.length > 0) {
                                pendingDone.toolEvents = completedToolEvents;
                            }
                            const artifacts = this.extractArtifacts(parsed);
                            if (artifacts.length > 0) {
                                pendingDone.artifacts = artifacts;
                            }
                            const progress = this.extractStreamProgress(parsed);
                            if (progress) {
                                yield {
                                    type: 'progress',
                                    progress,
                                    phase: progress.phase,
                                    detail: progress.detail,
                                    sessionId: this.sessionId,
                                };
                            }
                            for (const toolEvent of this.extractStreamToolEvents(parsed)) {
                                yield {
                                    ...toolEvent,
                                    sessionId: this.sessionId,
                                };
                            }
                            if (content) {
                                yield { type: 'delta', content };
                            }

                            if (this.isTerminalStreamPayload(parsed)) {
                                yield { type: 'done', ...pendingDone, sessionId: this.sessionId || pendingDone.sessionId };
                                return;
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
                suggestions = this.isLikelyLocalModel(model || this.currentModel)
                    ? ['The local model is taking longer to produce the first tokens', 'Wait for the model to warm up or load into memory', 'Try a smaller local model if this keeps happening']
                    : ['The request took too long', 'Try a shorter message', 'Check server load'];
            }
            
            yield { type: 'error', error: error.message, suggestions };
        }
    }

    /**
     * Simple non-streaming message send (for compatibility)
     * Collects all streaming chunks and returns complete response
     */
    async sendMessage(message, onChunk = null, model = null, options = {}) {
        const chunks = [];
        let fullContent = '';
        let tokens = 0;
        let finalChunk = null;
        
        for await (const chunk of this.streamChat(
            message,
            model,
            options.mode || 'chat',
            options.conversationHistory || [],
            options,
        )) {
            if (chunk.type === 'delta') {
                fullContent += chunk.content;
                tokens += 1; // Approximate
                if (onChunk) {
                    onChunk(chunk);
                }
            } else if (chunk.type === 'progress' || chunk.type === 'tool_event') {
                if (onChunk) {
                    onChunk(chunk);
                }
            } else if (chunk.type === 'error') {
                throw new Error(chunk.error);
            } else if (chunk.type === 'done') {
                finalChunk = chunk;
                break;
            }
        }
        
        return {
            content: fullContent,
            tokens: tokens,
            sessionId: this.sessionId,
            artifacts: Array.isArray(finalChunk?.artifacts) ? finalChunk.artifacts : [],
            toolEvents: Array.isArray(finalChunk?.toolEvents) ? finalChunk.toolEvents : [],
        };
    }

    async sendCanvasRequest(message, canvasType = 'document', existingContent = '') {
        const baseUrl = API_BASE_URL.replace('/v1', '');
        await this.ensureSession({ title: 'Voxel Canvas' });
        
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
            }, MAX_RETRIES, this.getChatTimeout(this.currentModel, false));

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
        await this.ensureSession({ title: 'Voxel Notation' });
        
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
            }, MAX_RETRIES, this.getChatTimeout(this.currentModel, false));

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
        await this.ensureSession({ title: 'Voxel Image' });
        
        const {
            model = null,
            size = '1024x1024',
            quality = null,
            style = null,
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
            }, 2, IMAGE_TIMEOUT); // Images can legitimately take longer than chat responses

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

    async getImageModels() {
        const baseUrl = API_BASE_URL.replace('/v1', '');

        try {
            const response = await this.fetchWithRetry(`${baseUrl}/api/images/models`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
            }, 2, API_TIMEOUT);

            if (!response.ok) {
                throw new Error(`Image model lookup failed: HTTP ${response.status}`);
            }

            const data = await response.json();
            return Array.isArray(data.models) ? data.models : [];
        } catch (error) {
            console.error('Image model lookup error:', error);
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

    async getAvailableTools(category = null) {
        const params = new URLSearchParams();
        if (category) {
            params.set('category', category);
        }
        params.set('taskType', WEB_CLI_TASK_TYPE);
        params.set('clientSurface', WEB_CLI_CLIENT_SURFACE);
        if (this.sessionId && !String(this.sessionId).startsWith('local_')) {
            params.set('sessionId', this.sessionId);
        }

        const response = await this.fetchWithTimeout(
            `${BASE_URL_WITHOUT_API}/api/tools/available${params.toString() ? `?${params.toString()}` : ''}`,
            {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
            },
            10000
        );

        if (!response.ok) {
            throw new Error(`Tool list failed: HTTP ${response.status}`);
        }

        const data = await response.json();
        return {
            tools: data.data || [],
            meta: data.meta || {},
        };
    }

    async getToolDoc(toolId) {
        const response = await this.fetchWithTimeout(
            `${BASE_URL_WITHOUT_API}/api/tools/docs/${encodeURIComponent(toolId)}`,
            {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
            },
            10000
        );

        if (!response.ok) {
            throw new Error(`Tool doc failed: HTTP ${response.status}`);
        }

        const data = await response.json();
        return data.data || null;
    }

    async invokeTool(toolId, params = {}) {
        await this.ensureSession({ title: 'Voxel Tool' });

        const response = await this.fetchWithTimeout(
            `${BASE_URL_WITHOUT_API}/api/tools/invoke`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tool: toolId,
                    params,
                    sessionId: this.sessionId,
                    model: this.currentModel || null,
                    taskType: WEB_CLI_TASK_TYPE,
                    clientSurface: WEB_CLI_CLIENT_SURFACE,
                }),
            },
            120000
        );

        if (!response.ok) {
            throw new Error(`Tool invocation failed: HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data.sessionId) {
            this.sessionId = data.sessionId;
        }
        return {
            result: data.data,
            sessionId: data.sessionId || this.sessionId || null,
        };
    }

    async getSessionState() {
        const params = new URLSearchParams({
            taskType: WEB_CLI_TASK_TYPE,
            clientSurface: WEB_CLI_CLIENT_SURFACE,
        });
        const response = await this.fetchWithTimeout(
            `${BASE_URL_WITHOUT_API}/api/sessions?${params.toString()}`,
            {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
            },
            10000
        );

        if (!response.ok) {
            throw new Error(`Failed to load sessions: HTTP ${response.status}`);
        }

        return response.json();
    }

    buildSessionMetadata(metadata = {}) {
        return {
            ...metadata,
            mode: WEB_CLI_TASK_TYPE,
            taskType: WEB_CLI_TASK_TYPE,
            clientSurface: WEB_CLI_CLIENT_SURFACE,
            memoryScope: WEB_CLI_CLIENT_SURFACE,
            sessionIsolation: WEB_CLI_SESSION_ISOLATION,
        };
    }

    async createSession(options = {}) {
        const now = new Date().toISOString();
        const title = String(options.title || '').trim() || `Voxel CLI ${new Date().toLocaleString()}`;
        const metadata = this.buildSessionMetadata({
            title,
            label: title,
            createdBy: WEB_CLI_CLIENT_SURFACE,
            createdAtClient: now,
            ...(options.metadata && typeof options.metadata === 'object' ? options.metadata : {}),
        });

        const response = await this.fetchWithTimeout(
            `${BASE_URL_WITHOUT_API}/api/sessions`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taskType: WEB_CLI_TASK_TYPE,
                    clientSurface: WEB_CLI_CLIENT_SURFACE,
                    memoryScope: WEB_CLI_CLIENT_SURFACE,
                    metadata,
                }),
            },
            10000
        );

        if (!response.ok) {
            throw new Error(`Failed to create session: HTTP ${response.status}`);
        }

        const session = await response.json();
        this.sessionId = session?.id || null;
        return session;
    }

    async ensureSession(options = {}) {
        if (this.sessionId) {
            return this.sessionId;
        }

        const session = await this.createSession(options);
        return session?.id || null;
    }

    async setActiveSession(sessionId = null) {
        const response = await this.fetchWithTimeout(
            `${BASE_URL_WITHOUT_API}/api/sessions/state`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    activeSessionId: sessionId || null,
                    taskType: WEB_CLI_TASK_TYPE,
                    clientSurface: WEB_CLI_CLIENT_SURFACE,
                }),
            },
            10000
        );

        if (!response.ok) {
            throw new Error(`Failed to persist active session: HTTP ${response.status}`);
        }

        const data = await response.json();
        this.sessionId = data.activeSessionId || null;
        return data;
    }

    async getSessionMessages(sessionId = this.sessionId, limit = 100) {
        if (!sessionId) {
            return [];
        }

        const response = await this.fetchWithTimeout(
            `${BASE_URL_WITHOUT_API}/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=${encodeURIComponent(limit)}`,
            {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
            },
            10000
        );

        if (!response.ok) {
            throw new Error(`Failed to load session history: HTTP ${response.status}`);
        }

        const data = await response.json();
        return Array.isArray(data.messages) ? data.messages : [];
    }

    async getSessionArtifacts(sessionId = this.sessionId) {
        if (!sessionId) {
            return [];
        }

        const response = await this.fetchWithTimeout(
            `${BASE_URL_WITHOUT_API}/api/sessions/${encodeURIComponent(sessionId)}/artifacts`,
            {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
            },
            10000
        );

        if (!response.ok) {
            throw new Error(`Failed to load session artifacts: HTTP ${response.status}`);
        }

        const data = await response.json();
        return Array.isArray(data.artifacts) ? data.artifacts : [];
    }

    setModel(model) {
        this.currentModel = model;
    }

    setSessionId(sessionId) {
        this.sessionId = sessionId || null;
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




