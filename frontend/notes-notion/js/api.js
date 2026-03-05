/**
 * API Module - Backend integration for KimiBuilt AI
 */

const API = (function() {
    const BASE_URL = 'http://localhost:3000';
    
    // Cache for models
    let cachedModels = null;
    let cachedImageModels = null;
    
    /**
     * Make a fetch request with error handling
     */
    async function request(endpoint, options = {}) {
        const url = `${BASE_URL}${endpoint}`;
        
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        };
        
        try {
            const response = await fetch(url, { ...defaultOptions, ...options });
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Unknown error' }));
                throw new Error(error.message || `HTTP ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    }
    
    /**
     * Create a new session (page)
     */
    async function createSession(title = 'New Page') {
        try {
            return await request('/api/sessions', {
                method: 'POST',
                body: JSON.stringify({ title })
            });
        } catch (error) {
            console.warn('Backend unavailable, using local mode:', error.message);
            return null;
        }
    }
    
    /**
     * Get a session by ID
     */
    async function getSession(sessionId) {
        try {
            return await request(`/api/sessions/${sessionId}`);
        } catch (error) {
            console.warn('Backend unavailable:', error.message);
            return null;
        }
    }
    
    /**
     * Delete a session
     */
    async function deleteSession(sessionId) {
        try {
            return await request(`/api/sessions/${sessionId}`, {
                method: 'DELETE'
            });
        } catch (error) {
            console.warn('Backend unavailable:', error.message);
            return null;
        }
    }
    
    /**
     * Get available chat models
     */
    async function getModels() {
        if (cachedModels) {
            return cachedModels;
        }
        
        try {
            const response = await request('/api/models');
            cachedModels = response.models || [];
            return cachedModels;
        } catch (error) {
            console.warn('Failed to fetch models:', error.message);
            // Return default models as fallback
            return [
                { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
                { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
                { id: 'claude-3-opus', name: 'Claude 3 Opus', provider: 'anthropic' },
                { id: 'claude-3-sonnet', name: 'Claude 3 Sonnet', provider: 'anthropic' },
                { id: 'claude-3-haiku', name: 'Claude 3 Haiku', provider: 'anthropic' }
            ];
        }
    }
    
    /**
     * Get available image generation models
     */
    async function getImageModels() {
        if (cachedImageModels) {
            return cachedImageModels;
        }
        
        try {
            const response = await request('/api/images/models');
            cachedImageModels = response.models || [];
            return cachedImageModels;
        } catch (error) {
            console.warn('Failed to fetch image models:', error.message);
            // Return default image models as fallback
            return [
                { id: 'dall-e-3', name: 'DALL-E 3', provider: 'openai' },
                { id: 'dall-e-2', name: 'DALL-E 2', provider: 'openai' }
            ];
        }
    }
    
    /**
     * Send a chat message to AI
     */
    async function chat(message, sessionId = null, context = [], model = null) {
        try {
            return await request('/api/chat', {
                method: 'POST',
                body: JSON.stringify({
                    message,
                    sessionId,
                    context,
                    model
                })
            });
        } catch (error) {
            console.warn('Backend unavailable:', error.message);
            // Return a simulated response for demo
            return {
                response: `[Offline Mode${model ? ` - ${model}` : ''}] AI response would be generated here for: "${message}"`,
                sessionId: sessionId || 'local-' + Date.now()
            };
        }
    }
    
    /**
     * Stream chat response (for real-time updates)
     */
    async function* streamChat(message, sessionId = null, model = null) {
        const url = `${BASE_URL}/api/chat/stream`;
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message, sessionId, model })
            });
            
            if (!response.ok) throw new Error('Stream failed');
            
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
                        if (data === '[DONE]') return;
                        
                        try {
                            const parsed = JSON.parse(data);
                            yield parsed;
                        } catch (e) {
                            yield { content: data };
                        }
                    }
                }
            }
        } catch (error) {
            console.warn('Stream failed, falling back to regular chat:', error);
            const result = await chat(message, sessionId, [], model);
            yield { content: result.response };
        }
    }
    
    /**
     * Generate content with AI
     */
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
    
    /**
     * Generate an image
     */
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
        
        try {
            const response = await request('/api/images', {
                method: 'POST',
                body: JSON.stringify({
                    prompt,
                    model,
                    size,
                    quality,
                    style
                })
            });
            
            return {
                url: response.url,
                revised_prompt: response.revised_prompt,
                model
            };
        } catch (error) {
            console.warn('Image generation failed:', error.message);
            // Return a placeholder for demo
            return {
                url: `https://placehold.co/${size}/4338ca/ffffff?text=${encodeURIComponent('AI Image: ' + prompt.substring(0, 30))}`,
                revised_prompt: prompt,
                model,
                offline: true
            };
        }
    }
    
    /**
     * Check if backend is available
     */
    async function checkHealth() {
        try {
            const response = await fetch(`${BASE_URL}/api/health`, { 
                method: 'GET',
                signal: AbortSignal.timeout(3000)
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    }
    
    /**
     * Fetch URL metadata for bookmarks
     */
    async function fetchBookmarkData(url) {
        try {
            // Try to use a meta tag scraping approach or a service
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
            
            // Get favicon
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
    
    /**
     * Clear model cache (useful when backend models change)
     */
    function clearModelCache() {
        cachedModels = null;
        cachedImageModels = null;
    }
    
    return {
        createSession,
        getSession,
        deleteSession,
        getModels,
        getImageModels,
        chat,
        streamChat,
        generate,
        generateImage,
        checkHealth,
        fetchBookmarkData,
        clearModelCache,
        BASE_URL
    };
})();
