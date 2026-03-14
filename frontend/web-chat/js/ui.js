/**
 * UI Helpers for KimiBuilt AI Chat
 * Handles rendering, markdown parsing, code highlighting, and UI utilities
 */

class UIHelpers {
    constructor() {
        this.messageContainer = document.getElementById('messages-container');
        this.sessionsList = document.getElementById('sessions-list');
        this.searchResults = [];
        this.currentSearchIndex = -1;
        this.setupMarked();
        this.setupEventListeners();
        
        // Image generation state
        this.imageGenerationState = {
            quality: 'standard',
            style: 'vivid',
            source: 'generate' // 'generate' or 'unsplash'
        };
        
        // Model selector state
        this.availableModels = [];
        this.availableImageModels = [];
        const savedModel = window.sessionManager?.safeStorageGet?.('kimibuilt_default_model');
        this.currentModel = savedModel || 'gpt-4o';
        this.updateModelUI();
        
        // Track last focused element for focus management
        this.lastFocusedElement = null;
        
        // Command palette navigation state
        this.commandPaletteState = {
            selectedIndex: 0,
            items: []
        };
        
        // Setup draft saving
        this.setupDraftSaving();
        
        // Restore draft on load
        this.restoreDraft();
        
        // Setup code block scroll indicators
        this.setupCodeBlockScrollIndicators();

        if (typeof mermaid !== 'undefined') {
            mermaid.initialize({
                startOnLoad: false,
                securityLevel: 'loose',
                theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'default' : 'dark',
            });
        }
    }

    // ============================================
    // Markdown Setup
    // ============================================

    setupMarked() {
        marked.setOptions({
            breaks: true,
            gfm: true,
            headerIds: false,
            mangle: false,
            sanitize: false // We use DOMPurify instead
        });

        // Custom renderer for code blocks
        const renderer = new marked.Renderer();

        const normalizeMarkedText = (value) => {
            if (typeof value === 'string') return value;
            if (value && typeof value === 'object') {
                if (typeof value.text === 'string') return value.text;
                if (typeof value.raw === 'string') return value.raw;
            }
            return value == null ? '' : String(value);
        };

        const normalizeMarkedLang = (value, fallback = 'text') => {
            if (typeof value === 'string') return value || fallback;
            if (value && typeof value === 'object') {
                if (typeof value.lang === 'string') return value.lang || fallback;
                if (typeof value.language === 'string') return value.language || fallback;
            }
            return fallback;
        };
        
        renderer.code = (code, language) => {
            const normalizedCode = normalizeMarkedText(code);
            const lang = normalizeMarkedLang(language);
            const normalizedLang = lang.toLowerCase();

            if (normalizedLang === 'mermaid') {
                const mermaidSource = this.normalizeMermaidSource(normalizedCode);
                const escapedCode = this.escapeHtml(mermaidSource);
                const escapedAttrCode = this.escapeHtmlAttr(mermaidSource);
                const filenameBase = `diagram-${Date.now()}`;

                return `
                    <div class="code-block mermaid-code-block">
                        <div class="code-header">
                            <span class="code-language">mermaid</span>
                            <div class="code-actions">
                                <button class="code-copy-btn" onclick="uiHelpers.copyCode(this)" data-code="${escapedAttrCode}" aria-label="Copy Mermaid code">
                                    <i data-lucide="copy" class="w-3.5 h-3.5" aria-hidden="true"></i>
                                    <span>Copy</span>
                                </button>
                                <button class="code-copy-btn" onclick="uiHelpers.downloadMermaidSource(this)" data-code="${escapedAttrCode}" data-filename="${filenameBase}.mmd" aria-label="Download Mermaid source">
                                    <i data-lucide="file-code" class="w-3.5 h-3.5" aria-hidden="true"></i>
                                    <span>.mmd</span>
                                </button>
                                <button class="code-copy-btn" onclick="uiHelpers.downloadMermaidPdf(this)" data-code="${escapedAttrCode}" data-filename="${filenameBase}.pdf" aria-label="Download Mermaid PDF">
                                    <i data-lucide="file-text" class="w-3.5 h-3.5" aria-hidden="true"></i>
                                    <span>PDF</span>
                                </button>
                            </div>
                        </div>
                        <pre class="mermaid-source-block"><code class="language-mermaid no-highlight">${escapedCode}</code></pre>
                        <div class="mermaid-visual-wrapper">
                            <div class="mermaid-render-surface" data-mermaid-source="${escapedAttrCode}" data-mermaid-filename="${filenameBase}">
                                <div class="mermaid-placeholder">Rendering diagram...</div>
                            </div>
                        </div>
                    </div>
                `;
            }

            const escapedCode = this.escapeHtml(normalizedCode);
            const prismLang = this.getPrismLanguage(lang);
            const lineCount = normalizedCode.split('\n').length;
            
            // Generate line numbers for code blocks with more than 3 lines
            let lineNumbersHtml = '';
            if (lineCount > 3) {
                lineNumbersHtml = `<div class="line-numbers-rows">${
                    Array(lineCount).fill(0).map((_, i) => `<span></span>`).join('')
                }</div>`;
            }
            
            return `
                <div class="code-block ${lineCount > 3 ? 'line-numbers' : ''}">
                    <div class="code-header">
                        <span class="code-language">${lang}</span>
                        <div class="code-actions">
                            <button class="code-copy-btn" onclick="uiHelpers.copyCode(this)" data-code="${this.escapeHtmlAttr(normalizedCode)}" aria-label="Copy code to clipboard">
                                <i data-lucide="copy" class="w-3.5 h-3.5" aria-hidden="true"></i>
                                <span>Copy</span>
                            </button>
                        </div>
                    </div>
                    ${lineNumbersHtml}
                    <pre class="language-${prismLang}"><code class="language-${prismLang}">${escapedCode}</code></pre>
                </div>
            `;
        };

        renderer.codespan = (code) => {
            return `<code>${this.escapeHtml(normalizeMarkedText(code))}</code>`;
        };

        renderer.link = (href, title, text) => {
            const titleAttr = title ? ` title="${this.escapeHtmlAttr(title)}"` : '';
            return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer nofollow">${text}</a>`;
        };

        renderer.checkbox = (checked) => {
            return `<input type="checkbox" ${checked ? 'checked' : ''} disabled> `;
        };

        marked.use({ renderer });
    }

