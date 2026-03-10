/**
 * Code CLI App
 * Terminal-style coding interface for KimiBuilt AI
 */

class CodeCLIApp {
    constructor() {
        this.history = [];
        this.historyIndex = -1;
        this.currentOutput = '';
        this.isProcessing = false;
        this.theme = localStorage.getItem('codecli-theme') || 'dark';
        this.commandHistory = JSON.parse(localStorage.getItem('codecli-cmd-history') || '[]');
        this.autocompleteIndex = -1;
        this.autocompleteMatches = [];
        this.lastResponse = '';
        this.sessionStartTime = Date.now();
        this.messageCount = 0;
        this.tokenCount = 0;
        this.requestCount = 0;
        this.activityLog = [];
        this.currentActivity = null;
        this.progressInterval = null;
        this.progressStartTime = null;
        
        // Available commands for autocomplete
        this.commands = [
            '/help', '/clear', '/models', '/model', '/theme', 
            '/export', '/save', '/load', '/copy', '/image',
            '/upload', '/session', '/stats', '/shortcuts'
        ];
        
        this.init();
    }
    
    init() {
        this.terminalOutput = document.getElementById('terminalOutput');
        this.commandInput = document.getElementById('commandInput');
        this.modelSelect = document.getElementById('modelSelect');
        this.statusDot = document.getElementById('statusDot');
        this.statusText = document.getElementById('statusText');
        this.sessionInfo = document.getElementById('sessionInfo');
        this.autocompleteEl = document.getElementById('autocomplete');
        this.shortcutsModal = document.getElementById('shortcutsModal');
        this.activityPanel = document.getElementById('activityPanel');
        this.activityBadge = document.getElementById('activityBadge');
        this.progressSection = document.getElementById('progressSection');
        this.progressBar = document.getElementById('progressBar');
        this.progressPercent = document.getElementById('progressPercent');
        this.progressStatus = document.getElementById('progressStatus');
        this.progressTime = document.getElementById('progressTime');
        
        this.setupEventListeners();
        this.applyTheme(this.theme);
        this.checkConnection();
        this.loadModels();
        this.printWelcome();
        this.startStatsTimer();
    }
    
    setupEventListeners() {
        // Input handling
        this.commandInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (this.autocompleteMatches.length > 0 && this.autocompleteIndex >= 0) {
                    this.selectAutocomplete();
                } else {
                    this.sendCommand();
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (this.autocompleteMatches.length > 0) {
                    this.navigateAutocomplete(-1);
                } else {
                    this.navigateHistory(-1);
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (this.autocompleteMatches.length > 0) {
                    this.navigateAutocomplete(1);
                } else {
                    this.navigateHistory(1);
                }
            } else if (e.key === 'Tab') {
                e.preventDefault();
                this.handleTabCompletion();
            } else if (e.ctrlKey && e.key === 'l') {
                e.preventDefault();
                this.clearOutput();
            } else if (e.ctrlKey && e.key === 'c') {
                e.preventDefault();
                this.copyLastOutput();
            } else if (e.key === 'Escape') {
                this.hideAutocomplete();
                this.closeShortcuts();
            } else if (e.key === 'F1') {
                e.preventDefault();
                this.showShortcuts();
            }
        });
        
        // Input for autocomplete
        this.commandInput.addEventListener('input', () => {
            this.updateAutocomplete();
        });
        
        // Focus input on click anywhere
        document.addEventListener('click', (e) => {
            if (e.target.tagName !== 'BUTTON' && 
                e.target.tagName !== 'SELECT' && 
                e.target.tagName !== 'A' &&
                !e.target.closest('.autocomplete') &&
                !e.target.closest('.modal')) {
                this.commandInput.focus();
            }
        });
        
        // Model selection
        this.modelSelect.addEventListener('change', () => {
            api.setModel(this.modelSelect.value);
            this.updateModelInfo();
            this.printSystem(`Model set to: ${this.modelSelect.value}`);
        });
        
        // File drop handling
        this.dragOverlay = document.getElementById('dragOverlay');
        
