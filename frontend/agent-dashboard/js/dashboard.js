/**
 * Agent SDK Admin Dashboard
 * Main dashboard controller with state management, navigation, and real-time updates
 */

class Dashboard {
    constructor() {
        this.state = {
            currentView: 'overview',
            sidebarCollapsed: false,
            logsPaused: false,
            selectedPrompt: null,
            selectedTrace: null,
            models: [],
            prompts: [],
            skills: [],
            logs: [],
            traces: [],
            settings: {},
            stats: {
                totalTasks: 0,
                successRate: 0,
                activeSessions: 0,
                skillsLearned: 0
            },
            pagination: {
                logs: { page: 1, limit: 50, total: 0 },
                traces: { page: 1, limit: 20, total: 0 }
            }
        };
        
        this.charts = {};
        this.ws = null;
        this.reconnectInterval = null;
        this.refreshInterval = null;
        
        this.init();
    }
    
    /**
     * Initialize the dashboard
     */
    async init() {
        this.setupEventListeners();
        this.setupNavigation();
        this.setupPromptEditor();
        this.setupCharts();
        this.setupWebSocket();
        this.startPolling();
        
        // Load initial data
        await this.loadInitialData();
        
        const connected = document.querySelector('#connectionStatus .status-dot')?.classList.contains('online');
        this.showToast(connected ? 'Dashboard connected' : 'Dashboard loaded in degraded mode', connected ? 'success' : 'warning');
    }
    
    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Sidebar toggle
        document.getElementById('sidebarToggle')?.addEventListener('click', () => {
            this.toggleSidebar();
        });
        
        // Global search
        document.getElementById('globalSearch')?.addEventListener('input', (e) => {
            this.handleGlobalSearch(e.target.value);
        });
        
        // Theme toggle
        document.getElementById('themeToggle')?.addEventListener('click', () => {
            this.toggleTheme();
        });
        
        // Notifications
        document.getElementById('notificationsBtn')?.addEventListener('click', () => {
            this.showToast('No new notifications', 'info');
        });
        
        // Chart time range
        document.getElementById('chartTimeRange')?.addEventListener('change', (e) => {
            this.updateChartTimeRange(e.target.value);
        });
        
        // Log controls
        document.getElementById('pauseLogsBtn')?.addEventListener('click', () => {
            this.toggleLogsPause();
        });
        
        document.getElementById('clearLogsBtn')?.addEventListener('click', () => {
            this.clearLogs();
        });
        
        document.getElementById('exportLogsBtn')?.addEventListener('click', () => {
            this.exportLogs();
        });
        
        // Log filters
        document.getElementById('logLevelFilter')?.addEventListener('change', () => {
            this.filterLogs();
        });
        
        document.getElementById('logModelFilter')?.addEventListener('change', () => {
            this.filterLogs();
        });
        
        document.getElementById('logTimeFilter')?.addEventListener('change', () => {
            this.filterLogs();
        });
        
        document.getElementById('logSearch')?.addEventListener('input', (e) => {
            this.debounce(() => this.filterLogs(), 300)();
        });
        
        // Log pagination
        document.getElementById('logsPrevPage')?.addEventListener('click', () => {
            this.changeLogPage(-1);
        });
        
        document.getElementById('logsNextPage')?.addEventListener('click', () => {
            this.changeLogPage(1);
        });
        
        // Prompt controls
        document.getElementById('newPromptBtn')?.addEventListener('click', () => {
            this.createNewPrompt();
        });
        
        document.getElementById('savePromptBtn')?.addEventListener('click', () => {
            this.savePrompt();
        });
        
        document.getElementById('testPromptBtn')?.addEventListener('click', () => {
            this.openTestPromptModal();
        });
        
        document.getElementById('promptHistoryBtn')?.addEventListener('click', () => {
            this.openHistoryModal();
        });
        
        document.getElementById('promptSearch')?.addEventListener('input', (e) => {
            this.searchPrompts(e.target.value);
        });
        
