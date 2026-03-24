/**
 * Main Application for LillyBuilt AI Chat
 * Orchestrates all components and handles user interactions
 * Now using OpenAI SDK for API communication
 */

class ChatApp {
    constructor() {
        this.messageInput = document.getElementById('message-input');
        this.sendBtn = document.getElementById('send-btn');
        this.messagesContainer = document.getElementById('messages-container');
        this.charCounter = document.getElementById('char-counter');
        this.currentSessionInfo = document.getElementById('current-session-info');
        this.typingIndicator = document.getElementById('typing-indicator');
        
        this.isProcessing = false;
        this.currentStreamingMessageId = null;
        this.autoResize = null;
        this.searchResults = [];
        this.currentSearchIndex = -1;
        
        // Track if we're generating an image
        this.isGeneratingImage = false;
        this.currentImageMessageId = null;
        
        // Track retry state
        this.retryAttempt = 0;
        this.maxRetries = 3;
        
        // Abort controller for current stream
        this.currentAbortController = null;
        
        this.init();
    }

    async init() {
        // Add preload class to prevent transitions on load
        document.body.classList.add('preload');
        
        // Initialize theme
        uiHelpers.initTheme();
        
        // Initialize auto-resize textarea
        this.autoResize = uiHelpers.initAutoResize(this.messageInput);
        
        // Setup event listeners
        this.setupEventListeners();
        this.setupSessionListeners();
        this.setupKeyboardShortcuts();
        this.setupModelListeners();
        
        // Check connection status
        this.updateConnectionStatus('checking');
        const health = await apiClient.checkHealth();
        this.updateConnectionStatus(health.connected ? 'connected' : 'disconnected');
        
        // Start periodic health checks
        this.startHealthCheckInterval();
        
        // Load models in background
        uiHelpers.loadModels();
        
        // Load sessions
        await this.loadSessions();
        
        // Initialize Lucide icons
        uiHelpers.reinitializeIcons();
        
        // Restore input area state (hidden/shown)
        uiHelpers.restoreInputAreaState();
        
        // Focus input
        this.messageInput?.focus();
        
        // Remove preload class after a short delay
        setTimeout(() => {
            document.body.classList.remove('preload');
        }, 100);
        
        // Setup online/offline listeners
        this.setupConnectivityListeners();
    }

    // ============================================
    // Event Listeners
    // ============================================