    getPrismLanguage(lang) {
        const languageMap = {
            'js': 'javascript',
            'ts': 'typescript',
            'py': 'python',
            'sh': 'bash',
            'shell': 'bash',
            'zsh': 'bash',
            'bash': 'bash',
            'yml': 'yaml',
            'yaml': 'yaml',
            'json': 'json',
            'html': 'markup',
            'xml': 'markup',
            'svg': 'markup',
            'jsx': 'jsx',
            'tsx': 'tsx',
            'rs': 'rust',
            'rust': 'rust',
            'go': 'go',
            'golang': 'go',
            'java': 'java',
            'c': 'c',
            'cpp': 'cpp',
            'c++': 'cpp',
            'cs': 'csharp',
            'csharp': 'csharp',
            'rb': 'ruby',
            'ruby': 'ruby',
            'php': 'php',
            'docker': 'docker',
            'dockerfile': 'docker',
            'md': 'markdown',
            'markdown': 'markdown',
            'sql': 'sql',
            'psql': 'sql',
            'mysql': 'sql',
            'postgres': 'sql'
        };
        return languageMap[lang?.toLowerCase()] || lang || 'text';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    escapeHtmlAttr(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    // ============================================
    // Message Rendering
    // ============================================

    renderMessage(message, isStreaming = false) {
        // Handle image messages
        if (message.type === 'image' || message.imageUrl) {
            return this.renderImageMessage(message);
        }
        
        const isUser = message.role === 'user';
        const messageId = message.id || this.generateMessageId();
        
        const messageEl = document.createElement('div');
        messageEl.className = `message ${isUser ? 'user' : 'assistant'}`;
        messageEl.id = messageId;
        messageEl.dataset.messageId = messageId;
        
        // Add ARIA attributes for accessibility
        messageEl.setAttribute('role', 'article');
        messageEl.setAttribute('aria-label', `${isUser ? 'Your message' : 'Assistant response'}`);

        const avatar = isUser ? 
            `<div class="message-avatar user" aria-hidden="true"><i data-lucide="user" class="w-4 h-4"></i></div>` :
            `<div class="message-avatar assistant" aria-hidden="true"><i data-lucide="bot" class="w-4 h-4"></i></div>`;

        const renderedContent = isUser ? 
            message.content :
            (message.displayContent ?? message.content);

        const content = isUser ? 
            this.renderUserMessage(renderedContent) :
            this.renderAssistantMessage(renderedContent, isStreaming);

        const time = this.formatTime(message.timestamp);
        const fullTimestamp = message.timestamp ? new Date(message.timestamp).toLocaleString() : '';

        messageEl.innerHTML = `
            ${!isUser ? avatar : ''}
            <div class="message-content">
                <div class="message-header">
                    <span class="message-author">${isUser ? 'You' : 'Assistant'}</span>
                    <span class="message-time" title="${fullTimestamp}">${time}</span>
                    <div class="message-actions">
                        <button class="message-action-btn" onclick="uiHelpers.copyMessage('${messageId}')" title="Copy message" aria-label="Copy message to clipboard">
                            <i data-lucide="copy" class="w-4 h-4" aria-hidden="true"></i>
                        </button>
                        ${!isUser ? `
                        <button class="message-action-btn" onclick="uiHelpers.regenerateMessage('${messageId}')" title="Regenerate response" aria-label="Regenerate response">
                            <i data-lucide="refresh-cw" class="w-4 h-4" aria-hidden="true"></i>
                        </button>
                        ` : ''}
                    </div>
                </div>
                <div class="message-text ${isUser ? '' : 'markdown-content'}">
                    ${content}
                </div>
            </div>
            ${isUser ? avatar : ''}
        `;

        if (!isUser) {
            this.highlightCodeBlocks(messageEl);
            this.renderMermaidDiagrams(messageEl);
        }

        return messageEl;
    }

    renderUserMessage(content) {
        return this.escapeHtml(content);
    }

    renderAssistantMessage(content, isStreaming = false) {
        if (!content) return '';
        
        // Parse markdown
        let html = marked.parse(content);
        
        // Sanitize HTML with stricter config
        html = DOMPurify.sanitize(html, {
            ALLOWED_TAGS: [
                'p', 'br', 'strong', 'em', 'u', 's', 'del', 'ins',
                'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                'ul', 'ol', 'li',
                'blockquote', 'hr',
                'code', 'pre',
                'a', 'img',
                'table', 'thead', 'tbody', 'tr', 'th', 'td',
                'div', 'span', 'button', 'i',
                'input'
            ],
            ALLOWED_ATTR: [
                'href', 'title', 'target', 'rel', 'src', 'alt', 
                'class', 'data-code', 'onclick', 'type', 'checked', 'disabled',
                'aria-label', 'aria-hidden', 'data-filename', 'data-mermaid-source', 'data-mermaid-filename', 'data-lucide'
            ],
            ALLOW_DATA_ATTR: false
        });

        // Add streaming cursor if needed
        if (isStreaming) {
            html += '<span class="streaming-cursor" aria-hidden="true"></span>';
        }

        return html;
    }

    renderImageMessage(message) {
        const messageId = message.id || this.generateMessageId();
        const time = this.formatTime(message.timestamp);
        const fullTimestamp = message.timestamp ? new Date(message.timestamp).toLocaleString() : '';
        
        const isLoading = message.isLoading;
        const imageUrl = message.imageUrl;
        const revisedPrompt = message.revisedPrompt;
        const prompt = message.prompt;
        const source = message.source || 'generated';
        
        const messageEl = document.createElement('div');
        messageEl.className = 'message assistant';
        messageEl.id = messageId;
        messageEl.dataset.messageId = messageId;
        messageEl.setAttribute('role', 'article');
        messageEl.setAttribute('aria-label', source === 'unsplash' ? 'Unsplash image' : 'Generated image');
        
        // Build attribution for Unsplash images
        let attributionHtml = '';
        if (source === 'unsplash' && message.author) {
            attributionHtml = `
                <div class="image-attribution">
                    Photo by <a href="${message.author.link}?utm_source=kimibuilt&utm_medium=referral" target="_blank" rel="noopener">${this.escapeHtml(message.author.name)}</a> on 
                    <a href="${message.unsplashLink}?utm_source=kimibuilt&utm_medium=referral" target="_blank" rel="noopener">Unsplash</a>
                </div>
            `;
        }
        
        const imageHtml = isLoading ? `
            <div class="image-container loading" aria-busy="true" aria-label="Generating image">
                <div class="image-loading-indicator">
                    <div class="spinner" role="progressbar" aria-valuemin="0" aria-valuemax="100"></div>
                    <span class="text">${message.loadingText || 'Generating image...'}</span>
                </div>
            </div>
        ` : `
            <div class="image-container">
                <img src="${imageUrl}" alt="${this.escapeHtmlAttr(prompt || 'Image')}" 
                     onclick="uiHelpers.openImageLightbox('${imageUrl}')" 
                     onload="uiHelpers.scrollToBottom()"
                     loading="lazy">
            </div>
            ${attributionHtml}
            ${revisedPrompt ? `
                <div class="image-revised-prompt">
                    <div class="label">Revised Prompt</div>
                    <div>${this.escapeHtml(revisedPrompt)}</div>
                </div>
            ` : ''}
            <div class="image-actions">
                <button class="image-action-btn" onclick="uiHelpers.downloadImage('${imageUrl}', '${this.escapeHtmlAttr(prompt || 'image')}.jpg')" aria-label="Download image">
                    <i data-lucide="download" class="w-4 h-4" aria-hidden="true"></i>
                    <span>Download</span>
                </button>
                <button class="image-action-btn" onclick="uiHelpers.copyImageUrl('${imageUrl}')" aria-label="Copy image URL">
                    <i data-lucide="link" class="w-4 h-4" aria-hidden="true"></i>
                    <span>Copy URL</span>
                </button>
                ${source === 'unsplash' ? `
                <button class="image-action-btn" onclick="window.open('${message.unsplashLink}?utm_source=kimibuilt&utm_medium=referral', '_blank')" aria-label="View on Unsplash">
                    <i data-lucide="external-link" class="w-4 h-4" aria-hidden="true"></i>
                    <span>View on Unsplash</span>
                </button>
                ` : ''}
            </div>
        `;
        
        const sourceIcon = source === 'unsplash' ? 'camera' : 'sparkles';
        const sourceText = source === 'unsplash' ? 'Unsplash' : (message.model || 'Generated');
        const sourceLabel = source === 'unsplash' ? 'Stock Photo' : 'Generated Image';
        
        messageEl.innerHTML = `
            <div class="message-avatar assistant" aria-hidden="true">
                <i data-lucide="${source === 'unsplash' ? 'camera' : 'image'}" class="w-4 h-4"></i>
            </div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-author">${source === 'unsplash' ? 'Unsplash' : 'AI Image Generator'}</span>
                    <span class="message-time" title="${fullTimestamp}">${time}</span>
                    <div class="message-actions">
                        ${!isLoading ? `
                        <button class="message-action-btn" onclick="uiHelpers.copyMessage('${messageId}')" title="Copy prompt" aria-label="Copy prompt">
                            <i data-lucide="copy" class="w-4 h-4" aria-hidden="true"></i>
                        </button>
                        ` : ''}
                    </div>
                </div>
                <div class="message-image">
                    <div class="image-generation-info">
                        <div class="icon" aria-hidden="true">
                            <i data-lucide="${sourceIcon}" class="w-3.5 h-3.5"></i>
                        </div>
                        <span class="text">${sourceLabel}</span>
                        <span class="meta">${sourceText}</span>
                    </div>
                    ${prompt ? `<p class="text-sm text-text-secondary mb-3">"${this.escapeHtml(prompt)}"</p>` : ''}
                    ${imageHtml}
                </div>
            </div>
        `;
        
        return messageEl;
    }

    /**
     * Render an Unsplash search results message
     * @param {Object} message - The search message data
     * @returns {HTMLElement} - The rendered message element
     */
    renderUnsplashSearchMessage(message) {
        const messageId = message.id || this.generateMessageId();
        const time = this.formatTime(message.timestamp);
        const fullTimestamp = message.timestamp ? new Date(message.timestamp).toLocaleString() : '';
        
        const isLoading = message.isLoading;
        const query = message.query;
        const results = message.results || [];
        const total = message.total || 0;
        const error = message.error;
        
        const messageEl = document.createElement('div');
        messageEl.className = 'message assistant';
        messageEl.id = messageId;
        messageEl.dataset.messageId = messageId;
        messageEl.setAttribute('role', 'article');
        messageEl.setAttribute('aria-label', 'Unsplash search results');
        
        let contentHtml = '';
        
        if (isLoading) {
            contentHtml = `
                <div class="unsplash-search-loading" aria-busy="true">
                    <div class="spinner" role="progressbar" aria-valuemin="0" aria-valuemax="100"></div>
                    <span class="text">${message.loadingText || 'Searching Unsplash...'}</span>
                </div>
            `;
        } else if (error) {
            contentHtml = `
                <div class="unsplash-search-error">
                    <i data-lucide="alert-circle" class="w-5 h-5" aria-hidden="true"></i>
                    <span>${this.escapeHtml(error)}</span>
                </div>
            `;
        } else if (results.length > 0) {
            contentHtml = `
                <div class="unsplash-search-results">
                    <div class="unsplash-results-header">
                        <span class="unsplash-results-count">${results.length} of ${total} results</span>
                        <span class="unsplash-results-hint">Click an image to add it to the conversation</span>
                    </div>
                    <div class="unsplash-results-grid">
                        ${results.map((image, index) => `
                            <div class="unsplash-result-item" 
                                 onclick="app.selectUnsplashImage('${messageId}', ${JSON.stringify(this.escapeHtmlForJSON(image)).replace(/"/g, '&quot;')})"
                                 role="button"
                                 tabindex="0"
                                 aria-label="Select image by ${image.author ? image.author.name : 'Unknown'}"
                                 title="Photo by ${image.author ? image.author.name : 'Unknown'} - Click to select">
                                <img src="${image.urls.small}" 
                                     alt="${this.escapeHtmlAttr(image.altDescription || image.description || 'Unsplash image')}" 
                                     loading="lazy">
                                <div class="unsplash-result-overlay">
                                    <span class="unsplash-result-author">${image.author ? this.escapeHtml(image.author.name) : 'Unknown'}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } else {
            contentHtml = `
                <div class="unsplash-search-empty">
                    <i data-lucide="search-x" class="w-8 h-8" aria-hidden="true"></i>
                    <p>No images found for "${this.escapeHtml(query)}"</p>
                </div>
            `;
        }
        
        messageEl.innerHTML = `
            <div class="message-avatar assistant" aria-hidden="true">
                <i data-lucide="search" class="w-4 h-4"></i>
            </div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-author">Unsplash Search</span>
                    <span class="message-time" title="${fullTimestamp}">${time}</span>
                </div>
                <div class="message-unsplash-search">
                    <div class="unsplash-search-info">
                        <div class="icon" aria-hidden="true">
                            <i data-lucide="camera" class="w-3.5 h-3.5"></i>
                        </div>
                        <span class="text">Stock Photos</span>
                    </div>
                    ${query ? `<p class="unsplash-search-query">"${this.escapeHtml(query)}"</p>` : ''}
                    ${contentHtml}
                </div>
            </div>
        `;
        
