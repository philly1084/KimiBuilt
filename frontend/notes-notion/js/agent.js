/**
 * AI Agent Module - Intelligent assistant for the notes-notion app
 * Provides contextual AI capabilities, chat interface, and page manipulation
 */

const Agent = (function() {
    const SHARED_MODEL_STORAGE_KEY = 'kimibuilt_default_model';
    const LEGACY_MODEL_STORAGE_KEY = 'notes_agent_model';
    let initPromise = null;

    // ============================================
    // API Client Integration
    // ============================================
    
    // Get or create API client
    function getAPIClient() {
        if (window.notesAPIClient) return window.notesAPIClient;
        
        // Create new client if not exists
        if (typeof NotesAPIClient !== 'undefined') {
            window.notesAPIClient = new NotesAPIClient();
            return window.notesAPIClient;
        }
        
        return null;
    }
    
    // Check if backend is available
    async function isBackendAvailable() {
        const apiClient = getAPIClient();
        if (!apiClient) return false;
        
        try {
            // Try to fetch models as a health check
            await apiClient.getModels();
            return true;
        } catch (error) {
            console.log('Backend not available:', error.message);
            return false;
        }
    }
    
    function truncateText(text, maxLength = 240) {
        const normalized = String(text || '').replace(/\s+/g, ' ').trim();
        if (!normalized) return '';
        if (normalized.length <= maxLength) return normalized;
        return `${normalized.slice(0, maxLength - 3)}...`;
    }

    function formatTimestamp(timestamp) {
        if (!timestamp) return 'unknown';
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) return 'unknown';
        return date.toISOString();
    }

    function extractBlockTextValue(block) {
        if (!block) return '';

        const content = block.content;
        if (typeof content === 'string') {
            return content;
        }

        if (!content || typeof content !== 'object') {
            return '';
        }

        switch (block.type) {
            case 'todo': {
                const checked = content.checked ? '[x]' : '[ ]';
                return `${checked} ${content.text || ''}`.trim();
            }
            case 'code':
                return content.text || '';
            case 'mermaid':
                return content.text ? `Mermaid ${content.diagramType || 'diagram'}: ${content.text}` : '';
            case 'ai': {
                const parts = [];
                if (content.prompt) parts.push(`Prompt: ${content.prompt}`);
                if (content.result) parts.push(`Result: ${content.result}`);
                return parts.join('\n');
            }
            case 'image':
            case 'ai_image':
                return content.caption || content.alt || content.url || 'Image block';
            case 'bookmark':
                return content.title || content.description || content.url || 'Bookmark block';
            case 'database': {
                const columns = Array.isArray(content.columns) ? content.columns.length : 0;
                const rows = Array.isArray(content.rows) ? content.rows.length : 0;
                return `Database with ${columns} columns and ${rows} rows`;
            }
            case 'math':
                return content.text || content.latex || '';
            default:
                return content.text ||
                    content.prompt ||
                    content.result ||
                    content.url ||
                    content.caption ||
                    '';
        }
    }

    function buildPageContentSnapshot(pageContext) {
        if (!pageContext?.blocks?.length) {
            return '(page is empty)';
        }

        return pageContext.blocks.map((block) => {
            const indent = '  '.repeat(block.depth);
            const prefix = `${indent}- [${block.id}] ${block.type}`;
            const preview = truncateText(block.content, 220);
            return preview ? `${prefix}: ${preview}` : prefix;
        }).join('\n');
    }

    function getSelectionSnapshot(pageContext) {
        const selectedBlockId = window.Selection?.getSelectedBlockId?.() || null;
        const selectedText = truncateText(window.Selection?.getSelectedText?.() || '', 300);

        if (!selectedBlockId && !selectedText) {
            return {
                selectedBlockSummary: 'No block is selected.',
                selectedText: ''
            };
        }

        const selectedBlock = pageContext?.blocks?.find((block) => block.id === selectedBlockId) || null;
        const selectedBlockSummary = selectedBlock
            ? `[${selectedBlock.id}] ${selectedBlock.type}: ${truncateText(selectedBlock.content, 220)}`
            : (selectedBlockId ? `Selected block id: ${selectedBlockId}` : 'No block is selected.');

        return {
            selectedBlockSummary,
            selectedText
        };
    }

    function buildPageSetupSummary(pageContext) {
        if (!pageContext) {
            return 'No page is currently loaded.';
        }

        const selection = getSelectionSnapshot(pageContext);
        const properties = Array.isArray(pageContext.properties) ? pageContext.properties.length : 0;
        const outlineItems = pageContext.outline?.length || 0;
        const setupLines = [
            `Page title: ${pageContext.title || 'Untitled'}`,
            `Page id: ${pageContext.pageId || 'unknown'}`,
            `Block count: ${pageContext.blockCount}`,
            `Word count: ${pageContext.wordCount}`,
            `Reading time: ${pageContext.readingTime} min`,
            `Default model: ${pageContext.defaultModel || state.selectedModel}`,
            `Outline headings: ${outlineItems}`,
            `Properties: ${properties}`,
            `Last updated: ${formatTimestamp(pageContext.lastUpdated)}`,
            `Selection: ${selection.selectedBlockSummary}`,
        ];

        if (selection.selectedText) {
            setupLines.push(`Selected text: ${selection.selectedText}`);
        }

        return setupLines.join('\n');
    }

    // Build system prompt with page context
    function buildSystemPrompt(pageContext) {
        const pageSetup = buildPageSetupSummary(pageContext);
        const blockMap = buildPageContentSnapshot(pageContext);
        const pageContent = (getFullPageContent() || '').slice(0, 6000);
        const outline = pageContext?.outline?.length
            ? pageContext.outline.map((heading) => `- [${heading.id}] ${heading.content}`).join('\n')
            : '- No headings yet';

        return `You are an AI assistant inside a block-based note editor.
You can see the current page setup and should answer in a way that is useful for editing blocks.

Current page setup:
${pageSetup}

Outline:
${outline}

Block map:
${blockMap}

Page content snapshot:
${pageContent || '(page is empty)'}

Instructions:
- Treat this as a live block editor, not a plain text document.
- When referring to existing content, cite block ids when helpful.
- When suggesting edits, say exactly which block to update or where to insert new content.
- Keep answers concise unless the user asks for a long response.
- If the user asks for Mermaid output, return clean Mermaid code in a single \`\`\`mermaid block unless they ask for explanation too.
- Do not invent page structure that is not present in the block map.`;
    }

    function getStoredModelId() {
        try {
            return localStorage.getItem(SHARED_MODEL_STORAGE_KEY) ||
                localStorage.getItem(LEGACY_MODEL_STORAGE_KEY) ||
                'gpt-4o';
        } catch (error) {
            return 'gpt-4o';
        }
    }

    function persistSelectedModel(modelId) {
        try {
            localStorage.setItem(SHARED_MODEL_STORAGE_KEY, modelId);
            localStorage.setItem(LEGACY_MODEL_STORAGE_KEY, modelId);
        } catch (error) {
            console.warn('Failed to persist selected model:', error);
        }
    }
    
    // ============================================
    // State Management
    // ============================================
    const state = {
        selectedModel: getStoredModelId(),
        isActive: false,
        messages: [],
        isProcessing: false,
        streamingEnabled: true,
        cachedModels: null,
        modelsCacheTime: null
    };

    const MODEL_DISPLAY_NAMES = {
        'gpt-4o': 'GPT-4o',
        'gpt-4o-mini': 'GPT-4o Mini',
        'gpt-4-turbo': 'GPT-4 Turbo',
        'gpt-4': 'GPT-4',
        'gpt-3.5-turbo': 'GPT-3.5 Turbo',
        'o1-preview': 'o1 Preview',
        'o1-mini': 'o1 Mini',
        'o3-mini': 'o3 Mini',
        'o4-mini': 'o4 Mini',
        'kimi-k2': 'Kimi K2',
        'kimi-k2-mini': 'Kimi K2 Mini',
        'claude-sonnet-4': 'Claude Sonnet 4',
        'claude-haiku-4': 'Claude Haiku 4',
        'claude-3-opus': 'Claude 3 Opus',
        'claude-3-sonnet': 'Claude 3 Sonnet',
        'claude-3-haiku': 'Claude 3 Haiku',
        'claude-3-5-sonnet': 'Claude 3.5 Sonnet',
        'claude-3.5-sonnet-latest': 'Claude 3.5 Sonnet Latest',
    };

    const MODEL_DESCRIPTIONS = {
        'gpt-4o': 'Most capable multimodal model',
        'gpt-4o-mini': 'Fast and affordable',
        'gpt-4-turbo': 'Advanced reasoning',
        'o1-preview': 'Reasoning-focused model',
        'o1-mini': 'Fast reasoning model',
        'o3-mini': 'Compact reasoning model',
        'o4-mini': 'Fast multimodal reasoning',
        'kimi-k2': 'Advanced reasoning and coding',
        'kimi-k2-mini': 'Quick responses, everyday tasks',
        'claude-sonnet-4': 'Balanced intelligence and speed',
        'claude-haiku-4': 'Fast and lightweight',
        'claude-3-opus': 'Powerful reasoning',
        'claude-3-sonnet': 'Balanced performance',
        'claude-3-haiku': 'Fast and efficient',
        'claude-3-5-sonnet': 'Latest and most capable',
        'claude-3.5-sonnet-latest': 'Latest and most capable',
    };
    
    // ============================================
    // Model Definitions (Fallback when API unavailable)
    // ============================================
    const FALLBACK_MODELS = [
        { 
            id: 'gpt-4o', 
            name: 'GPT-4o', 
            provider: 'openai',
            description: 'Most capable multimodal model'
        },
        { 
            id: 'gpt-4o-mini', 
            name: 'GPT-4o Mini', 
            provider: 'openai',
            description: 'Fast and cost-effective'
        },
        { 
            id: 'kimi-k2', 
            name: 'Kimi K2', 
            provider: 'kimi',
            description: 'Advanced reasoning and coding'
        },
        { 
            id: 'kimi-k2-mini', 
            name: 'Kimi K2 Mini', 
            provider: 'kimi',
            description: 'Quick responses, everyday tasks'
        },
        { 
            id: 'claude-sonnet-4', 
            name: 'Claude Sonnet 4', 
            provider: 'anthropic',
            description: 'Balanced intelligence and speed'
        },
        { 
            id: 'claude-haiku-4', 
            name: 'Claude Haiku 4', 
            provider: 'anthropic',
            description: 'Fast and lightweight'
        }
    ];

    function inferProvider(modelOrId) {
        const provider = String(modelOrId?.provider || modelOrId?.owned_by || '').toLowerCase();
        if (provider === 'openai' || provider === 'anthropic' || provider === 'google' ||
            provider === 'meta' || provider === 'kimi' || provider === 'mistral') {
            return provider;
        }

        const id = String(modelOrId?.id || modelOrId || '').toLowerCase();
        if (id.includes('claude')) return 'anthropic';
        if (id.includes('gpt') || id.includes('o1') || id.includes('o3') || id.includes('o4')) return 'openai';
        if (id.includes('kimi')) return 'kimi';
        if (id.includes('gemini') || id.includes('palm')) return 'google';
        if (id.includes('llama') || id.includes('meta')) return 'meta';
        if (id.includes('mistral')) return 'mistral';
        return 'other';
    }

    function formatModelName(modelId) {
        if (MODEL_DISPLAY_NAMES[modelId]) {
            return MODEL_DISPLAY_NAMES[modelId];
        }

        return modelId
            .split('-')
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    }

    function normalizeModel(model) {
        const id = String(model?.id || '').trim();
        if (!id) return null;

        const provider = inferProvider(model);

        return {
            ...model,
            id,
            provider,
            name: model.name || formatModelName(id),
            description: model.description || MODEL_DESCRIPTIONS[id] || model.owned_by || 'AI model'
        };
    }

    function normalizeModelsResponse(response) {
        const apiClient = getAPIClient();
        const rawModels = Array.isArray(response)
            ? response
            : Array.isArray(response?.data)
                ? response.data
                : [];

        const filteredModels = apiClient?.filterChatModels
            ? apiClient.filterChatModels(rawModels)
            : rawModels;

        const modelsToUse = filteredModels.length > 0 ? filteredModels : rawModels;
        const uniqueModels = new Map();

        modelsToUse.forEach((model) => {
            const normalized = normalizeModel(model);
            if (normalized && !uniqueModels.has(normalized.id)) {
                uniqueModels.set(normalized.id, normalized);
            }
        });

        return Array.from(uniqueModels.values());
    }
    
    // ============================================
    // Response Templates for Stub Mode
    // ============================================
    const RESPONSE_TEMPLATES = {
        greeting: [
            "Hello! I'm ready to help you with your notes. What would you like to do?",
            "Hi there! I can help you write, edit, or analyze your page. What do you need?",
            "Hey! I'm your AI assistant. Ask me anything about your page or how I can help!"
        ],
        question: [
            "Based on your page about **{topic}**, I can see you have {blockCount} blocks of content. {observation}",
            "Looking at your notes on **{topic}**, here's what I found: {observation}",
            "From what I can see in your **{topic}** page: {observation}"
        ],
        edit: [
            "✅ I've updated that block for you. The content has been improved while keeping your original meaning.",
            "✅ Done! I've made the requested changes to your content.",
            "✅ Block updated successfully. Let me know if you'd like any other edits!"
        ],
        insert: [
            "✅ I've added a new **{type}** block after the specified block.",
            "✅ New content added! You can find it in your page.",
            "✅ Inserted successfully. The page has been updated."
        ],
        delete: [
            "✅ Block removed from your page.",
            "✅ I've deleted that block for you.",
            "✅ Done! The block has been removed."
        ],
        summarize: [
            "Here's a summary of your page **{title}**:\n\n{summary}",
            "Summary of **{title}**:\n\n{summary}\n\nKey points have been condensed while keeping the essential information.",
            "📋 Page Summary:\n\n{summary}"
        ],
        improve: [
            "✅ I've improved the writing in that block. The text is now more polished and professional.",
            "✅ Writing enhanced! I've clarified the language and improved the flow.",
            "✅ Improvements made: better grammar, clearer structure, and more engaging language."
        ],
        continue: [
            "I've continued writing based on your content. Here's what I added:\n\n{content}",
            "Building on your existing content, I've added:\n\n{content}",
            "Following your writing style, I continued with:\n\n{content}"
        ],
        outline: [
            "Here's an outline for **{topic}**:\n\n{outline}",
            "📋 Suggested structure for {topic}:\n\n{outline}\n\nWould you like me to expand on any of these sections?",
            "I've created an outline for you:\n\n{outline}"
        ],
        unknown: [
            "I'm not sure I understood that. Could you rephrase or ask something specific about your page?",
            "I can help with writing, editing, summarizing, and more. What would you like to do?",
            "Try asking me to summarize your page, improve a block, or generate an outline!"
        ]
    };
    
    // ============================================
    // Initialization
    // ============================================
    async function init() {
        if (initPromise) {
            return initPromise;
        }

        initPromise = (async () => {
            // Load conversation history from localStorage
            let savedMessages = null;
            try {
                savedMessages = localStorage.getItem('notes_agent_messages');
            } catch (error) {
                console.warn('Failed to read saved messages:', error);
            }

            if (savedMessages) {
                try {
                    state.messages = JSON.parse(savedMessages);
                } catch (error) {
                    console.warn('Failed to load saved messages:', error);
                    state.messages = [];
                }
            }

            // Try to fetch models from API first
            try {
                await refreshModelsFromAPI();
            } catch (error) {
                console.log('Using fallback models');
            }

            // Validate selected model
            const availableModels = state.cachedModels || FALLBACK_MODELS;
            if (!availableModels.find(m => m.id === state.selectedModel)) {
                state.selectedModel = availableModels[0]?.id || 'gpt-4o';
                persistSelectedModel(state.selectedModel);
            }

            console.log('Agent module initialized with model:', state.selectedModel);
        })();

        return initPromise;
    }
    
    // Fetch models from API with caching
    async function refreshModelsFromAPI() {
        const apiClient = getAPIClient();
        if (!apiClient) return false;
        
        // Check cache (cache for 5 minutes)
        const cacheExpiry = 5 * 60 * 1000;
        if (state.cachedModels && state.modelsCacheTime && 
            (Date.now() - state.modelsCacheTime < cacheExpiry)) {
            return true;
        }
        
        try {
            const modelsResponse = await apiClient.getModels();
            const models = normalizeModelsResponse(modelsResponse);
            if (models.length > 0) {
                state.cachedModels = models;
                state.modelsCacheTime = Date.now();
                return true;
            }
        } catch (error) {
            console.warn('Failed to fetch models from API:', error);
        }
        
        return false;
    }
    
    // ============================================
    // Model Management
    // ============================================
    function getModels() {
        // Return cached models from API if available, otherwise fallback
        return state.cachedModels || FALLBACK_MODELS;
    }
    
    async function getModelsAsync() {
        // Try to refresh from API
        await refreshModelsFromAPI();
        return getModels();
    }
    
    function getSelectedModel() {
        return state.selectedModel;
    }
    
    function setSelectedModel(modelId) {
        const availableModels = getModels();
        const model = availableModels.find(m => m.id === modelId);
        if (model) {
            state.selectedModel = modelId;
            persistSelectedModel(modelId);
            return true;
        }
        return false;
    }
    
    function getModelInfo(modelId) {
        const availableModels = getModels();
        return availableModels.find(m => m.id === modelId) || availableModels[0];
    }

    function getModel(modelId) {
        const availableModels = getModels();
        return availableModels.find(m => m.id === modelId) || availableModels[0];
    }

    function getModelsByProvider() {
        const availableModels = getModels();
        const grouped = {};
        availableModels.forEach(model => {
            const provider = model.provider || 'Other';
            if (!grouped[provider]) {
                grouped[provider] = [];
            }
            grouped[provider].push(model);
        });
        return grouped;
    }
    
    // ============================================
    // Page Context Extraction
    // ============================================
    function getPageContext() {
        const page = window.Editor?.getCurrentPage?.();
        if (!page) {
            return null;
        }
        
        // Flatten all blocks recursively
        function flattenBlocks(blocks, depth = 0) {
            const result = [];
            blocks.forEach(block => {
                result.push({
                    id: block.id,
                    type: block.type,
                    content: extractBlockTextValue(block),
                    depth: depth,
                    hasChildren: block.children && block.children.length > 0
                });
                if (block.children && block.children.length > 0) {
                    result.push(...flattenBlocks(block.children, depth + 1));
                }
            });
            return result;
        }
        
        const allBlocks = flattenBlocks(page.blocks || []);
        const outline = allBlocks.filter(b => b.type.startsWith('heading_'));
        const textBlocks = allBlocks.filter(b => {
            const textTypes = ['text', 'heading_1', 'heading_2', 'heading_3', 'quote', 'callout'];
            return textTypes.includes(b.type) && b.content;
        });
        
        // Calculate word count
        const fullText = textBlocks.map(b => b.content).join(' ');
        const wordCount = fullText.split(/\s+/).filter(w => w.length > 0).length;
        
        // Estimate reading time (average 200 words per minute)
        const readingTime = Math.max(1, Math.ceil(wordCount / 200));
        
        return {
            title: page.title || 'Untitled',
            icon: page.icon || '',
            pageId: page.id,
            blocks: allBlocks,
            outline: outline,
            blockCount: allBlocks.length,
            wordCount: wordCount,
            readingTime: readingTime,
            lastUpdated: page.updatedAt,
            defaultModel: page.defaultModel,
            hasCover: !!page.cover,
            properties: page.properties || []
        };
    }
    
    function getFullPageContentLegacy() {
        const context = getPageContext();
        if (!context) return '';
        
        let content = '';
        if (context.icon) content += `${context.icon} `;
        content += `# ${context.title}\n\n`;
        
        context.blocks.forEach(block => {
            const indent = '  '.repeat(block.depth);
            switch (block.type) {
                case 'heading_1':
                    content += `${indent}# ${block.content}\n\n`;
                    break;
                case 'heading_2':
                    content += `${indent}## ${block.content}\n\n`;
                    break;
                case 'heading_3':
                    content += `${indent}### ${block.content}\n\n`;
                    break;
                case 'text':
                    content += `${indent}${block.content}\n\n`;
                    break;
                case 'bulleted_list':
                    content += `${indent}- ${block.content}\n`;
                    break;
                case 'numbered_list':
                    content += `${indent}1. ${block.content}\n`;
                    break;
                case 'todo':
                    content += `${indent}- [ ] ${block.content}\n`;
                    break;
                case 'quote':
                    content += `${indent}> ${block.content}\n\n`;
                    break;
                case 'code':
                    content += `${indent}\`\`\`\n${block.content}\n\`\`\`\n\n`;
                    break;
                case 'divider':
                    content += `${indent}---\n\n`;
                    break;
                case 'callout':
                    content += `${indent}💡 ${block.content}\n\n`;
                    break;
                default:
                    content += `${indent}${block.content}\n\n`;
            }
        });
        
        return content;
    }
    
    function getFullPageContent() {
        const context = getPageContext();
        if (!context) return '';

        let content = '';
        if (context.icon) content += `${context.icon} `;
        content += `# ${context.title}\n\n`;

        context.blocks.forEach((block) => {
            const indent = '  '.repeat(block.depth);
            switch (block.type) {
                case 'heading_1':
                    content += `${indent}# ${block.content}\n\n`;
                    break;
                case 'heading_2':
                    content += `${indent}## ${block.content}\n\n`;
                    break;
                case 'heading_3':
                    content += `${indent}### ${block.content}\n\n`;
                    break;
                case 'text':
                    content += `${indent}${block.content}\n\n`;
                    break;
                case 'bulleted_list':
                    content += `${indent}- ${block.content}\n`;
                    break;
                case 'numbered_list':
                    content += `${indent}1. ${block.content}\n`;
                    break;
                case 'todo':
                    content += `${indent}- [ ] ${block.content}\n`;
                    break;
                case 'quote':
                    content += `${indent}> ${block.content}\n\n`;
                    break;
                case 'code':
                    content += `${indent}\`\`\`\n${block.content}\n\`\`\`\n\n`;
                    break;
                case 'divider':
                    content += `${indent}---\n\n`;
                    break;
                case 'callout':
                    content += `${indent}! ${block.content}\n\n`;
                    break;
                case 'mermaid':
                    content += `${indent}\`\`\`mermaid\n${block.content}\n\`\`\`\n\n`;
                    break;
                case 'ai':
                    content += `${indent}> AI block: ${block.content}\n\n`;
                    break;
                default:
                    content += `${indent}${block.content}\n\n`;
            }
        });

        return content;
    }

    function getOutline() {
        const context = getPageContext();
        if (!context) return [];
        return context.outline;
    }
    
    function getPageMetadata() {
        const context = getPageContext();
        if (!context) return null;
        
        return {
            title: context.title,
            icon: context.icon,
            blockCount: context.blockCount,
            wordCount: context.wordCount,
            readingTime: context.readingTime,
            lastUpdated: context.lastUpdated
        };
    }
    
    // ============================================
    // Chat Interface
    // ============================================
    function addMessage(role, content, metadata = {}) {
        const message = {
            id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            role: role, // 'user' or 'assistant'
            content: content,
            timestamp: Date.now(),
            model: role === 'assistant' ? state.selectedModel : null,
            ...metadata
        };
        
        state.messages.push(message);
        
        // Keep only last 100 messages
        if (state.messages.length > 100) {
            state.messages = state.messages.slice(-100);
        }
        
        // Save to localStorage
        saveMessages();
        
        return message;
    }
    
    function saveMessages() {
        try {
            localStorage.setItem('notes_agent_messages', JSON.stringify(state.messages));
        } catch (e) {
            console.warn('Failed to save messages:', e);
        }
    }
    
    function getMessages() {
        return [...state.messages];
    }
    
    function clearConversation() {
        state.messages = [];
        localStorage.removeItem('notes_agent_messages');
        showToast('Conversation cleared', 'info');
    }
    
    function formatMessageForDisplay(message) {
        // Convert markdown-like syntax to HTML
        let html = escapeHtml(message.content);
        
        // Bold: **text**
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        
        // Italic: *text* or _text_
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
        html = html.replace(/_(.*?)_/g, '<em>$1</em>');
        
        // Code: `text`
        html = html.replace(/`(.*?)`/g, '<code>$1</code>');
        
        // Line breaks
        html = html.replace(/\n/g, '<br>');
        
        return html;
    }
    
    // ============================================
    // AI Response Generation (Stub Mode)
    // ============================================
    function generateStubResponse(userMessage, context) {
        const messageLower = userMessage.toLowerCase();
        const topic = context?.title || 'your notes';
        
        // Detect intent
        if (messageLower.match(/^(hi|hello|hey|greetings)/)) {
            return pickRandom(RESPONSE_TEMPLATES.greeting);
        }
        
        if (messageLower.includes('summarize') || messageLower.includes('summary')) {
            const summary = buildSummaryText(context);
            return formatTemplate(pickRandom(RESPONSE_TEMPLATES.summarize), {
                title: topic,
                summary: summary
            });
        }
        
        if (messageLower.includes('outline') || messageLower.includes('structure')) {
            const match = userMessage.match(/(?:for|about|on)\s+(.+?)(?:\?|$)/i);
            const outlineTopic = match ? match[1] : topic;
            const outline = buildOutlineText(outlineTopic);
            return formatTemplate(pickRandom(RESPONSE_TEMPLATES.outline), {
                topic: outlineTopic,
                outline: outline
            });
        }
        
        if (messageLower.includes('improve') || messageLower.includes('rewrite') || messageLower.includes('enhance')) {
            return pickRandom(RESPONSE_TEMPLATES.improve);
        }
        
        if (messageLower.includes('continue') || messageLower.includes('expand') || messageLower.includes('more')) {
            const continued = buildContinuedText(context);
            return formatTemplate(pickRandom(RESPONSE_TEMPLATES.continue), {
                content: continued
            });
        }
        
        // Default question/observation response
        const observation = generateObservation(context);
        return formatTemplate(pickRandom(RESPONSE_TEMPLATES.question), {
            topic: topic,
            blockCount: context?.blockCount || 0,
            observation: observation
        });
    }
    
    function generateObservation(context) {
        if (!context || !context.blocks || context.blocks.length === 0) {
            return "Your page is currently empty. Would you like me to help you get started?";
        }
        
        const headings = context.blocks.filter(b => b.type.startsWith('heading_'));
        const lists = context.blocks.filter(b => b.type.includes('list') || b.type === 'todo');
        
        let obs = "";
        if (headings.length > 0) {
            obs += `I can see ${headings.length} section${headings.length > 1 ? 's' : ''}`;
            if (context.wordCount > 0) {
                obs += ` with approximately ${context.wordCount} words`;
            }
            obs += ". ";
        }
        
        if (lists.length > 0) {
            obs += `You have ${lists.length} list${lists.length > 1 ? 's' : ''} for organizing items. `;
        }
        
        obs += `This would take about ${context.readingTime} minute${context.readingTime > 1 ? 's' : ''} to read.`;
        
        return obs;
    }
    
    function buildSummaryText(context) {
        if (!context || !context.blocks || context.blocks.length === 0) {
            return "The page is currently empty.";
        }
        
        const headings = context.blocks.filter(b => b.type.startsWith('heading_'));
        const mainPoints = context.blocks
            .filter(b => ['text', 'callout', 'quote'].includes(b.type) && b.content)
            .slice(0, 3)
            .map(b => b.content.substring(0, 100) + (b.content.length > 100 ? '...' : ''));
        
        let summary = "";
        if (headings.length > 0) {
            summary += "**Key Sections:**\n";
            headings.slice(0, 5).forEach(h => {
                summary += `- ${h.content}\n`;
            });
            summary += "\n";
        }
        
        if (mainPoints.length > 0) {
            summary += "**Main Points:**\n";
            mainPoints.forEach((point, i) => {
                summary += `${i + 1}. ${point}\n`;
            });
        }
        
        return summary || "The page contains content ready for review.";
    }
    
    function buildOutlineText(topic) {
        return [
            "1. **Introduction**",
            "   - Overview of " + topic,
            "   - Purpose and goals",
            "",
            "2. **Main Concepts**",
            "   - Key principles",
            "   - Important definitions",
            "   - Core ideas",
            "",
            "3. **Implementation**",
            "   - Step-by-step guide",
            "   - Best practices",
            "   - Common pitfalls",
            "",
            "4. **Examples**",
            "   - Real-world applications",
            "   - Case studies",
            "   - Code samples (if applicable)",
            "",
            "5. **Conclusion**",
            "   - Summary of key points",
            "   - Next steps",
            "   - Additional resources"
        ].join('\n');
    }
    
    function buildContinuedText(context) {
        const lastTextBlock = context?.blocks?.slice().reverse().find(b => 
            b.type === 'text' && b.content
        );
        
        if (!lastTextBlock) {
            return "I can continue writing once you have some text content on the page. Start with a paragraph and I'll help expand on it!";
        }
        
        const topics = [
            "Building on this foundation, it's important to consider the broader implications and how they apply to real-world scenarios.",
            "This leads us to consider additional factors that may influence the outcome. By examining these elements more closely, we can gain deeper insights.",
            "Furthermore, exploring alternative approaches can provide valuable perspectives and enhance our understanding of the subject matter.",
            "The next step involves putting these concepts into practice and observing the results through careful experimentation and analysis."
        ];
        
        return pickRandom(topics) + "\n\nWould you like me to add this to your page?";
    }
    
    // ============================================
    // Core AI Actions
    // ============================================
    async function ask(question, options = {}) {
        const { onChunk, onComplete, onError } = options;
        
        // Validate
        if (!question || typeof question !== 'string') {
            const error = new Error('Question must be a non-empty string');
            if (onError) onError(error);
            throw error;
        }
        
        // Add user message
        addMessage('user', question);
        
        // Set processing state
        state.isProcessing = true;
        
        try {
            const context = getPageContext();
            const apiClient = getAPIClient();
            
            // Check if we can use the real API
            if (apiClient) {
                try {
                    const responseText = await askWithAPI(question, context, { onChunk, onComplete, onError });
                    state.isProcessing = false;
                    return responseText;
                } catch (apiError) {
                    console.warn('API call failed, falling back to stub mode:', apiError.message);
                    // Fall through to stub mode
                }
            }
            
            // Fallback to stub mode (offline/no API client)
            return await askWithStub(question, context, { onChunk, onComplete, onError });
            
        } catch (error) {
            state.isProcessing = false;
            console.error('Agent ask error:', error);
            
            if (onError) {
                onError(error);
            } else {
                showToast('Error: ' + error.message, 'error');
            }
            
            throw error;
        }
    }
    
    // Call the real API with streaming support
    async function askWithAPI(question, context, options) {
        const { onChunk, onComplete, onError } = options;
        const apiClient = getAPIClient();
        
        // Build messages array
        const systemPrompt = buildSystemPrompt(context || {
            title: 'Untitled',
            blockCount: 0,
            wordCount: 0,
            outline: []
        });
        
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: question }
        ];
        
        // Get current model
        const model = state.selectedModel;
        let responseText = '';

        if (state.streamingEnabled && apiClient.streamChat) {
            for await (const chunk of apiClient.streamChat(messages, model)) {
                if (chunk.type === 'delta' && chunk.content) {
                    responseText += chunk.content;
                    if (onChunk) {
                        onChunk(chunk.content, responseText);
                    }
                    continue;
                }

                if (chunk.type === 'error') {
                    throw new Error(chunk.error || 'Streaming error');
                }
            }
        } else {
            const response = await apiClient.chat(messages, model);
            if (response?.error) {
                throw new Error(response.content || 'API request failed');
            }

            responseText = response.content || response.message || String(response);
        }

        const assistantMessage = addMessage('assistant', responseText, {
            model: model,
            tokensUsed: estimateTokens(question + responseText),
            source: 'api'
        });

        state.isProcessing = false;

        if (onComplete) {
            onComplete(responseText, assistantMessage);
        }

        return responseText;
    }
    
    // Stub mode for offline/no API
    async function askWithStub(question, context, options) {
        const { onChunk, onComplete, onError } = options;
        
        // Simulate processing delay
        await delay(500 + Math.random() * 1000);
        
        // Generate response (stub mode)
        const responseText = generateStubResponse(question, context);
        
        // Simulate streaming if enabled
        if (state.streamingEnabled && onChunk) {
            const chunks = simulateStreaming(responseText);
            let fullResponse = '';
            
            for (const chunk of chunks) {
                await delay(30 + Math.random() * 50);
                fullResponse += chunk;
                onChunk(chunk, fullResponse);
            }
        }
        
        // Add assistant message
        const assistantMessage = addMessage('assistant', responseText, {
            model: state.selectedModel,
            tokensUsed: estimateTokens(question + responseText),
            source: 'stub'
        });
        
        state.isProcessing = false;
        
        if (onComplete) {
            onComplete(responseText, assistantMessage);
        }
        
        return responseText;
    }
    
    function simulateStreaming(text) {
        // Split text into chunks (words or small phrases)
        const chunks = [];
        const words = text.split(/(\s+)/);
        
        for (let i = 0; i < words.length; i++) {
            // Group 1-3 words per chunk for natural feeling
            const chunkSize = Math.floor(Math.random() * 3) + 1;
            const chunk = words.slice(i, i + chunkSize).join('');
            if (chunk) chunks.push(chunk);
            i += chunkSize - 1;
        }
        
        return chunks;
    }
    
    // ============================================
    // Block Editing Actions
    // ============================================
    function editBlock(blockId, newContent, options = {}) {
        try {
            const page = window.Editor?.getCurrentPage?.();
            if (!page) {
                throw new Error('No page is currently loaded');
            }
            
            const block = window.Editor?.getBlock?.(blockId);
            if (!block) {
                throw new Error('Block not found: ' + blockId);
            }
            
            // Update the block content
            window.Editor?.updateBlockContent?.(blockId, newContent);
            
            // Save the page
            window.Editor?.savePage?.();
            
            showToast('Block updated', 'success');
            
            // Add system message about the edit
            addMessage('assistant', pickRandom(RESPONSE_TEMPLATES.edit), {
                action: 'edit',
                blockId: blockId
            });
            
            return true;
            
        } catch (error) {
            console.error('Edit block error:', error);
            showToast('Failed to edit block: ' + error.message, 'error');
            throw error;
        }
    }
    
    function insertBlockAfter(blockId, type, content, options = {}) {
        try {
            const newBlock = window.Editor?.insertBlockAfter?.(blockId, type, content);
            
            if (!newBlock) {
                throw new Error('Failed to insert block');
            }
            
            window.Editor?.savePage?.();
            
            const typeName = type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            showToast(`${typeName} block added`, 'success');
            
            // Add system message
            addMessage('assistant', formatTemplate(pickRandom(RESPONSE_TEMPLATES.insert), {
                type: typeName
            }), {
                action: 'insert',
                blockId: newBlock.id,
                blockType: type
            });
            
            return newBlock;
            
        } catch (error) {
            console.error('Insert block error:', error);
            showToast('Failed to insert block: ' + error.message, 'error');
            throw error;
        }
    }
    
    function insertBlockBefore(blockId, type, content, options = {}) {
        try {
            const newBlock = window.Editor?.insertBlockBefore?.(blockId, type, content);
            
            if (!newBlock) {
                throw new Error('Failed to insert block');
            }
            
            window.Editor?.savePage?.();
            
            const typeName = type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            showToast(`${typeName} block added`, 'success');
            
            return newBlock;
            
        } catch (error) {
            console.error('Insert block error:', error);
            showToast('Failed to insert block: ' + error.message, 'error');
            throw error;
        }
    }
    
    function deleteBlock(blockId) {
        try {
            const block = window.Editor?.getBlock?.(blockId);
            if (!block) {
                throw new Error('Block not found: ' + blockId);
            }
            
            window.Editor?.deleteBlock?.(blockId);
            window.Editor?.savePage?.();
            
            showToast('Block deleted', 'success');
            
            // Add system message
            addMessage('assistant', pickRandom(RESPONSE_TEMPLATES.delete), {
                action: 'delete',
                blockId: blockId
            });
            
            return true;
            
        } catch (error) {
            console.error('Delete block error:', error);
            showToast('Failed to delete block: ' + error.message, 'error');
            throw error;
        }
    }
    
    function duplicateBlock(blockId) {
        try {
            window.Editor?.duplicateBlock?.(blockId);
            window.Editor?.savePage?.();
            
            showToast('Block duplicated', 'success');
            
            return true;
            
        } catch (error) {
            console.error('Duplicate block error:', error);
            showToast('Failed to duplicate block: ' + error.message, 'error');
            throw error;
        }
    }
    
    // ============================================
    // AI-Powered Content Actions
    // ============================================
    async function summarize(target = 'page') {
        try {
            const context = getPageContext();
            if (!context) {
                throw new Error('No page is currently loaded');
            }
            
            state.isProcessing = true;
            
            await delay(1000);
            
            const summary = buildSummaryText(context);
            const response = formatTemplate(pickRandom(RESPONSE_TEMPLATES.summarize), {
                title: context.title,
                summary: summary
            });
            
            addMessage('assistant', response, {
                action: 'summarize',
                target: target
            });
            
            state.isProcessing = false;
            
            return summary;
            
        } catch (error) {
            state.isProcessing = false;
            console.error('Summarize error:', error);
            throw error;
        }
    }
    
    async function improveWriting(blockId) {
        try {
            const block = window.Editor?.getBlock?.(blockId);
            if (!block) {
                throw new Error('Block not found');
            }
            
            state.isProcessing = true;
            
            await delay(1500);
            
            // Simulate improved content (in real implementation, would call AI API)
            const originalContent = typeof block.content === 'string' ? block.content : block.content?.text || '';
            const improvedContent = simulateImprovement(originalContent);
            
            // Update the block
            window.Editor?.updateBlockContent?.(blockId, improvedContent);
            window.Editor?.savePage?.();
            
            const response = pickRandom(RESPONSE_TEMPLATES.improve);
            addMessage('assistant', response, {
                action: 'improve',
                blockId: blockId
            });
            
            state.isProcessing = false;
            
            showToast('Writing improved', 'success');
            
            return improvedContent;
            
        } catch (error) {
            state.isProcessing = false;
            console.error('Improve writing error:', error);
            throw error;
        }
    }
    
    function simulateImprovement(text) {
        // Simple simulation of text improvement
        // In a real implementation, this would call an AI API
        const improvements = [
            text.replace(/\bgood\b/gi, 'excellent'),
            text.replace(/\bbad\b/gi, 'challenging'),
            text.replace(/\bvery\b/gi, 'remarkably'),
            text.replace(/\bthing\b/gi, 'aspect'),
        ];
        
        // Add some professional polish
        let improved = improvements[Math.floor(Math.random() * improvements.length)] || text;
        
        // Capitalize first letter of sentences better
        improved = improved.replace(/\.\s+([a-z])/g, (match, letter) => `. ${letter.toUpperCase()}`);
        
        return improved;
    }
    
    async function continueWriting(insertAfterBlockId = null) {
        try {
            const context = getPageContext();
            if (!context) {
                throw new Error('No page is currently loaded');
            }
            
            state.isProcessing = true;
            
            await delay(2000);
            
            const continuedContent = buildContinuedText(context);
            
            // If no specific block ID, add at end
            const targetBlockId = insertAfterBlockId || context.blocks[context.blocks.length - 1]?.id;
            
            if (targetBlockId) {
                const newBlock = window.Editor?.insertBlockAfter?.(targetBlockId, 'text', continuedContent);
                window.Editor?.savePage?.();
                
                if (newBlock) {
                    window.Editor?.focusBlock?.(newBlock.id);
                }
            }
            
            const response = formatTemplate(pickRandom(RESPONSE_TEMPLATES.continue), {
                content: continuedContent.substring(0, 100) + '...'
            });
            
            addMessage('assistant', response, {
                action: 'continue'
            });
            
            state.isProcessing = false;
            
            showToast('Content added', 'success');
            
            return continuedContent;
            
        } catch (error) {
            state.isProcessing = false;
            console.error('Continue writing error:', error);
            throw error;
        }
    }
    
    async function generateOutline(topic) {
        try {
            state.isProcessing = true;
            
            await delay(1500);
            
            const outlineTopic = topic || getPageContext()?.title || 'this topic';
            const outline = buildOutlineText(outlineTopic);
            
            const response = formatTemplate(pickRandom(RESPONSE_TEMPLATES.outline), {
                topic: outlineTopic,
                outline: outline
            });
            
            addMessage('assistant', response, {
                action: 'generateOutline',
                topic: outlineTopic
            });
            
            state.isProcessing = false;
            
            return outline;
            
        } catch (error) {
            state.isProcessing = false;
            console.error('Generate outline error:', error);
            throw error;
        }
    }
    
    // ============================================
    // Utility Functions
    // ============================================
    function pickRandom(array) {
        return array[Math.floor(Math.random() * array.length)];
    }
    
    function formatTemplate(template, values) {
        return template.replace(/\{(\w+)\}/g, (match, key) => {
            return values[key] !== undefined ? values[key] : match;
        });
    }
    
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    function estimateTokens(text) {
        // Rough estimation: ~4 characters per token
        return Math.ceil(text.length / 4);
    }
    
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    function showToast(message, type = 'info') {
        if (window.Sidebar?.showToast) {
            window.Sidebar.showToast(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }
    
    // ============================================
    // Advanced Features
    // ============================================
    function getConversationHistory(limit = 10) {
        return state.messages.slice(-limit);
    }
    
    function exportConversation() {
        const data = {
            exportedAt: new Date().toISOString(),
            model: state.selectedModel,
            messages: state.messages
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `conversation-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast('Conversation exported', 'success');
    }
    
    function setStreamingEnabled(enabled) {
        state.streamingEnabled = enabled;
    }
    
    function isStreamingEnabled() {
        return state.streamingEnabled;
    }
    
    function getStats() {
        return {
            totalMessages: state.messages.length,
            userMessages: state.messages.filter(m => m.role === 'user').length,
            assistantMessages: state.messages.filter(m => m.role === 'assistant').length,
            estimatedTokens: state.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0),
            currentModel: state.selectedModel,
            isProcessing: state.isProcessing
        };
    }
    
    // ============================================
    // Initialize on load
    // ============================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    // ============================================
    // Public API
    // ============================================
    return {
        // Initialization
        init,
        
        // State
        state,
        getStats,
        
        // API Client
        getAPIClient,
        isBackendAvailable,
        
        // Models
        getModels,
        getModelsAsync,
        getSelectedModel,
        setSelectedModel,
        getModelInfo,
        getModel,
        getModelsByProvider,
        
        // Page Context
        getPageContext,
        getFullPageContent,
        getOutline,
        getPageMetadata,
        
        // Chat Interface
        ask,
        getMessages,
        clearConversation,
        formatMessageForDisplay,
        getConversationHistory,
        exportConversation,
        
        // Streaming
        setStreamingEnabled,
        isStreamingEnabled,
        
        // Block Actions
        editBlock,
        insertBlockAfter,
        insertBlockBefore,
        deleteBlock,
        duplicateBlock,
        
        // AI Actions
        summarize,
        improveWriting,
        continueWriting,
        generateOutline,
        
        // Internal utilities (exposed for testing/advanced use)
        _generateStubResponse: generateStubResponse,
        _simulateStreaming: simulateStreaming,
        _buildSystemPrompt: buildSystemPrompt
    };
})();

// Expose to window for global access
window.Agent = Agent;
