/**
 * Canvas Types - Code/Document/Diagram mode handlers
 */

class CanvasTypeManager {
    constructor() {
        this.types = {
            code: new CodeHandler(),
            document: new DocumentHandler(),
            diagram: new DiagramHandler(),
            frontend: new FrontendHandler()
        };
        this.currentType = 'code';
    }

    /**
     * Get handler for specific type
     * @param {string} type 
     * @returns {CanvasTypeHandler}
     */
    getHandler(type) {
        return this.types[type] || this.types.code;
    }

    /**
     * Get current handler
     * @returns {CanvasTypeHandler}
     */
    getCurrentHandler() {
        return this.getHandler(this.currentType);
    }

    /**
     * Set current type
     * @param {string} type 
     */
    setType(type) {
        if (this.types[type]) {
            this.currentType = type;
        }
    }

    /**
     * Get current type
     * @returns {string}
     */
    getType() {
        return this.currentType;
    }

    /**
     * Get all available types
     * @returns {Array}
     */
    getAvailableTypes() {
        return Object.keys(this.types).map(key => ({
            id: key,
            ...this.types[key].getInfo()
        }));
    }
}

/**
 * Base Canvas Type Handler
 */
class CanvasTypeHandler {
    getInfo() {
        return {
            name: 'Base',
            description: 'Base canvas type',
            icon: 'file'
        };
    }

    getDefaultContent() {
        return '';
    }

    getCodeMirrorMode() {
        return 'text/plain';
    }

    detectLanguage(content, metadata = {}) {
        return metadata.language || 'text';
    }

    preprocessContent(content) {
        return content;
    }

    getFileExtension(language) {
        return '.txt';
    }
}

/**
 * Code Handler
 */
class CodeHandler extends CanvasTypeHandler {
    getInfo() {
        return {
            name: 'Code',
            description: 'Syntax-highlighted code editor',
            icon: 'code',
            supportsPreview: false,
            supportsSplitView: false
        };
    }

    getDefaultContent() {
        return '// Start coding here...\n';
    }

    getCodeMirrorMode(language = 'javascript') {
        const modeMap = {
            javascript: 'javascript',
            typescript: 'javascript',
            js: 'javascript',
            ts: 'javascript',
            python: 'python',
            py: 'python',
            java: 'text/x-java',
            html: 'htmlmixed',
            htm: 'htmlmixed',
            css: 'css',
            json: 'application/json',
            xml: 'xml',
            sql: 'text/x-sql',
            yaml: 'yaml',
            yml: 'yaml',
            markdown: 'markdown',
            md: 'markdown',
            rust: 'text/x-rustsrc',
            rs: 'text/x-rustsrc',
            go: 'text/x-go',
            php: 'application/x-httpd-php',
            ruby: 'text/x-ruby',
            rb: 'text/x-ruby',
            c: 'text/x-csrc',
            cpp: 'text/x-c++src',
            'c++': 'text/x-c++src',
            csharp: 'text/x-csharp',
            cs: 'text/x-csharp',
            swift: 'text/x-swift',
            kotlin: 'text/x-kotlin',
            kt: 'text/x-kotlin',
            shell: 'text/x-sh',
            bash: 'text/x-sh',
            sh: 'text/x-sh'
        };

        return modeMap[language.toLowerCase()] || 'text/plain';
    }

