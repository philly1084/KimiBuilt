/**
 * Notation Helper - Main Application
 * Integrates all modules and handles UI interactions
 */

(function() {
    'use strict';

    // Application state
    const App = {
        currentMode: 'expand',
        isProcessing: false,
        sidebarOpen: true,
        currentTemplateCategory: 'all',

        // DOM Element references
        elements: {},

        /**
         * Initialize the application
         */
        init() {
            this._cacheElements();
            this._initModules();
            this._bindEvents();
            this._renderTemplates();
            this._renderHistory();
            this._checkConnection();

            console.log('Notation Helper initialized');
        },

        /**
         * Cache DOM element references
         * @private
         */
        _cacheElements() {
            this.elements = {
                // Header
                themeToggle: document.getElementById('themeToggle'),
                settingsBtn: document.getElementById('settingsBtn'),
                connectionStatus: document.getElementById('connectionStatus'),
                modeBtns: document.querySelectorAll('.mode-btn'),

                // Sidebar
                sidebar: document.getElementById('sidebar'),
                sidebarTabs: document.querySelectorAll('.sidebar-tab'),
                templateList: document.getElementById('templateList'),
                historyList: document.getElementById('historyList'),
                categoryBtns: document.querySelectorAll('.category-btn'),
                clearHistoryBtn: document.getElementById('clearHistoryBtn'),

                // Context
                toggleContext: document.getElementById('toggleContext'),
                contextContent: document.getElementById('contextContent'),
                contextInput: document.getElementById('contextInput'),

                // Editor
                notationInput: document.getElementById('notationInput'),
                charCount: document.getElementById('charCount'),
                lineCount: document.getElementById('lineCount'),
                clearInput: document.getElementById('clearInput'),
                loadTemplateBtn: document.getElementById('loadTemplateBtn'),
                processBtn: document.getElementById('processBtn'),
                processWithContextBtn: document.getElementById('processWithContextBtn'),

                // Output
                outputEmpty: document.getElementById('outputEmpty'),
                outputContent: document.getElementById('outputContent'),
                outputRendered: document.getElementById('outputRendered'),
                modeBadge: document.getElementById('modeBadge'),
                suggestionsPanel: document.getElementById('suggestionsPanel'),
                suggestionsList: document.getElementById('suggestionsList'),

                // Annotations
                annotationsPanel: document.getElementById('annotationsPanel'),
                annotationsList: document.getElementById('annotationsList'),
                toggleAnnotations: document.getElementById('toggleAnnotations'),

                // Export
                copyResult: document.getElementById('copyResult'),
                exportMd: document.getElementById('exportMd'),
                exportAnnotations: document.getElementById('exportAnnotations'),

                // Loading
                loadingOverlay: document.getElementById('loadingOverlay'),

                // Toast
                toastContainer: document.getElementById('toastContainer'),

                // Resize
                resizeHandle: document.getElementById('resizeHandle'),
                inputPane: document.querySelector('.input-pane'),
                dualPane: document.getElementById('dualPane')
            };
        },

        /**
         * Initialize all modules
         * @private
         */
        _initModules() {
            // Initialize Editor
            if (window.EditorManager) {
                EditorManager.init({
                    textarea: this.elements.notationInput,
                    charCount: this.elements.charCount,
                    lineCount: this.elements.lineCount,
                    clearBtn: this.elements.clearInput
                });
            }

            // Initialize Output
            if (window.OutputManager) {
                OutputManager.init({
                    container: this.elements.outputContent,
                    empty: this.elements.outputEmpty,
                    content: this.elements.outputContent,
                    rendered: this.elements.outputRendered,
                    suggestionsPanel: this.elements.suggestionsPanel,
                    suggestionsList: this.elements.suggestionsList,
                    modeBadge: this.elements.modeBadge
                });
            }

            // Initialize Annotations
            if (window.AnnotationsManager) {
                AnnotationsManager.init({
                    panel: this.elements.annotationsPanel,
                    list: this.elements.annotationsList,
                    toggle: this.elements.toggleAnnotations,
                    output: this.elements.outputRendered
                });
            }

            // Initialize API
            if (window.NotationAPI) {
                NotationAPI.init({
                    baseUrl: 'http://localhost:3000',
                    wsUrl: 'ws://localhost:3000'
                }, {
                    onConnect: () => this._updateConnectionStatus('connected'),
                    onDisconnect: () => this._updateConnectionStatus('disconnected'),
                    onError: (err) => this._handleError(err),
                    onMessage: (data) => this._handleResponse(data),
                    onStatusChange: (status) => this._handleStatusChange(status)
                });
            }
        },

        /**
         * Bind event listeners
         * @private
         */
        _bindEvents() {
            // Mode selector
            this.elements.modeBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    this._setMode(btn.dataset.mode);
                });
            });

            // Theme toggle
            this.elements.themeToggle.addEventListener('click', () => this._toggleTheme());

            // Sidebar tabs
            this.elements.sidebarTabs.forEach(tab => {
                tab.addEventListener('click', () => this._switchSidebarTab(tab.dataset.panel));
            });

            // Template categories
            this.elements.categoryBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    this.currentTemplateCategory = btn.dataset.category;
                    this._setActiveCategory(btn);
                    this._renderTemplates();
                });
            });

            // Clear history
            this.elements.clearHistoryBtn.addEventListener('click', () => this._clearHistory());

            // Context toggle
            this.elements.toggleContext.addEventListener('click', () => this._toggleContext());

            // Process buttons
            this.elements.processBtn.addEventListener('click', () => this._processNotation(false));
            this.elements.processWithContextBtn.addEventListener('click', () => this._processNotation(true));

            // Document events for keyboard shortcuts
            document.addEventListener('processNotation', (e) => {
                this._processNotation(e.detail?.withContext || false);
            });

            // Export buttons
            this.elements.copyResult.addEventListener('click', () => this._copyResult());
            this.elements.exportMd.addEventListener('click', () => this._exportMarkdown());
            this.elements.exportAnnotations.addEventListener('click', () => this._exportAnnotations());

            // Load template button
            this.elements.loadTemplateBtn.addEventListener('click', () => {
                this._switchSidebarTab('templates');
            });

            // Template loaded event
            document.addEventListener('templateLoaded', (e) => {
                if (e.detail.mode) {
                    this._setMode(e.detail.mode);
                }
                this._showToast('Template loaded', 'success');
            });

            // Pane resize
            this._initResizeHandler();

            // Window resize for responsive
            window.addEventListener('resize', () => this._handleResize());
        },

        /**
         * Set the current mode
         * @param {string} mode - Mode name (expand, explain, validate)
         * @private
         */
        _setMode(mode) {
            this.currentMode = mode;
            document.body.setAttribute('data-mode', mode);

            // Update UI
            this.elements.modeBtns.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.mode === mode);
            });

            // Update mode badge
            if (this.elements.modeBadge) {
                this.elements.modeBadge.textContent = mode;
            }
        },

        /**
         * Toggle theme between dark and light
         * @private
         */
        _toggleTheme() {
            const currentTheme = document.body.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            
            document.body.setAttribute('data-theme', newTheme);
            
            // Update editor theme
            if (window.EditorManager) {
                EditorManager.setTheme(newTheme === 'dark' ? 'dracula' : 'default');
            }

            // Update icon
            const icon = this.elements.themeToggle.querySelector('i');
            icon.className = newTheme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';

            // Save preference
            localStorage.setItem('notation-helper-theme', newTheme);
        },

        /**
         * Switch sidebar panel
         * @param {string} panel - Panel name
         * @private
         */
        _switchSidebarTab(panel) {
            // Update tabs
            this.elements.sidebarTabs.forEach(tab => {
                tab.classList.toggle('active', tab.dataset.panel === panel);
            });

            // Update panels
            document.querySelectorAll('.sidebar-panel').forEach(p => {
                p.classList.toggle('active', p.id === `${panel}Panel`);
            });
        },

        /**
         * Set active category button
         * @param {HTMLElement} activeBtn - Active button
         * @private
         */
        _setActiveCategory(activeBtn) {
            this.elements.categoryBtns.forEach(btn => {
                btn.classList.toggle('active', btn === activeBtn);
            });
        },

        /**
         * Render templates list
         * @private
         */
        _renderTemplates() {
            if (!this.elements.templateList || !window.NotationTemplates) return;

            const templates = NotationTemplates.getByCategory(this.currentTemplateCategory);
            
            this.elements.templateList.innerHTML = templates.map(t => `
                <div class="template-item" data-id="${t.id}">
                    <div class="template-category">${t.category}</div>
                    <div class="template-name">
                        <i class="${NotationTemplates.getCategoryIcon(t.category)}"></i>
                        ${t.name}
                    </div>
                    <div class="template-preview">${t.notation.replace(/\n/g, ' ')}</div>
                </div>
            `).join('');

            // Bind click events
            this.elements.templateList.querySelectorAll('.template-item').forEach(item => {
                item.addEventListener('click', () => {
                    const template = NotationTemplates.getById(item.dataset.id);
                    if (template && window.EditorManager) {
                        EditorManager.loadTemplate(template);
                    }
                });
            });
        },

        /**
         * Render history list
         * @private
         */
        _renderHistory() {
            if (!this.elements.historyList || !window.NotationHistory) return;

            const history = NotationHistory.getRecent(20);

            if (history.length === 0) {
                this.elements.historyList.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-clock"></i>
                        <p>No recent sessions</p>
                    </div>
                `;
                return;
            }

            this.elements.historyList.innerHTML = history.map(h => `
                <div class="history-item" data-id="${h.id}">
                    <span class="history-mode mode-${h.mode}">${h.mode}</span>
                    <div class="history-preview">${NotationHistory.getPreview(h.notation)}</div>
                    <div class="history-time">${NotationHistory.formatDate(h.timestamp)}</div>
                </div>
            `).join('');

            // Bind click events
            this.elements.historyList.querySelectorAll('.history-item').forEach(item => {
                item.addEventListener('click', () => {
                    const historyItem = NotationHistory.getById(item.dataset.id);
                    if (historyItem) {
                        this._loadHistoryItem(historyItem);
                    }
                });
            });
        },

        /**
         * Load a history item into the editor
         * @param {Object} item - History item
         * @private
         */
        _loadHistoryItem(item) {
            if (window.EditorManager) {
                EditorManager.setValue(item.notation);
            }
            
            if (item.context && this.elements.contextInput) {
                this.elements.contextInput.value = item.context;
                this.elements.contextContent.classList.add('expanded');
                this.elements.toggleContext.classList.add('expanded');
            }

            this._setMode(item.mode);

            // Display result if available
            if (item.result && window.OutputManager) {
                OutputManager.display({
                    result: item.result,
                    mode: item.mode,
                    annotations: item.annotations || [],
                    suggestions: item.suggestions || []
                });
            }

            this._showToast('History item loaded', 'info');
        },

        /**
         * Clear all history
         * @private
         */
        _clearHistory() {
            if (confirm('Clear all history? This cannot be undone.')) {
                NotationHistory.clear();
                this._renderHistory();
                this._showToast('History cleared', 'info');
            }
        },

        /**
         * Toggle context panel
         * @private
         */
        _toggleContext() {
            this.elements.contextContent.classList.toggle('expanded');
            this.elements.toggleContext.classList.toggle('expanded');
        },

        /**
         * Process notation
         * @param {boolean} withContext - Whether to include context
         * @private
         */
        async _processNotation(withContext = false) {
            if (this.isProcessing) return;

            const notation = window.EditorManager ? EditorManager.getValue() : '';
            
            if (!notation.trim()) {
                this._showToast('Please enter some notation first', 'warning');
                return;
            }

            const context = withContext && this.elements.contextInput 
                ? this.elements.contextInput.value 
                : '';

            this.isProcessing = true;
            this._showLoading(true);

            try {
                // Try WebSocket first
                const wsSuccess = window.NotationAPI && NotationAPI.processWS({
                    notation,
                    helperMode: this.currentMode,
                    context
                });

                // Fallback to HTTP if WebSocket fails or isn't connected
                if (!wsSuccess) {
                    const response = await NotationAPI.process({
                        notation,
                        helperMode: this.currentMode,
                        context
                    });
                    this._handleResponse({ content: response });
                }
            } catch (error) {
                this._handleError(error);
            }
        },

        /**
         * Handle API response
         * @param {Object} data - Response data
         * @private
         */
        _handleResponse(data) {
            this.isProcessing = false;
            this._showLoading(false);

            const content = data.content || {};
            
            // Display result
            if (window.OutputManager) {
                OutputManager.display({
                    result: content.result || content.content || 'No result',
                    mode: content.helperMode || this.currentMode,
                    annotations: content.annotations || [],
                    suggestions: content.suggestions || []
                });
            }

            // Save to history
            if (window.NotationHistory && window.EditorManager) {
                NotationHistory.add({
                    notation: EditorManager.getValue(),
                    result: content.result || content.content || '',
                    mode: content.helperMode || this.currentMode,
                    context: this.elements.contextInput?.value || '',
                    annotations: content.annotations || [],
                    suggestions: content.suggestions || [],
                    sessionId: data.sessionId
                });
                this._renderHistory();
            }

            this._showToast('Processing complete', 'success');
        },

        /**
         * Handle errors
         * @param {Error} error - Error object
         * @private
         */
        _handleError(error) {
            this.isProcessing = false;
            this._showLoading(false);

            console.error('Processing error:', error);
            this._showToast(error.message || 'An error occurred', 'error');
        },

        /**
         * Handle status changes
         * @param {string} status - Status string
         * @private
         */
        _handleStatusChange(status) {
            const statusMap = {
                'connected': 'Connected',
                'disconnected': 'Disconnected',
                'connecting': 'Connecting...',
                'reconnecting': 'Reconnecting...',
                'processing': 'Processing...',
                'error': 'Error',
                'idle': 'Ready',
                'failed': 'Failed'
            };

            this._updateConnectionStatus(status);
        },

        /**
         * Update connection status UI
         * @param {string} status - Status string
         * @private
         */
        _updateConnectionStatus(status) {
            if (!this.elements.connectionStatus) return;

            const statusText = this.elements.connectionStatus.querySelector('.status-text');
            
            this.elements.connectionStatus.className = 'connection-status';
            
            switch (status) {
                case 'connected':
                    this.elements.connectionStatus.classList.add('connected');
                    if (statusText) statusText.textContent = 'Connected';
                    break;
                case 'error':
                case 'failed':
                    this.elements.connectionStatus.classList.add('error');
                    if (statusText) statusText.textContent = 'Error';
                    break;
                default:
                    if (statusText) statusText.textContent = status.charAt(0).toUpperCase() + status.slice(1);
            }
        },

        /**
         * Check backend connection
         * @private
         */
        async _checkConnection() {
            if (window.NotationAPI) {
                const healthy = await NotationAPI.healthCheck();
                this._updateConnectionStatus(healthy ? 'connected' : 'error');
            }
        },

        /**
         * Show/hide loading overlay
         * @param {boolean} show - Whether to show
         * @private
         */
        _showLoading(show) {
            if (this.elements.loadingOverlay) {
                this.elements.loadingOverlay.classList.toggle('hidden', !show);
            }
        },

        /**
         * Copy result to clipboard
         * @private
         */
        async _copyResult() {
            if (window.OutputManager) {
                const success = await OutputManager.copyToClipboard();
                this._showToast(success ? 'Copied to clipboard' : 'Failed to copy', success ? 'success' : 'error');
            }
        },

        /**
         * Export as Markdown
         * @private
         */
        _exportMarkdown() {
            if (window.OutputManager) {
                OutputManager.exportAsMarkdown();
                this._showToast('Exporting as Markdown...', 'info');
            }
        },

        /**
         * Export with annotations
         * @private
         */
        _exportAnnotations() {
            if (window.OutputManager) {
                OutputManager.exportWithAnnotations();
                this._showToast('Exporting with annotations...', 'info');
            }
        },

        /**
         * Show toast notification
         * @param {string} message - Toast message
         * @param {string} type - Toast type (success, error, warning, info)
         * @private
         */
        _showToast(message, type = 'info') {
            if (!this.elements.toastContainer) return;

            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            
            const icons = {
                success: 'fa-check-circle',
                error: 'fa-exclamation-circle',
                warning: 'fa-exclamation-triangle',
                info: 'fa-info-circle'
            };

            toast.innerHTML = `
                <i class="fas ${icons[type] || icons.info}"></i>
                <span>${message}</span>
            `;

            this.elements.toastContainer.appendChild(toast);

            // Remove after delay
            setTimeout(() => {
                toast.classList.add('removing');
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        },

        /**
         * Initialize resize handler for panes
         * @private
         */
        _initResizeHandler() {
            if (!this.elements.resizeHandle || !this.elements.inputPane) return;

            let isResizing = false;
            let startX, startWidth;

            this.elements.resizeHandle.addEventListener('mousedown', (e) => {
                isResizing = true;
                startX = e.clientX;
                startWidth = this.elements.inputPane.offsetWidth;
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
            });

            document.addEventListener('mousemove', (e) => {
                if (!isResizing) return;

                const diff = e.clientX - startX;
                const newWidth = startWidth + diff;
                const containerWidth = this.elements.dualPane.offsetWidth;
                const minWidth = 300;
                const maxWidth = containerWidth - minWidth;

                if (newWidth >= minWidth && newWidth <= maxWidth) {
                    const percentage = (newWidth / containerWidth) * 100;
                    this.elements.inputPane.style.width = `${percentage}%`;
                }
            });

            document.addEventListener('mouseup', () => {
                if (isResizing) {
                    isResizing = false;
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                }
            });
        },

        /**
         * Handle window resize
         * @private
         */
        _handleResize() {
            // Reset pane widths on mobile
            if (window.innerWidth <= 768) {
                if (this.elements.inputPane) {
                    this.elements.inputPane.style.width = '';
                }
            }
        }
    };

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => App.init());
    } else {
        App.init();
    }

    // Expose App globally for debugging
    window.NotationApp = App;
})();