        return messageEl;
    }

    /**
     * Update an Unsplash search message with results or error
     * @param {string} messageId - The message ID to update
     * @param {Object} data - The update data
     */
    updateUnsplashSearchMessage(messageId, data) {
        const messageEl = document.getElementById(messageId);
        if (!messageEl) return false;
        
        // Create new message element with the updated data
        const newMessage = {
            id: messageId,
            role: 'assistant',
            type: 'unsplash-search',
            query: data.query,
            isLoading: false,
            results: data.results,
            total: data.total,
            error: data.error,
            timestamp: new Date().toISOString()
        };
        
        const newEl = this.renderUnsplashSearchMessage(newMessage);
        messageEl.replaceWith(newEl);
        this.reinitializeIcons(newEl);
        this.scrollToBottom();
        
        return true;
    }

    /**
     * Escape HTML for safe use in JSON
     * @param {Object} obj - Object to escape
     * @returns {Object} - Escaped object
     */
    escapeHtmlForJSON(obj) {
        if (typeof obj === 'string') {
            return this.escapeHtml(obj);
        }
        if (Array.isArray(obj)) {
            return obj.map(item => this.escapeHtmlForJSON(item));
        }
        if (obj && typeof obj === 'object') {
            const escaped = {};
            for (const [key, value] of Object.entries(obj)) {
                escaped[key] = this.escapeHtmlForJSON(value);
            }
            return escaped;
        }
        return obj;
    }

    updateImageMessage(messageId, imageData) {
        const messageEl = document.getElementById(messageId);
        if (!messageEl) return false;
        
        // Create new message element with the image data
        const newMessage = {
            id: messageId,
            role: 'assistant',
            type: 'image',
            imageUrl: imageData.url || imageData.b64_json,
            prompt: imageData.prompt,
            revisedPrompt: imageData.revised_prompt,
            model: imageData.model,
            timestamp: new Date().toISOString()
        };
        
        const newEl = this.renderImageMessage(newMessage);
        messageEl.replaceWith(newEl);
        this.reinitializeIcons(newEl);
        this.scrollToBottom();
        
        return true;
    }

    updateMessageContent(messageId, content, isStreaming = false) {
        const messageEl = document.getElementById(messageId);
        if (!messageEl) return false;

        const textEl = messageEl.querySelector('.message-text');
        if (!textEl) return false;

        const isUser = messageEl.classList.contains('user');
        
        if (isUser) {
            textEl.textContent = content;
        } else {
            textEl.innerHTML = this.renderAssistantMessage(content, isStreaming);
            this.highlightCodeBlocks(textEl);
            this.renderMermaidDiagrams(textEl);
            this.reinitializeIcons(textEl);
        }

        return true;
    }

    appendToMessage(messageId, content) {
        const messageEl = document.getElementById(messageId);
        if (!messageEl) return false;

        const textEl = messageEl.querySelector('.message-text');
        if (!textEl) return false;

        // Get current content (excluding cursor)
        let currentHtml = textEl.innerHTML;
        currentHtml = currentHtml.replace(/<span class="streaming-cursor"><\/span>/g, '');

        // Extract text content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = currentHtml;
        let currentText = tempDiv.textContent || '';

        // Append new content
        const newText = currentText + content;
        
        // Re-render as markdown
        textEl.innerHTML = this.renderAssistantMessage(newText, true);
        this.highlightCodeBlocks(textEl);
        this.renderMermaidDiagrams(textEl);
        this.reinitializeIcons(textEl);

        return true;
    }

    async copyMessage(messageId) {
        const messageEl = document.getElementById(messageId);
        if (!messageEl) return;

        const textEl = messageEl.querySelector('.message-text');
        if (!textEl) return;

        const text = textEl.textContent || '';
        
        try {
            await navigator.clipboard.writeText(text.trim());
            this.showToast('Message copied to clipboard', 'success');
        } catch (err) {
            console.error('Failed to copy message:', err);
            this.showToast('Failed to copy message', 'error');
        }
    }

    regenerateMessage(messageId) {
        // Dispatch custom event for the app to handle
        window.dispatchEvent(new CustomEvent('regenerateMessage', { detail: { messageId } }));
    }

    // ============================================
    // Static ID Generator
    // ============================================

    static generateMessageId() {
        return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    generateMessageId() {
        return UIHelpers.generateMessageId();
    }

    // ============================================
    // Image Handling
    // ============================================

    openImageLightbox(imageUrl) {
        const lightbox = document.getElementById('image-lightbox');
        const img = document.getElementById('lightbox-image');
        img.src = imageUrl;
        img.alt = 'Generated image preview';
        lightbox.classList.remove('hidden');
        lightbox.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        
        // Save last focused element
        this.lastFocusedElement = document.activeElement;
        
        // Focus trap for accessibility
        const closeBtn = lightbox.querySelector('.image-lightbox-close');
        if (closeBtn) closeBtn.focus();
    }

    closeImageLightbox() {
        const lightbox = document.getElementById('image-lightbox');
        const img = document.getElementById('lightbox-image');
        lightbox.classList.add('hidden');
        lightbox.setAttribute('aria-hidden', 'true');
        img.src = '';
        img.alt = '';
        document.body.style.overflow = '';
        
        // Return focus to trigger button
        if (this.lastFocusedElement) {
            this.lastFocusedElement.focus();
            this.lastFocusedElement = null;
        }
    }

    downloadLightboxImage() {
        const img = document.getElementById('lightbox-image');
        if (img.src) {
            this.downloadImage(img.src, 'generated-image.png');
        }
    }

    downloadImage(imageUrl, filename) {
        const a = document.createElement('a');
        a.href = imageUrl;
        a.download = filename;
        a.setAttribute('aria-label', `Download ${filename}`);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    async copyImageUrl(imageUrl) {
        try {
            await navigator.clipboard.writeText(imageUrl);
            this.showToast('Image URL copied to clipboard', 'success');
        } catch (err) {
            console.error('Failed to copy image URL:', err);
            this.showToast('Failed to copy image URL', 'error');
        }
    }

    // ============================================
    // Image Generation Modal
    // ============================================

    openImageModal() {
        const modal = document.getElementById('image-modal');
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        
        // Save last focused element
        this.lastFocusedElement = document.activeElement;
        
        // Focus the prompt input
        setTimeout(() => {
            const input = document.getElementById('image-prompt-input');
            if (input) input.focus();
        }, 100);
        
        this.loadImageModels();

        // Setup toggle buttons
        this.setupImageGenerationToggles();
        
        // Trap focus for accessibility
        this.trapFocus(modal);
    }

    getPreferredImageModelId(models = this.availableImageModels) {
        const list = Array.isArray(models) ? models : [];
        return list[0]?.id || '';
    }
    async loadImageModels() {
        try {
            const models = await apiClient.getImageModelsFromAPI();
            this.availableImageModels = Array.isArray(models) ? models : [];

            const modelSelect = document.getElementById('image-model-select');
            if (modelSelect && this.availableImageModels.length > 0) {
                modelSelect.innerHTML = this.availableImageModels
                    .map((model) => `<option value="${model.id}">${model.name || model.id || 'Gateway Default'}</option>` )
                    .join('');

                if (!this.availableImageModels.find((model) => model.id === modelSelect.value)) {
                    modelSelect.value = this.getPreferredImageModelId();
                }

                this.updateImageOptionsForModel(modelSelect.value);
            }
        } catch (error) {
            console.error('Failed to load image models:', error);
            this.availableImageModels = [];
        }
    }
    closeImageModal() {
        const modal = document.getElementById('image-modal');
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
        
        // Return focus to trigger button
        if (this.lastFocusedElement) {
            this.lastFocusedElement.focus();
            this.lastFocusedElement = null;
        }
        
        // Reset form
        const promptInput = document.getElementById('image-prompt-input');
        const modelSelect = document.getElementById('image-model-select');
        const sizeSelect = document.getElementById('image-size-select');
        
        if (promptInput) promptInput.value = '';
        if (modelSelect) modelSelect.value = this.getPreferredImageModelId();
        if (sizeSelect) sizeSelect.value = '1024x1024';
        
        this.imageGenerationState.quality = 'standard';
        this.imageGenerationState.style = 'vivid';
        this.imageGenerationState.source = 'generate';
        this.updateToggleButtons();
        this.setImageSource('generate');
    }

    /**
     * Set the image source (generate or unsplash)
     * @param {string} source - 'generate' or 'unsplash'
     */
    setImageSource(source) {
        this.imageGenerationState.source = source;
        
        // Update button states
        document.querySelectorAll('.image-source-btn').forEach(btn => {
            const isActive = btn.dataset.source === source;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-checked', isActive);
        });
        
        // Show/hide appropriate options
        const aiOptions = document.getElementById('ai-generation-options');
        const unsplashOptions = document.getElementById('unsplash-options');
        const promptLabel = document.getElementById('image-prompt-label');
        const actionText = document.getElementById('image-action-text');
        const actionIcon = document.querySelector('#image-generate-btn i');
        
        if (source === 'generate') {
            aiOptions?.classList.remove('hidden');
            unsplashOptions?.classList.add('hidden');
            if (promptLabel) promptLabel.textContent = 'Describe the image you want to generate...';
            if (actionText) actionText.textContent = 'Generate Image';
            if (actionIcon) actionIcon.setAttribute('data-lucide', 'wand-2');
        } else {
            aiOptions?.classList.add('hidden');
            unsplashOptions?.classList.remove('hidden');
            if (promptLabel) promptLabel.textContent = 'What are you looking for?';
            if (actionText) actionText.textContent = 'Search Unsplash';
            if (actionIcon) actionIcon.setAttribute('data-lucide', 'search');
        }
        
        // Re-initialize icons
        this.reinitializeIcons();
    }

    setupImageGenerationToggles() {
        // Quality toggles
        document.querySelectorAll('.quality-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.imageGenerationState.quality = btn.dataset.quality;
                this.updateToggleButtons();
            });
        });
        
        // Style toggles
        document.querySelectorAll('.style-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.imageGenerationState.style = btn.dataset.style;
                this.updateToggleButtons();
            });
        });
        
        // Model change handler - update available options
        const modelSelect = document.getElementById('image-model-select');
        if (modelSelect) {
            modelSelect.addEventListener('change', (e) => {
                this.updateImageOptionsForModel(e.target.value);
            });
        }
        
        this.updateToggleButtons();
        if (modelSelect) {
            this.updateImageOptionsForModel(modelSelect.value);
        }
    }

    updateToggleButtons() {
        document.querySelectorAll('.quality-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.quality === this.imageGenerationState.quality);
            btn.setAttribute('aria-pressed', btn.dataset.quality === this.imageGenerationState.quality);
        });
        document.querySelectorAll('.style-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.style === this.imageGenerationState.style);
            btn.setAttribute('aria-pressed', btn.dataset.style === this.imageGenerationState.style);
        });
    }

    updateImageOptionsForModel(model) {
        const sizeSelect = document.getElementById('image-size-select');
        const qualityContainer = document.getElementById('image-quality-container');
        const styleContainer = document.getElementById('image-style-container');
        
        if (!sizeSelect) return;

        const selectedModel = this.availableImageModels.find((entry) => entry.id === model) || {};
        const sizes = Array.isArray(selectedModel.sizes) && selectedModel.sizes.length > 0
            ? selectedModel.sizes
            : ['1024x1024'];
        const supportsQuality = Array.isArray(selectedModel.qualities) && selectedModel.qualities.length > 0;
        const supportsStyle = Array.isArray(selectedModel.styles) && selectedModel.styles.length > 0;

        sizeSelect.innerHTML = sizes
            .map((size) => `<option value="${size}">${size}</option>`)
            .join('');

        if (!sizes.includes(sizeSelect.value)) {
            sizeSelect.value = sizes[0];
        }

        if (qualityContainer) qualityContainer.style.display = supportsQuality ? 'block' : 'none';
        if (styleContainer) styleContainer.style.display = supportsStyle ? 'block' : 'none';
    }

    getImageGenerationOptions() {
        const modelSelect = document.getElementById('image-model-select');
        const promptInput = document.getElementById('image-prompt-input');
        const sizeSelect = document.getElementById('image-size-select');
        
        const selectedModel = this.availableImageModels.find((entry) => entry.id === modelSelect?.value)
            || this.availableImageModels.find((entry) => entry.id === this.getPreferredImageModelId())
            || this.availableImageModels[0]
            || {};
        const model = modelSelect?.value || selectedModel.id || '';
        const options = {
            prompt: promptInput?.value?.trim() || '',
            model: model,
            size: sizeSelect?.value || '1024x1024',
            source: this.imageGenerationState.source
        };
        
        if (Array.isArray(selectedModel.qualities) && selectedModel.qualities.includes(this.imageGenerationState.quality)) {
            options.quality = this.imageGenerationState.quality;
        }
        if (Array.isArray(selectedModel.styles) && selectedModel.styles.includes(this.imageGenerationState.style)) {
            options.style = this.imageGenerationState.style;
        }
        
        return options;
    }

    /**
     * Get the current image source
     * @returns {string} - 'generate' or 'unsplash'
     */
    getImageSource() {
        return this.imageGenerationState.source;
    }

    setImageGenerateButtonState(isGenerating) {
        const btn = document.getElementById('image-generate-btn');
        if (!btn) return;
        
        if (isGenerating) {
            btn.disabled = true;
            btn.classList.add('generating');
            btn.setAttribute('aria-busy', 'true');
            btn.innerHTML = `
                <div class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true"></div>
                <span>Generating...</span>
            `;
        } else {
            btn.disabled = false;
            btn.classList.remove('generating');
            btn.setAttribute('aria-busy', 'false');
            btn.innerHTML = `
                <i data-lucide="wand-2" class="w-5 h-5" aria-hidden="true"></i>
                <span>Generate Image</span>
            `;
            this.reinitializeIcons(btn);
        }
    }

    // ============================================
    // Model Selector
    // ============================================

    async loadModels() {
        const modelBtn = document.getElementById('model-selector-btn');
        
        try {
            // Add loading state
            if (modelBtn) modelBtn.classList.add('loading');
            
            const response = await apiClient.getModels();
            this.availableModels = response.data || [];
            
            // Remove loading state
            if (modelBtn) modelBtn.classList.remove('loading');
            
            return this.availableModels;
        } catch (error) {
            console.error('Failed to load models:', error);
            
            // Remove loading state
            if (modelBtn) modelBtn.classList.remove('loading');
            
            return [];
        }
    }

    toggleModelSelector() {
        const dropdown = document.getElementById('model-selector-dropdown');
        if (dropdown.classList.contains('hidden')) {
            this.openModelSelector();
        } else {
            this.closeModelSelector();
        }
    }
    
    updateModelSelectorAria(expanded) {
        const btn = document.getElementById('model-selector-btn');
        if (btn) {
            btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        }
    }

    async openModelSelector() {
        const dropdown = document.getElementById('model-selector-dropdown');
        dropdown.classList.remove('hidden');
        dropdown.setAttribute('aria-hidden', 'false');
        
        // Update ARIA
        this.updateModelSelectorAria(true);
        
        // Save last focused element
        this.lastFocusedElement = document.activeElement;
        
        // Load models if not already loaded
        if (this.availableModels.length === 0) {
            await this.loadModels();
        }
        
        this.renderModelList();
        
        // Trap focus
        this.trapFocus(dropdown);
    }

    closeModelSelector() {
        const dropdown = document.getElementById('model-selector-dropdown');
        dropdown.classList.add('hidden');
        dropdown.setAttribute('aria-hidden', 'true');
        
        // Update ARIA
        this.updateModelSelectorAria(false);
        
        // Return focus to trigger button
        if (this.lastFocusedElement) {
            this.lastFocusedElement.focus();
            this.lastFocusedElement = null;
        }
    }

    renderModelList() {
        const listContainer = document.getElementById('model-list');
        
        if (this.availableModels.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state py-4">
                    <p class="text-sm text-text-secondary">No models available</p>
                </div>
            `;
            return;
        }
        
        // Group models by provider
        const grouped = this.groupModelsByProvider(this.availableModels);
        
        listContainer.innerHTML = Object.entries(grouped).map(([provider, models]) => `
            <div class="model-group">
                <div class="model-group-title">${provider}</div>
                ${models.map(model => this.renderModelItem(model)).join('')}
            </div>
        `).join('');
        
        // Attach click handlers
        listContainer.querySelectorAll('.model-item').forEach(item => {
            item.addEventListener('click', () => {
                const modelId = item.dataset.modelId;
                this.selectModel(modelId);
            });
        });
        
        this.reinitializeIcons(listContainer);
    }

    renderModelItem(model) {
        const isActive = model.id === this.currentModel;
        const provider = this.getModelProvider(model);
        const displayName = this.getModelDisplayName(model);
        const description = this.getModelDescription(model);
        
        return `
            <div class="model-item ${isActive ? 'active' : ''}" data-model-id="${model.id}" role="option" aria-selected="${isActive}">
                <div class="model-item-icon ${provider}">
                    <i data-lucide="cpu" class="w-4 h-4" aria-hidden="true"></i>
                </div>
                <div class="model-item-info">
                    <div class="model-item-name">${displayName}</div>
                    <div class="model-item-desc">${description}</div>
                </div>
                <div class="model-item-check" aria-hidden="true">
                    <i data-lucide="check" class="w-4 h-4"></i>
                </div>
            </div>
        `;
    }

    groupModelsByProvider(models) {
        const grouped = {};
        
        models.forEach(model => {
            const provider = this.getModelProviderName(model);
            if (!grouped[provider]) {
                grouped[provider] = [];
            }
            grouped[provider].push(model);
        });
        
        return grouped;
    }

    getModelProvider(model) {
        const id = model.id.toLowerCase();
        if (id.includes('claude')) return 'anthropic';
        if (id.includes('gpt') || id.includes('dall')) return 'openai';
        if (id.includes('gemini') || id.includes('palm')) return 'google';
        if (id.includes('llama') || id.includes('meta')) return 'meta';
        return '';
    }

    getModelProviderName(model) {
        const provider = this.getModelProvider(model);
        const names = {
            'anthropic': 'Anthropic',
            'openai': 'OpenAI',
            'google': 'Google',
            'meta': 'Meta'
        };
        return names[provider] || 'Other';
    }

    getModelDisplayName(model) {
        // Convert model ID to readable name
        const id = model.id;
        const names = {
            'gpt-4o': 'GPT-4o',
            'gpt-4o-mini': 'GPT-4o Mini',
            'gpt-4-turbo': 'GPT-4 Turbo',
            'gpt-4': 'GPT-4',
            'gpt-3.5-turbo': 'GPT-3.5 Turbo',
            'claude-3-opus': 'Claude 3 Opus',
            'claude-3-sonnet': 'Claude 3 Sonnet',
            'claude-3-haiku': 'Claude 3 Haiku',
            'claude-3-5-sonnet': 'Claude 3.5 Sonnet',
            'claude-3.5-sonnet-latest': 'Claude 3.5 Sonnet Latest'
        };
        return names[id] || id;
    }

    getModelDescription(model) {
        const descriptions = {
            'gpt-4o': 'Most capable multimodal model',
            'gpt-4o-mini': 'Fast and affordable',
            'gpt-4-turbo': 'Advanced reasoning',
            'claude-3-opus': 'Powerful reasoning',
            'claude-3-sonnet': 'Balanced performance',
            'claude-3-haiku': 'Fast and efficient',
            'claude-3-5-sonnet': 'Latest and most capable'
        };
        return descriptions[model.id] || model.owned_by || 'AI Model';
    }

    selectModel(modelId) {
        this.currentModel = modelId;
        window.sessionManager?.safeStorageSet?.('kimibuilt_default_model', modelId);
        this.updateModelUI();
        this.closeModelSelector();
        this.showToast(`Model changed to ${this.getModelDisplayName({ id: modelId })}`, 'success');
        
        // Dispatch event for app to know model changed
        window.dispatchEvent(new CustomEvent('modelChanged', { detail: { modelId } }));
    }

    updateModelUI() {
        const label = document.getElementById('current-model-label');
        const inputLabel = document.getElementById('input-model-label');
        const displayName = this.getModelDisplayName({ id: this.currentModel });
        
        if (label) label.textContent = displayName;
        if (inputLabel) inputLabel.textContent = displayName;
    }

    getCurrentModel() {
        return this.currentModel;
    }

    setCurrentModel(modelId) {
        this.currentModel = modelId;
        window.sessionManager?.safeStorageSet?.('kimibuilt_default_model', modelId);
        this.updateModelUI();
    }

    // ============================================
    // Code Highlighting
    // ============================================

    highlightCodeBlocks(container) {
        const codeBlocks = container.querySelectorAll('pre code');
        codeBlocks.forEach(block => {
            if (block.classList.contains('language-mermaid') || block.classList.contains('no-highlight')) {
                return;
            }
            if (window.Prism) {
                try {
                    Prism.highlightElement(block);
                } catch (err) {
                    // Silently skip highlighting for problematic languages
                    console.warn('[UI] Syntax highlighting failed:', err.message);
                }
            }
        });
    }

    async copyCode(button) {
        const code = button.dataset.code;
        
        try {
            await navigator.clipboard.writeText(code);
            
            // Show copied state
            const originalHTML = button.innerHTML;
            button.classList.add('copied');
            button.innerHTML = `
                <i data-lucide="check" class="w-3.5 h-3.5" aria-hidden="true"></i>
                <span>Copied!</span>
            `;
            this.reinitializeIcons(button);
            
            // Revert after 2 seconds
            setTimeout(() => {
                button.classList.remove('copied');
                button.innerHTML = originalHTML;
                this.reinitializeIcons(button);
            }, 2000);
            
        } catch (err) {
            console.error('Failed to copy code:', err);
            this.showToast('Failed to copy code', 'error');
        }
    }

    normalizeMermaidSource(text = '') {
        let source = String(text || '')
            .replace(/\r\n?/g, '\n')
            .trim();

        if (!source) {
            return '';
        }

        source = source.replace(/^```mermaid\s*/i, '');
        source = source.replace(/^```\s*/i, '');
        source = source.replace(/```\s*$/i, '');

        const whitespaceSensitive = /^mindmap\b/i.test(source);

        if (!source.includes('\n') && !whitespaceSensitive && /\s{2,}/.test(source)) {
            source = source
                .split(/\s{2,}/)
                .map((line) => line.trim())
                .filter(Boolean)
                .join('\n');
        }

        source = source
            .replace(/^(flowchart|graph)\s+([A-Za-z]{2})\s+(?=\S)/i, '$1 $2\n')
            .replace(/^(sequenceDiagram|classDiagram|erDiagram|stateDiagram(?:-v2)?|gitGraph|journey|timeline)\s+(?=\S)/i, '$1\n');

        if (!whitespaceSensitive) {
            source = source.replace(
                /\s+(?=(?:style|classDef|class|linkStyle|click|subgraph|end|section|participant|actor|note|title|accTitle|accDescr)\b)/g,
                '\n',
            );
        }

        return source
            .split('\n')
            .flatMap((line) => (
                !whitespaceSensitive && /\s{2,}/.test(line) && !/^\s/.test(line)
                    ? line.split(/\s{2,}/)
                    : [line]
            ))
            .map((line) => line.trimEnd())
            .filter((line, index, lines) => line.trim() || (index > 0 && lines[index - 1].trim()))
            .join('\n')
            .trim();
    }

    getMermaidFilename(baseName = 'diagram', extension = 'mmd') {
        const safeBase = String(baseName || 'diagram').replace(/\.[a-z0-9]+$/i, '');
        return `${safeBase}.${extension}`;
    }

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    async persistGeneratedFile(blob, filename, mimeType = '') {
        if (!window.artifactManager?.persistGeneratedFile) {
            return;
        }

        try {
            await window.artifactManager.persistGeneratedFile(blob, filename, mimeType || blob.type || 'application/octet-stream');
        } catch (error) {
            console.warn('[UI] Failed to persist generated Mermaid file:', error);
        }
    }

    getMermaidSourceFromButton(button) {
        return this.normalizeMermaidSource(button?.dataset?.code || '');
    }

    async downloadMermaidSource(button) {
        const source = this.getMermaidSourceFromButton(button);
        if (!source) {
            this.showToast('No Mermaid source to download', 'error');
            return;
        }

        const filename = this.getMermaidFilename(button?.dataset?.filename || 'diagram', 'mmd');
        const blob = new Blob([source], { type: 'text/plain;charset=utf-8' });
        this.downloadBlob(blob, filename);
        await this.persistGeneratedFile(blob, filename, 'text/plain');
    }

    async svgMarkupToImage(svgMarkup) {
        const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
        const svgUrl = URL.createObjectURL(svgBlob);

        try {
            const image = await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('Failed to load Mermaid SVG'));
                img.src = svgUrl;
            });
            return image;
        } finally {
            URL.revokeObjectURL(svgUrl);
        }
    }

    async createMermaidPdfBlobFromSource(source, title = 'diagram') {
        if (!window.PDFLib?.PDFDocument) {
            throw new Error('PDF library is not available');
        }
        if (typeof mermaid === 'undefined') {
            throw new Error('Mermaid is not available');
        }

        const renderId = `mermaid-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const result = await mermaid.render(renderId, source);
        const image = await this.svgMarkupToImage(result.svg);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(image.naturalWidth || image.width || 1200));
        canvas.height = Math.max(1, Math.ceil(image.naturalHeight || image.height || 800));

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        const pngDataUrl = canvas.toDataURL('image/png');
        const pngBytes = await fetch(pngDataUrl).then((response) => response.arrayBuffer());

        const pdfDoc = await window.PDFLib.PDFDocument.create();
        const pngImage = await pdfDoc.embedPng(pngBytes);

        const margin = 36;
        const pageWidth = Math.max(612, canvas.width + margin * 2);
        const pageHeight = Math.max(792, canvas.height + margin * 2);
        const page = pdfDoc.addPage([pageWidth, pageHeight]);
        const scale = Math.min(
            (pageWidth - margin * 2) / pngImage.width,
            (pageHeight - margin * 2) / pngImage.height,
            1,
        );
        const drawWidth = pngImage.width * scale;
        const drawHeight = pngImage.height * scale;

        page.drawImage(pngImage, {
            x: (pageWidth - drawWidth) / 2,
            y: (pageHeight - drawHeight) / 2,
            width: drawWidth,
            height: drawHeight,
        });

        const pdfBytes = await pdfDoc.save({
            updateFieldAppearances: false,
            useObjectStreams: false,
        });

        return new Blob([pdfBytes], { type: 'application/pdf' });
    }

    async downloadMermaidPdf(button) {
        const source = this.getMermaidSourceFromButton(button);
        if (!source) {
            this.showToast('No Mermaid source to export', 'error');
            return;
        }

        const filename = this.getMermaidFilename(button?.dataset?.filename || 'diagram', 'pdf');

        try {
            const pdfBlob = await this.createMermaidPdfBlobFromSource(source, filename.replace(/\.pdf$/i, ''));
            this.downloadBlob(pdfBlob, filename);
            await this.persistGeneratedFile(pdfBlob, filename, 'application/pdf');
            this.showToast('Mermaid PDF ready', 'success');
        } catch (error) {
            console.error('[UI] Mermaid PDF export failed:', error);
            this.showToast(`Failed to export Mermaid PDF: ${error.message}`, 'error');
        }
    }

    async renderMermaidDiagrams(container = document) {
        if (typeof mermaid === 'undefined') {
            return;
        }

        const targets = Array.from(container.querySelectorAll('.mermaid-render-surface'));
        for (const target of targets) {
            const source = this.normalizeMermaidSource(target.dataset.mermaidSource || '');
            if (!source || target.dataset.mermaidRenderedSource === source) {
                continue;
            }

            const renderId = `mermaid-inline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

            try {
                const result = await mermaid.render(renderId, source);
                target.innerHTML = result.svg;
                target.dataset.mermaidRenderedSource = source;
                if (typeof result.bindFunctions === 'function') {
                    result.bindFunctions(target);
                }
            } catch (error) {
                target.innerHTML = `
                    <div class="mermaid-render-error">Mermaid render failed: ${this.escapeHtml(error.message)}</div>
                    <pre class="mermaid-source-block"><code>${this.escapeHtml(source)}</code></pre>
                `;
                delete target.dataset.mermaidRenderedSource;
            }
        }
    }

    // ============================================
    // Session List Rendering
    // ============================================

    renderSessionsList(sessions, currentSessionId) {
        if (sessions.length === 0) {
            this.sessionsList.innerHTML = `
                <div class="empty-state py-8">
                    <i data-lucide="message-square" class="w-12 h-12 mb-3 text-text-muted" aria-hidden="true"></i>
                    <p class="text-sm text-text-secondary">No conversations yet</p>
                    <p class="text-xs text-text-muted mt-1">Start a new chat to begin</p>
                </div>
            `;
            this.reinitializeIcons(this.sessionsList);
            return;
        }

        this.sessionsList.innerHTML = sessions.map(session => {
            const isActive = session.id === currentSessionId;
            const modeIcon = sessionManager.getSessionModeIcon(session.mode);
            const modeClass = session.mode || 'chat';
            const timeAgo = sessionManager.formatTimestamp(session.updatedAt);
            const messageCount = sessionManager.getMessages(session.id)?.length || 0;
            
            return `
                <div class="session-item ${isActive ? 'active' : ''}" data-session-id="${session.id}" role="button" tabindex="0" aria-label="${this.escapeHtmlAttr(session.title || 'New Chat')}" title="${this.escapeHtmlAttr(session.title || 'New Chat')}">
                    <div class="session-icon ${modeClass}" aria-hidden="true">
                        <i data-lucide="${modeIcon}" class="w-4 h-4 text-white"></i>
                    </div>
                    <div class="session-info sidebar-session-info">
                        <div class="session-title">${this.escapeHtml(session.title || 'New Chat')}</div>
                        <div class="session-meta">
                            ${timeAgo} | ${messageCount} message${messageCount !== 1 ? 's' : ''}
                        </div>
                    </div>
                    <div class="session-actions">
                        <button class="btn-icon danger p-1.5 rounded delete-session-btn" data-session-id="${session.id}" title="Delete conversation" aria-label="Delete conversation">
                            <i data-lucide="trash-2" class="w-4 h-4" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        this.reinitializeIcons(this.sessionsList);
        this.attachSessionListeners();
    }

    attachSessionListeners() {
        // Session item clicks (for switching)
        this.sessionsList.querySelectorAll('.session-item').forEach(item => {
            const clickHandler = (e) => {
                // Don't switch if clicking delete button
                if (e.target.closest('.delete-session-btn')) return;
                
                const sessionId = item.dataset.sessionId;
                sessionManager.switchSession(sessionId);
            };
            
            item.addEventListener('click', clickHandler);
            
            // Keyboard support
            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    clickHandler(e);
                }
            });
        });

        // Delete buttons
        this.sessionsList.querySelectorAll('.delete-session-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sessionId = btn.dataset.sessionId;
                this.confirmDeleteSession(sessionId);
            });
        });
    }

    confirmDeleteSession(sessionId) {
        const session = sessionManager.sessions.find(s => s.id === sessionId);
        const title = session?.title || 'this conversation';
        
        if (confirm(`Delete "${title}"?\n\nThis action cannot be undone.`)) {
            sessionManager.deleteSession(sessionId);
            this.showToast('Conversation deleted', 'success');
        }
    }

    // ============================================
    // Connection Status
    // ============================================

    updateConnectionStatus(status) {
        const statusEl = document.getElementById('connection-status');
        const dotEl = document.getElementById('status-dot');
        const textEl = document.getElementById('status-text');

        if (!statusEl || !dotEl || !textEl) return;

        // Remove all status classes
        statusEl.classList.remove('connected', 'connecting', 'disconnected');
        dotEl.classList.remove('connected', 'connecting', 'disconnected');

        switch (status) {
            case 'connected':
                statusEl.classList.add('connected');
                dotEl.classList.add('connected');
                textEl.textContent = 'Connected';
                break;
            case 'connecting':
                statusEl.classList.add('connecting');
                dotEl.classList.add('connecting');
                textEl.textContent = 'Connecting...';
                break;
            case 'disconnected':
            default:
                statusEl.classList.add('disconnected');
                dotEl.classList.add('disconnected');
                textEl.textContent = 'Disconnected';
                break;
        }
    }

    // ============================================
    // Theme Management
    // ============================================

    initTheme() {
        // Check for saved theme or system preference
        const savedTheme = window.sessionManager?.safeStorageGet?.('kimibuilt_theme');
        
        const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        const theme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
        this.setTheme(theme);
        
        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            const hasSavedTheme = window.sessionManager?.safeStorageGet?.('kimibuilt_theme');
            if (!hasSavedTheme) {
                this.setTheme(e.matches ? 'dark' : 'light');
            }
        });
    }

    setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        window.sessionManager?.safeStorageSet?.('kimibuilt_theme', theme);

        // Update theme toggle UI
        const lightIcon = document.getElementById('theme-icon-light');
        const darkIcon = document.getElementById('theme-icon-dark');
        const themeText = document.getElementById('theme-text');
        const prismTheme = document.getElementById('prism-theme');

        if (theme === 'light') {
            lightIcon?.classList.remove('hidden');
            darkIcon?.classList.add('hidden');
            if (themeText) themeText.textContent = 'Light Mode';
            if (prismTheme) prismTheme.setAttribute('href', 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism.min.css');
        } else {
            lightIcon?.classList.add('hidden');
            darkIcon?.classList.remove('hidden');
            if (themeText) themeText.textContent = 'Dark Mode';
            if (prismTheme) prismTheme.setAttribute('href', 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css');
        }
    }

    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        this.setTheme(newTheme);
    }

    // ============================================
    // Input Handling
    // ============================================

    initAutoResize(textarea) {
        const resize = () => {
            textarea.style.height = 'auto';
            const newHeight = Math.min(textarea.scrollHeight, 192);
            textarea.style.height = newHeight + 'px';
        };

        textarea.addEventListener('input', resize);
        
        // Initial resize
        resize();

        return {
            resize,
            reset: () => {
                textarea.style.height = 'auto';
            }
        };
    }

    updateCharCounter(textarea, counter) {
        const maxLength = 4000;
        const length = textarea.value.length;
        counter.textContent = `${length}/${maxLength}`;
        
        if (length > 0) {
            counter.classList.remove('hidden');
        } else {
            counter.classList.add('hidden');
        }

        if (length > maxLength * 0.9) {
            counter.classList.add('text-red-500');
            counter.classList.remove('text-text-secondary');
        } else {
            counter.classList.remove('text-red-500');
            counter.classList.add('text-text-secondary');
        }
    }

    // ============================================
    // Search Functionality
    // ============================================

    openSearch() {
        const searchBar = document.getElementById('search-bar');
        const searchInput = document.getElementById('search-input');
        searchBar.classList.remove('hidden');
        searchInput.focus();
        this.closeSidebar();
    }

    closeSearch() {
        const searchBar = document.getElementById('search-bar');
        const searchInput = document.getElementById('search-input');
        searchBar.classList.add('hidden');
        searchInput.value = '';
        this.clearSearchHighlights();
        this.searchResults = [];
        this.currentSearchIndex = -1;
    }

    performSearch(query) {
        this.clearSearchHighlights();
        
        if (!query.trim()) {
            this.searchResults = [];
            this.currentSearchIndex = -1;
            this.updateSearchCount();
            return;
        }

        const messages = this.messageContainer.querySelectorAll('.message');
        this.searchResults = [];
        
        messages.forEach((message, messageIndex) => {
            const textEl = message.querySelector('.message-text, .message-image');
            if (!textEl) return;

            const text = textEl.textContent || '';
            const regex = new RegExp(`(${this.escapeRegex(query)})`, 'gi');
            
            if (regex.test(text)) {
                this.searchResults.push({ message, messageIndex, textEl });
                
                // Highlight matches
                this.highlightText(textEl, query);
            }
        });

        this.currentSearchIndex = this.searchResults.length > 0 ? 0 : -1;
        this.updateSearchCount();
        this.navigateToCurrentResult();
    }

    highlightText(element, query) {
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            if (node.parentElement.tagName !== 'CODE' && 
                node.parentElement.tagName !== 'PRE') {
                textNodes.push(node);
            }
        }

        const regex = new RegExp(`(${this.escapeRegex(query)})`, 'gi');
        
        textNodes.forEach(textNode => {
            const text = textNode.textContent;
            if (regex.test(text)) {
                const span = document.createElement('span');
                span.innerHTML = text.replace(regex, '<mark class="search-highlight">$1</mark>');
                textNode.parentNode.replaceChild(span, textNode);
            }
        });
    }

    clearSearchHighlights() {
        const marks = this.messageContainer.querySelectorAll('mark.search-highlight');
        marks.forEach(mark => {
            const parent = mark.parentNode;
            parent.replaceChild(document.createTextNode(mark.textContent), mark);
            parent.normalize();
        });
    }

    navigateSearch(direction) {
        if (this.searchResults.length === 0) return;
        
        this.currentSearchIndex += direction;
        
        if (this.currentSearchIndex < 0) {
            this.currentSearchIndex = this.searchResults.length - 1;
        } else if (this.currentSearchIndex >= this.searchResults.length) {
            this.currentSearchIndex = 0;
        }
        
        this.updateSearchCount();
        this.navigateToCurrentResult();
    }

    navigateToCurrentResult() {
        if (this.currentSearchIndex < 0 || this.searchResults.length === 0) return;
        
        // Remove current highlight from all
        this.messageContainer.querySelectorAll('.search-highlight.current').forEach(el => {
            el.classList.remove('current');
        });
        
        const result = this.searchResults[this.currentSearchIndex];
        if (result) {
            result.message.scrollIntoView({ behavior: 'smooth', block: 'center' });
            result.message.classList.add('highlighted');
            
            // Highlight current match
            const marks = result.textEl.querySelectorAll('mark.search-highlight');
            if (marks.length > 0) {
                marks[0].classList.add('current');
            }
            
            setTimeout(() => {
                result.message.classList.remove('highlighted');
            }, 2000);
        }
    }

    updateSearchCount() {
        const countEl = document.getElementById('search-count');
        if (this.searchResults.length === 0) {
            countEl.textContent = '';
        } else {
            countEl.textContent = `${this.currentSearchIndex + 1} / ${this.searchResults.length}`;
        }
    }

    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ============================================
    // Command Palette
    // ============================================

    openCommandPalette() {
        const palette = document.getElementById('command-palette');
        const input = document.getElementById('command-input');
        palette.classList.remove('hidden');
        palette.setAttribute('aria-hidden', 'false');
        input.value = '';
        input.focus();
        this.renderCommandResults('');
        
        // Save last focused element
        this.lastFocusedElement = document.activeElement;
        
        // Trap focus
        this.trapFocus(palette);
    }

    closeCommandPalette() {
        const palette = document.getElementById('command-palette');
        palette.classList.add('hidden');
        palette.setAttribute('aria-hidden', 'true');
        
        // Return focus to trigger button
        if (this.lastFocusedElement) {
            this.lastFocusedElement.focus();
            this.lastFocusedElement = null;
        }
    }

    renderCommandResults(query) {
        const resultsContainer = document.getElementById('command-results');
        const commands = this.getAvailableCommands();
        
        // Handle slash commands
        if (query.startsWith('/')) {
            this.handleSlashCommand(query);
            return;
        }
        
        let filteredCommands = commands;
        if (query.trim()) {
            const lowerQuery = query.toLowerCase();
            filteredCommands = commands.filter(cmd => 
                cmd.title.toLowerCase().includes(lowerQuery) ||
                cmd.description.toLowerCase().includes(lowerQuery)
            );
        }

        if (filteredCommands.length === 0) {
            resultsContainer.innerHTML = `
                <div class="empty-state py-8">
                    <p class="text-sm text-text-secondary">No commands found</p>
                </div>
            `;
            return;
        }

        // Group commands by category
        const grouped = filteredCommands.reduce((acc, cmd) => {
            acc[cmd.category] = acc[cmd.category] || [];
            acc[cmd.category].push(cmd);
            return acc;
        }, {});

        resultsContainer.innerHTML = Object.entries(grouped).map(([category, cmds]) => `
            <div class="command-group">
                <div class="command-group-title">${category}</div>
                ${cmds.map((cmd, index) => `
                    <div class="command-item ${index === 0 ? 'selected' : ''}" data-action="${cmd.action}" role="option" tabindex="0">
                        <div class="command-item-icon">
                            <i data-lucide="${cmd.icon}" class="w-4 h-4" aria-hidden="true"></i>
                        </div>
                        <div class="command-item-content">
                            <div class="command-item-title">${cmd.title}</div>
                            <div class="command-item-desc">${cmd.description}</div>
                        </div>
                        ${cmd.shortcut ? `<span class="command-item-shortcut">${cmd.shortcut}</span>` : ''}
                    </div>
                `).join('')}
            </div>
        `).join('');

        this.reinitializeIcons(resultsContainer);
        
        // Attach click handlers
        resultsContainer.querySelectorAll('.command-item').forEach(item => {
            item.addEventListener('click', () => {
                this.executeCommand(item.dataset.action);
            });
            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.executeCommand(item.dataset.action);
                }
            });
        });
    }

    handleSlashCommand(query) {
        const resultsContainer = document.getElementById('command-results');
        const parts = query.slice(1).split(' ');
        const command = parts[0];
        const args = parts.slice(1).join(' ');
        
        if (command === 'model' && args) {
            // Show model selection results
            const matchingModels = this.availableModels.filter(m => 
                m.id.toLowerCase().includes(args.toLowerCase()) ||
                this.getModelDisplayName(m).toLowerCase().includes(args.toLowerCase())
            );
            
            if (matchingModels.length > 0) {
                resultsContainer.innerHTML = `
                    <div class="command-group">
                        <div class="command-group-title">Matching Models</div>
                        ${matchingModels.map((model, index) => `
                            <div class="command-item ${index === 0 ? 'selected' : ''}" data-action="set-model:${model.id}" role="option" tabindex="0">
                                <div class="command-item-icon">
                                    <i data-lucide="cpu" class="w-4 h-4" aria-hidden="true"></i>
                                </div>
                                <div class="command-item-content">
                                    <div class="command-item-title">${this.getModelDisplayName(model)}</div>
                                    <div class="command-item-desc">${this.getModelDescription(model)}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
            } else {
                resultsContainer.innerHTML = `
                    <div class="empty-state py-8">
                        <p class="text-sm text-text-secondary">No matching models found</p>
                    </div>
                `;
            }
        } else if (command === 'models' || (command === 'model' && !args)) {
            // Show all models
            this.renderModelCommands(resultsContainer);
        } else if (command === 'image') {
            resultsContainer.innerHTML = `
                <div class="command-group">
                    <div class="command-group-title">Image Generation</div>
                    <div class="command-item selected" data-action="open-image-modal" role="option" tabindex="0">
                        <div class="command-item-icon">
                            <i data-lucide="image" class="w-4 h-4" aria-hidden="true"></i>
                        </div>
                        <div class="command-item-content">
                            <div class="command-item-title">Open Image Generator</div>
                            <div class="command-item-desc">Create AI-generated images</div>
                        </div>
                    </div>
                </div>
            `;
        } else if (command === 'tools' || command === 'tool') {
            resultsContainer.innerHTML = `
                <div class="command-group">
                    <div class="command-group-title">Tools</div>
                    <div class="command-item selected" data-action="insert-tool-command:${command === 'tool' ? '/tool ' : '/tools'}" role="option" tabindex="0">
                        <div class="command-item-icon">
                            <i data-lucide="wrench" class="w-4 h-4" aria-hidden="true"></i>
                        </div>
                        <div class="command-item-content">
                            <div class="command-item-title">${command === 'tool' ? 'Invoke Tool Command' : 'List Available Tools'}</div>
                            <div class="command-item-desc">${command === 'tool' ? 'Insert /tool <id> {json} into the chat input' : 'Insert /tools into the chat input'}</div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            resultsContainer.innerHTML = `
                <div class="empty-state py-8">
                    <p class="text-sm text-text-secondary">Unknown command. Try /model, /models, /image, or /tools</p>
                </div>
            `;
        }
        
        this.reinitializeIcons(resultsContainer);
        resultsContainer.querySelectorAll('.command-item').forEach(item => {
            item.addEventListener('click', () => {
                this.executeCommand(item.dataset.action);
            });
            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.executeCommand(item.dataset.action);
                }
            });
        });
    }

    renderModelCommands(container) {
        if (this.availableModels.length === 0) {
            container.innerHTML = `
                <div class="empty-state py-8">
                    <p class="text-sm text-text-secondary">Loading models...</p>
                </div>
            `;
            // Load models in background
            this.loadModels().then(() => {
                this.renderModelCommands(container);
            });
            return;
        }
        
        const grouped = this.groupModelsByProvider(this.availableModels);
        
        container.innerHTML = Object.entries(grouped).map(([provider, models]) => `
            <div class="command-group">
                <div class="command-group-title">${provider}</div>
                ${models.map((model, index) => `
                    <div class="command-item ${model.id === this.currentModel ? 'selected' : ''}" data-action="set-model:${model.id}" role="option" tabindex="0">
                        <div class="command-item-icon">
                            <i data-lucide="cpu" class="w-4 h-4" aria-hidden="true"></i>
                        </div>
                        <div class="command-item-content">
                            <div class="command-item-title">${this.getModelDisplayName(model)}</div>
                            <div class="command-item-desc">${this.getModelDescription(model)}</div>
                        </div>
                        ${model.id === this.currentModel ? `<i data-lucide="check" class="w-4 h-4 text-accent" aria-hidden="true"></i>` : ''}
                    </div>
                `).join('')}
            </div>
        `).join('');
    }

    getAvailableCommands() {
        const currentSession = sessionManager.currentSessionId;
        const hasMessages = currentSession && sessionManager.getMessages(currentSession).length > 0;
        
        return [
            { category: 'Actions', icon: 'plus', title: 'New Chat', description: 'Start a new conversation', action: 'new-chat', shortcut: 'Ctrl+N' },
            { category: 'Actions', icon: 'image', title: 'Create Image', description: 'Generate AI images or search Unsplash', action: 'open-image-modal', shortcut: 'Ctrl+I' },
            { category: 'Actions', icon: 'camera', title: 'Search Unsplash', description: 'Find free stock photos', action: 'open-image-modal:unsplash' },
            { category: 'Actions', icon: 'wrench', title: 'List Tools', description: 'Insert the /tools command into chat', action: 'insert-tool-command:/tools' },
            { category: 'Actions', icon: 'folder-open', title: 'Open File Manager', description: 'View and manage session files', action: 'open-file-manager', shortcut: 'Ctrl+Shift+F' },
            { category: 'Actions', icon: 'search', title: 'Search Messages', description: 'Search in current conversation', action: 'search', shortcut: 'Ctrl+F' },
            { category: 'Actions', icon: 'keyboard', title: 'Keyboard Shortcuts', description: 'View all keyboard shortcuts', action: 'show-shortcuts' },
            { category: 'Model', icon: 'cpu', title: 'Change Model', description: 'Select a different AI model', action: 'open-model-selector' },
            { category: 'Navigation', icon: 'sidebar', title: 'Toggle Sidebar', description: 'Show or hide the sidebar', action: 'toggle-sidebar', shortcut: 'Ctrl+B' },
            { category: 'View', icon: 'minimize-2', title: 'Toggle Input Area', description: 'Show or hide the message input', action: 'toggle-input-area', shortcut: 'Ctrl+Shift+H' },
            { category: 'View', icon: 'sun', title: 'Toggle Theme', description: 'Switch between light and dark mode', action: 'toggle-theme' },
            ...(hasMessages ? [
                { category: 'Export', icon: 'download', title: 'Export as Markdown', description: 'Download conversation as .md file', action: 'export-md' },
                { category: 'Export', icon: 'download', title: 'Export as JSON', description: 'Download conversation as .json file', action: 'export-json' },
                { category: 'Export', icon: 'download', title: 'Export as Text', description: 'Download conversation as .txt file', action: 'export-txt' },
                { category: 'Export', icon: 'globe', title: 'Export as HTML', description: 'Download conversation as .html file', action: 'export-html' },
                { category: 'Export', icon: 'file-type', title: 'Export as Word (DOCX)', description: 'Download conversation as .docx file', action: 'export-docx' },
                { category: 'Export', icon: 'file-box', title: 'Export as PDF', description: 'Download conversation as .pdf file', action: 'export-pdf' },
            ] : []),
            { category: 'Data', icon: 'upload', title: 'Import Conversation', description: 'Import from DOCX, PDF, HTML, MD, TXT, or JSON', action: 'import-conversations' },
            ...(currentSession ? [
                { category: 'Session', icon: 'trash-2', title: 'Clear Messages', description: 'Clear all messages in current session', action: 'clear-messages' },
                { category: 'Session', icon: 'x-circle', title: 'Delete Session', description: 'Delete current conversation', action: 'delete-session' },
            ] : []),
        ];
    }

    executeCommand(action) {
        this.closeCommandPalette();
        
        // Handle set-model action
        if (action.startsWith('set-model:')) {
            const modelId = action.split(':')[1];
            this.selectModel(modelId);
            return;
        }
        
        // Handle open-image-modal with source
        if (action.startsWith('open-image-modal')) {
            const source = action.split(':')[1] || 'generate';
            this.openImageModal();
            this.setImageSource(source);
            return;
        }

        if (action.startsWith('insert-tool-command:')) {
            const command = action.slice('insert-tool-command:'.length);
            const input = document.getElementById('message-input');
            if (input) {
                input.value = command;
                input.focus();
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return;
        }
        
        switch (action) {
            case 'new-chat':
                window.chatApp?.createNewSession();
                break;
            case 'search':
                this.openSearch();
                break;
            case 'toggle-sidebar':
                this.toggleSidebar();
                break;
            case 'toggle-input-area':
                this.toggleInputArea();
                break;
            case 'toggle-theme':
                this.toggleTheme();
                break;
            case 'export-md':
                window.chatApp?.exportConversation('markdown');
                break;
            case 'export-json':
                window.chatApp?.exportConversation('json');
                break;
            case 'export-txt':
                window.chatApp?.exportConversation('txt');
                break;
            case 'export-html':
                window.chatApp?.exportConversation('html');
                break;
            case 'export-docx':
                window.chatApp?.exportConversation('docx');
                break;
            case 'export-pdf':
                window.chatApp?.exportConversation('pdf');
                break;
            case 'clear-messages':
                window.chatApp?.clearCurrentSession();
                break;
            case 'delete-session':
                if (sessionManager.currentSessionId) {
                    this.confirmDeleteSession(sessionManager.currentSessionId);
                }
                break;
            case 'open-file-manager':
                if (window.fileManager) {
                    window.fileManager.open();
                }
                break;
            case 'open-model-selector':
                this.openModelSelector();
                break;
            case 'show-shortcuts':
                this.openShortcutsModal();
                break;
            case 'import-conversations':
                this.openImportModal();
                break;
        }
    }

    // ============================================
    // Keyboard Shortcuts Help
    // ============================================

    openShortcutsModal() {
        // Close any existing shortcuts modal first
        this.closeShortcutsModal();
        
        // Save last focused element
        this.lastFocusedElement = document.activeElement;
        
        const modal = document.createElement('div');
        modal.id = 'shortcuts-modal';
        modal.className = 'modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'shortcuts-title');
        
        const shortcuts = [
            { key: 'Ctrl + K', description: 'Open command palette' },
            { key: 'Ctrl + N', description: 'New chat' },
            { key: 'Ctrl + F', description: 'Search messages' },
            { key: 'Ctrl + I', description: 'Create image (AI or Unsplash)' },
            { key: 'Ctrl + B', description: 'Toggle sidebar' },
            { key: 'Ctrl + Shift + H', description: 'Toggle input area' },
            { key: 'Shift + Enter', description: 'New line in input' },
            { key: 'Enter', description: 'Send message' },
            { key: 'Esc', description: 'Close modals/panels' },
            { key: '?', description: 'Show this help' },
            { key: '', description: '' },
            { key: 'Commands', description: '/image [prompt] - Generate AI images' },
            { key: '', description: '/unsplash [query] - Search stock photos' },
            { key: '', description: '/model [name] - Change AI model' },
            { key: '', description: '/clear - Clear conversation' },
            { key: '', description: '' },
            { key: 'Import/Export', description: 'Supports DOCX, PDF, HTML, Markdown, TXT, and JSON formats' },
        ];
        
        modal.innerHTML = `
            <div class="modal-overlay" onclick="uiHelpers.closeShortcutsModal()"></div>
            <div class="modal-content" style="max-width: 480px;">
                <div class="modal-header">
                    <h3 id="shortcuts-title">Keyboard Shortcuts</h3>
                    <button class="btn-icon" onclick="uiHelpers.closeShortcutsModal()" aria-label="Close keyboard shortcuts help">
                        <i data-lucide="x" class="w-5 h-5" aria-hidden="true"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="shortcuts-list" role="list">
                        ${shortcuts.map(s => s.key ? `
                            <div class="shortcut-item" role="listitem">
                                <kbd class="shortcut-key">${s.key}</kbd>
                                <span class="shortcut-desc">${s.description}</span>
                            </div>
                        ` : `<div class="shortcut-item" style="background: transparent; border: none;"><span class="shortcut-desc" style="font-weight: 600; color: var(--text-primary);">${s.description}</span></div>`).join('')}
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        this.reinitializeIcons(modal);
        this.trapFocus(modal);
        
        // Close on escape
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeShortcutsModal();
            }
        });
    }

    closeShortcutsModal() {
        const modal = document.getElementById('shortcuts-modal');
        if (modal) {
            modal.remove();
        }
        
        // Return focus to trigger button
        if (this.lastFocusedElement) {
            this.lastFocusedElement.focus();
            this.lastFocusedElement = null;
        }
    }

    // ============================================
    // Import Modal - Enhanced with multiple formats
    // ============================================

    openImportModal() {
        // Remove any existing import modal
        this.closeImportModal();
        
        // Show the new import modal from HTML
        const modal = document.getElementById('import-modal');
        if (modal) {
            modal.classList.remove('hidden');
            modal.setAttribute('aria-hidden', 'false');
            
            // Save last focused element
            this.lastFocusedElement = document.activeElement;
            
            this.setupImportHandlers(modal);
            this.trapFocus(modal);
        }
    }

    setupImportHandlers(modal) {
        const dropzone = modal.querySelector('#import-dropzone');
        const fileInput = modal.querySelector('#import-file-input');
        
        if (!dropzone || !fileInput) return;
        
        // Reset state
        this.pendingImport = null;
        this.pendingImportFormat = null;
        this.resetImportUI(modal);
        
        dropzone.addEventListener('click', () => fileInput.click());
        
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });
        
        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('dragover');
        });
        
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleImportFile(files[0]);
            }
        });
        
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleImportFile(e.target.files[0]);
            }
        });
        
        // Close on escape
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeImportModal();
            }
        });
    }

    resetImportUI(modal) {
        const preview = modal.querySelector('#import-preview');
        const error = modal.querySelector('#import-error');
        const progress = modal.querySelector('#import-progress');
        const confirmBtn = modal.querySelector('#import-confirm-btn');
        
        preview?.classList.add('hidden');
        error?.classList.add('hidden');
        progress?.classList.add('hidden');
        if (confirmBtn) confirmBtn.disabled = true;
    }

    async handleImportFile(file) {
        const modal = document.getElementById('import-modal');
        const progress = modal?.querySelector('#import-progress');
        const progressText = modal?.querySelector('#import-progress-text');
        const errorDiv = modal?.querySelector('#import-error');
        const errorText = modal?.querySelector('#import-error-text');
        
        // Show progress
        progress?.classList.remove('hidden');
        errorDiv?.classList.add('hidden');
        
        try {
            const result = await window.importExportManager.importFile(file, (percent, message) => {
                if (progressText) {
                    progressText.textContent = message || `Processing... ${percent}%`;
                }
            });
            
            this.pendingImport = result;
            this.showImportPreview(result, file.name);
        } catch (error) {
            progress?.classList.add('hidden');
            if (errorText) errorText.textContent = error.message;
            errorDiv?.classList.remove('hidden');
        }
    }

    showImportPreview(result, filename) {
        const modal = document.getElementById('import-modal');
        const preview = modal?.querySelector('#import-preview');
        const filenameEl = modal?.querySelector('#import-filename');
        const statsEl = modal?.querySelector('#import-stats');
        const messagesPreviewEl = modal?.querySelector('#import-messages-preview');
        const confirmBtn = modal?.querySelector('#import-confirm-btn');
        const progress = modal?.querySelector('#import-progress');
        
        if (!preview) return;
        
        progress?.classList.add('hidden');
        
        // Update filename
        if (filenameEl) filenameEl.textContent = filename;
        
        // Update stats
        if (statsEl) {
            const formatLabels = {
                docx: 'Word Document',
                pdf: 'PDF Document',
                html: 'HTML Page',
                markdown: 'Markdown',
                txt: 'Text File',
                json: 'JSON Export'
            };
            
            statsEl.innerHTML = `
                <div class="import-stat">
                    <span class="import-stat-value">${result.messages.length}</span>
                    <span class="import-stat-label">Messages</span>
                </div>
                <div class="import-stat">
                    <span class="import-stat-value">${formatLabels[result.format] || result.format.toUpperCase()}</span>
                    <span class="import-stat-label">Format</span>
                </div>
                ${result.pageCount ? `
                <div class="import-stat">
                    <span class="import-stat-value">${result.pageCount}</span>
                    <span class="import-stat-label">Pages</span>
                </div>
                ` : ''}
            `;
        }
        
        // Show message preview (first 5 messages)
        if (messagesPreviewEl) {
            const previewMessages = result.messages.slice(0, 5);
            messagesPreviewEl.innerHTML = previewMessages.map(msg => `
                <div class="import-preview-message ${msg.role}">
                    <span class="import-preview-message-role">${msg.role}</span>
                    <span class="import-preview-message-content">${this.escapeHtml(msg.content.substring(0, 100))}${msg.content.length > 100 ? '...' : ''}</span>
                </div>
            `).join('');
            
            if (result.messages.length > 5) {
                messagesPreviewEl.innerHTML += `
                    <div style="text-align: center; padding: 0.5rem; color: var(--text-secondary); font-size: 0.75rem;">
                        + ${result.messages.length - 5} more messages
                    </div>
                `;
            }
        }
        
        preview.classList.remove('hidden');
        if (confirmBtn) confirmBtn.disabled = false;
    }

    async confirmImport() {
        if (!this.pendingImport || !this.pendingImport.messages.length) return;
        
        const modal = document.getElementById('import-modal');
        const confirmBtn = modal?.querySelector('#import-confirm-btn');
        
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = '<span class="animate-spin inline-block mr-2">...</span> Importing...';
        }
        
        try {
            // Create a new session for the imported conversation
            await window.chatApp.createNewSession();
            const sessionId = sessionManager.currentSessionId;
            
            if (!sessionId) {
                throw new Error('Failed to create session');
            }
            
            // Add messages to the session
            for (const msg of this.pendingImport.messages) {
                sessionManager.addMessage(sessionId, {
                    role: msg.role,
                    content: msg.content,
                    type: msg.type || null,
                    prompt: msg.prompt || null,
                    imageUrl: msg.imageUrl || null,
                    model: msg.model || null,
                    timestamp: msg.timestamp || new Date().toISOString()
                });
            }
            
            // Update session title if available
            if (this.pendingImport.title) {
                const session = sessionManager.sessions.find(s => s.id === sessionId);
                if (session) {
                    session.title = this.pendingImport.title;
                    sessionManager.saveToStorage();
                }
            }
            
            // Refresh the UI
            window.chatApp.loadSessionMessages(sessionId);
            window.chatApp.updateSessionInfo();
            uiHelpers.renderSessionsList(sessionManager.sessions, sessionId);
            
            this.showToast(`Imported ${this.pendingImport.messages.length} messages`, 'success');
            this.closeImportModal();
        } catch (error) {
            this.showToast(`Import failed: ${error.message}`, 'error');
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Import Conversation';
            }
        }
    }

    closeImportModal() {
        const modal = document.getElementById('import-modal');
        if (modal) {
            modal.classList.add('hidden');
            modal.setAttribute('aria-hidden', 'true');
        }
        this.pendingImport = null;
        this.pendingImportFormat = null;
        
        // Reset file input
        const fileInput = modal?.querySelector('#import-file-input');
        if (fileInput) fileInput.value = '';
    }

    // ============================================
    // Export Modal - Enhanced with progress
    // ============================================

    openExportModal() {
        if (!sessionManager.currentSessionId) {
            this.showToast('No active conversation to export', 'warning');
            return;
        }
        
        const modal = document.getElementById('export-modal');
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        
        // Hide progress
        const progress = modal.querySelector('#export-progress');
        if (progress) progress.classList.add('hidden');
        
        // Check if we need to add export all option
        const exportOptions = modal.querySelector('.export-options');
        if (exportOptions && sessionManager.sessions.length > 1) {
            if (!exportOptions.querySelector('[data-action="export-all"]')) {
                const exportAllBtn = document.createElement('button');
                exportAllBtn.className = 'export-option';
                exportAllBtn.setAttribute('data-action', 'export-all');
                exportAllBtn.setAttribute('onclick', 'app.exportAllConversations()');
                exportAllBtn.innerHTML = `
                    <i data-lucide="archive" class="w-8 h-8 text-orange-500"></i>
                    <span class="export-name">All Conversations</span>
                    <span class="export-desc">Export all sessions as JSON</span>
                `;
                exportOptions.appendChild(exportAllBtn);
                this.reinitializeIcons(exportAllBtn);
            }
        }
        
        this.trapFocus(modal);
    }

    showExportProgress(percent, message) {
        const modal = document.getElementById('export-modal');
        const progress = modal?.querySelector('#export-progress');
        const progressText = modal?.querySelector('#export-progress-text');
        const progressPercent = modal?.querySelector('#export-progress-percent');
        const progressFill = modal?.querySelector('#export-progress-fill');
        
        if (progress) progress.classList.remove('hidden');
        if (progressText) progressText.textContent = message || 'Exporting...';
        if (progressPercent) progressPercent.textContent = `${percent}%`;
        if (progressFill) progressFill.style.width = `${percent}%`;
    }

    hideExportProgress() {
        const modal = document.getElementById('export-modal');
        const progress = modal?.querySelector('#export-progress');
        if (progress) progress.classList.add('hidden');
    }

    closeExportModal() {
        const modal = document.getElementById('export-modal');
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
        this.hideExportProgress();
    }

    // ============================================
    // Toast Notifications
    // ============================================

    showToast(message, type = 'info', title = '') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'polite');

        const icons = {
            success: 'check-circle',
            error: 'x-circle',
            warning: 'alert-triangle',
            info: 'info'
        };

        const icon = icons[type] || icons.info;

        toast.innerHTML = `
            <div class="toast-icon" aria-hidden="true">
                <i data-lucide="${icon}" class="w-5 h-5"></i>
            </div>
            <div class="toast-content">
                ${title ? `<div class="toast-title">${title}</div>` : ''}
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close" aria-label="Close notification">
                <i data-lucide="x" class="w-4 h-4" aria-hidden="true"></i>
            </button>
        `;

        container.appendChild(toast);
        this.reinitializeIcons(toast);

        // Close button handler
        toast.querySelector('.toast-close').addEventListener('click', () => {
            this.removeToast(toast);
        });

        // Auto-remove after 5 seconds
        setTimeout(() => {
            this.removeToast(toast);
        }, 5000);
    }

    removeToast(toast) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }

    // ============================================
    // Scroll & View Utilities
    // ============================================

    scrollToBottom(smooth = true) {
        this.messageContainer.scrollTo({
            top: this.messageContainer.scrollHeight,
            behavior: smooth ? 'smooth' : 'auto'
        });
    }

    hideWelcomeMessage() {
        const welcome = document.getElementById('welcome-message');
        if (welcome) {
            welcome.style.display = 'none';
        }
    }

    showWelcomeMessage() {
        const welcome = document.getElementById('welcome-message');
        if (welcome) {
            welcome.style.display = 'flex';
        }
    }

    clearMessages() {
        const welcome = document.getElementById('welcome-message');
        this.messageContainer.innerHTML = '';
        if (welcome) {
            this.messageContainer.appendChild(welcome);
            this.showWelcomeMessage();
        }
    }

    // ============================================
    // Typing Indicator
    // ============================================

    showTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        indicator.classList.remove('hidden');
        indicator.setAttribute('aria-hidden', 'false');
    }

    hideTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        indicator.classList.add('hidden');
        indicator.setAttribute('aria-hidden', 'true');
    }

    // ============================================
    // Mobile Sidebar
    // ============================================

    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        
        sidebar.classList.toggle('open');
        overlay.classList.toggle('hidden');
        
        // Update aria attributes
        const isOpen = sidebar.classList.contains('open');
        sidebar.setAttribute('aria-hidden', !isOpen);
    }

    closeSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        
        sidebar.classList.remove('open');
        overlay.classList.add('hidden');
        sidebar.setAttribute('aria-hidden', 'true');
    }

    // ============================================
    // Icon Management
    // ============================================

    reinitializeIcons(container = document) {
        if (window.lucide) {
            lucide.createIcons({ attrs: { 'stroke-width': 2 }, parent: container });
        }
    }

    // ============================================
    // Accessibility - Focus Trap
    // ============================================

    trapFocus(element) {
        const focusableElements = element.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        
        if (focusableElements.length === 0) return;
        
        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];
        
        // Focus first element
        firstFocusable.focus();
        
        element.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;
            
            if (e.shiftKey) {
                if (document.activeElement === firstFocusable) {
                    lastFocusable.focus();
                    e.preventDefault();
                }
            } else {
                if (document.activeElement === lastFocusable) {
                    firstFocusable.focus();
                    e.preventDefault();
                }
            }
        });
    }

    // ============================================
    // Event Listeners
    // ============================================

    setupEventListeners() {
        // Search input
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.performSearch(e.target.value);
            });
        }

        // Command palette input
        const commandInput = document.getElementById('command-input');
        if (commandInput) {
            commandInput.addEventListener('input', (e) => {
                this.renderCommandResults(e.target.value);
            });

            // Keyboard navigation for command palette
            commandInput.addEventListener('keydown', (e) => {
                const items = document.querySelectorAll('.command-item');
                const selected = document.querySelector('.command-item.selected');
                let currentIndex = Array.from(items).indexOf(selected);

                switch (e.key) {
                    case 'ArrowDown':
                        e.preventDefault();
                        currentIndex = (currentIndex + 1) % items.length;
                        break;
                    case 'ArrowUp':
                        e.preventDefault();
                        currentIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
                        break;
                    case 'Enter':
                        e.preventDefault();
                        if (selected) {
                            this.executeCommand(selected.dataset.action);
                        }
                        return;
                    case 'Escape':
                        e.preventDefault();
                        this.closeCommandPalette();
                        return;
                }

                items.forEach((item, index) => {
                    item.classList.toggle('selected', index === currentIndex);
                });
            });
        }

        // Keyboard shortcut for image generation
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
                e.preventDefault();
                this.openImageModal();
            }
        });

        // Keyboard shortcut for shortcuts help (Ctrl + /)
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === '/') {
                e.preventDefault();
                this.openShortcutsModal();
            }
        });

        // Close modals on escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeImageModal();
                this.closeImageLightbox();
                this.closeModelSelector();
                this.closeShortcutsModal();
                this.closeImportModal();
            }
        });
        
        // Handle visibility change for connection monitoring
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && window.chatApp) {
                // Re-check connection when tab becomes visible
                window.chatApp.checkConnection?.();
            }
        });
    }

    // ============================================
    // Utilities
    // ============================================

    formatTime(isoString) {
        if (!isoString) return '';
        const date = new Date(isoString);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        
        if (isToday) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    // ============================================
    // Input Area Toggle
    // ============================================
    
    toggleInputArea() {
        const inputArea = document.getElementById('input-area');
        const toggleBtn = document.getElementById('input-toggle-btn');
        const toggleIcon = document.getElementById('input-toggle-icon');
        
        if (!inputArea || !toggleBtn) return;
        
        const isHidden = inputArea.classList.toggle('hidden');
        toggleBtn.classList.toggle('input-hidden', isHidden);
        
        // Update icon
        if (toggleIcon) {
            toggleIcon.setAttribute('data-lucide', isHidden ? 'chevron-up' : 'chevron-down');
            lucide.createIcons();
        }
        
        // Save preference
        localStorage.setItem('webchat_input_hidden', isHidden ? 'true' : 'false');
        
        // Scroll to bottom if showing input
        if (!isHidden) {
            setTimeout(() => this.scrollToBottom(), 100);
            // Focus input
            const messageInput = document.getElementById('message-input');
            if (messageInput) messageInput.focus();
        }
    }
    
    restoreInputAreaState() {
        const isHidden = localStorage.getItem('webchat_input_hidden') === 'true';
        if (isHidden) {
            const inputArea = document.getElementById('input-area');
            const toggleBtn = document.getElementById('input-toggle-btn');
            const toggleIcon = document.getElementById('input-toggle-icon');
            
            if (inputArea) inputArea.classList.add('hidden');
            if (toggleBtn) toggleBtn.classList.add('input-hidden');
            if (toggleIcon) {
                toggleIcon.setAttribute('data-lucide', 'chevron-up');
                lucide.createIcons();
            }
        }
    }
    
    // ============================================
    // Draft Saving - Auto-save to localStorage
    // ============================================
    
    setupDraftSaving() {
        const messageInput = document.getElementById('message-input');
        if (!messageInput) return;
        
        // Save draft on input
        messageInput.addEventListener('input', () => {
            this.saveDraft(messageInput.value);
        });
        
        // Clear draft when message is sent
        const sendBtn = document.getElementById('send-btn');
        if (sendBtn) {
            sendBtn.addEventListener('click', () => {
                this.clearDraft();
            });
        }
    }
    
    saveDraft(content) {
        try {
            if (content && content.trim()) {
                localStorage.setItem('kimibuilt_message_draft', content);
                localStorage.setItem('kimibuilt_message_draft_time', Date.now().toString());
            } else {
                this.clearDraft();
            }
        } catch (e) {
            console.warn('Failed to save draft:', e);
        }
    }
    
    restoreDraft() {
        try {
            const draft = localStorage.getItem('kimibuilt_message_draft');
            const draftTime = localStorage.getItem('kimibuilt_message_draft_time');
            
            if (draft && draftTime) {
                const age = Date.now() - parseInt(draftTime, 10);
                const maxAge = 24 * 60 * 60 * 1000; // 24 hours
                
                if (age < maxAge) {
                    const messageInput = document.getElementById('message-input');
                    if (messageInput && !messageInput.value) {
                        messageInput.value = draft;
                        // Trigger input event to resize textarea
                        messageInput.dispatchEvent(new Event('input', { bubbles: true }));
                        this.showToast('Draft restored', 'info', 'Draft');
                    }
                } else {
                    this.clearDraft();
                }
            }
        } catch (e) {
            console.warn('Failed to restore draft:', e);
        }
    }
    
    clearDraft() {
        try {
            localStorage.removeItem('kimibuilt_message_draft');
            localStorage.removeItem('kimibuilt_message_draft_time');
        } catch (e) {
            console.warn('Failed to clear draft:', e);
        }
    }
    
    // ============================================
    // Code Block Scroll Indicators
    // ============================================
    
    setupCodeBlockScrollIndicators() {
        const checkScroll = () => {
            document.querySelectorAll('.code-block pre').forEach(pre => {
                if (pre.scrollWidth > pre.clientWidth) {
                    pre.classList.add('can-scroll');
                } else {
                    pre.classList.remove('can-scroll');
                }
            });
        };
        
        // Check on window resize
        window.addEventListener('resize', checkScroll);
        
        // Check after messages are rendered
        const observer = new MutationObserver(() => {
            setTimeout(checkScroll, 100);
        });
        
        const container = document.getElementById('messages-container');
        if (container) {
            observer.observe(container, { childList: true, subtree: true });
        }
    }
}

// Create global UI helpers instance
const uiHelpers = new UIHelpers();
window.uiHelpers = uiHelpers;
