/**
 * API Module - OpenAI SDK integration for KimiBuilt AI
 * Handles SDK loading gracefully with fallbacks
 */

const API = (function() {
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

    function extractChatContent(response) {
        return response?.choices?.[0]?.message?.content || '';
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
        return [
            { id: 'dall-e-3', name: 'DALL-E 3', sizes: ['1024x1024', '1024x1792', '1792x1024'], qualities: ['standard', 'hd'] },
            { id: 'dall-e-2', name: 'DALL-E 2', sizes: ['256x256', '512x512', '1024x1024'], qualities: ['standard'] }
        ];
    }
    
    // Streaming chat - uses fetch fallback
    async function* streamChat(message, sessionId = null, context = [], model = null) {
        const params = {
            model: model || 'gpt-4o',
            messages: buildMessages(message, context),
            stream: true,
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
                            yield { type: 'done', sessionId: currentSessionId };
                            return;
                        }
                        
                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed.choices?.[0]?.delta?.content || '';
                            if (parsed.session_id) {
                                currentSessionId = parsed.session_id;
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
    
    // Generate image
    async function generateImage(prompt, options = {}) {
        const { model, size, quality, style } = options;
        const openai = getClient();
        
        const params = {
            model: model || 'dall-e-3',
            prompt,
            n: 1,
            size: size || '1024x1024',
        };

        if (quality) params.quality = quality;
        if (style) params.style = style;
        if (currentSessionId) params.session_id = currentSessionId;
        
        try {
            let response;
            
            if (openai) {
                response = await openai.images.generate(params);
            } else {
                response = await fetchAPI('/images/generations', {
                    method: 'POST',
                    body: JSON.stringify(params),
                });
            }
            
            if (response.session_id) {
                currentSessionId = response.session_id;
            }

            return {
                url: response.data?.[0]?.url,
                revised_prompt: response.data?.[0]?.revised_prompt,
                model: params.model,
            };
        } catch (error) {
            console.warn('Image generation failed:', error.message);
            return {
                url: `https://placehold.co/1024x1024/4338ca/ffffff?text=${encodeURIComponent('Error: ' + error.message)}`,
                revised_prompt: prompt,
                model: params.model,
                offline: true
            };
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
        setSessionId,
        clearModelCache,
        createSession,
        getSession,
        deleteSession,
        fetchBookmarkData,
        BASE_URL,
    };
})();