    detectLanguage(content, metadata = {}) {
        if (metadata.language) {
            return metadata.language;
        }

        // Simple language detection based on content patterns
        const patterns = [
            { lang: 'python', pattern: /^(def |import |from |class.*:)/m },
            { lang: 'javascript', pattern: /^(const |let |var |function |=>)/m },
            { lang: 'html', pattern: /^<(!DOCTYPE|html|body|div)/im },
            { lang: 'css', pattern: /^[.#@][^{]+\{/m },
            { lang: 'json', pattern: /^\s*[\{\[]\s*"/ },
            { lang: 'sql', pattern: /^(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP)\s/i },
            { lang: 'java', pattern: /^(public\s+class|import\s+java)/ },
            { lang: 'go', pattern: /^package\s+\w+/m },
            { lang: 'rust', pattern: /^(fn |use |mod |impl |struct |enum )/m },
            { lang: 'markdown', pattern: /^#{1,6}\s|^\[.+\]\(.+\)|^-\s|^\*\s/m }
        ];

        for (const { lang, pattern } of patterns) {
            if (pattern.test(content)) {
                return lang;
            }
        }

        return 'text';
    }

    getFileExtension(language) {
        const extensions = {
            javascript: '.js',
            typescript: '.ts',
            python: '.py',
            java: '.java',
            html: '.html',
            css: '.css',
            json: '.json',
            xml: '.xml',
            sql: '.sql',
            yaml: '.yaml',
            markdown: '.md',
            rust: '.rs',
            go: '.go',
            php: '.php',
            ruby: '.rb',
            c: '.c',
            cpp: '.cpp',
            csharp: '.cs',
            swift: '.swift',
            kotlin: '.kt',
            shell: '.sh'
        };

        return extensions[language] || '.txt';
    }

    getLanguageLabel(language) {
        const labels = {
            javascript: 'JavaScript',
            typescript: 'TypeScript',
            python: 'Python',
            java: 'Java',
            html: 'HTML',
            css: 'CSS',
            json: 'JSON',
            xml: 'XML',
            sql: 'SQL',
            yaml: 'YAML',
            markdown: 'Markdown',
            rust: 'Rust',
            go: 'Go',
            php: 'PHP',
            ruby: 'Ruby',
            c: 'C',
            cpp: 'C++',
            csharp: 'C#',
            swift: 'Swift',
            kotlin: 'Kotlin',
            shell: 'Shell'
        };

        return labels[language] || language;
    }
}

/**
 * Document Handler
 */
class DocumentHandler extends CanvasTypeHandler {
    constructor() {
        super();
        this.marked = null;
        this.initializeMarked();
    }

    async initializeMarked() {
        // Marked is loaded via CDN, wait for it
        if (typeof marked !== 'undefined') {
            this.marked = marked;
            // Configure marked options
            this.marked.setOptions({
                gfm: true,
                breaks: true,
                headerIds: true,
                mangle: false,
                sanitize: false,
                smartLists: true,
                smartypants: true,
                xhtml: false
            });
        }
    }

    getInfo() {
        return {
            name: 'Document',
            description: 'Rich markdown editor with preview',
            icon: 'file-text',
            supportsPreview: true,
            supportsSplitView: true
        };
    }

    getDefaultContent() {
        return '# Document Title\n\nStart writing your document here...\n\n## Section\n\n- Point 1\n- Point 2\n- Point 3\n';
    }

    getCodeMirrorMode() {
        return 'markdown';
    }

    /**
     * Render markdown to HTML
     * @param {string} content 
     * @returns {string}
     */
    renderMarkdown(content) {
        if (!this.marked && typeof marked !== 'undefined') {
            this.marked = marked;
        }

        const normalizedContent = window.KimiBuiltModelOutputParser?.normalizeModelOutputMarkdown
            ? window.KimiBuiltModelOutputParser.normalizeModelOutputMarkdown(content)
            : content;

        if (this.marked) {
            try {
                return this.marked.parse(normalizedContent);
            } catch (error) {
                console.error('Markdown parse error:', error);
                return `<pre>${this.escapeHtml(normalizedContent)}</pre>`;
            }
        }

        // Fallback: simple HTML conversion
        return this.simpleMarkdownToHtml(normalizedContent);
    }

    /**
     * Simple markdown to HTML fallback
     * @param {string} markdown 
     * @returns {string}
     */
    simpleMarkdownToHtml(markdown) {
        return markdown
            // Headers
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/^# (.*$)/gim, '<h1>$1</h1>')
            // Bold and Italic
            .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/___(.*?)___/g, '<strong><em>$1</em></strong>')
            .replace(/__(.*?)__/g, '<strong>$1</strong>')
            .replace(/_(.*?)_/g, '<em>$1</em>')
            // Code
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            // Code blocks
            .replace(/```[\s\S]*?```/g, (match) => {
                const code = match.slice(3, -3).trim();
                return `<pre><code>${this.escapeHtml(code)}</code></pre>`;
            })
            // Links
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
            // Images
            .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">')
            // Lists
            .replace(/^\s*[-*+]\s+(.+)$/gim, '<li>$1</li>')
            .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
            // Blockquotes
            .replace(/^>\s+(.+)$/gim, '<blockquote>$1</blockquote>')
            // Horizontal rules
            .replace(/^---$/gim, '<hr>')
            // Paragraphs
            .replace(/\n\n/g, '</p><p>')
            .replace(/^(?!<[hl]|<li|<bl|<ul|<hr)(.+)$/gim, '<p>$1</p>');
    }

    /**
     * Escape HTML entities
     * @param {string} text 
     * @returns {string}
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Extract table of contents from markdown
     * @param {string} content 
     * @returns {Array}
     */
    extractTOC(content) {
        const toc = [];
        const lines = content.split('\n');
        const headerRegex = /^(#{1,6})\s+(.+)$/;

        lines.forEach((line, index) => {
            const match = line.match(headerRegex);
            if (match) {
                const level = match[1].length;
                const title = match[2].trim();
                const anchor = title.toLowerCase()
                    .replace(/[^\w\s-]/g, '')
                    .replace(/\s+/g, '-');
                
                toc.push({
                    level,
                    title,
                    anchor,
                    line: index + 1
                });
            }
        });

        return toc;
    }

    getFileExtension() {
        return '.md';
    }
}

/**
 * Frontend Demo Handler
 */
class FrontendHandler extends CanvasTypeHandler {
    getInfo() {
        return {
            name: 'Frontend',
            description: 'Website demo builder with live preview',
            icon: 'layout',
            supportsPreview: true,
            supportsSplitView: true,
        };
    }

    getDefaultContent() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Frontend Demo</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5efe5;
      --ink: #15221a;
      --accent: #c7512c;
      --card: rgba(255, 255, 255, 0.72);
      --line: rgba(21, 34, 26, 0.12);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, 'Times New Roman', serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(199, 81, 44, 0.22), transparent 34%),
        linear-gradient(135deg, #f7f0e7 0%, #e9efe6 55%, #dbe6ea 100%);
      min-height: 100vh;
    }

    main {
      width: min(1120px, calc(100% - 40px));
      margin: 0 auto;
      padding: 64px 0 88px;
    }

    section {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 28px;
      padding: 28px;
      backdrop-filter: blur(12px);
      margin-bottom: 24px;
    }

    h1, h2, p { margin-top: 0; }
  </style>
</head>
<body>
  <main>
    <section id="hero" data-component="hero">
      <p>Portable demo frontend</p>
      <h1>Use this canvas mode to build a polished web concept.</h1>
      <p>Generate a landing page, product demo, promo microsite, or dashboard and then split it into repo files later.</p>
    </section>
  </main>
</body>
</html>`;
    }

    getCodeMirrorMode() {
        return 'htmlmixed';
    }

    getFileExtension() {
        return '.html';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = String(text || '');
        return div.innerHTML;
    }

    ensureHtmlDocument(content = '') {
        const source = String(content || '').trim();
        if (!source) {
            return this.getDefaultContent();
        }

        if (/<html[\s>]/i.test(source)) {
            return source;
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml('Frontend Demo')}</title>
</head>
<body>
${source}
</body>
</html>`;
    }

    buildSummaryMarkup(metadata = {}) {
        const handoff = metadata?.handoff || {};
        const bundleFiles = Array.isArray(metadata?.bundle?.files) ? metadata.bundle.files : [];
        const componentMap = Array.isArray(handoff.componentMap) ? handoff.componentMap : [];
        const integrationSteps = Array.isArray(handoff.integrationSteps) ? handoff.integrationSteps : [];
        const frameworkTarget = this.escapeHtml(metadata?.frameworkTarget || handoff.targetFramework || 'static');
        const title = this.escapeHtml(metadata?.title || 'Frontend Demo');
        const summary = this.escapeHtml(handoff.summary || 'Portable demo frontend with repo handoff guidance.');

        const fileMarkup = bundleFiles.length > 0
            ? `
                <div class="frontend-preview-meta-block">
                    <h4>Files</h4>
                    <ul class="frontend-preview-list">
                        ${bundleFiles.map((file) => `
                            <li>
                                <strong>${this.escapeHtml(file.path || 'file')}</strong>
                                <span>${this.escapeHtml(file.purpose || file.language || 'Project scaffold file')}</span>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            `
            : '';

        const componentMarkup = componentMap.length > 0
            ? `
                <div class="frontend-preview-meta-block">
                    <h4>Component Map</h4>
                    <ul class="frontend-preview-list">
                        ${componentMap.map((entry) => `
                            <li>
                                <strong>${this.escapeHtml(entry.name || 'Section')}</strong>
                                <span>${this.escapeHtml(entry.purpose || '')}</span>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            `
            : '';

        const integrationMarkup = integrationSteps.length > 0
            ? `
                <div class="frontend-preview-meta-block">
                    <h4>Integration Steps</h4>
                    <ol class="frontend-preview-steps">
                        ${integrationSteps.map((entry) => `<li>${this.escapeHtml(entry)}</li>`).join('')}
                    </ol>
                </div>
            `
            : '';

        return `
            <div class="frontend-preview-meta">
                <div class="frontend-preview-meta-header">
                    <div>
                        <p class="frontend-preview-eyebrow">Repo-ready demo</p>
                        <h3>${title}</h3>
                    </div>
                    <span class="frontend-preview-framework">${frameworkTarget}</span>
                </div>
                <p class="frontend-preview-summary">${summary}</p>
                <div class="frontend-preview-meta-grid">
                    ${fileMarkup}
                    ${componentMarkup}
                    ${integrationMarkup}
                </div>
            </div>
        `;
    }

    renderPreview(content, metadata = {}, elementId = 'preview-content') {
        const element = typeof elementId === 'string' ? document.getElementById(elementId) : elementId;
        if (!element) {
            return;
        }

        const html = this.ensureHtmlDocument(content);
        element.innerHTML = `
            <div class="frontend-preview-shell">
                ${this.buildSummaryMarkup(metadata)}
                <div class="frontend-preview-stage">
                    <iframe
                        class="frontend-preview-frame"
                        title="${this.escapeHtml(metadata?.title || 'Frontend demo preview')}"
                        sandbox="allow-scripts allow-forms allow-modals"
                    ></iframe>
                </div>
            </div>
        `;

        const frame = element.querySelector('.frontend-preview-frame');
        if (frame) {
            frame.srcdoc = html;
        }
    }
}

/**
 * Diagram Handler
 */
class DiagramHandler extends CanvasTypeHandler {
    constructor() {
        super();
        this.mermaidInitialized = false;
        this.zoomLevel = 1;
        this.minZoom = 0.25;
        this.maxZoom = 3;
        this.zoomStep = 0.25;
        this.autoRenderTimer = null;
        this.lastContent = '';
        this.renderDebounceMs = 500;
    }

    async initializeMermaid() {
        if (this.mermaidInitialized) return;

        if (typeof mermaid !== 'undefined') {
            mermaid.initialize({
                startOnLoad: false,
                theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default',
                securityLevel: 'strict',
                fontFamily: 'Inter, sans-serif'
            });
            this.mermaidInitialized = true;
        }
    }

    getInfo() {
        return {
            name: 'Diagram',
            description: 'Mermaid.js diagram editor',
            icon: 'git-branch',
            supportsPreview: true,
            supportsSplitView: true
        };
    }

    getDefaultContent() {
        return `graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
    C --> E[End]
    D --> E`;
    }

    getCodeMirrorMode() {
        return 'text/plain'; // Mermaid doesn't have a specific CodeMirror mode
    }

    /**
     * Debounced auto-render for diagram
     * @param {string} content 
     * @param {string} elementId 
     */
    scheduleAutoRender(content, elementId) {
        // Clear existing timer
        if (this.autoRenderTimer) {
            clearTimeout(this.autoRenderTimer);
        }

        // Skip if content hasn't changed
        if (content === this.lastContent) return;

        // Schedule new render
        this.autoRenderTimer = setTimeout(() => {
            this.renderDiagram(content, elementId);
        }, this.renderDebounceMs);
    }

    /**
     * Show loading state
     */
    showLoading() {
        const loadingEl = document.getElementById('diagram-loading');
        const outputEl = document.getElementById('diagram-output');
        if (loadingEl) loadingEl.classList.remove('hidden');
        if (outputEl) outputEl.style.opacity = '0.5';
    }

    /**
     * Hide loading state
     */
    hideLoading() {
        const loadingEl = document.getElementById('diagram-loading');
        const outputEl = document.getElementById('diagram-output');
        if (loadingEl) loadingEl.classList.add('hidden');
        if (outputEl) outputEl.style.opacity = '1';
    }

    /**
     * Render Mermaid diagram
     * @param {string} content 
     * @param {string} elementId 
     * @returns {Promise<boolean>}
     */
    async renderDiagram(content, elementId) {
        await this.initializeMermaid();

        if (typeof mermaid === 'undefined') {
            console.error('Mermaid not loaded');
            return false;
        }

        const element = document.getElementById(elementId);
        if (!element) {
            console.error('Element not found:', elementId);
            return false;
        }

        // Show loading
        this.showLoading();
        this.lastContent = content;

        // Clear previous errors
        this.clearErrorPanel();

        try {
            // Clear previous content
            element.innerHTML = '';

            // Generate unique ID for this render
            const uniqueId = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            // Parse and render
            const { svg } = await mermaid.render(uniqueId, content);
            element.innerHTML = svg;

            // Apply current zoom
            this.applyZoom();

            this.hideLoading();
            return true;
        } catch (error) {
            console.error('Mermaid render error:', error);
            this.hideLoading();
            
            // Parse error for line number
            const errorInfo = this.parseError(error, content);
            
            element.innerHTML = `
                <div class="error">
                    <strong>Diagram Error:</strong><br>
                    ${this.escapeHtml(errorInfo.message || 'Failed to render diagram')}
                    ${errorInfo.line ? `<br><small>Line ${errorInfo.line}</small>` : ''}
                </div>
            `;

            // Show error panel
            this.showErrorPanel([errorInfo]);

            return false;
        }
    }

    /**
     * Parse Mermaid error for line number
     * @param {Error} error 
     * @param {string} content 
     * @returns {Object}
     */
    parseError(error, content) {
        const message = error.message || error.toString();
        let line = null;

        // Try to extract line number from error message
        const lineMatch = message.match(/line\s+(\d+)/i) || 
                          message.match(/at\s+line\s+(\d+)/i) ||
                          message.match(/\((\d+):\d+\)/);
        
        if (lineMatch) {
            line = parseInt(lineMatch[1], 10);
        }

        return {
            message: message,
            line: line,
            content: content
        };
    }

    /**
     * Show error panel with inline indicators
     * @param {Array} errors 
     */
    showErrorPanel(errors) {
        // Create error panel if not exists
        let panel = document.querySelector('.diagram-error-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'diagram-error-panel';
            document.querySelector('.diagram-canvas-container')?.appendChild(panel);
        }

        panel.innerHTML = errors.map(err => `
            <div class="diagram-error-item">
                ${err.line ? `<span class="diagram-error-line">Line ${err.line}</span>` : ''}
                <span>${this.escapeHtml(err.message)}</span>
            </div>
        `).join('');

        panel.classList.remove('hidden');
    }

    /**
     * Clear error panel
     */
    clearErrorPanel() {
        const panel = document.querySelector('.diagram-error-panel');
        if (panel) {
            panel.remove();
        }
    }

    /**
     * Validate Mermaid syntax
     * @param {string} content 
     * @returns {Object}
     */
    validateSyntax(content) {
        const validTypes = [
            'graph', 'flowchart', 'sequenceDiagram', 'classDiagram',
            'stateDiagram', 'stateDiagram-v2', 'erDiagram', 'journey',
            'gantt', 'pie', 'requirementDiagram', 'gitgraph',
            'C4Context', 'C4Container', 'C4Component', 'C4Dynamic',
            'C4Deployment', 'mindmap', 'timeline'
        ];

        const trimmed = content.trim();
        const firstLine = trimmed.split('\n')[0].trim().toLowerCase();

        const detectedType = validTypes.find(type => 
            firstLine.startsWith(type.toLowerCase())
        );

        const errors = [];
        if (!detectedType) {
            errors.push({
                line: 1,
                message: 'Invalid diagram type. Must start with a valid type like graph, flowchart, sequenceDiagram, etc.'
            });
        }

        return {
            isValid: detectedType !== undefined,
            type: detectedType,
            errors: errors
        };
    }

    /**
     * Detect diagram type from content
     * @param {string} content 
     * @returns {string}
     */
    detectType(content) {
        const result = this.validateSyntax(content);
        return result.type || 'unknown';
    }

    /**
     * Escape HTML entities
     * @param {string} text 
     * @returns {string}
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Update Mermaid theme
     * @param {string} theme - 'dark' or 'default'
     */
    updateTheme(theme) {
        if (typeof mermaid !== 'undefined') {
            mermaid.initialize({
                theme: theme === 'dark' ? 'dark' : 'default'
            });
        }
    }

    /**
     * Zoom in
     */
    zoomIn() {
        if (this.zoomLevel < this.maxZoom) {
            this.zoomLevel = Math.min(this.maxZoom, this.zoomLevel + this.zoomStep);
            this.applyZoom();
        }
    }

    /**
     * Zoom out
     */
    zoomOut() {
        if (this.zoomLevel > this.minZoom) {
            this.zoomLevel = Math.max(this.minZoom, this.zoomLevel - this.zoomStep);
            this.applyZoom();
        }
    }

    /**
     * Reset zoom
     */
    resetZoom() {
        this.zoomLevel = 1;
        this.applyZoom();
    }

    /**
     * Apply current zoom level to diagram
     */
    applyZoom() {
        const output = document.getElementById('diagram-output');
        const levelDisplay = document.getElementById('diagram-zoom-level');
        
        if (output) {
            output.style.transform = `scale(${this.zoomLevel})`;
        }
        
        if (levelDisplay) {
            levelDisplay.textContent = `${Math.round(this.zoomLevel * 100)}%`;
        }
    }

    /**
     * Get current zoom level
     * @returns {number}
     */
    getZoomLevel() {
        return this.zoomLevel;
    }

    getFileExtension() {
        return '.mmd';
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CanvasTypeManager, CanvasTypeHandler, CodeHandler, DocumentHandler, FrontendHandler, DiagramHandler };
}
