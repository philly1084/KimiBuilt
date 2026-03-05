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
            style: 'vivid'
        };
        
        // Model selector state
        this.availableModels = [];
        this.currentModel = localStorage.getItem('kimibuilt_default_model') || 'gpt-4o';
        this.updateModelUI();
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
        
        renderer.code = (code, language) => {
            const lang = language || 'text';
            const escapedCode = this.escapeHtml(code);
            const prismLang = this.getPrismLanguage(lang);
            const lineCount = code.split('\n').length;
            
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
                            <button class="code-copy-btn" onclick="uiHelpers.copyCode(this)" data-code="${this.escapeHtmlAttr(code)}">
                                <i data-lucide="copy" class="w-3.5 h-3.5"></i>
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
            return `<code>${this.escapeHtml(code)}</code>`;
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
            'dockerfile': 'docker'
        };
        return languageMap[lang?.toLowerCase()] || lang || 'text';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    escapeHtmlAttr(text) {
        return text
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
        const messageId = message.id || `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        const messageEl = document.createElement('div');
        messageEl.className = `message ${isUser ? 'user' : 'assistant'}`;
        messageEl.id = messageId;
        messageEl.dataset.messageId = messageId;

        const avatar = isUser ? 
            `<div class="message-avatar user"><i data-lucide="user" class="w-4 h-4"></i></div>` :
            `<div class="message-avatar assistant"><i data-lucide="bot" class="w-4 h-4"></i></div>`;

        const content = isUser ? 
            this.renderUserMessage(message.content) :
            this.renderAssistantMessage(message.content, isStreaming);

        const time = this.formatTime(message.timestamp);
        const fullTimestamp = message.timestamp ? new Date(message.timestamp).toLocaleString() : '';

        messageEl.innerHTML = `
            ${!isUser ? avatar : ''}
            <div class="message-content">
                <div class="message-header">
                    <span class="message-author">${isUser ? 'You' : 'Assistant'}</span>
                    <span class="message-time" title="${fullTimestamp}">${time}</span>
                    <div class="message-actions">
                        <button class="message-action-btn" onclick="uiHelpers.copyMessage('${messageId}')" title="Copy message">
                            <i data-lucide="copy" class="w-4 h-4"></i>
                        </button>
                        ${!isUser ? `
                        <button class="message-action-btn" onclick="uiHelpers.regenerateMessage('${messageId}')" title="Regenerate response">
                            <i data-lucide="refresh-cw" class="w-4 h-4"></i>
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
                'div', 'span',
                'input'
            ],
            ALLOWED_ATTR: [
                'href', 'title', 'target', 'rel', 'src', 'alt', 
                'class', 'data-code', 'onclick', 'type', 'checked', 'disabled'
            ],
            ALLOW_DATA_ATTR: false
        });

        // Add streaming cursor if needed
        if (isStreaming) {
            html += '<span class="streaming-cursor"></span>';
        }

        return html;
    }

    renderImageMessage(message) {
        const messageId = message.id || `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const time = this.formatTime(message.timestamp);
        const fullTimestamp = message.timestamp ? new Date(message.timestamp).toLocaleString() : '';
        
        const isLoading = message.isLoading;
        const imageUrl = message.imageUrl;
        const revisedPrompt = message.revisedPrompt;
        const prompt = message.prompt;
        
        const messageEl = document.createElement('div');
        messageEl.className = 'message assistant';
        messageEl.id = messageId;
        messageEl.dataset.messageId = messageId;
        
        const imageHtml = isLoading ? `
            <div class="image-container loading">
                <div class="image-loading-indicator">
                    <div class="spinner"></div>
                    <span class="text">${message.loadingText || 'Generating image...'}</span>
                </div>
            </div>
        ` : `
            <div class="image-container">
                <img src="${imageUrl}" alt="${this.escapeHtmlAttr(prompt || 'Generated image')}" 
                     onclick="uiHelpers.openImageLightbox('${imageUrl}')" 
                     onload="uiHelpers.scrollToBottom()">
            </div>
            ${revisedPrompt ? `
                <div class="image-revised-prompt">
                    <div class="label">Revised Prompt</div>
                    <div>${this.escapeHtml(revisedPrompt)}</div>
                </div>
            ` : ''}
            <div class="image-actions">
                <button class="image-action-btn" onclick="uiHelpers.downloadImage('${imageUrl}', '${this.escapeHtmlAttr(prompt || 'generated-image')}.png')">
                    <i data-lucide="download" class="w-4 h-4"></i>
                    <span>Download</span>
                </button>
                <button class="image-action-btn" onclick="uiHelpers.copyImageUrl('${imageUrl}')">
                    <i data-lucide="link" class="w-4 h-4"></i>
                    <span>Copy URL</span>
                </button>
            </div>
        `;
        
        messageEl.innerHTML = `
            <div class="message-avatar assistant">
                <i data-lucide="image" class="w-4 h-4"></i>
            </div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-author">AI Image Generator</span>
                    <span class="message-time" title="${fullTimestamp}">${time}</span>
                    <div class="message-actions">
                        ${!isLoading ? `
                        <button class="message-action-btn" onclick="uiHelpers.copyMessage('${messageId}')" title="Copy prompt">
                            <i data-lucide="copy" class="w-4 h-4"></i>
                        </button>
                        ` : ''}
                    </div>
                </div>
                <div class="message-image">
                    <div class="image-generation-info">
                        <div class="icon">
                            <i data-lucide="sparkles" class="w-3.5 h-3.5"></i>
                        </div>
                        <span class="text">Generated Image</span>
                        ${message.model ? `<span class="meta">${message.model}</span>` : ''}
                    </div>
                    ${prompt ? `<p class="text-sm text-text-secondary mb-3">"${this.escapeHtml(prompt)}"</p>` : ''}
                    ${imageHtml}
                </div>
            </div>
        `;
        
        return messageEl;
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
    // Image Handling
    // ============================================

    openImageLightbox(imageUrl) {
        const lightbox = document.getElementById('image-lightbox');
        const img = document.getElementById('lightbox-image');
        img.src = imageUrl;
        lightbox.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    closeImageLightbox() {
        const lightbox = document.getElementById('image-lightbox');
        const img = document.getElementById('lightbox-image');
        lightbox.classList.add('hidden');
        img.src = '';
        document.body.style.overflow = '';
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
        
        // Focus the prompt input
        setTimeout(() => {
            document.getElementById('image-prompt-input').focus();
        }, 100);
        
        // Setup toggle buttons
        this.setupImageGenerationToggles();
    }

    closeImageModal() {
        const modal = document.getElementById('image-modal');
        modal.classList.add('hidden');
        
        // Reset form
        document.getElementById('image-prompt-input').value = '';
        document.getElementById('image-model-select').value = 'dall-e-3';
        document.getElementById('image-size-select').value = '1024x1024';
        this.imageGenerationState.quality = 'standard';
        this.imageGenerationState.style = 'vivid';
        this.updateToggleButtons();
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
        document.getElementById('image-model-select').addEventListener('change', (e) => {
            this.updateImageOptionsForModel(e.target.value);
        });
        
        this.updateToggleButtons();
        this.updateImageOptionsForModel(document.getElementById('image-model-select').value);
    }

    updateToggleButtons() {
        document.querySelectorAll('.quality-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.quality === this.imageGenerationState.quality);
        });
        document.querySelectorAll('.style-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.style === this.imageGenerationState.style);
        });
    }

    updateImageOptionsForModel(model) {
        const sizeSelect = document.getElementById('image-size-select');
        const qualityContainer = document.getElementById('image-quality-container');
        const styleContainer = document.getElementById('image-style-container');
        
        if (model === 'dall-e-3') {
            // DALL-E 3 supports all sizes
            sizeSelect.innerHTML = `
                <option value="1024x1024">1024x1024 (Square)</option>
                <option value="1792x1024">1792x1024 (Landscape)</option>
                <option value="1024x1792">1024x1792 (Portrait)</option>
            `;
            qualityContainer.style.display = 'block';
            styleContainer.style.display = 'block';
        } else {
            // DALL-E 2 supports different sizes
            sizeSelect.innerHTML = `
                <option value="256x256">256x256</option>
                <option value="512x512">512x512</option>
                <option value="1024x1024">1024x1024</option>
            `;
            qualityContainer.style.display = 'none';
            styleContainer.style.display = 'none';
        }
    }

    getImageGenerationOptions() {
        const model = document.getElementById('image-model-select').value;
        const options = {
            prompt: document.getElementById('image-prompt-input').value.trim(),
            model: model,
            size: document.getElementById('image-size-select').value
        };
        
        if (model === 'dall-e-3') {
            options.quality = this.imageGenerationState.quality;
            options.style = this.imageGenerationState.style;
        }
        
        return options;
    }

    setImageGenerateButtonState(isGenerating) {
        const btn = document.getElementById('image-generate-btn');
        if (isGenerating) {
            btn.disabled = true;
            btn.classList.add('generating');
            btn.innerHTML = `
                <div class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                <span>Generating...</span>
            `;
        } else {
            btn.disabled = false;
            btn.classList.remove('generating');
            btn.innerHTML = `
                <i data-lucide="wand-2" class="w-5 h-5"></i>
                <span>Generate Image</span>
            `;
            this.reinitializeIcons(btn);
        }
    }

    // ============================================
    // Model Selector
    // ============================================

    async loadModels() {
        try {
            const response = await apiClient.getModels();
            this.availableModels = response.data || [];
            return this.availableModels;
        } catch (error) {
            console.error('Failed to load models:', error);
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

    async openModelSelector() {
        const dropdown = document.getElementById('model-selector-dropdown');
        dropdown.classList.remove('hidden');
        
        // Load models if not already loaded
        if (this.availableModels.length === 0) {
            await this.loadModels();
        }
        
        this.renderModelList();
    }

    closeModelSelector() {
        const dropdown = document.getElementById('model-selector-dropdown');
        dropdown.classList.add('hidden');
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
    }

    renderModelItem(model) {
        const isActive = model.id === this.currentModel;
        const provider = this.getModelProvider(model);
        const displayName = this.getModelDisplayName(model);
        const description = this.getModelDescription(model);
        
        return `
            <div class="model-item ${isActive ? 'active' : ''}" data-model-id="${model.id}">
                <div class="model-item-icon ${provider}">
                    <i data-lucide="cpu" class="w-4 h-4"></i>
                </div>
                <div class="model-item-info">
                    <div class="model-item-name">${displayName}</div>
                    <div class="model-item-desc">${description}</div>
                </div>
                <div class="model-item-check">
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
            'claude-3-5-sonnet': 'Claude 3.5 Sonnet'
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
        localStorage.setItem('kimibuilt_default_model', modelId);
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
        localStorage.setItem('kimibuilt_default_model', modelId);
        this.updateModelUI();
    }

    // ============================================
    // Code Highlighting
    // ============================================

    highlightCodeBlocks(container) {
        const codeBlocks = container.querySelectorAll('pre code');
        codeBlocks.forEach(block => {
            Prism.highlightElement(block);
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
                <i data-lucide="check" class="w-3.5 h-3.5"></i>
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

    // ============================================
    // Session List Rendering
    // ============================================

    renderSessionsList(sessions, currentSessionId) {
        if (sessions.length === 0) {
            this.sessionsList.innerHTML = `
                <div class="empty-state py-8">
                    <i data-lucide="message-square" class="w-12 h-12 mb-3 text-text-muted"></i>
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
                <div class="session-item ${isActive ? 'active' : ''}" data-session-id="${session.id}">
                    <div class="session-icon ${modeClass}">
                        <i data-lucide="${modeIcon}" class="w-4 h-4 text-white"></i>
                    </div>
                    <div class="session-info">
                        <div class="session-title">${this.escapeHtml(session.title || 'New Chat')}</div>
                        <div class="session-meta">
                            ${timeAgo} • ${messageCount} message${messageCount !== 1 ? 's' : ''}
                        </div>
                    </div>
                    <div class="session-actions">
                        <button class="btn-icon danger p-1.5 rounded delete-session-btn" data-session-id="${session.id}" title="Delete conversation">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
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
            item.addEventListener('click', (e) => {
                // Don't switch if clicking delete button
                if (e.target.closest('.delete-session-btn')) return;
                
                const sessionId = item.dataset.sessionId;
                sessionManager.switchSession(sessionId);
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
        const savedTheme = localStorage.getItem('kimibuilt_theme');
        const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        const theme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
        this.setTheme(theme);
        
        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (!localStorage.getItem('kimibuilt_theme')) {
                this.setTheme(e.matches ? 'dark' : 'light');
            }
        });
    }

    setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('kimibuilt_theme', theme);

        // Update theme toggle UI
        const lightIcon = document.getElementById('theme-icon-light');
        const darkIcon = document.getElementById('theme-icon-dark');
        const themeText = document.getElementById('theme-text');
        const prismTheme = document.getElementById('prism-theme');

        if (theme === 'light') {
            lightIcon?.classList.remove('hidden');
            darkIcon?.classList.add('hidden');
            themeText.textContent = 'Light Mode';
            prismTheme?.setAttribute('href', 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism.min.css');
        } else {
            lightIcon?.classList.add('hidden');
            darkIcon?.classList.remove('hidden');
            themeText.textContent = 'Dark Mode';
            prismTheme?.setAttribute('href', 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css');
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
        input.value = '';
        input.focus();
        this.renderCommandResults('');
    }

    closeCommandPalette() {
        const palette = document.getElementById('command-palette');
        palette.classList.add('hidden');
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
                    <div class="command-item ${index === 0 ? 'selected' : ''}" data-action="${cmd.action}">
                        <div class="command-item-icon">
                            <i data-lucide="${cmd.icon}" class="w-4 h-4"></i>
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
                            <div class="command-item ${index === 0 ? 'selected' : ''}" data-action="set-model:${model.id}">
                                <div class="command-item-icon">
                                    <i data-lucide="cpu" class="w-4 h-4"></i>
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
                    <div class="command-item selected" data-action="open-image-modal">
                        <div class="command-item-icon">
                            <i data-lucide="image" class="w-4 h-4"></i>
                        </div>
                        <div class="command-item-content">
                            <div class="command-item-title">Open Image Generator</div>
                            <div class="command-item-desc">Create AI-generated images</div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            resultsContainer.innerHTML = `
                <div class="empty-state py-8">
                    <p class="text-sm text-text-secondary">Unknown command. Try /model, /models, or /image</p>
                </div>
            `;
        }
        
        this.reinitializeIcons(resultsContainer);
        resultsContainer.querySelectorAll('.command-item').forEach(item => {
            item.addEventListener('click', () => {
                this.executeCommand(item.dataset.action);
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
                    <div class="command-item ${model.id === this.currentModel ? 'selected' : ''}" data-action="set-model:${model.id}">
                        <div class="command-item-icon">
                            <i data-lucide="cpu" class="w-4 h-4"></i>
                        </div>
                        <div class="command-item-content">
                            <div class="command-item-title">${this.getModelDisplayName(model)}</div>
                            <div class="command-item-desc">${this.getModelDescription(model)}</div>
                        </div>
                        ${model.id === this.currentModel ? `<i data-lucide="check" class="w-4 h-4 text-accent"></i>` : ''}
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
            { category: 'Actions', icon: 'image', title: 'Generate Image', description: 'Open image generation panel', action: 'open-image-modal' },
            { category: 'Actions', icon: 'search', title: 'Search Messages', description: 'Search in current conversation', action: 'search', shortcut: 'Ctrl+F' },
            { category: 'Model', icon: 'cpu', title: 'Change Model', description: 'Select a different AI model', action: 'open-model-selector' },
            { category: 'Navigation', icon: 'sidebar', title: 'Toggle Sidebar', description: 'Show or hide the sidebar', action: 'toggle-sidebar', shortcut: 'Ctrl+B' },
            { category: 'View', icon: 'sun', title: 'Toggle Theme', description: 'Switch between light and dark mode', action: 'toggle-theme' },
            ...(hasMessages ? [
                { category: 'Export', icon: 'download', title: 'Export as Markdown', description: 'Download conversation as .md file', action: 'export-md' },
                { category: 'Export', icon: 'download', title: 'Export as JSON', description: 'Download conversation as .json file', action: 'export-json' },
                { category: 'Export', icon: 'download', title: 'Export as Text', description: 'Download conversation as .txt file', action: 'export-txt' },
            ] : []),
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
            case 'clear-messages':
                window.chatApp?.clearCurrentSession();
                break;
            case 'delete-session':
                if (sessionManager.currentSessionId) {
                    this.confirmDeleteSession(sessionManager.currentSessionId);
                }
                break;
            case 'open-image-modal':
                this.openImageModal();
                break;
            case 'open-model-selector':
                this.openModelSelector();
                break;
        }
    }

    // ============================================
    // Export Modal
    // ============================================

    openExportModal() {
        if (!sessionManager.currentSessionId) {
            this.showToast('No active conversation to export', 'warning');
            return;
        }
        
        const modal = document.getElementById('export-modal');
        modal.classList.remove('hidden');
    }

    closeExportModal() {
        const modal = document.getElementById('export-modal');
        modal.classList.add('hidden');
    }

    // ============================================
    // Toast Notifications
    // ============================================

    showToast(message, type = 'info', title = '') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icons = {
            success: 'check-circle',
            error: 'x-circle',
            warning: 'alert-triangle',
            info: 'info'
        };

        const icon = icons[type] || icons.info;

        toast.innerHTML = `
            <div class="toast-icon">
                <i data-lucide="${icon}" class="w-5 h-5"></i>
            </div>
            <div class="toast-content">
                ${title ? `<div class="toast-title">${title}</div>` : ''}
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close" aria-label="Close notification">
                <i data-lucide="x" class="w-4 h-4"></i>
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
    }

    hideTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        indicator.classList.add('hidden');
    }

    // ============================================
    // Mobile Sidebar
    // ============================================

    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        
        sidebar.classList.toggle('open');
        overlay.classList.toggle('hidden');
    }

    closeSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        
        sidebar.classList.remove('open');
        overlay.classList.add('hidden');
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

        // Close modals on escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeImageModal();
                this.closeImageLightbox();
                this.closeModelSelector();
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

    generateMessageId() {
        return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
}

// Create global UI helpers instance
const uiHelpers = new UIHelpers();
