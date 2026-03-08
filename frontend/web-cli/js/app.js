/**
 * Web CLI App
 * Terminal-style interface for KimiBuilt AI
 */

class WebCLIApp {
    constructor() {
        this.mode = 'chat';
        this.history = [];
        this.historyIndex = -1;
        this.currentOutput = '';
        this.isProcessing = false;
        this.conversationHistory = [];
        this.theme = localStorage.getItem('webcli-theme') || 'dark';
        this.commandHistory = JSON.parse(localStorage.getItem('webcli-cmd-history') || '[]');
        this.autocompleteIndex = -1;
        this.autocompleteMatches = [];
        this.lastResponse = '';
        this.conversations = JSON.parse(localStorage.getItem('webcli-conversations') || '{}');
        this.canvasContent = '';
        this.connectionCheckInterval = null;
        this.searchMode = false;
        this.searchQuery = '';
        this.searchResults = [];
        this.searchIndex = -1;
        
        // Available commands for autocomplete
        this.commands = [
            '/help', '/mode', '/model', '/models', '/clear', '/session', '/new',
            '/health', '/copy', '/save', '/load', '/image', '/edit', '/upload',
            '/shortcuts', '/theme', '/export', '/search', '/history'
        ];
        
        this.init();
    }

    init() {
        this.outputArea = document.getElementById('outputArea');
        this.commandInput = document.getElementById('commandInput');
        this.modeBadge = document.getElementById('modeBadge');
        this.modelSelect = document.getElementById('modelSelect');
        this.connectionStatus = document.getElementById('connectionStatus');
        this.sessionInfo = document.getElementById('sessionInfo');
        this.promptSymbol = document.getElementById('promptSymbol');
        this.autocompleteEl = document.getElementById('autocomplete');
        this.loadingIndicator = document.getElementById('loadingIndicator');
        this.shortcutsModal = document.getElementById('shortcutsModal');
        this.canvasPanel = document.getElementById('canvasPanel');

        this.setupEventListeners();
        this.applyTheme(this.theme);
        this.startConnectionMonitoring();
        this.checkConnection();
        this.loadModels();
        this.printWelcome();
    }

