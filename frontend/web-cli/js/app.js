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

        this.setupEventListeners();
        this.checkConnection();
        this.loadModels();

        // Print welcome message
        this.printWelcome();
    }

    setupEventListeners() {
        // Input handling
        this.commandInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendCommand();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.navigateHistory(-1);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.navigateHistory(1);
            } else if (e.ctrlKey && e.key === 'l') {
                e.preventDefault();
                this.clearOutput();
            } else if (e.ctrlKey && e.key === 'c') {
                e.preventDefault();
                this.copyLastOutput();
            }
        });

        // Focus input on click anywhere
        document.addEventListener('click', (e) => {
            if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'A') {
                this.commandInput.focus();
            }
        });

        // Model selection
        this.modelSelect.addEventListener('change', () => {
            api.setModel(this.modelSelect.value);
            this.printSystem(`Model set to: ${this.modelSelect.value}`);
        });
    }

    async checkConnection() {
        const health = await api.checkHealth();
        if (health.connected) {
            this.connectionStatus.innerHTML = '<span class="text-green-500">● Connected</span>';
        } else {
            this.connectionStatus.innerHTML = '<span class="text-red-500">● Disconnected</span>';
            this.printError(`Connection failed: ${health.error}`);
        }
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

    printWelcome() {
        const welcome = document.createElement('div');
        welcome.className = 'system mb-4';
        welcome.innerHTML = `
            <div class="timestamp">${this.getTimestamp()}</div>
            <div class="text-green-400 font-bold">Welcome to KimiBuilt Web CLI v1.0</div>
            <div class="mt-2 text-gray-400">
                Commands:<br>
                <span class="prompt">/help</span> - Show all commands<br>
                <span class="prompt">/mode &lt;chat|canvas|notation&gt;</span> - Switch mode<br>
                <span class="prompt">/model &lt;name&gt;</span> - Change AI model<br>
                <span class="prompt">/clear</span> - Clear screen<br>
                <span class="prompt">/session</span> - Show session info<br>
                <span class="prompt">/new</span> - Start new session<br>
            </div>
        `;
        this.outputArea.appendChild(welcome);
        this.scrollToBottom();
    }

    async sendCommand() {
        const input = this.commandInput.value.trim();
        if (!input || this.isProcessing) return;

        this.commandInput.value = '';
        this.history.push(input);
        this.historyIndex = this.history.length;

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
        const parts = input.slice(1).split(' ');
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1);

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
                this.printSystem('New session started');
                break;
            case 'models':
                await this.loadModels();
                this.printSystem(`Available models: ${api.models.map(m => m.id).join(', ')}`);
                break;
            case 'health':
                await this.checkConnection();
                break;
            default:
                this.printError(`Unknown command: /${cmd}`);
        }
    }

    printHelp() {
        const help = document.createElement('div');
        help.className = 'system';
        help.innerHTML = `
            <div class="font-bold text-blue-400 mb-2">Available Commands:</div>
            <div class="grid grid-cols-2 gap-2 text-sm">
                <div><span class="prompt">/help</span> - Show this help</div>
                <div><span class="prompt">/mode &lt;chat|canvas|notation&gt;</span> - Switch mode</div>
                <div><span class="prompt">/model &lt;name&gt;</span> - Change AI model</div>
                <div><span class="prompt">/models</span> - List available models</div>
                <div><span class="prompt">/clear</span> - Clear screen</div>
                <div><span class="prompt">/session</span> - Show session info</div>
                <div><span class="prompt">/new</span> - Start new session</div>
                <div><span class="prompt">/health</span> - Check connection</div>
            </div>
            <div class="mt-2 text-gray-500">
                Shortcuts: Ctrl+L=Clear | Ctrl+C=Copy | ↑↓=History
            </div>
        `;
        this.outputArea.appendChild(help);
        this.scrollToBottom();
    }

    async processInput(input) {
        this.isProcessing = true;
        this.currentOutput = '';

        const responseEl = document.createElement('div');
        responseEl.className = 'ai-response mb-4 streaming-cursor';
        responseEl.innerHTML = `<span class="timestamp">${this.getTimestamp()}</span><br>`;
        this.outputArea.appendChild(responseEl);

        try {
            if (this.mode === 'chat') {
                for await (const chunk of api.streamChat(input, api.currentModel, this.mode)) {
                    if (chunk.type === 'delta') {
                        this.currentOutput += chunk.content;
                        responseEl.innerHTML = `<span class="timestamp">${this.getTimestamp()}</span><br>${this.escapeHtml(this.currentOutput)}`;
                        this.scrollToBottom();
                    } else if (chunk.type === 'error') {
                        this.printError(chunk.error);
                    } else if (chunk.type === 'done') {
                        responseEl.classList.remove('streaming-cursor');
                        this.updateSessionInfo();
                    }
                }
            } else if (this.mode === 'canvas') {
                const response = await api.sendCanvasRequest(input, 'document');
                this.currentOutput = response.content || 'No content generated';
                responseEl.innerHTML = `<span class="timestamp">${this.getTimestamp()}</span><br>${this.escapeHtml(this.currentOutput)}`;
                responseEl.classList.remove('streaming-cursor');
                if (response.suggestions?.length > 0) {
                    this.printSystem(`Suggestions: ${response.suggestions.join(', ')}`);
                }
            } else if (this.mode === 'notation') {
                const response = await api.sendNotationRequest(input, 'expand');
                this.currentOutput = response.result || 'No result generated';
                responseEl.innerHTML = `<span class="timestamp">${this.getTimestamp()}</span><br>${this.escapeHtml(this.currentOutput)}`;
                responseEl.classList.remove('streaming-cursor');
            }
        } catch (error) {
            responseEl.classList.remove('streaming-cursor');
            this.printError(error.message);
        }

        this.isProcessing = false;
        this.scrollToBottom();
    }

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

        this.printSystem(`Mode switched to: ${mode}`);
    }

    printInput(text) {
        const div = document.createElement('div');
        div.className = 'command-line user-input';
        div.innerHTML = `<span class="prompt">❯</span> <span>${this.escapeHtml(text)}</span>`;
        this.outputArea.appendChild(div);
        this.scrollToBottom();
    }

    printSystem(text) {
        const div = document.createElement('div');
        div.className = 'system';
        div.innerHTML = `<span class="timestamp">${this.getTimestamp()}</span> ${this.escapeHtml(text)}`;
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

    copyLastOutput() {
        if (this.currentOutput) {
            navigator.clipboard.writeText(this.currentOutput).then(() => {
                this.printSystem('Copied to clipboard');
            });
        }
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
        this.printSystem('Session exported');
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
}

const app = new WebCLIApp();
