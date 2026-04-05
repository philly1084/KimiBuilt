/**
 * API Module - OpenAI SDK integration for LillyBuilt AI
 * Handles SDK loading gracefully with fallbacks
 */

const API = (function() {
    const NOTES_TASK_TYPE = 'notes';
    const NOTES_CLIENT_SURFACE = 'notes';

    // Auto-detect backend URL
    const localHostnames = new Set(['localhost', '127.0.0.1', '[::1]']);
    const currentHost = window.location.hostname;
    const currentOrigin = `${window.location.protocol}//${window.location.host}`;
    const BASE_URL = localHostnames.has(currentHost)
        ? 'http://localhost:3000/v1'
        : `${currentOrigin}/v1`;
    
    // Lazy-loaded OpenAI client
    let client = null;
    let clientInitialized = false;
    
    // Current session/page ID for context
    let currentSessionId = null;
    
    /**
     * Initialize OpenAI client (lazy loading)
     */
    function getClient() {
        if (clientInitialized) return client;
        
        // Check if OpenAI SDK loaded
        if (typeof OpenAI === 'undefined') {
            console.warn('OpenAI SDK not loaded. Using fetch fallback.');
            return null;
        }
        
        try {
            client = new OpenAI({
                baseURL: BASE_URL,
                apiKey: 'any-key',
                dangerouslyAllowBrowser: true,
            });
            clientInitialized = true;
            console.log('OpenAI client initialized');
        } catch (error) {
            console.error('Failed to initialize OpenAI client:', error);
            client = null;
        }
        
        return client;
    }
    
    /**
     * Fetch wrapper for when OpenAI SDK is not available
     */
    async function fetchAPI(endpoint, options = {}) {
        const url = `${BASE_URL}${endpoint}`;
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        
        return response.json();
    }

    function filterModels(models = []) {
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
                'deepseek',
                'deepseak',
            ].some((token) => id.includes(token));

            return looksLikeChatModel && !id.includes('image');
        });
    }

    function buildMessages(message, context = []) {
        if (Array.isArray(context) && context.length > 0) {
            return [...context, { role: 'user', content: message }];
        }

        return [{ role: 'user', content: message }];
    }

    function extractTextFromValue(value) {
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) {
                return '';
            }

            if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                try {
                    const parsed = JSON.parse(trimmed);
                    const extracted = extractTextFromValue(parsed);
                    if (extracted) {
                        return extracted;
                    }
                } catch (_error) {
                    // Ignore parse failures and fall back to the raw string.
                }
            }

            return trimmed;
        }

        if (Array.isArray(value)) {
            return value
                .map((item) => extractTextFromValue(item))
                .filter(Boolean)
                .join('');
        }

        if (!value || typeof value !== 'object') {
            return '';
        }

        if (typeof value.output_text === 'string' && value.output_text.trim()) {
            return value.output_text.trim();
        }

        if (typeof value.text === 'string' && value.text.trim()) {
            return extractTextFromValue(value.text);
        }

        if (typeof value.content === 'string' && value.content.trim()) {
            return extractTextFromValue(value.content);
        }

        if (typeof value.message === 'string' && value.message.trim()) {
            return extractTextFromValue(value.message);
        }

        if (typeof value.response === 'string' && value.response.trim()) {
            return extractTextFromValue(value.response);
        }

        if (typeof value.output === 'string' && value.output.trim()) {
            return extractTextFromValue(value.output);
        }

        if (value.role === 'assistant' && Array.isArray(value.content)) {
            return extractTextFromValue(value.content);
        }

        const nestedKeys = ['content', 'output', 'message', 'response', 'data', 'item', 'items', 'value'];
        for (const key of nestedKeys) {
            const extracted = extractTextFromValue(value[key]);
            if (extracted) {
                return extracted;
            }
        }

        return '';
    }

    function extractChatContent(response) {
        return extractTextFromValue(
            response?.choices?.[0]?.message?.content
            ?? response?.choices?.[0]?.message
            ?? response?.output_text
            ?? response
        );
    }

    function setSessionId(id) {
        currentSessionId = id;
    }

    // Health check (custom endpoint)
    async function checkHealth() {
        try {
            const baseUrl = BASE_URL.replace('/v1', '');
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
    
    // Get models - fallback to fetch if SDK not available
    async function getModels() {
        const openai = getClient();
        
        if (!openai) {
            // Fallback: fetch directly
            try {
                const data = await fetchAPI('/models');
                return filterModels(data.data || []).map(m => ({
                    id: m.id,
                    name: m.id,
                    provider: m.owned_by || 'unknown'
                }));
            } catch (error) {
                console.warn('Failed to fetch models:', error);
                return [];
            }
        }
        
        try {
            const response = await openai.models.list();
            return filterModels(response.data || []).map(m => ({
                id: m.id,
                name: m.id,
                provider: m.owned_by || 'unknown'
            }));
        } catch (error) {
            console.warn('Failed to fetch models:', error.message);
            return [];
        }
    }
    
    // Get image models
    async function getImageModels() {
        try {
            const baseUrl = BASE_URL.replace('/v1', '');
            const response = await fetch(`${baseUrl}/api/images/models`);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            }

            const data = await response.json();
            return data.models || [];
        } catch (error) {
            console.warn('Failed to fetch image models:', error.message);
            return [
                { id: '', name: 'Gateway Default', sizes: ['1024x1024'], qualities: [], styles: [] },
            ];
        }
    }
    
    // Streaming chat - uses fetch fallback
    async function* streamChat(message, sessionId = null, context = [], model = null) {
        const params = {
            model: model || 'gpt-4o',
            messages: buildMessages(message, context),
            stream: true,
            taskType: NOTES_TASK_TYPE,
            clientSurface: NOTES_CLIENT_SURFACE,
            metadata: {
                taskType: NOTES_TASK_TYPE,
                clientSurface: NOTES_CLIENT_SURFACE,
            },
        };

        if (sessionId || currentSessionId) {
            params.session_id = sessionId || currentSessionId;
        }
        
        // Use fetch for streaming (works without SDK)
        try {
            const response = await fetch(`${BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const responseSessionId = response.headers.get('X-Session-Id');
            if (responseSessionId) {
                currentSessionId = responseSessionId;
            }
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            
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
                            yield { type: 'done', sessionId: currentSessionId };
                            return;
                        }
                        
                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed.choices?.[0]?.delta?.content || '';
                            currentSessionId = parsed.session_id || currentSessionId;
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
            yield { type: 'delta', content: `[Error: ${error.message}]` };
            yield { type: 'done', sessionId: currentSessionId };
        }
    }
    
    // Non-streaming chat
    async function chat(message, sessionId = null, context = [], model = null) {
        const openai = getClient();
        
        const params = {
            model: model || 'gpt-4o',
            messages: buildMessages(message, context),
            stream: false,
            taskType: NOTES_TASK_TYPE,
            clientSurface: NOTES_CLIENT_SURFACE,
            metadata: {
                taskType: NOTES_TASK_TYPE,
                clientSurface: NOTES_CLIENT_SURFACE,
            },
        };

        if (sessionId || currentSessionId) {
            params.session_id = sessionId || currentSessionId;
        }
        
        try {
            let response;
            
            if (openai) {
                response = await openai.chat.completions.create(params);
            } else {
                response = await fetchAPI('/chat/completions', {
                    method: 'POST',
                    body: JSON.stringify(params),
                });
            }
            
            if (response.session_id) {
                currentSessionId = response.session_id;
            }
            
            return {
                response: extractChatContent(response),
                sessionId: currentSessionId,
            };
        } catch (error) {
            console.warn('Chat failed:', error.message);
            return {
                response: `[Error: ${error.message}]`,
                sessionId: currentSessionId || 'local-' + Date.now()
            };
        }
    }
    
    // Generate content (for AI blocks)
    async function generate(prompt, model = null) {
        const result = await chat(prompt, null, [], model);
        return result;
    }
    
    // Generate image using backend API
    async function generateImage(promptOrOptions, options = {}) {
        const request = (promptOrOptions && typeof promptOrOptions === 'object' && !Array.isArray(promptOrOptions))
            ? promptOrOptions
            : { prompt: promptOrOptions, ...options };

        const {
            prompt,
            model = null,
            size = '1024x1024',
            quality,
            style,
            n,
            sessionId = currentSessionId,
        } = request;

        const params = {
            prompt,
            size,
        };

        if (model) params.model = model;

        if (quality) params.quality = quality;
        if (style) params.style = style;
        if (n) params.n = n;
        if (sessionId) params.sessionId = sessionId;
        
        try {
            // Use the backend API endpoint
            const baseUrl = BASE_URL.replace('/v1', '');
            const response = await fetch(`${baseUrl}/api/images`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const data = await response.json();
            const firstImage = data.data?.[0] || {};
            const imageUrl = firstImage.url || (firstImage.b64_json ? `data:image/png;base64,${firstImage.b64_json}` : null);
            
            return {
                url: imageUrl,
                revised_prompt: firstImage.revised_prompt,
                created: data.created,
                model: data.model || params.model,
                size: data.size || params.size,
                quality: data.quality || params.quality || null,
                style: data.style || params.style || null,
                sessionId: data.sessionId || sessionId,
            };
        } catch (error) {
            console.warn('Image generation failed:', error.message);
            throw error;
        }
    }
    
    // Search Unsplash for images
    async function searchUnsplash(query, options = {}) {
        const { perPage = 12, page = 1 } = options;
        
        try {
            const baseUrl = BASE_URL.replace('/v1', '');
            const params = new URLSearchParams({
                q: query,
                per_page: String(perPage),
                page: String(page),
            });
            
            const response = await fetch(`${baseUrl}/api/unsplash/search?${params}`);
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const data = await response.json();
            
            return {
                results: data.results || [],
                total: data.total || 0,
                total_pages: data.total_pages || 0,
            };
        } catch (error) {
            console.warn('Unsplash search failed:', error.message);
            throw error;
        }
    }
    
    // Clear model cache
    function clearModelCache() {
        // No-op for this implementation
    }
    
    // Fetch bookmark metadata from URL
    async function fetchBookmarkData(url) {
        // Fallback: extract domain and create basic info
        try {
            const urlObj = new URL(url);
            return {
                url: url,
                title: urlObj.hostname,
                description: '',
                favicon: `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`,
                image: ''
            };
        } catch {
            console.warn('Bookmark metadata fallback failed for URL:', url);
            return {
                url: url,
                title: url,
                description: '',
                favicon: '',
                image: ''
            };
        }
    }
    
    // Legacy session functions (no backend)
    async function createSession(title = 'New Page') {
        return { id: 'local-' + Date.now(), title };
    }
    
    async function getSession(sessionId) {
        return null;
    }
    
    async function deleteSession(sessionId) {
        return true;
    }
    
    return {
        checkHealth,
        getModels,
        getImageModels,
        chat,
        streamChat,
        generate,
        generateImage,
        searchUnsplash,
        setSessionId,
        clearModelCache,
        createSession,
        getSession,
        deleteSession,
        fetchBookmarkData,
        BASE_URL,
    };
})();

