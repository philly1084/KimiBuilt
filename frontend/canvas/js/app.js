/**
 * LillyBuilt Canvas - Main Application
 * Front-end #3 of 4 - Side-by-side editor for structured content
 */

class CanvasApp {
    constructor() {
        // Core components
        this.editor = new EditorManager();
        this.typeManager = new CanvasTypeManager();
        this.history = new HistoryManager(50);
        this.exportManager = new ExportManager();
        this.api = new CanvasAPI();

        // State
        this.state = {
            sessionId: null,
            canvasType: 'code',
            content: '',
            metadata: {},
            suggestions: [],
            isPreviewMode: false,
            isSplitView: false,
            aiResponse: null,
            lastSaved: null,
            selectedModel: 'gpt-4o',
            reasoningEffort: '',
        };

        // Auto-save timer
        this.autoSaveTimer = null;

        this.init();
    }

    /**
     * Initialize the application
     */
    init() {
        this.loadFromLocalStorage();
        this.initializeEditor();
        this.setupEventListeners();
        this.setupHistoryListener();
        this.setupTemplateChips();
        this.loadModels();
        this.updateUI();
        
        // Try to connect WebSocket
        this.api.connectWebSocket().catch(() => {
            console.log('WebSocket connection failed, using HTTP fallback');
        });

        // Setup WebSocket callbacks
        this.setupWebSocketListeners();

        // Setup keyboard shortcuts
        this.setupKeyboardShortcuts();

        // Setup help modal
        this.setupHelpModal();

        console.log('LillyBuilt Canvas initialized');
    }

    /**
     * Setup WebSocket event listeners
     */
    setupWebSocketListeners() {
        // Handle incoming messages
        this.api.on('done', (data) => {
            this.handleAIResponse(data);
        });

        // Handle connection open
        this.api.on('open', () => {
            this.hideWebSocketDisconnectBanner();
        });

        // Handle connection close
        this.api.on('close', (event) => {
            if (!event.wasClean) {
                this.showWebSocketDisconnectBanner();
            }
        });

        // Handle errors
        this.api.on('error', () => {
            this.showWebSocketDisconnectBanner();
        });
    }

    /**
     * Show WebSocket disconnect banner
     */
    showWebSocketDisconnectBanner() {
        const banner = document.getElementById('ws-disconnect-banner');
        if (banner) {
            banner.classList.remove('hidden');
            // Adjust app padding for banner
            document.getElementById('app').style.paddingTop = '48px';
        }
    }

    /**
     * Hide WebSocket disconnect banner
     */
    hideWebSocketDisconnectBanner() {
        const banner = document.getElementById('ws-disconnect-banner');
        if (banner) {
            banner.classList.add('hidden');
            // Reset app padding
            document.getElementById('app').style.paddingTop = '0';
        }
    }

