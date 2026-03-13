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
        
        // Session file storage
        this.sessionFiles = [];
        this.nextFileId = 1;
        
        // Command queue
        this.commandQueue = [];
        this.isProcessingQueue = false;
        
        // Available commands for autocomplete
        this.commands = [
            '/help', '/?', '/clear', '/cls', '/models', '/model', '/theme', 
            '/export', '/save', '/load', '/copy', '/image', '/image-models', '/unsplash', '/diagram',
            '/upload', '/session', '/stats', '/shortcuts', '/keys', '/health',
            '/files', '/ls', '/download', '/open'
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
        this.cliStatus = document.getElementById('cliStatus');
        this.queueIndicator = document.getElementById('queueIndicator');
        this.queueSection = document.getElementById('queueSection');
        this.queueList = document.getElementById('queueList');
        this.queueCount = document.getElementById('queueCount');
        
        this.setupEventListeners();
        this.applyTheme(this.theme);
        this.initMermaid();
        this.checkConnection();
        this.loadModels();
        this.printWelcome();
    }
    
    initMermaid() {
        // Initialize Mermaid with appropriate theme
        if (typeof mermaid !== 'undefined') {
            mermaid.initialize({
                startOnLoad: false,
                theme: this.theme === 'dark' ? 'dark' : 'default',
                securityLevel: 'loose',
                fontFamily: 'var(--font-family)'
            });
        }
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
                this.closeFileManager();
            } else if (e.key === 'F1') {
                e.preventDefault();
                this.showShortcuts();
            } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
                e.preventDefault();
                this.openFileManager();
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
        
        // If currently processing, queue the command
        if (this.isProcessing) {
            this.commandQueue.push(input);
            this.updateQueueDisplay();
            this.printSystem(`Queued: ${input.substring(0, 50)}${input.length > 50 ? '...' : ''}`);
            return;
        }
        
        // Process immediately
        await this.processCommandItem(input);
    }
    
    async processCommandItem(input) {
        // Process command
        if (input.startsWith('/')) {
            await this.processCommand(input);
        } else {
            await this.processQuery(input);
        }
        
        // Process next queued command if any
        this.processQueue();
    }
    
    async processQueue() {
        if (this.isProcessingQueue || this.commandQueue.length === 0) return;
        
        this.isProcessingQueue = true;
        
        while (this.commandQueue.length > 0 && !this.isProcessing) {
            const nextCommand = this.commandQueue.shift();
            this.updateQueueDisplay();
            this.printSystem(`Running queued: ${nextCommand.substring(0, 50)}${nextCommand.length > 50 ? '...' : ''}`);
            await this.processCommandItem(nextCommand);
        }
        
        this.isProcessingQueue = false;
    }
    
    updateQueueDisplay() {
        const count = this.commandQueue.length;
        
        // Update indicator
        if (this.queueIndicator) {
            this.queueIndicator.textContent = count;
            this.queueIndicator.classList.toggle('hidden', count === 0);
        }
        
        // Update side panel
        if (this.queueSection) {
            this.queueSection.style.display = count > 0 ? 'block' : 'none';
        }
        if (this.queueCount) {
            this.queueCount.textContent = count;
        }
        if (this.queueList) {
            this.queueList.innerHTML = this.commandQueue.map(cmd => 
                `<div class="queue-item">${this.escapeHtml(cmd.substring(0, 40))}${cmd.length > 40 ? '...' : ''}</div>`
            ).join('');
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
            case 'image-models':
                await this.listImageModels();
                break;
            case 'unsplash':
                await this.searchUnsplash(args.join(' '));
                break;
            case 'diagram':
                if (!args[0] || args[0] === 'help' || args[0] === '?') {
                    this.printDiagramHelp();
                } else {
                    await this.generateDiagram(args[0], args.slice(1).join(' '));
                }
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
            case 'files':
            case 'ls':
                this.listFiles();
                break;
            case 'download':
                if (args[0]) {
                    await this.downloadFileById(args[0]);
                } else {
                    this.printError('Usage: /download <file-id>  (use /files to see IDs)');
                }
                break;
            case 'open':
                this.openFileManager();
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
        
        // Update status
        this.setStatus('thinking');
        
        try {
            const startTime = Date.now();
            
            const response = await api.sendMessage(input, (chunk) => {
                // Stream progress
                if (chunk.type === 'delta') {
                    this.appendToCurrentOutput(chunk.content);
                }
            });
            
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            
            // Finalize streaming output - remove streaming line and print full response
            this.finalizeStreamingOutput();
            
            // Print response
            this.printAI(response.content || 'No response');
            
            // Update status
            this.setStatus('ready');
            
            // Add to conversation
            this.lastResponse = response.content;
            
        } catch (error) {
            this.printError(`Request failed: ${error.message}`);
            this.setStatus('error');
        } finally {
            this.isProcessing = false;
            this.currentOutput = '';
            // Process any queued commands
            this.processQueue();
        }
    }
    
    // ==================== Simple Status & Queue ====================
    
    setStatus(state) {
        // state: 'ready', 'thinking', 'error'
        if (!this.cliStatus) return;
        
        this.cliStatus.className = `cli-status ${state}`;
        
        switch(state) {
            case 'thinking':
                this.cliStatus.textContent = 'Thinking...';
                break;
            case 'error':
                this.cliStatus.textContent = 'Error';
                setTimeout(() => this.setStatus('ready'), 3000);
                break;
            case 'ready':
            default:
                this.cliStatus.textContent = 'Ready';
                break;
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // ==================== Session Info ====================
    
    printStats() {
        const elapsed = Math.floor((Date.now() - this.sessionStartTime) / 1000);
        this.printSystem(`
Session Statistics:
  Duration: ${elapsed}s
  Model: ${api.currentModel || 'default'}
        `.trim());
    }
    
    // ==================== Output Methods ====================
    
    printInput(text) {
        const line = document.createElement('div');
        line.className = 'line line-input';
        line.innerHTML = `
            <span class="prompt">?</span>
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
        
        // Render any mermaid diagrams
        this.renderMermaidDiagrams(line);
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
        line.innerHTML = `<span class="timestamp">${this.getTimestamp()}</span> ? ${this.escapeHtml(text)}`;
        this.terminalOutput.appendChild(line);
        this.scrollToBottom();
    }
    
    printWarning(text) {
        const line = document.createElement('div');
        line.className = 'line line-output';
        line.style.color = 'var(--warning)';
        line.innerHTML = `<span class="timestamp">${this.getTimestamp()}</span> ? ${this.escapeHtml(text)}`;
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
                     Defaults to the backend image model (official OpenAI if configured)
                     Options: --model gpt-image-1.5|gpt-image-1-mini|gpt-image-1
                     --size 1024x1024 --quality standard|hd --style vivid|natural
  /image-models      List available image models
  /unsplash <query>  Search Unsplash for stock images
                     Options: --orientation landscape|portrait|squarish
  /diagram <type>    Generate Mermaid diagram
  /upload            Upload a file for context

**Session:**
  /session           Show session information
  /stats             Show session statistics
  /save <name>       Save conversation
  /load <name>       Load conversation
  /export            Export conversation to file
  /copy              Copy last response to clipboard

**Files:**
  /files, /ls        List session files
  /download <id>     Download file by ID
  /open              Open file manager (GUI)

**System:**
  /health            Check API connection health

Type any message to chat with the AI.
        `.trim());
    }
    
    printDiagramHelp() {
        this.printAI(`
## Diagram Command

Generate Mermaid diagrams using the AI or templates.

**Usage:**
  /diagram <type> [description]

**Diagram Types:**
  flowchart   - Flowchart diagram (default)
  sequence    - Sequence diagram
  class       - Class diagram
  er          - Entity relationship diagram
  mindmap     - Mind map
  gantt       - Gantt chart
  pie         - Pie chart
  state       - State diagram
  gitgraph    - Git graph

**Examples:**
  /diagram flowchart login process
  /diagram sequence user authentication
  /diagram class user management system
  /diagram mindmap project planning

The AI will generate appropriate Mermaid syntax. If AI is unavailable, a template will be used.
        `.trim());
    }
    
    // ==================== Helper Methods ====================
    
    renderMarkdown(text) {
        // Simple markdown rendering
        let html = this.escapeHtml(text);
        
        // Code blocks (including mermaid)
        html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
            const language = lang || 'text';
            const trimmedCode = code.trim();
            
            // Special handling for mermaid diagrams
            if (language === 'mermaid') {
                const diagramId = 'mermaid-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                return `
                    <div class="diagram-block">
                        <div class="code-block mermaid-code">
                            <div class="code-header">
                                <span>mermaid</span>
                                <div class="code-actions">
                                    <button class="code-action-btn" onclick="app.copyCode(this)">Copy</button>
                                </div>
                            </div>
                            <pre><code class="language-mermaid">${trimmedCode}</code></pre>
                        </div>
                        <div class="diagram-preview">
                            <div class="mermaid" id="${diagramId}">${trimmedCode}</div>
                        </div>
                    </div>
                `;
            }
            
            return `
                <div class="code-block">
                    <div class="code-header">
                        <span>${language}</span>
                        <div class="code-actions">
                            <button class="code-action-btn" onclick="app.copyCode(this)">Copy</button>
                        </div>
                    </div>
                    <pre><code class="language-${language}">${trimmedCode}</code></pre>
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
    
    /**
     * Render Mermaid diagrams after content is added to DOM
     */
    renderMermaidDiagrams(element) {
        if (typeof mermaid !== 'undefined') {
            try {
                mermaid.run({
                    querySelector: '.mermaid',
                    suppressErrors: true
                });
            } catch (err) {
                console.warn('[CLI] Mermaid rendering failed:', err);
            }
        }
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
        this.setStatus('thinking');
        try {
            const health = await api.healthCheck();
            this.printSystem(`Health Check:
  Status: ${health.connected ? '? Connected' : '? Disconnected'}
  Version: ${health.version || 'unknown'}
  Models: ${health.models || 'unknown'}
            `.trim());
            this.setStatus('ready');
        } catch (error) {
            this.printError(`Health check failed: ${error.message}`);
            this.setStatus('error');
        }
    }
    
    async loadModels() {
        try {
            const models = await api.getModels();
            if (models.length === 0) {
                throw new Error('No models returned');
            }
            this.modelSelect.innerHTML = models.map(m => 
                `<option value="${m.id}" ${m.id === api.currentModel ? 'selected' : ''}>${m.id}</option>`
            ).join('');
            this.updateModelInfo();
        } catch (error) {
            this.modelSelect.innerHTML = '<option value="gpt-4o">gpt-4o</option>';
            api.setModel('gpt-4o');
            this.updateModelInfo();
        }
    }
    
    async listModels() {
        try {
            const models = await api.getModels();
            this.printAI(`## Available Models\n\n${models.map(m => '  - ' + m.id).join('\n')}`);
        } catch (error) {
            this.printError('Failed to load models');
        }
    }
    async listImageModels() {
        this.printAI("## Available Image Models\n\n  - gpt-image-1.5\n  - gpt-image-1-mini\n  - gpt-image-1");
    }

    
    updateModelInfo() {
        const model = api.currentModel || 'gpt-4o';
        
        // Update the select dropdown to match current model
        if (this.modelSelect) {
            // Check if the model exists in the dropdown
            const options = Array.from(this.modelSelect.options);
            const modelExists = options.some(opt => opt.value === model);
            
            if (modelExists) {
                this.modelSelect.value = model;
            } else if (options.length > 0 && options[0].value !== 'Loading models...') {
                // If model not in list, add it as a temporary option
                const tempOption = document.createElement('option');
                tempOption.value = model;
                tempOption.textContent = model;
                this.modelSelect.insertBefore(tempOption, this.modelSelect.firstChild);
                this.modelSelect.value = model;
            }
        }
        
        // Update header model display
        const headerModel = document.getElementById('headerModelDisplay');
        if (headerModel) {
            headerModel.textContent = model;
            headerModel.title = `Current model: ${model}`;
        }
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
        this.setStatus('thinking');
        
        try {
            const content = await api.uploadFile(file);
            this.printSystem(`File uploaded: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
            this.printAI(`File content from "${file.name}":\n\n\`\`\`\n${content.substring(0, 2000)}${content.length > 2000 ? '\n... (truncated)' : ''}\n\`\`\``);
            this.setStatus('ready');
        } catch (error) {
            this.printError(`Failed to process file: ${error.message}`);
            this.setStatus('error');
        }
    }
    
    // ==================== Image Generation ====================
    
    async generateImage(input) {
        if (!input) {
            this.printError('Please provide a prompt. Usage: /image <prompt> [--model gpt-image-1.5] [--size 1024x1024] [--quality standard]');
            return;
        }
        
        // Parse options from input
        const { prompt, options } = this.parseImageArgs(input);
        
        if (!prompt) {
            this.printError('Please provide a prompt. Usage: /image <prompt> [--model gpt-image-1.5] [--size 1024x1024] [--quality standard]');
            return;
        }
        
        this.isProcessing = true;
        this.setStatus('thinking');
        this.printSystem(`Generating image with ${options.model || 'backend default'}...`);
        
        try {
            const response = await api.generateImage(prompt, options);
            
            if (response.data && response.data.length > 0) {
                const image = response.data[0];
                const imageUrl = image.url || image.b64_json;
                
                const fileId = this.addSessionFile(
                    `image-${Date.now()}.png`, 
                    imageUrl, 
                    'image/png', 
                    'image'
                );
                this.printSystem('Image generated with ' + (response.model || options.model || 'backend default') + ' (' + (response.size || options.size || '1024x1024') + ')');
                this.printSystem('Image saved as file #' + fileId + '. Use /download ' + fileId + ' or /open.');
            } else {
                this.printError('No image data received from API');
            }
            
            this.setStatus('ready');
        } catch (error) {
            this.printError(`Image generation failed: ${error.message}`);
            this.setStatus('error');
        } finally {
            this.isProcessing = false;
        }
    }
    
    /**
     * Parse image command arguments
     * Supports: --model, --size, --quality, --style
     */
    parseImageArgs(input) {
        const options = {
            model: null,
            size: '1024x1024',
            quality: 'standard',
            style: 'vivid'
        };
        
        let prompt = input;
        
        // Parse --model
        const modelMatch = input.match(/--model\s+(\S+)/);
        if (modelMatch) {
            options.model = modelMatch[1];
            prompt = prompt.replace(modelMatch[0], '').trim();
        }
        
        // Parse --size
        const sizeMatch = input.match(/--size\s+(\d+x\d+)/);
        if (sizeMatch) {
            options.size = sizeMatch[1];
            prompt = prompt.replace(sizeMatch[0], '').trim();
        }
        
        // Parse --quality
        const qualityMatch = input.match(/--quality\s+(standard|hd)/);
        if (qualityMatch) {
            options.quality = qualityMatch[1];
            prompt = prompt.replace(qualityMatch[0], '').trim();
        }
        
        // Parse --style
        const styleMatch = input.match(/--style\s+(vivid|natural)/);
        if (styleMatch) {
            options.style = styleMatch[1];
            prompt = prompt.replace(styleMatch[0], '').trim();
        }
        
        return { prompt: prompt.trim(), options };
    }
    
    /**
     * Search Unsplash for stock images
     */
    async searchUnsplash(query) {
        if (!query) {
            this.printError('Please provide a search query. Usage: /unsplash <query> [--orientation landscape|portrait|squarish]');
            return;
        }
        
        // Parse options
        let searchQuery = query;
        let orientation = null;
        
        const orientationMatch = query.match(/--orientation\s+(landscape|portrait|squarish)/);
        if (orientationMatch) {
            orientation = orientationMatch[1];
            searchQuery = searchQuery.replace(orientationMatch[0], '').trim();
        }
        
        if (!searchQuery) {
            this.printError('Please provide a search query. Usage: /unsplash <query> [--orientation landscape|portrait|squarish]');
            return;
        }
        
        this.isProcessing = true;
        this.setStatus('thinking');
        this.printSystem(`Searching Unsplash for "${searchQuery}"...`);
        
        try {
            const response = await api.searchUnsplash(searchQuery, { orientation });
            
            if (response.results && response.results.length > 0) {
                this.displayUnsplashResults(response.results, searchQuery, response.total);
            } else {
                this.printWarning(`No images found for "${searchQuery}"`);
            }
            
            this.setStatus('ready');
        } catch (error) {
            this.printError(`Unsplash search failed: ${error.message}`);
            this.setStatus('error');
        } finally {
            this.isProcessing = false;
        }
    }
    
    /**
     * Display Unsplash search results
     */
    displayUnsplashResults(results, query, total) {
        let output = `## Unsplash Results for "${this.escapeHtml(query)}"\n\n`;
        output += `Found ${total} images. Showing top ${results.length}:\n\n`;
        
        results.forEach((image, index) => {
            const num = index + 1;
            const author = image.author ? image.author.name : 'Unknown';
            const dimensions = `${image.width}x${image.height}`;
            
            output += `${num}. **${this.escapeHtml(image.altDescription || image.description || 'Untitled')}**\n`;
            output += `   ?? ${dimensions} | ?? ${image.likes} | ?? ${this.escapeHtml(author)}\n`;
            output += `   ?? [View on Unsplash](${image.links.html})\n\n`;
            
            // Add small thumbnail preview
            output += `   <img src="${image.urls.small}" alt="${this.escapeHtml(image.altDescription || '')}" style="max-width: 300px; border-radius: 4px; margin: 5px 0;" />\n\n`;
        });
        
        output += `---\n`;
        output += `To download, click the image or visit the Unsplash link.\n`;
        output += `Images are licensed under the [Unsplash License](https://unsplash.com/license).`;
        
        this.printAI(output);
    }
    
    /**
     * Generate a Mermaid diagram file
     */
    async generateDiagram(type = 'flowchart', description = '') {
        this.isProcessing = true;
        this.setStatus('thinking');
        
        try {
            // Try to get AI-generated diagram code
            const diagramPrompt = `Create a ${type} diagram for: ${description || 'a simple process'}
            
Return ONLY valid Mermaid syntax code, no explanations, no markdown code blocks.`;
            
            const response = await api.sendMessage(diagramPrompt);
            let diagramCode = response.content || '';
            
            // Clean up the code - remove markdown code blocks if present
            diagramCode = diagramCode.replace(/^```mermaid\n?/i, '');
            diagramCode = diagramCode.replace(/```\s*$/i, '');
            diagramCode = diagramCode.trim();
            
            // If no valid code returned, use template
            if (!diagramCode || diagramCode.length < 10) {
                diagramCode = this.getMermaidTemplate(type, description);
            }
            
            // Create and download file
            const filename = `diagram-${type}-${Date.now()}.mmd`;
            this.downloadFile(diagramCode, filename, 'text/plain');
            
            // Add to session files
            const file = this.addSessionFile(filename, diagramCode, 'text/plain', 'diagram');
            
            // Show preview in terminal
            this.printAI(`## Generated ${type} diagram

\`\`\`mermaid
${diagramCode}
\`\`\`

**Downloaded:** ${filename}
**File ID:** #${file.id} (use /files to manage)`);
            
            this.setStatus('ready');
        } catch (error) {
            // Fallback: generate template
            const diagramCode = this.getMermaidTemplate(type, description);
            const filename = `diagram-${type}-${Date.now()}.mmd`;
            this.downloadFile(diagramCode, filename, 'text/plain');
            
            // Add to session files
            const file = this.addSessionFile(filename, diagramCode, 'text/plain', 'diagram');
            
            this.printAI(`## Generated ${type} diagram (template)

\`\`\`mermaid
${diagramCode}
\`\`\`

**Downloaded:** ${filename}
**File ID:** #${file.id} (use /files to manage)`);
            
            this.setStatus('ready');
        } finally {
            this.isProcessing = false;
        }
    }
    
    /**
     * Get Mermaid template
     */
    getMermaidTemplate(type, description) {
        const desc = description || 'Process';
        const templates = {
            flowchart: `graph TD
    A[Start] --> B{${desc}?}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
    C --> E[Result]
    D --> E
    E --> F[End]`,
            sequence: `sequenceDiagram
    participant U as User
    participant S as System
    participant D as Database
    
    U->>S: ${desc}
    S->>D: Query data
    D-->>S: Return results
    S-->>U: Display response`,
            class: `classDiagram
    class User {
        +String name
        +String email
        +login()
        +logout()
    }
    class System {
        +process()
    }
    User --> System : uses
    note for User "${desc}"`,
            er: `erDiagram
    USER ||--o{ ORDER : places
    USER {
        string name
        string email
    }
    ORDER {
        int id
        date created
    }`,
            mindmap: `mindmap
  root((${desc}))
    Planning
      Research
      Design
    Execution
      Development
      Testing
    Delivery`,
            gantt: `gantt
    title ${desc} Timeline
    dateFormat  YYYY-MM-DD
    section Phase 1
    Planning           :done, p1, 2024-01-01, 7d
    Design             :active, p2, after p1, 7d
    section Phase 2
    Development        :p3, after p2, 14d
    Testing            :p4, after p3, 7d`,
            pie: `pie title ${desc}
    "Category A" : 40
    "Category B" : 30
    "Category C" : 20
    "Category D" : 10`,
            state: `stateDiagram-v2
    [*] --> Idle
    Idle --> Processing : ${desc}
    Processing --> Success : valid
    Processing --> Error : invalid
    Success --> [*]
    Error --> Idle : retry`,
            gitgraph: `gitGraph
    commit id: "Initial"
    branch feature
    checkout feature
    commit id: "Add feature"
    checkout main
    merge feature id: "Merge ${desc}"
    commit id: "Release"`
        };
        
        return templates[type] || templates.flowchart;
    }
    
    /**
     * Download file helper
     */
    downloadFile(content, filename, mimeType) {
        const a = document.createElement('a');
        let url = null;

        if (typeof content === 'string' && /^(data:|blob:|https?:)/i.test(content)) {
            url = content;
        } else {
            const blob = new Blob([content], { type: mimeType });
            url = URL.createObjectURL(blob);
        }

        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        if (url.startsWith('blob:')) {
            URL.revokeObjectURL(url);
        }
    }
    
    // ==================== Session Management ====================
    
    printSessionInfo() {
        const elapsed = Math.floor((Date.now() - this.sessionStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        const queueSize = this.commandQueue.length;
        
        this.printSystem(`Session Info:
  Duration: ${minutes}m ${seconds}s
  Files: ${this.sessionFiles.length}
  Queue: ${queueSize}
  Commands: ${this.commandHistory.length}`);
    }
    saveConversation(name) {
        const data = {
            history: this.history,
            timestamp: Date.now(),
            model: api.currentModel,
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
    
    // ==================== File Management ====================
    
    /**
     * Add a file to the session
     */
    addSessionFile(filename, content, mimeType, type = 'generated') {
        const file = {
            id: this.nextFileId++,
            filename,
            content,
            mimeType,
            type,
            size: new Blob([content]).size,
            createdAt: new Date().toISOString()
        };
        this.sessionFiles.push(file);
        return file;
    }
    
    /**
     * List all session files
     */
    listFiles() {
        if (this.sessionFiles.length === 0) {
            this.printSystem('No files in this session. Generate files with /diagram, /image, or AI file generation.');
            return;
        }
        
        const lines = ['## Session Files', ''];
        lines.push('ID  | Name                          | Type       | Size   | Created');
        lines.push('----|-------------------------------|------------|--------|----------------');
        
        this.sessionFiles.forEach(file => {
            const id = String(file.id).padStart(3);
            const name = file.filename.substring(0, 30).padEnd(30);
            const type = file.type.padEnd(10);
            const size = this.formatFileSize(file.size).padEnd(6);
            const time = new Date(file.createdAt).toLocaleTimeString();
            lines.push(`${id} | ${name} | ${type} | ${size} | ${time}`);
        });
        
        lines.push('');
        lines.push('Commands: /download <id> | /open (GUI) | Click file in output');
        
        this.printAI(lines.join('\n'));
    }
    
    /**
     * Download a file by ID
     */
    async downloadFileById(id) {
        const fileId = parseInt(id, 10);
        const file = this.sessionFiles.find(f => f.id === fileId);
        
        if (!file) {
            this.printError(`File #${id} not found. Use /files to see available files.`);
            return;
        }
        
        this.downloadFile(file.content, file.filename, file.mimeType);
        this.printSystem(`Downloaded: ${file.filename}`);
    }
    
    /**
     * Format file size
     */
    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
    
    /**
     * Open file manager modal
     */
    openFileManager() {
        // Remove existing modal
        const existing = document.getElementById('file-manager-modal');
        if (existing) existing.remove();
        
        const modal = document.createElement('div');
        modal.id = 'file-manager-modal';
        modal.className = 'file-manager-modal';
        modal.innerHTML = `
            <div class="file-manager-overlay" onclick="app.closeFileManager()"></div>
            <div class="file-manager-content">
                <div class="file-manager-header">
                    <h3>Session Files (${this.sessionFiles.length})</h3>
                    <button class="file-manager-close" onclick="app.closeFileManager()">Close</button>
                </div>
                <div class="file-manager-body">
                    ${this.sessionFiles.length === 0 ? 
                        '<div class="file-manager-empty">No files yet. Generate files with /diagram, /image, or ask the AI.</div>' :
                        this.sessionFiles.map(f => `
                            <div class="file-item" onclick="app.downloadFileById('${f.id}')">
                                <span class="file-icon">${this.getFileIcon(f.filename)}</span>
                                <span class="file-name">${f.filename}</span>
                                <span class="file-meta">${this.formatFileSize(f.size)} | ${f.type}</span>
                                <button class="file-download-btn" onclick="event.stopPropagation(); app.downloadFileById('${f.id}')">Download</button>
                            </div>
                        `).join('')
                    }
                </div>
                <div class="file-manager-footer">
                    <button class="ai-image-btn" onclick="app.closeFileManager()">Close</button>
                    <button class="ai-image-btn primary" onclick="app.downloadAllFiles()">Download All (ZIP)</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }
    
    /**
     * Close file manager modal
     */
    closeFileManager() {
        const modal = document.getElementById('file-manager-modal');
        if (modal) modal.remove();
    }
    
    /**
     * Get icon for file type
     */
    getFileIcon(filename) {
        const ext = filename.split('.').pop()?.toLowerCase();
        const icons = {
            mmd: '??', png: '??', jpg: '??', jpeg: '??', gif: '??', svg: '??',
            pdf: '??', docx: '??', doc: '??', txt: '??', md: '??',
            js: '??', ts: '??', py: '??', html: '??', css: '??',
            json: '??', xml: '??', csv: '??', xlsx: '??',
            zip: '??', gz: '??'
        };
        return icons[ext] || '??';
    }
    
    /**
     * Download all files as ZIP (simplified - downloads individually)
     */
    downloadAllFiles() {
        if (this.sessionFiles.length === 0) return;
        
        this.printSystem(`Downloading ${this.sessionFiles.length} files...`);
        this.sessionFiles.forEach((file, i) => {
            setTimeout(() => {
                this.downloadFile(file.content, file.filename, file.mimeType);
            }, i * 200);
        });
        this.closeFileManager();
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
        
        // Update mermaid theme
        if (typeof mermaid !== 'undefined') {
            mermaid.initialize({
                startOnLoad: false,
                theme: theme === 'dark' ? 'dark' : 'default',
                securityLevel: 'loose',
                fontFamily: 'var(--font-family)'
            });
        }
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
                    <code class="inline-code">? / ?</code>
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
                <div class="flex justify-between py-1 border-b" style="border-color: var(--border-color);">
                    <span>File manager</span>
                    <code class="inline-code">Ctrl + Shift + F</code>
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
    
    /**
     * Trigger mermaid rendering (useful for re-rendering after streaming)
     */
    refreshMermaidDiagrams() {
        this.renderMermaidDiagrams(this.terminalOutput);
    }
    
    /**
     * Remove streaming line before printing final response
     */
    finalizeStreamingOutput() {
        const streamingLine = this.terminalOutput.querySelector('.line-output.ai.streaming');
        if (streamingLine) {
            streamingLine.remove();
        }
    }
}

const app = new CodeCLIApp();







