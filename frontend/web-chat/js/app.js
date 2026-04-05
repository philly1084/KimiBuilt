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
        this.workloadsBtn = document.getElementById('workloads-btn');
        this.workloadsPanel = document.getElementById('workloads-panel');
        this.workloadsEmpty = document.getElementById('workloads-empty');
        this.workloadsList = document.getElementById('workloads-list');
        this.refreshWorkloadsBtn = document.getElementById('refresh-workloads-btn');
        this.newWorkloadBtn = document.getElementById('new-workload-btn');
        this.workloadModal = document.getElementById('workload-modal');
        this.workloadModalTitle = document.getElementById('workload-modal-title');
        this.workloadFormError = document.getElementById('workload-form-error');
        this.workloadScenarioInput = document.getElementById('workload-scenario-input');
        this.workloadScenarioBuildBtn = document.getElementById('workload-scenario-build-btn');
        this.workloadTriggerHelp = document.getElementById('workload-trigger-help');
        this.workloadTitleInput = document.getElementById('workload-title-input');
        this.workloadPromptInput = document.getElementById('workload-prompt-input');
        this.workloadTriggerType = document.getElementById('workload-trigger-type');
        this.workloadCallableSlug = document.getElementById('workload-callable-slug');
        this.workloadRunAt = document.getElementById('workload-run-at');
        this.workloadCronExpression = document.getElementById('workload-cron-expression');
        this.workloadTimezone = document.getElementById('workload-timezone');
        this.workloadProfile = document.getElementById('workload-profile');
        this.workloadToolIds = document.getElementById('workload-tool-ids');
        this.workloadMaxRounds = document.getElementById('workload-max-rounds');
        this.workloadMaxToolCalls = document.getElementById('workload-max-tool-calls');
        this.workloadMaxDuration = document.getElementById('workload-max-duration');
        this.workloadAllowSideEffects = document.getElementById('workload-allow-side-effects');
        this.workloadStagesJson = document.getElementById('workload-stages-json');
        this.workloadOnceRow = document.getElementById('workload-once-row');
        this.workloadCronRow = document.getElementById('workload-cron-row');
        this.workloadPresetGrid = document.getElementById('workload-preset-grid');
        this.workloadPresetSummary = document.getElementById('workload-preset-summary');
        this.saveWorkloadBtn = document.getElementById('save-workload-btn');
        this.cancelWorkloadBtn = document.getElementById('cancel-workload-btn');
        this.closeWorkloadModalBtn = document.getElementById('close-workload-modal-btn');
        
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
        this.workloadsOpen = false;
        this.workloadsAvailable = true;
        this.currentSessionWorkloads = [];
        this.workloadRunsById = new Map();
        this.hiddenCompletedWorkloadCount = 0;
        this.editingWorkload = null;
        this.workloadSocket = null;
        this.workloadSocketReconnectTimer = null;
        this.subscribedWorkloadSessionId = null;
        this.isRefreshingSessionSummaries = false;
        this.isLoadingWorkloads = false;
        this.isSavingWorkload = false;
        this.sharedSessionSyncTimer = null;
        
        this.init();
    }

    async init() {
        // Add preload class to prevent transitions on load
        document.body.classList.add('preload');
        
        // Initialize theme
        uiHelpers.initTheme();
        uiHelpers.initLayoutMode(this);
        
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
        this.startSharedSessionSyncInterval();
        
        // Load models in background
        uiHelpers.loadModels();
        
        // Load sessions
        await this.loadSessions();

        this.connectWorkloadSocket();
        
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

        this.workloadsBtn?.addEventListener('click', () => {
            this.toggleWorkloadsPanel();
        });
        this.refreshWorkloadsBtn?.addEventListener('click', () => {
            this.loadSessionWorkloads(sessionManager.currentSessionId, { force: true });
        });
        this.newWorkloadBtn?.addEventListener('click', () => {
            this.openWorkloadModal();
        });
        this.workloadScenarioBuildBtn?.addEventListener('click', () => {
            this.buildWorkloadFromScenario();
        });
        this.workloadTriggerType?.addEventListener('change', () => {
            this.updateWorkloadTriggerFields();
            this.clearWorkloadFormError();
        });
        [
            this.workloadScenarioInput,
            this.workloadTitleInput,
            this.workloadPromptInput,
            this.workloadCallableSlug,
            this.workloadRunAt,
            this.workloadCronExpression,
            this.workloadTimezone,
            this.workloadToolIds,
            this.workloadStagesJson,
        ].forEach((field) => {
            field?.addEventListener('input', () => {
                this.clearWorkloadFormError();
            });
        });
        this.workloadTimezone?.addEventListener('input', () => {
            this.renderWorkloadPresetTable(
                this.workloadCronExpression?.value || '',
                this.workloadTimezone?.value || 'UTC',
            );
        });
        this.workloadCronExpression?.addEventListener('input', () => {
            this.renderWorkloadPresetTable(
                this.workloadCronExpression?.value || '',
                this.workloadTimezone?.value || 'UTC',
            );
        });
        this.workloadModal?.addEventListener('click', (event) => {
            const preset = event.target.closest('[data-workload-preset-expression]');
            if (preset) {
                this.applyWorkloadPreset({
                    expression: preset.dataset.workloadPresetExpression || '',
                    label: preset.dataset.workloadPresetLabel || '',
                });
                return;
            }

            if (event.target?.dataset?.closeWorkloadModal === 'true') {
                this.closeWorkloadModal();
            }
        });
        this.saveWorkloadBtn?.addEventListener('click', () => {
            this.saveWorkload();
        });
        this.cancelWorkloadBtn?.addEventListener('click', () => {
            this.closeWorkloadModal();
        });
        this.closeWorkloadModalBtn?.addEventListener('click', () => {
            this.closeWorkloadModal();
        });
        this.workloadsList?.addEventListener('click', (event) => {
            const actionNode = event.target.closest('[data-workload-action]');
            if (!actionNode) {
                return;
            }

            this.handleWorkloadAction(
                actionNode.dataset.workloadAction,
                actionNode.dataset.workloadId,
            );
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
                void this.refreshSharedSessionState().catch((error) => {
                    console.warn('Failed to refresh shared session state:', error);
                });
            }
        });

        window.addEventListener('focus', () => {
            void this.refreshSharedSessionState().catch((error) => {
                console.warn('Failed to refresh shared session state:', error);
            });
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
            this.renderWorkloadsPanel();
        });
        
        sessionManager.addEventListener('sessionCreated', (e) => {
            apiClient.setSessionId(e.detail.session.id);
            uiHelpers.renderSessionsList(sessionManager.sessions, sessionManager.currentSessionId);
            this.loadSessionMessages(e.detail.session.id);
            this.subscribeToSessionUpdates(e.detail.session.id);
            this.loadSessionWorkloads(e.detail.session.id);
            this.updateSessionInfo();
        });
        
        sessionManager.addEventListener('sessionSwitched', (e) => {
            apiClient.setSessionId(e.detail.sessionId);
            this.loadSessionMessages(e.detail.sessionId)
                .finally(() => {
                    this.subscribeToSessionUpdates(e.detail.sessionId);
                    this.loadSessionWorkloads(e.detail.sessionId);
                    this.updateSessionInfo();
                    uiHelpers.closeSidebar();
                });
        });
        
        sessionManager.addEventListener('sessionDeleted', (e) => {
            apiClient.setSessionId(e.detail.newCurrentSessionId || null);
            if (e.detail.newCurrentSessionId) {
                this.loadSessionMessages(e.detail.newCurrentSessionId);
                this.subscribeToSessionUpdates(e.detail.newCurrentSessionId);
                this.loadSessionWorkloads(e.detail.newCurrentSessionId);
            } else {
                uiHelpers.clearMessages();
                uiHelpers.showWelcomeMessage();
                this.subscribeToSessionUpdates(null);
                this.currentSessionWorkloads = [];
                this.workloadRunsById.clear();
                this.hiddenCompletedWorkloadCount = 0;
                this.renderWorkloadsPanel();
            }
            this.updateSessionInfo();
        });
        
        sessionManager.addEventListener('messagesCleared', () => {
            uiHelpers.clearMessages();
            uiHelpers.showWelcomeMessage();
        });

        sessionManager.addEventListener('sessionPromoted', (e) => {
            this.subscribeToSessionUpdates(e.detail.sessionId);
            this.loadSessionWorkloads(e.detail.sessionId);
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

            // Toggle minimalist mode: Ctrl+Shift+M
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M') {
                e.preventDefault();
                uiHelpers.toggleMinimalistMode({ appInstance: this });
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
            } else if (modalId === 'workload-modal') {
                this.closeWorkloadModal();
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
            apiClient.setSessionId(sessionManager.currentSessionId || null);
            
            // If we have a current session, load its messages
            if (sessionManager.currentSessionId) {
                await this.loadSessionMessages(sessionManager.currentSessionId);
                await this.loadSessionWorkloads(sessionManager.currentSessionId);
                this.subscribeToSessionUpdates(sessionManager.currentSessionId);
            } else {
                this.renderWorkloadsPanel();
            }
            
            this.updateSessionInfo();
        } catch (error) {
            console.error('Failed to load sessions:', error);
            // Show empty state
            uiHelpers.renderSessionsList([], null);
            this.renderWorkloadsPanel();
        }
    }

    async createNewSession() {
        try {
            await sessionManager.createSession('chat');
            uiHelpers.hideWelcomeMessage();
            uiHelpers.clearMessages();
            this.loadSessionWorkloads(sessionManager.currentSessionId);
            this.messageInput?.focus();
            uiHelpers.showToast('New conversation started', 'success');
        } catch (error) {
            uiHelpers.showToast('Failed to create new session', 'error');
        }
    }

    async loadSessionMessages(sessionId, options = {}) {
        await sessionManager.loadSessionMessagesFromBackend(sessionId);
        const messages = this.syncAnnotatedSurveyStates(sessionId);
        this.renderMessages(messages);
        if (options.notifyNewAssistant === true && Array.isArray(options.previousMessages)) {
            this.playCueForNewAssistantMessages(options.previousMessages, messages);
        }
        return messages;
    }

    async loadSessionWorkloads(sessionId, options = {}) {
        if (!sessionId) {
            this.workloadsAvailable = true;
            this.currentSessionWorkloads = [];
            this.workloadRunsById.clear();
            this.hiddenCompletedWorkloadCount = 0;
            this.renderWorkloadsPanel();
            return [];
        }

        if (this.isLoadingWorkloads && !options.force) {
            return this.currentSessionWorkloads;
        }

        this.isLoadingWorkloads = true;
        try {
            const result = await apiClient.getSessionWorkloads(sessionId);
            this.workloadsAvailable = result.available !== false;
            const allWorkloads = Array.isArray(result.workloads) ? result.workloads : [];
            this.workloadRunsById = new Map();

            if (this.workloadsAvailable && allWorkloads.length > 0) {
                const runs = await Promise.all(allWorkloads.map((workload) =>
                    apiClient.getWorkloadRuns(workload.id, 6)
                        .then((items) => [workload.id, items])
                        .catch((error) => {
                            console.warn('Failed to load workload runs:', error);
                            return [workload.id, []];
                        })));

                runs.forEach(([workloadId, items]) => {
                    this.workloadRunsById.set(workloadId, items);
                });
            }

            this.currentSessionWorkloads = allWorkloads.filter((workload) => !this.shouldHideCompletedWorkload(
                workload,
                this.workloadRunsById.get(workload.id) || [],
            ));
            this.hiddenCompletedWorkloadCount = Math.max(0, allWorkloads.length - this.currentSessionWorkloads.length);

            this.renderWorkloadsPanel();
            return this.currentSessionWorkloads;
        } catch (error) {
            console.error('Failed to load workloads:', error);
            this.workloadsAvailable = true;
            this.currentSessionWorkloads = [];
            this.workloadRunsById.clear();
            this.hiddenCompletedWorkloadCount = 0;
            this.renderWorkloadsPanel();
            uiHelpers.showToast(error.message || 'Failed to load workloads', 'error');
            return [];
        } finally {
            this.isLoadingWorkloads = false;
        }
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

    updateSessionInfoLegacy() {
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

    toggleWorkloadsPanel() {
        this.workloadsOpen = !this.workloadsOpen;
        this.workloadsPanel?.classList.toggle('hidden', !this.workloadsOpen);

        if (this.workloadsOpen) {
            this.loadSessionWorkloads(sessionManager.currentSessionId, { force: true });
        }
    }

    renderWorkloadsPanel() {
        if (!this.workloadsPanel || !this.workloadsEmpty || !this.workloadsList) {
            return;
        }

        const sessionId = sessionManager.currentSessionId;
        if (this.refreshWorkloadsBtn) {
            this.refreshWorkloadsBtn.disabled = !sessionId || !this.workloadsAvailable;
        }
        if (this.newWorkloadBtn) {
            this.newWorkloadBtn.disabled = !sessionId || !this.workloadsAvailable;
        }

        if (!sessionId) {
            this.workloadsEmpty.textContent = 'Open a conversation to manage workloads.';
            this.workloadsEmpty.classList.remove('hidden');
            this.workloadsList.innerHTML = '';
            return;
        }

        if (!this.workloadsAvailable) {
            this.workloadsEmpty.textContent = 'Deferred workloads require Postgres-backed persistence.';
            this.workloadsEmpty.classList.remove('hidden');
            this.workloadsList.innerHTML = '';
            return;
        }

        if (this.currentSessionWorkloads.length === 0) {
            this.workloadsEmpty.textContent = this.hiddenCompletedWorkloadCount > 0
                ? 'No active workloads for this conversation. Completed one-time workloads are hidden.'
                : 'No workloads yet for this conversation.';
            this.workloadsEmpty.classList.remove('hidden');
            this.workloadsList.innerHTML = '';
            return;
        }

        this.workloadsEmpty.classList.add('hidden');
        this.workloadsList.innerHTML = this.currentSessionWorkloads
            .map((workload) => this.renderWorkloadCard(workload))
            .join('');
        uiHelpers.reinitializeIcons(this.workloadsList);
    }

    renderWorkloadCard(workload) {
        const runs = this.workloadRunsById.get(workload.id) || [];
        const summary = workload.workloadSummary || {};
        const runsMarkup = runs.length === 0
            ? '<div class="workload-run-empty">No runs yet.</div>'
            : runs.map((run) => `
                <div class="workload-run">
                    <span class="workload-run__status workload-run__status--${uiHelpers.escapeHtml(run.status || 'queued')}">${uiHelpers.escapeHtml(this.formatRunStatus(run.status))}</span>
                    <span class="workload-run__meta">${uiHelpers.escapeHtml(this.describeRun(run))}</span>
                </div>
            `).join('');

        return `
            <article class="workload-card" data-workload-id="${uiHelpers.escapeHtmlAttr(workload.id)}">
                <div class="workload-card__header">
                    <div>
                        <div class="workload-card__title-row">
                            <h3 class="workload-card__title">${uiHelpers.escapeHtml(workload.title || 'Untitled workload')}</h3>
                            <span class="workload-card__badge ${workload.enabled === false ? 'is-paused' : ''}">${workload.enabled === false ? 'Paused' : 'Active'}</span>
                        </div>
                        <div class="workload-card__meta">${uiHelpers.escapeHtml(this.describeTrigger(workload.trigger))}</div>
                        ${workload.callableSlug ? `<div class="workload-card__meta">Callable: <code>${uiHelpers.escapeHtml(workload.callableSlug)}</code></div>` : ''}
                    </div>
                    <div class="workload-card__actions">
                        <button class="btn-secondary px-3 py-2 rounded-lg text-sm" data-workload-action="run" data-workload-id="${uiHelpers.escapeHtmlAttr(workload.id)}">Run now</button>
                        <button class="btn-secondary px-3 py-2 rounded-lg text-sm" data-workload-action="edit" data-workload-id="${uiHelpers.escapeHtmlAttr(workload.id)}">Edit</button>
                        <button class="btn-secondary px-3 py-2 rounded-lg text-sm" data-workload-action="${workload.enabled === false ? 'resume' : 'pause'}" data-workload-id="${uiHelpers.escapeHtmlAttr(workload.id)}">${workload.enabled === false ? 'Resume' : 'Pause'}</button>
                        <button class="btn-icon danger p-2 rounded-lg" data-workload-action="delete" data-workload-id="${uiHelpers.escapeHtmlAttr(workload.id)}" aria-label="Delete workload">
                            <i data-lucide="trash-2" class="w-4 h-4" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>
                <p class="workload-card__prompt">${uiHelpers.escapeHtml(this.truncateWorkloadText(workload.prompt, 220))}</p>
                <div class="workload-card__summary">
                    <span>Queued ${Number(summary.queued || 0)}</span>
                    <span>Running ${Number(summary.running || 0)}</span>
                    <span>Failed ${Number(summary.failed || 0)}</span>
                    <span>Stages ${Array.isArray(workload.stages) ? workload.stages.length : 0}</span>
                </div>
                <div class="workload-runs">${runsMarkup}</div>
            </article>
        `;
    }

    truncateWorkloadText(text, limit = 220) {
        const normalized = String(text || '').trim().replace(/\s+/g, ' ');
        if (normalized.length <= limit) {
            return normalized;
        }

        return `${normalized.slice(0, limit - 3)}...`;
    }

    shouldHideCompletedWorkload(workload = {}, runs = []) {
        if (String(workload?.trigger?.type || 'manual').trim().toLowerCase() !== 'once') {
            return false;
        }

        const summary = workload?.workloadSummary || {};
        if (Number(summary.queued || 0) > 0 || Number(summary.running || 0) > 0 || Number(summary.failed || 0) > 0) {
            return false;
        }

        if (!Array.isArray(runs) || runs.length === 0) {
            return false;
        }

        const terminalStatuses = new Set(['completed', 'cancelled']);
        const statuses = runs
            .map((run) => String(run?.status || '').trim().toLowerCase())
            .filter(Boolean);

        return statuses.length > 0 && statuses.every((status) => terminalStatuses.has(status));
    }

    describeTrigger(trigger = {}) {
        if (!trigger || trigger.type === 'manual') {
            return 'Manual trigger';
        }

        if (trigger.type === 'once') {
            return `Runs once at ${this.formatDateTime(trigger.runAt)}`;
        }

        if (trigger.type === 'cron') {
            return this.translateCronExpression(trigger.expression || '', trigger.timezone || 'UTC');
        }

        return 'Manual trigger';
    }

    describeRun(run = {}) {
        const stage = Number.isFinite(Number(run.stageIndex)) && Number(run.stageIndex) >= 0
            ? `stage ${Number(run.stageIndex) + 1}`
            : 'base run';
        const at = run.finishedAt || run.startedAt || run.scheduledFor;
        return `${stage} | ${run.reason || 'manual'} | ${this.formatDateTime(at)}`;
    }

    formatRunStatus(status = '') {
        const normalized = String(status || '').trim().toLowerCase();
        if (!normalized) {
            return 'Queued';
        }

        return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }

    formatDateTime(value) {
        if (!value) {
            return 'now';
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return String(value);
        }

        return date.toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        });
    }

    getWorkloadPresetCatalog(timezone = 'UTC') {
        return [
            {
                id: 'daily-morning',
                expression: '0 9 * * *',
                label: `Every day at ${this.formatClock(9, 0)}`,
                description: 'Daily brief or inbox sweep.',
                timezone,
            },
            {
                id: 'weekday-morning',
                expression: '0 9 * * 1-5',
                label: `Every weekday at ${this.formatClock(9, 0)}`,
                description: 'Good for workday check-ins.',
                timezone,
            },
            {
                id: 'daily-late-night',
                expression: '5 23 * * *',
                label: `Every day at ${this.formatClock(23, 5)}`,
                description: 'Nightly wrap-up or end-of-day summary.',
                timezone,
            },
            {
                id: 'friday-wrap-up',
                expression: '0 16 * * 5',
                label: `Every Friday at ${this.formatClock(16, 0)}`,
                description: 'Weekly summary before the weekend.',
                timezone,
            },
        ];
    }

    formatClock(hour, minute) {
        const date = new Date();
        date.setHours(Number(hour) || 0, Number(minute) || 0, 0, 0);
        return date.toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
        });
    }

    translateCronExpression(expression = '', timezone = 'UTC') {
        const normalized = String(expression || '').trim();
        const parts = normalized.split(/\s+/).filter(Boolean);
        if (parts.length !== 5) {
            return normalized ? `Custom schedule (${normalized})` : 'Custom schedule';
        }

        const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
        const hourValue = Number(hour);
        const minuteValue = Number(minute);
        const hasFixedTime = Number.isInteger(hourValue) && Number.isInteger(minuteValue);
        const timeLabel = hasFixedTime ? this.formatClock(hourValue, minuteValue) : '';
        const dayNameMap = {
            0: 'Sunday',
            1: 'Monday',
            2: 'Tuesday',
            3: 'Wednesday',
            4: 'Thursday',
            5: 'Friday',
            6: 'Saturday',
            7: 'Sunday',
        };

        if (hasFixedTime && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
            return `Every day at ${timeLabel}`;
        }

        if (hasFixedTime && dayOfMonth === '*' && month === '*' && dayOfWeek === '1-5') {
            return `Every weekday at ${timeLabel}`;
        }

        if (hasFixedTime && dayOfMonth === '*' && month === '*' && /^\d$/.test(dayOfWeek)) {
            return `Every ${dayNameMap[Number(dayOfWeek)] || 'week'} at ${timeLabel}`;
        }

        if (hour === '*' && /^\d+$/.test(minute) && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
            return `Every hour at ${String(minute).padStart(2, '0')} minutes past`;
        }

        return `Custom cron ${normalized}${timezone ? ` (${timezone})` : ''}`;
    }

    renderWorkloadPresetTable(selectedExpression = '', timezone = 'UTC') {
        if (!this.workloadPresetGrid) {
            return;
        }

        const normalizedTimezone = String(timezone || '').trim() || 'UTC';
        const normalizedExpression = String(selectedExpression || '').trim();
        const presets = this.getWorkloadPresetCatalog(normalizedTimezone);

        this.workloadPresetGrid.innerHTML = presets.map((preset) => `
            <button
                type="button"
                class="workload-preset-card ${preset.expression === normalizedExpression ? 'is-selected' : ''}"
                data-workload-preset-expression="${uiHelpers.escapeHtmlAttr(preset.expression)}"
                data-workload-preset-label="${uiHelpers.escapeHtmlAttr(preset.label)}"
            >
                <span class="workload-preset-card__label">${uiHelpers.escapeHtml(preset.label)}</span>
                <span class="workload-preset-card__description">${uiHelpers.escapeHtml(preset.description)}</span>
            </button>
        `).join('');

        if (this.workloadPresetSummary) {
            if (!normalizedExpression) {
                this.workloadPresetSummary.textContent = '';
                this.workloadPresetSummary.classList.add('hidden');
            } else {
                this.workloadPresetSummary.textContent = this.translateCronExpression(
                    normalizedExpression,
                    normalizedTimezone,
                );
                this.workloadPresetSummary.classList.remove('hidden');
            }
        }
    }

    applyWorkloadPreset(preset = {}) {
        this.workloadTriggerType.value = 'cron';
        this.workloadCronExpression.value = String(preset.expression || '').trim();
        this.workloadTimezone.value = this.workloadTimezone.value.trim()
            || Intl.DateTimeFormat().resolvedOptions().timeZone
            || 'UTC';
        this.updateWorkloadTriggerFields();
        this.renderWorkloadPresetTable(
            this.workloadCronExpression.value,
            this.workloadTimezone.value,
        );
        this.clearWorkloadFormError();
        this.workloadCronExpression?.focus();
    }

    buildWorkloadFromScenario() {
        try {
            const scenario = this.workloadScenarioInput?.value?.trim() || '';
            if (!scenario) {
                throw new Error('Describe the task and when it should run.');
            }

            const timezone = this.workloadTimezone?.value?.trim()
                || Intl.DateTimeFormat().resolvedOptions().timeZone
                || 'UTC';
            const setup = this.parseScenarioToWorkload(scenario, timezone);

            this.workloadTitleInput.value = setup.title;
            this.workloadPromptInput.value = setup.prompt;

            this.workloadTriggerType.value = setup.trigger.type;
            this.workloadRunAt.value = setup.trigger.type === 'once'
                ? this.toDatetimeLocal(setup.trigger.runAt)
                : '';
            this.workloadCronExpression.value = setup.trigger.type === 'cron'
                ? setup.trigger.expression
                : '';
            this.workloadTimezone.value = setup.trigger.type === 'cron'
                ? setup.trigger.timezone
                : timezone;

            this.updateWorkloadTriggerFields();
            this.renderWorkloadPresetTable(
                this.workloadCronExpression.value,
                this.workloadTimezone.value,
            );
            this.clearWorkloadFormError();
            uiHelpers.showToast(
                setup.trigger.type === 'manual'
                    ? 'Task filled in. No schedule phrase detected, so it was left as manual.'
                    : 'Workload setup filled from your description',
                'success',
            );
        } catch (error) {
            this.showWorkloadFormError(error.message || 'Could not build workload setup from that description');
        }
    }

    parseScenarioToWorkload(scenario = '', timezone = 'UTC') {
        const normalizedScenario = String(scenario || '').trim();
        const lowerScenario = normalizedScenario.toLowerCase();
        const timeInfo = this.extractScenarioTime(normalizedScenario);
        const taskPrompt = this.extractTaskPromptFromScenario(normalizedScenario) || normalizedScenario;
        const title = this.deriveWorkloadTitle(taskPrompt);

        let trigger = { type: 'manual' };

        if (/(tomorrow|today|later today|once|one[- ]time)/i.test(lowerScenario)) {
            trigger = {
                type: 'once',
                runAt: this.buildOneTimeRunAt(lowerScenario, timeInfo).toISOString(),
            };
        } else if (/(every hour|hourly)/i.test(lowerScenario)) {
            trigger = {
                type: 'cron',
                expression: this.createCronExpression(timeInfo, 'hourly'),
                timezone,
            };
        } else if (/(weekday|weekdays|every workday|each workday)/i.test(lowerScenario)) {
            trigger = {
                type: 'cron',
                expression: this.createCronExpression(timeInfo, 'weekdays'),
                timezone,
            };
        } else {
            const weekdayMatch = lowerScenario.match(/\b(?:every|each)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/i);
            if (weekdayMatch) {
                trigger = {
                    type: 'cron',
                    expression: this.createCronExpression(timeInfo, weekdayMatch[1].toLowerCase()),
                    timezone,
                };
            } else if (/(daily|every day|each day|nightly|every night|every evening|every morning)/i.test(lowerScenario)) {
                trigger = {
                    type: 'cron',
                    expression: this.createCronExpression(timeInfo, 'daily'),
                    timezone,
                };
            }
        }

        return {
            title,
            prompt: taskPrompt,
            trigger,
        };
    }

    extractScenarioTime(input = '') {
        const text = String(input || '').trim();
        const twelveHourMatch = text.match(/\b(1[0-2]|0?\d)(?::([0-5]\d))?\s*(am|pm)\b/i);
        if (twelveHourMatch) {
            const rawHour = Number(twelveHourMatch[1]);
            const minute = Number(twelveHourMatch[2] || 0);
            const meridiem = twelveHourMatch[3].toLowerCase();
            let hour = rawHour % 12;
            if (meridiem === 'pm') {
                hour += 12;
            }

            return {
                hour,
                minute,
            };
        }

        const twentyFourHourMatch = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
        if (twentyFourHourMatch) {
            return {
                hour: Number(twentyFourHourMatch[1]),
                minute: Number(twentyFourHourMatch[2]),
            };
        }

        if (/\bmorning\b/i.test(text)) {
            return { hour: 9, minute: 0 };
        }
        if (/\bafternoon\b/i.test(text)) {
            return { hour: 14, minute: 0 };
        }
        if (/\bevening\b/i.test(text)) {
            return { hour: 18, minute: 0 };
        }
        if (/\bnight\b|\bnightly\b/i.test(text)) {
            return { hour: 23, minute: 0 };
        }

        return { hour: 9, minute: 0 };
    }

    buildOneTimeRunAt(lowerScenario = '', timeInfo = { hour: 9, minute: 0 }) {
        const now = new Date();
        const runAt = new Date(now);
        runAt.setSeconds(0, 0);
        runAt.setHours(timeInfo.hour, timeInfo.minute, 0, 0);

        if (/\btomorrow\b/i.test(lowerScenario)) {
            runAt.setDate(runAt.getDate() + 1);
            return runAt;
        }

        if (/\blater today\b/i.test(lowerScenario)) {
            if (runAt <= now) {
                runAt.setHours(now.getHours() + 1, 0, 0, 0);
            }
            return runAt;
        }

        if (/\btoday\b/i.test(lowerScenario)) {
            if (runAt <= now) {
                runAt.setDate(runAt.getDate() + 1);
            }
            return runAt;
        }

        if (runAt <= now) {
            runAt.setHours(now.getHours() + 1, 0, 0, 0);
        }

        return runAt;
    }

    createCronExpression(timeInfo = { hour: 9, minute: 0 }, cadence = 'daily') {
        const minute = Number(timeInfo.minute || 0);
        const hour = Number(timeInfo.hour || 0);
        const weekdayMap = {
            sunday: '0',
            monday: '1',
            tuesday: '2',
            wednesday: '3',
            thursday: '4',
            friday: '5',
            saturday: '6',
        };

        if (cadence === 'hourly') {
            return `${minute} * * * *`;
        }

        if (cadence === 'weekdays') {
            return `${minute} ${hour} * * 1-5`;
        }

        if (weekdayMap[cadence]) {
            return `${minute} ${hour} * * ${weekdayMap[cadence]}`;
        }

        return `${minute} ${hour} * * *`;
    }

    extractTaskPromptFromScenario(scenario = '') {
        const timeFragment = '(?:\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?|morning|afternoon|evening|night)';
        const leadingPatterns = [
            new RegExp(`^(?:every hour|hourly)(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
            new RegExp(`^(?:every|each)\\s+weekdays?(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
            new RegExp(`^(?:every|each)\\s+workdays?(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
            new RegExp(`^(?:daily|nightly)(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
            new RegExp(`^(?:every|each)\\s+day(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
            new RegExp(`^(?:every|each)\\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
            new RegExp(`^(?:once|one[- ]time)(?:\\s+(?:tomorrow|today|later today))?(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
            new RegExp(`^(?:tomorrow|today|later today)(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
        ];
        const embeddedPatterns = [
            new RegExp(`\\b(?:every hour|hourly)(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
            new RegExp(`\\b(?:every|each)\\s+weekdays?(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
            new RegExp(`\\b(?:every|each)\\s+workdays?(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
            new RegExp(`\\b(?:daily|nightly)(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
            new RegExp(`\\b(?:every|each)\\s+day(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
            new RegExp(`\\b(?:every|each)\\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
            new RegExp(`\\b(?:once|one[- ]time)(?:\\s+(?:tomorrow|today|later today))?(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
            new RegExp(`\\b(?:tomorrow|today|later today)(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
        ];

        let taskPrompt = String(scenario || '').trim();
        leadingPatterns.forEach((pattern) => {
            taskPrompt = taskPrompt.replace(pattern, '');
        });
        embeddedPatterns.forEach((pattern) => {
            taskPrompt = taskPrompt.replace(pattern, '');
        });

        return taskPrompt
            .trim()
            .replace(/^[,\s-]+/, '')
            .replace(/[,\s-]+$/, '')
            .replace(/\s{2,}/g, ' ')
            || String(scenario || '').trim();
    }

    deriveWorkloadTitle(prompt = '') {
        const words = String(prompt || '')
            .trim()
            .replace(/[^\w\s-]/g, '')
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 5);

        if (words.length === 0) {
            return 'New workload';
        }

        return words
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    slugifyWorkloadValue(value = '') {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 64);
    }

    openWorkloadModal(existing = null) {
        if (!sessionManager.currentSessionId) {
            uiHelpers.showToast('Open a conversation first', 'info');
            return;
        }

        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        this.editingWorkload = existing;
        this.workloadModalTitle.textContent = existing ? 'Edit workload' : 'Create workload';
        this.clearWorkloadFormError();
        this.workloadScenarioInput.value = '';
        this.workloadTitleInput.value = existing?.title || '';
        this.workloadPromptInput.value = existing?.prompt || '';
        this.workloadTriggerType.value = existing?.trigger?.type || 'manual';
        this.workloadCallableSlug.value = existing?.callableSlug || '';
        this.workloadRunAt.value = existing?.trigger?.type === 'once' ? this.toDatetimeLocal(existing?.trigger?.runAt) : '';
        this.workloadCronExpression.value = existing?.trigger?.type === 'cron' ? (existing?.trigger?.expression || '') : '';
        this.workloadTimezone.value = existing?.trigger?.type === 'cron'
            ? (existing?.trigger?.timezone || timezone)
            : timezone;
        this.workloadProfile.value = existing?.policy?.executionProfile || 'default';
        this.workloadToolIds.value = Array.isArray(existing?.policy?.toolIds)
            ? existing.policy.toolIds.join(', ')
            : '';
        this.workloadMaxRounds.value = existing?.policy?.maxRounds || 3;
        this.workloadMaxToolCalls.value = existing?.policy?.maxToolCalls || 10;
        this.workloadMaxDuration.value = existing?.policy?.maxDurationMs || 120000;
        this.workloadAllowSideEffects.checked = existing?.policy?.allowSideEffects === true;
        this.workloadStagesJson.value = JSON.stringify(existing?.stages || [], null, 2);
        this.updateWorkloadTriggerFields();
        this.renderWorkloadPresetTable(
            this.workloadCronExpression.value,
            this.workloadTimezone.value,
        );
        this.workloadModal.classList.remove('hidden');
        this.workloadModal.setAttribute('aria-hidden', 'false');
        uiHelpers.trapFocus(this.workloadModal);
        this.workloadTitleInput?.focus();
    }

    closeWorkloadModal() {
        this.editingWorkload = null;
        this.clearWorkloadFormError();
        this.workloadModal?.classList.add('hidden');
        this.workloadModal?.setAttribute('aria-hidden', 'true');
    }

    updateWorkloadTriggerFields() {
        const triggerType = this.workloadTriggerType?.value || 'manual';
        this.workloadOnceRow?.classList.toggle('hidden', triggerType !== 'once');
        this.workloadCronRow?.classList.toggle('hidden', triggerType !== 'cron');
        if (triggerType === 'cron') {
            this.renderWorkloadPresetTable(
                this.workloadCronExpression?.value || '',
                this.workloadTimezone?.value || 'UTC',
            );
        } else if (this.workloadPresetSummary) {
            this.workloadPresetSummary.textContent = '';
            this.workloadPresetSummary.classList.add('hidden');
        }
        if (this.workloadTriggerHelp) {
            this.workloadTriggerHelp.textContent = this.getWorkloadTriggerHelpText(triggerType);
        }
    }

    getWorkloadTriggerHelpText(triggerType = 'manual') {
        if (triggerType === 'once') {
            return 'Use this for a one-off task you want handled later without staying in the chat.';
        }

        if (triggerType === 'cron') {
            return 'Use a recurring schedule for jobs like daily briefs, standups, or periodic checks.';
        }

        return 'Manual workloads stay idle until you trigger them.';
    }

    toDatetimeLocal(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return '';
        }

        const offsetMs = date.getTimezoneOffset() * 60 * 1000;
        return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
    }

    readWorkloadForm() {
        const triggerType = this.workloadTriggerType.value;
        const title = this.workloadTitleInput.value.trim();
        const prompt = this.workloadPromptInput.value.trim();
        const callableSlug = this.workloadCallableSlug.value.trim().toLowerCase();

        if (!title) {
            throw new Error('Give the workload a title.');
        }
        if (!prompt) {
            throw new Error('Write the task you want the agent to run.');
        }
        if (callableSlug && !/^[a-z0-9][a-z0-9-_]{1,63}$/.test(callableSlug)) {
            throw new Error('Callable slug must use lowercase letters, numbers, hyphens, or underscores.');
        }

        const payload = {
            title,
            prompt,
            callableSlug: callableSlug || null,
            trigger: { type: triggerType },
            policy: {
                executionProfile: this.workloadProfile.value,
                toolIds: this.workloadToolIds.value
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean),
                maxRounds: Number(this.workloadMaxRounds.value || 3),
                maxToolCalls: Number(this.workloadMaxToolCalls.value || 10),
                maxDurationMs: Number(this.workloadMaxDuration.value || 120000),
                allowSideEffects: this.workloadAllowSideEffects.checked,
            },
            stages: [],
        };

        if (triggerType === 'once') {
            if (!this.workloadRunAt.value) {
                throw new Error('Run time is required for one-time workloads');
            }
            payload.trigger.runAt = new Date(this.workloadRunAt.value).toISOString();
        }

        if (triggerType === 'cron') {
            payload.trigger.expression = this.workloadCronExpression.value.trim();
            payload.trigger.timezone = this.workloadTimezone.value.trim() || 'UTC';
            if (!payload.trigger.expression) {
                throw new Error('Add a cron expression for recurring workloads.');
            }
        }

        const stagesValue = this.workloadStagesJson.value.trim();
        if (stagesValue) {
            try {
                payload.stages = JSON.parse(stagesValue);
            } catch (_error) {
                throw new Error('Follow-up stages must be valid JSON.');
            }
        }

        return payload;
    }

    async saveWorkload() {
        if (this.isSavingWorkload) {
            return;
        }

        try {
            const sessionId = sessionManager.currentSessionId;
            if (!sessionId) {
                throw new Error('Open a conversation first');
            }

            this.isSavingWorkload = true;
            this.clearWorkloadFormError();
            if (this.saveWorkloadBtn) {
                this.saveWorkloadBtn.disabled = true;
                this.saveWorkloadBtn.textContent = this.editingWorkload?.id ? 'Saving...' : 'Creating...';
            }

            const payload = this.readWorkloadForm();
            if (this.editingWorkload?.id) {
                await apiClient.updateWorkload(this.editingWorkload.id, payload);
                uiHelpers.showToast('Workload updated', 'success');
            } else {
                await apiClient.createSessionWorkload(sessionId, payload);
                uiHelpers.showToast('Workload created', 'success');
            }

            this.closeWorkloadModal();
            await this.refreshSessionWorkloadState(sessionId);
        } catch (error) {
            console.error('Failed to save workload:', error);
            this.showWorkloadFormError(error.message || 'Failed to save workload');
            uiHelpers.showToast(error.message || 'Failed to save workload', 'error');
        } finally {
            this.isSavingWorkload = false;
            if (this.saveWorkloadBtn) {
                this.saveWorkloadBtn.disabled = false;
                this.saveWorkloadBtn.textContent = 'Save workload';
            }
        }
    }

    showWorkloadFormError(message) {
        if (!this.workloadFormError) {
            return;
        }

        this.workloadFormError.textContent = message;
        this.workloadFormError.classList.remove('hidden');
    }

    clearWorkloadFormError() {
        if (!this.workloadFormError) {
            return;
        }

        this.workloadFormError.textContent = '';
        this.workloadFormError.classList.add('hidden');
    }

    async handleWorkloadAction(action, workloadId) {
        const workload = this.currentSessionWorkloads.find((item) => item.id === workloadId) || null;

        try {
            switch (action) {
                case 'run':
                    await apiClient.runWorkload(workloadId);
                    uiHelpers.showToast('Workload queued', 'success');
                    break;
                case 'pause':
                    await apiClient.pauseWorkload(workloadId);
                    uiHelpers.showToast('Workload paused', 'success');
                    break;
                case 'resume':
                    await apiClient.resumeWorkload(workloadId);
                    uiHelpers.showToast('Workload resumed', 'success');
                    break;
                case 'edit':
                    this.openWorkloadModal(workload);
                    return;
                case 'delete':
                    if (!confirm('Delete this workload and cancel queued runs?')) {
                        return;
                    }
                    await apiClient.deleteWorkload(workloadId);
                    uiHelpers.showToast('Workload deleted', 'success');
                    break;
                default:
                    return;
            }

            await this.refreshSessionWorkloadState(sessionManager.currentSessionId);
        } catch (error) {
            console.error('Workload action failed:', error);
            uiHelpers.showToast(error.message || 'Workload action failed', 'error');
        }
    }

    async refreshSessionWorkloadState(sessionId) {
        if (!sessionId) {
            return;
        }

        await this.loadSessionWorkloads(sessionId, { force: true });
        await this.refreshSessionSummaries();

        if (sessionManager.currentSessionId === sessionId) {
            await this.loadSessionMessages(sessionId);
        }
    }

    async refreshSessionSummaries() {
        if (this.isRefreshingSessionSummaries) {
            return;
        }

        this.isRefreshingSessionSummaries = true;
        try {
            await sessionManager.loadSessions();
        } catch (error) {
            console.warn('Failed to refresh session summaries:', error);
        } finally {
            this.isRefreshingSessionSummaries = false;
        }
    }

    connectWorkloadSocket() {
        if (this.workloadSocket && (
            this.workloadSocket.readyState === WebSocket.OPEN
            || this.workloadSocket.readyState === WebSocket.CONNECTING
        )) {
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        this.workloadSocket = new WebSocket(wsUrl);

        this.workloadSocket.addEventListener('open', () => {
            this.subscribeToSessionUpdates(sessionManager.currentSessionId);
        });
        this.workloadSocket.addEventListener('message', (event) => {
            this.handleWorkloadSocketMessage(event.data);
        });
        this.workloadSocket.addEventListener('close', () => {
            this.workloadSocket = null;
            this.subscribedWorkloadSessionId = null;
            clearTimeout(this.workloadSocketReconnectTimer);
            this.workloadSocketReconnectTimer = setTimeout(() => {
                this.connectWorkloadSocket();
            }, 3000);
        });
        this.workloadSocket.addEventListener('error', (error) => {
            console.warn('Workload socket error:', error);
        });
    }

    subscribeToSessionUpdates(sessionId) {
        if (!this.workloadSocket || this.workloadSocket.readyState !== WebSocket.OPEN) {
            return;
        }

        if (this.subscribedWorkloadSessionId && this.subscribedWorkloadSessionId !== sessionId) {
            this.workloadSocket.send(JSON.stringify({
                type: 'session_unsubscribe',
                sessionId: this.subscribedWorkloadSessionId,
                payload: { sessionId: this.subscribedWorkloadSessionId },
            }));
        }

        this.subscribedWorkloadSessionId = sessionId || null;
        if (!sessionId) {
            return;
        }

        this.workloadSocket.send(JSON.stringify({
            type: 'session_subscribe',
            sessionId,
            payload: { sessionId },
        }));
    }

    handleWorkloadSocketMessage(rawData) {
        let payload;
        try {
            payload = JSON.parse(rawData);
        } catch (_error) {
            return;
        }

        if ([
            'workload_queued',
            'workload_started',
            'workload_completed',
            'workload_failed',
            'workload_updated',
        ].includes(payload?.type)) {
            this.handleWorkloadEvent(payload).catch((error) => {
                console.warn('Failed to process workload event:', error);
            });
        }
    }

    async handleWorkloadEvent(event) {
        const sessionId = event?.sessionId || event?.data?.sessionId || null;
        if (!sessionId) {
            return;
        }

        await this.refreshSessionSummaries();

        if (sessionManager.currentSessionId === sessionId) {
            const previousMessages = [...sessionManager.getMessages(sessionId)];
            await this.loadSessionMessages(sessionId, {
                notifyNewAssistant: true,
                previousMessages,
            });
            await this.loadSessionWorkloads(sessionId, { force: true });
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

        this.messageInput.value = '';
        this.autoResize?.reset?.();
        this.updateSendButton();
        uiHelpers.updateCharCounter(this.messageInput, this.charCounter);

        await this.sendPreparedMessage(content);
    }

    async sendPreparedMessage(content) {
        const normalizedContent = String(content || '').trim();
        if (!normalizedContent || this.isProcessing) {
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
            content: normalizedContent,
            timestamp: new Date().toISOString()
        };

        sessionManager.addMessage(sessionId, userMessage);

        const userMessageEl = uiHelpers.renderMessage(userMessage);
        this.messagesContainer.appendChild(userMessageEl);
        uiHelpers.playAcknowledgementCue();
        uiHelpers.scrollToBottom();

        // Show typing indicator
        this.isProcessing = true;
        this.updateSendButton();
        uiHelpers.showTypingIndicator();

        // Get current model
        const model = uiHelpers.getCurrentModel();
        const reasoningEffort = uiHelpers.getCurrentReasoningEffort();

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
            for await (const chunk of apiClient.streamChat(messages, model, this.currentAbortController.signal, reasoningEffort)) {
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

    async submitAgentSurvey(trigger) {
        const button = trigger?.closest?.('.agent-survey-card__submit') || trigger;
        const card = button?.closest?.('.agent-survey-card');
        if (!card || this.isProcessing) {
            return;
        }

        const messageId = String(card.dataset.messageId || '').trim();
        const surveyId = String(card.dataset.surveyId || '').trim();
        const selectedOptions = Array.from(card.querySelectorAll('.agent-survey-option.is-selected'))
            .map((option) => ({
                id: String(option.dataset.optionId || '').trim(),
                label: String(option.dataset.optionLabel || '').trim(),
            }))
            .filter((option) => option.label);

        if (selectedOptions.length === 0) {
            uiHelpers.showToast('Choose an option first', 'info');
            return;
        }

        const notes = String(card.querySelector('.agent-survey-card__notes')?.value || '').trim();
        const requiresNotes = selectedOptions.length === 1 && selectedOptions.some((option) => option.id === 'custom-input');
        if (requiresNotes && !notes) {
            uiHelpers.showToast('Type your answer for the Other option', 'info');
            card.querySelector('.agent-survey-card__notes')?.focus();
            return;
        }

        const responseContent = this.buildSurveyResponseContent({
            checkpointId: surveyId,
            selectedOptions,
            notes,
        });
        const sessionId = sessionManager.currentSessionId;
        const surveyMessage = this.getSessionMessage(sessionId, messageId);

        if (surveyMessage) {
            surveyMessage.surveyState = {
                status: 'answered',
                checkpointId: surveyId,
                summary: responseContent.replace(/^Survey response \([^)]+\):\s*/i, ''),
                selectedOptionIds: selectedOptions.map((option) => option.id),
                selectedLabels: selectedOptions.map((option) => option.label),
                notes,
            };
            this.upsertSessionMessage(sessionId, surveyMessage);
            this.renderOrReplaceMessage(surveyMessage);
        }

        card.dataset.submitted = 'true';
        if (button) {
            button.disabled = true;
        }

        await this.sendPreparedMessage(responseContent);
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
            clientOnly: true,
            excludeFromTranscript: true,
            timestamp: new Date().toISOString()
        };
        
        const savedUserMessage = sessionManager.addMessage(sessionId, userMessage);
        
        const userMessageEl = uiHelpers.renderMessage(savedUserMessage);
        this.messagesContainer.appendChild(userMessageEl);
        uiHelpers.scrollToBottom();
        void sessionManager.syncMessagesToBackend(sessionId, [savedUserMessage]);
        
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
            clientOnly: true,
            excludeFromTranscript: true,
            timestamp: new Date().toISOString()
        };
        
        const savedSearchMessage = sessionManager.addMessage(sessionId, searchMessage);
        
        const searchMessageEl = uiHelpers.renderUnsplashSearchMessage(savedSearchMessage);
        this.messagesContainer.appendChild(searchMessageEl);
        uiHelpers.reinitializeIcons(searchMessageEl);
        uiHelpers.scrollToBottom();
        void sessionManager.syncMessageToBackend(sessionId, savedSearchMessage);
        
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
                clientOnly: true,
                excludeFromTranscript: true,
                timestamp: new Date().toISOString()
            });

            this.renderOrReplaceMessage(nextMessage || searchMessage);
            if (nextMessage) {
                void sessionManager.syncMessageToBackend(sessionId, nextMessage);
            }
            
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
                clientOnly: true,
                excludeFromTranscript: true,
                timestamp: new Date().toISOString()
            });

            this.renderOrReplaceMessage(failedMessage || searchMessage);
            if (failedMessage) {
                void sessionManager.syncMessageToBackend(sessionId, failedMessage);
            }
            
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
            content: image.description || image.altDescription || 'Unsplash image',
            imageUrl: image.urls.regular,
            thumbnailUrl: image.urls.small,
            prompt: image.description || image.altDescription || 'Unsplash image',
            source: 'unsplash',
            author: image.author,
            unsplashLink: image.links.html,
            clientOnly: true,
            excludeFromTranscript: true,
            timestamp: new Date().toISOString()
        };
        
        const savedImageMessage = sessionManager.addMessage(sessionId, imageMessage);
        
        const imageMessageEl = uiHelpers.renderImageMessage(savedImageMessage);
        this.messagesContainer.appendChild(imageMessageEl);
        uiHelpers.reinitializeIcons(imageMessageEl);
        uiHelpers.scrollToBottom();
        void sessionManager.syncMessagesToBackend(sessionId, [savedImageMessage]);
        
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
            content: image.alt || image.prompt || message.prompt || (isArtifact ? 'Captured image' : 'Generated image'),
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
            clientOnly: true,
            excludeFromTranscript: true,
            timestamp: new Date().toISOString()
        };

        const savedImageMessage = sessionManager.addMessage(sessionId, imageMessage);
        this.messagesContainer.appendChild(uiHelpers.renderImageMessage(savedImageMessage));
        uiHelpers.reinitializeIcons(this.messagesContainer.lastElementChild);
        uiHelpers.scrollToBottom();
        void sessionManager.syncMessagesToBackend(sessionId, [savedImageMessage]);

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
            clientOnly: true,
            excludeFromTranscript: true,
            timestamp: new Date().toISOString()
        });
        this.renderOrReplaceMessage(loadingMessage || currentMessage);
        if (loadingMessage) {
            void sessionManager.syncMessageToBackend(sessionId, loadingMessage);
        }

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
                clientOnly: true,
                excludeFromTranscript: true,
                timestamp: new Date().toISOString()
            });

            this.renderOrReplaceMessage(nextMessage || currentMessage);
            if (nextMessage) {
                void sessionManager.syncMessageToBackend(sessionId, nextMessage);
            }
        } catch (error) {
            const failedMessage = this.upsertSessionMessage(sessionId, {
                id: messageId,
                isLoading: false,
                currentPage: currentMessage.currentPage || 1,
                error: error.message || 'Failed to load Unsplash results',
                clientOnly: true,
                excludeFromTranscript: true,
                timestamp: new Date().toISOString()
            });
            this.renderOrReplaceMessage(failedMessage || currentMessage);
            if (failedMessage) {
                void sessionManager.syncMessageToBackend(sessionId, failedMessage);
            }
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

    extractSurveyDefinition(messageContent = '') {
        return uiHelpers.extractSurveyDefinitionFromContent(messageContent);
    }

    parseSurveyResponseContent(messageContent = '') {
        const match = String(messageContent || '').trim().match(/^Survey response \(([^)]+)\):\s*([\s\S]+)$/i);
        if (!match) {
            return null;
        }

        return {
            checkpointId: String(match[1] || '').trim(),
            summary: String(match[2] || '').trim(),
        };
    }

    extractSurveySelectedLabels(summary = '') {
        return Array.from(String(summary || '').matchAll(/"([^"]+)"/g))
            .map((match) => String(match[1] || '').trim())
            .filter(Boolean);
    }

    extractSurveySelectedOptionIds(summary = '', surveyOptions = []) {
        const options = Array.isArray(surveyOptions) ? surveyOptions : [];
        const matches = Array.from(String(summary || '').matchAll(/"([^"]+)"(?:\s*\[([^\]]+)\])?/g));

        return Array.from(new Set(matches
            .map((match) => {
                const explicitId = String(match[2] || '').trim();
                if (explicitId) {
                    return explicitId;
                }

                const label = String(match[1] || '').trim();
                return options.find((option) => option?.label === label)?.id || '';
            })
            .filter(Boolean)));
    }

    extractSurveyNotes(summary = '') {
        const match = String(summary || '').match(/Notes:\s*([\s\S]+)$/i);
        return match?.[1] ? String(match[1]).trim() : '';
    }

    buildSurveyFenceContent(checkpoint = null) {
        if (!checkpoint || typeof checkpoint !== 'object') {
            return '';
        }

        try {
            return `\`\`\`survey\n${JSON.stringify(checkpoint, null, 2)}\n\`\`\``;
        } catch (_error) {
            return '';
        }
    }

    extractSurveyDisplayContentFromToolEvents(toolEvents = []) {
        const checkpointEvent = [...(Array.isArray(toolEvents) ? toolEvents : [])]
            .reverse()
            .find((event) => (
                (event?.toolCall?.function?.name || event?.result?.toolId || '') === 'user-checkpoint'
                && event?.result?.success !== false
            ));

        if (!checkpointEvent) {
            return '';
        }

        const data = checkpointEvent?.result?.data || {};
        const checkpoint = data.checkpoint && typeof data.checkpoint === 'object'
            ? data.checkpoint
            : (data && typeof data === 'object' ? data : null);
        const surveyFence = this.buildSurveyFenceContent(checkpoint);
        if (!surveyFence) {
            const message = String(data.message || '').trim();
            return /```(?:survey|kb-survey)\s*[\s\S]*?```/i.test(message) ? message : '';
        }

        return surveyFence;
    }

    attachSurveyDisplayContent(message = null, toolEvents = []) {
        if (!message || message.role !== 'assistant') {
            return message;
        }

        const existingContent = String(message.displayContent ?? message.content ?? '');
        if (/```(?:survey|kb-survey)\s*[\s\S]*?```/i.test(existingContent)) {
            return message;
        }

        const surveyDisplayContent = this.extractSurveyDisplayContentFromToolEvents(toolEvents);
        if (!surveyDisplayContent) {
            return message;
        }

        return {
            ...message,
            displayContent: surveyDisplayContent,
        };
    }

    annotateSurveyStates(messages = []) {
        const responseLookup = new Map();

        messages.forEach((message) => {
            if (message?.role !== 'user') {
                return;
            }

            const response = this.parseSurveyResponseContent(message.content || '');
            if (response?.checkpointId) {
                responseLookup.set(response.checkpointId, response);
            }
        });

        return messages.map((message) => {
            if (message?.role !== 'assistant') {
                return message;
            }

            const survey = this.extractSurveyDefinition(message.displayContent ?? message.content ?? '');
            if (!survey) {
                return message;
            }

            const response = responseLookup.get(survey.id);
            if (!response) {
                return message.surveyState
                    ? { ...message, surveyState: null }
                    : message;
            }

            return {
                ...message,
                surveyState: {
                    status: 'answered',
                    checkpointId: survey.id,
                    summary: response.summary,
                    selectedOptionIds: this.extractSurveySelectedOptionIds(response.summary, survey.options),
                    selectedLabels: this.extractSurveySelectedLabels(response.summary),
                    notes: this.extractSurveyNotes(response.summary),
                },
            };
        });
    }

    syncAnnotatedSurveyStates(sessionId) {
        const messages = sessionManager.getMessages(sessionId);
        const annotatedMessages = this.annotateSurveyStates(messages);
        sessionManager.sessionMessages.set(sessionId, annotatedMessages);
        sessionManager.saveToStorage();
        return annotatedMessages;
    }

    hasSurveyToolEvent(toolEvents = []) {
        return (Array.isArray(toolEvents) ? toolEvents : []).some((event) => (
            (event?.toolCall?.function?.name || event?.result?.toolId || '') === 'user-checkpoint'
            && event?.result?.success !== false
        ));
    }

    getAssistantCueType(message = null, toolEvents = []) {
        if (this.hasSurveyToolEvent(toolEvents)) {
            return 'survey';
        }

        const survey = this.extractSurveyDefinition(message?.displayContent ?? message?.content ?? '');
        return survey ? 'survey' : 'response';
    }

    playCueForAssistantMessage(message = null, toolEvents = []) {
        if (!message || message.role !== 'assistant' || message.isLoading) {
            return;
        }

        uiHelpers.playAgentCue(this.getAssistantCueType(message, toolEvents));
    }

    playCueForNewAssistantMessages(previousMessages = [], nextMessages = []) {
        const previousCount = Array.isArray(previousMessages) ? previousMessages.length : 0;
        const addedMessages = (Array.isArray(nextMessages) ? nextMessages : []).slice(previousCount);
        const lastAssistantMessage = [...addedMessages]
            .reverse()
            .find((message) => message?.role === 'assistant' && message?.isLoading !== true);

        if (lastAssistantMessage) {
            this.playCueForAssistantMessage(lastAssistantMessage);
        }
    }

    buildSurveyResponseContent({ checkpointId = '', selectedOptions = [], notes = '' } = {}) {
        const chosen = (Array.isArray(selectedOptions) ? selectedOptions : [])
            .map((option) => {
                const label = String(option?.label || option?.id || '').trim();
                const id = String(option?.id || '').trim();
                if (!label) {
                    return '';
                }

                return id && id !== label
                    ? `"${label}" [${id}]`
                    : `"${label}"`;
            })
            .filter(Boolean)
            .join(', ');
        const noteText = String(notes || '').trim();
        const summaryParts = [
            chosen ? `chose ${chosen}` : 'answered the checkpoint',
            noteText ? `Notes: ${noteText}` : '',
        ].filter(Boolean);

        return `Survey response (${String(checkpointId || '').trim()}): ${summaryParts.join('. ')}`;
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

    stripHtmlToText(html = '') {
        return String(html || '')
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
            .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, '\'')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/\s+/g, ' ')
            .trim();
    }

    buildResearchSearchLookup(toolEvents = []) {
        const lookup = new Map();

        (Array.isArray(toolEvents) ? toolEvents : []).forEach((event) => {
            const toolId = event?.toolCall?.function?.name || event?.result?.toolId || '';
            if (toolId !== 'web-search' || event?.result?.success === false) {
                return;
            }

            const results = Array.isArray(event?.result?.data?.results)
                ? event.result.data.results
                : [];

            results.forEach((result) => {
                const normalized = this.normalizeSearchResult(result);
                if (normalized?.url && !lookup.has(normalized.url)) {
                    lookup.set(normalized.url, normalized);
                }
            });
        });

        return lookup;
    }

    normalizeResearchSourceEvent(event, searchLookup = new Map()) {
        const toolId = event?.toolCall?.function?.name || event?.result?.toolId || '';
        if ((toolId !== 'web-fetch' && toolId !== 'web-scrape') || event?.result?.success === false) {
            return null;
        }

        const args = this.parseToolArguments(event?.toolCall?.function?.arguments);
        const data = event?.result?.data || {};
        const url = data.url || args.url || '';
        if (!url) {
            return null;
        }

        const searchMeta = searchLookup.get(url) || null;
        const title = data.title || searchMeta?.title || url;
        const source = searchMeta?.source || '';
        const snippet = searchMeta?.snippet || '';
        const publishedAt = searchMeta?.publishedAt || '';
        const rawExcerpt = toolId === 'web-scrape'
            ? (data.summary || data.text || data.content || JSON.stringify(data.data || {}))
            : this.stripHtmlToText(data.body || '');
        const excerpt = String(rawExcerpt || '').replace(/\s+/g, ' ').trim().slice(0, 420);

        if (!snippet && !excerpt) {
            return null;
        }

        return {
            title,
            url,
            source,
            snippet,
            excerpt,
            publishedAt,
            toolId,
        };
    }

    appendToolSelectionMessages(parentMessageId, toolEvents = []) {
        const sessionId = sessionManager.currentSessionId;
        if (!sessionId || !parentMessageId || !Array.isArray(toolEvents) || toolEvents.length === 0) {
            return;
        }

        const nextMessages = [];
        const searchLookup = this.buildResearchSearchLookup(toolEvents);

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
                    excludeFromTranscript: true,
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
                    excludeFromTranscript: true,
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
                    excludeFromTranscript: true,
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
                    excludeFromTranscript: true,
                    timestamp: new Date().toISOString(),
                });
            }
        });

        const searchEvent = [...toolEvents].reverse().find((event) => (
            (event?.toolCall?.function?.name || event?.result?.toolId || '') === 'web-search'
            && event?.result?.success !== false
        ));
        const researchSources = [];
        const seenResearchUrls = new Set();

        toolEvents.forEach((event) => {
            const normalized = this.normalizeResearchSourceEvent(event, searchLookup);
            if (!normalized || seenResearchUrls.has(normalized.url)) {
                return;
            }

            seenResearchUrls.add(normalized.url);
            researchSources.push(normalized);
        });

        if (researchSources.length > 0) {
            const searchArgs = this.parseToolArguments(searchEvent?.toolCall?.function?.arguments);
            const query = searchEvent?.result?.data?.query || searchArgs.query || '';

            nextMessages.push({
                id: `${parentMessageId}-research-sources`,
                parentMessageId,
                role: 'assistant',
                type: 'research-sources',
                content: `Verified source excerpts for "${query || 'research'}"`,
                query,
                results: researchSources,
                total: researchSources.length,
                excludeFromTranscript: true,
                timestamp: new Date().toISOString(),
            });
        }

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
        const didChangeSession = currentSessionId !== sessionId;
        if (currentSessionId !== sessionId) {
            sessionManager.promoteSessionId(currentSessionId, sessionId);
        }

        apiClient.setSessionId(sessionId);
        if (this.subscribedWorkloadSessionId !== sessionId) {
            this.subscribeToSessionUpdates(sessionId);
        }
        if (didChangeSession || this.currentSessionWorkloads.length === 0) {
            this.loadSessionWorkloads(sessionId);
        }
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

        const currentMessage = this.getSessionMessage(sessionId, parentMessageId);
        if (currentMessage && Array.isArray(chunk.toolEvents) && chunk.toolEvents.length > 0) {
            const updatedMessage = this.attachSurveyDisplayContent(currentMessage, chunk.toolEvents);
            if (updatedMessage !== currentMessage) {
                this.upsertSessionMessage(sessionId, updatedMessage);
            }
        }

        // Update UI
        const messages = this.syncAnnotatedSurveyStates(sessionId);
        const lastMessage = messages[messages.length - 1];
        
        if (lastMessage) {
            this.renderOrReplaceMessage(lastMessage);
            this.playCueForAssistantMessage(lastMessage, chunk.toolEvents);
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
        const reasoningEffort = uiHelpers.getCurrentReasoningEffort();
        
        // Build message history and stream
        this.currentAbortController = new AbortController();
        
        try {
            apiClient.setSessionId(sessionId);
            const history = this.buildMessageHistory(sessionId);
            
            for await (const chunk of apiClient.streamChat(history, model, this.currentAbortController.signal, reasoningEffort)) {
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

    updateSessionInfo() {
        const session = sessionManager.getCurrentSession();
        if (session) {
            const messageCount = sessionManager.getMessages(session.id)?.length || 0;
            if (uiHelpers.isMinimalistMode()) {
                this.currentSessionInfo.textContent = `${session.title || 'Conversation'} | ${messageCount} message${messageCount !== 1 ? 's' : ''}`;
            } else {
                this.currentSessionInfo.textContent = `${sessionManager.getSessionModeLabel(session.mode)} | ${sessionManager.formatTimestamp(session.updatedAt)} | ${messageCount} message${messageCount !== 1 ? 's' : ''}`;
            }
            return;
        }

        this.currentSessionInfo.textContent = uiHelpers.isMinimalistMode()
            ? 'Minimalist mode active'
            : 'No active session';
    }

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

    async refreshSharedSessionState() {
        if (this.isProcessing) {
            return;
        }

        const previousSessionId = sessionManager.currentSessionId;
        const previousMessages = previousSessionId ? sessionManager.getMessages(previousSessionId) : [];
        const previousMessageCount = previousMessages.length;
        const previousLastTimestamp = previousMessages[previousMessages.length - 1]?.timestamp || '';

        await sessionManager.loadSessions();

        const currentSessionId = sessionManager.currentSessionId;
        apiClient.setSessionId(currentSessionId || null);

        if (!currentSessionId) {
            if (previousSessionId) {
                uiHelpers.clearMessages();
                this.subscribeToSessionUpdates(null);
                this.currentSessionWorkloads = [];
                this.workloadRunsById.clear();
                this.hiddenCompletedWorkloadCount = 0;
                this.renderWorkloadsPanel();
                this.updateSessionInfo();
            }
            return;
        }

        if (currentSessionId !== previousSessionId) {
            await this.loadSessionMessages(currentSessionId);
            this.subscribeToSessionUpdates(currentSessionId);
            await this.loadSessionWorkloads(currentSessionId, { force: true });
            this.updateSessionInfo();
            return;
        }

        const refreshedMessages = await sessionManager.loadSessionMessagesFromBackend(currentSessionId);
        const refreshedCount = refreshedMessages.length;
        const refreshedLastTimestamp = refreshedMessages[refreshedMessages.length - 1]?.timestamp || '';

        if (refreshedCount !== previousMessageCount || refreshedLastTimestamp !== previousLastTimestamp) {
            const messages = this.syncAnnotatedSurveyStates(currentSessionId);
            this.renderMessages(messages);
            this.playCueForNewAssistantMessages(previousMessages, messages);
            this.updateSessionInfo();
        }
    }
    
    startHealthCheckInterval() {
        // Check every 30 seconds
        setInterval(async () => {
            const health = await apiClient.checkHealth();
            this.updateConnectionStatus(health.connected ? 'connected' : 'disconnected');
        }, 30000);
    }

    startSharedSessionSyncInterval() {
        this.sharedSessionSyncTimer = setInterval(() => {
            if (document.hidden) {
                return;
            }

            this.refreshSharedSessionState().catch((error) => {
                console.warn('Failed to refresh shared session state:', error);
            });
        }, 15000);
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new ChatApp();
    window.app = window.chatApp; // Backward compatibility
});