        // Prompt editor tabs
        document.querySelectorAll('.editor-tabs .tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchPromptTab(e.target.dataset.tab);
            });
        });
        
        // Prompt editor toolbar
        document.querySelectorAll('.toolbar-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.insertVariable(btn.dataset.insert);
            });
        });
        
        // Prompt editor input
        document.getElementById('promptEditor')?.addEventListener('input', (e) => {
            this.updatePromptEditor(e.target.value);
        });
        
        // Test prompt modal
        document.getElementById('runTestBtn')?.addEventListener('click', () => {
            this.runPromptTest();
        });
        
        // Model configuration
        document.getElementById('defaultConfigForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveDefaultConfig();
        });
        
        document.getElementById('addModelBtn')?.addEventListener('click', () => {
            this.showToast('Add model functionality coming soon', 'info');
        });
        
        document.getElementById('resetDefaultsBtn')?.addEventListener('click', () => {
            this.resetDefaultConfig();
        });
        
        // Range inputs
        document.querySelectorAll('input[type="range"]').forEach(input => {
            input.addEventListener('input', (e) => {
                const valueDisplay = e.target.parentElement.querySelector('.range-value');
                if (valueDisplay) {
                    valueDisplay.textContent = e.target.value;
                }
            });
        });
        
        // Skill categories
        document.querySelectorAll('.category-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.filterSkills(e.target.dataset.category);
            });
        });
        
        document.getElementById('skillSearch')?.addEventListener('input', (e) => {
            this.searchSkills(e.target.value);
        });
        
        document.getElementById('discoverSkillsBtn')?.addEventListener('click', () => {
            this.discoverSkills();
        });
        
        // Trace filters
        document.getElementById('traceSessionFilter')?.addEventListener('change', () => {
            this.filterTraces();
        });
        
        document.getElementById('traceStatusFilter')?.addEventListener('change', () => {
            this.filterTraces();
        });
        
        document.getElementById('traceSearch')?.addEventListener('input', (e) => {
            this.debounce(() => this.filterTraces(), 300)();
        });
        
        // Settings navigation
        document.querySelectorAll('.settings-nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                this.switchSettingsSection(e.target.dataset.settings);
            });
        });
        
        // Settings forms
        document.getElementById('generalSettingsForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveGeneralSettings();
        });
        
        document.getElementById('apiSettingsForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveApiSettings();
        });
        
        document.getElementById('testConnectionBtn')?.addEventListener('click', () => {
            this.testConnection();
        });
        
        // API key visibility toggles
        document.getElementById('showApiKey')?.addEventListener('click', () => {
            this.togglePasswordVisibility('apiKey');
        });
        
        document.getElementById('showOpenaiKey')?.addEventListener('click', () => {
            this.togglePasswordVisibility('openaiKey');
        });
        
        // Danger zone buttons
        document.getElementById('clearAllLogsBtn')?.addEventListener('click', () => {
            this.confirmClearAllLogs();
        });
        
        document.getElementById('resetConfigBtn')?.addEventListener('click', () => {
            this.confirmResetConfig();
        });
        
        document.getElementById('exportDataBtn')?.addEventListener('click', () => {
            this.exportAllData();
        });
        
        // Feature toggles
        document.querySelectorAll('#featureList input[type="checkbox"]').forEach(toggle => {
            toggle.addEventListener('change', (e) => {
                this.updateFeatureToggle(e.target.id, e.target.checked);
            });
        });
        
        // Modal close buttons
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) {
                    this.closeModal(modal.id);
                }
            });
        });
        
        // Modal overlay click
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) {
                    this.closeModal(modal.id);
                }
            });
        });
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal.active').forEach(modal => {
                    this.closeModal(modal.id);
                });
            }
            
            // Ctrl/Cmd + K for search
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                document.getElementById('globalSearch')?.focus();
            }
        });
        
        // Window resize
        window.addEventListener('resize', () => {
            this.debounce(() => this.handleResize(), 250)();
        });
    }
    
    /**
     * Setup navigation
     */
    setupNavigation() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const view = item.dataset.view;
                if (view) {
                    this.navigateTo(view);
                }
            });
        });
        
        // View all buttons in cards
        document.querySelectorAll('.card-header .btn-ghost[data-view]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.navigateTo(btn.dataset.view);
            });
        });
    }
    
    /**
     * Navigate to a view
     */
    navigateTo(view) {
        // Update sidebar
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === view);
        });
        
        // Update view
        document.querySelectorAll('.view').forEach(v => {
            v.classList.toggle('active', v.id === `${view}View`);
        });
        
        // Update header
        const viewNames = {
            overview: 'Overview',
            prompts: 'Prompts',
            models: 'Models',
            logs: 'Logs',
            skills: 'Skills',
            traces: 'Traces',
            settings: 'Settings'
        };
        
        document.getElementById('pageTitle').textContent = viewNames[view] || view;
        document.querySelector('.breadcrumbs .current').textContent = viewNames[view] || view;
        
        this.state.currentView = view;
        
        // Load view-specific data
        this.loadViewData(view);
    }
    
    /**
     * Load initial data
     */
    async loadInitialData() {
        try {
            // Load stats
            await this.loadStats();
            
            // Load models
            await this.loadModels();
            
            // Load prompts
            await this.loadPrompts();
            
            // Load skills
            await this.loadSkills();
            
            // Load recent activity
            await this.loadRecentActivity();
            
            // Load model usage
            await this.loadModelUsage();

            // Load health
            await this.loadSystemHealth();
            
        } catch (error) {
            console.error('Error loading initial data:', error);
            this.showToast('Failed to load some data', 'error');
        }
    }
    
    /**
     * Load view-specific data
     */
    async loadViewData(view) {
        switch (view) {
            case 'logs':
                await this.loadLogs();
                break;
            case 'traces':
                await this.loadTraces();
                break;
            case 'settings':
                await this.loadSettings();
                break;
        }
    }
    
    /**
     * Load statistics
     */
    async loadStats() {
        try {
            const response = await apiClient.get('/api/admin/stats');
            const payload = this.unwrapApiPayload(response, {});
            const stats = this.normalizeOverviewStats(payload);
            
            this.state.stats = stats;
            
            // Update UI
            document.getElementById('totalTasks').textContent = stats.totalTasks.toLocaleString();
            document.getElementById('successRate').textContent = `${stats.successRate}%`;
            document.getElementById('activeSessions').textContent = stats.activeSessions;
            document.getElementById('skillsLearned').textContent = stats.skillsLearned;
            
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }
    
    /**
     * Load models
     */
    async loadModels() {
        try {
            const [modelsResponse, usageResponse] = await Promise.all([
                apiClient.get('/api/admin/models'),
                apiClient.get('/api/admin/models/usage/stats').catch(() => null),
            ]);
            const usageById = new Map(
                this.unwrapApiPayload(usageResponse, []).map((usage) => [usage.modelId, usage])
            );
            const models = this.unwrapApiPayload(modelsResponse, []).map((model) =>
                this.normalizeModel({
                    ...model,
                    ...(usageById.get(model.id) || {}),
                })
            );
            this.state.models = models;
            this.syncModelOptions(models);
            this.renderModels(models);
        } catch (error) {
            console.error('Error loading models:', error);
            this.renderModels(this.getMockModels());
        }
    }
    
    /**
     * Load prompts
     */
    async loadPrompts() {
        try {
            const response = await apiClient.get('/api/admin/prompts');
            const prompts = this.unwrapApiPayload(response, []);
            this.state.prompts = prompts;
            this.renderPromptList(prompts);
            
            if (prompts.length > 0 && !this.state.selectedPrompt) {
                this.selectPrompt(prompts[0]);
            }
        } catch (error) {
            console.error('Error loading prompts:', error);
            this.renderPromptList(this.getMockPrompts());
        }
    }
    
    /**
     * Load skills
     */
    async loadSkills() {
        try {
            const response = await apiClient.get('/api/admin/skills');
            const skills = this.unwrapApiPayload(response, []).map(skill => this.normalizeSkill(skill));
            this.state.skills = skills;
            this.renderSkills(skills);
        } catch (error) {
            console.error('Error loading skills:', error);
            this.renderSkills(this.getMockSkills());
        }
    }
    
    /**
     * Load logs
     */
    async loadLogs() {
        if (this.state.logsPaused) return;
        
        try {
            const { page, limit } = this.state.pagination.logs;
            const response = await apiClient.get('/api/admin/logs', { page, limit });
            const logs = this.unwrapApiPayload(response, []).map(log => this.normalizeLog(log));
            const pagination = this.getApiPagination(response);
            
            this.state.logs = logs;
            if (pagination) {
                this.state.pagination.logs = { ...this.state.pagination.logs, ...pagination, total: pagination.total || 0 };
            }
            this.populateLogModelFilter(logs);
            this.renderLogs(logs);
            this.updateLogsPagination();
        } catch (error) {
            console.error('Error loading logs:', error);
            this.renderLogs(this.getMockLogs());
        }
    }
    
    /**
     * Load traces
     */
    async loadTraces() {
        try {
            const { page, limit } = this.state.pagination.traces;
            const response = await apiClient.get('/api/admin/traces', { page, limit });
            const traces = this.unwrapApiPayload(response, []).map(trace => this.normalizeTrace(trace));
            const pagination = this.getApiPagination(response);
            
            this.state.traces = traces;
            if (pagination) {
                this.state.pagination.traces = { ...this.state.pagination.traces, ...pagination, total: pagination.total || 0 };
            }
            if (this.state.selectedTrace && !traces.some((trace) => trace.id === this.state.selectedTrace.id)) {
                this.state.selectedTrace = null;
            }
            this.renderTraces(traces);
        } catch (error) {
            console.error('Error loading traces:', error);
            this.renderTraces(this.getMockTraces());
        }
    }
    
    /**
     * Load settings
     */
    async loadSettings() {
        try {
            const response = await apiClient.get('/api/admin/settings');
            const settings = this.unwrapApiPayload(response, null);
            if (settings) {
                this.state.settings = settings;
                this.applySettings(settings);
            }
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }
    
    /**
     * Setup prompt editor
     */
    setupPromptEditor() {
        // Initialize with empty prompt
        this.updatePromptEditor('');
    }
    
    /**
     * Setup charts
     */
    setupCharts() {
        const ctx = document.getElementById('requestVolumeCanvas');
        if (!ctx) return;
        
        this.charts.requestVolume = new Chart(ctx, {
            type: 'line',
            data: {
                labels: this.generateTimeLabels(24),
                datasets: [{
                    label: 'Requests',
                    data: this.generateRandomData(24, 50, 200),
                    borderColor: '#58a6ff',
                    backgroundColor: 'rgba(88, 166, 255, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { 
                            color: '#6e7681',
                            font: { size: 11 }
                        }
                    },
                    y: {
                        grid: { color: '#21262d' },
                        ticks: {
                            color: '#6e7681',
                            font: { size: 11 }
                        }
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                }
            }
        });
    }
    
    /**
     * Setup WebSocket connection
     */
    setupWebSocket() {
        console.info('Admin dashboard realtime socket is not configured; using polling.');
    }
    
    /**
     * Handle WebSocket messages
     */
    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'log':
                this.addRealtimeLog(data.payload);
                break;
            case 'stats':
                this.updateStats(data.payload);
                break;
            case 'trace':
                this.updateTrace(data.payload);
                break;
        }
    }
    
    /**
     * Schedule WebSocket reconnect
     */
    scheduleReconnect() {
        if (this.reconnectInterval) return;
        
        this.reconnectInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.CLOSED) {
                this.setupWebSocket();
            }
        }, 5000);
    }
    
    /**
     * Start polling for updates
     */
    startPolling() {
        // Poll stats every 30 seconds
        this.refreshInterval = setInterval(async () => {
            await this.loadStats();
            await this.loadSystemHealth();
            await this.loadRecentActivity();
            await this.loadModelUsage();
            
            if (this.state.currentView === 'logs' && !this.state.logsPaused) {
                await this.loadLogs();
            }
        }, 30000);
    }
    
    // ==================== UI RENDERING ====================
    
    /**
     * Render models
     */
    renderModels(models) {
        const container = document.getElementById('modelsGrid');
        if (!container) return;
        
        container.innerHTML = models.map(model => `
            <div class="model-card">
                <div class="model-card-header">
                    <div>
                        <span class="model-name">${model.name}</span>
                        <span class="model-provider">${model.provider}</span>
                    </div>
                    <span class="model-status ${model.active ? '' : 'inactive'}"></span>
                </div>
                <div class="model-stats">
                    <div class="model-stat">
                        <span class="model-stat-value">${model.requests?.toLocaleString() || 0}</span>
                        <span class="model-stat-label">Requests</span>
                    </div>
                    <div class="model-stat">
                        <span class="model-stat-value">${model.avgLatency || 0}ms</span>
                        <span class="model-stat-label">Avg Latency</span>
                    </div>
                </div>
                <div class="model-capabilities">
                    ${(model.capabilities || []).map(cap => `
                        <span class="capability-tag">${cap}</span>
                    `).join('')}
                </div>
                <div class="model-card-actions">
                    <button class="btn btn-sm btn-secondary" onclick="dashboard.editModel('${model.id}')">Edit</button>
                    <button class="btn btn-sm btn-ghost" onclick="dashboard.testModel('${model.id}')">Test</button>
                </div>
            </div>
        `).join('');
    }
    
    /**
     * Render prompt list
     */
    renderPromptList(prompts) {
        const container = document.getElementById('promptList');
        if (!container) return;
        
        container.innerHTML = prompts.map(prompt => `
            <div class="prompt-item ${this.state.selectedPrompt?.id === prompt.id ? 'active' : ''}" 
                 data-id="${prompt.id}" onclick="dashboard.selectPromptById('${prompt.id}')">
                <span class="prompt-item-name">${prompt.name}</span>
                <span class="prompt-item-meta">Updated ${this.formatDate(prompt.updatedAt)}</span>
            </div>
        `).join('');
    }
    
    /**
     * Render skills
     */
    renderSkills(skills) {
        const container = document.getElementById('skillsGrid');
        if (!container) return;
        
        container.innerHTML = skills.map(skill => `
            <div class="skill-card">
                <div class="skill-header">
                    <div class="skill-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                            <polyline points="2 17 12 22 22 17"/>
                            <polyline points="2 12 12 17 22 12"/>
                        </svg>
                    </div>
                    <div class="skill-info">
                        <span class="skill-name">${skill.name}</span>
                        <span class="skill-category">${skill.category}</span>
                    </div>
                    <span class="skill-status ${skill.enabled ? '' : 'disabled'}"></span>
                </div>
                <p class="skill-description">${skill.description}</p>
                <div class="skill-footer">
                    <div class="skill-stats">
                        <span class="skill-stat"><strong>${skill.usageCount || 0}</strong> uses</span>
                        <span class="skill-stat"><strong>${skill.successRate || 0}%</strong> success</span>
                    </div>
                    <div class="skill-actions">
                        <button class="btn btn-sm btn-ghost" onclick="dashboard.editSkill('${skill.id}')">Edit</button>
                        <button class="btn btn-sm btn-secondary" onclick="dashboard.toggleSkill('${skill.id}')">
                            ${skill.enabled ? 'Disable' : 'Enable'}
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
    }
    
    /**
     * Render logs
     */
    renderLogs(logs) {
        const tbody = document.getElementById('logsTableBody');
        if (!tbody) return;
        
        tbody.innerHTML = logs.map(log => `
            <tr onclick="dashboard.showLogDetails('${log.id}')">
                <td class="col-time">${this.formatTime(log.timestamp)}</td>
                <td class="col-level">
                    <span class="log-level ${log.level}">${log.level}</span>
                </td>
                <td class="col-model">${log.model}</td>
                <td class="col-prompt">${this.truncate(log.prompt, 40)}</td>
                <td class="col-tokens">${log.tokens?.toLocaleString() || '-'}</td>
                <td class="col-latency">${log.latency}ms</td>
                <td class="col-status">
                    <span class="status-badge ${log.status === 'success' ? 'healthy' : 'error'}">
                        ${log.status}
                    </span>
                </td>
                <td class="col-actions">
                    <button class="btn btn-sm btn-icon" onclick="event.stopPropagation(); dashboard.showLogDetails('${log.id}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="1"/>
                            <circle cx="19" cy="12" r="1"/>
                            <circle cx="5" cy="12" r="1"/>
                        </svg>
                    </button>
                </td>
            </tr>
        `).join('');
    }
    
    /**
     * Render traces
     */
    renderTraces(traces) {
        const container = document.getElementById('tracesList');
        if (!container) return;
        
        container.innerHTML = traces.map(trace => `
            <div class="trace-item ${this.state.selectedTrace?.id === trace.id ? 'active' : ''}" 
                 onclick="dashboard.selectTrace('${trace.id}')">
                <div class="trace-header">
                    <span class="trace-name">${trace.name}</span>
                    <span class="trace-status ${trace.status}"></span>
                </div>
                <div class="trace-meta">
                    ${this.formatDate(trace.startedAt)} • ${trace.duration}ms • ${trace.steps} steps
                </div>
            </div>
        `).join('');
        
        if (traces.length > 0 && !this.state.selectedTrace) {
            this.selectTrace(traces[0].id);
        }
    }
    
    /**
     * Render trace timeline
     */
    renderTraceTimeline(trace) {
        const container = document.getElementById('traceTimeline');
        if (!container || !trace) return;
        
        container.innerHTML = (trace.steps || []).map((step, index) => `
            <div class="timeline-item ${step.status}">
                <span class="timeline-time">+${step.offset}ms</span>
                <div class="timeline-content">
                    <div class="timeline-title">${step.name}</div>
                    <div class="timeline-details">${step.details}</div>
                </div>
            </div>
        `).join('');
        
        const detailsContainer = document.getElementById('traceDetails');
        if (detailsContainer) {
            detailsContainer.innerHTML = `
                <div class="log-detail-grid">
                    <div class="log-detail-item">
                        <span class="log-detail-label">Trace ID</span>
                        <span class="log-detail-value">${trace.id}</span>
                    </div>
                    <div class="log-detail-item">
                        <span class="log-detail-label">Status</span>
                        <span class="log-detail-value">${trace.status}</span>
                    </div>
                    <div class="log-detail-item">
                        <span class="log-detail-label">Duration</span>
                        <span class="log-detail-value">${trace.duration}ms</span>
                    </div>
                    <div class="log-detail-item">
                        <span class="log-detail-label">Steps</span>
                        <span class="log-detail-value">${trace.steps?.length || 0}</span>
                    </div>
                </div>
            `;
        }
    }
    
    /**
     * Load recent activity
     */
    async loadRecentActivity() {
        const container = document.getElementById('recentActivity');
        if (!container) return;

        try {
            const response = await apiClient.get('/api/admin/activity', { limit: 12 });
            const activities = this.unwrapApiPayload(response, []).map(activity => this.normalizeActivity(activity));
            const items = activities.length > 0 ? activities : [
                { type: 'info', title: 'No recent dashboard activity', meta: 'Waiting for agent tasks' }
            ];

            container.innerHTML = items.map(activity => `
                <div class="activity-item">
                    <div class="activity-icon ${activity.type}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            ${activity.type === 'success' 
                                ? '<polyline points="20 6 9 17 4 12"/>'
                                : activity.type === 'error'
                                ? '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
                                : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
                            }
                        </svg>
                    </div>
                    <div class="activity-content">
                        <span class="activity-title">${activity.title}</span>
                        <span class="activity-meta">${activity.meta}</span>
                    </div>
                </div>
            `).join('');
        } catch (error) {
            console.error('Error loading recent activity:', error);
            container.innerHTML = `
                <div class="activity-item">
                    <div class="activity-icon error">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </div>
                    <div class="activity-content">
                        <span class="activity-title">Failed to load recent activity</span>
                        <span class="activity-meta">${this.escapeHtml(error.message)}</span>
                    </div>
                </div>
            `;
        }
    }
    
    /**
     * Load model usage
     */
    async loadModelUsage() {
        const container = document.getElementById('modelUsage');
        if (!container) return;

        try {
            const response = await apiClient.get('/api/admin/models/usage/stats');
            const usage = this.unwrapApiPayload(response, []).map((model) => ({
                name: model.modelName || model.name || model.modelId || 'Unknown',
                requests: Number(model.requests || 0),
                percent: Number(model.successRate || 0),
            }));

            const items = usage.length > 0 ? usage : [
                { name: 'No usage yet', requests: 0, percent: 0 }
            ];

            container.innerHTML = items.map(model => `
                <div class="model-usage-item">
                    <div class="model-info">
                        <span class="model-name">${this.escapeHtml(model.name)}</span>
                        <span class="model-requests">${model.requests.toLocaleString()} requests</span>
                    </div>
                    <div class="model-bar">
                        <div class="model-fill" style="width: ${Math.max(0, Math.min(model.percent, 100))}%"></div>
                    </div>
                    <span class="model-percent">${Math.max(0, Math.min(model.percent, 100))}%</span>
                </div>
            `).join('');
        } catch (error) {
            console.error('Error loading model usage:', error);
            container.innerHTML = '<div class="model-usage-item"><span class="model-name">Failed to load usage data</span></div>';
        }
    }

    async loadSystemHealth() {
        try {
            const startedAt = performance.now();
            const response = await apiClient.get('/api/admin/health');
            const latency = Math.round(performance.now() - startedAt);
            const health = this.unwrapApiPayload(response, {});
            this.updateConnectionStatus(true);
            this.renderSystemHealth(health, latency);
        } catch (error) {
            console.error('Error loading system health:', error);
            this.updateConnectionStatus(false);
            this.renderSystemHealth(null, null, error);
        }
    }
    
    // ==================== ACTIONS ====================
    
    toggleSidebar() {
        this.state.sidebarCollapsed = !this.state.sidebarCollapsed;
        document.getElementById('sidebar').classList.toggle('collapsed', this.state.sidebarCollapsed);
    }
    
    selectPrompt(prompt) {
        this.state.selectedPrompt = prompt;
        
        document.getElementById('promptName').value = prompt.name;
        document.getElementById('promptEditor').value = prompt.content || '';
        this.updatePromptEditor(prompt.content || '');
        
        // Update active state in list
        document.querySelectorAll('.prompt-item').forEach(item => {
            item.classList.toggle('active', item.dataset.id === prompt.id);
        });
    }
    
    selectPromptById(id) {
        const prompt = this.state.prompts.find(p => p.id === id);
        if (prompt) {
            this.selectPrompt(prompt);
        }
    }
    
    selectTrace(id) {
        const trace = this.state.traces.find(t => t.id === id);
        if (trace) {
            this.state.selectedTrace = trace;
            this.renderTraceTimeline(trace);
            
            // Update active state
            document.querySelectorAll('.trace-item').forEach(item => {
                item.classList.toggle('active', item.dataset.id === id);
            });
        }
    }
    
    updatePromptEditor(content) {
        const charCount = document.getElementById('charCount');
        if (charCount) {
            charCount.textContent = `${content.length} chars`;
        }
        
        // Update preview
        const preview = document.getElementById('promptPreview');
        if (preview) {
            preview.innerHTML = content 
                ? `<pre><code>${this.escapeHtml(content)}</code></pre>`
                : '<p class="preview-placeholder">Preview will appear here...</p>';
        }
    }
    
    async savePrompt() {
        const name = document.getElementById('promptName').value;
        const content = document.getElementById('promptEditor').value;
        
        if (!name || !content) {
            this.showToast('Please provide a name and content', 'warning');
            return;
        }
        
        try {
            const prompt = {
                name,
                content,
                updatedAt: new Date().toISOString()
            };

            if (this.state.selectedPrompt?.id) {
                await apiClient.put(`/api/admin/prompts/${this.state.selectedPrompt.id}`, prompt);
            } else {
                await apiClient.post('/api/admin/prompts', prompt);
            }
            
            this.showToast('Prompt saved successfully', 'success');
            this.loadPrompts();
        } catch (error) {
            this.showToast('Failed to save prompt', 'error');
        }
    }

    openHistoryModal() {
        const modal = document.getElementById('historyModal');
        const container = document.getElementById('historyList');
        if (!modal || !container) return;

        const prompt = this.state.selectedPrompt;
        container.innerHTML = prompt ? `
            <div class="history-item">
                <span class="history-version">Current</span>
                <span class="history-date">${this.formatDate(prompt.updatedAt)}</span>
                <span class="history-author">${prompt.isDefault ? 'System prompt' : 'Custom prompt'}</span>
            </div>
            <div class="history-item">
                <span class="history-version">History unavailable</span>
                <span class="history-date">Backend route not implemented</span>
                <span class="history-author">This dashboard is showing live prompt data only.</span>
            </div>
        ` : '<div class="history-item"><span class="history-version">No prompt selected</span></div>';
        modal.classList.add('active');
    }

    async saveDefaultConfig() {
        try {
            const settings = {
                models: {
                    defaultModel: document.getElementById('defaultModel').value,
                    temperature: parseFloat(document.getElementById('defaultTemperature').value),
                    maxTokens: parseInt(document.getElementById('defaultMaxTokens').value, 10),
                    topP: parseFloat(document.getElementById('defaultTopP').value),
                    frequencyPenalty: parseFloat(document.getElementById('defaultFrequencyPenalty').value),
                    presencePenalty: parseFloat(document.getElementById('defaultPresencePenalty').value),
                },
            };

            const response = await apiClient.put('/api/admin/settings', settings);
            this.applySettings(this.unwrapApiPayload(response, settings));
            this.showToast('Configuration saved', 'success');
        } catch (error) {
            console.error('Error saving default config:', error);
            this.showToast('Failed to save configuration', 'error');
        }
    }
    
    createNewPrompt() {
        this.state.selectedPrompt = null;
        document.getElementById('promptName').value = '';
        document.getElementById('promptEditor').value = '';
        this.updatePromptEditor('');
        
        // Clear active state
        document.querySelectorAll('.prompt-item').forEach(item => {
            item.classList.remove('active');
        });
    }
    
    switchPromptTab(tab) {
        document.querySelectorAll('.editor-tabs .tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `${tab}Tab`);
        });
    }
    
    insertVariable(variable) {
        const editor = document.getElementById('promptEditor');
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const value = editor.value;
        
        editor.value = value.substring(0, start) + variable + value.substring(end);
        editor.focus();
        editor.setSelectionRange(start + variable.length, start + variable.length);
        
        this.updatePromptEditor(editor.value);
    }
    
    openTestPromptModal() {
        const modal = document.getElementById('testPromptModal');
        if (modal) {
            modal.classList.add('active');
        }
    }
    
    openHistoryModal() {
        const modal = document.getElementById('historyModal');
        if (modal) {
            // Load mock history
            const history = [
                { version: 'v1.3', date: new Date(Date.now() - 3600000), author: 'Admin' },
                { version: 'v1.2', date: new Date(Date.now() - 86400000), author: 'Admin' },
                { version: 'v1.1', date: new Date(Date.now() - 172800000), author: 'System' },
                { version: 'v1.0', date: new Date(Date.now() - 259200000), author: 'Admin' }
            ];
            
            const container = document.getElementById('historyList');
            if (container) {
                container.innerHTML = history.map(h => `
                    <div class="history-item" onclick="dashboard.restoreVersion('${h.version}')">
                        <span class="history-version">${h.version}</span>
                        <span class="history-date">${this.formatDate(h.date)}</span>
                        <span class="history-author">${h.author}</span>
                    </div>
                `).join('');
            }
            
            modal.classList.add('active');
        }
    }
    
    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
        }
    }
    
    async runPromptTest() {
        const input = document.getElementById('testInput').value;
        const output = document.querySelector('#testOutput .output-content');
        
        if (!this.state.selectedPrompt?.id) {
            this.showToast('Save or select a prompt before testing it', 'warning');
            return;
        }

        if (!input) {
            this.showToast('Please enter test variables as JSON', 'warning');
            return;
        }
        
        output.innerHTML = '<p class="placeholder">Running test...</p>';
        
        try {
            let variables = {};
            try {
                variables = JSON.parse(input);
            } catch {
                throw new Error('Test input must be valid JSON, for example {"language":"JavaScript"}');
            }

            const response = await apiClient.post(`/api/admin/prompts/${this.state.selectedPrompt.id}/test`, {
                variables
            });
            const result = this.unwrapApiPayload(response, {});
            output.innerHTML = `<pre>${this.escapeHtml(result.rendered || 'No rendered output')}</pre>`;
        } catch (error) {
            output.innerHTML = `<p class="error">Error: ${error.message}</p>`;
        }
    }
    
    async saveDefaultConfig() {
        try {
            const settings = {
                models: {
                    defaultModel: document.getElementById('defaultModel').value,
                    temperature: parseFloat(document.getElementById('defaultTemperature').value),
                    maxTokens: parseInt(document.getElementById('defaultMaxTokens').value),
                }
            };

            await apiClient.put('/api/admin/settings', settings);
            this.showToast('Configuration saved', 'success');
        } catch (error) {
            this.showToast('Failed to save configuration', 'error');
        }
    }
    
    resetDefaultConfig() {
        document.getElementById('defaultTemperature').value = 0.7;
        document.getElementById('defaultMaxTokens').value = 4096;
        document.getElementById('defaultTopP').value = 1;
        document.getElementById('defaultFrequencyPenalty').value = 0;
        document.getElementById('defaultPresencePenalty').value = 0;
        
        // Update display values
        document.querySelectorAll('#defaultConfigForm .range-value').forEach(el => {
            const input = el.previousElementSibling;
            if (input) el.textContent = input.value;
        });
        
        this.showToast('Defaults reset', 'info');
    }
    
    toggleLogsPause() {
        this.state.logsPaused = !this.state.logsPaused;
        const btn = document.getElementById('pauseLogsBtn');
        if (btn) {
            btn.classList.toggle('active', !this.state.logsPaused);
            btn.innerHTML = this.state.logsPaused 
                ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
                : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
        }
    }
    
    clearLogs() {
        apiClient.post('/api/admin/logs/clear')
            .then(() => {
                this.state.logs = [];
                this.state.pagination.logs.total = 0;
                this.renderLogs([]);
                this.updateLogsPagination();
            })
            .catch((error) => {
                console.error('Error clearing logs:', error);
                this.showToast('Failed to clear logs', 'error');
            });
    }
    
    exportLogs() {
        window.open('/api/admin/logs/export/csv', '_blank', 'noopener');
    }
    
    filterLogs() {
        const level = document.getElementById('logLevelFilter')?.value;
        const model = document.getElementById('logModelFilter')?.value;
        const search = document.getElementById('logSearch')?.value.toLowerCase();
        
        let filtered = [...this.state.logs];
        
        if (level && level !== 'all') {
            filtered = filtered.filter(l => l.level === level);
        }
        
        if (model && model !== 'all') {
            filtered = filtered.filter(l => l.model === model);
        }
        
        if (search) {
            filtered = filtered.filter(l => 
                l.prompt?.toLowerCase().includes(search) ||
                l.model?.toLowerCase().includes(search)
            );
        }
        
        this.renderLogs(filtered);
    }
    
    changeLogPage(direction) {
        const { page, total } = this.state.pagination.logs;
        const newPage = page + direction;
        
        if (newPage < 1 || newPage > total) return;
        
        this.state.pagination.logs.page = newPage;
        this.loadLogs();
    }
    
    updateLogsPagination() {
        const { page, limit, total } = this.state.pagination.logs;
        const pages = Math.ceil(total / limit) || 1;
        
        document.getElementById('logsShown').textContent = Math.min(this.state.logs.length, limit);
        document.getElementById('logsTotal').textContent = total;
        document.getElementById('currentPage').textContent = page;
        document.getElementById('totalPages').textContent = pages;
        
        document.getElementById('logsPrevPage').disabled = page <= 1;
        document.getElementById('logsNextPage').disabled = page >= pages;
    }
    
    showLogDetails(id) {
        const log = this.state.logs.find(l => l.id === id);
        if (!log) return;
        
        const modal = document.getElementById('logDetailsModal');
        const container = document.getElementById('logDetails');
        
        if (container) {
            container.innerHTML = `
                <div class="log-detail-section">
                    <h4>Request</h4>
                    <div class="log-detail-content">${this.escapeHtml(log.prompt || 'N/A')}</div>
                </div>
                <div class="log-detail-section">
                    <h4>Response</h4>
                    <div class="log-detail-content">${this.escapeHtml(log.response || 'N/A')}</div>
                </div>
                <div class="log-detail-grid">
                    <div class="log-detail-item">
                        <span class="log-detail-label">Model</span>
                        <span class="log-detail-value">${log.model}</span>
                    </div>
                    <div class="log-detail-item">
                        <span class="log-detail-label">Tokens</span>
                        <span class="log-detail-value">${log.tokens || 0}</span>
                    </div>
                    <div class="log-detail-item">
                        <span class="log-detail-label">Latency</span>
                        <span class="log-detail-value">${log.latency}ms</span>
                    </div>
                    <div class="log-detail-item">
                        <span class="log-detail-label">Timestamp</span>
                        <span class="log-detail-value">${this.formatDate(log.timestamp)}</span>
                    </div>
                </div>
            `;
        }
        
        modal?.classList.add('active');
    }
    
    filterSkills(category) {
        document.querySelectorAll('.category-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.category === category);
        });
        
        let filtered = [...this.state.skills];
        if (category !== 'all') {
            filtered = filtered.filter(s => s.category?.toLowerCase() === category);
        }
        
        this.renderSkills(filtered);
    }
    
    searchSkills(query) {
        const lowerQuery = query.toLowerCase();
        const filtered = this.state.skills.filter(s => 
            s.name.toLowerCase().includes(lowerQuery) ||
            s.description.toLowerCase().includes(lowerQuery)
        );
        this.renderSkills(filtered);
    }
    
    async toggleSkill(id) {
        try {
            const skill = this.state.skills.find(s => s.id === id);
            if (!skill) {
                throw new Error('Skill not found');
            }

            const endpoint = skill.enabled
                ? `/api/admin/skills/${id}/disable`
                : `/api/admin/skills/${id}/enable`;
            await apiClient.post(endpoint);
            this.loadSkills();
            this.showToast('Skill status updated', 'success');
        } catch (error) {
            console.error('Error toggling skill:', error);
            this.showToast('Failed to update skill status', 'error');
        }
    }
    
    discoverSkills() {
        this.showToast('Skill discovery started', 'info');
        // Implement skill discovery logic
    }
    
    filterTraces() {
        const status = document.getElementById('traceStatusFilter')?.value;
        const search = document.getElementById('traceSearch')?.value.toLowerCase();
        
        let filtered = [...this.state.traces];
        
        if (status && status !== 'all') {
            filtered = filtered.filter(t => t.status === status);
        }
        
        if (search) {
            filtered = filtered.filter(t => 
                t.name.toLowerCase().includes(search)
            );
        }
        
        this.renderTraces(filtered);
    }
    
    switchSettingsSection(section) {
        document.querySelectorAll('.settings-nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.settings === section);
        });
        
        document.querySelectorAll('.settings-section').forEach(s => {
            s.classList.toggle('active', s.id === `${section}Settings`);
        });
    }
    
    async saveGeneralSettings() {
        try {
            const settings = {
                general: {
                    appName: document.getElementById('dashboardTitle').value,
                    timezone: document.getElementById('timezone').value,
                    dateFormat: document.getElementById('dateFormat').value
                }
            };
            
            await apiClient.put('/api/admin/settings', settings);
            this.showToast('Settings saved', 'success');
        } catch (error) {
            this.showToast('Failed to save settings', 'error');
        }
    }
    
    async saveApiSettings() {
        try {
            const settings = {
                api: {
                    baseURL: document.getElementById('apiEndpoint').value,
                    timeout: parseInt(document.getElementById('requestTimeout').value),
                    maxRetries: parseInt(document.getElementById('maxRetries').value)
                }
            };
            
            await apiClient.put('/api/admin/settings', settings);
            this.showToast('API settings saved', 'success');
        } catch (error) {
            this.showToast('Failed to save API settings', 'error');
        }
    }
    
    async testConnection() {
        try {
            await apiClient.get('/api/admin/health');
            this.updateConnectionStatus(true);
            this.showToast('Connection successful', 'success');
        } catch (error) {
            this.updateConnectionStatus(false);
            this.showToast('Connection failed', 'error');
        }
    }
    
    togglePasswordVisibility(id) {
        const input = document.getElementById(id);
        if (input) {
            input.type = input.type === 'password' ? 'text' : 'password';
        }
    }
    
    confirmClearAllLogs() {
        if (confirm('Are you sure you want to clear all logs? This action cannot be undone.')) {
            this.clearLogs();
            this.showToast('All logs cleared', 'success');
        }
    }
    
    confirmResetConfig() {
        if (confirm('Are you sure you want to reset all settings to defaults?')) {
            localStorage.removeItem('dashboard_settings');
            location.reload();
        }
    }
    
    exportAllData() {
        const data = {
            settings: this.state.settings,
            prompts: this.state.prompts,
            logs: this.state.logs,
            exportedAt: new Date().toISOString()
        };
        
        this.downloadFile(
            JSON.stringify(data, null, 2),
            `dashboard-export-${Date.now()}.json`,
            'application/json'
        );
    }
    
    async updateFeatureToggle(featureId, enabled) {
        try {
            await apiClient.put('/api/admin/settings', {
                features: {
                    [featureId]: enabled
                }
            });
            this.showToast(`Feature ${enabled ? 'enabled' : 'disabled'}`, 'success');
        } catch (error) {
            this.showToast('Failed to update feature toggle', 'error');
        }
    }
    
    // ==================== HELPERS ====================
    
    updateConnectionStatus(connected) {
        const dot = document.querySelector('#connectionStatus .status-dot');
        const text = document.querySelector('#connectionStatus .status-text');
        
        if (dot && text) {
            dot.classList.toggle('online', connected);
            dot.classList.toggle('offline', !connected);
            text.textContent = connected ? 'Connected' : 'Disconnected';
        }
    }

    unwrapApiPayload(response, fallback = null) {
        if (response == null) return fallback;
        if (typeof response === 'object' && 'success' in response && 'data' in response) {
            return response.data ?? fallback;
        }
        return response;
    }

    getApiPagination(response) {
        if (response && typeof response === 'object' && response.pagination) {
            return response.pagination;
        }
        return null;
    }

    normalizeOverviewStats(payload = {}) {
        const overview = payload.overview || {};
        return {
            totalTasks: Number(overview.totalTasks || payload.totalTasks || 0),
            successRate: Number(overview.successRate || payload.successRate || 0),
            activeSessions: Number(overview.activeSessions || payload.activeSessions || 0),
            skillsLearned: Number(overview.totalSkills || payload.skillsLearned || 0),
        };
    }

    normalizeModel(model = {}) {
        return {
            ...model,
            provider: model.provider || model.owned_by || 'unknown',
            active: Boolean(model.active ?? model.isActive ?? model.isDefault),
            requests: Number(model.requests || 0),
            avgLatency: Number(model.avgLatency || model.avgResponseTime || 0),
        };
    }

    normalizeSkill(skill = {}) {
        return {
            ...skill,
            enabled: Boolean(skill.enabled ?? skill.isEnabled),
            usageCount: Number(skill.usageCount ?? skill.stats?.usageCount ?? 0),
            successRate: Number(skill.successRate ?? skill.stats?.successRate ?? 0),
        };
    }

    normalizeLog(log = {}) {
        return {
            ...log,
            level: log.level || 'info',
            model: log.model || '-',
            prompt: log.prompt || log.message || '-',
            latency: Number(log.latency || log.duration || 0),
            status: log.status || (log.error ? 'error' : 'success'),
        };
    }

    normalizeTrace(trace = {}) {
        const steps = Array.isArray(trace.steps)
            ? trace.steps
            : Array.isArray(trace.timeline)
                ? trace.timeline.map((step, index) => ({
                    name: step.name || step.type || `Step ${index + 1}`,
                    offset: step.duration || 0,
                    status: step.status === 'completed' ? 'success' : (step.status || 'info'),
                    details: typeof step.details === 'string' ? step.details : JSON.stringify(step.details || {}),
                }))
                : [];

        return {
            ...trace,
            name: trace.name || trace.objective || trace.input || trace.taskId || trace.id,
            startedAt: trace.startedAt || trace.startTime || trace.createdAt,
            duration: Number(trace.duration || 0),
            steps,
        };
    }

    normalizeActivity(activity = {}) {
        const typeMap = {
            task_completed: 'success',
            task_failed: 'error',
            task_cancelled: 'warning',
            task_created: 'info',
            session_cleared: 'info',
        };

        return {
            type: typeMap[activity.type] || 'info',
            title: activity.description || activity.title || activity.type || 'Activity',
            meta: this.formatDate(activity.timestamp),
        };
    }

    renderSystemHealth(health, latency, error = null) {
        const statusEl = document.getElementById('systemHealthStatus');
        const apiLatencyFill = document.getElementById('healthApiLatencyFill');
        const apiLatencyValue = document.getElementById('healthApiLatencyValue');
        const sdkFill = document.getElementById('healthSdkFill');
        const sdkValue = document.getElementById('healthSdkValue');
        const memoryFill = document.getElementById('healthMemoryFill');
        const memoryValue = document.getElementById('healthMemoryValue');
        const vectorFill = document.getElementById('healthVectorFill');
        const vectorValue = document.getElementById('healthVectorValue');

        if (!statusEl || !apiLatencyFill || !apiLatencyValue || !sdkFill || !sdkValue || !memoryFill || !memoryValue || !vectorFill || !vectorValue) {
            return;
        }

        if (error || !health) {
            statusEl.textContent = 'Disconnected';
            statusEl.className = 'status-badge error';
            apiLatencyFill.style.width = '0%';
            apiLatencyValue.textContent = '--';
            sdkFill.style.width = '0%';
            sdkValue.textContent = 'offline';
            memoryFill.style.width = '0%';
            memoryValue.textContent = '--';
            vectorFill.style.width = '0%';
            vectorValue.textContent = 'offline';
            return;
        }

        const status = health.status || 'unknown';
        statusEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        statusEl.className = `status-badge ${status === 'healthy' ? 'healthy' : (status === 'degraded' ? 'warning' : 'error')}`;

        const memoryBytes = Number(health.memory?.heapUsed || 0);
        const memoryMb = Math.round(memoryBytes / (1024 * 1024));
        const memoryPercent = Math.max(0, Math.min(100, Math.round((memoryBytes / Math.max(Number(health.memory?.heapTotal || 1), 1)) * 100)));
        const apiPercent = Math.max(5, Math.min(100, Math.round((Number(latency || 0) / 500) * 100)));
        const sdkConnected = health.services?.sdk === 'connected';
        const vectorConnected = health.services?.vectorStore === 'connected';

        apiLatencyFill.style.width = `${apiPercent}%`;
        apiLatencyValue.textContent = `${Number(latency || 0)}ms`;
        sdkFill.style.width = sdkConnected ? '100%' : '20%';
        sdkValue.textContent = health.services?.sdk || 'unknown';
        memoryFill.style.width = `${memoryPercent}%`;
        memoryValue.textContent = `${memoryMb} MB`;
        vectorFill.style.width = vectorConnected ? '100%' : '20%';
        vectorValue.textContent = health.services?.vectorStore || 'unknown';
    }
    
    addRealtimeLog(log) {
        if (this.state.logsPaused) return;
        
        this.state.logs.unshift(log);
        if (this.state.logs.length > 1000) {
            this.state.logs.pop();
        }
        
        if (this.state.currentView === 'logs') {
            this.renderLogs(this.state.logs);
        }
        
        // Update badge
        const badge = document.getElementById('logsBadge');
        if (badge) {
            badge.textContent = parseInt(badge.textContent || 0) + 1;
            badge.style.display = 'inline';
        }
    }
    
    updateStats(stats) {
        this.state.stats = { ...this.state.stats, ...stats };
        this.loadStats();
    }
    
    updateTrace(trace) {
        const index = this.state.traces.findIndex(t => t.id === trace.id);
        if (index !== -1) {
            this.state.traces[index] = trace;
        } else {
            this.state.traces.unshift(trace);
        }
        
        if (this.state.currentView === 'traces') {
            this.renderTraces(this.state.traces);
        }
    }
    
    updateChartTimeRange(range) {
        // Update chart data based on time range
        const hours = range === '1h' ? 1 : range === '24h' ? 24 : range === '7d' ? 168 : 720;
        
        if (this.charts.requestVolume) {
            this.charts.requestVolume.data.labels = this.generateTimeLabels(hours);
            this.charts.requestVolume.data.datasets[0].data = this.generateRandomData(hours, 50, 200);
            this.charts.requestVolume.update();
        }
    }
    
    handleGlobalSearch(query) {
        if (!query) return;
        
        // Search across all data
        const results = {
            prompts: this.state.prompts.filter(p => 
                p.name.toLowerCase().includes(query.toLowerCase())
            ),
            skills: this.state.skills.filter(s => 
                s.name.toLowerCase().includes(query.toLowerCase())
            ),
            logs: this.state.logs.filter(l => 
                l.prompt?.toLowerCase().includes(query.toLowerCase())
            )
        };
        
        // Show results count in toast
        const total = Object.values(results).reduce((a, b) => a + b.length, 0);
        if (total > 0) {
            this.showToast(`Found ${total} results`, 'info');
        }
    }
    
    handleResize() {
        // Resize charts
        Object.values(this.charts).forEach(chart => {
            chart?.resize();
        });
    }
    
    showToast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icons = {
            success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
            error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
            warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
            info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
        };
        
        toast.innerHTML = `
            <div class="toast-icon">${icons[type]}</div>
            <div class="toast-content">
                <span class="toast-title">${message}</span>
            </div>
            <button class="toast-close">&times;</button>
        `;
        
        toast.querySelector('.toast-close').addEventListener('click', () => {
            toast.classList.add('hiding');
            setTimeout(() => toast.remove(), 300);
        });
        
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('hiding');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
    
    // ==================== UTILITY METHODS ====================
    
    formatDate(date) {
        if (!date) return 'Unknown';
        const d = new Date(date);
        const now = new Date();
        const diff = now - d;
        
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        
        return d.toLocaleDateString();
    }
    
    formatTime(date) {
        if (!date) return '--:--';
        return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    
    truncate(str, length) {
        if (!str) return '';
        return str.length > length ? str.substring(0, length) + '...' : str;
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    generateTimeLabels(count) {
        const labels = [];
        const now = new Date();
        for (let i = count - 1; i >= 0; i--) {
            const d = new Date(now - i * 3600000);
            labels.push(d.getHours() + ':00');
        }
        return labels;
    }
    
    generateRandomData(count, min, max) {
        return Array.from({ length: count }, () => 
            Math.floor(Math.random() * (max - min + 1)) + min
        );
    }
    
    convertToCSV(data) {
        if (!data.length) return '';
        const headers = Object.keys(data[0]);
        const rows = data.map(row => 
            headers.map(h => `"${(row[h] || '').toString().replace(/"/g, '""')}"`).join(',')
        );
        return [headers.join(','), ...rows].join('\n');
    }
    
    downloadFile(content, filename, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }
    
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    renderTraces(traces) {
        const container = document.getElementById('tracesList');
        if (!container) return;

        container.innerHTML = traces.map((trace) => `
            <div class="trace-item ${this.state.selectedTrace?.id === trace.id ? 'active' : ''}" data-id="${trace.id}"
                 onclick="dashboard.selectTrace('${trace.id}')">
                <div class="trace-header">
                    <span class="trace-name">${trace.name}</span>
                    <span class="trace-status ${trace.status}"></span>
                </div>
                <div class="trace-meta">
                    ${this.formatDate(trace.startedAt)} &middot; ${trace.duration}ms &middot; ${(trace.steps || []).length} steps
                </div>
            </div>
        `).join('');

        if (traces.length > 0 && !this.state.selectedTrace) {
            this.selectTrace(traces[0].id);
        }
    }

    async loadModelUsage() {
        const container = document.getElementById('modelUsage');
        if (!container) return;

        try {
            const response = await apiClient.get('/api/admin/models/usage/stats');
            const usage = this.unwrapApiPayload(response, []).map((model) => ({
                name: model.modelName || model.name || model.modelId || 'Unknown',
                requests: Number(model.requests || 0),
                avgLatency: Number(model.avgResponseTime || 0),
            }));
            const totalRequests = usage.reduce((sum, model) => sum + model.requests, 0);
            const items = usage.length > 0
                ? usage.map((model) => ({
                    ...model,
                    percent: totalRequests > 0 ? Math.round((model.requests / totalRequests) * 100) : 0,
                }))
                : [{ name: 'No usage yet', requests: 0, avgLatency: 0, percent: 0 }];

            container.innerHTML = items.map((model) => `
                <div class="model-usage-item">
                    <div class="model-info">
                        <span class="model-name">${this.escapeHtml(model.name)}</span>
                        <span class="model-requests">${model.requests.toLocaleString()} requests${model.avgLatency ? ` | ${model.avgLatency}ms avg` : ''}</span>
                    </div>
                    <div class="model-bar">
                        <div class="model-fill" style="width: ${Math.max(0, Math.min(model.percent, 100))}%"></div>
                    </div>
                    <span class="model-percent">${Math.max(0, Math.min(model.percent, 100))}%</span>
                </div>
            `).join('');
        } catch (error) {
            console.error('Error loading model usage:', error);
            container.innerHTML = '<div class="model-usage-item"><span class="model-name">Failed to load usage data</span></div>';
        }
    }

    async savePrompt() {
        const name = document.getElementById('promptName').value;
        const content = document.getElementById('promptEditor').value;

        if (!name || !content) {
            this.showToast('Please provide a name and content', 'warning');
            return;
        }

        try {
            const prompt = {
                name,
                content,
                updatedAt: new Date().toISOString(),
            };

            let savedPrompt = null;
            if (this.state.selectedPrompt?.id) {
                const response = await apiClient.put(`/api/admin/prompts/${this.state.selectedPrompt.id}`, prompt);
                savedPrompt = this.unwrapApiPayload(response, null);
            } else {
                const response = await apiClient.post('/api/admin/prompts', prompt);
                savedPrompt = this.unwrapApiPayload(response, null);
            }

            this.showToast('Prompt saved successfully', 'success');
            await this.loadPrompts();
            if (savedPrompt?.id) {
                this.selectPromptById(savedPrompt.id);
            }
        } catch (error) {
            console.error('Error saving prompt:', error);
            this.showToast('Failed to save prompt', 'error');
        }
    }

    async runPromptTest() {
        const input = document.getElementById('testInput').value;
        const output = document.querySelector('#testOutput .output-content');

        if (!this.state.selectedPrompt?.id) {
            this.showToast('Save or select a prompt before testing it', 'warning');
            return;
        }

        if (!input) {
            this.showToast('Please enter test variables as JSON', 'warning');
            return;
        }

        output.innerHTML = '<p class="placeholder">Running test...</p>';

        try {
            let variables = {};
            try {
                variables = JSON.parse(input);
            } catch {
                throw new Error('Test input must be valid JSON, for example {"language":"JavaScript"}');
            }

            const response = await apiClient.post(`/api/admin/prompts/${this.state.selectedPrompt.id}/test`, {
                variables,
            });
            const result = this.unwrapApiPayload(response, {});
            output.innerHTML = `
                <pre>${this.escapeHtml(result.rendered || 'No rendered output')}</pre>
                <div class="log-detail-grid">
                    <div class="log-detail-item">
                        <span class="log-detail-label">Characters</span>
                        <span class="log-detail-value">${result.stats?.characters || 0}</span>
                    </div>
                    <div class="log-detail-item">
                        <span class="log-detail-label">Estimated Tokens</span>
                        <span class="log-detail-value">${result.stats?.tokens || 0}</span>
                    </div>
                    <div class="log-detail-item">
                        <span class="log-detail-label">Missing Variables</span>
                        <span class="log-detail-value">${(result.missing || []).join(', ') || 'None'}</span>
                    </div>
                </div>
            `;
        } catch (error) {
            output.innerHTML = `<p class="error">Error: ${error.message}</p>`;
        }
    }

    async clearLogs() {
        try {
            await apiClient.post('/api/admin/logs/clear');
            this.state.logs = [];
            this.state.pagination.logs.total = 0;
            this.renderLogs([]);
            this.updateLogsPagination();
            this.showToast('All logs cleared', 'success');
        } catch (error) {
            console.error('Error clearing logs:', error);
            this.showToast('Failed to clear logs', 'error');
        }
    }

    changeLogPage(direction) {
        const { page, total, limit } = this.state.pagination.logs;
        const newPage = page + direction;
        const totalPages = Math.ceil(total / Math.max(limit, 1)) || 1;

        if (newPage < 1 || newPage > totalPages) return;

        this.state.pagination.logs.page = newPage;
        this.loadLogs();
    }

    discoverSkills() {
        this.showToast('Skill discovery is not exposed by the backend yet', 'info');
    }

    async saveGeneralSettings() {
        try {
            const settings = {
                general: {
                    appName: document.getElementById('dashboardTitle').value,
                    timezone: document.getElementById('timezone').value,
                    dateFormat: document.getElementById('dateFormat').value,
                },
            };

            const response = await apiClient.put('/api/admin/settings', settings);
            this.applySettings(this.unwrapApiPayload(response, settings));
            this.showToast('Settings saved', 'success');
        } catch (error) {
            console.error('Error saving general settings:', error);
            this.showToast('Failed to save settings', 'error');
        }
    }

    async saveApiSettings() {
        try {
            apiClient.apiKey = document.getElementById('apiKey').value.trim();
            localStorage.setItem('api_key', apiClient.apiKey);

            const settings = {
                api: {
                    baseURL: document.getElementById('apiEndpoint').value,
                    timeout: parseInt(document.getElementById('requestTimeout').value, 10),
                    maxRetries: parseInt(document.getElementById('maxRetries').value, 10),
                },
            };

            const response = await apiClient.put('/api/admin/settings', settings);
            this.applySettings(this.unwrapApiPayload(response, settings));
            this.showToast('API settings saved', 'success');
        } catch (error) {
            console.error('Error saving API settings:', error);
            this.showToast('Failed to save API settings', 'error');
        }
    }

    async testConnection() {
        try {
            const response = await apiClient.get('/api/admin/health');
            const health = this.unwrapApiPayload(response, {});
            this.updateConnectionStatus(true);
            this.showToast(`Connection successful (${health.status || 'unknown'})`, 'success');
        } catch (error) {
            this.updateConnectionStatus(false);
            this.showToast(`Connection failed: ${error.message}`, 'error');
        }
    }

    confirmClearAllLogs() {
        if (confirm('Are you sure you want to clear all logs? This action cannot be undone.')) {
            this.clearLogs();
        }
    }

    confirmResetConfig() {
        if (!confirm('Are you sure you want to reset all settings to defaults?')) {
            return;
        }

        apiClient.post('/api/admin/settings/reset')
            .then((response) => {
                const settings = this.unwrapApiPayload(response, {});
                this.applySettings(settings);
                this.showToast('Settings reset to defaults', 'success');
            })
            .catch((error) => {
                console.error('Error resetting settings:', error);
                this.showToast('Failed to reset settings', 'error');
            });
    }

    async updateFeatureToggle(featureId, enabled) {
        try {
            const response = await apiClient.put('/api/admin/settings', this.getFeatureSettingsPatch(featureId, enabled));
            this.applySettings(this.unwrapApiPayload(response, this.state.settings));
            this.showToast(`Feature ${enabled ? 'enabled' : 'disabled'}`, 'success');
        } catch (error) {
            console.error('Error updating feature toggle:', error);
            this.showToast('Failed to update feature toggle', 'error');
        }
    }

    editModel(id) {
        const model = this.state.models.find((item) => item.id === id);
        if (!model) {
            this.showToast('Model not found', 'error');
            return;
        }

        this.navigateTo('models');
        this.setInputValue('defaultModel', model.id);
        this.showToast(`Loaded ${model.name} into the default config editor`, 'info');
    }

    testModel(id) {
        const model = this.state.models.find((item) => item.id === id);
        if (!model) {
            this.showToast('Model not found', 'error');
            return;
        }

        this.showToast(`${model.name} is configured in the dashboard`, 'info');
    }

    editSkill(id) {
        const skill = this.state.skills.find((item) => item.id === id);
        if (!skill) {
            this.showToast('Skill not found', 'error');
            return;
        }

        this.navigateTo('skills');
        this.showToast(`${skill.name}: ${skill.description}`, 'info', 5000);
    }

    restoreVersion(version) {
        this.showToast(`Prompt history restore is not available yet (${version})`, 'info');
    }

    normalizeModel(model = {}) {
        return {
            ...model,
            provider: model.provider || model.owned_by || 'unknown',
            active: Boolean(model.active ?? model.isActive ?? model.isDefault),
            requests: Number(model.requests ?? model.usageCount ?? 0),
            avgLatency: Number(model.avgLatency ?? model.avgResponseTime ?? 0),
        };
    }

    getFeatureSettingsPatch(featureId, enabled) {
        const featureMap = {
            featureWebsocket: 'realTimeUpdates',
            featureSkillDiscovery: 'enableSkills',
            featureValidation: 'enableTracing',
            featureDebug: 'enableDebug',
        };
        const key = featureMap[featureId] || featureId;

        if (featureId === 'featureRetry') {
            return {
                api: {
                    maxRetries: enabled ? Math.max(Number(this.state.settings?.api?.maxRetries || 3), 1) : 0,
                },
            };
        }

        return {
            features: {
                [key]: enabled,
            },
        };
    }

    syncModelOptions(models = this.state.models) {
        const select = document.getElementById('defaultModel');
        if (!select) return;

        const existing = new Set(Array.from(select.options).map((option) => option.value));
        (models || []).forEach((model) => {
            if (existing.has(model.id)) return;
            const option = document.createElement('option');
            option.value = model.id;
            option.textContent = model.name;
            select.appendChild(option);
        });

        if (this.state.settings?.models?.defaultModel) {
            select.value = this.state.settings.models.defaultModel;
        }
    }

    populateLogModelFilter(logs = []) {
        const select = document.getElementById('logModelFilter');
        if (!select) return;

        const currentValue = select.value || 'all';
        const models = Array.from(new Set((logs || []).map((log) => log.model).filter(Boolean)));

        select.innerHTML = '<option value="all">All Models</option>' + models.map((model) =>
            `<option value="${this.escapeHtml(model)}">${this.escapeHtml(model)}</option>`
        ).join('');
        select.value = models.includes(currentValue) || currentValue === 'all' ? currentValue : 'all';
    }

    applySettings(settings = {}) {
        this.state.settings = settings;

        const general = settings.general || {};
        const models = settings.models || {};
        const api = settings.api || {};
        const features = settings.features || {};

        this.setInputValue('dashboardTitle', general.appName || 'Agent SDK Admin');
        this.setInputValue('timezone', general.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
        this.setInputValue('dateFormat', general.dateFormat || 'YYYY-MM-DD');
        this.setInputValue('apiEndpoint', api.baseURL || window.location.origin);
        this.setInputValue('apiKey', apiClient.apiKey || localStorage.getItem('api_key') || '');
        this.setInputValue('requestTimeout', api.timeout ?? 30000);
        this.setInputValue('maxRetries', api.maxRetries ?? 3);
        this.setInputValue('defaultTemperature', models.temperature ?? 0.7);
        this.setInputValue('defaultMaxTokens', models.maxTokens ?? 4096);
        this.setInputValue('defaultTopP', models.topP ?? 1);
        this.setInputValue('defaultFrequencyPenalty', models.frequencyPenalty ?? 0);
        this.setInputValue('defaultPresencePenalty', models.presencePenalty ?? 0);

        this.syncModelOptions();
        this.setInputValue('defaultModel', models.defaultModel || 'gpt-4o');
        apiClient.baseUrl = window.location.origin;

        this.setCheckboxValue('featureWebsocket', Boolean(features.realTimeUpdates));
        this.setCheckboxValue('featureCaching', Boolean(features.featureCaching));
        this.setCheckboxValue('featureRetry', Number(api.maxRetries ?? 0) > 0);
        this.setCheckboxValue('featureSkillDiscovery', Boolean(features.enableSkills));
        this.setCheckboxValue('featureValidation', Boolean(features.enableTracing));
        this.setCheckboxValue('featureDebug', Boolean(features.enableDebug));

        ['defaultTemperature', 'defaultTopP', 'defaultFrequencyPenalty', 'defaultPresencePenalty'].forEach((id) => {
            this.syncRangeValue(id);
        });
    }

    setInputValue(id, value) {
        const element = document.getElementById(id);
        if (!element || value === undefined || value === null) return;

        if (element.tagName === 'SELECT') {
            const exists = Array.from(element.options).some((option) => option.value === String(value));
            if (!exists) {
                const option = document.createElement('option');
                option.value = String(value);
                option.textContent = String(value);
                element.appendChild(option);
            }
        }

        element.value = String(value);
    }

    setCheckboxValue(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.checked = Boolean(value);
        }
    }

    syncRangeValue(id) {
        const input = document.getElementById(id);
        if (!input) return;

        const display = input.parentElement?.querySelector('.range-value');
        if (display) {
            display.textContent = input.value;
        }
    }
    
    // ==================== MOCK DATA ====================
    
    getMockModels() {
        return [
            { id: '1', name: 'GPT-4o', provider: 'OpenAI', active: true, requests: 842, avgLatency: 145, capabilities: ['vision', 'function-calling', 'json-mode'] },
            { id: '2', name: 'GPT-4o Mini', provider: 'OpenAI', active: true, requests: 312, avgLatency: 89, capabilities: ['function-calling', 'json-mode'] },
            { id: '3', name: 'GPT-4 Turbo', provider: 'OpenAI', active: true, requests: 156, avgLatency: 234, capabilities: ['vision', 'function-calling'] },
            { id: '4', name: 'GPT-3.5 Turbo', provider: 'OpenAI', active: false, requests: 93, avgLatency: 67, capabilities: ['function-calling'] }
        ];
    }
    
    getMockPrompts() {
        return [
            { id: '1', name: 'Default Assistant', content: 'You are a helpful AI assistant.', updatedAt: new Date().toISOString() },
            { id: '2', name: 'Code Reviewer', content: 'You are an expert code reviewer. Analyze the provided code for bugs, performance issues, and best practices.', updatedAt: new Date(Date.now() - 86400000).toISOString() },
            { id: '3', name: 'Documentation Writer', content: 'Create clear, comprehensive documentation for the given topic or code.', updatedAt: new Date(Date.now() - 172800000).toISOString() }
        ];
    }
    
    getMockSkills() {
        return [
            { id: '1', name: 'File Parser', category: 'builtin', description: 'Parse and extract content from various file formats', enabled: true, usageCount: 456, successRate: 98 },
            { id: '2', name: 'Web Search', category: 'builtin', description: 'Search the web for current information', enabled: true, usageCount: 234, successRate: 95 },
            { id: '3', name: 'Code Executor', category: 'custom', description: 'Execute code in various languages safely', enabled: true, usageCount: 123, successRate: 92 },
            { id: '4', name: 'Database Query', category: 'custom', description: 'Query connected databases using natural language', enabled: false, usageCount: 89, successRate: 88 }
        ];
    }
    
    getMockLogs() {
        const logs = [];
        const levels = ['info', 'warn', 'error', 'debug'];
        const models = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];
        const statuses = ['success', 'success', 'success', 'error'];
        
        for (let i = 0; i < 50; i++) {
            logs.push({
                id: `log-${i}`,
                timestamp: new Date(Date.now() - i * 60000).toISOString(),
                level: levels[Math.floor(Math.random() * levels.length)],
                model: models[Math.floor(Math.random() * models.length)],
                prompt: `Sample prompt request ${i}`,
                response: `Sample response ${i}`,
                tokens: Math.floor(Math.random() * 2000) + 100,
                latency: Math.floor(Math.random() * 500) + 50,
                status: statuses[Math.floor(Math.random() * statuses.length)]
            });
        }
        
        return logs;
    }
    
    getMockTraces() {
        return [
            {
                id: 'trace-1',
                name: 'Document Processing',
                status: 'completed',
                startedAt: new Date().toISOString(),
                duration: 2345,
                steps: 5,
                steps: [
                    { name: 'Parse Request', offset: 0, status: 'success', details: 'Request parsed successfully' },
                    { name: 'Load Document', offset: 234, status: 'success', details: 'Document loaded from storage' },
                    { name: 'Extract Text', offset: 567, status: 'success', details: 'Text extracted using OCR' },
                    { name: 'Process Content', offset: 1234, status: 'success', details: 'Content processed by AI' },
                    { name: 'Generate Response', offset: 2345, status: 'success', details: 'Response generated' }
                ]
            },
            {
                id: 'trace-2',
                name: 'Code Analysis',
                status: 'running',
                startedAt: new Date(Date.now() - 30000).toISOString(),
                duration: 1234,
                steps: 3,
                steps: [
                    { name: 'Parse Request', offset: 0, status: 'success', details: 'Request parsed successfully' },
                    { name: 'Load Files', offset: 345, status: 'success', details: 'Files loaded from repository' },
                    { name: 'Analyze Code', offset: 1234, status: 'running', details: 'Analyzing code structure...' }
                ]
            },
            {
                id: 'trace-3',
                name: 'Data Transformation',
                status: 'failed',
                startedAt: new Date(Date.now() - 3600000).toISOString(),
                duration: 890,
                steps: 4,
                steps: [
                    { name: 'Parse Request', offset: 0, status: 'success', details: 'Request parsed successfully' },
                    { name: 'Load Data', offset: 234, status: 'success', details: 'Data loaded from database' },
                    { name: 'Transform', offset: 567, status: 'error', details: 'Transformation failed: Invalid schema' },
                    { name: 'Save Results', offset: 890, status: 'error', details: 'Skipped due to previous error' }
                ]
            }
        ];
    }
}

// ==================== INITIALIZATION ====================

let dashboard;

document.addEventListener('DOMContentLoaded', () => {
    dashboard = new Dashboard();
    window.dashboard = dashboard; // Expose for debugging
});