        document.addEventListener('dragenter', (e) => {
            e.preventDefault();
            if (this.dragOverlay) {
                this.dragOverlay.classList.add('active');
            }
        });
        
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
        });
        
        document.addEventListener('dragleave', (e) => {
            e.preventDefault();
            if (e.relatedTarget === null && this.dragOverlay) {
                this.dragOverlay.classList.remove('active');
            }
        });
        
        document.addEventListener('drop', (e) => {
            e.preventDefault();
            if (this.dragOverlay) {
                this.dragOverlay.classList.remove('active');
            }
            
            const files = Array.from(e.dataTransfer.files);
            files.forEach(file => this.handleFile(file));
        });
    }
    
    // ==================== Command Processing ====================
    
    async sendCommand() {
        const input = this.commandInput.value.trim();
        if (!input) return;
        
        // Add to history
        this.history.push(input);
        this.historyIndex = this.history.length;
        this.saveCommandHistory();
        
        // Print input
        this.printInput(input);
        this.commandInput.value = '';
        this.hideAutocomplete();
        
        // Process command
        if (input.startsWith('/')) {
            await this.processCommand(input);
        } else {
            await this.processQuery(input);
        }
    }
    
    async processCommand(input) {
        const parts = input.slice(1).split(' ');
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1);
        
        switch (cmd) {
            case 'help':
            case '?':
                this.printHelp();
                break;
            case 'clear':
            case 'cls':
                this.clearOutput();
                break;
            case 'models':
                await this.listModels();
                break;
            case 'model':
                if (args[0]) {
                    api.setModel(args[0]);
                    this.updateModelInfo();
                    this.printSystem(`Model set to: ${args[0]}`);
                } else {
                    this.printSystem(`Current model: ${api.currentModel || 'default'}`);
                }
                break;
            case 'theme':
                this.cycleTheme();
                break;
            case 'export':
                this.exportSession();
                break;
            case 'save':
                this.saveConversation(args[0] || 'session');
                break;
            case 'load':
                this.loadConversation(args[0] || 'session');
                break;
            case 'copy':
                this.copyLastOutput();
                break;
            case 'image':
                await this.generateImage(args.join(' '));
                break;
            case 'upload':
                this.triggerFileUpload();
                break;
            case 'session':
                this.printSessionInfo();
                break;
            case 'stats':
                this.printStats();
                break;
            case 'shortcuts':
            case 'keys':
                this.showShortcuts();
                break;
            case 'health':
                await this.checkHealth();
                break;
            default:
                this.printError(`Unknown command: /${cmd}. Type /help for available commands.`);
        }
    }
    
    async processQuery(input) {
        if (this.isProcessing) {
            this.printWarning('Already processing. Please wait...');
            return;
        }
        
        this.isProcessing = true;
        this.requestCount++;
        this.messageCount += 2; // User + AI
        
        // Update activity
        this.setActivity('processing', 'Generating response...', 'Analyzing prompt');
        this.showProgress('Processing request', true);
        
        try {
            const startTime = Date.now();
            
            const response = await api.sendMessage(input, (chunk) => {
                // Stream progress
                if (chunk.type === 'delta') {
                    this.appendToCurrentOutput(chunk.content);
                }
            });
            
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            
            // Update stats
            this.tokenCount += response.tokens || Math.ceil(input.length / 4 + (response.content?.length || 0) / 4);
            this.updateStats();
            
            // Print response
            this.printAI(response.content || 'No response');
            
            // Update activity
            this.setActivity('success', `Response received (${duration}s)`, 'Complete');
            this.hideProgress();
            
            // Add to conversation
            this.lastResponse = response.content;
            
        } catch (error) {
            this.printError(`Request failed: ${error.message}`);
            this.setActivity('error', 'Request failed', error.message);
            this.hideProgress();
        } finally {
            this.isProcessing = false;
            this.currentOutput = '';
        }
    }
    
    // ==================== Activity & Progress Widgets ====================
    
    setActivity(type, text, meta = '') {
        const icons = {
            processing: '<div class="spinner"></div>',
            success: '✓',
            error: '✗',
            waiting: '◈'
        };
        
        const activityItem = document.createElement('div');
        activityItem.className = `activity-item ${type === 'processing' ? 'active' : ''}`;
        activityItem.innerHTML = `
            <div class="activity-icon ${type}">${icons[type]}</div>
            <div class="activity-text">${text}</div>
            <div class="activity-meta">${meta}</div>
        `;
        
        this.activityPanel.innerHTML = '';
        this.activityPanel.appendChild(activityItem);
        
        this.activityBadge.textContent = type === 'processing' ? 'Working' : 
                                          type === 'success' ? 'Done' : 
                                          type === 'error' ? 'Error' : 'Idle';
        this.activityBadge.className = type === 'processing' ? 'text-info' :
                                       type === 'success' ? 'text-success' :
                                       type === 'error' ? 'text-error' : 'text-muted';
        
        // Log activity
        this.activityLog.push({
            type,
            text,
            meta,
            time: new Date().toISOString()
        });
        
        this.currentActivity = { type, text, meta };
    }
    
    showProgress(status, indeterminate = false) {
        this.progressSection.style.display = 'block';
        this.progressStatus.textContent = status;
        this.progressStartTime = Date.now();
        
        if (indeterminate) {
            this.progressBar.classList.add('indeterminate');
            this.progressBar.style.width = '30%';
        } else {
            this.progressBar.classList.remove('indeterminate');
            this.progressBar.style.width = '0%';
        }
        
        // Update time
        this.progressInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.progressStartTime) / 1000);
            const mins = Math.floor(elapsed / 60);
            const secs = elapsed % 60;
            this.progressTime.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        }, 1000);
    }
    
    updateProgress(percent, status) {
        this.progressBar.classList.remove('indeterminate');
        this.progressBar.style.width = `${percent}%`;
        this.progressPercent.textContent = `${Math.round(percent)}%`;
        if (status) {
            this.progressStatus.textContent = status;
        }
    }
    
    hideProgress() {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
        this.progressSection.style.display = 'none';
    }
    
    // ==================== Stats ====================
    
    startStatsTimer() {
        setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.sessionStartTime) / 1000);
            const mins = Math.floor(elapsed / 60);
            const secs = elapsed % 60;
            document.getElementById('statTime').textContent = 
                mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        }, 1000);
    }
    
    updateStats() {
        document.getElementById('statMessages').textContent = this.messageCount;
        document.getElementById('statTokens').textContent = this.tokenCount.toLocaleString();
        document.getElementById('statRequests').textContent = this.requestCount;
    }
    
    printStats() {
        const elapsed = Math.floor((Date.now() - this.sessionStartTime) / 1000);
        this.printSystem(`
Session Statistics:
  Messages: ${this.messageCount}
  Requests: ${this.requestCount}
  Est. Tokens: ${this.tokenCount.toLocaleString()}
  Duration: ${elapsed}s
  Model: ${api.currentModel || 'default'}
        `.trim());
    }
    
    // ==================== Output Methods ====================
    
    printInput(text) {
        const line = document.createElement('div');
        line.className = 'line line-input';
        line.innerHTML = `
            <span class="prompt">❯</span>
            <span class="input-text">${this.escapeHtml(text)}</span>
        `;
        this.terminalOutput.appendChild(line);
        this.scrollToBottom();
    }
    
    printAI(text) {
        const line = document.createElement('div');
        line.className = 'line line-output ai';
        line.innerHTML = this.renderMarkdown(text);
        this.terminalOutput.appendChild(line);
        this.scrollToBottom();
        
        // Highlight code blocks
        line.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }
    
    printSystem(text) {
        const line = document.createElement('div');
        line.className = 'line line-output system';
        line.innerHTML = `<span class="timestamp">${this.getTimestamp()}</span> ${this.escapeHtml(text)}`;
        this.terminalOutput.appendChild(line);
        this.scrollToBottom();
    }
    
    printError(text) {
        const line = document.createElement('div');
        line.className = 'line line-output error';
        line.innerHTML = `<span class="timestamp">${this.getTimestamp()}</span> ✗ ${this.escapeHtml(text)}`;
        this.terminalOutput.appendChild(line);
        this.scrollToBottom();
    }
    
    printWarning(text) {
        const line = document.createElement('div');
        line.className = 'line line-output';
        line.style.color = 'var(--warning)';
        line.innerHTML = `<span class="timestamp">${this.getTimestamp()}</span> ⚠ ${this.escapeHtml(text)}`;
        this.terminalOutput.appendChild(line);
        this.scrollToBottom();
    }
    
    printWelcome() {
        this.terminalOutput.innerHTML = '';
        this.printSystem('Welcome to KimiBuilt Code CLI v3.0');
        this.printSystem('Type /help for available commands');
        this.printSystem(`Session started: ${new Date().toLocaleString()}`);
        this.terminalOutput.appendChild(document.createElement('div')).style.height = '8px';
    }
    
    printHelp() {
        this.printAI(`
## Available Commands

**General:**
  /help, /?          Show this help message
  /clear, /cls       Clear the screen
  /theme             Toggle light/dark theme
  /shortcuts, /keys  Show keyboard shortcuts

**AI Controls:**
  /models            List available AI models
  /model <name>      Change AI model
  /image <prompt>    Generate an image
  /upload            Upload a file for context

**Session:**
  /session           Show session information
  /stats             Show session statistics
  /save <name>       Save conversation
  /load <name>       Load conversation
  /export            Export conversation to file
  /copy              Copy last response to clipboard

**System:**
  /health            Check API connection health

Type any message to chat with the AI.
        `.trim());
    }
    
    // ==================== Helper Methods ====================
    
    renderMarkdown(text) {
        // Simple markdown rendering
        let html = this.escapeHtml(text);
        
        // Code blocks
        html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
            const language = lang || 'text';
            return `
                <div class="code-block">
                    <div class="code-header">
                        <span>${language}</span>
                        <div class="code-actions">
                            <button class="code-action-btn" onclick="app.copyCode(this)">Copy</button>
                        </div>
                    </div>
                    <pre><code class="language-${language}">${code.trim()}</code></pre>
                </div>
            `;
        });
        
        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
        
        // Bold
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        
        // Italic
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        
        // Line breaks
        html = html.replace(/\n/g, '<br>');
        
        return html;
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    getTimestamp() {
        const now = new Date();
        return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    }
    
    scrollToBottom() {
        this.terminalOutput.scrollTop = this.terminalOutput.scrollHeight;
    }
    
    // ==================== API Methods ====================
    
    async checkConnection() {
        try {
            this.statusDot.className = 'status-dot connecting';
            this.statusText.textContent = 'Connecting...';
            
            const health = await api.healthCheck();
            
            if (health.connected) {
                this.statusDot.className = 'status-dot online';
                this.statusText.textContent = 'Connected';
            } else {
                this.statusDot.className = 'status-dot offline';
                this.statusText.textContent = 'Disconnected';
            }
        } catch (error) {
            this.statusDot.className = 'status-dot offline';
            this.statusText.textContent = 'Offline';
        }
    }
    
    async checkHealth() {
        this.setActivity('processing', 'Checking health...', 'Connecting');
        try {
            const health = await api.healthCheck();
            this.printSystem(`Health Check:
  Status: ${health.connected ? '✓ Connected' : '✗ Disconnected'}
  Version: ${health.version || 'unknown'}
  Models: ${health.models || 'unknown'}
            `.trim());
            this.setActivity('success', 'Health check complete', 'Connected');
        } catch (error) {
            this.printError(`Health check failed: ${error.message}`);
            this.setActivity('error', 'Health check failed', error.message);
        }
    }
    
    async loadModels() {
        try {
            const models = await api.getModels();
            this.modelSelect.innerHTML = models.map(m => 
                `<option value="${m.id}" ${m.id === api.currentModel ? 'selected' : ''}>${m.id}</option>`
            ).join('');
            this.updateModelInfo();
        } catch (error) {
            this.modelSelect.innerHTML = '<option>gpt-4o</option>';
        }
    }
    
    async listModels() {
        try {
            const models = await api.getModels();
            this.printAI(`## Available Models\n\n${models.map(m => `  • ${m.id}`).join('\n')}`);
        } catch (error) {
            this.printError('Failed to load models');
        }
    }
    
    updateModelInfo() {
        const model = api.currentModel || 'gpt-4o';
        document.getElementById('currentModelName').textContent = model;
        document.getElementById('modelProvider').textContent = 'OpenAI';
        
        // Estimate context window
        const contextSizes = {
            'gpt-4o': '128K',
            'gpt-4': '8K',
            'gpt-4-turbo': '128K',
            'gpt-3.5-turbo': '16K'
        };
        document.getElementById('modelContext').textContent = 
            (contextSizes[model] || '8K') + ' ctx';
    }
    
    // ==================== File Handling ====================
    
    triggerFileUpload() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt,.md,.json,.js,.ts,.py,.html,.css,.sql,.docx,.pdf';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) this.handleFile(file);
        };
        input.click();
    }
    
    async handleFile(file) {
        this.setActivity('processing', `Processing ${file.name}...`, 'Reading file');
        
        try {
            const content = await api.uploadFile(file);
            this.printSystem(`File uploaded: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
            this.printAI(`File content from "${file.name}":\n\n\`\`\`\n${content.substring(0, 2000)}${content.length > 2000 ? '\n... (truncated)' : ''}\n\`\`\``);
            this.setActivity('success', `File processed: ${file.name}`, 'Complete');
        } catch (error) {
            this.printError(`Failed to process file: ${error.message}`);
            this.setActivity('error', 'File processing failed', error.message);
        }
    }
    
    // ==================== Image Generation ====================
    
    async generateImage(prompt) {
        if (!prompt) {
            this.printError('Please provide a prompt. Usage: /image <prompt>');
            return;
        }
        
        this.isProcessing = true;
        this.setActivity('processing', 'Generating image...', 'AI working');
        this.showProgress('Generating image', true);
        
        try {
            const response = await api.generateImage(prompt);
            this.printAI(`![Generated Image](${response.url})\n\n**Prompt:** ${prompt}`);
            this.setActivity('success', 'Image generated', 'Complete');
        } catch (error) {
            this.printError(`Image generation failed: ${error.message}`);
            this.setActivity('error', 'Image generation failed', error.message);
        } finally {
            this.isProcessing = false;
            this.hideProgress();
        }
    }
    
    // ==================== Session Management ====================
    
    printSessionInfo() {
        const elapsed = Math.floor((Date.now() - this.sessionStartTime) / 1000);
        this.printSystem(`
Session Information:
  ID: ${api.sessionId || 'none'}
  Model: ${api.currentModel || 'default'}
  Messages: ${this.messageCount}
  Duration: ${elapsed}s
  Start Time: ${new Date(this.sessionStartTime).toLocaleString()}
        `.trim());
    }
    
    saveConversation(name) {
        const data = {
            history: this.history,
            timestamp: Date.now(),
            model: api.currentModel
        };
        localStorage.setItem(`codecli_conv_${name}`, JSON.stringify(data));
        this.printSystem(`Conversation saved as "${name}"`);
    }
    
    loadConversation(name) {
        const data = localStorage.getItem(`codecli_conv_${name}`);
        if (data) {
            const parsed = JSON.parse(data);
            this.history = parsed.history || [];
            this.printSystem(`Conversation "${name}" loaded (${this.history.length} messages)`);
        } else {
            this.printError(`Conversation "${name}" not found`);
        }
    }
    
    exportSession() {
        const data = {
            history: this.history,
            timestamp: Date.now(),
            model: api.currentModel
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `codecli-session-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.printSystem('Session exported');
    }
    
    // ==================== UI Methods ====================
    
    clearOutput() {
        this.terminalOutput.innerHTML = '';
        this.printWelcome();
    }
    
    cycleTheme() {
        const themes = ['dark', 'light'];
        const currentIndex = themes.indexOf(this.theme);
        this.theme = themes[(currentIndex + 1) % themes.length];
        this.applyTheme(this.theme);
        localStorage.setItem('codecli-theme', this.theme);
        this.printSystem(`Theme: ${this.theme}`);
    }
    
    applyTheme(theme) {
        document.body.setAttribute('data-theme', theme);
    }
    
    copyLastOutput() {
        if (this.lastResponse) {
            navigator.clipboard.writeText(this.lastResponse);
            this.printSystem('Last response copied to clipboard');
        } else {
            this.printWarning('No response to copy');
        }
    }
    
    copyCode(btn) {
        const code = btn.closest('.code-block').querySelector('code').textContent;
        navigator.clipboard.writeText(code);
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy', 2000);
    }
    
    showShortcuts() {
        document.getElementById('shortcutsContent').innerHTML = `
            <div class="grid gap-2 text-sm">
                <div class="flex justify-between py-1 border-b" style="border-color: var(--border-color);">
                    <span>Send message</span>
                    <code class="inline-code">Enter</code>
                </div>
                <div class="flex justify-between py-1 border-b" style="border-color: var(--border-color);">
                    <span>Command history</span>
                    <code class="inline-code">↑ / ↓</code>
                </div>
                <div class="flex justify-between py-1 border-b" style="border-color: var(--border-color);">
                    <span>Autocomplete</span>
                    <code class="inline-code">Tab</code>
                </div>
                <div class="flex justify-between py-1 border-b" style="border-color: var(--border-color);">
                    <span>Clear screen</span>
                    <code class="inline-code">Ctrl + L</code>
                </div>
                <div class="flex justify-between py-1 border-b" style="border-color: var(--border-color);">
                    <span>Copy last response</span>
                    <code class="inline-code">Ctrl + C</code>
                </div>
                <div class="flex justify-between py-1 border-b" style="border-color: var(--border-color);">
                    <span>Show help</span>
                    <code class="inline-code">F1</code>
                </div>
                <div class="flex justify-between py-1">
                    <span>Close/cancel</span>
                    <code class="inline-code">Esc</code>
                </div>
            </div>
        `;
        this.shortcutsModal.classList.add('active');
    }
    
    closeShortcuts() {
        this.shortcutsModal.classList.remove('active');
    }
    
    // ==================== Autocomplete ====================
    
    updateAutocomplete() {
        const input = this.commandInput.value;
        if (!input.startsWith('/')) {
            this.hideAutocomplete();
            return;
        }
        
        const matches = this.commands.filter(cmd => cmd.startsWith(input.toLowerCase()));
        if (matches.length === 0 || (matches.length === 1 && matches[0] === input)) {
            this.hideAutocomplete();
            return;
        }
        
        this.autocompleteMatches = matches;
        this.autocompleteIndex = -1;
        
        this.autocompleteEl.innerHTML = matches.map((match, i) => `
            <div class="autocomplete-item ${i === 0 ? 'selected' : ''}" data-index="${i}">${match}</div>
        `).join('');
        
        this.autocompleteEl.classList.remove('hidden');
        
        // Click handlers
        this.autocompleteEl.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('click', () => {
                this.commandInput.value = item.textContent + ' ';
                this.commandInput.focus();
                this.hideAutocomplete();
            });
        });
    }
    
    navigateAutocomplete(direction) {
        if (this.autocompleteMatches.length === 0) return;
        
        this.autocompleteIndex += direction;
        if (this.autocompleteIndex < 0) {
            this.autocompleteIndex = this.autocompleteMatches.length - 1;
        } else if (this.autocompleteIndex >= this.autocompleteMatches.length) {
            this.autocompleteIndex = 0;
        }
        
        this.autocompleteEl.querySelectorAll('.autocomplete-item').forEach((item, i) => {
            item.classList.toggle('selected', i === this.autocompleteIndex);
        });
    }
    
    selectAutocomplete() {
        if (this.autocompleteIndex >= 0) {
            this.commandInput.value = this.autocompleteMatches[this.autocompleteIndex] + ' ';
            this.commandInput.focus();
            this.hideAutocomplete();
        }
    }
    
    hideAutocomplete() {
        this.autocompleteEl.classList.add('hidden');
        this.autocompleteMatches = [];
        this.autocompleteIndex = -1;
    }
    
    handleTabCompletion() {
        const input = this.commandInput.value;
        if (input.startsWith('/')) {
            const matches = this.commands.filter(cmd => cmd.startsWith(input.toLowerCase()));
            if (matches.length === 1) {
                this.commandInput.value = matches[0] + ' ';
            } else if (matches.length > 0) {
                this.printSystem('Commands: ' + matches.join(', '));
            }
        }
    }
    
    // ==================== History ====================
    
    navigateHistory(direction) {
        if (this.history.length === 0) return;
        
        this.historyIndex += direction;
        if (this.historyIndex < 0) {
            this.historyIndex = 0;
        } else if (this.historyIndex >= this.history.length) {
            this.historyIndex = this.history.length;
            this.commandInput.value = '';
            return;
        }
        
        this.commandInput.value = this.history[this.historyIndex];
    }
    
    saveCommandHistory() {
        localStorage.setItem('codecli-cmd-history', JSON.stringify(this.history.slice(-100)));
    }
    
    // ==================== Streaming Helpers ====================
    
    appendToCurrentOutput(text) {
        // For streaming responses - update the last AI output line
        const lines = this.terminalOutput.querySelectorAll('.line-output.ai');
        const lastLine = lines[lines.length - 1];
        if (lastLine && lastLine.classList.contains('streaming')) {
            lastLine.innerHTML = this.renderMarkdown(this.currentOutput + text);
            this.currentOutput += text;
            hljs.highlightAll();
        } else {
            this.currentOutput = text;
            const line = document.createElement('div');
            line.className = 'line line-output ai streaming';
            line.innerHTML = this.renderMarkdown(text);
            this.terminalOutput.appendChild(line);
        }
        this.scrollToBottom();
    }
}

const app = new CodeCLIApp();