    /**
     * Reconnect WebSocket
     */
    async reconnectWebSocket() {
        const reconnectBtn = document.getElementById('ws-reconnect-btn');
        if (reconnectBtn) {
            reconnectBtn.disabled = true;
            reconnectBtn.innerHTML = '<span class="loading-spinner" style="width:14px;height:14px;"></span> Connecting...';
        }

        try {
            await this.api.connectWebSocket();
            this.hideWebSocketDisconnectBanner();
            this.showToast('Reconnected successfully', 'success');
        } catch (error) {
            console.error('WebSocket reconnect failed:', error);
            this.showToast('Failed to reconnect', 'error');
        } finally {
            if (reconnectBtn) {
                reconnectBtn.disabled = false;
                reconnectBtn.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="23 4 23 10 17 10"></polyline>
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                    </svg>
                    Reconnect
                `;
            }
        }
    }

    /**
     * Setup keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Don't trigger shortcuts when typing in inputs
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                // Allow Ctrl+Enter in textareas
                if (e.target.id === 'prompt-input' && e.ctrlKey && e.key === 'Enter') {
                    e.preventDefault();
                    this.sendToAI();
                }
                return;
            }

            // ? - Show help modal
            if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                this.showHelpModal();
            }

            // Ctrl/Cmd + P - Toggle preview
            if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
                e.preventDefault();
                this.togglePreview();
            }

            // Ctrl/Cmd + \ - Toggle split view
            if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
                e.preventDefault();
                this.toggleSplitView();
            }

            // Ctrl/Cmd + Enter - Send to AI (from anywhere)
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                this.sendToAI();
            }

            // Escape - Close modals and sidebar
            if (e.key === 'Escape') {
                this.closeHelpModal();
                this.closeSidebar();
            }
        });
    }

    /**
     * Setup help modal
     */
    setupHelpModal() {
        const closeBtn = document.getElementById('help-modal-close');
        const overlay = document.querySelector('.help-modal-overlay');
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeHelpModal());
        }
        
        if (overlay) {
            overlay.addEventListener('click', () => this.closeHelpModal());
        }

        // Reconnect button
        const reconnectBtn = document.getElementById('ws-reconnect-btn');
        if (reconnectBtn) {
            reconnectBtn.addEventListener('click', () => this.reconnectWebSocket());
        }
    }

    /**
     * Show help modal
     */
    showHelpModal() {
        const modal = document.getElementById('help-modal');
        if (modal) {
            modal.classList.remove('hidden');
        }
    }

    /**
     * Close help modal
     */
    closeHelpModal() {
        const modal = document.getElementById('help-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    /**
     * Close sidebar (mobile)
     */
    closeSidebar() {
        const sidebar = document.getElementById('sidebar');
        const backdrop = document.getElementById('sidebar-backdrop');
        if (sidebar) {
            sidebar.classList.remove('open');
        }
        if (backdrop) {
            backdrop.classList.remove('visible');
        }
    }

    /**
     * Toggle sidebar with backdrop
     */
    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const backdrop = document.getElementById('sidebar-backdrop');
        const isOpen = sidebar.classList.contains('open');
        
        if (isOpen) {
            sidebar.classList.remove('open');
            backdrop.classList.remove('visible');
        } else {
            sidebar.classList.add('open');
            backdrop.classList.add('visible');
        }
    }
    
    /**
     * Load available AI models
     */
    async loadModels() {
        const modelSelect = document.getElementById('model-select');
        if (!modelSelect) return;
        
        try {
            const response = await fetch('/api/models');
            const data = await response.json();
            
            if (data.models && data.models.length > 0) {
                modelSelect.innerHTML = data.models.map(m => 
                    `<option value="${m.id}" ${m.id === 'gpt-4o' ? 'selected' : ''}>${m.name}</option>`
                ).join('');
            } else {
                modelSelect.innerHTML = `
                    <option value="gpt-4o" selected>GPT-4o</option>
                    <option value="gpt-4o-mini">GPT-4o Mini</option>
                    <option value="o3-mini">o3-mini</option>
                `;
            }

            modelSelect.value = this.state.selectedModel || modelSelect.value || 'gpt-4o';
            this.state.selectedModel = modelSelect.value;
        } catch (err) {
            console.log('Failed to load models, using defaults');
            modelSelect.innerHTML = `
                <option value="gpt-4o" selected>GPT-4o</option>
                <option value="gpt-4o-mini">GPT-4o Mini</option>
                <option value="o3-mini">o3-mini</option>
            `;
            modelSelect.value = this.state.selectedModel || modelSelect.value || 'gpt-4o';
            this.state.selectedModel = modelSelect.value;
        }
    }
    
    /**
     * Setup template chip click handlers
     */
    setupTemplateChips() {
        const chips = document.querySelectorAll('.template-chip');
        chips.forEach(chip => {
            chip.addEventListener('click', () => {
                const prompt = chip.dataset.prompt;
                const type = chip.dataset.type;
                
                // Set the prompt
                const promptInput = document.getElementById('prompt-input');
                promptInput.value = prompt;
                promptInput.focus();
                
                // Switch canvas type if needed
                if (type && type !== this.state.canvasType) {
                    this.switchCanvasType(type);
                }
            });
        });
    }

    /**
     * Initialize the code editor
     */
    initializeEditor() {
        const handler = this.typeManager.getHandler(this.state.canvasType);
        
        this.editor.initialize({
            mode: handler.getCodeMirrorMode(),
            value: this.state.content || handler.getDefaultContent()
        });

        // Subscribe to editor changes for auto-save and diagram auto-render
        this.editor.onChange((value) => {
            this.state.content = value;
            this.scheduleAutoSave();
            this.updateStatusBar();
            
            // Auto-render diagram with debounce
            if (this.state.canvasType === 'diagram' && (this.state.isPreviewMode || this.state.isSplitView)) {
                const handler = this.typeManager.getHandler('diagram');
                handler.scheduleAutoRender(value, 'diagram-output');
            }
        });

        // Subscribe to cursor activity
        this.editor.onCursorActivity((position) => {
            document.getElementById('cursor-position').textContent = 
                `Ln ${position.line}, Col ${position.ch}`;
        });

        // Push initial state to history
        this.pushToHistory();
    }

    /**
     * Setup all event listeners
     */
    setupEventListeners() {
        // Sidebar toggle with backdrop
        document.getElementById('sidebar-toggle').addEventListener('click', () => {
            this.toggleSidebar();
        });

        // Sidebar backdrop click
        document.getElementById('sidebar-backdrop').addEventListener('click', () => {
            this.closeSidebar();
        });

        // Theme toggle
        document.getElementById('theme-toggle').addEventListener('click', () => {
            this.toggleTheme();
        });
        
        // Model selector
        const modelSelect = document.getElementById('model-select');
        if (modelSelect) {
            modelSelect.addEventListener('change', (e) => {
                this.state.selectedModel = e.target.value;
                console.log('Model changed to:', e.target.value);
                this.saveToLocalStorage();
            });
        }

        const reasoningSelect = document.getElementById('reasoning-effort-select');
        if (reasoningSelect) {
            reasoningSelect.addEventListener('change', (e) => {
                this.state.reasoningEffort = String(e.target.value || '').trim().toLowerCase();
                this.saveToLocalStorage();
            });
        }

        // Canvas type selector
        document.querySelectorAll('.type-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const type = e.currentTarget.dataset.type;
                this.switchCanvasType(type);
            });
        });

        // New session
        document.getElementById('new-session-btn').addEventListener('click', () => {
            this.newSession();
        });

        // Send to AI
        document.getElementById('send-btn').addEventListener('click', () => {
            this.sendToAI();
        });

        // Clear prompt
        document.getElementById('clear-btn').addEventListener('click', () => {
            document.getElementById('prompt-input').value = '';
            document.getElementById('context-input').value = '';
        });

        // Use current content as context
        document.getElementById('use-current-content').addEventListener('click', () => {
            document.getElementById('context-input').value = this.editor.getValue();
        });

        // Apply AI response
        document.getElementById('apply-btn').addEventListener('click', () => {
            this.applyAIResponse();
        });

        // Toggle preview
        document.getElementById('toggle-preview').addEventListener('click', () => {
            this.togglePreview();
        });

        // Toggle split view
        document.getElementById('toggle-split').addEventListener('click', () => {
            this.toggleSplitView();
        });

        // Undo/Redo
        document.getElementById('undo-btn').addEventListener('click', () => {
            this.undo();
        });

        document.getElementById('redo-btn').addEventListener('click', () => {
            this.redo();
        });

        // Copy to clipboard
        document.getElementById('copy-btn').addEventListener('click', () => {
            this.copyToClipboard();
        });

        // Download
        document.getElementById('download-btn').addEventListener('click', () => {
            this.downloadFile();
        });

        // Diagram zoom controls
        document.getElementById('diagram-zoom-in')?.addEventListener('click', () => {
            this.typeManager.getHandler('diagram').zoomIn();
        });

        document.getElementById('diagram-zoom-out')?.addEventListener('click', () => {
            this.typeManager.getHandler('diagram').zoomOut();
        });

        document.getElementById('diagram-zoom-reset')?.addEventListener('click', () => {
            this.typeManager.getHandler('diagram').resetZoom();
        });

        // Mouse wheel zoom for diagram
        document.getElementById('diagram-wrapper')?.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                if (e.deltaY < 0) {
                    this.typeManager.getHandler('diagram').zoomIn();
                } else {
                    this.typeManager.getHandler('diagram').zoomOut();
                }
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + Z - Undo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                this.undo();
            }
            // Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y - Redo
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                e.preventDefault();
                this.redo();
            }
        });

        // Window resize
        window.addEventListener('resize', () => {
            this.editor.resize();
        });

        // Save event from editor
        window.addEventListener('editor:save', () => {
            this.saveToLocalStorage();
            this.showToast('Saved', 'success');
        });

        // Before unload - warn about unsaved changes
        window.addEventListener('beforeunload', (e) => {
            if (this.editor.isDirtyState()) {
                e.preventDefault();
                e.returnValue = '';
            }
        });

        // Setup resizer
        this.setupResizer();
    }

    /**
     * Setup sidebar resizer
     */
    setupResizer() {
        const resizer = document.getElementById('resizer');
        const sidebar = document.getElementById('sidebar');
        let isResizing = false;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizer.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            
            const newWidth = e.clientX;
            if (newWidth >= 260 && newWidth <= 500) {
                sidebar.style.width = `${newWidth}px`;
                this.editor.resize();
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                resizer.classList.remove('resizing');
                document.body.style.cursor = '';
            }
        });
    }

    /**
     * Setup history change listener
     */
    setupHistoryListener() {
        this.history.onChange((stats) => {
            document.getElementById('undo-btn').disabled = !stats.canUndo;
            document.getElementById('redo-btn').disabled = !stats.canRedo;
        });
    }

    /**
     * Switch canvas type
     * @param {string} type 
     */
    switchCanvasType(type) {
        if (this.state.canvasType === type) return;

        // Save current content to history
        this.pushToHistory();

        // Update state
        this.state.canvasType = type;
        this.typeManager.setType(type);

        // Update UI
        document.querySelectorAll('.type-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === type);
        });

        // Get handler and update editor
        const handler = this.typeManager.getHandler(type);
        this.editor.setMode(handler.getCodeMirrorMode());

        // Set default content if empty
        const currentContent = this.editor.getValue().trim();
        if (!currentContent || currentContent === '// Start coding here...') {
            this.editor.setValue(handler.getDefaultContent());
        }

        // Update preview visibility
        this.updatePreviewVisibility();
        this.updateStatusBar();
        this.saveToLocalStorage();
    }

    /**
     * Update preview visibility based on canvas type
     */
    updatePreviewVisibility() {
        const handler = this.typeManager.getCurrentHandler();
        const info = handler.getInfo();
        const previewBtn = document.getElementById('toggle-preview');
        const splitBtn = document.getElementById('toggle-split');

        if (info.supportsPreview) {
            previewBtn.classList.remove('hidden');
            splitBtn.classList.remove('hidden');
        } else {
            previewBtn.classList.add('hidden');
            splitBtn.classList.add('hidden');
            this.state.isPreviewMode = false;
            this.state.isSplitView = false;
        }

        this.updateEditorLayout();
    }

    /**
     * Toggle preview mode
     */
    togglePreview() {
        this.state.isPreviewMode = !this.state.isPreviewMode;
        this.state.isSplitView = false;
        this.updateEditorLayout();
        this.renderPreview();
    }

    /**
     * Toggle split view
     */
    toggleSplitView() {
        this.state.isSplitView = !this.state.isSplitView;
        this.state.isPreviewMode = false;
        this.updateEditorLayout();
        this.renderPreview();
    }

    /**
     * Update editor layout based on view mode
     */
    updateEditorLayout() {
        const editorWrapper = document.getElementById('editor-wrapper');
        const previewWrapper = document.getElementById('preview-wrapper');
        const diagramWrapper = document.getElementById('diagram-wrapper');
        const container = document.querySelector('.editor-container');

        // Reset classes
        container.classList.remove('split');
        editorWrapper.classList.remove('hidden');
        previewWrapper.classList.add('hidden');
        diagramWrapper.classList.add('hidden');

        if (this.state.canvasType === 'diagram') {
            // Diagram mode
            if (this.state.isPreviewMode || this.state.isSplitView) {
                if (this.state.isSplitView) {
                    container.classList.add('split');
                    diagramWrapper.classList.remove('hidden');
                } else {
                    editorWrapper.classList.add('hidden');
                    diagramWrapper.classList.remove('hidden');
                }
            }
        } else if (this.state.canvasType === 'document') {
            // Document mode
            if (this.state.isPreviewMode || this.state.isSplitView) {
                if (this.state.isSplitView) {
                    container.classList.add('split');
                    previewWrapper.classList.remove('hidden');
                } else {
                    editorWrapper.classList.add('hidden');
                    previewWrapper.classList.remove('hidden');
                }
            }
        }

        this.editor.refresh();
    }

    /**
     * Render preview content
     */
    async renderPreview() {
        const content = this.editor.getValue();
        const handler = this.typeManager.getCurrentHandler();

        if (this.state.canvasType === 'document') {
            const html = handler.renderMarkdown(content);
            document.getElementById('preview-content').innerHTML = html;
        } else if (this.state.canvasType === 'diagram') {
            // Reset zoom when manually rendering
            handler.resetZoom();
            await handler.renderDiagram(content, 'diagram-output');
        }
    }

    /**
     * Validate current diagram syntax
     */
    validateDiagramSyntax() {
        if (this.state.canvasType !== 'diagram') return;

        const content = this.editor.getValue();
        const handler = this.typeManager.getHandler('diagram');
        const validation = handler.validateSyntax(content);

        if (!validation.isValid && validation.errors.length > 0) {
            // Convert errors to format expected by editor
            const markers = validation.errors.map(err => ({
                line: err.line,
                message: err.message
            }));
            this.editor.setErrorMarkers(markers);
        } else {
            this.editor.clearErrorMarkers();
        }

        return validation;
    }

    /**
     * Send prompt to AI
     */
    async sendToAI() {
        const prompt = document.getElementById('prompt-input').value.trim();
        const context = document.getElementById('context-input').value.trim();
        const modelSelect = document.getElementById('model-select');
        const reasoningSelect = document.getElementById('reasoning-effort-select');
        const selectedModel = modelSelect ? modelSelect.value : this.state.selectedModel;
        const reasoningEffort = reasoningSelect ? reasoningSelect.value : this.state.reasoningEffort;

        if (!prompt) {
            this.showToast('Please enter a prompt', 'warning');
            return;
        }

        this.showLoading(true);

        try {
            const response = await this.api.sendCanvasRequest({
                message: prompt,
                sessionId: this.state.sessionId,
                canvasType: this.state.canvasType,
                existingContent: context || this.editor.getValue(),
                model: selectedModel,
                reasoningEffort,
            });

            this.handleAIResponse(response);
            this.showToast('AI response received', 'success');
        } catch (error) {
            console.error('AI request failed:', error);
            this.showToast(`Error: ${error.message}`, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * Handle AI response
     * @param {Object} response 
     */
    handleAIResponse(response) {
        this.state.aiResponse = response;
        this.state.sessionId = response.sessionId || this.state.sessionId;
        this.state.metadata = response.metadata || {};
        this.state.suggestions = response.suggestions || [];

        // Update session ID display
        document.getElementById('session-id').textContent = 
            this.state.sessionId ? this.state.sessionId.slice(0, 16) + '...' : 'New Session';

        // Show response preview
        const responseSection = document.getElementById('ai-response-section');
        const responsePreview = document.getElementById('response-preview');
        
        responseSection.classList.remove('hidden');
        responsePreview.textContent = response.content?.slice(0, 500) + 
            (response.content?.length > 500 ? '...' : '');

        // Update suggestions
        this.updateSuggestions(response.suggestions || []);

        // Update metadata
        if (response.canvasType && response.canvasType !== this.state.canvasType) {
            this.switchCanvasType(response.canvasType);
        }

        this.saveToLocalStorage();
    }

    /**
     * Apply AI response to canvas
     */
    applyAIResponse() {
        if (!this.state.aiResponse?.content) {
            this.showToast('No AI response to apply', 'warning');
            return;
        }

        // Push current state to history
        this.pushToHistory();

        // Apply content
        const content = this.state.aiResponse.content;
        this.editor.setValue(content);
        this.state.content = content;

        // Update metadata if available
        if (this.state.metadata?.language) {
            const handler = this.typeManager.getHandler('code');
            const mode = handler.getCodeMirrorMode(this.state.metadata.language);
            this.editor.setMode(mode);
        }

        // Hide response section
        document.getElementById('ai-response-section').classList.add('hidden');
        
        // Update tab title
        const title = this.state.metadata?.title || 'Untitled';
        document.getElementById('tab-title').textContent = title;

        this.saveToLocalStorage();
        this.showToast('Content applied to canvas', 'success');
    }

    /**
     * Update suggestions panel
     * @param {Array} suggestions 
     */
    updateSuggestions(suggestions) {
        const panel = document.getElementById('suggestions-panel');
        const list = document.getElementById('suggestions-list');

        if (!suggestions || suggestions.length === 0) {
            panel.classList.add('hidden');
            return;
        }

        panel.classList.remove('hidden');
        list.innerHTML = '';

        suggestions.forEach(suggestion => {
            const chip = document.createElement('button');
            chip.className = 'suggestion-chip';
            chip.textContent = suggestion;
            chip.addEventListener('click', () => {
                document.getElementById('prompt-input').value = suggestion;
            });
            list.appendChild(chip);
        });
    }

    /**
     * Push current state to history
     */
    pushToHistory() {
        this.history.push({
            content: this.editor.getValue(),
            canvasType: this.state.canvasType,
            metadata: { ...this.state.metadata }
        });
    }

    /**
     * Undo last change
     */
    undo() {
        const state = this.history.undo();
        if (state) {
            this.restoreState(state);
            this.showToast('Undo', 'info');
        }
    }

    /**
     * Redo last undone change
     */
    redo() {
        const state = this.history.redo();
        if (state) {
            this.restoreState(state);
            this.showToast('Redo', 'info');
        }
    }

    /**
     * Restore state from history
     * @param {Object} state 
     */
    restoreState(state) {
        if (state.canvasType !== this.state.canvasType) {
            this.switchCanvasType(state.canvasType);
        }
        this.editor.setValue(state.content);
        this.state.metadata = { ...state.metadata };
    }

    /**
     * Toggle between dark and light theme
     */
    toggleTheme() {
        const html = document.documentElement;
        const currentTheme = html.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        html.setAttribute('data-theme', newTheme);
        
        // Update editor theme
        const editorTheme = newTheme === 'dark' ? 'dracula' : 'eclipse';
        this.editor.setTheme(editorTheme);

        // Update mermaid theme if diagram mode
        if (this.state.canvasType === 'diagram') {
            const handler = this.typeManager.getHandler('diagram');
            handler.updateTheme(newTheme);
            this.renderPreview();
        }

        localStorage.setItem('canvas-theme', newTheme);
    }

    /**
     * Create new session
     */
    newSession() {
        // Save current session if dirty
        if (this.editor.isDirtyState()) {
            this.saveToLocalStorage();
        }

        // Clear state
        this.state.sessionId = null;
        this.state.content = '';
        this.state.metadata = {};
        this.state.aiResponse = null;
        this.history.clear();

        // Clear API session
        this.api.clearSession();

        // Reset UI
        document.getElementById('session-id').textContent = 'New Session';
        document.getElementById('prompt-input').value = '';
        document.getElementById('context-input').value = '';
        document.getElementById('ai-response-section').classList.add('hidden');
        document.getElementById('suggestions-panel').classList.add('hidden');

        // Set default content
        const handler = this.typeManager.getCurrentHandler();
        this.editor.setValue(handler.getDefaultContent(), true);

        // Clear localStorage
        localStorage.removeItem('canvas-session');

        this.showToast('New session started', 'success');
    }

    /**
     * Copy content to clipboard
     */
    async copyToClipboard() {
        const content = this.editor.getValue();
        if (!content.trim()) {
            this.showToast('Nothing to copy', 'warning');
            return;
        }

        const success = await this.exportManager.copyToClipboard(content);
        if (success) {
            this.showToast('Copied to clipboard!', 'success');
        } else {
            this.showToast('Failed to copy to clipboard', 'error');
        }
    }

    /**
     * Download file
     */
    downloadFile() {
        const content = this.editor.getValue();
        const handler = this.typeManager.getCurrentHandler();
        const language = this.state.metadata?.language || '';
        const title = this.state.metadata?.title || '';

        if (!content.trim()) {
            this.showToast('Nothing to download', 'warning');
            return;
        }

        try {
            if (this.state.canvasType === 'diagram') {
                // For diagrams, offer SVG/PNG export
                const svgElement = document.querySelector('#diagram-output svg');
                if (svgElement) {
                    this.showDiagramExportOptions(svgElement);
                    return;
                }
            }

            this.exportManager.downloadFile(
                content,
                this.state.canvasType,
                language,
                title
            );

            this.showToast('File downloaded successfully!', 'success');
        } catch (error) {
            console.error('Download failed:', error);
            this.showToast('Failed to download file', 'error');
        }
    }

    /**
     * Show diagram export options
     * @param {HTMLElement} svgElement 
     */
    showDiagramExportOptions(svgElement) {
        const options = [
            { label: 'Mermaid Source (.mmd)', action: () => {
                this.exportManager.downloadFile(
                    this.editor.getValue(),
                    'diagram',
                    'mmd'
                );
            }},
            { label: 'SVG Image (.svg)', action: () => {
                this.exportManager.downloadSVG(svgElement.outerHTML);
            }},
            { label: 'PNG Image (.png)', action: async () => {
                await this.exportManager.downloadPNG(svgElement);
            }}
        ];

        // Create simple modal
        const modal = document.createElement('div');
        modal.className = 'toast info';
        modal.innerHTML = `
            <div class="toast-message">
                <strong>Export Diagram</strong><br>
                ${options.map((opt, i) => `<button class="btn btn-secondary" style="margin: 4px;" data-index="${i}">${opt.label}</button>`).join('')}
            </div>
            <button class="toast-close">&times;</button>
        `;

        modal.querySelectorAll('[data-index]').forEach(btn => {
            btn.addEventListener('click', () => {
                options[btn.dataset.index].action();
                modal.remove();
            });
        });

        modal.querySelector('.toast-close').addEventListener('click', () => {
            modal.remove();
        });

        document.getElementById('toast-container').appendChild(modal);
    }

    /**
     * Schedule auto-save
     */
    scheduleAutoSave() {
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
        }

        document.getElementById('save-status').textContent = 'Unsaved';
        document.getElementById('save-status').classList.add('unsaved');

        this.autoSaveTimer = setTimeout(() => {
            this.saveToLocalStorage();
        }, 2000);
    }

    /**
     * Save to localStorage
     */
    saveToLocalStorage() {
        const data = {
            sessionId: this.state.sessionId,
            canvasType: this.state.canvasType,
            content: this.editor.getValue(),
            metadata: this.state.metadata,
            selectedModel: this.state.selectedModel || '',
            reasoningEffort: this.state.reasoningEffort || '',
            timestamp: Date.now()
        };

        localStorage.setItem('canvas-session', JSON.stringify(data));
        localStorage.setItem('canvas-history', this.history.serialize());

        document.getElementById('save-status').textContent = 'Saved';
        document.getElementById('save-status').classList.remove('unsaved');
        
        this.state.lastSaved = new Date();
        this.editor.setDirty(false);
    }

    /**
     * Load from localStorage
     */
    loadFromLocalStorage() {
        // Load theme
        const savedTheme = localStorage.getItem('canvas-theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);

        // Load session
        const saved = localStorage.getItem('canvas-session');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                this.state.sessionId = data.sessionId;
                this.state.canvasType = data.canvasType || 'code';
                this.state.content = data.content || '';
                this.state.metadata = data.metadata || {};
                this.state.selectedModel = data.selectedModel || this.state.selectedModel || 'gpt-4o';
                this.state.reasoningEffort = ['low', 'medium', 'high', 'xhigh'].includes(data.reasoningEffort)
                    ? data.reasoningEffort
                    : '';

                // Restore API session
                if (data.sessionId) {
                    this.api.setSessionId(data.sessionId);
                }

                // Restore type
                this.typeManager.setType(this.state.canvasType);
            } catch (error) {
                console.error('Failed to load session:', error);
            }
        }

        // Load history
        const savedHistory = localStorage.getItem('canvas-history');
        if (savedHistory) {
            this.history.deserialize(savedHistory);
        }
    }

    /**
     * Update UI elements
     */
    updateUI() {
        // Update theme toggle
        const theme = document.documentElement.getAttribute('data-theme');

        // Update canvas type buttons
        document.querySelectorAll('.type-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === this.state.canvasType);
        });

        const modelSelect = document.getElementById('model-select');
        if (modelSelect && this.state.selectedModel) {
            modelSelect.value = this.state.selectedModel;
        }

        const reasoningSelect = document.getElementById('reasoning-effort-select');
        if (reasoningSelect) {
            reasoningSelect.value = this.state.reasoningEffort || '';
        }

        // Update session ID
        if (this.state.sessionId) {
            document.getElementById('session-id').textContent = 
                this.state.sessionId.slice(0, 16) + '...';
        }

        this.updateStatusBar();
    }

    /**
     * Update status bar
     */
    updateStatusBar() {
        const stats = this.editor.getStats();
        const handler = this.typeManager.getHandler(this.state.canvasType);
        const lang = this.state.metadata?.language || '';

        document.getElementById('canvas-type-badge').textContent = 
            handler.getInfo().name;
        
        const langBadge = document.getElementById('language-badge');
        if (lang && this.state.canvasType === 'code') {
            langBadge.textContent = handler.getLanguageLabel?.(lang) || lang;
            langBadge.classList.remove('hidden');
        } else {
            langBadge.classList.add('hidden');
        }

        document.getElementById('word-count').textContent = 
            `${stats.wordCount} words`;
        document.getElementById('line-count').textContent = 
            `${stats.lineCount} lines`;

        // Update dirty indicator
        const tabDirty = document.querySelector('.tab-dirty');
        if (stats.isDirty) {
            tabDirty.classList.remove('hidden');
        } else {
            tabDirty.classList.add('hidden');
        }
    }

    /**
     * Show/hide loading overlay with progress bar
     * @param {boolean} show 
     */
    showLoading(show) {
        const overlay = document.getElementById('loading-overlay');
        const progressBar = document.getElementById('loading-progress-bar');
        
        if (show) {
            overlay.classList.remove('hidden');
            // Animate progress bar
            if (progressBar) {
                progressBar.style.width = '0%';
                setTimeout(() => { progressBar.style.width = '30%'; }, 100);
                setTimeout(() => { progressBar.style.width = '60%'; }, 500);
                setTimeout(() => { progressBar.style.width = '85%'; }, 1000);
            }
        } else {
            if (progressBar) {
                progressBar.style.width = '100%';
            }
            setTimeout(() => {
                overlay.classList.add('hidden');
                if (progressBar) {
                    progressBar.style.width = '0%';
                }
            }, 300);
        }
    }

    /**
     * Show toast notification
     * @param {string} message 
     * @param {string} type - 'success', 'error', 'warning', 'info'
     */
    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span class="toast-message">${message}</span>
            <button class="toast-close">&times;</button>
        `;

        toast.querySelector('.toast-close').addEventListener('click', () => {
            toast.remove();
        });

        container.appendChild(toast);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 3000);
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.canvasApp = new CanvasApp();
});