    setupEventListeners() {
        // Input handling
        this.commandInput.addEventListener('keydown', (e) => {
            if (this.searchMode) {
                this.handleSearchInput(e);
                return;
            }

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
            } else if (e.ctrlKey && e.key === 'r') {
                e.preventDefault();
                this.startHistorySearch();
            } else if (e.key === 'Escape') {
                this.hideAutocomplete();
                this.closeShortcuts();
                if (this.searchMode) {
                    this.exitSearchMode();
                }
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
            this.printSystem(`Model set to: ${this.modelSelect.value}`);
        });

        // File drop handling
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
            document.body.classList.add('drag-over');
        });

        document.addEventListener('dragleave', () => {
            document.body.classList.remove('drag-over');
        });

        document.addEventListener('drop', (e) => {
            e.preventDefault();
            document.body.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFileUpload(files[0]);
            }
        });
    }

    // ==================== Connection Monitoring ====================

    startConnectionMonitoring() {
        this.connectionCheckInterval = setInterval(() => {
            this.checkConnection();
        }, 30000); // Check every 30 seconds
    }

    async checkConnection() {
        const health = await api.checkHealth();
        
        if (health.connected) {
            this.connectionStatus.innerHTML = '<span class="status-connected" title="Connected">● Connected</span>';
            this.connectionStatus.classList.remove('status-error', 'status-disconnected');
        } else {
            this.connectionStatus.innerHTML = `<span class="status-error" title="${health.error}">● Disconnected</span>`;
            this.connectionStatus.classList.add('status-error');
            
            if (health.suggestions && health.suggestions.length > 0) {
                this.printError(`Connection failed: ${health.error}`);
                this.printSystem('Suggestions:\n' + health.suggestions.map(s => `  • ${s}`).join('\n'));
            }
        }
    }

    // ==================== Theme Support ====================

    applyTheme(themeName) {
        this.theme = themeName;
        document.body.setAttribute('data-theme', themeName);
        localStorage.setItem('webcli-theme', themeName);
        
        const themeBtn = document.getElementById('themeBtn');
        if (themeBtn) {
            themeBtn.textContent = themeName === 'dark' ? '🌙' : themeName === 'light' ? '☀️' : '⚡';
        }
    }

    cycleTheme() {
        const themes = ['dark', 'light', 'high-contrast'];
        const currentIndex = themes.indexOf(this.theme);
        const nextTheme = themes[(currentIndex + 1) % themes.length];
        this.applyTheme(nextTheme);
        this.printSystem(`Theme switched to: ${nextTheme}`);
    }

    // ==================== Autocomplete ====================

    updateAutocomplete() {
        const input = this.commandInput.value;
        
        if (!input.startsWith('/')) {
            this.hideAutocomplete();
            return;
        }

        this.autocompleteMatches = this.commands.filter(cmd => 
            cmd.startsWith(input.toLowerCase()) && cmd !== input.toLowerCase()
        );
        
        this.autocompleteIndex = -1;

        if (this.autocompleteMatches.length > 0) {
            this.showAutocomplete();
        } else {
            this.hideAutocomplete();
        }
    }

    showAutocomplete() {
        this.autocompleteEl.innerHTML = this.autocompleteMatches.map((match, index) => 
            `<div class="autocomplete-item ${index === this.autocompleteIndex ? 'selected' : ''}" data-index="${index}">${match}</div>`
        ).join('');
        this.autocompleteEl.classList.remove('hidden');
    }

    hideAutocomplete() {
        this.autocompleteEl.classList.add('hidden');
        this.autocompleteMatches = [];
        this.autocompleteIndex = -1;
    }

    navigateAutocomplete(direction) {
        this.autocompleteIndex += direction;
        
        if (this.autocompleteIndex < 0) {
            this.autocompleteIndex = this.autocompleteMatches.length - 1;
        } else if (this.autocompleteIndex >= this.autocompleteMatches.length) {
            this.autocompleteIndex = 0;
        }
        
        this.showAutocomplete();
    }

    selectAutocomplete() {
        if (this.autocompleteIndex >= 0 && this.autocompleteMatches[this.autocompleteIndex]) {
            this.commandInput.value = this.autocompleteMatches[this.autocompleteIndex];
            this.hideAutocomplete();
        }
    }

    handleTabCompletion() {
        const input = this.commandInput.value;
        
        if (this.autocompleteMatches.length > 0) {
            this.selectAutocomplete();
        } else if (input.startsWith('/')) {
            // Complete partial command
            const partial = input.toLowerCase();
            const matches = this.commands.filter(cmd => cmd.startsWith(partial));
            if (matches.length === 1) {
                this.commandInput.value = matches[0] + ' ';
            } else if (matches.length > 1) {
                this.printSystem('Possible completions: ' + matches.join(', '));
            }
        }
    }

    // ==================== History Search (Ctrl+R) ====================

    startHistorySearch() {
        this.searchMode = true;
        this.searchQuery = '';
        this.searchResults = [];
        this.searchIndex = -1;
        this.printSystem('Reverse history search: Type to search, Enter to select, Ctrl+C to cancel');
        this.commandInput.placeholder = '(reverse-i-search)';
        this.commandInput.value = '';
        this.commandInput.focus();
    }

    exitSearchMode() {
        this.searchMode = false;
        this.searchQuery = '';
        this.commandInput.placeholder = 'Type a message or /help for commands...';
        this.commandInput.value = '';
    }

    handleSearchInput(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (this.searchIndex >= 0 && this.searchResults[this.searchIndex]) {
                this.commandInput.value = this.searchResults[this.searchIndex];
                this.exitSearchMode();
            }
        } else if (e.ctrlKey && e.key === 'c') {
            e.preventDefault();
            this.exitSearchMode();
        } else if (e.key === 'Backspace') {
            this.searchQuery = this.searchQuery.slice(0, -1);
            this.performSearch();
        } else if (e.key.length === 1) {
            this.searchQuery += e.key;
            this.performSearch();
        }
        
        if (this.searchQuery) {
            this.commandInput.value = `(reverse-i-search) \`${this.searchQuery}\': ${this.searchResults[this.searchIndex] || ''}`;
        }
    }

    performSearch() {
        this.searchResults = this.commandHistory.filter(cmd => 
            cmd.toLowerCase().includes(this.searchQuery.toLowerCase())
        ).reverse();
        this.searchIndex = 0;
    }

    // ==================== Commands ====================

    async sendCommand() {
        const input = this.commandInput.value.trim();
        if (!input || this.isProcessing) return;

        this.commandInput.value = '';
        this.hideAutocomplete();
        
        // Add to history
        this.history.push(input);
        this.historyIndex = this.history.length;
        
        // Add to persistent command history
        if (!this.commandHistory.includes(input)) {
            this.commandHistory.push(input);
            if (this.commandHistory.length > 100) {
                this.commandHistory.shift();
            }
            localStorage.setItem('webcli-cmd-history', JSON.stringify(this.commandHistory));
        }

        // Print user input
        this.printInput(input);

        // Handle commands
        if (input.startsWith('/')) {
            await this.handleCommand(input);
        } else {
            await this.processInput(input);
        }
    }

    async handleCommand(input) {
        // Parse command with quoted arguments support
        const parsed = this.parseCommand(input.slice(1));
        const cmd = parsed.command.toLowerCase();
        const args = parsed.args;
        const flags = parsed.flags;

        switch (cmd) {
            case 'help':
                this.printHelp();
                break;
            case 'mode':
                if (args[0]) this.setMode(args[0]);
                else this.printSystem('Current mode: ' + this.mode);
                break;
            case 'model':
                if (args[0]) {
                    api.setModel(args[0]);
                    this.printSystem(`Model set to: ${args[0]}`);
                } else {
                    this.printSystem(`Current model: ${api.currentModel}`);
                }
                break;
            case 'clear':
                this.clearOutput();
                break;
            case 'session':
                this.printSystem(`Session ID: ${api.sessionId || 'none'}`);
                break;
            case 'new':
                api.clearSession();
                this.conversationHistory = [];
                this.printSystem('New session started');
                break;
            case 'models':
                await this.loadModels();
                this.printSystem('Available models:\n' + api.models.map(m => `  • ${m.id} - ${m.description || m.name}`).join('\n'));
                break;
            case 'health':
                await this.checkConnection();
                break;
            case 'copy':
                this.copyLastOutput();
                break;
            case 'save':
                if (args[0]) {
                    this.saveConversation(args[0]);
                } else {
                    this.printError('Usage: /save <filename>');
                }
                break;
            case 'load':
                if (args[0]) {
                    this.loadConversation(args[0]);
                } else {
                    this.printError('Usage: /load <filename>');
                }
                break;
            case 'image':
                if (args.length > 0) {
                    await this.generateImage(args.join(' '));
                } else {
                    this.printError('Usage: /image <prompt>');
                }
                break;
            case 'upload':
                this.triggerFileUpload();
                break;
            case 'edit':
                if (args[0]) {
                    this.openEditor(args[0]);
                } else {
                    this.printSystem('Usage: /edit <filename> - Opens file in editor mode');
                }
                break;
            case 'shortcuts':
            case 'keys':
                this.showShortcuts();
                break;
            case 'theme':
                if (args[0]) {
                    if (['dark', 'light', 'high-contrast'].includes(args[0])) {
                        this.applyTheme(args[0]);
                        this.printSystem(`Theme set to: ${args[0]}`);
                    } else {
                        this.printError('Valid themes: dark, light, high-contrast');
                    }
                } else {
                    this.cycleTheme();
                }
                break;
            case 'export':
                this.exportSession();
                break;
            case 'history':
                this.showCommandHistory();
                break;
            case 'search':
                if (args[0]) {
                    this.searchInConversation(args.join(' '));
                } else {
                    this.printError('Usage: /search <query>');
                }
                break;
            default:
                this.printError(`Unknown command: /${cmd}. Type /help for available commands.`);
        }
    }

    parseCommand(input) {
        const args = [];
        const flags = {};
        let current = '';
        let inQuotes = false;
        let quoteChar = '';

        for (let i = 0; i < input.length; i++) {
            const char = input[i];

            if ((char === '"' || char === "'") && !inQuotes) {
                inQuotes = true;
                quoteChar = char;
            } else if (char === quoteChar && inQuotes) {
                inQuotes = false;
                quoteChar = '';
            } else if (char === ' ' && !inQuotes) {
                if (current.startsWith('--')) {
                    const [key, ...valParts] = current.slice(2).split('=');
                    flags[key] = valParts.join('=') || true;
                } else if (current.startsWith('-')) {
                    flags[current.slice(1)] = true;
                } else if (current) {
                    args.push(current);
                }
                current = '';
            } else {
                current += char;
            }
        }

        if (current) {
            if (current.startsWith('--')) {
                const [key, ...valParts] = current.slice(2).split('=');
                flags[key] = valParts.join('=') || true;
            } else if (current.startsWith('-')) {
                flags[current.slice(1)] = true;
            } else {
                args.push(current);
            }
        }

        return {
            command: args.shift() || '',
            args,
            flags
        };
    }

    // ==================== New Commands ====================

    async copyLastOutput() {
        if (this.lastResponse) {
            try {
                await navigator.clipboard.writeText(this.lastResponse);
                this.printSystem('✓ Copied last response to clipboard');
            } catch (err) {
                this.printError('Failed to copy: ' + err.message);
            }
        } else {
            this.printSystem('No response to copy');
        }
    }

    saveConversation(filename) {
        const conversation = {
            timestamp: new Date().toISOString(),
            sessionId: api.sessionId,
            mode: this.mode,
            history: this.history,
            conversationHistory: this.conversationHistory
        };
        
        this.conversations[filename] = conversation;
        localStorage.setItem('webcli-conversations', JSON.stringify(this.conversations));
        this.printSystem(`✓ Conversation saved as "${filename}"`);
    }

    loadConversation(filename) {
        const conversation = this.conversations[filename];
        if (conversation) {
            this.history = conversation.history || [];
            this.conversationHistory = conversation.conversationHistory || [];
            this.historyIndex = this.history.length;
            if (conversation.mode) {
                this.setMode(conversation.mode);
            }
            this.printSystem(`✓ Conversation "${filename}" loaded (${conversation.history?.length || 0} messages)`);
        } else {
            this.printError(`Conversation "${filename}" not found`);
            const saved = Object.keys(this.conversations);
            if (saved.length > 0) {
                this.printSystem('Saved conversations: ' + saved.join(', '));
            }
        }
    }

    async generateImage(prompt) {
        this.showLoading('Generating image...');
        
        try {
            const result = await api.generateImage(prompt);
            
            if (result.url || result.data?.[0]?.url) {
                const imageUrl = result.url || result.data[0].url;
                this.printImage(imageUrl, prompt);
                this.printSystem('✓ Image generated successfully');
            } else {
                this.printError('Image generation returned no URL');
            }
        } catch (error) {
            this.printError('Image generation failed: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    printImage(url, alt) {
        const div = document.createElement('div');
        div.className = 'image-output';
        div.innerHTML = `
            <div class="timestamp">${this.getTimestamp()}</div>
            <img src="${this.escapeHtml(url)}" alt="${this.escapeHtml(alt)}" 
                 style="max-width: 100%; max-height: 400px; border-radius: 8px; margin: 8px 0;"
                 onerror="this.parentElement.innerHTML='<div class=\\'error\\'>Failed to load image</div>'">
            <div class="text-sm text-gray-500">${this.escapeHtml(alt)}</div>
        `;
        this.outputArea.appendChild(div);
        this.scrollToBottom();
    }

    triggerFileUpload() {
        const input = document.createElement('input');
        input.type = 'file';
        input.onchange = (e) => {
            if (e.target.files.length > 0) {
                this.handleFileUpload(e.target.files[0]);
            }
        };
        input.click();
    }

    async handleFileUpload(file) {
        this.showLoading(`Uploading ${file.name}...`);
        
        try {
            const result = await api.uploadFile(file);
            this.printSystem(`✓ File uploaded: ${file.name} (${this.formatBytes(file.size)})`);
            this.printSystem(`File ID: ${result.id || result.file_id || 'N/A'}`);
        } catch (error) {
            this.printError('Upload failed: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    openEditor(filename) {
        // For now, just print info. Could integrate with a code editor component
        this.printSystem(`Editor mode for: ${filename}`);
        this.printSystem('(Editor integration would open here)');
    }

    showShortcuts() {
        this.shortcutsModal.classList.remove('hidden');
    }

    closeShortcuts() {
        this.shortcutsModal.classList.add('hidden');
    }

    showCommandHistory() {
        if (this.commandHistory.length === 0) {
            this.printSystem('No command history');
            return;
        }
        
        const history = this.commandHistory.slice(-20).map((cmd, i) => 
            `  ${(i + 1).toString().padStart(3)}  ${cmd}`
        ).join('\n');
        
        this.printSystem(`Command History (last 20 of ${this.commandHistory.length}):\n${history}`);
    }

    searchInConversation(query) {
        const matches = this.history.filter(msg => 
            msg.toLowerCase().includes(query.toLowerCase())
        );
        
        if (matches.length === 0) {
            this.printSystem(`No matches found for "${query}"`);
        } else {
            this.printSystem(`Found ${matches.length} match(es) for "${query}":`);
            matches.forEach((match, i) => {
                this.printSystem(`  ${i + 1}. ${match.substring(0, 100)}${match.length > 100 ? '...' : ''}`);
            });
        }
    }

    // ==================== UI Helpers ====================

    showLoading(message) {
        this.loadingIndicator.querySelector('.loading-text').textContent = message;
        this.loadingIndicator.classList.remove('hidden');
        this.isProcessing = true;
    }

    hideLoading() {
        this.loadingIndicator.classList.add('hidden');
        this.isProcessing = false;
    }

    // ==================== Core Processing ====================

    async processInput(input) {
        this.isProcessing = true;
        this.currentOutput = '';

        const responseEl = document.createElement('div');
        responseEl.className = 'ai-response mb-4 streaming-cursor';
        responseEl.innerHTML = `<span class="timestamp">${this.getTimestamp()}</span><br>`;
        this.outputArea.appendChild(responseEl);

        try {
            if (this.mode === 'chat') {
                for await (const chunk of api.streamChat(input, api.currentModel, this.mode, this.conversationHistory)) {
                    if (chunk.type === 'delta') {
                        this.currentOutput += chunk.content;
                        responseEl.innerHTML = `<span class="timestamp">${this.getTimestamp()}</span><br>${this.renderMarkdown(this.currentOutput)}`;
                        this.scrollToBottom();
                    } else if (chunk.type === 'error') {
                        responseEl.classList.remove('streaming-cursor');
                        this.printError(chunk.error);
                        if (chunk.suggestions) {
                            this.printSystem('Suggestions:\n' + chunk.suggestions.map(s => `  • ${s}`).join('\n'));
                        }
                    } else if (chunk.type === 'done') {
                        responseEl.classList.remove('streaming-cursor');
                        this.lastResponse = this.currentOutput;
                        this.conversationHistory.push(
                            { role: 'user', content: input },
                            { role: 'assistant', content: this.currentOutput }
                        );
                        this.updateSessionInfo();
                    }
                }
            } else if (this.mode === 'canvas') {
                this.showLoading('Processing canvas request...');
                const response = await api.sendCanvasRequest(input, 'document', this.canvasContent);
                this.hideLoading();
                
                this.currentOutput = response.content || 'No content generated';
                this.canvasContent = this.currentOutput;
                this.lastResponse = this.currentOutput;
                
                // Update split view
                const canvasPreview = document.getElementById('canvasPreview');
                if (canvasPreview) {
                    canvasPreview.innerHTML = this.renderMarkdown(this.currentOutput);
                }
                
                responseEl.innerHTML = `<span class="timestamp">${this.getTimestamp()}</span><br>${this.renderMarkdown(this.currentOutput)}`;
                responseEl.classList.remove('streaming-cursor');
                
                if (response.suggestions?.length > 0) {
                    this.printSystem(`Suggestions: ${response.suggestions.join(', ')}`);
                }
            } else if (this.mode === 'notation') {
                this.showLoading('Processing notation...');
                const response = await api.sendNotationRequest(input, 'expand');
                this.hideLoading();
                
                this.currentOutput = response.result || 'No result generated';
                this.lastResponse = this.currentOutput;
                responseEl.innerHTML = `<span class="timestamp">${this.getTimestamp()}</span><br>${this.renderMarkdown(this.currentOutput)}`;
                responseEl.classList.remove('streaming-cursor');
            }
        } catch (error) {
            this.hideLoading();
            responseEl.classList.remove('streaming-cursor');
            this.printError(error.message);
        }

        this.isProcessing = false;
        this.scrollToBottom();
    }

    // ==================== Markdown Rendering ====================

    renderMarkdown(text) {
        if (!text) return '';
        
        let html = this.escapeHtml(text);
        
        // Code blocks with syntax highlighting
        html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
            const language = lang || 'text';
            const highlighted = this.highlightCode(code.trim(), language);
            return `<div class="code-block"><div class="code-header">${language}</div><pre><code>${highlighted}</code></pre></div>`;
        });
        
        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
        
        // Bold
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        
        // Italic
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        
        // Headers
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        
        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
        
        // Lists
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
        
        // Line breaks
        html = html.replace(/\n/g, '<br>');
        
        return html;
    }

    highlightCode(code, language) {
        // Simple syntax highlighting
        let highlighted = this.escapeHtml(code);
        
        // Keywords
        const keywords = ['function', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'return', 'class', 'import', 'export', 'from', 'async', 'await', 'try', 'catch'];
        keywords.forEach(kw => {
            highlighted = highlighted.replace(
                new RegExp(`\\b${kw}\\b`, 'g'), 
                `<span class="keyword">${kw}</span>`
            );
        });
        
        // Strings
        highlighted = highlighted.replace(
            /("[^"]*"|'[^']*')/g, 
            '<span class="string">$1</span>'
        );
        
        // Comments
        highlighted = highlighted.replace(
            /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm, 
            '<span class="comment">$1</span>'
        );
        
        // Numbers
        highlighted = highlighted.replace(
            /\b(\d+)\b/g, 
            '<span class="number">$1</span>'
        );
        
        return highlighted;
    }

    // ==================== Mode Management ====================

    setMode(mode) {
        if (!['chat', 'canvas', 'notation'].includes(mode)) {
            this.printError(`Invalid mode: ${mode}. Use: chat, canvas, or notation`);
            return;
        }
        
        this.mode = mode;
        this.modeBadge.textContent = mode;
        
        // Update tabs
        ['chat', 'canvas', 'notation'].forEach(m => {
            const tab = document.getElementById(`tab-${m}`);
            if (m === mode) {
                tab.classList.remove('border-transparent');
                tab.classList.add('border-blue-500');
            } else {
                tab.classList.add('border-transparent');
                tab.classList.remove('border-blue-500');
            }
        });

        // Show/hide canvas panel
        if (mode === 'canvas') {
            this.canvasPanel.classList.remove('hidden');
            this.outputArea.style.height = 'calc(100vh - 380px)';
        } else {
            this.canvasPanel.classList.add('hidden');
            this.outputArea.style.height = 'calc(100vh - 180px)';
        }

        this.printSystem(`Mode switched to: ${mode}`);
    }

    // ==================== Output Methods ====================

    printWelcome() {
        const welcome = document.createElement('div');
        welcome.className = 'system mb-4';
        welcome.innerHTML = `
            <div class="timestamp">${this.getTimestamp()}</div>
            <div class="text-green-400 font-bold">Welcome to KimiBuilt Web CLI v2.0</div>
            <div class="mt-2 text-gray-400">
                Commands:<br>
                <span class="prompt">/help</span> - Show all commands<br>
                <span class="prompt">/mode &lt;chat|canvas|notation&gt;</span> - Switch mode<br>
                <span class="prompt">/model &lt;name&gt;</span> - Change AI model<br>
                <span class="prompt">/clear</span> - Clear screen<br>
                <span class="prompt">/theme</span> - Toggle theme<br>
                <span class="prompt">/shortcuts</span> - Keyboard shortcuts (F1)
            </div>
        `;
        this.outputArea.appendChild(welcome);
        this.scrollToBottom();
    }

    printHelp() {
        const help = document.createElement('div');
        help.className = 'system';
        help.innerHTML = `
            <div class="font-bold text-blue-400 mb-2">Available Commands:</div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-1 text-sm">
                <div><span class="prompt">/help</span> - Show this help</div>
                <div><span class="prompt">/mode &lt;chat|canvas|notation&gt;</span> - Switch mode</div>
                <div><span class="prompt">/model &lt;name&gt;</span> - Change AI model</div>
                <div><span class="prompt">/models</span> - List available models</div>
                <div><span class="prompt">/clear</span> - Clear screen</div>
                <div><span class="prompt">/session</span> - Show session info</div>
                <div><span class="prompt">/new</span> - Start new session</div>
                <div><span class="prompt">/health</span> - Check connection</div>
                <div><span class="prompt">/copy</span> - Copy last response</div>
                <div><span class="prompt">/save &lt;filename&gt;</span> - Save conversation</div>
                <div><span class="prompt">/load &lt;filename&gt;</span> - Load conversation</div>
                <div><span class="prompt">/image &lt;prompt&gt;</span> - Generate image</div>
                <div><span class="prompt">/upload</span> - Upload file</div>
                <div><span class="prompt">/edit &lt;filename&gt;</span> - Open editor</div>
                <div><span class="prompt">/theme [dark|light|high-contrast]</span> - Change theme</div>
                <div><span class="prompt">/export</span> - Export session</div>
                <div><span class="prompt">/history</span> - Show command history</div>
                <div><span class="prompt">/search &lt;query&gt;</span> - Search in conversation</div>
            </div>
            <div class="mt-3 text-gray-500">
                <div class="font-bold">Keyboard Shortcuts:</div>
                <div>Ctrl+L = Clear | Ctrl+C = Copy | ↑↓ = History | Tab = Autocomplete</div>
                <div>Ctrl+R = Search history | F1 = Shortcuts help</div>
            </div>
        `;
        this.outputArea.appendChild(help);
        this.scrollToBottom();
    }

    printInput(text) {
        const div = document.createElement('div');
        div.className = 'command-line user-input';
        div.innerHTML = `<span class="prompt">❯</span> <span>${this.renderMarkdown(text)}</span>`;
        this.outputArea.appendChild(div);
        this.scrollToBottom();
    }

    printSystem(text) {
        const div = document.createElement('div');
        div.className = 'system';
        div.innerHTML = `<span class="timestamp">${this.getTimestamp()}</span> ${this.renderMarkdown(text)}`;
        this.outputArea.appendChild(div);
        this.scrollToBottom();
    }

    printError(text) {
        const div = document.createElement('div');
        div.className = 'error';
        div.innerHTML = `<span class="timestamp">${this.getTimestamp()}</span> Error: ${this.escapeHtml(text)}`;
        this.outputArea.appendChild(div);
        this.scrollToBottom();
    }

    clearOutput() {
        this.outputArea.innerHTML = '';
        this.printWelcome();
    }

    exportSession() {
        const output = this.outputArea.innerText;
        const blob = new Blob([output], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `kimibuilt-session-${new Date().toISOString().slice(0, 10)}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        this.printSystem('✓ Session exported');
    }

    navigateHistory(direction) {
        if (this.history.length === 0) return;
        
        this.historyIndex += direction;
        if (this.historyIndex < 0) this.historyIndex = 0;
        if (this.historyIndex >= this.history.length) {
            this.historyIndex = this.history.length;
            this.commandInput.value = '';
            return;
        }
        
        this.commandInput.value = this.history[this.historyIndex];
    }

    updateSessionInfo() {
        const sessionId = api.sessionId || 'none';
        this.sessionInfo.innerHTML = `Session: <span class="text-gray-400">${sessionId.slice(0, 8)}${sessionId.length > 8 ? '...' : ''}</span>`;
    }

    scrollToBottom() {
        this.outputArea.scrollTop = this.outputArea.scrollHeight;
    }

    getTimestamp() {
        return new Date().toLocaleTimeString();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async loadModels() {
        const models = await api.getModels();
        this.modelSelect.innerHTML = models.map(m => 
            `<option value="${m.id}">${m.name || m.id}</option>`
        ).join('');
        if (models.length > 0) {
            api.setModel(models[0].id);
        }
    }
}

const app = new WebCLIApp();
