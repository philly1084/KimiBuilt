/**
 * Main Application for KimiBuilt AI Chat
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
            
            // Close search/command palette on Escape
            if (e.key === 'Escape') {
                if (!document.getElementById('search-bar').classList.contains('hidden')) {
                    this.closeSearch();
                }
                // Cancel current streaming if active
                if (this.isProcessing && this.currentAbortController) {
                    this.cancelCurrentRequest();
                }
            }
        });
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
                switch (chunk.type) {
                    case 'delta':
                        hasReceivedContent = true;
                        this.retryAttempt = 0; // Reset retry count on successful content
                        this.handleDelta(chunk.content);
                        break;
                    case 'done':
                        this.handleDone();
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
                if (args) {
                    const input = document.getElementById('image-prompt-input');
                    if (input) input.value = args;
                }
                uiHelpers.openImageModal();
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

    setInput(text) {
        this.messageInput.value = text;
        this.autoResize?.resize?.();
        this.updateSendButton();
        this.messageInput.focus();
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

    handleDone() {
        if (!this.currentStreamingMessageId) return;
        
        const sessionId = sessionManager.currentSessionId;
        
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
        
        // Update session info (timestamp changed)
        this.updateSessionInfo();
        uiHelpers.renderSessionsList(sessionManager.sessions, sessionManager.currentSessionId);
    }

    handleError(message, status = null) {
        console.error('Chat error:', message);
        
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
        
        uiHelpers.showToast(message || 'An error occurred', 'error', errorTitle);
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
                switch (chunk.type) {
                    case 'delta':
                        this.handleDelta(chunk.content);
                        break;
                    case 'done':
                        this.handleDone();
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
            
            // Call API using OpenAI SDK
            apiClient.setSessionId(sessionId);
            const result = await apiClient.generateImage(options);
            
            // Update the image message with the result
            if (result.data && result.data.length > 0) {
                const imageData = result.data[0];
                
                // Update session storage
                const messages = sessionManager.getMessages(sessionId);
                const msgIndex = messages.findIndex(m => m.id === imageMessageId);
                if (msgIndex >= 0) {
                    messages[msgIndex] = {
                        ...messages[msgIndex],
                        isLoading: false,
                        imageUrl: imageData.url || imageData.b64_json,
                        revisedPrompt: imageData.revised_prompt,
                        model: result.model || options.model
                    };
                    sessionManager.saveToStorage();
                }
                
                // Update UI
                uiHelpers.updateImageMessage(imageMessageId, {
                    url: imageData.url || imageData.b64_json,
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
    // Export
    // ============================================

    exportConversation(format) {
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
        
        let content = '';
        let filename = '';
        let mimeType = '';
        
        const timestamp = new Date().toISOString().split('T')[0];
        const sessionTitle = (session?.title || 'conversation').replace(/[^a-z0-9]/gi, '_').toLowerCase();
        
        switch (format) {
            case 'markdown':
                content = this.exportAsMarkdown(messages, session);
                filename = `${sessionTitle}_${timestamp}.md`;
                mimeType = 'text/markdown';
                break;
            case 'json':
                content = this.exportAsJSON(messages, session);
                filename = `${sessionTitle}_${timestamp}.json`;
                mimeType = 'application/json';
                break;
            case 'txt':
                content = this.exportAsText(messages, session);
                filename = `${sessionTitle}_${timestamp}.txt`;
                mimeType = 'text/plain';
                break;
            default:
                return;
        }
        
        // Download the file
        this.downloadFile(content, filename, mimeType);
        
        uiHelpers.closeExportModal();
        uiHelpers.showToast(`Conversation exported as ${format.toUpperCase()}`, 'success');
    }

    /**
     * Export all conversations
     */
    exportAllConversations() {
        const content = sessionManager.exportAll();
        const timestamp = new Date().toISOString().split('T')[0];
        const filename = `kimibuilt_all_conversations_${timestamp}.json`;
        
        this.downloadFile(content, filename, 'application/json');
        uiHelpers.closeExportModal();
        uiHelpers.showToast(`All conversations exported`, 'success');
    }

    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
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
