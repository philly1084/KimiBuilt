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
        
        // Show welcome toast
        this.showToast('Dashboard connected', 'success');
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
            this.loadRecentActivity();
            
            // Load model usage
            this.loadModelUsage();
            
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
            // Mock data - replace with actual API call
            const stats = await apiClient.get('/api/admin/stats') || {
                totalTasks: 1247,
                successRate: 97.3,
                activeSessions: 8,
                skillsLearned: 24
            };
            
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
            const models = await apiClient.get('/api/admin/models') || this.getMockModels();
            this.state.models = models;
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
            const prompts = await apiClient.get('/api/admin/prompts') || this.getMockPrompts();
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
            const skills = await apiClient.get('/api/admin/skills') || this.getMockSkills();
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
            const logs = await apiClient.get(`/api/admin/logs?page=${page}&limit=${limit}`) || 
                        this.getMockLogs();
            
            this.state.logs = logs;
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
            const traces = await apiClient.get(`/api/admin/traces?page=${page}&limit=${limit}`) || 
                          this.getMockTraces();
            
            this.state.traces = traces;
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
            const settings = await apiClient.get('/api/admin/settings');
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
        const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/admin`;
        
        try {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('WebSocket connected');
                this.updateConnectionStatus(true);
            };
            
            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleWebSocketMessage(data);
            };
            
            this.ws.onclose = () => {
                console.log('WebSocket disconnected');
                this.updateConnectionStatus(false);
                this.scheduleReconnect();
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
            
        } catch (error) {
            console.error('Failed to setup WebSocket:', error);
        }
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
        this.refreshInterval = setInterval(() => {
            this.loadStats();
            
            if (this.state.currentView === 'logs' && !this.state.logsPaused) {
                this.loadLogs();
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
    loadRecentActivity() {
        const activities = [
            { type: 'success', title: 'Task completed successfully', meta: '2 minutes ago' },
            { type: 'info', title: 'New skill discovered: file_parser', meta: '15 minutes ago' },
            { type: 'error', title: 'API request failed', meta: '1 hour ago' },
            { type: 'success', title: 'Model configuration updated', meta: '2 hours ago' }
        ];
        
        const container = document.getElementById('recentActivity');
        if (!container) return;
        
        container.innerHTML = activities.map(activity => `
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
    }
    
    /**
     * Load model usage
     */
    loadModelUsage() {
        const usage = [
            { name: 'GPT-4o', requests: 842, percent: 68 },
            { name: 'GPT-4o Mini', requests: 312, percent: 25 },
            { name: 'GPT-3.5 Turbo', requests: 93, percent: 7 }
        ];
        
        const container = document.getElementById('modelUsage');
        if (!container) return;
        
        container.innerHTML = usage.map(model => `
            <div class="model-usage-item">
                <div class="model-info">
                    <span class="model-name">${model.name}</span>
                    <span class="model-requests">${model.requests.toLocaleString()} requests</span>
                </div>
                <div class="model-bar">
                    <div class="model-fill" style="width: ${model.percent}%"></div>
                </div>
                <span class="model-percent">${model.percent}%</span>
            </div>
        `).join('');
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
                id: this.state.selectedPrompt?.id || Date.now().toString(),
                name,
                content,
                updatedAt: new Date().toISOString()
            };
            
            await apiClient.post('/api/admin/prompts', prompt);
            
            this.showToast('Prompt saved successfully', 'success');
            this.loadPrompts();
        } catch (error) {
            this.showToast('Failed to save prompt', 'error');
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
        const model = document.getElementById('testModel').value;
        const temperature = document.getElementById('testTemperature').value;
        const output = document.querySelector('#testOutput .output-content');
        
        if (!input) {
            this.showToast('Please enter test input', 'warning');
            return;
        }
        
        output.innerHTML = '<p class="placeholder">Running test...</p>';
        
        try {
            const result = await apiClient.post('/api/admin/test', {
                prompt: document.getElementById('promptEditor').value,
                input,
                model,
                temperature: parseFloat(temperature)
            });
            
            output.innerHTML = `<pre>${this.escapeHtml(result.response || 'No response')}</pre>`;
        } catch (error) {
            output.innerHTML = `<p class="error">Error: ${error.message}</p>`;
        }
    }
    
    async saveDefaultConfig() {
        try {
            const config = {
                model: document.getElementById('defaultModel').value,
                temperature: parseFloat(document.getElementById('defaultTemperature').value),
                maxTokens: parseInt(document.getElementById('defaultMaxTokens').value),
                topP: parseFloat(document.getElementById('defaultTopP').value),
                frequencyPenalty: parseFloat(document.getElementById('defaultFrequencyPenalty').value),
                presencePenalty: parseFloat(document.getElementById('defaultPresencePenalty').value)
            };
            
            await apiClient.post('/api/admin/config', config);
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
        this.state.logs = [];
        this.renderLogs([]);
        this.updateLogsPagination();
    }
    
    exportLogs() {
        const csv = this.convertToCSV(this.state.logs);
        this.downloadFile(csv, 'logs.csv', 'text/csv');
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
            await apiClient.post(`/api/admin/skills/${id}/toggle`);
            this.loadSkills();
            this.showToast('Skill status updated', 'success');
        } catch (error) {
            // Toggle locally for demo
            const skill = this.state.skills.find(s => s.id === id);
            if (skill) {
                skill.enabled = !skill.enabled;
                this.renderSkills(this.state.skills);
            }
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
                title: document.getElementById('dashboardTitle').value,
                timezone: document.getElementById('timezone').value,
                dateFormat: document.getElementById('dateFormat').value
            };
            
            await apiClient.post('/api/admin/settings/general', settings);
            this.showToast('Settings saved', 'success');
        } catch (error) {
            this.showToast('Settings saved (mock)', 'success');
        }
    }
    
    async saveApiSettings() {
        try {
            const settings = {
                endpoint: document.getElementById('apiEndpoint').value,
                timeout: parseInt(document.getElementById('requestTimeout').value),
                maxRetries: parseInt(document.getElementById('maxRetries').value)
            };
            
            await apiClient.post('/api/admin/settings/api', settings);
            this.showToast('API settings saved', 'success');
        } catch (error) {
            this.showToast('API settings saved (mock)', 'success');
        }
    }
    
    async testConnection() {
        try {
            await apiClient.get('/api/health');
            this.showToast('Connection successful', 'success');
        } catch (error) {
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
            await apiClient.post('/api/admin/features', { featureId, enabled });
            this.showToast(`Feature ${enabled ? 'enabled' : 'disabled'}`, 'success');
        } catch (error) {
            // Local toggle for demo
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