    setupEventListeners() {
        // Send button
        this.sendBtn?.addEventListener('click', () => this.sendMessage());
        
        // Input handling
        this.messageInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // Handle slash commands in input
        this.messageInput?.addEventListener('input', () => {
            this.updateSendButton();
            uiHelpers.updateCharCounter(this.messageInput, this.charCounter);
            
            // Check for slash commands
            const value = this.messageInput.value.trim();
            if (value.startsWith('/')) {
                this.handleInputSlashCommand(value);
            }
        });
        
        // New chat button
        document.getElementById('new-chat-btn')?.addEventListener('click', () => {
            this.createNewSession();
        });
        
        // Clear chat button
        document.getElementById('clear-chat-btn')?.addEventListener('click', () => {
            this.clearCurrentSession();
        });
        
        // Theme toggle
        document.getElementById('theme-toggle')?.addEventListener('click', () => {
            uiHelpers.toggleTheme();
        });
        
        // Mobile sidebar toggle
        document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
            uiHelpers.toggleSidebar();
        });
        
        document.getElementById('sidebar-overlay')?.addEventListener('click', () => {
            uiHelpers.closeSidebar();
        });
        
        // Window resize
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) {
                uiHelpers.closeSidebar();
            }
        });
        
        // Handle regenerate event
        window.addEventListener('regenerateMessage', (e) => {
            this.regenerateResponse(e.detail.messageId);
        });
        
        // Handle model change event
        window.addEventListener('modelChanged', (e) => {
            console.log('Model changed to:', e.detail.modelId);
        });
        
        // Handle visibility change for resuming
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.checkConnection();
            }
        });
    }

    handleInputSlashCommand(value) {
        // Could implement inline command suggestions here
        // For now, commands are handled via the command palette
    }

    setupSessionListeners() {
        // Session events
        sessionManager.addEventListener('sessionsChanged', (e) => {
            uiHelpers.renderSessionsList(e.detail.sessions, sessionManager.currentSessionId);
        });
        
        sessionManager.addEventListener('sessionCreated', (e) => {
            uiHelpers.renderSessionsList(sessionManager.sessions, sessionManager.currentSessionId);
            this.loadSessionMessages(e.detail.session.id);
            this.updateSessionInfo();
        });
        
        sessionManager.addEventListener('sessionSwitched', (e) => {
            this.renderMessages(e.detail.messages);
            this.updateSessionInfo();
            uiHelpers.closeSidebar();
        });
        
        sessionManager.addEventListener('sessionDeleted', (e) => {
            if (e.detail.newCurrentSessionId) {
                this.loadSessionMessages(e.detail.newCurrentSessionId);
            } else {
                uiHelpers.clearMessages();
                uiHelpers.showWelcomeMessage();
            }
            this.updateSessionInfo();
        });
        
        sessionManager.addEventListener('messagesCleared', () => {
            uiHelpers.clearMessages();
            uiHelpers.showWelcomeMessage();
        });
    }

    setupModelListeners() {
        // Listen for model changes from UI
        // This is handled by the modelChanged event dispatched in ui.js
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Command palette: Ctrl+K or Cmd+K
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                if (document.getElementById('command-palette').classList.contains('hidden')) {
                    uiHelpers.openCommandPalette();
                } else {
                    uiHelpers.closeCommandPalette();
                }
            }
            
            // Image generation: Ctrl+I or Cmd+I (handled in ui.js)
            
            // Search: Ctrl+F or Cmd+F
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                if (!sessionManager.currentSessionId) {
                    uiHelpers.showToast('Open a conversation first', 'info');
                    return;
                }
                uiHelpers.openSearch();
            }
            
            // New chat: Ctrl+N or Cmd+N
            if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
                e.preventDefault();
                this.createNewSession();
            }
            
            // Toggle sidebar: Ctrl+B or Cmd+B
            if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
                e.preventDefault();
                uiHelpers.toggleSidebar();
            }
            
            // Toggle input area: Ctrl+Shift+H
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'H') {
                e.preventDefault();
                uiHelpers.toggleInputArea();
            }
            
            // Escape handling with priority: Modal > Command Palette > Search > Streaming
            if (e.key === 'Escape') {
                this.handleEscapeKey();
            }
        });
    }
    
    /**
     * Handle Escape key with proper priority:
     * 1. Close any open modal
     * 2. Close command palette
     * 3. Close search
     * 4. Cancel streaming
     */
    handleEscapeKey() {
        // Priority 1: Check for any open modals (export, import, image, shortcuts)
        const openModals = document.querySelectorAll('.modal:not(.hidden)');
        if (openModals.length > 0) {
            // Close the last opened modal
            const lastModal = openModals[openModals.length - 1];
            const modalId = lastModal.id;
            
            if (modalId === 'export-modal') {
                uiHelpers.closeExportModal();
            } else if (modalId === 'import-modal') {
                uiHelpers.closeImportModal();
            } else if (modalId === 'image-modal') {
                uiHelpers.closeImageModal();
            } else if (modalId === 'shortcuts-modal') {
                uiHelpers.closeShortcutsModal();
            } else if (modalId === 'image-lightbox') {
                uiHelpers.closeImageLightbox();
            } else {
                // Generic modal close
                lastModal.classList.add('hidden');
                lastModal.setAttribute('aria-hidden', 'true');
            }
            return;
        }
        
        // Priority 2: Check for model selector dropdown
        const modelDropdown = document.getElementById('model-selector-dropdown');
        if (modelDropdown && !modelDropdown.classList.contains('hidden')) {
            uiHelpers.closeModelSelector();
            return;
        }
        
        // Priority 3: Check for command palette
        const commandPalette = document.getElementById('command-palette');
        if (commandPalette && !commandPalette.classList.contains('hidden')) {
            uiHelpers.closeCommandPalette();
            return;
        }
        
        // Priority 4: Check for search
        const searchBar = document.getElementById('search-bar');
        if (searchBar && !searchBar.classList.contains('hidden')) {
            this.closeSearch();
            return;
        }
        
        // Priority 5: Cancel current streaming if active
        if (this.isProcessing && this.currentAbortController) {
            this.cancelCurrentRequest();
        }
    }

    setupConnectivityListeners() {
        window.addEventListener('online', () => {
            console.log('Browser went online');
            this.checkConnection();
        });
        
        window.addEventListener('offline', () => {
            console.log('Browser went offline');
            this.updateConnectionStatus('disconnected');
            uiHelpers.showToast('You are offline', 'warning');
        });
    }

    // ============================================
    // Session Management
    // ============================================

    async loadSessions() {
        try {
            await sessionManager.loadSessions();
            
            // If we have a current session, load its messages
            if (sessionManager.currentSessionId) {
                this.loadSessionMessages(sessionManager.currentSessionId);
            }
            
            this.updateSessionInfo();
        } catch (error) {
            console.error('Failed to load sessions:', error);
            // Show empty state
            uiHelpers.renderSessionsList([], null);
        }
    }

    async createNewSession() {
        try {
            await sessionManager.createSession('chat');
            uiHelpers.hideWelcomeMessage();
            uiHelpers.clearMessages();
            this.messageInput?.focus();
            uiHelpers.showToast('New conversation started', 'success');
        } catch (error) {
            uiHelpers.showToast('Failed to create new session', 'error');
        }
    }

    loadSessionMessages(sessionId) {
        const messages = sessionManager.getMessages(sessionId);
        this.renderMessages(messages);
    }

    renderMessages(messages) {
        uiHelpers.clearMessages();
        
        if (messages.length === 0) {
            uiHelpers.showWelcomeMessage();
            return;
        }
        
        uiHelpers.hideWelcomeMessage();
        
        // Use requestAnimationFrame for smoother rendering of many messages
        const renderBatch = (index) => {
            const batchSize = 10;
            const end = Math.min(index + batchSize, messages.length);
            
            for (let i = index; i < end; i++) {
                const messageEl = uiHelpers.renderMessage(messages[i]);
                this.messagesContainer.appendChild(messageEl);
            }
            
            if (end < messages.length) {
                requestAnimationFrame(() => renderBatch(end));
            } else {
                uiHelpers.reinitializeIcons(this.messagesContainer);
                uiHelpers.highlightCodeBlocks(this.messagesContainer);
                uiHelpers.scrollToBottom(false);
            }
        };
        
        renderBatch(0);
    }

    clearCurrentSession() {
        if (!sessionManager.currentSessionId) return;
        
        if (confirm('Clear all messages in this conversation? This cannot be undone.')) {
            sessionManager.clearSessionMessages(sessionManager.currentSessionId);
            uiHelpers.showToast('Messages cleared', 'success');
        }
    }

    updateSessionInfo() {
        const session = sessionManager.getCurrentSession();
        if (session) {
            const messageCount = sessionManager.getMessages(session.id)?.length || 0;
            this.currentSessionInfo.innerHTML = `
                ${sessionManager.getSessionModeLabel(session.mode)} • 
                ${sessionManager.formatTimestamp(session.updatedAt)} • 
                ${messageCount} message${messageCount !== 1 ? 's' : ''}
            `;
        } else {
            this.currentSessionInfo.textContent = 'No active session';
        }
    }

    // ============================================
    // Message Handling
    // ============================================

    async sendMessage() {
        const content = this.messageInput.value.trim();
        
        if (!content || this.isProcessing) return;

        if (await this.tryHandleToolCommand(content)) {
            this.messageInput.value = '';
            this.autoResize?.reset?.();
            this.updateSendButton();
            uiHelpers.updateCharCounter(this.messageInput, this.charCounter);
            return;
        }
        
        // Handle slash commands
        if (content.startsWith('/')) {
            this.executeSlashCommand(content);
            this.messageInput.value = '';
            this.autoResize?.reset?.();
            this.updateSendButton();
            return;
        }
        
        // Check if we need to create a session
        if (!sessionManager.currentSessionId) {
            await this.createNewSession();
        }
        
        const sessionId = sessionManager.currentSessionId;
        
        // Hide welcome message
        uiHelpers.hideWelcomeMessage();
        
        // Add user message
        const userMessage = {
            role: 'user',
            content: content,
            timestamp: new Date().toISOString()
        };
        
        sessionManager.addMessage(sessionId, userMessage);
        
        const userMessageEl = uiHelpers.renderMessage(userMessage);
        this.messagesContainer.appendChild(userMessageEl);
        uiHelpers.scrollToBottom();
        
        // Clear input
        this.messageInput.value = '';
        this.autoResize?.reset?.();
        this.updateSendButton();
        uiHelpers.updateCharCounter(this.messageInput, this.charCounter);
        
        // Show typing indicator
        this.isProcessing = true;
        this.updateSendButton();
        uiHelpers.showTypingIndicator();
        
        // Get current model
        const model = uiHelpers.getCurrentModel();
        
        // Create placeholder for assistant response
        const assistantMessage = {
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            isStreaming: true,
            model: model // Track which model generated this response
        };
        
        this.currentStreamingMessageId = uiHelpers.generateMessageId();
        assistantMessage.id = this.currentStreamingMessageId;
        
        sessionManager.addMessage(sessionId, assistantMessage);
        
        // Delay showing the assistant message slightly for better UX
        setTimeout(() => {
            const assistantMessageEl = uiHelpers.renderMessage(assistantMessage, true);
            this.messagesContainer.appendChild(assistantMessageEl);
            uiHelpers.reinitializeIcons(assistantMessageEl);
            uiHelpers.scrollToBottom();
        }, 300);
        
        // Build message history for OpenAI API format
        const messages = this.buildMessageHistory(sessionId);
        
        // Create abort controller for this request
        this.currentAbortController = new AbortController();
        
        // Send to API using OpenAI SDK
        try {
            // Update API client session ID
            apiClient.setSessionId(sessionId);
            
            let hasReceivedContent = false;
            let retryCount = 0;
            
            // Stream the chat
            for await (const chunk of apiClient.streamChat(messages, model, this.currentAbortController.signal)) {
                if (chunk.sessionId) {
                    this.syncBackendSession(chunk.sessionId);
                }

                switch (chunk.type) {
                    case 'delta':
                        hasReceivedContent = true;
                        this.retryAttempt = 0; // Reset retry count on successful content
                        this.handleDelta(chunk.content);
                        break;
                    case 'done':
                        this.handleDone(chunk);
                        break;
                    case 'error':
                        if (chunk.cancelled) {
                            this.handleCancelled();
                        } else {
                            // Show retry notification if retries were attempted
                            if (chunk.retriesExhausted) {
                                uiHelpers.showToast('Failed after multiple retries. Please try again.', 'error');
                            }
                            this.handleError(chunk.error, chunk.status);
                        }
                        break;
                    case 'retry':
                        retryCount = chunk.attempt;
                        if (retryCount > 1) {
                            uiHelpers.showToast(`Retrying... (attempt ${chunk.attempt}/${chunk.maxAttempts})`, 'info');
                        }
                        break;
                }
            }
        } catch (error) {
            console.error('Chat error:', error);
            this.handleError(error.message || 'Failed to get response');
        } finally {
            this.currentAbortController = null;
        }
    }

    async tryHandleToolCommand(content) {
        const trimmed = String(content || '').trim();
        const isListCommand = trimmed === '/tools' || trimmed.startsWith('/tools ');
        const isInvokeCommand = trimmed.startsWith('/tool ');
        const isHelpCommand = trimmed.startsWith('/tool-help ');

        if (!isListCommand && !isInvokeCommand && !isHelpCommand) {
            return false;
        }

        if (!sessionManager.currentSessionId) {
            await this.createNewSession();
        }

        const sessionId = sessionManager.currentSessionId;
        uiHelpers.hideWelcomeMessage();

        const userMessage = {
            role: 'user',
            content: trimmed,
            timestamp: new Date().toISOString(),
        };
        sessionManager.addMessage(sessionId, userMessage);
        this.messagesContainer.appendChild(uiHelpers.renderMessage(userMessage));

        try {
            let assistantContent = '';

            if (isListCommand) {
                const category = trimmed.startsWith('/tools ') ? trimmed.slice('/tools '.length).trim() : null;
                const toolResponse = await apiClient.getAvailableTools(category || null);
                assistantContent = this.formatToolsList(toolResponse, category);
            } else if (isHelpCommand) {
                const toolId = trimmed.slice('/tool-help '.length).trim();
                if (!toolId) {
                    throw new Error('Usage: /tool-help <id>');
                }
                const doc = await apiClient.getToolDoc(toolId);
                assistantContent = `## Tool Help: \`${toolId}\`\n\nSupport: \`${doc?.support?.status || 'unknown'}\`\n\n${doc?.content || 'No documentation found.'}`;
            } else {
                const match = trimmed.match(/^\/tool\s+([^\s]+)(?:\s+([\s\S]+))?$/i);
                if (!match) {
                    throw new Error('Usage: /tool <id> {"key":"value"}');
                }

                const toolId = match[1];
                const rawParams = (match[2] || '').trim();
                let params = {};

                if (rawParams) {
                    params = JSON.parse(rawParams);
                }

                const invocation = await apiClient.invokeTool(toolId, params);
                if (invocation?.sessionId) {
                    this.syncBackendSession(invocation.sessionId);
                }
                assistantContent = `## Tool Result: \`${toolId}\`\n\n\`\`\`json\n${JSON.stringify(invocation?.result, null, 2)}\n\`\`\``;
            }

            const assistantMessage = {
                role: 'assistant',
                content: assistantContent,
                timestamp: new Date().toISOString(),
            };
            sessionManager.addMessage(sessionId, assistantMessage);
            this.messagesContainer.appendChild(uiHelpers.renderMessage(assistantMessage));
            uiHelpers.reinitializeIcons(this.messagesContainer);
            uiHelpers.scrollToBottom();
            this.updateSessionInfo();
            return true;
        } catch (error) {
            const assistantMessage = {
                role: 'assistant',
                content: `**Tool error:** ${error.message}`,
                timestamp: new Date().toISOString(),
            };
            sessionManager.addMessage(sessionId, assistantMessage);
            this.messagesContainer.appendChild(uiHelpers.renderMessage(assistantMessage));
            uiHelpers.scrollToBottom();
            this.updateSessionInfo();
            return true;
        }
    }

    formatToolsList(toolResponse, category = null) {
        const tools = Array.isArray(toolResponse) ? toolResponse : (toolResponse?.tools || []);
        const runtime = toolResponse?.meta?.runtime || null;

        if (!Array.isArray(tools) || tools.length === 0) {
            return category
                ? `No frontend tools are available in category \`${category}\`.`
                : 'No frontend tools are currently available.';
        }

        const lines = ['## Available Tools', ''];
        if (runtime) {
            const gatewayScope = runtime.modelGateway?.internalCluster ? 'internal cluster' : 'external endpoint';
            lines.push(`Runtime source: \`${runtime.source || 'backend'}\``);
            lines.push(`Model gateway: \`${runtime.modelGateway?.baseURL || 'unknown'}\` (${gatewayScope})`);
            if (runtime.sshDefaults?.enabled) {
                const target = runtime.sshDefaults.host
                    ? `${runtime.sshDefaults.username || 'unknown'}@${runtime.sshDefaults.host}:${runtime.sshDefaults.port || 22}`
                    : 'not set';
                lines.push(`SSH defaults: source=${runtime.sshDefaults.source || 'unknown'}, target=${target}, configured=${runtime.sshDefaults.configured ? 'yes' : 'no'}`);
            } else {
                lines.push('SSH defaults: disabled');
            }
            lines.push('');
        }

        tools.forEach((tool) => {
            const params = Array.isArray(tool.parameters)
                ? tool.parameters.map((param) => typeof param === 'string' ? param : param.name).filter(Boolean)
                : Object.keys(tool.inputSchema?.properties || {});
            lines.push(`- \`${tool.id}\` (${tool.category})`);
            lines.push(`  ${tool.description || 'No description provided.'}`);
            if (tool.support?.status) {
                lines.push(`  Support: ${tool.support.status}`);
            }
            if (tool.runtime?.defaultTarget) {
                lines.push(`  Runtime: ${tool.runtime.defaultTarget} via ${tool.runtime.source || 'unknown'}`);
            } else if (tool.runtime && Object.prototype.hasOwnProperty.call(tool.runtime, 'configured')) {
                lines.push(`  Runtime: configured=${tool.runtime.configured ? 'yes' : 'no'}`);
            }
            if (params.length) {
                lines.push(`  Params: ${params.join(', ')}`);
            }
        });
        lines.push('');
        lines.push('Usage: `/tool <id> {"key":"value"}`');
        lines.push('Help: `/tool-help <id>`');
        return lines.join('\n');
    }

    /**
     * Cancel the current streaming request
     */
    cancelCurrentRequest() {
        if (this.currentAbortController) {
            this.currentAbortController.abort();
            this.currentAbortController = null;
            uiHelpers.showToast('Request cancelled', 'info');
        }
    }

    /**
     * Build message history in OpenAI format from session messages
     */
    buildMessageHistory(sessionId) {
        const messages = sessionManager.getMessages(sessionId);
        if (!messages || messages.length === 0) return [];
        
        // Convert to OpenAI format: [{role, content}, ...]
        return messages
            .filter(m => (m.role === 'user' || m.role === 'assistant') && !m.isStreaming && String(m.content || '').trim())
            .map(m => ({
                role: m.role,
                content: m.content || ''
            }));
    }

    executeSlashCommand(command) {
        const parts = command.slice(1).split(' ');
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1).join(' ');
        
        switch (cmd) {
            case 'model':
                if (args) {
                    // Try to find and select the model
                    uiHelpers.selectModel(args);
                } else {
                    uiHelpers.openModelSelector();
                }
                break;
            case 'models':
                uiHelpers.openModelSelector();
                break;
            case 'image':
                this.handleImageCommand(args);
                break;
            case 'unsplash':
                if (args) {
                    this.searchUnsplashImages(args.trim());
                } else {
                    uiHelpers.showToast('Please provide a search query. Example: /unsplash sunset', 'warning');
                }
                break;
            case 'clear':
                this.clearCurrentSession();
                break;
            case 'new':
                this.createNewSession();
                break;
            case 'help':
                uiHelpers.openShortcutsModal();
                break;
            default:
                uiHelpers.showToast(`Unknown command: /${cmd}. Try /help for available commands.`, 'warning');
        }
    }

    /**
     * Handle the /image command with optional --unsplash flag
     * Examples:
     *   /image a beautiful sunset - opens modal with prompt
     *   /image --unsplash sunset - searches Unsplash directly
     */
    handleImageCommand(args) {
        if (!args) {
            uiHelpers.openImageModal();
            return;
        }

        // Check for --unsplash flag
        const unsplashMatch = args.match(/^--unsplash\s+(.+)$/i);
        if (unsplashMatch) {
            const query = unsplashMatch[1].trim();
            this.searchUnsplashImages(query);
            return;
        }

        // Regular image generation - open modal with prompt pre-filled
        const input = document.getElementById('image-prompt-input');
        if (input) input.value = args;
        uiHelpers.openImageModal();
    }

    /**
     * Search for images on Unsplash and display results
     * @param {string} query - Search query
     */
    async searchUnsplashImages(query) {
        if (!query) {
            uiHelpers.showToast('Please provide a search query', 'warning');
            return;
        }

        // Check if we need to create a session
        if (!sessionManager.currentSessionId) {
            await this.createNewSession();
        }
        
        const sessionId = sessionManager.currentSessionId;
        
        // Hide welcome message
        uiHelpers.hideWelcomeMessage();
        
        // Add user message with the search query
        const userMessage = {
            role: 'user',
            content: `/unsplash ${query}`,
            timestamp: new Date().toISOString()
        };
        
        sessionManager.addMessage(sessionId, userMessage);
        
        const userMessageEl = uiHelpers.renderMessage(userMessage);
        this.messagesContainer.appendChild(userMessageEl);
        uiHelpers.scrollToBottom();
        
        // Create placeholder for search results
        const searchMessageId = uiHelpers.generateMessageId();
        this.currentImageMessageId = searchMessageId;
        
        const searchMessage = {
            id: searchMessageId,
            role: 'assistant',
            type: 'unsplash-search',
            content: `Unsplash options for "${query}"`,
            query: query,
            isLoading: true,
            loadingText: 'Searching Unsplash...',
            currentPage: 1,
            perPage: 9,
            timestamp: new Date().toISOString()
        };
        
        sessionManager.addMessage(sessionId, searchMessage);
        
        const searchMessageEl = uiHelpers.renderUnsplashSearchMessage(searchMessage);
        this.messagesContainer.appendChild(searchMessageEl);
        uiHelpers.reinitializeIcons(searchMessageEl);
        uiHelpers.scrollToBottom();
        
        this.isGeneratingImage = true;
        
        try {
            // Call the Unsplash search API
            const result = await apiClient.searchUnsplash(query, { page: 1, perPage: 9 });
            const totalPages = result.totalPages || result.total_pages || 1;
            const nextMessage = this.upsertSessionMessage(sessionId, {
                id: searchMessageId,
                role: 'assistant',
                type: 'unsplash-search',
                content: `Unsplash options for "${result.query || query}"`,
                query: result.query || query,
                isLoading: false,
                results: Array.isArray(result.results) ? result.results : [],
                total: result.total || 0,
                totalPages,
                currentPage: 1,
                perPage: 9,
                timestamp: new Date().toISOString()
            });

            this.renderOrReplaceMessage(nextMessage || searchMessage);
            
            uiHelpers.showToast(`Found ${(result.results || []).length} images on Unsplash`, 'success');
            
        } catch (error) {
            console.error('Unsplash search failed:', error);
            
            const failedMessage = this.upsertSessionMessage(sessionId, {
                id: searchMessageId,
                role: 'assistant',
                type: 'unsplash-search',
                content: `Unsplash options for "${query}"`,
                query,
                isLoading: false,
                currentPage: 1,
                perPage: 9,
                error: error.message || 'Failed to search Unsplash',
                timestamp: new Date().toISOString()
            });

            this.renderOrReplaceMessage(failedMessage || searchMessage);
            
            uiHelpers.showToast(error.message || 'Failed to search Unsplash', 'error');
        } finally {
            this.isGeneratingImage = false;
            this.currentImageMessageId = null;
            this.updateSessionInfo();
            uiHelpers.renderSessionsList(sessionManager.sessions, sessionManager.currentSessionId);
        }
    }

    /**
     * Select an Unsplash image and add it to the chat
     * @param {string} messageId - The message ID containing the search results
     * @param {Object} image - The selected image data
     */
    async selectUnsplashImage(messageId, imageOrIndex) {
        const sessionId = sessionManager.currentSessionId;
        if (!sessionId) return;

        const image = typeof imageOrIndex === 'number'
            ? this.getSelectionItem(messageId, imageOrIndex)
            : imageOrIndex;
        if (!image) return;
        
        // Create a new message with the selected image
        const imageMessageId = uiHelpers.generateMessageId();
        
        const imageMessage = {
            id: imageMessageId,
            role: 'assistant',
            type: 'image',
            imageUrl: image.urls.regular,
            thumbnailUrl: image.urls.small,
            prompt: image.description || image.altDescription || 'Unsplash image',
            source: 'unsplash',
            author: image.author,
            unsplashLink: image.links.html,
            timestamp: new Date().toISOString()
        };
        
        sessionManager.addMessage(sessionId, imageMessage);
        
        const imageMessageEl = uiHelpers.renderImageMessage(imageMessage);
        this.messagesContainer.appendChild(imageMessageEl);
        uiHelpers.reinitializeIcons(imageMessageEl);
        uiHelpers.scrollToBottom();
        
        uiHelpers.showToast('Image added to conversation', 'success');
        this.updateSessionInfo();
        uiHelpers.renderSessionsList(sessionManager.sessions, sessionManager.currentSessionId);
    }

    selectGeneratedImage(messageId, index) {
        const sessionId = sessionManager.currentSessionId;
        if (!sessionId) return;

        const message = this.getSessionMessage(sessionId, messageId);
        const image = this.getSelectionItem(messageId, index);
        if (!message || !image?.imageUrl) return;

        const sourceKind = image.source || message.sourceKind || 'generated';
        const isArtifact = sourceKind === 'artifact';

        const imageMessage = {
            id: uiHelpers.generateMessageId(),
            role: 'assistant',
            type: 'image',
            imageUrl: image.imageUrl,
            thumbnailUrl: image.thumbnailUrl || image.imageUrl,
            prompt: image.alt || image.prompt || message.prompt || (isArtifact ? 'Captured image' : 'Generated image'),
            revisedPrompt: image.revisedPrompt || '',
            model: isArtifact ? '' : (image.model || message.model || ''),
            source: isArtifact ? 'artifact' : 'generated',
            downloadUrl: image.downloadUrl || '',
            artifactId: image.artifactId || '',
            filename: image.filename || '',
            sourceHost: image.sourceHost || message.sourceHost || '',
            timestamp: new Date().toISOString()
        };

        sessionManager.addMessage(sessionId, imageMessage);
        this.messagesContainer.appendChild(uiHelpers.renderImageMessage(imageMessage));
        uiHelpers.reinitializeIcons(this.messagesContainer.lastElementChild);
        uiHelpers.scrollToBottom();

        uiHelpers.showToast('Image added to conversation', 'success');
        this.updateSessionInfo();
        uiHelpers.renderSessionsList(sessionManager.sessions, sessionManager.currentSessionId);
    }

    async loadUnsplashPage(messageId, page) {
        const sessionId = sessionManager.currentSessionId;
        if (!sessionId || !Number.isFinite(page) || page < 1) return;

        const currentMessage = this.getSessionMessage(sessionId, messageId);
        if (!currentMessage?.query) return;

        const perPage = currentMessage.perPage || 9;
        const totalPages = currentMessage.totalPages || 1;
        if (page > totalPages) return;

        const loadingMessage = this.upsertSessionMessage(sessionId, {
            id: messageId,
            isLoading: true,
            loadingText: `Loading page ${page}...`,
            error: null,
            currentPage: page,
            timestamp: new Date().toISOString()
        });
        this.renderOrReplaceMessage(loadingMessage || currentMessage);

        try {
            const result = await apiClient.searchUnsplash(currentMessage.query, {
                page,
                perPage,
                orientation: currentMessage.orientation || null,
            });

            const nextMessage = this.upsertSessionMessage(sessionId, {
                id: messageId,
                role: 'assistant',
                type: 'unsplash-search',
                content: `Unsplash options for "${result.query || currentMessage.query}"`,
                query: result.query || currentMessage.query,
                isLoading: false,
                results: Array.isArray(result.results) ? result.results : [],
                total: result.total || 0,
                totalPages: result.totalPages || result.total_pages || totalPages,
                currentPage: page,
                perPage,
                orientation: currentMessage.orientation || null,
                error: null,
                timestamp: new Date().toISOString()
            });

            this.renderOrReplaceMessage(nextMessage || currentMessage);
        } catch (error) {
            const failedMessage = this.upsertSessionMessage(sessionId, {
                id: messageId,
                isLoading: false,
                currentPage: currentMessage.currentPage || 1,
                error: error.message || 'Failed to load Unsplash results',
                timestamp: new Date().toISOString()
            });
            this.renderOrReplaceMessage(failedMessage || currentMessage);
            uiHelpers.showToast(error.message || 'Failed to load Unsplash results', 'error');
        }
    }

    useSearchResult(messageId, index) {
        const result = this.getSelectionItem(messageId, index);
        if (!result?.url) return;

        this.setInput(`Use this page as a source for the next answer:\n${result.url}`);
        uiHelpers.showToast('Page added to the input', 'success');
    }

    openSearchResult(messageId, index) {
        const result = this.getSelectionItem(messageId, index);
        if (!result?.url) return;

        window.open(result.url, '_blank', 'noopener,noreferrer');
    }

    getSessionMessage(sessionId, messageId) {
        if (!sessionId || !messageId) {
            return null;
        }

        if (typeof sessionManager.getMessage === 'function') {
            return sessionManager.getMessage(sessionId, messageId);
        }

        return sessionManager.getMessages(sessionId).find((message) => message.id === messageId) || null;
    }

    getSelectionItem(messageId, index, key = 'results') {
        if (!Number.isInteger(index)) {
            return null;
        }

        const sessionId = sessionManager.currentSessionId;
        const message = this.getSessionMessage(sessionId, messageId);
        const items = Array.isArray(message?.[key]) ? message[key] : [];
        return items[index] || null;
    }

    upsertSessionMessage(sessionId, message) {
        if (typeof sessionManager.upsertMessage === 'function') {
            return sessionManager.upsertMessage(sessionId, message);
        }

        const messages = sessionManager.getMessages(sessionId);
        const index = message?.id
            ? messages.findIndex((entry) => entry.id === message.id)
            : -1;

        if (index === -1) {
            return sessionManager.addMessage(sessionId, message);
        }

        messages[index] = {
            ...messages[index],
            ...message,
        };
        sessionManager.saveToStorage();
        return messages[index];
    }

    renderOrReplaceMessage(message) {
        if (!message?.id) {
            return null;
        }

        const nextEl = uiHelpers.renderMessage(message);
        const existingEl = document.getElementById(message.id);

        if (existingEl) {
            existingEl.replaceWith(nextEl);
        } else {
            this.messagesContainer.appendChild(nextEl);
        }

        uiHelpers.reinitializeIcons(nextEl);
        return nextEl;
    }

    parseToolArguments(rawArgs) {
        if (!rawArgs) {
            return {};
        }

        if (typeof rawArgs === 'object') {
            return rawArgs;
        }

        if (typeof rawArgs !== 'string') {
            return {};
        }

        try {
            return JSON.parse(rawArgs);
        } catch (_error) {
            return {};
        }
    }

    buildArtifactUrl(path, { inline = false } = {}) {
        const normalizedPath = typeof path === 'string' ? path.trim() : '';
        if (!normalizedPath) {
            return '';
        }

        try {
            const url = new URL(normalizedPath, window.location.origin);
            if (inline) {
                url.searchParams.set('inline', '1');
            }
            return url.toString();
        } catch (_error) {
            return '';
        }
    }

    extractHostLabel(value = '') {
        try {
            return new URL(String(value || '').trim()).hostname.replace(/^www\./i, '');
        } catch (_error) {
            return '';
        }
    }

    normalizeUnsplashResult(image) {
        if (!image || typeof image !== 'object') {
            return null;
        }

        const urls = image.urls || {};
        const regular = urls.regular || image.url || urls.full || urls.small || image.thumbUrl || '';
        const small = urls.small || image.thumbUrl || regular;
        if (!regular && !small) {
            return null;
        }

        const authorName = image.author?.name || image.author || '';
        const authorLink = image.author?.link || image.authorLink || '';
        const unsplashLink = image.links?.html || image.unsplashLink || '';
        const description = image.description || image.altDescription || image.alt || '';

        return {
            id: image.id || `unsplash-${Math.random().toString(36).slice(2, 10)}`,
            description,
            altDescription: description,
            urls: {
                small,
                regular,
            },
            author: {
                name: authorName,
                link: authorLink || unsplashLink,
            },
            links: {
                html: unsplashLink,
            },
        };
    }

    normalizeGeneratedImage(image, fallbackPrompt = '', fallbackModel = '') {
        if (!image || typeof image !== 'object') {
            return null;
        }

        let imageUrl = image.url || '';
        if (!imageUrl && typeof image.b64_json === 'string' && !/\[truncated \d+ chars\]/.test(image.b64_json)) {
            imageUrl = `data:image/png;base64,${image.b64_json}`;
        }

        if (!imageUrl) {
            return null;
        }

        return {
            imageUrl,
            thumbnailUrl: image.thumbnailUrl || imageUrl,
            alt: image.alt || image.revisedPrompt || fallbackPrompt || 'Generated image',
            revisedPrompt: image.revisedPrompt || image.revised_prompt || '',
            prompt: fallbackPrompt,
            model: image.model || fallbackModel || '',
            source: 'generated',
        };
    }

    normalizeArtifactImage(image, fallbackPrompt = '', fallbackHost = '') {
        if (!image || typeof image !== 'object') {
            return null;
        }

        const downloadUrl = this.buildArtifactUrl(image.downloadPath || image.downloadUrl || '');
        const inlineUrl = this.buildArtifactUrl(
            image.inlinePath || image.downloadPath || image.downloadUrl || '',
            { inline: true },
        );

        if (!downloadUrl || !inlineUrl) {
            return null;
        }

        const sourceHost = image.sourceHost || fallbackHost || '';
        const filename = image.filename || `captured-image-${image.index || 1}`;
        const alt = filename
            .replace(/\.[a-z0-9]{2,5}$/i, '')
            .replace(/[-_]+/g, ' ')
            .trim() || fallbackPrompt || 'Captured image';

        return {
            imageUrl: inlineUrl,
            thumbnailUrl: inlineUrl,
            downloadUrl,
            artifactId: image.artifactId || '',
            filename,
            mimeType: image.mimeType || '',
            sizeBytes: image.sizeBytes || 0,
            sourceHost,
            alt,
            prompt: fallbackPrompt || `Captured image from ${sourceHost || 'scraped page'}`,
            source: 'artifact',
        };
    }

    normalizeSearchResult(result) {
        if (!result || typeof result !== 'object' || !result.url) {
            return null;
        }

        return {
            title: result.title || result.url,
            url: result.url,
            snippet: result.snippet || '',
            source: result.source || '',
            publishedAt: result.publishedAt || '',
        };
    }

    appendToolSelectionMessages(parentMessageId, toolEvents = []) {
        const sessionId = sessionManager.currentSessionId;
        if (!sessionId || !parentMessageId || !Array.isArray(toolEvents) || toolEvents.length === 0) {
            return;
        }

        const nextMessages = [];

        toolEvents.forEach((event, index) => {
            const toolId = event?.toolCall?.function?.name || event?.result?.toolId || '';
            const args = this.parseToolArguments(event?.toolCall?.function?.arguments);
            const data = event?.result?.data || {};

            if (toolId === 'image-search-unsplash') {
                const results = (Array.isArray(data.images) ? data.images : [])
                    .map((image) => this.normalizeUnsplashResult(image))
                    .filter(Boolean);

                if (results.length === 0) {
                    return;
                }

                nextMessages.push({
                    id: `${parentMessageId}-unsplash-${index}`,
                    parentMessageId,
                    role: 'assistant',
                    type: 'unsplash-search',
                    content: `Unsplash options for "${data.query || args.query || 'image search'}"`,
                    query: data.query || args.query || '',
                    results,
                    total: data.total || results.length,
                    totalPages: data.totalPages || args.totalPages || 1,
                    currentPage: args.page || 1,
                    perPage: args.perPage || results.length || 6,
                    orientation: args.orientation || null,
                    timestamp: new Date().toISOString(),
                });
                return;
            }

            if (toolId === 'web-search') {
                const results = (Array.isArray(data.results) ? data.results : [])
                    .map((result) => this.normalizeSearchResult(result))
                    .filter(Boolean);

                if (results.length === 0) {
                    return;
                }

                nextMessages.push({
                    id: `${parentMessageId}-search-${index}`,
                    parentMessageId,
                    role: 'assistant',
                    type: 'search-results',
                    content: `Source pages for "${data.query || args.query || 'research'}"`,
                    query: data.query || args.query || '',
                    results,
                    total: results.length,
                    timestamp: new Date().toISOString(),
                });
                return;
            }

            if (toolId === 'image-generate') {
                const results = (Array.isArray(data.images) ? data.images : [])
                    .map((image) => this.normalizeGeneratedImage(image, data.prompt || args.prompt || '', data.model || ''))
                    .filter(Boolean);

                if (results.length === 0) {
                    return;
                }

                nextMessages.push({
                    id: `${parentMessageId}-image-${index}`,
                    parentMessageId,
                    role: 'assistant',
                    type: 'image-selection',
                    content: `Generated image options for "${data.prompt || args.prompt || 'image'}"`,
                    prompt: data.prompt || args.prompt || '',
                    model: data.model || '',
                    results,
                    timestamp: new Date().toISOString(),
                });
                return;
            }

            if (toolId === 'web-scrape') {
                const imageCapture = data.imageCapture && typeof data.imageCapture === 'object'
                    ? data.imageCapture
                    : (event?.result?.imageCapture && typeof event.result.imageCapture === 'object'
                        ? event.result.imageCapture
                        : null);
                if (imageCapture?.mode !== 'blind-artifacts') {
                    return;
                }

                const fallbackHost = this.extractHostLabel(data.url || args.url || '') || imageCapture.items?.[0]?.sourceHost || '';
                const results = (Array.isArray(imageCapture.items) ? imageCapture.items : [])
                    .map((image) => this.normalizeArtifactImage(image, data.title || data.url || args.url || '', fallbackHost))
                    .filter(Boolean);

                if (results.length === 0) {
                    return;
                }

                nextMessages.push({
                    id: `${parentMessageId}-artifact-${index}`,
                    parentMessageId,
                    role: 'assistant',
                    type: 'image-selection',
                    sourceKind: 'artifact',
                    content: `Captured image options from ${fallbackHost || 'the scraped page'}`,
                    prompt: data.title || data.url || args.url || '',
                    sourceHost: fallbackHost,
                    results,
                    timestamp: new Date().toISOString(),
                });
            }
        });

        if (nextMessages.length === 0) {
            return;
        }

        nextMessages.forEach((message) => {
            const savedMessage = this.upsertSessionMessage(sessionId, message);
            this.renderOrReplaceMessage(savedMessage || message);
        });

        uiHelpers.scrollToBottom(false);
        this.updateSessionInfo();
        uiHelpers.renderSessionsList(sessionManager.sessions, sessionManager.currentSessionId);
    }

    setInput(text) {
        this.messageInput.value = text;
        this.autoResize?.resize?.();
        this.updateSendButton();
        this.messageInput.focus();
    }

    syncBackendSession(sessionId) {
        if (!sessionId) {
            return;
        }

        const currentSessionId = sessionManager.currentSessionId;
        if (currentSessionId !== sessionId) {
            sessionManager.promoteSessionId(currentSessionId, sessionId);
        }

        apiClient.setSessionId(sessionId);
    }

    handleDelta(content) {
        if (!this.currentStreamingMessageId) return;
        
        // Hide typing indicator once we start receiving content
        uiHelpers.hideTypingIndicator();
        
        const sessionId = sessionManager.currentSessionId;
        const messages = sessionManager.getMessages(sessionId);
        const lastMessage = messages[messages.length - 1];
        
        if (lastMessage && lastMessage.role === 'assistant') {
            // Append content
            lastMessage.content += content;
            
            // Update UI
            uiHelpers.updateMessageContent(this.currentStreamingMessageId, lastMessage.content, true);
            uiHelpers.scrollToBottom();
        }
    }

    handleDone(chunk = {}) {
        if (!this.currentStreamingMessageId) return;
        
        // Reset retry counter on success
        this.retryAttempt = 0;
        
        const sessionId = sessionManager.currentSessionId;
        const parentMessageId = this.currentStreamingMessageId;
        
        // Finalize message
        sessionManager.finalizeLastMessage(sessionId);
        
        // Hide typing indicator
        uiHelpers.hideTypingIndicator();
        
        // Update UI
        const messages = sessionManager.getMessages(sessionId);
        const lastMessage = messages[messages.length - 1];
        
        if (lastMessage) {
            uiHelpers.updateMessageContent(this.currentStreamingMessageId, lastMessage.content, false);
        }
        
        this.isProcessing = false;
        this.currentStreamingMessageId = null;
        this.updateSendButton();

        if (Array.isArray(chunk.toolEvents) && chunk.toolEvents.length > 0) {
            this.appendToolSelectionMessages(parentMessageId, chunk.toolEvents);
        }
        
        // Update session info (timestamp changed)
        this.updateSessionInfo();
        uiHelpers.renderSessionsList(sessionManager.sessions, sessionManager.currentSessionId);
    }

    handleError(message, status = null) {
        console.error('Chat error:', message, 'status:', status);
        
        // Check if this is a network/connection error that we should handle gracefully
        const normalizedMessage = String(message || '').toLowerCase();
        const isNetworkError = status == null || status === 0 || status === 408 ||
            message?.includes('fetch') || 
            normalizedMessage.includes('network') ||
            message?.includes('Failed to fetch') ||
            normalizedMessage.includes('abort') ||
            normalizedMessage.includes('timeout') ||
            normalizedMessage.includes('disconnected');

        const isServerError = typeof status === 'number' && status >= 500;
        
        // For network errors, try to retry instead of immediately failing
        if (isNetworkError && !isServerError && this.retryAttempt < this.maxRetries) {
            this.retryAttempt++;
            console.log(`[ChatApp] Retrying after network error (attempt ${this.retryAttempt}/${this.maxRetries})...`);
            
            // Show a gentle warning instead of error
            uiHelpers.showToast(
                `Connection interrupted. Retrying (${this.retryAttempt}/${this.maxRetries})...`, 
                'warning',
                'Reconnecting'
            );
            
            // Wait a bit and retry the last request
            setTimeout(() => {
                // If we have a current streaming message, keep it in "thinking" state
                if (this.currentStreamingMessageId) {
                    const el = document.getElementById(this.currentStreamingMessageId);
                    if (el) {
                        // Update the message to show we're retrying
                        const contentEl = el.querySelector('.message-content');
                        if (contentEl) {
                            contentEl.innerHTML = '<p class="text-text-secondary italic">Reconnecting...</p>';
                        }
                    }
                }
                
                // Retry the request
                this.retryLastRequest();
            }, 1000 * this.retryAttempt); // Exponential backoff
            
            return;
        }
        
        // Max retries exceeded or non-network error - show the error
        this.retryAttempt = 0;
        
        // Hide typing indicator
        uiHelpers.hideTypingIndicator();
        
        // Remove the streaming message placeholder
        if (this.currentStreamingMessageId) {
            const el = document.getElementById(this.currentStreamingMessageId);
            if (el) {
                el.remove();
            }
            
            // Remove from session
            const sessionId = sessionManager.currentSessionId;
            const messages = sessionManager.getMessages(sessionId);
            if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
                messages.pop();
                sessionManager.saveToStorage();
            }
        }
        
        this.isProcessing = false;
        this.currentStreamingMessageId = null;
        this.updateSendButton();
        
        // Show appropriate error message
        let errorTitle = 'Error';
        if (status === 400) errorTitle = 'Bad Request';
        else if (status === 401) errorTitle = 'Unauthorized';
        else if (status === 429) errorTitle = 'Rate Limited';
        else if (status >= 500) errorTitle = 'Server Error';
        else if (isNetworkError) errorTitle = 'Connection Failed';
        
        // Provide more helpful message for network errors
        let displayMessage = message || 'An error occurred';
        if (isNetworkError && this.retryAttempt >= this.maxRetries) {
            displayMessage = 'Unable to connect after multiple attempts. Please check your connection and try again.';
        }
        
        uiHelpers.showToast(displayMessage, 'error', errorTitle);
    }
    
    retryLastRequest() {
        // This is called to retry the last message
        // For now, we'll just try to regenerate the last user message
        const sessionId = sessionManager.currentSessionId;
        const messages = sessionManager.getMessages(sessionId);
        const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
        
        if (lastUserMessage) {
            // Remove the incomplete assistant message if exists
            if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
                messages.pop();
            }
            
            // Retry sending
            this.sendMessage();
        } else {
            // Can't retry - show error
            this.handleError('Could not retry request', null);
        }
    }

    handleCancelled() {
        // Hide typing indicator
        uiHelpers.hideTypingIndicator();
        
        // Remove the streaming message placeholder
        if (this.currentStreamingMessageId) {
            const el = document.getElementById(this.currentStreamingMessageId);
            if (el) {
                el.remove();
            }
            
            // Remove from session
            const sessionId = sessionManager.currentSessionId;
            const messages = sessionManager.getMessages(sessionId);
            if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
                messages.pop();
                sessionManager.saveToStorage();
            }
        }
        
        this.isProcessing = false;
        this.currentStreamingMessageId = null;
        this.updateSendButton();
    }

    async regenerateResponse(messageId) {
        if (this.isProcessing) {
            uiHelpers.showToast('Please wait for the current response to complete', 'warning');
            return;
        }
        
        const sessionId = sessionManager.currentSessionId;
        if (!sessionId) return;
        
        // Find the user message that preceded this assistant message
        const messages = sessionManager.getMessages(sessionId);
        const messageIndex = messages.findIndex(m => m.id === messageId);
        
        if (messageIndex <= 0) return;
        
        // Find the last user message before this assistant message
        let userMessageIndex = messageIndex - 1;
        while (userMessageIndex >= 0 && messages[userMessageIndex].role !== 'user') {
            userMessageIndex--;
        }
        
        if (userMessageIndex < 0) return;
        
        const userMessage = messages[userMessageIndex];
        
        // Remove the old assistant message
        messages.splice(messageIndex, 1);
        
        // Remove from DOM
        const el = document.getElementById(messageId);
        if (el) el.remove();
        
        sessionManager.saveToStorage();
        
        // Show typing indicator
        this.isProcessing = true;
        this.updateSendButton();
        uiHelpers.showTypingIndicator();
        
        // Create new placeholder for assistant response
        const assistantMessage = {
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            isStreaming: true
        };
        
        this.currentStreamingMessageId = uiHelpers.generateMessageId();
        assistantMessage.id = this.currentStreamingMessageId;
        
        sessionManager.addMessage(sessionId, assistantMessage);
        
        setTimeout(() => {
            const assistantMessageEl = uiHelpers.renderMessage(assistantMessage, true);
            this.messagesContainer.appendChild(assistantMessageEl);
            uiHelpers.reinitializeIcons(assistantMessageEl);
            uiHelpers.scrollToBottom();
        }, 300);
        
        // Get current model
        const model = uiHelpers.getCurrentModel();
        
        // Build message history and stream
        this.currentAbortController = new AbortController();
        
        try {
            apiClient.setSessionId(sessionId);
            const history = this.buildMessageHistory(sessionId);
            
            for await (const chunk of apiClient.streamChat(history, model, this.currentAbortController.signal)) {
                if (chunk.sessionId) {
                    this.syncBackendSession(chunk.sessionId);
                }

                switch (chunk.type) {
                    case 'delta':
                        this.handleDelta(chunk.content);
                        break;
                    case 'done':
                        this.handleDone(chunk);
                        break;
                    case 'error':
                        if (chunk.cancelled) {
                            this.handleCancelled();
                        } else {
                            this.handleError(chunk.error, chunk.status);
                        }
                        break;
                    case 'retry':
                        if (chunk.attempt > 1) {
                            uiHelpers.showToast(`Retrying... (attempt ${chunk.attempt}/${chunk.maxAttempts})`, 'info');
                        }
                        break;
                }
            }
        } catch (error) {
            console.error('Regenerate error:', error);
            this.handleError(error.message || 'Failed to regenerate response');
        } finally {
            this.currentAbortController = null;
        }
    }

    // ============================================
    // Image Generation
    // ============================================

    /**
     * Handle the image modal action button
     * Routes to either generate image or search Unsplash based on selected source
     */
    async handleImageModalAction() {
        const options = uiHelpers.getImageGenerationOptions();
        const source = uiHelpers.getImageSource();
        
        if (!options.prompt) {
            uiHelpers.showToast(source === 'unsplash' ? 'Please enter a search query' : 'Please enter a prompt', 'warning');
            return;
        }
        
        if (source === 'unsplash') {
            uiHelpers.closeImageModal();
            await this.searchUnsplashImages(options.prompt);
        } else {
            await this.generateImage();
        }
    }

    async generateImage() {
        const options = uiHelpers.getImageGenerationOptions();
        
        if (!options.prompt) {
            uiHelpers.showToast('Please enter a prompt', 'warning');
            return;
        }
        
        // Check if we need to create a session
        if (!sessionManager.currentSessionId) {
            await this.createNewSession();
        }
        
        const sessionId = sessionManager.currentSessionId;
        
        // Hide welcome message
        uiHelpers.hideWelcomeMessage();
        
        // Add user message with the prompt
        const userMessage = {
            role: 'user',
            content: `/image ${options.prompt}`,
            timestamp: new Date().toISOString()
        };
        
        sessionManager.addMessage(sessionId, userMessage);
        
        const userMessageEl = uiHelpers.renderMessage(userMessage);
        this.messagesContainer.appendChild(userMessageEl);
        uiHelpers.scrollToBottom();
        
        // Create placeholder for image
        const imageMessageId = uiHelpers.generateMessageId();
        this.currentImageMessageId = imageMessageId;
        
        const imageMessage = {
            id: imageMessageId,
            role: 'assistant',
            type: 'image',
            prompt: options.prompt,
            isLoading: true,
            loadingText: 'Generating image...',
            timestamp: new Date().toISOString()
        };
        
        sessionManager.addMessage(sessionId, imageMessage);
        
        const imageMessageEl = uiHelpers.renderImageMessage(imageMessage);
        this.messagesContainer.appendChild(imageMessageEl);
        uiHelpers.reinitializeIcons(imageMessageEl);
        uiHelpers.scrollToBottom();
        
        // Close modal and show generating state
        uiHelpers.closeImageModal();
        uiHelpers.setImageGenerateButtonState(true);
        this.isGeneratingImage = true;
        
        try {
            // Add sessionId to options
            options.sessionId = sessionId;
            
            // Call API
            apiClient.setSessionId(sessionId);
            const result = await apiClient.generateImage(options);
            
            // Update the image message with the result
            if (result.data && result.data.length > 0) {
                const imageData = result.data[0];
                const imageUrl = imageData.url || (imageData.b64_json ? `data:image/png;base64,${imageData.b64_json}` : null);
                
                // Update session storage
                const messages = sessionManager.getMessages(sessionId);
                const msgIndex = messages.findIndex(m => m.id === imageMessageId);
                if (msgIndex >= 0) {
                    messages[msgIndex] = {
                        ...messages[msgIndex],
                        isLoading: false,
                        imageUrl: imageUrl,
                        revisedPrompt: imageData.revised_prompt,
                        model: result.model || options.model
                    };
                    sessionManager.saveToStorage();
                }
                
                // Update UI
                uiHelpers.updateImageMessage(imageMessageId, {
                    url: imageUrl,
                    prompt: options.prompt,
                    revised_prompt: imageData.revised_prompt,
                    model: result.model || options.model
                });
                
                uiHelpers.showToast('Image generated successfully', 'success');
            }
        } catch (error) {
            console.error('Image generation failed:', error);
            
            // Remove the loading message
            const el = document.getElementById(imageMessageId);
            if (el) el.remove();
            
            // Remove from session
            const messages = sessionManager.getMessages(sessionId);
            const msgIndex = messages.findIndex(m => m.id === imageMessageId);
            if (msgIndex >= 0) {
                messages.splice(msgIndex, 1);
                sessionManager.saveToStorage();
            }
            
            uiHelpers.showToast(error.message || 'Failed to generate image', 'error');
        } finally {
            this.isGeneratingImage = false;
            this.currentImageMessageId = null;
            uiHelpers.setImageGenerateButtonState(false);
            this.updateSessionInfo();
            uiHelpers.renderSessionsList(sessionManager.sessions, sessionManager.currentSessionId);
        }
    }

    // ============================================
    // Search
    // ============================================

    openSearch() {
        if (!sessionManager.currentSessionId) {
            uiHelpers.showToast('Open a conversation first', 'info');
            return;
        }
        uiHelpers.openSearch();
    }

    closeSearch() {
        uiHelpers.closeSearch();
    }

    navigateSearch(direction) {
        uiHelpers.navigateSearch(direction);
    }

    // ============================================
    // Export - Enhanced with DOCX and PDF support
    // ============================================

    async exportConversation(format) {
        const sessionId = sessionManager.currentSessionId;
        if (!sessionId) {
            uiHelpers.showToast('No conversation to export', 'warning');
            return;
        }
        
        const messages = sessionManager.getMessages(sessionId);
        const session = sessionManager.getCurrentSession();
        
        if (messages.length === 0) {
            uiHelpers.showToast('No messages to export', 'warning');
            return;
        }
        
        // Show progress for formats that need processing
        const showProgress = format === 'docx' || format === 'pdf';
        
        try {
            const result = await window.importExportManager.exportConversation(format, messages, session);
            
            // Download the file
            if (result.blob) {
                // For blob-based exports (DOCX, PDF)
                this.downloadBlob(result.blob, result.filename, result.mimeType);
            } else {
                // For text-based exports
                this.downloadFile(result.content, result.filename, result.mimeType);
            }
            
            uiHelpers.closeExportModal();
            uiHelpers.showToast(`Conversation exported as ${format.toUpperCase()}`, 'success');
        } catch (error) {
            console.error('Export failed:', error);
            uiHelpers.showToast(`Export failed: ${error.message}`, 'error');
        }
    }

    /**
     * Export all conversations
     */
    exportAllConversations() {
        const content = sessionManager.exportAll();
        const filename = uiHelpers.createUniqueFilename('all conversations', 'json', 'conversations');
        
        this.downloadFile(content, filename, 'application/json');
        uiHelpers.closeExportModal();
        uiHelpers.showToast(`All conversations exported`, 'success');
    }

    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        this.downloadBlob(blob, filename, mimeType);
    }

    downloadBlob(blob, filename, mimeType) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = uiHelpers.sanitizeDownloadFilename(filename, 'download');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    exportAsMarkdown(messages, session) {
        const date = new Date().toLocaleString();
        let md = `# ${session?.title || 'Conversation'}\n\n`;
        md += `**Date:** ${date}  \n`;
        md += `**Messages:** ${messages.length}\n\n`;
        md += `---\n\n`;
        
        messages.forEach(msg => {
            const time = new Date(msg.timestamp).toLocaleString();
            let roleLabel;
            switch (msg.role) {
                case 'user':
                    roleLabel = '**You**';
                    break;
                case 'assistant':
                    roleLabel = msg.type === 'image' ? '**AI Image Generator**' : '**Assistant**';
                    break;
                case 'system':
                    roleLabel = '**System**';
                    break;
                default:
                    roleLabel = '**Unknown**';
            }
            md += `### ${roleLabel} *(${time})*\n\n`;
            
            if (msg.type === 'image') {
                md += `*Prompt: "${msg.prompt || ''}"*\n\n`;
                if (msg.imageUrl) {
                    md += `![Generated Image](${msg.imageUrl})\n\n`;
                }
            } else {
                md += msg.content;
            }
            md += '\n\n---\n\n';
        });
        
        return md;
    }

    exportAsJSON(messages, session) {
        const exportData = {
            session: {
                id: session?.id,
                title: session?.title,
                mode: session?.mode,
                createdAt: session?.createdAt,
                exportedAt: new Date().toISOString()
            },
            messages: messages.map(m => ({
                role: m.role,
                type: m.type,
                content: m.content,
                prompt: m.prompt,
                imageUrl: m.imageUrl,
                model: m.model,
                timestamp: m.timestamp
            }))
        };
        
        return JSON.stringify(exportData, null, 2);
    }

    exportAsText(messages, session) {
        const date = new Date().toLocaleString();
        let text = `${session?.title || 'Conversation'}\n`;
        text += `Date: ${date}\n`;
        text += `Messages: ${messages.length}\n`;
        text += `${'='.repeat(50)}\n\n`;
        
        messages.forEach(msg => {
            const time = new Date(msg.timestamp).toLocaleString();
            let roleLabel;
            switch (msg.role) {
                case 'user':
                    roleLabel = 'You';
                    break;
                case 'assistant':
                    roleLabel = msg.type === 'image' ? 'AI Image Generator' : 'Assistant';
                    break;
                case 'system':
                    roleLabel = 'System';
                    break;
                default:
                    roleLabel = 'Unknown';
            }
            text += `[${time}] ${roleLabel}:\n`;
            
            if (msg.type === 'image') {
                text += `Prompt: "${msg.prompt || ''}"\n`;
                if (msg.imageUrl) {
                    text += `Image: ${msg.imageUrl}\n`;
                }
            } else {
                text += msg.content;
            }
            text += '\n\n' + '-'.repeat(50) + '\n\n';
        });
        
        return text;
    }

    // ============================================
    // UI State
    // ============================================

    updateSendButton() {
        const hasContent = this.messageInput?.value?.trim()?.length > 0;
        const canSend = hasContent && !this.isProcessing && !this.isGeneratingImage;
        
        if (this.sendBtn) {
            this.sendBtn.disabled = !canSend;
            
            if (this.isProcessing) {
                this.sendBtn.innerHTML = `<div class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true"></div>`;
                this.sendBtn.setAttribute('aria-label', 'Sending...');
            } else {
                this.sendBtn.innerHTML = `<i data-lucide="send" class="w-5 h-5" aria-hidden="true"></i>`;
                this.sendBtn.setAttribute('aria-label', 'Send message');
                uiHelpers.reinitializeIcons(this.sendBtn);
            }
        }
    }
    
    // ============================================
    // Connection Status
    // ============================================
    
    updateConnectionStatus(status) {
        const indicator = document.getElementById('connection-indicator');
        const text = document.getElementById('connection-text');
        
        if (!indicator || !text) return;
        
        indicator.className = 'connection-indicator';
        
        switch (status) {
            case 'connected':
                indicator.classList.add('connected');
                text.textContent = 'Connected';
                break;
            case 'disconnected':
                indicator.classList.add('disconnected');
                text.textContent = 'Offline';
                break;
            case 'checking':
            default:
                indicator.classList.add('checking');
                text.textContent = 'Connecting...';
                break;
        }
    }
    
    async checkConnection() {
        const health = await apiClient.checkHealth();
        this.updateConnectionStatus(health.connected ? 'connected' : 'disconnected');
        return health;
    }
    
    startHealthCheckInterval() {
        // Check every 30 seconds
        setInterval(async () => {
            const health = await apiClient.checkHealth();
            this.updateConnectionStatus(health.connected ? 'connected' : 'disconnected');
        }, 30000);
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new ChatApp();
    window.app = window.chatApp; // Backward compatibility
});
