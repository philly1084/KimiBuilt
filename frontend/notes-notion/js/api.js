/**
 * API Module - OpenAI SDK integration for KimiBuilt AI
 */

const API = (function() {
    const BASE_URL = 'http://localhost:3000/v1';
    
    const client = new OpenAI({
        baseURL: BASE_URL,
        apiKey: 'any-key',
        dangerouslyAllowBrowser: true,
    });

    // Current session/page ID for context
    let currentSessionId = null;

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

    // Get models using OpenAI SDK
    async function getModels() {
        try {
            const response = await client.models.list();
            return (response.data || []).map(m => ({
                id: m.id,
                name: m.id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
                provider: m.owned_by || 'unknown'
            }));
        } catch (error) {
            console.warn('Failed to fetch models:', error.message);
            return [
                { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
                { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
                { id: 'claude-3-opus', name: 'Claude 3 Opus', provider: 'anthropic' },
                { id: 'claude-3-sonnet', name: 'Claude 3 Sonnet', provider: 'anthropic' },
                { id: 'claude-3-haiku', name: 'Claude 3 Haiku', provider: 'anthropic' }
            ];
        }
    }

    // Chat with streaming
    async function* streamChat(message, sessionId = null, model = null) {
        const params = {
            model: model || 'gpt-4o',
            messages: [{ role: 'user', content: message }],
            stream: true,
        };

        if (sessionId || currentSessionId) {
            params.session_id = sessionId || currentSessionId;
        }

        try {
            const stream = await client.chat.completions.create(params);
            
            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || '';
                if (content) {
                    yield {
                        type: 'delta',
                        content,
                    };
                }
                
                if (chunk.choices[0]?.finish_reason) {
                    if (chunk.session_id) {
                        currentSessionId = chunk.session_id;
                    }
                    yield {
                        type: 'done',
                        sessionId: currentSessionId,
                    };
                }
            }
        } catch (error) {
            console.error('Stream error:', error);
            // Fallback for offline mode
            yield { type: 'delta', content: `[Offline] ${message}` };
            yield { type: 'done', sessionId: currentSessionId };
        }
    }

    // Non-streaming chat
    async function chat(message, sessionId = null, context = [], model = null) {
        const params = {
            model: model || 'gpt-4o',
            messages: [{ role: 'user', content: message }],
            stream: false,
        };

        if (sessionId || currentSessionId) {
            params.session_id = sessionId || currentSessionId;
        }

        try {
            const response = await client.chat.completions.create(params);
            
            if (response.session_id) {
                currentSessionId = response.session_id;
            }

            return {
                response: response.choices[0]?.message?.content || '',
                sessionId: currentSessionId,
            };
        } catch (error) {
            console.warn('Chat failed:', error.message);
            return {
                response: `[Offline Mode${model ? ` - ${model}` : ''}] AI response would be generated here for: "${message}"`,
                sessionId: currentSessionId || 'local-' + Date.now()
            };
        }
    }

    // Generate content (for AI blocks)
    async function generate(prompt, type = 'text', model = null) {
        const prompts = {
            text: `Generate the following content:\n\n${prompt}`,
            improve: `Improve the following writing:\n\n${prompt}`,
            shorten: `Make this shorter and more concise:\n\n${prompt}`,
            lengthen: `Expand on this with more detail:\n\n${prompt}`,
            fix: `Fix spelling and grammar:\n\n${prompt}`,
            professional: `Rewrite in a professional tone:\n\n${prompt}`,
            casual: `Rewrite in a casual, friendly tone:\n\n${prompt}`,
            summarize: `Summarize the following:\n\n${prompt}`,
            bullets: `Convert to bullet points:\n\n${prompt}`,
            continue: `Continue writing from here:\n\n${prompt}`
        };
        
        const finalPrompt = prompts[type] || prompts.text;
        const result = await chat(finalPrompt, null, [], model);
        return result.response;
    }

    // Generate image
    async function generateImage(options = {}) {
        const {
            prompt,
            model = 'dall-e-3',
            size = '1024x1024',
            quality = 'standard',
            style = 'vivid'
        } = options;
        
        if (!prompt) {
            throw new Error('Prompt is required for image generation');
        }
        
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
            const response = await client.images.generate(params);
            
            if (response.session_id) {
                currentSessionId = response.session_id;
            }

            return {
                url: response.data[0]?.url,
                revised_prompt: response.data[0]?.revised_prompt,
                model: params.model,
            };
        } catch (error) {
            console.warn('Image generation failed:', error.message);
            return {
                url: `https://placehold.co/${size}/4338ca/ffffff?text=${encodeURIComponent('AI Image: ' + prompt.substring(0, 30))}`,
                revised_prompt: prompt,
                model: params.model,
                offline: true
            };
        }
    }

    // Get image models
    async function getImageModels() {
        return [
            { id: 'dall-e-3', name: 'DALL-E 3', provider: 'openai', sizes: ['1024x1024', '1024x1792', '1792x1024'], qualities: ['standard', 'hd'] },
            { id: 'dall-e-2', name: 'DALL-E 2', provider: 'openai', sizes: ['256x256', '512x512', '1024x1024'], qualities: ['standard'] }
        ];
    }

    // Fetch URL metadata for bookmarks (not an OpenAI API, kept as-is)
    async function fetchBookmarkData(url) {
        try {
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
            const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
            const html = await response.text();
            
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            const getMeta = (name) => {
                const meta = doc.querySelector(`meta[property="og:${name}"], meta[name="${name}"], meta[name="twitter:${name}"]`);
                return meta?.getAttribute('content') || '';
            };
            
            const title = getMeta('title') || doc.title || url;
            const description = getMeta('description') || '';
            const image = getMeta('image') || '';
            
            let favicon = '';
            const faviconLink = doc.querySelector('link[rel*="icon"]');
            if (faviconLink) {
                favicon = faviconLink.href;
                if (!favicon.startsWith('http')) {
                    const urlObj = new URL(url);
                    favicon = `${urlObj.protocol}//${urlObj.host}${favicon}`;
                }
            }
            
            return {
                title,
                description: description.slice(0, 200),
                image,
                favicon: favicon || `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}`,
                url
            };
        } catch (error) {
            console.error('Error fetching bookmark:', error);
            return {
                title: url,
                description: '',
                image: '',
                favicon: `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}`,
                url
            };
        }
    }

    // Legacy compatibility: createSession (no longer needed with OpenAI SDK)
    async function createSession(title = 'New Page') {
        // Sessions are now managed via session_id parameter
        currentSessionId = null;
        return { id: 'local-' + Date.now(), title };
    }

    // Legacy compatibility: getSession
    async function getSession(sessionId) {
        return { id: sessionId, blocks: [] };
    }

    // Legacy compatibility: deleteSession
    async function deleteSession(sessionId) {
        if (currentSessionId === sessionId) {
            currentSessionId = null;
        }
        return { success: true };
    }

    // Check if backend is available
    async function isAvailable() {
        const health = await checkHealth();
        return health.connected;
    }

    // Clear model cache
    function clearModelCache() {
        // No cache with OpenAI SDK
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
        fetchBookmarkData,
        createSession,
        getSession,
        deleteSession,
        isAvailable,
        clearModelCache,
        BASE_URL: BASE_URL.replace('/v1', ''),
    };
})();
