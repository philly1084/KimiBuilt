/**
 * UI Helpers for LillyBuilt AI Chat
 * Handles rendering, markdown parsing, code highlighting, and UI utilities
 */

class UIHelpers {
    constructor() {
        this.storageAvailable = this.checkStorageAvailability();
        this.messageContainer = document.getElementById('messages-container');
        this.sessionsList = document.getElementById('sessions-list');
        this.searchResults = [];
        this.currentSearchIndex = -1;
        this.setupMarked();
        this.ensureAssistantModelControls();
        this.setupEventListeners();
        
        // Image generation state
        this.imageGenerationState = {
            quality: 'standard',
            style: 'vivid',
            source: 'generate' // 'generate' or 'unsplash'
        };
        
        // Model selector state
        this.availableModels = [];
        this.availableImageModels = [];
        const savedModel = window.sessionManager?.safeStorageGet?.('kimibuilt_default_model');
        const savedReasoningEffort = window.sessionManager?.safeStorageGet?.('kimibuilt_reasoning_effort');
        const savedRemoteAutonomy = window.sessionManager?.safeStorageGet?.('kimibuilt_remote_build_autonomy');
        this.currentModel = savedModel || 'gpt-4o';
        this.currentReasoningEffort = this.normalizeReasoningEffort(savedReasoningEffort);
        this.remoteBuildAutonomyApproved = this.parseRemoteBuildAutonomyPreference(savedRemoteAutonomy);
        this.soundManager = window.WebChatSoundManager
            ? new window.WebChatSoundManager()
            : null;
        this.updateModelUI();
        this.updateReasoningUI();
        this.updateRemoteBuildAutonomyUI();
        this.updateSoundCuesUI();
        this.updateMenuSoundsUI();
        
        // Track last focused element for focus management
        this.lastFocusedElement = null;
        
        // Command palette navigation state
        this.commandPaletteState = {
            selectedIndex: 0,
            items: []
        };

        this.layoutPreferenceKey = 'webchat_layout_mode';
        this.layoutMode = 'full';
        
        // Setup draft saving
        this.setupDraftSaving();
        
        // Restore draft on load
        this.restoreDraft();
        
        // Setup code block scroll indicators
        this.setupCodeBlockScrollIndicators();

        if (typeof mermaid !== 'undefined') {
            mermaid.initialize({
                startOnLoad: false,
                securityLevel: 'loose',
                theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'default' : 'dark',
            });
        }
    }

    getGenericFilenameWords() {
        return new Set([
            'a', 'an', 'all', 'artifact', 'assistant', 'chat', 'conversation', 'copy',
            'default', 'diagram', 'document', 'download', 'export', 'file', 'final',
            'generated', 'generic', 'image', 'lillybuilt', 'latest', 'mermaid', 'new',
            'notes', 'output', 'page', 'pdf', 'report', 'response', 'result', 'session',
            'temp', 'test', 'text', 'tmp', 'untitled', 'web',
        ]);
    }

    getReservedFilenameBases() {
        return new Set([
            'con', 'prn', 'aux', 'nul',
            'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
            'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
        ]);
    }

    getPleasantFilenameParts() {
        return {
            adjectives: [
                'amber', 'autumn', 'bright', 'calm', 'clear', 'cobalt', 'crisp', 'dawn',
                'ember', 'gentle', 'golden', 'lively', 'lunar', 'maple', 'mellow', 'misty',
                'noble', 'orchid', 'quiet', 'silver', 'solar', 'steady', 'velvet', 'warm'
            ],
            nouns: [
                'atlas', 'bloom', 'bridge', 'canvas', 'compass', 'draft', 'field', 'garden',
                'harbor', 'horizon', 'journal', 'lantern', 'meadow', 'notebook', 'outline',
                'palette', 'path', 'pocket', 'report', 'sketch', 'story', 'studio', 'summit', 'trail'
            ],
        };
    }

    checkStorageAvailability() {
        if (window.__webChatStorageAvailable === false) {
            return false;
        }

        if (window.sessionManager?.storageAvailable != null) {
            return window.sessionManager.storageAvailable === true;
        }

        try {
            const key = '__webchat_ui_storage_test__';
            localStorage.setItem(key, '1');
            localStorage.removeItem(key);
            window.__webChatStorageAvailable = true;
            return true;
        } catch (_error) {
            window.__webChatStorageAvailable = false;
            return false;
        }
    }

    ensureAssistantModelControls() {
        if (document.getElementById('assistant-model-select')) {
            return;
        }

        const settings = document.querySelector('.model-selector-settings');
        if (!settings) {
            return;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'model-selector-setting';
        wrapper.innerHTML = `
            <label for="assistant-model-select" class="model-selector-setting__label">AI model</label>
            <select id="assistant-model-select" class="reasoning-select reasoning-select--panel assistant-model-select" title="AI model" aria-label="AI model">
                <option value="gpt-4o">GPT-4o</option>
            </select>
            <p class="model-selector-setting__hint">Choose the model for the next messages in this chat.</p>
        `;

        settings.insertBefore(wrapper, settings.firstElementChild || null);
    }

    storageGet(key) {
        if (window.sessionManager?.safeStorageGet) {
            return window.sessionManager.safeStorageGet(key);
        }
        if (!this.storageAvailable) return null;
        try {
            return localStorage.getItem(key);
        } catch (_error) {
            this.storageAvailable = false;
            return null;
        }
    }

    storageSet(key, value) {
        if (window.sessionManager?.safeStorageSet) {
            return window.sessionManager.safeStorageSet(key, value);
        }
        if (!this.storageAvailable) return false;
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (_error) {
            this.storageAvailable = false;
            return false;
        }
    }

    storageRemove(key) {
        if (window.sessionManager?.safeStorageRemove) {
            return window.sessionManager.safeStorageRemove(key);
        }
        if (!this.storageAvailable) return false;
        try {
            localStorage.removeItem(key);
            return true;
        } catch (_error) {
            this.storageAvailable = false;
            return false;
        }
    }

    generatePleasantFilenameBase() {
        const { adjectives, nouns } = this.getPleasantFilenameParts();
        const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        return `${adjective}-${noun}`;
    }

    slugifyFilenameBase(value, fallback = 'artifact') {
        const clean = String(value || fallback)
            .toLowerCase()
            .replace(/\.[a-z0-9]+$/i, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
        return clean || fallback;
    }

    createFriendlyFilenameBase(value, fallback = 'artifact') {
        const slug = this.slugifyFilenameBase(value, fallback);
        const tokens = slug.split('-').filter(Boolean);
        if (tokens.length === 0) {
            return this.generatePleasantFilenameBase();
        }

        const genericWords = this.getGenericFilenameWords();
        const meaningfulTokens = tokens.filter((token) => !genericWords.has(token));
        if (meaningfulTokens.length === 0) {
            return this.generatePleasantFilenameBase();
        }

        const candidate = meaningfulTokens.slice(0, 6).join('-') || this.generatePleasantFilenameBase();
        return this.getReservedFilenameBases().has(candidate) ? this.generatePleasantFilenameBase() : candidate;
    }

    sanitizeDownloadFilename(filename, fallbackBase = 'download', fallbackExtension = '') {
        const raw = String(filename || '').trim();
        const extensionMatch = raw.match(/(\.[a-z0-9]{1,10})$/i);
        const extension = extensionMatch ? extensionMatch[1].toLowerCase() : (fallbackExtension ? `.${String(fallbackExtension).replace(/^\./, '')}` : '');
        const base = raw.replace(/\.[a-z0-9]{1,10}$/i, '');
        const safeBase = this.createFriendlyFilenameBase(base || fallbackBase, fallbackBase);
        const truncatedBase = safeBase.slice(0, 80).replace(/-+$/g, '') || this.createFriendlyFilenameBase(fallbackBase, fallbackBase);
        return `${truncatedBase}${extension}`;
    }

    createShortUniqueSuffix(length = 6) {
        const random = Math.random().toString(36).slice(2);
        return (random || Date.now().toString(36)).slice(0, Math.max(4, length));
    }

    createUniqueFilename(value, extension = '', fallback = 'artifact') {
        const safeExtension = extension ? `.${String(extension).replace(/^\./, '').toLowerCase()}` : '';
        const safeBase = this.createFriendlyFilenameBase(value || fallback, fallback);
        return this.sanitizeDownloadFilename(`${safeBase}-${this.createShortUniqueSuffix()}${safeExtension}`, fallback, extension);
    }

    createFriendlyFilenameBaseFromMermaid(source, fallback = 'diagram') {
        const text = this.normalizeMermaidSource(source || '');
        const labelMatches = Array.from(text.matchAll(/\[(.*?)\]|\((.*?)\)|"(.*?)"/g))
            .map((match) => match[1] || match[2] || match[3] || '')
            .map((label) => label.trim())
            .filter(Boolean);

        if (labelMatches.length > 0) {
            return this.createFriendlyFilenameBase(labelMatches[0], fallback);
        }

        const words = text
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(Boolean)
            .filter((word) => !new Set([
                'flowchart', 'graph', 'sequence', 'sequencediagram', 'classdiagram', 'erdiagram',
                'statediagram', 'gantt', 'pie', 'mindmap', 'gitgraph', 'td', 'lr', 'tb', 'bt',
                'subgraph', 'end', 'style', 'classdef', 'click', 'section', 'participant', 'actor',
                'note', 'title'
            ]).has(word));

        if (words.length > 0) {
            return this.createFriendlyFilenameBase(words.slice(0, 4).join(' '), fallback);
        }

        return this.generatePleasantFilenameBase();
    }

    // ============================================
    // Markdown Setup
    // ============================================

    setupMarked() {
        marked.setOptions({
            breaks: true,
            gfm: true,
            headerIds: false,
            mangle: false,
            sanitize: false // We use DOMPurify instead
        });

        // Custom renderer for code blocks
        const renderer = new marked.Renderer();

        const normalizeMarkedText = (value) => {
            if (typeof value === 'string') return value;
            if (value && typeof value === 'object') {
                if (typeof value.text === 'string') return value.text;
                if (typeof value.raw === 'string') return value.raw;
            }
            return value == null ? '' : String(value);
        };

        const normalizeMarkedLang = (value, fallback = 'text') => {
            if (typeof value === 'string') return value || fallback;
            if (value && typeof value === 'object') {
                if (typeof value.lang === 'string') return value.lang || fallback;
                if (typeof value.language === 'string') return value.language || fallback;
            }
            return fallback;
        };

        const normalizeMarkedLinkArgs = (href, title, text) => {
            if (href && typeof href === 'object' && !Array.isArray(href)) {
                return {
                    href: typeof href.href === 'string' ? href.href : '',
                    title: typeof href.title === 'string' ? href.title : title,
                    text: typeof href.text === 'string'
                        ? href.text
                        : (typeof href.raw === 'string' ? href.raw : text),
                };
            }

            return {
                href: typeof href === 'string' ? href : '',
                title,
                text,
            };
        };

        const deriveLinkLabel = (href, title, text) => {
            const normalizedText = normalizeMarkedText(text).trim();
            const plainText = normalizedText.replace(/<[^>]*>/g, '').trim();
            if (plainText && plainText.toLowerCase() !== 'undefined') {
                return this.escapeHtml(normalizedText);
            }

            const normalizedTitle = normalizeMarkedText(title).trim();
            if (normalizedTitle && normalizedTitle.toLowerCase() !== 'undefined') {
                return this.escapeHtml(normalizedTitle);
            }

            try {
                const url = new URL(String(href || ''), window.location.origin);
                const host = url.hostname.replace(/^www\./i, '');
                const path = url.pathname && url.pathname !== '/' ? url.pathname : '';
                return this.escapeHtml(`${host}${path}`);
            } catch (_error) {
                return this.escapeHtml(normalizedText || normalizedTitle || String(href || 'link'));
            }
        };
        
        renderer.code = (code, language) => {
            const normalizedCode = normalizeMarkedText(code);
            const lang = normalizeMarkedLang(language);
            const normalizedLang = lang.toLowerCase();

            if (normalizedLang === 'mermaid') {
                const mermaidSource = this.normalizeMermaidSource(normalizedCode);
                const escapedCode = this.escapeHtml(mermaidSource);
                const escapedAttrCode = this.escapeHtmlAttr(mermaidSource);
                const filenameBase = this.createFriendlyFilenameBaseFromMermaid(mermaidSource, 'diagram');

                return `
                    <div class="code-block mermaid-code-block">
                        <div class="code-header">
                            <span class="code-language">mermaid</span>
                            <div class="code-actions">
                                <button class="code-copy-btn" onclick="uiHelpers.copyCode(this)" data-code="${escapedAttrCode}" aria-label="Copy Mermaid code">
                                    <i data-lucide="copy" class="w-3.5 h-3.5" aria-hidden="true"></i>
                                    <span>Copy</span>
                                </button>
                                <button class="code-copy-btn" onclick="uiHelpers.downloadMermaidSource(this)" data-code="${escapedAttrCode}" data-filename="${filenameBase}.mmd" aria-label="Download Mermaid source">
                                    <i data-lucide="file-code" class="w-3.5 h-3.5" aria-hidden="true"></i>
                                    <span>.mmd</span>
                                </button>
                                <button class="code-copy-btn" onclick="uiHelpers.downloadMermaidPdf(this)" data-code="${escapedAttrCode}" data-filename="${filenameBase}.pdf" aria-label="Download Mermaid PDF">
                                    <i data-lucide="file-text" class="w-3.5 h-3.5" aria-hidden="true"></i>
                                    <span>PDF</span>
                                </button>
                            </div>
                        </div>
                        <pre class="mermaid-source-block"><code class="language-mermaid no-highlight">${escapedCode}</code></pre>
                        <div class="mermaid-visual-wrapper">
                            <div class="mermaid-render-surface" data-mermaid-source="${escapedAttrCode}" data-mermaid-filename="${filenameBase}">
                                <div class="mermaid-placeholder">Rendering diagram...</div>
                            </div>
                        </div>
                    </div>
                `;
            }

            const escapedCode = this.escapeHtml(normalizedCode);
            const prismLang = this.getPrismLanguage(lang);
            const lineCount = normalizedCode.split('\n').length;
            
            // Generate line numbers for code blocks with more than 3 lines
            let lineNumbersHtml = '';
            if (lineCount > 3) {
                lineNumbersHtml = `<div class="line-numbers-rows">${
                    Array(lineCount).fill(0).map((_, i) => `<span></span>`).join('')
                }</div>`;
            }
            
            return `
                <div class="code-block ${lineCount > 3 ? 'line-numbers' : ''}">
                    <div class="code-header">
                        <span class="code-language">${lang}</span>
                        <div class="code-actions">
                            <button class="code-copy-btn" onclick="uiHelpers.copyCode(this)" data-code="${this.escapeHtmlAttr(normalizedCode)}" aria-label="Copy code to clipboard">
                                <i data-lucide="copy" class="w-3.5 h-3.5" aria-hidden="true"></i>
                                <span>Copy</span>
                            </button>
                        </div>
                    </div>
                    ${lineNumbersHtml}
                    <pre class="language-${prismLang}"><code class="language-${prismLang}">${escapedCode}</code></pre>
                </div>
            `;
        };

        renderer.codespan = (code) => {
            return `<code>${this.escapeHtml(normalizeMarkedText(code))}</code>`;
        };

        renderer.link = (href, title, text) => {
            const normalizedLink = normalizeMarkedLinkArgs(href, title, text);
            const safeHref = this.escapeHtmlAttr(normalizedLink.href || '#');
            const normalizedTitle = normalizeMarkedText(normalizedLink.title).trim();
            const titleAttr = normalizedTitle ? ` title="${this.escapeHtmlAttr(normalizedTitle)}"` : '';
            return `<a href="${safeHref}"${titleAttr} target="_blank" rel="noopener noreferrer nofollow">${deriveLinkLabel(
                normalizedLink.href,
                normalizedLink.title,
                normalizedLink.text,
            )}</a>`;
        };

        renderer.checkbox = (checked) => {
            return `<input type="checkbox" ${checked ? 'checked' : ''} disabled> `;
        };

        marked.use({ renderer });
    }

    getPrismLanguage(lang) {
        const languageMap = {
            'js': 'javascript',
            'ts': 'typescript',
            'py': 'python',
            'sh': 'bash',
            'shell': 'bash',
            'zsh': 'bash',
            'bash': 'bash',
            'yml': 'yaml',
            'yaml': 'yaml',
            'json': 'json',
            'html': 'markup',
            'xml': 'markup',
            'svg': 'markup',
            'jsx': 'jsx',
            'tsx': 'tsx',
            'rs': 'rust',
            'rust': 'rust',
            'go': 'go',
            'golang': 'go',
            'java': 'java',
            'c': 'c',
            'cpp': 'cpp',
            'c++': 'cpp',
            'cs': 'csharp',
            'csharp': 'csharp',
            'rb': 'ruby',
            'ruby': 'ruby',
            'php': 'php',
            'docker': 'docker',
            'dockerfile': 'docker',
            'md': 'markdown',
            'markdown': 'markdown',
            'sql': 'sql',
            'psql': 'sql',
            'mysql': 'sql',
            'postgres': 'sql'
        };
        return languageMap[lang?.toLowerCase()] || lang || 'text';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    escapeHtmlAttr(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    escapeRegExp(text) {
        return String(text == null ? '' : text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ============================================
    // Message Rendering
    // ============================================

    normalizeJsonLikeText(value = '') {
        return String(value || '')
            .replace(/^\uFEFF/, '')
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/[\u2018\u2019]/g, '\'')
            .replace(/\u00A0/g, ' ')
            .trim();
    }

    unwrapJsonLikeCodeFence(value = '') {
        const normalized = this.normalizeJsonLikeText(value);
        const match = normalized.match(/^```(?:json|survey|kb-survey)?\s*([\s\S]*?)\s*```$/i);
        return match ? match[1].trim() : normalized;
    }

    extractJsonLikeSegment(value = '') {
        const source = this.unwrapJsonLikeCodeFence(value);
        const objectStart = source.indexOf('{');
        const arrayStart = source.indexOf('[');
        const starts = [objectStart, arrayStart].filter((index) => index >= 0);

        if (starts.length === 0) {
            return source;
        }

        const start = Math.min(...starts);
        if (objectStart < 0 && arrayStart >= 0) {
            const prefix = source.slice(0, arrayStart).trim();
            if (/[A-Za-z_][A-Za-z0-9_-]*\s*:/.test(prefix)) {
                return source;
            }
        }

        const stack = [];
        let quote = null;
        let escaped = false;

        for (let index = start; index < source.length; index += 1) {
            const char = source[index];

            if (quote) {
                if (escaped) {
                    escaped = false;
                    continue;
                }

                if (char === '\\') {
                    escaped = true;
                    continue;
                }

                if (char === quote) {
                    quote = null;
                }

                continue;
            }

            if (char === '"' || char === '\'') {
                quote = char;
                continue;
            }

            if (char === '{' || char === '[') {
                stack.push(char);
                continue;
            }

            if (char === '}' || char === ']') {
                const expectedOpening = char === '}' ? '{' : '[';
                if (stack[stack.length - 1] === expectedOpening) {
                    stack.pop();
                }

                if (stack.length === 0) {
                    return source.slice(start, index + 1).trim();
                }
            }
        }

        return source.slice(start).trim();
    }

    repairJsonLikeString(value = '') {
        const wrapped = this.wrapBareJsonLikeObject(String(value || '')
            .split('\n')
            .map((line) => line.replace(/^\s*\/\/.*$/g, ''))
            .join('\n'));

        return wrapped
            .replace(/(^|[{,]\s*)'([^'\\]*(?:\\.[^'\\]*)*)'(\s*:)/gm, '$1"$2"$3')
            .replace(/(^|[{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/gm, '$1"$2"$3')
            .replace(/([:\[,]\s*)'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, prefix, entry) => `${prefix}"${String(entry || '').replace(/\\'/g, '\'').replace(/"/g, '\\"')}"`)
            .replace(/\bNone\b/g, 'null')
            .replace(/\bTrue\b/g, 'true')
            .replace(/\bFalse\b/g, 'false')
            .replace(/\bundefined\b/g, 'null')
            .replace(/,\s*([}\]])/g, '$1')
            .replace(/;\s*$/g, '')
            .trim();
    }

    wrapBareJsonLikeObject(value = '') {
        const trimmed = String(value || '').trim();
        if (!trimmed || /^[{\[]/.test(trimmed)) {
            return trimmed;
        }

        return /^[A-Za-z_][A-Za-z0-9_-]*\s*:/.test(trimmed)
            ? `{${trimmed}}`
            : trimmed;
    }

    parseJsonSafely(value = '') {
        const tryParse = (candidate) => {
            if (!candidate) {
                return null;
            }

            try {
                return JSON.parse(candidate);
            } catch (_error) {
                return null;
            }
        };

        const direct = tryParse(this.unwrapJsonLikeCodeFence(value));
        if (direct !== null) {
            return direct;
        }

        const extracted = this.extractJsonLikeSegment(value);
        const extractedParsed = tryParse(extracted);
        if (extractedParsed !== null) {
            return extractedParsed;
        }

        const repaired = this.repairJsonLikeString(extracted);
        return tryParse(repaired) || tryParse(this.wrapBareJsonLikeObject(repaired));
    }

    normalizeSurveyOption(option = {}, index = 0) {
        if (!option || typeof option !== 'object') {
            return null;
        }

        const label = String(option.label || option.title || option.text || `Option ${index + 1}`).trim();
        if (!label) {
            return null;
        }

        const id = String(option.id || option.value || label)
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || `option-${index + 1}`;
        const description = String(option.description || option.details || option.hint || '').trim();

        return {
            id,
            label,
            ...(description ? { description } : {}),
        };
    }

    resolveSurveyAllowFreeText(value = null) {
        if (!value || typeof value !== 'object') {
            return true;
        }

        if (value.allowFreeText === false || value.allowText === false) {
            return false;
        }

        if (value.allowFreeText === true || value.allowText === true) {
            return true;
        }

        return true;
    }

    normalizeSurveyInputType(value = '', { hasOptions = false, allowMultiple = false } = {}) {
        const normalized = String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[_\s]+/g, '-');

        if (['multi-choice', 'multiple-choice', 'multi', 'checkbox', 'checkboxes'].includes(normalized)) {
            return 'multi-choice';
        }

        if (['choice', 'single-choice', 'select', 'radio', 'options'].includes(normalized)) {
            return 'choice';
        }

        if (['text', 'textarea', 'open-ended', 'open', 'free-text'].includes(normalized)) {
            return 'text';
        }

        if (['date', 'day'].includes(normalized)) {
            return 'date';
        }

        if (['time', 'clock'].includes(normalized)) {
            return 'time';
        }

        if (['datetime', 'date-time', 'datetime-local', 'timestamp', 'schedule'].includes(normalized)) {
            return 'datetime';
        }

        if (hasOptions) {
            return allowMultiple ? 'multi-choice' : 'choice';
        }

        return 'text';
    }

    normalizeSurveyStep(step = {}, index = 0) {
        if (!step || typeof step !== 'object') {
            return null;
        }

        const question = String(step.question || step.prompt || step.ask || '').trim();
        if (!question) {
            return null;
        }

        const options = (Array.isArray(step.options)
            ? step.options
            : (Array.isArray(step.choices) ? step.choices : []))
            .map((option, optionIndex) => this.normalizeSurveyOption(option, optionIndex))
            .filter(Boolean)
            .slice(0, 5);
        const allowMultiple = step.allowMultiple === true || step.multiple === true;
        const inputType = this.normalizeSurveyInputType(step.inputType || step.type || step.kind || '', {
            hasOptions: options.length > 0,
            allowMultiple,
        });
        const isChoiceInput = inputType === 'choice' || inputType === 'multi-choice';

        if (isChoiceInput && options.length < 2) {
            return null;
        }

        const title = String(step.title || '').trim();
        const placeholder = String(step.placeholder || step.inputPlaceholder || step.freeTextPlaceholder || '').trim();
        const allowFreeText = isChoiceInput ? this.resolveSurveyAllowFreeText(step) : false;

        return {
            id: String(step.id || `step-${index + 1}`).trim(),
            ...(title ? { title } : {}),
            question,
            inputType,
            required: step.required !== false,
            ...(placeholder ? { placeholder } : {}),
            ...(isChoiceInput
                ? {
                    options,
                    allowMultiple: inputType === 'multi-choice',
                    maxSelections: inputType === 'multi-choice'
                        ? Math.min(options.length, Math.max(1, Number(step.maxSelections) || Math.min(2, options.length)))
                        : 1,
                    allowFreeText,
                    ...(allowFreeText
                        ? {
                            freeTextLabel: String(step.freeTextLabel || step.freeTextPrompt || 'Add your own input (optional)').trim() || 'Add your own input (optional)',
                        }
                        : {}),
                }
                : {}),
        };
    }

    normalizeSurveySteps(value = null) {
        if (!value || typeof value !== 'object') {
            return [];
        }

        const rawSteps = Array.isArray(value.steps)
            ? value.steps
            : (Array.isArray(value.questions) ? value.questions : []);
        const legacyStep = rawSteps.length === 0
            ? this.normalizeSurveyStep({
                ...value,
                options: value.options || value.choices,
            }, 0)
            : null;

        return rawSteps.length > 0
            ? rawSteps
                .map((step, index) => this.normalizeSurveyStep(step, index))
                .filter(Boolean)
                .slice(0, 6)
            : (legacyStep ? [legacyStep] : []);
    }

    buildLegacySurveyFields(steps = []) {
        const firstStep = Array.isArray(steps) ? steps[0] : null;
        if (!firstStep) {
            return {};
        }

        return {
            question: firstStep.question,
            options: Array.isArray(firstStep.options) ? firstStep.options : [],
            allowMultiple: firstStep.allowMultiple === true,
            maxSelections: Number(firstStep.maxSelections || 1) > 0 ? Number(firstStep.maxSelections || 1) : 1,
            allowFreeText: firstStep.allowFreeText === true,
            ...(firstStep.allowFreeText ? { freeTextLabel: firstStep.freeTextLabel || 'Add your own input (optional)' } : {}),
            inputType: firstStep.inputType || 'choice',
            ...(firstStep.placeholder ? { placeholder: firstStep.placeholder } : {}),
        };
    }

    normalizeSurveyDefinition(value = null, fallbackId = '') {
        if (!value || typeof value !== 'object') {
            return null;
        }

        const steps = this.normalizeSurveySteps(value);
        if (steps.length === 0) {
            return null;
        }

        return {
            id: String(value.id || fallbackId || `survey-${Date.now().toString(36)}`).trim(),
            title: String(value.title || 'Choose a direction').trim() || 'Choose a direction',
            whyThisMatters: String(value.whyThisMatters || value.context || value.rationale || '').trim(),
            steps,
            ...this.buildLegacySurveyFields(steps),
        };
    }

    cleanPlainSurveyText(value = '') {
        return String(value || '')
            .replace(/^#+\s*/, '')
            .replace(/^>\s*/, '')
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/__(.*?)__/g, '$1')
            .replace(/`([^`]+)`/g, '$1')
            .trim();
    }

    normalizePlainSurveySource(value = '') {
        return String(value || '')
            .replace(/\r\n/g, '\n')
            .replace(/\s+(Question\s+\d+\s*:)/gi, '\n$1')
            .replace(/\s+([A-E](?:[.)]|:)\s+)/g, '\n$1')
            .replace(/\s+(Reply\s+(?:with|like)\b[\s\S]*$)/i, '\n$1')
            .replace(/\s+(If you(?:[’']|â€™)d like\b[\s\S]*$)/i, '\n$1')
            .trim();
    }

    stripSurveyQuestionPrefix(value = '') {
        return this.cleanPlainSurveyText(value)
            .replace(/^question\s+\d+\s*:\s*/i, '')
            .trim();
    }

    isSurveyWrapperLine(value = '') {
        const normalized = this.cleanPlainSurveyText(value).toLowerCase();
        if (!normalized) {
            return true;
        }

        return /^(yes|yeah|yep|sure|ok|okay|absolutely|certainly|of course|no problem)[.!]?$/.test(normalized)
            || /^reply (?:with|like)\b/.test(normalized)
            || /^if you'd like\b/.test(normalized)
            || /\bone question at a time\b/.test(normalized);
    }

    normalizePlainSurveyOption(line = '', index = 0) {
        const match = String(line || '').match(/^(?:[-*•]\s+|(?:option\s+)?(?:\d+|[A-Ea-e])[.):]\s+)(.+)$/);
        if (!match?.[1]) {
            return null;
        }

        const raw = this.cleanPlainSurveyText(match[1]);
        if (!raw) {
            return null;
        }

        const splitMatch = raw.match(/^(.+?)(?:\s*:\s+|\s+[—-]\s+)(.+)$/);
        const label = this.cleanPlainSurveyText(splitMatch?.[1] || raw);
        const description = this.cleanPlainSurveyText(splitMatch?.[2] || '');

        return this.normalizeSurveyOption({
            id: `option-${index + 1}`,
            label,
            ...(description ? { description } : {}),
        }, index);
    }

    extractPlainSurveyDefinition(content = '', fallbackId = '') {
        const source = this.normalizePlainSurveySource(content);
        if (!source || /```(?:survey|kb-survey)/i.test(source)) {
            return null;
        }

        const rawLines = source.split('\n');
        let bestRun = [];
        let currentRun = [];

        rawLines.forEach((line, index) => {
            const option = this.normalizePlainSurveyOption(line.trim(), currentRun.length);
            if (option) {
                currentRun.push({ index, option });
                return;
            }

            if (currentRun.length >= 2 && bestRun.length === 0) {
                bestRun = [...currentRun];
            }
            currentRun = [];
        });

        if (bestRun.length === 0 && currentRun.length >= 2) {
            bestRun = [...currentRun];
        }

        if (bestRun.length < 2 || bestRun.length > 5) {
            return null;
        }

        const preLines = rawLines
            .slice(0, bestRun[0].index)
            .map((line) => this.cleanPlainSurveyText(line))
            .filter(Boolean);
        if (preLines.length === 0) {
            return null;
        }

        const meaningfulPreLines = preLines.filter((line) => !this.isSurveyWrapperLine(line));
        const questionLine = meaningfulPreLines[meaningfulPreLines.length - 1] || preLines[preLines.length - 1];
        const question = this.stripSurveyQuestionPrefix(String(questionLine || '').replace(/[:\s]+$/, ''));
        const promptContext = preLines.join(' ');
        if (!question) {
            return null;
        }

        const looksLikeChoicePrompt = /\?$/.test(question)
            || /\b(choose|select|pick|prefer|decision|direction|option|path|approach|should i|which|what should i do)\b/i.test(promptContext);
        if (!looksLikeChoicePrompt) {
            return null;
        }

        const contextCandidates = meaningfulPreLines.slice(0, -1);
        const titleCandidate = contextCandidates.length > 0
            ? this.cleanPlainSurveyText(contextCandidates[0].replace(/[:\s]+$/, ''))
            : '';
        const title = titleCandidate && titleCandidate !== question && titleCandidate.length <= 72
            ? titleCandidate
            : 'Choose a direction';
        const contextLines = title === titleCandidate
            ? contextCandidates.slice(1)
            : contextCandidates;

        return this.normalizeSurveyDefinition({
            id: String(fallbackId || `survey-${Date.now().toString(36)}`).trim(),
            title,
            question,
            whyThisMatters: contextLines.join(' ').trim(),
            options: bestRun.map((entry) => entry.option),
        });
    }

    extractSurveyDefinitionFromContent(content = '', fallbackId = '') {
        const source = String(content || '');
        const fencedMatch = source.match(/```(?:survey|kb-survey)\s*([\s\S]*?)```/i);
        if (fencedMatch?.[1]) {
            const parsed = this.parseJsonSafely(fencedMatch[1]);
            const normalized = this.normalizeSurveyDefinition(parsed, fallbackId);
            if (normalized) {
                return normalized;
            }
        }

        const parsed = this.parseJsonSafely(source);
        if (parsed) {
            const normalized = this.normalizeSurveyDefinition(parsed, fallbackId);
            if (normalized) {
                return normalized;
            }
        }

        return this.extractPlainSurveyDefinition(source, fallbackId);
    }

    buildSurveyAnsweredSummary(surveyState = {}, survey = null) {
        const explicitSummary = String(surveyState.summary || '').trim();
        if (explicitSummary) {
            return explicitSummary;
        }

        const stepResponses = surveyState?.stepResponses && typeof surveyState.stepResponses === 'object'
            ? surveyState.stepResponses
            : {};
        const stepSummaries = (Array.isArray(survey?.steps) ? survey.steps : [])
            .map((step) => this.buildSurveyStepAnswerSummary(step, stepResponses?.[step.id] || null))
            .filter(Boolean);
        if (stepSummaries.length > 0) {
            return stepSummaries.join(' | ');
        }

        const selectedLabels = Array.isArray(surveyState.selectedLabels)
            ? surveyState.selectedLabels.filter(Boolean)
            : [];
        const notes = String(surveyState.notes || '').trim();
        const parts = [];

        if (selectedLabels.length > 0) {
            parts.push(`Answered with ${selectedLabels.join(', ')}`);
        }

        if (notes) {
            parts.push(`Note: ${notes}`);
        }

        return parts.join('. ');
    }

    getSurveyCustomOption() {
        return {
            id: 'custom-input',
            label: 'Other',
            description: 'Type your own answer below.',
        };
    }

    buildRenderedSurveyOptions(step = {}) {
        const options = Array.isArray(step.options)
            ? step.options.map((option) => ({ ...option }))
            : [];
        if (!step.allowFreeText) {
            return options;
        }

        const customOption = this.getSurveyCustomOption();
        const hasExistingCustomOption = options.some((option) => (
            String(option?.id || '').trim() === customOption.id
            || String(option?.label || '').trim().toLowerCase() === customOption.label.toLowerCase()
        ));

        if (!hasExistingCustomOption) {
            options.push(customOption);
        }

        return options;
    }

    getSurveyStepAnswer(surveyState = {}, stepId = '') {
        if (!stepId) {
            return null;
        }

        return surveyState?.stepResponses && typeof surveyState.stepResponses === 'object'
            ? (surveyState.stepResponses[stepId] || null)
            : null;
    }

    getSurveyCurrentStepIndex(survey = {}, surveyState = {}) {
        const steps = Array.isArray(survey?.steps) ? survey.steps : [];
        if (steps.length === 0) {
            return 0;
        }

        const requestedIndex = Number(surveyState?.currentStepIndex || 0);
        if (!Number.isFinite(requestedIndex)) {
            return 0;
        }

        return Math.max(0, Math.min(steps.length - 1, Math.round(requestedIndex)));
    }

    buildSurveyStepAnswerSummary(step = {}, response = null) {
        if (!step || !response || typeof response !== 'object') {
            return '';
        }

        const selectedLabels = Array.isArray(response.selectedLabels)
            ? response.selectedLabels.filter(Boolean)
            : [];
        const text = String(response.text || response.value || '').trim();
        const answer = selectedLabels.length > 0
            ? [selectedLabels.join(', '), text].filter(Boolean).join(' | ')
            : text;

        if (!answer) {
            return '';
        }

        return `${String(step.question || 'Answer').trim()}: ${answer}`;
    }

    isSurveyStepComplete(step = {}, answer = null) {
        if (!step || typeof step !== 'object') {
            return false;
        }

        const inputType = String(step.inputType || 'choice').trim();
        const required = step.required !== false;
        const response = answer && typeof answer === 'object' ? answer : {};

        if (inputType === 'choice' || inputType === 'multi-choice') {
            const selectedOptionIds = Array.isArray(response.selectedOptionIds)
                ? response.selectedOptionIds.filter(Boolean)
                : [];
            const selectedLabels = Array.isArray(response.selectedLabels)
                ? response.selectedLabels.filter(Boolean)
                : [];
            const notes = String(response.text || '').trim();
            const selectedCount = Math.max(selectedOptionIds.length, selectedLabels.length);
            const customSelected = selectedOptionIds.includes(this.getSurveyCustomOption().id)
                || selectedLabels.includes(this.getSurveyCustomOption().label);

            if (!required && selectedCount === 0 && !notes) {
                return true;
            }

            if (selectedCount === 0) {
                return false;
            }

            return !(customSelected && selectedCount === 1 && !notes);
        }

        const value = String(response.value || response.text || '').trim();
        return required ? Boolean(value) : true;
    }

    updateSurveySubmitState(card) {
        if (!card) {
            return;
        }

        const submitButton = card.querySelector('.agent-survey-card__submit');
        const inputType = String(card.dataset.stepInputType || 'choice').trim();
        const required = card.dataset.stepRequired !== 'false';
        let canSubmit = false;

        if (inputType === 'choice' || inputType === 'multi-choice') {
            const allOptions = Array.from(card.querySelectorAll('.agent-survey-option'));
            const selectedOptions = allOptions.filter((entry) => entry.classList.contains('is-selected'));
            const notes = String(card.querySelector('.agent-survey-card__notes')?.value || '').trim();
            const customOptionId = this.getSurveyCustomOption().id;
            const customSelected = selectedOptions.some((entry) => String(entry.dataset.optionId || '').trim() === customOptionId);
            const hasSelection = selectedOptions.length > 0;
            const customNeedsNotes = customSelected && selectedOptions.length === 1 && !notes;
            canSubmit = required ? (hasSelection && !customNeedsNotes) : (!customNeedsNotes);
        } else {
            const value = String(card.querySelector('.agent-survey-card__input')?.value || '').trim();
            canSubmit = required ? Boolean(value) : true;
        }

        if (submitButton) {
            submitButton.disabled = !canSubmit;
        }
    }

    renderSurveyStepInput(step = {}, stepAnswer = {}, isAnswered = false) {
        const inputType = String(step.inputType || 'choice').trim();

        if (inputType === 'choice' || inputType === 'multi-choice') {
            const selectedOptionIds = new Set(Array.isArray(stepAnswer?.selectedOptionIds) ? stepAnswer.selectedOptionIds : []);
            const renderedOptions = this.buildRenderedSurveyOptions(step);
            const optionsHtml = renderedOptions.map((option) => {
                const selected = selectedOptionIds.has(option.id);
                return [
                    `<button type="button" class="agent-survey-option ${selected ? 'is-selected' : ''}"`,
                    ` data-option-id="${this.escapeHtmlAttr(option.id)}"`,
                    ` data-option-label="${this.escapeHtmlAttr(option.label)}"`,
                    ' onclick="uiHelpers.toggleSurveyOption(this)"',
                    isAnswered ? ' disabled' : '',
                    ` aria-checked="${selected ? 'true' : 'false'}">`,
                    `<span class="agent-survey-option__title">${this.escapeHtml(option.label)}</span>`,
                    option.description ? `<span class="agent-survey-option__description">${this.escapeHtml(option.description)}</span>` : '',
                    '</button>',
                ].join('');
            }).join('');

            return [
                `<div class="agent-survey-card__options">${optionsHtml}</div>`,
                step.allowFreeText
                    ? [
                        '<label class="agent-survey-card__notes-label">',
                        `<span>${this.escapeHtml(step.freeTextLabel || 'Add your own input (optional)')}</span>`,
                        `<textarea class="agent-survey-card__notes" rows="3" maxlength="500" placeholder="Type your own answer or extra context for the agent" oninput="uiHelpers.syncSurveyFreeText(this)" ${isAnswered ? 'disabled' : ''}>${this.escapeHtml(stepAnswer?.text || '')}</textarea>`,
                        '</label>',
                    ].join('')
                    : '',
            ].filter(Boolean).join('');
        }

        const inputTypeMap = {
            text: 'text',
            date: 'date',
            time: 'time',
            datetime: 'datetime-local',
        };
        const htmlInputType = inputTypeMap[inputType] || 'text';
        const value = String(stepAnswer?.value || stepAnswer?.text || '').trim();
        const placeholder = String(step.placeholder || (inputType === 'text'
            ? 'Type your answer for the agent'
            : '')).trim();

        if (inputType === 'text') {
            return [
                '<label class="agent-survey-card__input-label">',
                `<span>${this.escapeHtml(placeholder || 'Your answer')}</span>`,
                `<textarea class="agent-survey-card__input agent-survey-card__input--text" rows="4" maxlength="800" placeholder="${this.escapeHtmlAttr(placeholder || 'Type your answer for the agent')}" oninput="uiHelpers.syncSurveyInputValue(this)" ${isAnswered ? 'disabled' : ''}>${this.escapeHtml(value)}</textarea>`,
                '</label>',
            ].join('');
        }

        return [
            '<label class="agent-survey-card__input-label">',
            `<span>${this.escapeHtml(placeholder || 'Your answer')}</span>`,
            `<input class="agent-survey-card__input" type="${this.escapeHtmlAttr(htmlInputType)}" value="${this.escapeHtmlAttr(value)}" oninput="uiHelpers.syncSurveyInputValue(this)" ${isAnswered ? 'disabled' : ''}>`,
            '</label>',
        ].join('');
    }

    renderSurveyBlock(survey = null, message = {}) {
        if (!survey) {
            return '';
        }

        const messageId = String(message.id || '').trim();
        const surveyState = message?.surveyState?.checkpointId === survey.id
            ? message.surveyState
            : null;
        const isAnswered = surveyState?.status === 'answered';
        const answeredSummary = isAnswered
            ? this.buildSurveyAnsweredSummary(surveyState, survey)
            : '';
        const steps = Array.isArray(survey.steps) ? survey.steps : [];
        const currentStepIndex = isAnswered ? 0 : this.getSurveyCurrentStepIndex(survey, surveyState);
        const currentStep = steps[currentStepIndex] || steps[0] || null;
        const stepAnswer = currentStep
            ? this.getSurveyStepAnswer(surveyState, currentStep.id)
            : null;
        const isLastStep = currentStepIndex >= Math.max(0, steps.length - 1);
        const selectionHint = !currentStep
            ? ''
            : (currentStep.inputType === 'multi-choice'
                ? `Choose up to ${currentStep.maxSelections}`
                : (currentStep.inputType === 'choice'
                    ? 'Choose one option'
                    : (currentStep.inputType === 'text'
                        ? 'Type your answer'
                        : `Pick a ${currentStep.inputType === 'datetime' ? 'date and time' : currentStep.inputType}`)));
        const progressLabel = isAnswered
            ? (steps.length > 1 ? `Completed ${steps.length} steps` : 'Answered')
            : (steps.length > 1
                ? `Step ${currentStepIndex + 1} of ${steps.length}`
                : selectionHint);
        const stepInputHtml = (!isAnswered && currentStep)
            ? this.renderSurveyStepInput(currentStep, stepAnswer, false)
            : '';
        const canSubmitCurrentStep = currentStep
            ? this.isSurveyStepComplete(currentStep, stepAnswer)
            : false;
        const submitLabel = isLastStep
            ? 'Continue with these answers'
            : 'Next question';

        return [
            `<div class="agent-survey-card ${isAnswered ? 'is-answered' : ''}"`,
            ` data-message-id="${this.escapeHtmlAttr(messageId)}"`,
            ` data-survey-id="${this.escapeHtmlAttr(survey.id)}"`,
            ` data-current-step-index="${String(currentStepIndex)}"`,
            ` data-step-id="${this.escapeHtmlAttr(currentStep?.id || '')}"`,
            ` data-step-input-type="${this.escapeHtmlAttr(currentStep?.inputType || 'choice')}"`,
            ` data-step-required="${currentStep?.required === false ? 'false' : 'true'}"`,
            ` data-step-allow-multiple="${currentStep?.allowMultiple === true ? 'true' : 'false'}"`,
            ` data-step-max-selections="${String(currentStep?.maxSelections || 1)}"`,
            ` data-submitted="${isAnswered ? 'true' : 'false'}">`,
            '<div class="agent-survey-card__eyebrow">Decision checkpoint</div>',
            '<div class="agent-survey-card__title-row">',
            `<h4 class="agent-survey-card__title">${this.escapeHtml(survey.title)}</h4>`,
            `<span class="agent-survey-card__meta">${this.escapeHtml(progressLabel)}</span>`,
            '</div>',
            steps.length > 1
                ? [
                    '<div class="agent-survey-card__progress">',
                    `<span class="agent-survey-card__progress-text">${this.escapeHtml(progressLabel)}</span>`,
                    `<div class="agent-survey-card__progress-bar"><span style="width:${isAnswered ? 100 : Math.max(8, ((currentStepIndex + 1) / steps.length) * 100)}%"></span></div>`,
                    '</div>',
                ].join('')
                : '',
            (!isAnswered && currentStep?.title) ? `<p class="agent-survey-card__step-title">${this.escapeHtml(currentStep.title)}</p>` : '',
            !isAnswered ? `<p class="agent-survey-card__question">${this.escapeHtml(currentStep?.question || survey.question)}</p>` : '',
            survey.whyThisMatters ? `<p class="agent-survey-card__context">${this.escapeHtml(survey.whyThisMatters)}</p>` : '',
            stepInputHtml,
            '<div class="agent-survey-card__footer">',
            isAnswered
                ? [
                    '<div class="agent-survey-card__answered">',
                    '<span class="agent-survey-card__answered-badge">Answered</span>',
                    `<span class="agent-survey-card__answered-text">${this.escapeHtml(answeredSummary || 'Response sent back to the agent.')}</span>`,
                    '</div>',
                ].join('')
                : [
                    '<div class="agent-survey-card__actions">',
                    currentStepIndex > 0
                        ? '<button type="button" class="agent-survey-card__secondary" onclick="window.chatApp.goToPreviousSurveyStep(this)">Back</button>'
                        : '',
                    `<button type="button" class="agent-survey-card__submit" onclick="window.chatApp.submitAgentSurvey(this)" ${canSubmitCurrentStep ? '' : 'disabled'}>${this.escapeHtml(submitLabel)}</button>`,
                    '<span class="agent-survey-card__hint">The agent will continue once you answer.</span>',
                    '</div>',
                ].join(''),
            '</div>',
            '</div>',
        ].filter(Boolean).join('');
    }

    syncSurveyInputValue(input) {
        const surveyInput = input?.closest?.('.agent-survey-card__input') || input;
        const card = surveyInput?.closest?.('.agent-survey-card');
        if (!card) {
            return;
        }

        this.updateSurveySubmitState(card);
    }

    buildSurveyRenderPlan(content = '', message = {}) {
        const source = String(content || '');
        if (!/```(?:survey|kb-survey)/i.test(source)) {
            const inferredSurvey = this.extractSurveyDefinitionFromContent(source, message?.id || '');
            if (inferredSurvey) {
                const token = `KB_SURVEY_TOKEN_${String(message?.id || 'message').replace(/[^a-z0-9_-]/gi, '_')}_0`;
                return {
                    markdown: token,
                    surveys: [{
                        token,
                        html: this.renderSurveyBlock(inferredSurvey, message),
                    }],
                };
            }

            return {
                markdown: source,
                surveys: [],
            };
        }

        let surveyIndex = 0;
        const surveys = [];
        const markdown = source.replace(/```(?:survey|kb-survey)\s*([\s\S]*?)```/gi, (match) => {
            const survey = this.extractSurveyDefinitionFromContent(match, message?.id || '');
            if (!survey) {
                return match;
            }

            const token = `KB_SURVEY_TOKEN_${String(message?.id || 'message').replace(/[^a-z0-9_-]/gi, '_')}_${surveyIndex}`;
            surveyIndex += 1;
            surveys.push({
                token,
                html: this.renderSurveyBlock(survey, message),
            });
            return `\n\n${token}\n\n`;
        });

        return {
            markdown,
            surveys,
        };
    }

    replaceSurveyRenderTokens(html = '', surveys = []) {
        let rendered = String(html || '');

        (Array.isArray(surveys) ? surveys : []).forEach((survey) => {
            const token = String(survey?.token || '').trim();
            const surveyHtml = String(survey?.html || '').trim();
            if (!token || !surveyHtml) {
                return;
            }

            const escapedToken = this.escapeRegExp(token);
            rendered = rendered
                .replace(new RegExp(`<p>\\s*${escapedToken}\\s*</p>`, 'g'), surveyHtml)
                .replace(new RegExp(escapedToken, 'g'), surveyHtml);
        });

        return rendered;
    }

    sanitizeAssistantHtml(html = '') {
        return DOMPurify.sanitize(html, {
            ALLOWED_TAGS: [
                'p', 'br', 'strong', 'em', 'u', 's', 'del', 'ins',
                'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                'ul', 'ol', 'li',
                'blockquote', 'hr',
                'code', 'pre',
                'a', 'img',
                'table', 'thead', 'tbody', 'tr', 'th', 'td',
                'div', 'span', 'button', 'i',
                'input', 'textarea', 'label'
            ],
            ALLOWED_ATTR: [
                'href', 'title', 'target', 'rel', 'src', 'alt',
                'class', 'data-code', 'onclick', 'type', 'checked', 'disabled',
                'aria-label', 'aria-hidden', 'aria-checked',
                'data-filename', 'data-mermaid-source', 'data-mermaid-filename', 'data-lucide',
                'data-message-id', 'data-survey-id', 'data-allow-multiple', 'data-max-selections',
                'data-step-id', 'data-step-input-type', 'data-step-required', 'data-step-allow-multiple', 'data-step-max-selections',
                'data-current-step-index', 'data-option-id', 'data-option-label', 'data-submitted',
                'placeholder', 'rows', 'maxlength', 'role', 'value', 'style'
            ],
            ALLOW_DATA_ATTR: false,
        });
    }

    normalizeStructuredAssistantMarkdown(source = '') {
        return String(source || '')
            .split(/(```[\s\S]*?```)/g)
            .map((segment) => {
                if (/^```[\s\S]*```$/.test(segment)) {
                    return segment;
                }

                return this.restoreFlattenedMarkdownBlocks(segment);
            })
            .join('');
    }

    restoreFlattenedMarkdownBlocks(source = '') {
        let text = String(source || '').replace(/\r\n?/g, '\n');
        if (!text.trim()) {
            return text;
        }

        const wrappedQuoteMatch = text.match(/^"([\s\S]*)"$/);
        if (wrappedQuoteMatch && /(?:#{2,6}\s|\d+\.\s|[*-]\s)/.test(wrappedQuoteMatch[1])) {
            text = wrappedQuoteMatch[1];
        }

        if (!/[^\n]\s+(?:#{2,6}\s|\d+\.\s|[*-]\s)/.test(text)) {
            return text.trim();
        }

        return text
            .replace(/([.!?:])(?=#{2,6}\s)/g, '$1\n\n')
            .replace(/([.!?:])(?=\d+\.\s)/g, '$1\n')
            .replace(/([.!?:])(?=[*-]\s)/g, '$1\n')
            .replace(/([^\n])\s+(?=#{2,6}\s)/g, '$1\n\n')
            .replace(/([^\n])\s+(?=\d+\.\s)/g, '$1\n')
            .replace(/([^\n])\s+(?=[*-]\s)/g, '$1\n')
            .replace(/([^\n])\s+(?=(?:Style|Overview|Summary|Recommendation|Next Step|Next Steps):)/g, '$1\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    looksLikeAgentBrief(markdown = '', message = {}) {
        const normalized = String(markdown || '').trim();
        if (normalized.length < 180) {
            return false;
        }

        const hasStructure = /(^|\n)#{2,6}\s/m.test(normalized)
            || /(^|\n)\d+\.\s/m.test(normalized)
            || /(^|\n)[*-]\s/m.test(normalized);
        if (!hasStructure) {
            return false;
        }

        if (message?.agentExecutor === true || message?.metadata?.agentExecutor === true) {
            return true;
        }

        return /based on your survey response|here['’]s what i(?: have|'ve) prepared|would you like|this (?:diagram|wireframe|plan|architecture)/i.test(normalized);
    }

    buildAgentBriefSections(markdown = '') {
        const normalized = String(markdown || '').trim();
        const headingMatch = normalized.match(/^#{2,6}\s+(.+)$/m);
        let intro = '';
        let title = '';
        let bodyMarkdown = normalized;
        let footer = '';

        if (headingMatch) {
            title = String(headingMatch[1] || '').trim();
            intro = normalized.slice(0, headingMatch.index).trim();
            bodyMarkdown = normalized.slice(headingMatch.index + headingMatch[0].length).trim();
        } else {
            const sections = normalized.split(/\n{2,}/).filter(Boolean);
            if (sections.length > 1) {
                intro = sections[0].trim();
                bodyMarkdown = sections.slice(1).join('\n\n').trim();
            }
        }

        const footerMatch = bodyMarkdown.match(/\n\n([^#\n][\s\S]*\?)$/);
        if (footerMatch && footerMatch[1].length <= 320) {
            footer = footerMatch[1].trim();
            bodyMarkdown = bodyMarkdown.slice(0, footerMatch.index).trim();
        }

        return {
            title,
            intro,
            bodyMarkdown: bodyMarkdown || normalized,
            footer,
        };
    }

    buildAssistantRenderPlan(messageOrContent, isStreaming = false) {
        const message = messageOrContent && typeof messageOrContent === 'object'
            ? messageOrContent
            : { content: messageOrContent };
        const content = message.displayContent ?? message.content;
        if (!content) {
            return {
                html: isStreaming ? '<span class="streaming-cursor" aria-hidden="true"></span>' : '',
                variant: 'default',
            };
        }

        const surveyRenderPlan = this.buildSurveyRenderPlan(content, message);
        const normalizedMarkdown = this.normalizeStructuredAssistantMarkdown(surveyRenderPlan.markdown);

        if (this.looksLikeAgentBrief(normalizedMarkdown, message)) {
            const sections = this.buildAgentBriefSections(normalizedMarkdown);
            const introHtml = sections.intro
                ? this.sanitizeAssistantHtml(marked.parse(sections.intro))
                : '';
            const bodyHtml = this.sanitizeAssistantHtml(marked.parse(sections.bodyMarkdown));
            const footerHtml = sections.footer
                ? `<div class="agent-brief-card__footer">
                        <div class="agent-brief-card__hint">Next move</div>
                        <div class="agent-brief-card__next">${this.escapeHtml(sections.footer)}</div>
                    </div>`
                : '';
            let html = `
                <div class="agent-brief-card">
                    <div class="agent-brief-card__eyebrow">${message?.agentExecutor === true || message?.metadata?.agentExecutor === true ? 'Agent Result' : 'Structured Reply'}</div>
                    ${sections.title ? `
                    <div class="agent-brief-card__title-row">
                        <h3 class="agent-brief-card__title">${this.escapeHtml(sections.title)}</h3>
                        ${(message?.agentExecutor === true || message?.metadata?.agentExecutor === true)
                            ? '<span class="agent-brief-card__badge">Autonomous</span>'
                            : ''}
                    </div>
                    ` : ''}
                    ${introHtml ? `<div class="agent-brief-card__intro">${introHtml}</div>` : ''}
                    <div class="agent-brief-card__body">${bodyHtml}</div>
                    ${footerHtml}
                </div>
            `;

            if (isStreaming) {
                html += '<span class="streaming-cursor" aria-hidden="true"></span>';
            }

            return {
                html,
                variant: 'agent-brief',
            };
        }

        let html = this.sanitizeAssistantHtml(marked.parse(normalizedMarkdown));
        html = this.replaceSurveyRenderTokens(html, surveyRenderPlan.surveys);

        if (isStreaming) {
            html += '<span class="streaming-cursor" aria-hidden="true"></span>';
        }

        return {
            html,
            variant: 'default',
        };
    }

    renderMessage(message, isStreaming = false) {
        if (message.type === 'unsplash-search') {
            return this.renderUnsplashSearchMessage(message);
        }

        if (message.type === 'search-results') {
            return this.renderSearchResultsMessage(message);
        }

        if (message.type === 'research-sources') {
            return this.renderResearchSourcesMessage(message);
        }

        if (message.type === 'image-selection') {
            return this.renderImageSelectionMessage(message);
        }

        if (message.type === 'artifact-gallery') {
            return this.renderArtifactGalleryMessage(message);
        }

        // Handle image messages
        if (message.type === 'image' || message.imageUrl) {
            return this.renderImageMessage(message);
        }
        
        const isUser = message.role === 'user';
        const messageId = message.id || this.generateMessageId();
        
        const messageEl = document.createElement('div');
        messageEl.className = `message ${isUser ? 'user' : 'assistant'}`;
        messageEl.id = messageId;
        messageEl.dataset.messageId = messageId;
        
        // Add ARIA attributes for accessibility
        messageEl.setAttribute('role', 'article');
        messageEl.setAttribute('aria-label', `${isUser ? 'Your message' : 'Assistant response'}`);

        const avatar = isUser ? 
            `<div class="message-avatar user" aria-hidden="true"><i data-lucide="user" class="w-4 h-4"></i></div>` :
            `<div class="message-avatar assistant" aria-hidden="true"><i data-lucide="bot" class="w-4 h-4"></i></div>`;

        const renderedContent = isUser ? 
            message.content :
            (message.displayContent ?? message.content);

        const assistantRenderPlan = isUser
            ? null
            : this.buildAssistantRenderPlan(message, isStreaming);
        const content = isUser ? 
            this.renderUserMessage(renderedContent) :
            assistantRenderPlan.html;
        const messageTextClass = isUser
            ? ''
            : `markdown-content${assistantRenderPlan?.variant === 'agent-brief' ? ' message-text--agent-brief' : ''}`;

        if (assistantRenderPlan?.variant === 'agent-brief') {
            messageEl.classList.add('message--agent-brief');
        }

        const time = this.formatTime(message.timestamp);
        const fullTimestamp = message.timestamp ? new Date(message.timestamp).toLocaleString() : '';

        messageEl.innerHTML = `
            ${!isUser ? avatar : ''}
            <div class="message-content">
                <div class="message-header">
                    <span class="message-author">${isUser ? 'You' : 'Assistant'}</span>
                    <span class="message-time" title="${fullTimestamp}">${time}</span>
                    <div class="message-actions">
                        <button class="message-action-btn" onclick="uiHelpers.copyMessage('${messageId}')" title="Copy message" aria-label="Copy message to clipboard">
                            <i data-lucide="copy" class="w-4 h-4" aria-hidden="true"></i>
                        </button>
                        ${!isUser ? `
                        <button class="message-action-btn" onclick="uiHelpers.regenerateMessage('${messageId}')" title="Regenerate response" aria-label="Regenerate response">
                            <i data-lucide="refresh-cw" class="w-4 h-4" aria-hidden="true"></i>
                        </button>
                        ` : ''}
                    </div>
                </div>
                <div class="message-text ${messageTextClass}">
                    ${content}
                </div>
            </div>
            ${isUser ? avatar : ''}
        `;

        if (!isUser) {
            this.highlightCodeBlocks(messageEl);
            this.renderMermaidDiagrams(messageEl);
        }

        return messageEl;
    }

    renderUserMessage(content) {
        return this.escapeHtml(content);
    }

    renderAssistantMessage(messageOrContent, isStreaming = false) {
        return this.buildAssistantRenderPlan(messageOrContent, isStreaming).html;
    }

    toggleSurveyOption(button) {
        const optionButton = button?.closest?.('.agent-survey-option');
        const card = optionButton?.closest?.('.agent-survey-card');
        if (!optionButton || !card || card.dataset.submitted === 'true') {
            return;
        }

        const allOptions = Array.from(card.querySelectorAll('.agent-survey-option'));
        const allowMultiple = card.dataset.stepAllowMultiple === 'true';
        const maxSelections = Math.max(1, Number(card.dataset.stepMaxSelections) || 1);
        const isSelected = optionButton.classList.contains('is-selected');

        if (!allowMultiple) {
            allOptions.forEach((entry) => {
                entry.classList.remove('is-selected');
                entry.setAttribute('aria-checked', 'false');
            });
            optionButton.classList.add('is-selected');
            optionButton.setAttribute('aria-checked', 'true');
        } else {
            if (!isSelected) {
                const selectedCount = allOptions.filter((entry) => entry.classList.contains('is-selected')).length;
                if (selectedCount >= maxSelections) {
                    this.showToast(`Choose up to ${maxSelections} option${maxSelections === 1 ? '' : 's'}`, 'info');
                    return;
                }
            }

            optionButton.classList.toggle('is-selected', !isSelected);
            optionButton.setAttribute('aria-checked', isSelected ? 'false' : 'true');
        }

        const customOptionId = this.getSurveyCustomOption().id;
        if (String(optionButton.dataset.optionId || '').trim() === customOptionId) {
            card.querySelector('.agent-survey-card__notes')?.focus();
        }

        this.updateSurveySubmitState(card);
        this.playMenuCue('menu-select');
    }

    syncSurveyFreeText(input) {
        const notesField = input?.closest?.('.agent-survey-card__notes') || input;
        const card = notesField?.closest?.('.agent-survey-card');
        if (!notesField || !card || card.dataset.submitted === 'true') {
            return;
        }

        const customOptionId = this.getSurveyCustomOption().id;
        const customOption = card.querySelector(`.agent-survey-option[data-option-id="${customOptionId}"]`);
        if (!customOption) {
            this.updateSurveySubmitState(card);
            return;
        }

        const notes = String(notesField.value || '').trim();
        const hasAnySelection = Array.from(card.querySelectorAll('.agent-survey-option'))
            .some((entry) => entry.classList.contains('is-selected'));

        if (notes && !hasAnySelection) {
            customOption.classList.add('is-selected');
            customOption.setAttribute('aria-checked', 'true');
        }

        this.updateSurveySubmitState(card);
    }

    renderImageMessage(message) {
        const messageId = message.id || this.generateMessageId();
        const time = this.formatTime(message.timestamp);
        const fullTimestamp = message.timestamp ? new Date(message.timestamp).toLocaleString() : '';
        
        const isLoading = message.isLoading;
        const imageUrl = message.imageUrl;
        const revisedPrompt = message.revisedPrompt;
        const prompt = message.prompt;
        const source = message.source || 'generated';
        const isUnsplash = source === 'unsplash';
        const isArtifact = source === 'artifact';
        const downloadableUrl = message.downloadUrl || imageUrl;
        const shareableUrl = message.downloadUrl || imageUrl;
        
        const messageEl = document.createElement('div');
        messageEl.className = 'message assistant';
        messageEl.id = messageId;
        messageEl.dataset.messageId = messageId;
        messageEl.setAttribute('role', 'article');
        messageEl.setAttribute('aria-label', isUnsplash ? 'Unsplash image' : (isArtifact ? 'Captured image' : 'Generated image'));
        
        // Build attribution for Unsplash images
        let attributionHtml = '';
        if (isUnsplash && message.author) {
            attributionHtml = `
                <div class="image-attribution">
                    Photo by <a href="${message.author.link}?utm_source=lillybuilt&utm_medium=referral" target="_blank" rel="noopener">${this.escapeHtml(message.author.name)}</a> on 
                    <a href="${message.unsplashLink}?utm_source=lillybuilt&utm_medium=referral" target="_blank" rel="noopener">Unsplash</a>
                </div>
            `;
        }
        
        const imageHtml = isLoading ? `
            <div class="image-container loading" aria-busy="true" aria-label="Generating image">
                <div class="image-loading-indicator">
                    <div class="spinner" role="progressbar" aria-valuemin="0" aria-valuemax="100"></div>
                    <span class="text">${message.loadingText || 'Generating image...'}</span>
                </div>
            </div>
        ` : `
            <div class="image-container">
                <img src="${imageUrl}" alt="${this.escapeHtmlAttr(prompt || 'Image')}" 
                     onclick="uiHelpers.openImageLightbox('${imageUrl}')" 
                     onload="uiHelpers.scrollToBottom()"
                     loading="lazy">
            </div>
            ${attributionHtml}
            ${revisedPrompt ? `
                <div class="image-revised-prompt">
                    <div class="label">Revised Prompt</div>
                    <div>${this.escapeHtml(revisedPrompt)}</div>
                </div>
            ` : ''}
            <div class="image-actions">
                <button class="image-action-btn" onclick="uiHelpers.downloadImage('${this.escapeHtmlAttr(downloadableUrl)}', '${this.escapeHtmlAttr(prompt || message.filename || 'image')}.jpg')" aria-label="Download image">
                    <i data-lucide="download" class="w-4 h-4" aria-hidden="true"></i>
                    <span>Download</span>
                </button>
                <button class="image-action-btn" onclick="uiHelpers.copyImageUrl('${this.escapeHtmlAttr(shareableUrl)}')" aria-label="Copy image URL">
                    <i data-lucide="link" class="w-4 h-4" aria-hidden="true"></i>
                    <span>Copy URL</span>
                </button>
                ${isUnsplash ? `
                <button class="image-action-btn" onclick="window.open('${message.unsplashLink}?utm_source=lillybuilt&utm_medium=referral', '_blank')" aria-label="View on Unsplash">
                    <i data-lucide="external-link" class="w-4 h-4" aria-hidden="true"></i>
                    <span>View on Unsplash</span>
                </button>
                ` : ''}
            </div>
        `;
        
        const sourceIcon = isUnsplash ? 'camera' : (isArtifact ? 'scan-search' : 'sparkles');
        const sourceText = isUnsplash ? 'Unsplash' : (isArtifact ? (message.sourceHost || 'Artifact capture') : (message.model || 'Generated'));
        const sourceLabel = isUnsplash ? 'Stock Photo' : (isArtifact ? 'Captured Image' : 'Generated Image');
        const authorLabel = isUnsplash ? 'Unsplash' : (isArtifact ? 'Captured Image' : 'AI Image Generator');
        
        messageEl.innerHTML = `
            <div class="message-avatar assistant" aria-hidden="true">
                <i data-lucide="${isUnsplash ? 'camera' : (isArtifact ? 'images' : 'image')}" class="w-4 h-4"></i>
            </div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-author">${authorLabel}</span>
                    <span class="message-time" title="${fullTimestamp}">${time}</span>
                    <div class="message-actions">
                        ${!isLoading ? `
                        <button class="message-action-btn" onclick="uiHelpers.copyMessage('${messageId}')" title="Copy prompt" aria-label="Copy prompt">
                            <i data-lucide="copy" class="w-4 h-4" aria-hidden="true"></i>
                        </button>
                        ` : ''}
                    </div>
                </div>
                <div class="message-image">
                    <div class="image-generation-info">
                        <div class="icon" aria-hidden="true">
                            <i data-lucide="${sourceIcon}" class="w-3.5 h-3.5"></i>
                        </div>
                        <span class="text">${sourceLabel}</span>
                        <span class="meta">${sourceText}</span>
                    </div>
                    ${prompt ? `<p class="text-sm text-text-secondary mb-3">"${this.escapeHtml(prompt)}"</p>` : ''}
                    ${imageHtml}
                </div>
            </div>
        `;
        
        return messageEl;
    }

    /**
     * Render an Unsplash search results message
     * @param {Object} message - The search message data
     * @returns {HTMLElement} - The rendered message element
     */
    renderUnsplashSearchMessage(message) {
        const messageId = message.id || this.generateMessageId();
        const time = this.formatTime(message.timestamp);
        const fullTimestamp = message.timestamp ? new Date(message.timestamp).toLocaleString() : '';
        
        const isLoading = message.isLoading;
        const query = message.query;
        const results = message.results || [];
        const total = message.total || 0;
        const currentPage = Math.max(1, Number(message.currentPage) || 1);
        const totalPages = Math.max(1, Number(message.totalPages) || 1);
        const error = message.error;
        
        const messageEl = document.createElement('div');
        messageEl.className = 'message assistant';
        messageEl.id = messageId;
        messageEl.dataset.messageId = messageId;
        messageEl.setAttribute('role', 'article');
        messageEl.setAttribute('aria-label', 'Unsplash search results');
        
        let contentHtml = '';
        
        if (isLoading) {
            contentHtml = `
                <div class="unsplash-search-loading" aria-busy="true">
                    <div class="spinner" role="progressbar" aria-valuemin="0" aria-valuemax="100"></div>
                    <span class="text">${message.loadingText || 'Searching Unsplash...'}</span>
                </div>
            `;
        } else if (error) {
            contentHtml = `
                <div class="unsplash-search-error">
                    <i data-lucide="alert-circle" class="w-5 h-5" aria-hidden="true"></i>
                    <span>${this.escapeHtml(error)}</span>
                </div>
            `;
        } else if (results.length > 0) {
            contentHtml = `
                <div class="unsplash-search-results">
                    <div class="unsplash-results-header">
                        <span class="unsplash-results-count">${results.length} of ${total} results</span>
                        <span class="unsplash-results-hint">Click an image to add it to the conversation</span>
                    </div>
                    <div class="unsplash-results-grid">
                        ${results.map((image, index) => `
                            <button type="button"
                                 class="unsplash-result-item"
                                 onclick="app.selectUnsplashImage('${messageId}', ${index})"
                                 aria-label="${this.escapeHtmlAttr(`Select image by ${image.author ? image.author.name : 'Unknown'}`)}"
                                 title="${this.escapeHtmlAttr(`Photo by ${image.author ? image.author.name : 'Unknown'} - Click to select`)}">
                                <img src="${this.escapeHtmlAttr(image.urls.small)}"
                                     alt="${this.escapeHtmlAttr(image.altDescription || image.description || 'Unsplash image')}" 
                                     loading="lazy">
                                <div class="unsplash-result-overlay">
                                    <span class="unsplash-result-author">${image.author ? this.escapeHtml(image.author.name) : 'Unknown'}</span>
                                </div>
                            </button>
                        `).join('')}
                    </div>
                    ${totalPages > 1 ? `
                    <div class="selection-pagination">
                        <button type="button"
                            class="selection-action-btn"
                            onclick="app.loadUnsplashPage('${messageId}', ${currentPage - 1})"
                            ${currentPage <= 1 ? 'disabled' : ''}>
                            Previous
                        </button>
                        <span class="selection-pagination-label">Page ${currentPage} of ${totalPages}</span>
                        <button type="button"
                            class="selection-action-btn"
                            onclick="app.loadUnsplashPage('${messageId}', ${currentPage + 1})"
                            ${currentPage >= totalPages ? 'disabled' : ''}>
                            Next
                        </button>
                    </div>
                    ` : ''}
                </div>
            `;
        } else {
            contentHtml = `
                <div class="unsplash-search-empty">
                    <i data-lucide="search-x" class="w-8 h-8" aria-hidden="true"></i>
                    <p>No images found for "${this.escapeHtml(query)}"</p>
                </div>
            `;
        }
        
        messageEl.innerHTML = `
            <div class="message-avatar assistant" aria-hidden="true">
                <i data-lucide="search" class="w-4 h-4"></i>
            </div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-author">Unsplash Search</span>
                    <span class="message-time" title="${fullTimestamp}">${time}</span>
                </div>
                <div class="message-unsplash-search">
                    <div class="unsplash-search-info">
                        <div class="icon" aria-hidden="true">
                            <i data-lucide="camera" class="w-3.5 h-3.5"></i>
                        </div>
                        <span class="text">Stock Photos</span>
                    </div>
                    ${query ? `<p class="unsplash-search-query">"${this.escapeHtml(query)}"</p>` : ''}
                    ${contentHtml}
                </div>
            </div>
        `;
        
        return messageEl;
    }

    formatToolResultDate(value) {
        if (!value) {
            return '';
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return '';
        }

        return date.toLocaleDateString();
    }

    renderSearchResultsMessage(message) {
        const messageId = message.id || this.generateMessageId();
        const time = this.formatTime(message.timestamp);
        const fullTimestamp = message.timestamp ? new Date(message.timestamp).toLocaleString() : '';
        const query = message.query || '';
        const results = Array.isArray(message.results) ? message.results : [];

        const messageEl = document.createElement('div');
        messageEl.className = 'message assistant';
        messageEl.id = messageId;
        messageEl.dataset.messageId = messageId;
        messageEl.setAttribute('role', 'article');
        messageEl.setAttribute('aria-label', 'Search result choices');

        const contentHtml = results.length > 0
            ? `
                <div class="search-results-list">
                    ${results.map((result, index) => `
                        <div class="search-result-card">
                            <div class="search-result-topline">
                                <div class="search-result-title">${this.escapeHtml(result.title || result.url)}</div>
                                <div class="search-result-meta">
                                    ${result.source ? `<span>${this.escapeHtml(result.source)}</span>` : ''}
                                    ${this.formatToolResultDate(result.publishedAt) ? `<span>${this.escapeHtml(this.formatToolResultDate(result.publishedAt))}</span>` : ''}
                                </div>
                            </div>
                            <a class="search-result-url" href="${this.escapeHtmlAttr(result.url)}" target="_blank" rel="noopener noreferrer nofollow">${this.escapeHtml(result.url)}</a>
                            ${result.snippet ? `<p class="search-result-snippet">${this.escapeHtml(result.snippet)}</p>` : ''}
                            <div class="search-result-actions">
                                <button type="button" class="selection-action-btn primary" onclick="app.useSearchResult('${messageId}', ${index})">
                                    Use This Page
                                </button>
                                <button type="button" class="selection-action-btn" onclick="app.openSearchResult('${messageId}', ${index})">
                                    Open
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `
            : `
                <div class="unsplash-search-empty">
                    <i data-lucide="search-x" class="w-8 h-8" aria-hidden="true"></i>
                    <p>No source pages were returned.</p>
                </div>
            `;

        messageEl.innerHTML = `
            <div class="message-avatar assistant" aria-hidden="true">
                <i data-lucide="globe" class="w-4 h-4"></i>
            </div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-author">Source Pages</span>
                    <span class="message-time" title="${fullTimestamp}">${time}</span>
                </div>
                <div class="message-selection-panel">
                    <div class="selection-panel-info">
                        <div class="icon" aria-hidden="true">
                            <i data-lucide="globe" class="w-3.5 h-3.5"></i>
                        </div>
                        <span class="text">Choose a page</span>
                        <span class="meta">${results.length} options</span>
                    </div>
                    ${query ? `<p class="selection-panel-query">"${this.escapeHtml(query)}"</p>` : ''}
                    ${contentHtml}
                </div>
            </div>
        `;

        return messageEl;
    }

    renderResearchSourcesMessage(message) {
        const messageId = message.id || this.generateMessageId();
        const time = this.formatTime(message.timestamp);
        const fullTimestamp = message.timestamp ? new Date(message.timestamp).toLocaleString() : '';
        const query = message.query || '';
        const results = Array.isArray(message.results) ? message.results : [];

        const messageEl = document.createElement('div');
        messageEl.className = 'message assistant';
        messageEl.id = messageId;
        messageEl.dataset.messageId = messageId;
        messageEl.setAttribute('role', 'article');
        messageEl.setAttribute('aria-label', 'Verified source excerpts');

        const contentHtml = results.length > 0
            ? `
                <div class="search-results-list">
                    ${results.map((result) => `
                        <div class="search-result-card research-source-card">
                            <div class="search-result-topline">
                                <div class="search-result-title">${this.escapeHtml(result.title || result.url)}</div>
                                <div class="search-result-meta">
                                    ${result.source ? `<span>${this.escapeHtml(result.source)}</span>` : ''}
                                    ${this.formatToolResultDate(result.publishedAt) ? `<span>${this.escapeHtml(this.formatToolResultDate(result.publishedAt))}</span>` : ''}
                                    ${result.toolId ? `<span class="research-source-label">${this.escapeHtml(result.toolId)}</span>` : ''}
                                </div>
                            </div>
                            <a class="search-result-url" href="${this.escapeHtmlAttr(result.url)}" target="_blank" rel="noopener noreferrer nofollow">${this.escapeHtml(result.url)}</a>
                            ${result.snippet ? `<p class="search-result-snippet">${this.escapeHtml(result.snippet)}</p>` : ''}
                            ${result.excerpt ? `<div class="research-source-excerpt">${this.escapeHtml(result.excerpt)}</div>` : ''}
                            <div class="search-result-actions">
                                <button type="button" class="selection-action-btn" onclick="window.open('${this.escapeHtmlAttr(result.url)}', '_blank', 'noopener')">
                                    Open Source
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `
            : `
                <div class="unsplash-search-empty">
                    <i data-lucide="search-x" class="w-8 h-8" aria-hidden="true"></i>
                    <p>No verified source excerpts were returned.</p>
                </div>
            `;

        messageEl.innerHTML = `
            <div class="message-avatar assistant" aria-hidden="true">
                <i data-lucide="book-open" class="w-4 h-4"></i>
            </div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-author">Verified Sources</span>
                    <span class="message-time" title="${fullTimestamp}">${time}</span>
                </div>
                <div class="message-selection-panel">
                    <div class="selection-panel-info">
                        <div class="icon" aria-hidden="true">
                            <i data-lucide="book-open" class="w-3.5 h-3.5"></i>
                        </div>
                        <span class="text">Verified excerpts</span>
                        <span class="meta">${results.length} sources</span>
                    </div>
                    ${query ? `<p class="selection-panel-query">"${this.escapeHtml(query)}"</p>` : ''}
                    ${contentHtml}
                </div>
            </div>
        `;

        return messageEl;
    }

    renderImageSelectionMessage(message) {
        const messageId = message.id || this.generateMessageId();
        const time = this.formatTime(message.timestamp);
        const fullTimestamp = message.timestamp ? new Date(message.timestamp).toLocaleString() : '';
        const prompt = message.prompt || '';
        const results = Array.isArray(message.results) ? message.results : [];
        const model = message.model || '';
        const sourceKind = message.sourceKind || 'generated';
        const isArtifact = sourceKind === 'artifact';
        const sourceHost = message.sourceHost || '';

        const messageEl = document.createElement('div');
        messageEl.className = 'message assistant';
        messageEl.id = messageId;
        messageEl.dataset.messageId = messageId;
        messageEl.setAttribute('role', 'article');
        messageEl.setAttribute('aria-label', isArtifact ? 'Captured image choices' : 'Generated image choices');

        const contentHtml = results.length > 0
            ? `
                <div class="image-selection-grid">
                    ${results.map((image, index) => `
                        <button type="button"
                            class="image-selection-item"
                            onclick="app.selectGeneratedImage('${messageId}', ${index})"
                            aria-label="Add image ${index + 1} to the conversation">
                            <img src="${this.escapeHtmlAttr(image.thumbnailUrl || image.imageUrl)}"
                                alt="${this.escapeHtmlAttr(image.alt || prompt || (isArtifact ? 'Captured image' : 'Generated image'))}"
                                loading="lazy">
                            ${image.filename || image.sourceHost ? `
                            <div class="image-selection-meta">
                                <span class="image-selection-caption">${this.escapeHtml(image.filename || image.alt || `Image ${index + 1}`)}</span>
                                ${image.sourceHost ? `<span class="image-selection-host">${this.escapeHtml(image.sourceHost)}</span>` : ''}
                            </div>
                            ` : ''}
                            <span class="image-selection-overlay">Add To Chat</span>
                        </button>
                    `).join('')}
                </div>
            `
            : `
                <div class="unsplash-search-empty">
                    <i data-lucide="image-off" class="w-8 h-8" aria-hidden="true"></i>
                    <p>No ${isArtifact ? 'captured' : 'generated'} image options were returned.</p>
                </div>
            `;

        messageEl.innerHTML = `
            <div class="message-avatar assistant" aria-hidden="true">
                <i data-lucide="${isArtifact ? 'images' : 'image-plus'}" class="w-4 h-4"></i>
            </div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-author">${isArtifact ? 'Captured Images' : 'Image Options'}</span>
                    <span class="message-time" title="${fullTimestamp}">${time}</span>
                </div>
                <div class="message-selection-panel">
                    <div class="selection-panel-info">
                        <div class="icon ${isArtifact ? '' : 'accent-purple'}" aria-hidden="true">
                            <i data-lucide="${isArtifact ? 'scan-search' : 'sparkles'}" class="w-3.5 h-3.5"></i>
                        </div>
                        <span class="text">${isArtifact ? 'Choose a captured image' : 'Choose an image'}</span>
                        <span class="meta">${isArtifact ? (sourceHost || `${results.length} options`) : (model || `${results.length} options`)}</span>
                    </div>
                    ${prompt ? `<p class="selection-panel-query">"${this.escapeHtml(prompt)}"</p>` : ''}
                    ${contentHtml}
                </div>
            </div>
        `;

        return messageEl;
    }

    renderArtifactGalleryMessage(message) {
        const messageId = message.id || this.generateMessageId();
        const time = this.formatTime(message.timestamp);
        const fullTimestamp = message.timestamp ? new Date(message.timestamp).toLocaleString() : '';
        const artifacts = Array.isArray(message.artifacts) ? message.artifacts : [];
        const galleryMarkup = window.artifactManager?.buildGalleryMarkup?.(artifacts) || '';

        const messageEl = document.createElement('div');
        messageEl.className = 'message assistant';
        messageEl.id = messageId;
        messageEl.dataset.messageId = messageId;
        messageEl.setAttribute('role', 'article');
        messageEl.setAttribute('aria-label', 'Generated files');

        messageEl.innerHTML = `
            <div class="message-avatar assistant" aria-hidden="true">
                <i data-lucide="files" class="w-4 h-4"></i>
            </div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-author">Generated Files</span>
                    <span class="message-time" title="${fullTimestamp}">${time}</span>
                </div>
                <div class="message-selection-panel">
                    <div class="selection-panel-info">
                        <div class="icon" aria-hidden="true">
                            <i data-lucide="files" class="w-3.5 h-3.5"></i>
                        </div>
                        <span class="text">Files ready</span>
                        <span class="meta">${artifacts.length} item${artifacts.length === 1 ? '' : 's'}</span>
                    </div>
                    ${galleryMarkup || `
                        <div class="unsplash-search-empty">
                            <i data-lucide="file-x" class="w-8 h-8" aria-hidden="true"></i>
                            <p>No generated files are available.</p>
                        </div>
                    `}
                </div>
            </div>
        `;

        if (messageEl.querySelector('.artifact-generated-card')) {
            this.renderMermaidDiagrams(messageEl);
        }

        return messageEl;
    }

    /**
     * Update an Unsplash search message with results or error
     * @param {string} messageId - The message ID to update
     * @param {Object} data - The update data
     */
    updateUnsplashSearchMessage(messageId, data) {
        const messageEl = document.getElementById(messageId);
        if (!messageEl) return false;
        
        // Create new message element with the updated data
        const newMessage = {
            id: messageId,
            role: 'assistant',
            type: 'unsplash-search',
            content: data.content,
            query: data.query,
            isLoading: Boolean(data.isLoading),
            loadingText: data.loadingText,
            results: data.results,
            total: data.total,
            totalPages: data.totalPages,
            currentPage: data.currentPage,
            perPage: data.perPage,
            orientation: data.orientation,
            error: data.error,
            timestamp: data.timestamp || new Date().toISOString()
        };
        
        const newEl = this.renderUnsplashSearchMessage(newMessage);
        messageEl.replaceWith(newEl);
        this.reinitializeIcons(newEl);
        this.scrollToBottom();
        
        return true;
    }

    /**
     * Escape HTML for safe use in JSON
     * @param {Object} obj - Object to escape
     * @returns {Object} - Escaped object
     */
    escapeHtmlForJSON(obj) {
        if (typeof obj === 'string') {
            return this.escapeHtml(obj);
        }
        if (Array.isArray(obj)) {
            return obj.map(item => this.escapeHtmlForJSON(item));
        }
        if (obj && typeof obj === 'object') {
            const escaped = {};
            for (const [key, value] of Object.entries(obj)) {
                escaped[key] = this.escapeHtmlForJSON(value);
            }
            return escaped;
        }
        return obj;
    }

    updateImageMessage(messageId, imageData) {
        const messageEl = document.getElementById(messageId);
        if (!messageEl) return false;
        
        // Create new message element with the image data
        const newMessage = {
            id: messageId,
            role: 'assistant',
            type: 'image',
            imageUrl: imageData.url || imageData.b64_json,
            prompt: imageData.prompt,
            revisedPrompt: imageData.revised_prompt,
            model: imageData.model,
            timestamp: new Date().toISOString()
        };
        
        const newEl = this.renderImageMessage(newMessage);
        messageEl.replaceWith(newEl);
        this.reinitializeIcons(newEl);
        this.scrollToBottom();
        
        return true;
    }

    updateMessageContent(messageId, content, isStreaming = false) {
        const messageEl = document.getElementById(messageId);
        if (!messageEl) return false;

        const textEl = messageEl.querySelector('.message-text');
        if (!textEl) return false;

        const isUser = messageEl.classList.contains('user');
        
        if (isUser) {
            textEl.textContent = content;
        } else {
            const renderPlan = this.buildAssistantRenderPlan({ id: messageId, content }, isStreaming);
            messageEl.classList.toggle('message--agent-brief', renderPlan.variant === 'agent-brief');
            textEl.classList.toggle('message-text--agent-brief', renderPlan.variant === 'agent-brief');
            textEl.innerHTML = renderPlan.html;
            this.highlightCodeBlocks(textEl);
            this.renderMermaidDiagrams(textEl);
            this.reinitializeIcons(textEl);
        }

        return true;
    }

    appendToMessage(messageId, content) {
        const messageEl = document.getElementById(messageId);
        if (!messageEl) return false;

        const textEl = messageEl.querySelector('.message-text');
        if (!textEl) return false;

        // Get current content (excluding cursor)
        let currentHtml = textEl.innerHTML;
        currentHtml = currentHtml.replace(/<span class="streaming-cursor"><\/span>/g, '');

        // Extract text content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = currentHtml;
        let currentText = tempDiv.textContent || '';

        // Append new content
        const newText = currentText + content;
        
        // Re-render as markdown
        const renderPlan = this.buildAssistantRenderPlan({ id: messageId, content: newText }, true);
        messageEl.classList.toggle('message--agent-brief', renderPlan.variant === 'agent-brief');
        textEl.classList.toggle('message-text--agent-brief', renderPlan.variant === 'agent-brief');
        textEl.innerHTML = renderPlan.html;
        this.highlightCodeBlocks(textEl);
        this.renderMermaidDiagrams(textEl);
        this.reinitializeIcons(textEl);

        return true;
    }

    async copyMessage(messageId) {
        const messageEl = document.getElementById(messageId);
        if (!messageEl) return;

        const textEl = messageEl.querySelector('.message-text');
        if (!textEl) return;

        const text = textEl.textContent || '';
        
        try {
            await navigator.clipboard.writeText(text.trim());
            this.showToast('Message copied to clipboard', 'success');
        } catch (err) {
            console.error('Failed to copy message:', err);
            this.showToast('Failed to copy message', 'error');
        }
    }

    regenerateMessage(messageId) {
        // Dispatch custom event for the app to handle
        window.dispatchEvent(new CustomEvent('regenerateMessage', { detail: { messageId } }));
    }

    // ============================================
    // Static ID Generator
    // ============================================

    static generateMessageId() {
        return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    generateMessageId() {
        return UIHelpers.generateMessageId();
    }

    // ============================================
    // Image Handling
    // ============================================

    openImageLightbox(imageUrl) {
        const lightbox = document.getElementById('image-lightbox');
        const img = document.getElementById('lightbox-image');
        img.src = imageUrl;
        img.alt = 'Generated image preview';
        lightbox.classList.remove('hidden');
        lightbox.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        
        // Save last focused element
        this.lastFocusedElement = document.activeElement;
        
        // Focus trap for accessibility
        const closeBtn = lightbox.querySelector('.image-lightbox-close');
        if (closeBtn) closeBtn.focus();
    }

    closeImageLightbox() {
        const lightbox = document.getElementById('image-lightbox');
        const img = document.getElementById('lightbox-image');
        lightbox.classList.add('hidden');
        lightbox.setAttribute('aria-hidden', 'true');
        img.src = '';
        img.alt = '';
        document.body.style.overflow = '';
        
        // Return focus to trigger button
        if (this.lastFocusedElement) {
            this.lastFocusedElement.focus();
            this.lastFocusedElement = null;
        }
    }

    downloadLightboxImage() {
        const img = document.getElementById('lightbox-image');
        if (img.src) {
            this.downloadImage(img.src, 'generated-image.png');
        }
    }

    downloadImage(imageUrl, filename) {
        const a = document.createElement('a');
        a.href = imageUrl;
        a.download = filename;
        a.setAttribute('aria-label', `Download ${filename}`);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    async copyImageUrl(imageUrl) {
        try {
            await navigator.clipboard.writeText(imageUrl);
            this.showToast('Image URL copied to clipboard', 'success');
        } catch (err) {
            console.error('Failed to copy image URL:', err);
            this.showToast('Failed to copy image URL', 'error');
        }
    }

    // ============================================
    // Image Generation Modal
    // ============================================

    openImageModal() {
        const modal = document.getElementById('image-modal');
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        
        // Save last focused element
        this.lastFocusedElement = document.activeElement;
        
        // Focus the prompt input
        setTimeout(() => {
            const input = document.getElementById('image-prompt-input');
            if (input) input.focus();
        }, 100);
        
        this.loadImageModels();

        // Setup toggle buttons
        this.setupImageGenerationToggles();
        
        // Trap focus for accessibility
        this.trapFocus(modal);
    }

    getPreferredImageModelId(models = this.availableImageModels) {
        const list = Array.isArray(models) ? models : [];
        return list[0]?.id || '';
    }
    async loadImageModels() {
        try {
            const models = await apiClient.getImageModelsFromAPI();
            this.availableImageModels = Array.isArray(models) ? models : [];

            const modelSelect = document.getElementById('image-model-select');
            if (modelSelect && this.availableImageModels.length > 0) {
                modelSelect.innerHTML = this.availableImageModels
                    .map((model) => `<option value="${model.id}">${model.name || model.id || 'Gateway Default'}</option>` )
                    .join('');

                if (!this.availableImageModels.find((model) => model.id === modelSelect.value)) {
                    modelSelect.value = this.getPreferredImageModelId();
                }

                this.updateImageOptionsForModel(modelSelect.value);
            }
        } catch (error) {
            console.error('Failed to load image models:', error);
            this.availableImageModels = [];
        }
    }
    closeImageModal() {
        const modal = document.getElementById('image-modal');
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
        
        // Return focus to trigger button
        if (this.lastFocusedElement) {
            this.lastFocusedElement.focus();
            this.lastFocusedElement = null;
        }
        
        // Reset form
        const promptInput = document.getElementById('image-prompt-input');
        const modelSelect = document.getElementById('image-model-select');
        const sizeSelect = document.getElementById('image-size-select');
        
        if (promptInput) promptInput.value = '';
        if (modelSelect) modelSelect.value = this.getPreferredImageModelId();
        if (sizeSelect) sizeSelect.value = '1024x1024';
        
        this.imageGenerationState.quality = 'standard';
        this.imageGenerationState.style = 'vivid';
        this.imageGenerationState.source = 'generate';
        this.updateToggleButtons();
        this.setImageSource('generate');
    }

    /**
     * Set the image source (generate or unsplash)
     * @param {string} source - 'generate' or 'unsplash'
     */
    setImageSource(source) {
        this.imageGenerationState.source = source;
        
        // Update button states
        document.querySelectorAll('.image-source-btn').forEach(btn => {
            const isActive = btn.dataset.source === source;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-checked', isActive);
        });
        
        // Show/hide appropriate options
        const aiOptions = document.getElementById('ai-generation-options');
        const unsplashOptions = document.getElementById('unsplash-options');
        const promptLabel = document.getElementById('image-prompt-label');
        const actionText = document.getElementById('image-action-text');
        const actionIcon = document.querySelector('#image-generate-btn i');
        
        if (source === 'generate') {
            aiOptions?.classList.remove('hidden');
            unsplashOptions?.classList.add('hidden');
            if (promptLabel) promptLabel.textContent = 'Describe the image you want to generate...';
            if (actionText) actionText.textContent = 'Generate Image';
            if (actionIcon) actionIcon.setAttribute('data-lucide', 'wand-2');
        } else {
            aiOptions?.classList.add('hidden');
            unsplashOptions?.classList.remove('hidden');
            if (promptLabel) promptLabel.textContent = 'What are you looking for?';
            if (actionText) actionText.textContent = 'Search Unsplash';
            if (actionIcon) actionIcon.setAttribute('data-lucide', 'search');
        }
        
        // Re-initialize icons
        this.reinitializeIcons();
    }

    setupImageGenerationToggles() {
        // Quality toggles
        document.querySelectorAll('.quality-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.imageGenerationState.quality = btn.dataset.quality;
                this.updateToggleButtons();
            });
        });
        
        // Style toggles
        document.querySelectorAll('.style-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.imageGenerationState.style = btn.dataset.style;
                this.updateToggleButtons();
            });
        });
        
        // Model change handler - update available options
        const modelSelect = document.getElementById('image-model-select');
        if (modelSelect) {
            modelSelect.addEventListener('change', (e) => {
                this.updateImageOptionsForModel(e.target.value);
            });
        }
        
        this.updateToggleButtons();
        if (modelSelect) {
            this.updateImageOptionsForModel(modelSelect.value);
        }
    }

    updateToggleButtons() {
        document.querySelectorAll('.quality-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.quality === this.imageGenerationState.quality);
            btn.setAttribute('aria-pressed', btn.dataset.quality === this.imageGenerationState.quality);
        });
        document.querySelectorAll('.style-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.style === this.imageGenerationState.style);
            btn.setAttribute('aria-pressed', btn.dataset.style === this.imageGenerationState.style);
        });
    }

    updateImageOptionsForModel(model) {
        const sizeSelect = document.getElementById('image-size-select');
        const qualityContainer = document.getElementById('image-quality-container');
        const styleContainer = document.getElementById('image-style-container');
        
        if (!sizeSelect) return;

        const selectedModel = this.availableImageModels.find((entry) => entry.id === model) || {};
        const sizes = Array.isArray(selectedModel.sizes) && selectedModel.sizes.length > 0
            ? selectedModel.sizes
            : ['1024x1024'];
        const supportsQuality = Array.isArray(selectedModel.qualities) && selectedModel.qualities.length > 0;
        const supportsStyle = Array.isArray(selectedModel.styles) && selectedModel.styles.length > 0;

        sizeSelect.innerHTML = sizes
            .map((size) => `<option value="${size}">${size}</option>`)
            .join('');

        if (!sizes.includes(sizeSelect.value)) {
            sizeSelect.value = sizes[0];
        }

        if (qualityContainer) qualityContainer.style.display = supportsQuality ? 'block' : 'none';
        if (styleContainer) styleContainer.style.display = supportsStyle ? 'block' : 'none';
    }

    getImageGenerationOptions() {
        const modelSelect = document.getElementById('image-model-select');
        const promptInput = document.getElementById('image-prompt-input');
        const sizeSelect = document.getElementById('image-size-select');
        
        const selectedModel = this.availableImageModels.find((entry) => entry.id === modelSelect?.value)
            || this.availableImageModels.find((entry) => entry.id === this.getPreferredImageModelId())
            || this.availableImageModels[0]
            || {};
        const model = modelSelect?.value || selectedModel.id || '';
        const options = {
            prompt: promptInput?.value?.trim() || '',
            model: model,
            size: sizeSelect?.value || '1024x1024',
            source: this.imageGenerationState.source
        };
        
        if (Array.isArray(selectedModel.qualities) && selectedModel.qualities.includes(this.imageGenerationState.quality)) {
            options.quality = this.imageGenerationState.quality;
        }
        if (Array.isArray(selectedModel.styles) && selectedModel.styles.includes(this.imageGenerationState.style)) {
            options.style = this.imageGenerationState.style;
        }
        
        return options;
    }

    /**
     * Get the current image source
     * @returns {string} - 'generate' or 'unsplash'
     */
    getImageSource() {
        return this.imageGenerationState.source;
    }

    setImageGenerateButtonState(isGenerating) {
        const btn = document.getElementById('image-generate-btn');
        if (!btn) return;
        
        if (isGenerating) {
            btn.disabled = true;
            btn.classList.add('generating');
            btn.setAttribute('aria-busy', 'true');
            btn.innerHTML = `
                <div class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true"></div>
                <span>Generating...</span>
            `;
        } else {
            btn.disabled = false;
            btn.classList.remove('generating');
            btn.setAttribute('aria-busy', 'false');
            btn.innerHTML = `
                <i data-lucide="wand-2" class="w-5 h-5" aria-hidden="true"></i>
                <span>Generate Image</span>
            `;
            this.reinitializeIcons(btn);
        }
    }

    // ============================================
    // Model Selector
    // ============================================

    async loadModels() {
        const modelBtn = document.getElementById('model-selector-btn');
        
        try {
            // Add loading state
            if (modelBtn) modelBtn.classList.add('loading');
            
            const response = await apiClient.getModels();
            const models = Array.isArray(response?.data) ? response.data : [];
            this.availableModels = typeof apiClient.filterChatModels === 'function'
                ? apiClient.filterChatModels(models)
                : models;
            
            // Remove loading state
            if (modelBtn) modelBtn.classList.remove('loading');

            this.updateAssistantModelSelect();
            
            return this.availableModels;
        } catch (error) {
            console.error('Failed to load models:', error);
            
            // Remove loading state
            if (modelBtn) modelBtn.classList.remove('loading');

            this.updateAssistantModelSelect();
            
            return [];
        }
    }

    toggleModelSelector() {
        const dropdown = document.getElementById('model-selector-dropdown');
        if (dropdown.classList.contains('hidden')) {
            this.openModelSelector();
        } else {
            this.closeModelSelector();
        }
    }
    
    updateModelSelectorAria(expanded) {
        const btn = document.getElementById('model-selector-btn');
        if (btn) {
            btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        }
    }

    async openModelSelector() {
        const dropdown = document.getElementById('model-selector-dropdown');
        if (!dropdown) {
            return;
        }

        this.closeSearch({ silent: true });
        this.closeSidebar();
        this.closeMobileActionSheet({ silent: true });
        dropdown.classList.remove('hidden');
        dropdown.setAttribute('aria-hidden', 'false');
        this.playMenuCue('menu-open');
        
        // Update ARIA
        this.updateModelSelectorAria(true);
        
        // Save last focused element
        this.lastFocusedElement = document.activeElement;
        
        // Load models if not already loaded
        if (this.availableModels.length === 0) {
            await this.loadModels();
        }
        
        this.updateAssistantModelSelect();
        this.renderModelList();
        
        // Trap focus
        this.trapFocus(dropdown);
    }

    closeModelSelector(options = {}) {
        const dropdown = document.getElementById('model-selector-dropdown');
        if (!dropdown) {
            return;
        }
        dropdown.classList.add('hidden');
        dropdown.setAttribute('aria-hidden', 'true');

        if (options?.silent !== true) {
            this.playMenuCue('menu-close');
        }
        
        // Update ARIA
        this.updateModelSelectorAria(false);
        
        // Return focus to trigger button
        if (this.lastFocusedElement) {
            this.lastFocusedElement.focus();
            this.lastFocusedElement = null;
        }
    }

    renderModelList() {
        const listContainer = document.getElementById('model-list');
        if (!listContainer) {
            return;
        }

        this.updateAssistantModelSelect();
        
        if (this.availableModels.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state py-4">
                    <p class="text-sm text-text-secondary">No models available</p>
                </div>
            `;
            return;
        }
        
        // Group models by provider
        const grouped = this.groupModelsByProvider(this.availableModels);
        
        listContainer.innerHTML = Object.entries(grouped).map(([provider, models]) => `
            <div class="model-group">
                <div class="model-group-title">${provider}</div>
                ${models.map(model => this.renderModelItem(model)).join('')}
            </div>
        `).join('');
        
        // Attach click handlers
        listContainer.querySelectorAll('.model-item').forEach(item => {
            item.addEventListener('click', () => {
                const modelId = item.dataset.modelId;
                this.selectModel(modelId);
            });
        });
        
        this.reinitializeIcons(listContainer);
    }

    renderModelItem(model) {
        const isActive = model.id === this.currentModel;
        const provider = this.getModelProvider(model);
        const displayName = this.getModelDisplayName(model);
        const description = this.getModelDescription(model);
        
        return `
            <div class="model-item ${isActive ? 'active' : ''}" data-model-id="${model.id}" role="option" aria-selected="${isActive}">
                <div class="model-item-icon ${provider}">
                    <i data-lucide="cpu" class="w-4 h-4" aria-hidden="true"></i>
                </div>
                <div class="model-item-info">
                    <div class="model-item-name">${displayName}</div>
                    <div class="model-item-desc">${description}</div>
                </div>
                <div class="model-item-check" aria-hidden="true">
                    <i data-lucide="check" class="w-4 h-4"></i>
                </div>
            </div>
        `;
    }

    groupModelsByProvider(models) {
        const grouped = {};
        
        models.forEach(model => {
            const provider = this.getModelProviderName(model);
            if (!grouped[provider]) {
                grouped[provider] = [];
            }
            grouped[provider].push(model);
        });
        
        return grouped;
    }

    getModelProvider(model) {
        const id = model.id.toLowerCase();
        if (id.includes('claude')) return 'anthropic';
        if (id.includes('gpt') || id.includes('dall')) return 'openai';
        if (id.includes('gemini') || id.includes('palm')) return 'google';
        if (id.includes('llama') || id.includes('meta')) return 'meta';
        return '';
    }

    getModelProviderName(model) {
        const provider = this.getModelProvider(model);
        const names = {
            'anthropic': 'Anthropic',
            'openai': 'OpenAI',
            'google': 'Google',
            'meta': 'Meta'
        };
        return names[provider] || 'Other';
    }

    getModelDisplayName(model) {
        // Convert model ID to readable name
        const id = model.id;
        const names = {
            'gpt-4o': 'GPT-4o',
            'gpt-4o-mini': 'GPT-4o Mini',
            'gpt-4-turbo': 'GPT-4 Turbo',
            'gpt-4': 'GPT-4',
            'gpt-3.5-turbo': 'GPT-3.5 Turbo',
            'claude-3-opus': 'Claude 3 Opus',
            'claude-3-sonnet': 'Claude 3 Sonnet',
            'claude-3-haiku': 'Claude 3 Haiku',
            'claude-3-5-sonnet': 'Claude 3.5 Sonnet',
            'claude-3.5-sonnet-latest': 'Claude 3.5 Sonnet Latest'
        };
        return names[id] || id;
    }

    getModelDescription(model) {
        const descriptions = {
            'gpt-4o': 'Most capable multimodal model',
            'gpt-4o-mini': 'Fast and affordable',
            'gpt-4-turbo': 'Advanced reasoning',
            'claude-3-opus': 'Powerful reasoning',
            'claude-3-sonnet': 'Balanced performance',
            'claude-3-haiku': 'Fast and efficient',
            'claude-3-5-sonnet': 'Latest and most capable'
        };
        return descriptions[model.id] || model.owned_by || 'AI Model';
    }

    getSelectableModels() {
        const models = Array.isArray(this.availableModels) ? [...this.availableModels] : [];
        if (this.currentModel && !models.some((model) => model?.id === this.currentModel)) {
            models.unshift({ id: this.currentModel, owned_by: '' });
        }
        return models;
    }

    updateAssistantModelSelect() {
        const select = document.getElementById('assistant-model-select');
        if (!select) {
            return;
        }

        const models = this.getSelectableModels();
        if (models.length === 0) {
            select.innerHTML = `<option value="${this.escapeHtmlAttr(this.currentModel)}">${this.escapeHtml(this.getModelDisplayName({ id: this.currentModel }))}</option>`;
            select.value = this.currentModel;
            return;
        }

        select.innerHTML = models.map((model) => {
            const provider = this.getModelProviderName(model);
            const displayName = this.getModelDisplayName(model);
            const optionLabel = provider && provider !== 'Other'
                ? `${displayName} | ${provider}`
                : displayName;
            return `<option value="${this.escapeHtmlAttr(model.id)}">${this.escapeHtml(optionLabel)}</option>`;
        }).join('');
        select.value = this.currentModel;
    }

    toggleModelListVisibility(forceExpanded = null) {
        const toggle = document.getElementById('model-list-toggle');
        const list = document.getElementById('model-list');
        if (!toggle || !list) {
            return;
        }

        const shouldExpand = forceExpanded == null
            ? list.classList.contains('hidden')
            : forceExpanded === true;

        list.classList.toggle('hidden', !shouldExpand);
        toggle.setAttribute('aria-expanded', shouldExpand ? 'true' : 'false');
    }

    selectModel(modelId, options = {}) {
        this.currentModel = modelId;
        window.sessionManager?.safeStorageSet?.('kimibuilt_default_model', modelId);
        this.updateModelUI();
        this.updateAssistantModelSelect();

        if (options?.closeModal !== false) {
            this.closeModelSelector({ silent: true });
        }
        if (options?.playCue !== false) {
            this.playMenuCue('menu-select');
        }
        if (options?.showToast !== false) {
            this.showToast(`Model changed to ${this.getModelDisplayName({ id: modelId })}`, 'success');
        }
        
        // Dispatch event for app to know model changed
        window.dispatchEvent(new CustomEvent('modelChanged', { detail: { modelId } }));
    }

    updateModelUI() {
        const label = document.getElementById('current-model-label');
        const inputLabel = document.getElementById('input-model-label');
        const displayName = this.getModelDisplayName({ id: this.currentModel });
        
        if (label) label.textContent = displayName;
        if (inputLabel) inputLabel.textContent = displayName;
        this.updateAssistantModelSelect();
        this.updateMobileActionSheetUI();
    }

    normalizeReasoningEffort(value) {
        const normalized = String(value || '').trim().toLowerCase();
        return ['low', 'medium', 'high', 'xhigh'].includes(normalized) ? normalized : '';
    }

    getReasoningDisplayLabel(value = this.currentReasoningEffort) {
        const normalized = this.normalizeReasoningEffort(value);
        const labels = {
            '': 'Reasoning: Default',
            low: 'Reasoning: Low',
            medium: 'Reasoning: Medium',
            high: 'Reasoning: High',
            xhigh: 'Reasoning: XHigh',
        };
        return labels[normalized] || labels[''];
    }

    updateReasoningUI() {
        const select = document.getElementById('reasoning-effort-select');
        const inputLabel = document.getElementById('input-reasoning-label');
        const normalized = this.normalizeReasoningEffort(this.currentReasoningEffort);
        const displayLabel = this.getReasoningDisplayLabel(normalized);

        if (select) {
            select.value = normalized;
        }
        if (inputLabel) {
            inputLabel.textContent = displayLabel;
        }
    }

    getCurrentReasoningEffort() {
        return this.normalizeReasoningEffort(this.currentReasoningEffort);
    }

    isRemoteBuildAutonomyApproved() {
        return this.remoteBuildAutonomyApproved === true;
    }

    parseRemoteBuildAutonomyPreference(value) {
        const normalized = String(value ?? '').trim().toLowerCase();
        if (!normalized) {
            return true;
        }

        if (['0', 'false', 'no', 'off'].includes(normalized)) {
            return false;
        }

        return ['1', 'true', 'yes', 'on'].includes(normalized);
    }

    setCurrentReasoningEffort(value) {
        this.currentReasoningEffort = this.normalizeReasoningEffort(value);
        if (this.currentReasoningEffort) {
            window.sessionManager?.safeStorageSet?.('kimibuilt_reasoning_effort', this.currentReasoningEffort);
        } else {
            window.sessionManager?.safeStorageRemove?.('kimibuilt_reasoning_effort');
        }
        this.updateReasoningUI();
        this.playMenuCue('menu-select');
        window.dispatchEvent(new CustomEvent('reasoningChanged', {
            detail: { reasoningEffort: this.currentReasoningEffort || null }
        }));
    }

    updateRemoteBuildAutonomyUI() {
        const button = document.getElementById('remote-autonomy-btn');
        const label = document.getElementById('remote-autonomy-label');
        if (!button) {
            return;
        }

        const enabled = this.isRemoteBuildAutonomyApproved();
        button.classList.toggle('is-active', enabled);
        button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        button.title = enabled
            ? 'Remote server autonomy: On'
            : 'Remote server autonomy: Off';
        if (label) {
            label.textContent = enabled
                ? 'Automatic remote steps: On'
                : 'Automatic remote steps: Off';
        }
    }

    setRemoteBuildAutonomyApproved(value) {
        this.remoteBuildAutonomyApproved = value === true;
        if (this.remoteBuildAutonomyApproved) {
            window.sessionManager?.safeStorageSet?.('kimibuilt_remote_build_autonomy', 'true');
        } else {
            window.sessionManager?.safeStorageSet?.('kimibuilt_remote_build_autonomy', 'false');
        }
        this.updateRemoteBuildAutonomyUI();
        window.dispatchEvent(new CustomEvent('remoteBuildAutonomyChanged', {
            detail: { approved: this.remoteBuildAutonomyApproved }
        }));
    }

    toggleRemoteBuildAutonomy() {
        this.setRemoteBuildAutonomyApproved(!this.isRemoteBuildAutonomyApproved());
        this.playMenuCue('menu-select');
    }

    isSoundCuesEnabled() {
        return this.soundManager?.isEnabled?.() === true;
    }

    isMenuSoundsEnabled() {
        return this.soundManager?.isMenuEnabled?.() === true;
    }

    updateSoundCuesUI() {
        const button = document.getElementById('sound-cues-btn');
        const label = document.getElementById('sound-cues-label');
        const enabled = this.isSoundCuesEnabled();

        if (!button) {
            return;
        }

        button.classList.toggle('is-active', enabled);
        button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        button.title = enabled
            ? 'Robot sound cues: On'
            : 'Robot sound cues: Off';
        if (label) {
            label.textContent = enabled
                ? 'Cute robot cues: On'
                : 'Cute robot cues: Off';
        }
    }

    updateMenuSoundsUI() {
        const button = document.getElementById('menu-sounds-btn');
        const label = document.getElementById('menu-sounds-label');
        const enabled = this.isMenuSoundsEnabled();

        if (!button) {
            return;
        }

        button.classList.toggle('is-active', enabled);
        button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        button.title = enabled
            ? 'Menu motion sounds: On'
            : 'Menu motion sounds: Off';
        if (label) {
            label.textContent = enabled
                ? 'Menu sounds: On'
                : 'Menu sounds: Off';
        }
    }

    setSoundCuesEnabled(value) {
        this.soundManager?.setEnabled?.(value === true);
        this.updateSoundCuesUI();
    }

    setMenuSoundsEnabled(value) {
        this.soundManager?.setMenuEnabled?.(value === true);
        this.updateMenuSoundsUI();
    }

    toggleSoundCues() {
        const nextValue = !this.isSoundCuesEnabled();
        this.setSoundCuesEnabled(nextValue);
        this.showToast(
            nextValue ? 'Robot sound cues enabled' : 'Robot sound cues disabled',
            'success',
            'Sound cues',
        );

        if (nextValue) {
            this.previewSoundCue('response');
        }
    }

    toggleMenuSounds() {
        const nextValue = !this.isMenuSoundsEnabled();
        this.setMenuSoundsEnabled(nextValue);
        this.showToast(
            nextValue ? 'Menu sounds enabled' : 'Menu sounds disabled',
            'success',
            'Menu sounds',
        );

        if (nextValue) {
            this.previewSoundCue('menu-open');
        }
    }

    previewSoundCue(kind = 'response') {
        this.soundManager?.play?.(kind, { preview: true });
    }

    playAgentCue(kind = 'response') {
        this.soundManager?.play?.(kind);
    }

    playMenuCue(kind = 'menu-select') {
        this.soundManager?.play?.(kind);
    }

    playAcknowledgementCue() {
        this.soundManager?.play?.('ack');
    }

    getCurrentModel() {
        return this.currentModel;
    }

    setCurrentModel(modelId) {
        this.currentModel = modelId;
        window.sessionManager?.safeStorageSet?.('kimibuilt_default_model', modelId);
        this.updateModelUI();
    }

    // ============================================
    // Code Highlighting
    // ============================================

    highlightCodeBlocks(container) {
        const codeBlocks = container.querySelectorAll('pre code');
        codeBlocks.forEach(block => {
            if (block.classList.contains('language-mermaid') || block.classList.contains('no-highlight')) {
                return;
            }
            if (window.Prism) {
                try {
                    Prism.highlightElement(block);
                } catch (err) {
                    // Silently skip highlighting for problematic languages
                    console.warn('[UI] Syntax highlighting failed:', err.message);
                }
            }
        });
    }

    async copyCode(button) {
        const code = button.dataset.code;
        
        try {
            await navigator.clipboard.writeText(code);
            
            // Show copied state
            const originalHTML = button.innerHTML;
            button.classList.add('copied');
            button.innerHTML = `
                <i data-lucide="check" class="w-3.5 h-3.5" aria-hidden="true"></i>
                <span>Copied!</span>
            `;
            this.reinitializeIcons(button);
            
            // Revert after 2 seconds
            setTimeout(() => {
                button.classList.remove('copied');
                button.innerHTML = originalHTML;
                this.reinitializeIcons(button);
            }, 2000);
            
        } catch (err) {
            console.error('Failed to copy code:', err);
            this.showToast('Failed to copy code', 'error');
        }
    }

    normalizeMermaidSource(text = '') {
        let source = String(text || '')
            .replace(/\r\n?/g, '\n')
            .trim();

        if (!source) {
            return '';
        }

        source = source.replace(/^```mermaid\s*/i, '');
        source = source.replace(/^```\s*/i, '');
        source = source.replace(/```\s*$/i, '');

        const whitespaceSensitive = /^mindmap\b/i.test(source);

        if (!source.includes('\n') && !whitespaceSensitive && /\s{2,}/.test(source)) {
            source = source
                .split(/\s{2,}/)
                .map((line) => line.trim())
                .filter(Boolean)
                .join('\n');
        }

        source = source
            .replace(/^(flowchart|graph)\s+([A-Za-z]{2})\s+(?=\S)/i, '$1 $2\n')
            .replace(/^(sequenceDiagram|classDiagram|erDiagram|stateDiagram(?:-v2)?|gitGraph|journey|timeline)\s+(?=\S)/i, '$1\n');

        if (!whitespaceSensitive) {
            source = source.replace(
                /\s+(?=(?:style|classDef|class|linkStyle|click|subgraph|end|section|participant|actor|note|title|accTitle|accDescr)\b)/g,
                '\n',
            );
        }

        return source
            .split('\n')
            .flatMap((line) => (
                !whitespaceSensitive && /\s{2,}/.test(line) && !/^\s/.test(line)
                    ? line.split(/\s{2,}/)
                    : [line]
            ))
            .map((line) => line.trimEnd())
            .filter((line, index, lines) => line.trim() || (index > 0 && lines[index - 1].trim()))
            .join('\n')
            .trim();
    }

    getMermaidFilename(baseName = 'diagram', extension = 'mmd') {
        return this.sanitizeDownloadFilename(baseName, 'diagram', extension);
    }

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = this.sanitizeDownloadFilename(filename, 'download');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    async persistGeneratedFile(blob, filename, mimeType = '') {
        if (!window.artifactManager?.persistGeneratedFile) {
            return;
        }

        try {
            await window.artifactManager.persistGeneratedFile(blob, filename, mimeType || blob.type || 'application/octet-stream');
        } catch (error) {
            console.warn('[UI] Failed to persist generated Mermaid file:', error);
        }
    }

    getMermaidSourceFromButton(button) {
        return this.normalizeMermaidSource(button?.dataset?.code || '');
    }

    async downloadMermaidSource(button) {
        const source = this.getMermaidSourceFromButton(button);
        if (!source) {
            this.showToast('No Mermaid source to download', 'error');
            return;
        }

        const filename = this.getMermaidFilename(button?.dataset?.filename || 'diagram', 'mmd');
        const blob = new Blob([source], { type: 'text/plain;charset=utf-8' });
        this.downloadBlob(blob, filename);
        await this.persistGeneratedFile(blob, filename, 'text/plain');
    }

    async svgMarkupToImage(svgMarkup) {
        const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
        const svgUrl = URL.createObjectURL(svgBlob);

        try {
            const image = await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('Failed to load Mermaid SVG'));
                img.src = svgUrl;
            });
            return image;
        } finally {
            URL.revokeObjectURL(svgUrl);
        }
    }

    async createMermaidPdfBlobFromSource(source, title = 'diagram') {
        if (!window.PDFLib?.PDFDocument) {
            throw new Error('PDF library is not available');
        }
        if (typeof mermaid === 'undefined') {
            throw new Error('Mermaid is not available');
        }

        const renderId = `mermaid-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const result = await mermaid.render(renderId, source);
        const image = await this.svgMarkupToImage(result.svg);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(image.naturalWidth || image.width || 1200));
        canvas.height = Math.max(1, Math.ceil(image.naturalHeight || image.height || 800));

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        const pngDataUrl = canvas.toDataURL('image/png');
        const pngBytes = await fetch(pngDataUrl).then((response) => response.arrayBuffer());

        const pdfDoc = await window.PDFLib.PDFDocument.create();
        const pngImage = await pdfDoc.embedPng(pngBytes);

        const margin = 36;
        const pageWidth = Math.max(612, canvas.width + margin * 2);
        const pageHeight = Math.max(792, canvas.height + margin * 2);
        const page = pdfDoc.addPage([pageWidth, pageHeight]);
        const scale = Math.min(
            (pageWidth - margin * 2) / pngImage.width,
            (pageHeight - margin * 2) / pngImage.height,
            1,
        );
        const drawWidth = pngImage.width * scale;
        const drawHeight = pngImage.height * scale;

        page.drawImage(pngImage, {
            x: (pageWidth - drawWidth) / 2,
            y: (pageHeight - drawHeight) / 2,
            width: drawWidth,
            height: drawHeight,
        });

        const pdfBytes = await pdfDoc.save({
            updateFieldAppearances: false,
            useObjectStreams: false,
        });

        return new Blob([pdfBytes], { type: 'application/pdf' });
    }

    async downloadMermaidPdf(button) {
        const source = this.getMermaidSourceFromButton(button);
        if (!source) {
            this.showToast('No Mermaid source to export', 'error');
            return;
        }

        const filename = this.getMermaidFilename(button?.dataset?.filename || 'diagram', 'pdf');

        try {
            const pdfBlob = await this.createMermaidPdfBlobFromSource(source, filename.replace(/\.pdf$/i, ''));
            this.downloadBlob(pdfBlob, filename);
            await this.persistGeneratedFile(pdfBlob, filename, 'application/pdf');
            this.showToast('Mermaid PDF ready', 'success');
        } catch (error) {
            console.error('[UI] Mermaid PDF export failed:', error);
            this.showToast(`Failed to export Mermaid PDF: ${error.message}`, 'error');
        }
    }

    async renderMermaidDiagrams(container = document) {
        if (typeof mermaid === 'undefined') {
            return;
        }

        const targets = Array.from(container.querySelectorAll('.mermaid-render-surface'));
        for (const target of targets) {
            const source = this.normalizeMermaidSource(target.dataset.mermaidSource || '');
            if (!source || target.dataset.mermaidRenderedSource === source) {
                continue;
            }

            const renderId = `mermaid-inline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

            try {
                const result = await mermaid.render(renderId, source);
                target.innerHTML = result.svg;
                target.dataset.mermaidRenderedSource = source;
                if (typeof result.bindFunctions === 'function') {
                    result.bindFunctions(target);
                }
            } catch (error) {
                target.innerHTML = `
                    <div class="mermaid-render-error">Mermaid render failed: ${this.escapeHtml(error.message)}</div>
                    <pre class="mermaid-source-block"><code>${this.escapeHtml(source)}</code></pre>
                `;
                delete target.dataset.mermaidRenderedSource;
            }
        }
    }

    // ============================================
    // Session List Rendering
    // ============================================

    renderSessionsList(sessions, currentSessionId) {
        if (sessions.length === 0) {
            this.sessionsList.innerHTML = `
                <div class="empty-state py-8">
                    <i data-lucide="message-square" class="w-12 h-12 mb-3 text-text-muted" aria-hidden="true"></i>
                    <p class="text-sm text-text-secondary">No conversations yet</p>
                    <p class="text-xs text-text-muted mt-1">Start a new chat to begin</p>
                </div>
            `;
            this.reinitializeIcons(this.sessionsList);
            return;
        }

        this.sessionsList.innerHTML = sessions.map(session => {
            const isActive = session.id === currentSessionId;
            const modeIcon = sessionManager.getSessionModeIcon(session.mode);
            const modeClass = session.mode || 'chat';
            const timeAgo = sessionManager.formatTimestamp(session.updatedAt);
            const messageCount = sessionManager.getMessages(session.id)?.length || 0;
            const workloadSummary = session.workloadSummary || { queued: 0, running: 0, failed: 0 };
            const workloadBadge = workloadSummary.running > 0
                ? `${workloadSummary.running} running`
                : workloadSummary.queued > 0
                    ? `${workloadSummary.queued} queued`
                    : workloadSummary.failed > 0
                        ? `${workloadSummary.failed} failed`
                        : '';
            
            return `
                <div class="session-item ${isActive ? 'active' : ''}" data-session-id="${session.id}" role="button" tabindex="0" aria-label="${this.escapeHtmlAttr(session.title || 'New Chat')}" title="${this.escapeHtmlAttr(session.title || 'New Chat')}">
                    <div class="session-icon ${modeClass}" aria-hidden="true">
                        <i data-lucide="${modeIcon}" class="w-4 h-4 text-white"></i>
                    </div>
                    <div class="session-info sidebar-session-info">
                        <div class="session-title-row">
                            <div class="session-title">${this.escapeHtml(session.title || 'New Chat')}</div>
                            ${workloadBadge ? `<span class="session-workload-badge">${this.escapeHtml(workloadBadge)}</span>` : ''}
                        </div>
                        <div class="session-meta">
                            ${timeAgo} | ${messageCount} message${messageCount !== 1 ? 's' : ''}
                        </div>
                    </div>
                    <div class="session-actions">
                        <button class="btn-icon danger p-1.5 rounded delete-session-btn" data-session-id="${session.id}" title="Delete conversation" aria-label="Delete conversation">
                            <i data-lucide="trash-2" class="w-4 h-4" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        this.reinitializeIcons(this.sessionsList);
        this.attachSessionListeners();
    }

    attachSessionListeners() {
        // Session item clicks (for switching)
        this.sessionsList.querySelectorAll('.session-item').forEach(item => {
            const clickHandler = (e) => {
                // Don't switch if clicking delete button
                if (e.target.closest('.delete-session-btn')) return;
                
                const sessionId = item.dataset.sessionId;
                sessionManager.switchSession(sessionId);
            };
            
            item.addEventListener('click', clickHandler);
            
            // Keyboard support
            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    clickHandler(e);
                }
            });
        });

        // Delete buttons
        this.sessionsList.querySelectorAll('.delete-session-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sessionId = btn.dataset.sessionId;
                this.confirmDeleteSession(sessionId);
            });
        });
    }

    confirmDeleteSession(sessionId) {
        const session = sessionManager.sessions.find(s => s.id === sessionId);
        const title = session?.title || 'this conversation';
        
        if (confirm(`Delete "${title}"?\n\nThis action cannot be undone.`)) {
            sessionManager.deleteSession(sessionId);
            this.showToast('Conversation deleted', 'success');
        }
    }

    // ============================================
    // Connection Status
    // ============================================

    updateConnectionStatus(status) {
        const statusEl = document.getElementById('connection-status');
        const dotEl = document.getElementById('status-dot');
        const textEl = document.getElementById('status-text');

        if (!statusEl || !dotEl || !textEl) return;

        // Remove all status classes
        statusEl.classList.remove('connected', 'connecting', 'disconnected');
        dotEl.classList.remove('connected', 'connecting', 'disconnected');

        switch (status) {
            case 'connected':
                statusEl.classList.add('connected');
                dotEl.classList.add('connected');
                textEl.textContent = 'Connected';
                break;
            case 'connecting':
                statusEl.classList.add('connecting');
                dotEl.classList.add('connecting');
                textEl.textContent = 'Connecting...';
                break;
            case 'disconnected':
            default:
                statusEl.classList.add('disconnected');
                dotEl.classList.add('disconnected');
                textEl.textContent = 'Disconnected';
                break;
        }
    }

    // ============================================
    // Layout Management
    // ============================================

    getDefaultLayoutMode() {
        return window.matchMedia('(max-width: 768px)').matches ? 'minimal' : 'full';
    }

    initLayoutMode(appInstance = null) {
        const savedLayoutMode = this.storageGet(this.layoutPreferenceKey);
        const initialMode = savedLayoutMode === 'minimal' || savedLayoutMode === 'full'
            ? savedLayoutMode
            : this.getDefaultLayoutMode();
        this.applyLayoutMode(initialMode, { persist: false, appInstance });
    }

    isMinimalistMode() {
        return this.layoutMode === 'minimal';
    }

    toggleMinimalistMode(options = {}) {
        const nextMode = this.isMinimalistMode() ? 'full' : 'minimal';
        this.applyLayoutMode(nextMode, { persist: true, ...options });
    }

    applyLayoutMode(mode, options = {}) {
        const normalizedMode = mode === 'minimal' ? 'minimal' : 'full';
        const persist = options.persist !== false;
        const appInstance = options.appInstance || window.chatApp;

        this.layoutMode = normalizedMode;
        this.closeMobileActionSheet();

        document.body.classList.toggle('layout-minimal', normalizedMode === 'minimal');
        document.documentElement.setAttribute('data-layout-mode', normalizedMode);

        if (persist) {
            this.storageSet(this.layoutPreferenceKey, normalizedMode);
        }

        if (normalizedMode === 'minimal') {
            this.closeSidebar();
            this.closeSearch();
            this.closeModelSelector();
            this.ensureMobileMinimalComposer();

            if (appInstance?.workloadsOpen) {
                appInstance.workloadsOpen = false;
            }
            appInstance?.workloadsPanel?.classList.add('hidden');
        }

        this.syncSidebarState();
        this.updateMinimalistToggleUI();
        appInstance?.updateSessionInfo?.();

        if (normalizedMode === 'minimal') {
            setTimeout(() => {
                document.getElementById('message-input')?.focus();
            }, 120);
        }
    }

    ensureMobileMinimalComposer() {
        if (!window.matchMedia('(max-width: 640px)').matches) {
            return;
        }

        const inputArea = document.getElementById('input-area');
        const toggleBtn = document.getElementById('input-toggle-btn');
        const toggleIcon = document.getElementById('input-toggle-icon');
        if (!inputArea) {
            return;
        }

        inputArea.classList.remove('hidden');
        toggleBtn?.classList.remove('input-hidden');

        if (toggleIcon) {
            toggleIcon.setAttribute('data-lucide', 'chevron-down');
            this.reinitializeIcons(toggleBtn || toggleIcon);
        }
    }

    updateMinimalistToggleUI() {
        const isMinimal = this.isMinimalistMode();
        const button = document.getElementById('minimalist-toggle-btn');
        const buttonIcon = document.getElementById('minimalist-toggle-icon');
        const sidebarButton = document.getElementById('minimalist-toggle-sidebar');
        const sidebarButtonIcon = document.getElementById('minimalist-toggle-sidebar-icon');
        const sidebarButtonText = document.getElementById('minimalist-toggle-sidebar-text');
        const buttonTitle = isMinimal ? 'Return to full interface' : 'Enter minimalist mode';
        const iconName = isMinimal ? 'maximize-2' : 'minimize-2';

        if (button) {
            button.setAttribute('title', buttonTitle);
            button.setAttribute('aria-label', buttonTitle);
            button.setAttribute('aria-pressed', isMinimal ? 'true' : 'false');
            button.classList.toggle('is-active', isMinimal);
        }

        if (sidebarButton) {
            sidebarButton.setAttribute('title', buttonTitle);
            sidebarButton.setAttribute('aria-label', buttonTitle);
            sidebarButton.classList.toggle('is-active', isMinimal);
        }

        if (sidebarButtonText) {
            sidebarButtonText.textContent = isMinimal ? 'Full Interface' : 'Focus Mode';
        }

        [buttonIcon, sidebarButtonIcon].forEach((iconNode) => {
            if (!iconNode) return;
            iconNode.setAttribute('data-lucide', iconName);
        });

        this.reinitializeIcons(button || document);
        if (sidebarButton) {
            this.reinitializeIcons(sidebarButton);
        }
        this.updateMobileActionSheetUI();
    }

    syncSidebarState() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        if (!sidebar || !overlay) {
            return;
        }

        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const isOpen = sidebar.classList.contains('open');
        const hidden = this.isMinimalistMode() || (isMobile && !isOpen);

        overlay.classList.toggle('hidden', !isMobile || !isOpen || this.isMinimalistMode());
        sidebar.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    }

    isCompactActionSheetMode() {
        return window.matchMedia('(max-width: 1120px)').matches || this.isMinimalistMode();
    }

    // ============================================
    // Theme Management
    // ============================================

    initTheme() {
        // Check for saved theme or system preference
        const savedTheme = window.sessionManager?.safeStorageGet?.('kimibuilt_theme');
        
        const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        const theme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
        this.setTheme(theme);
        
        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            const hasSavedTheme = window.sessionManager?.safeStorageGet?.('kimibuilt_theme');
            if (!hasSavedTheme) {
                this.setTheme(e.matches ? 'dark' : 'light');
            }
        });
    }

    setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        window.sessionManager?.safeStorageSet?.('kimibuilt_theme', theme);

        // Update theme toggle UI
        const lightIcon = document.getElementById('theme-icon-light');
        const darkIcon = document.getElementById('theme-icon-dark');
        const themeText = document.getElementById('theme-text');
        const prismTheme = document.getElementById('prism-theme');

        if (theme === 'light') {
            lightIcon?.classList.remove('hidden');
            darkIcon?.classList.add('hidden');
            if (themeText) themeText.textContent = 'Light Mode';
            if (prismTheme) prismTheme.setAttribute('href', 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism.min.css');
        } else {
            lightIcon?.classList.add('hidden');
            darkIcon?.classList.remove('hidden');
            if (themeText) themeText.textContent = 'Dark Mode';
            if (prismTheme) prismTheme.setAttribute('href', 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css');
        }

        this.updateMobileActionSheetUI();
    }

    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        this.setTheme(newTheme);
        this.playMenuCue('menu-select');
    }

    // ============================================
    // Input Handling
    // ============================================

    initAutoResize(textarea) {
        const resize = () => {
            textarea.style.height = 'auto';
            const newHeight = Math.min(textarea.scrollHeight, 192);
            textarea.style.height = newHeight + 'px';
        };

        textarea.addEventListener('input', resize);
        
        // Initial resize
        resize();

        return {
            resize,
            reset: () => {
                textarea.style.height = 'auto';
            }
        };
    }

    updateCharCounter(textarea, counter) {
        const maxLength = 4000;
        const length = textarea.value.length;
        counter.textContent = `${length}/${maxLength}`;
        
        if (length > 0) {
            counter.classList.remove('hidden');
        } else {
            counter.classList.add('hidden');
        }

        if (length > maxLength * 0.9) {
            counter.classList.add('text-red-500');
            counter.classList.remove('text-text-secondary');
        } else {
            counter.classList.remove('text-red-500');
            counter.classList.add('text-text-secondary');
        }
    }

    // ============================================
    // Search Functionality
    // ============================================

    openSearch() {
        const searchBar = document.getElementById('search-bar');
        const searchInput = document.getElementById('search-input');
        const searchPanel = searchBar?.querySelector('.search-bar-panel');
        if (!searchBar || !searchInput) {
            return;
        }

        this.closeModelSelector({ silent: true });
        this.closeSidebar();
        this.closeMobileActionSheet({ silent: true });

        this.searchLastFocusedElement = document.activeElement;
        searchBar.classList.remove('hidden');
        searchBar.setAttribute('aria-hidden', 'false');
        this.playMenuCue('menu-open');
        this.trapFocus(searchPanel || searchBar);
        searchInput.focus();
    }

    closeSearch(options = {}) {
        const searchBar = document.getElementById('search-bar');
        const searchInput = document.getElementById('search-input');
        if (!searchBar || !searchInput) {
            return;
        }

        searchBar.classList.add('hidden');
        searchBar.setAttribute('aria-hidden', 'true');
        searchInput.value = '';
        this.clearSearchHighlights();
        this.searchResults = [];
        this.currentSearchIndex = -1;

        if (options?.silent !== true) {
            this.playMenuCue('menu-close');
        }

        if (this.searchLastFocusedElement && typeof this.searchLastFocusedElement.focus === 'function') {
            this.searchLastFocusedElement.focus();
            this.searchLastFocusedElement = null;
        }
    }

    performSearch(query) {
        this.clearSearchHighlights();
        
        if (!query.trim()) {
            this.searchResults = [];
            this.currentSearchIndex = -1;
            this.updateSearchCount();
            return;
        }

        const messages = this.messageContainer.querySelectorAll('.message');
        this.searchResults = [];
        
        messages.forEach((message, messageIndex) => {
            const textEl = message.querySelector('.message-text, .message-image');
            if (!textEl) return;

            const text = textEl.textContent || '';
            const regex = new RegExp(`(${this.escapeRegex(query)})`, 'gi');
            
            if (regex.test(text)) {
                this.searchResults.push({ message, messageIndex, textEl });
                
                // Highlight matches
                this.highlightText(textEl, query);
            }
        });

        this.currentSearchIndex = this.searchResults.length > 0 ? 0 : -1;
        this.updateSearchCount();
        this.navigateToCurrentResult();
    }

    highlightText(element, query) {
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            if (node.parentElement.tagName !== 'CODE' && 
                node.parentElement.tagName !== 'PRE') {
                textNodes.push(node);
            }
        }

        const regex = new RegExp(`(${this.escapeRegex(query)})`, 'gi');
        
        textNodes.forEach(textNode => {
            const text = textNode.textContent;
            if (regex.test(text)) {
                const span = document.createElement('span');
                span.innerHTML = text.replace(regex, '<mark class="search-highlight">$1</mark>');
                textNode.parentNode.replaceChild(span, textNode);
            }
        });
    }

    clearSearchHighlights() {
        const marks = this.messageContainer.querySelectorAll('mark.search-highlight');
        marks.forEach(mark => {
            const parent = mark.parentNode;
            parent.replaceChild(document.createTextNode(mark.textContent), mark);
            parent.normalize();
        });
    }

    navigateSearch(direction) {
        if (this.searchResults.length === 0) return;
        
        this.currentSearchIndex += direction;
        
        if (this.currentSearchIndex < 0) {
            this.currentSearchIndex = this.searchResults.length - 1;
        } else if (this.currentSearchIndex >= this.searchResults.length) {
            this.currentSearchIndex = 0;
        }
        
        this.updateSearchCount();
        this.navigateToCurrentResult();
    }

    navigateToCurrentResult() {
        if (this.currentSearchIndex < 0 || this.searchResults.length === 0) return;
        
        // Remove current highlight from all
        this.messageContainer.querySelectorAll('.search-highlight.current').forEach(el => {
            el.classList.remove('current');
        });
        
        const result = this.searchResults[this.currentSearchIndex];
        if (result) {
            result.message.scrollIntoView({ behavior: 'smooth', block: 'center' });
            result.message.classList.add('highlighted');
            
            // Highlight current match
            const marks = result.textEl.querySelectorAll('mark.search-highlight');
            if (marks.length > 0) {
                marks[0].classList.add('current');
            }
            
            setTimeout(() => {
                result.message.classList.remove('highlighted');
            }, 2000);
        }
    }

    updateSearchCount() {
        const countEl = document.getElementById('search-count');
        if (this.searchResults.length === 0) {
            countEl.textContent = '';
        } else {
            countEl.textContent = `${this.currentSearchIndex + 1} / ${this.searchResults.length}`;
        }
    }

    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ============================================
    // Command Palette
    // ============================================

    openCommandPalette() {
        const palette = document.getElementById('command-palette');
        const input = document.getElementById('command-input');
        palette.classList.remove('hidden');
        palette.setAttribute('aria-hidden', 'false');
        input.value = '';
        input.focus();
        this.renderCommandResults('');
        this.playMenuCue('menu-open');
        
        // Save last focused element
        this.lastFocusedElement = document.activeElement;
        
        // Trap focus
        this.trapFocus(palette);
    }

    closeCommandPalette(options = {}) {
        const palette = document.getElementById('command-palette');
        palette.classList.add('hidden');
        palette.setAttribute('aria-hidden', 'true');

        if (options?.silent !== true) {
            this.playMenuCue('menu-close');
        }
        
        // Return focus to trigger button
        if (this.lastFocusedElement) {
            this.lastFocusedElement.focus();
            this.lastFocusedElement = null;
        }
    }

    renderCommandResults(query) {
        const resultsContainer = document.getElementById('command-results');
        const commands = this.getAvailableCommands();
        
        // Handle slash commands
        if (query.startsWith('/')) {
            this.handleSlashCommand(query);
            return;
        }
        
        let filteredCommands = commands;
        if (query.trim()) {
            const lowerQuery = query.toLowerCase();
            filteredCommands = commands.filter(cmd => 
                cmd.title.toLowerCase().includes(lowerQuery) ||
                cmd.description.toLowerCase().includes(lowerQuery)
            );
        }

        if (filteredCommands.length === 0) {
            resultsContainer.innerHTML = `
                <div class="empty-state py-8">
                    <p class="text-sm text-text-secondary">No commands found</p>
                </div>
            `;
            return;
        }

        // Group commands by category
        const grouped = filteredCommands.reduce((acc, cmd) => {
            acc[cmd.category] = acc[cmd.category] || [];
            acc[cmd.category].push(cmd);
            return acc;
        }, {});

        resultsContainer.innerHTML = Object.entries(grouped).map(([category, cmds]) => `
            <div class="command-group">
                <div class="command-group-title">${category}</div>
                ${cmds.map((cmd, index) => `
                    <div class="command-item ${index === 0 ? 'selected' : ''}" data-action="${cmd.action}" role="option" tabindex="0">
                        <div class="command-item-icon">
                            <i data-lucide="${cmd.icon}" class="w-4 h-4" aria-hidden="true"></i>
                        </div>
                        <div class="command-item-content">
                            <div class="command-item-title">${cmd.title}</div>
                            <div class="command-item-desc">${cmd.description}</div>
                        </div>
                        ${cmd.shortcut ? `<span class="command-item-shortcut">${cmd.shortcut}</span>` : ''}
                    </div>
                `).join('')}
            </div>
        `).join('');

        this.reinitializeIcons(resultsContainer);
        
        // Attach click handlers
        resultsContainer.querySelectorAll('.command-item').forEach(item => {
            item.addEventListener('click', () => {
                this.executeCommand(item.dataset.action);
            });
            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.executeCommand(item.dataset.action);
                }
            });
        });
    }

    handleSlashCommand(query) {
        const resultsContainer = document.getElementById('command-results');
        const parts = query.slice(1).split(' ');
        const command = parts[0];
        const args = parts.slice(1).join(' ');
        
        if (command === 'model' && args) {
            // Show model selection results
            const matchingModels = this.availableModels.filter(m => 
                m.id.toLowerCase().includes(args.toLowerCase()) ||
                this.getModelDisplayName(m).toLowerCase().includes(args.toLowerCase())
            );
            
            if (matchingModels.length > 0) {
                resultsContainer.innerHTML = `
                    <div class="command-group">
                        <div class="command-group-title">Matching Models</div>
                        ${matchingModels.map((model, index) => `
                            <div class="command-item ${index === 0 ? 'selected' : ''}" data-action="set-model:${model.id}" role="option" tabindex="0">
                                <div class="command-item-icon">
                                    <i data-lucide="cpu" class="w-4 h-4" aria-hidden="true"></i>
                                </div>
                                <div class="command-item-content">
                                    <div class="command-item-title">${this.getModelDisplayName(model)}</div>
                                    <div class="command-item-desc">${this.getModelDescription(model)}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
            } else {
                resultsContainer.innerHTML = `
                    <div class="empty-state py-8">
                        <p class="text-sm text-text-secondary">No matching models found</p>
                    </div>
                `;
            }
        } else if (command === 'models' || (command === 'model' && !args)) {
            // Show all models
            this.renderModelCommands(resultsContainer);
        } else if (command === 'image') {
            resultsContainer.innerHTML = `
                <div class="command-group">
                    <div class="command-group-title">Image Generation</div>
                    <div class="command-item selected" data-action="open-image-modal" role="option" tabindex="0">
                        <div class="command-item-icon">
                            <i data-lucide="image" class="w-4 h-4" aria-hidden="true"></i>
                        </div>
                        <div class="command-item-content">
                            <div class="command-item-title">Open Image Generator</div>
                            <div class="command-item-desc">Create AI-generated images</div>
                        </div>
                    </div>
                </div>
            `;
        } else if (command === 'tools' || command === 'tool') {
            resultsContainer.innerHTML = `
                <div class="command-group">
                    <div class="command-group-title">Tools</div>
                    <div class="command-item selected" data-action="insert-tool-command:${command === 'tool' ? '/tool ' : '/tools'}" role="option" tabindex="0">
                        <div class="command-item-icon">
                            <i data-lucide="wrench" class="w-4 h-4" aria-hidden="true"></i>
                        </div>
                        <div class="command-item-content">
                            <div class="command-item-title">${command === 'tool' ? 'Invoke Tool Command' : 'List Available Tools'}</div>
                            <div class="command-item-desc">${command === 'tool' ? 'Insert /tool <id> {json} into the chat input' : 'Insert /tools into the chat input'}</div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            resultsContainer.innerHTML = `
                <div class="empty-state py-8">
                    <p class="text-sm text-text-secondary">Unknown command. Try /model, /models, /image, or /tools</p>
                </div>
            `;
        }
        
        this.reinitializeIcons(resultsContainer);
        resultsContainer.querySelectorAll('.command-item').forEach(item => {
            item.addEventListener('click', () => {
                this.executeCommand(item.dataset.action);
            });
            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.executeCommand(item.dataset.action);
                }
            });
        });
    }

    renderModelCommands(container) {
        if (this.availableModels.length === 0) {
            container.innerHTML = `
                <div class="empty-state py-8">
                    <p class="text-sm text-text-secondary">Loading models...</p>
                </div>
            `;
            // Load models in background
            this.loadModels().then(() => {
                this.renderModelCommands(container);
            });
            return;
        }
        
        const grouped = this.groupModelsByProvider(this.availableModels);
        
        container.innerHTML = Object.entries(grouped).map(([provider, models]) => `
            <div class="command-group">
                <div class="command-group-title">${provider}</div>
                ${models.map((model, index) => `
                    <div class="command-item ${model.id === this.currentModel ? 'selected' : ''}" data-action="set-model:${model.id}" role="option" tabindex="0">
                        <div class="command-item-icon">
                            <i data-lucide="cpu" class="w-4 h-4" aria-hidden="true"></i>
                        </div>
                        <div class="command-item-content">
                            <div class="command-item-title">${this.getModelDisplayName(model)}</div>
                            <div class="command-item-desc">${this.getModelDescription(model)}</div>
                        </div>
                        ${model.id === this.currentModel ? `<i data-lucide="check" class="w-4 h-4 text-accent" aria-hidden="true"></i>` : ''}
                    </div>
                `).join('')}
            </div>
        `).join('');
    }

    getAvailableCommands() {
        const currentSession = sessionManager.currentSessionId;
        const hasMessages = currentSession && sessionManager.getMessages(currentSession).length > 0;
        
        return [
            { category: 'Actions', icon: 'plus', title: 'New Chat', description: 'Start a new conversation', action: 'new-chat', shortcut: 'Ctrl+N' },
            { category: 'Actions', icon: 'image', title: 'Create Image', description: 'Generate AI images or search Unsplash', action: 'open-image-modal', shortcut: 'Ctrl+I' },
            { category: 'Actions', icon: 'camera', title: 'Search Unsplash', description: 'Find free stock photos', action: 'open-image-modal:unsplash' },
            { category: 'Actions', icon: 'wrench', title: 'List Tools', description: 'Insert the /tools command into chat', action: 'insert-tool-command:/tools' },
            { category: 'Actions', icon: 'folder-open', title: 'Open File Manager', description: 'View and manage session files', action: 'open-file-manager', shortcut: 'Ctrl+Shift+F' },
            { category: 'Actions', icon: 'search', title: 'Search Messages', description: 'Search in current conversation', action: 'search', shortcut: 'Ctrl+F' },
            { category: 'Actions', icon: 'keyboard', title: 'Keyboard Shortcuts', description: 'View all keyboard shortcuts', action: 'show-shortcuts' },
            { category: 'Model', icon: 'cpu', title: 'Change Model', description: 'Select a different AI model', action: 'open-model-selector' },
            { category: 'Navigation', icon: 'sidebar', title: 'Toggle Sidebar', description: 'Show or hide the sidebar', action: 'toggle-sidebar', shortcut: 'Ctrl+B' },
            { category: 'View', icon: 'minimize-2', title: this.isMinimalistMode() ? 'Return to Full Interface' : 'Enter Minimalist Mode', description: 'Switch between the full workspace and a chat-first view', action: 'toggle-minimalist-mode', shortcut: 'Ctrl+Shift+M' },
            { category: 'View', icon: 'minimize-2', title: 'Toggle Input Area', description: 'Show or hide the message input', action: 'toggle-input-area', shortcut: 'Ctrl+Shift+H' },
            { category: 'View', icon: 'sun', title: 'Toggle Theme', description: 'Switch between light and dark mode', action: 'toggle-theme' },
            ...(hasMessages ? [
                { category: 'Export', icon: 'download', title: 'Export as Markdown', description: 'Download conversation as .md file', action: 'export-md' },
                { category: 'Export', icon: 'download', title: 'Export as JSON', description: 'Download conversation as .json file', action: 'export-json' },
                { category: 'Export', icon: 'download', title: 'Export as Text', description: 'Download conversation as .txt file', action: 'export-txt' },
                { category: 'Export', icon: 'globe', title: 'Export as HTML', description: 'Download conversation as .html file', action: 'export-html' },
                { category: 'Export', icon: 'file-type', title: 'Export as Word (DOCX)', description: 'Download conversation as .docx file', action: 'export-docx' },
                { category: 'Export', icon: 'file-box', title: 'Export as PDF', description: 'Download conversation as .pdf file', action: 'export-pdf' },
            ] : []),
            { category: 'Data', icon: 'upload', title: 'Import Conversation', description: 'Import from DOCX, PDF, HTML, MD, TXT, or JSON', action: 'import-conversations' },
            ...(currentSession ? [
                { category: 'Session', icon: 'trash-2', title: 'Clear Messages', description: 'Clear all messages in current session', action: 'clear-messages' },
                { category: 'Session', icon: 'x-circle', title: 'Delete Session', description: 'Delete current conversation', action: 'delete-session' },
            ] : []),
        ];
    }

    executeCommand(action) {
        this.closeCommandPalette({ silent: true });
        this.playMenuCue('menu-select');
        
        // Handle set-model action
        if (action.startsWith('set-model:')) {
            const modelId = action.split(':')[1];
            this.selectModel(modelId);
            return;
        }
        
        // Handle open-image-modal with source
        if (action.startsWith('open-image-modal')) {
            const source = action.split(':')[1] || 'generate';
            this.openImageModal();
            this.setImageSource(source);
            return;
        }

        if (action.startsWith('insert-tool-command:')) {
            const command = action.slice('insert-tool-command:'.length);
            const input = document.getElementById('message-input');
            if (input) {
                input.value = command;
                input.focus();
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return;
        }
        
        switch (action) {
            case 'new-chat':
                window.chatApp?.createNewSession();
                break;
            case 'search':
                this.openSearch();
                break;
            case 'toggle-sidebar':
                this.toggleSidebar();
                break;
            case 'toggle-minimalist-mode':
                this.toggleMinimalistMode();
                break;
            case 'toggle-input-area':
                this.toggleInputArea();
                break;
            case 'toggle-theme':
                this.toggleTheme();
                break;
            case 'export-md':
                window.chatApp?.exportConversation('markdown');
                break;
            case 'export-json':
                window.chatApp?.exportConversation('json');
                break;
            case 'export-txt':
                window.chatApp?.exportConversation('txt');
                break;
            case 'export-html':
                window.chatApp?.exportConversation('html');
                break;
            case 'export-docx':
                window.chatApp?.exportConversation('docx');
                break;
            case 'export-pdf':
                window.chatApp?.exportConversation('pdf');
                break;
            case 'clear-messages':
                window.chatApp?.clearCurrentSession();
                break;
            case 'delete-session':
                if (sessionManager.currentSessionId) {
                    this.confirmDeleteSession(sessionManager.currentSessionId);
                }
                break;
            case 'open-file-manager':
                if (window.fileManager) {
                    window.fileManager.open();
                }
                break;
            case 'open-model-selector':
                this.openModelSelector();
                break;
            case 'show-shortcuts':
                this.openShortcutsModal();
                break;
            case 'import-conversations':
                this.openImportModal();
                break;
        }
    }

    // ============================================
    // Keyboard Shortcuts Help
    // ============================================

    openShortcutsModal() {
        // Close any existing shortcuts modal first
        this.closeShortcutsModal();
        
        // Save last focused element
        this.lastFocusedElement = document.activeElement;
        
        const modal = document.createElement('div');
        modal.id = 'shortcuts-modal';
        modal.className = 'modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'shortcuts-title');
        
        const shortcuts = [
            { key: 'Ctrl + K', description: 'Open command palette' },
            { key: 'Ctrl + N', description: 'New chat' },
            { key: 'Ctrl + F', description: 'Search messages' },
            { key: 'Ctrl + I', description: 'Create image (AI or Unsplash)' },
            { key: 'Ctrl + B', description: 'Toggle sidebar' },
            { key: 'Ctrl + Shift + M', description: 'Toggle minimalist mode' },
            { key: 'Ctrl + Shift + H', description: 'Toggle input area' },
            { key: 'Shift + Enter', description: 'New line in input' },
            { key: 'Enter', description: 'Send message' },
            { key: 'Esc', description: 'Close modals/panels' },
            { key: '?', description: 'Show this help' },
            { key: '', description: '' },
            { key: 'Commands', description: '/image [prompt] - Generate AI images' },
            { key: '', description: '/unsplash [query] - Search stock photos' },
            { key: '', description: '/model [name] - Change AI model' },
            { key: '', description: '/clear - Clear conversation' },
            { key: '', description: '' },
            { key: 'Import/Export', description: 'Supports DOCX, PDF, HTML, Markdown, TXT, and JSON formats' },
        ];
        
        modal.innerHTML = `
            <div class="modal-overlay" onclick="uiHelpers.closeShortcutsModal()"></div>
            <div class="modal-content" style="max-width: 480px;">
                <div class="modal-header">
                    <h3 id="shortcuts-title">Keyboard Shortcuts</h3>
                    <button class="btn-icon" onclick="uiHelpers.closeShortcutsModal()" aria-label="Close keyboard shortcuts help">
                        <i data-lucide="x" class="w-5 h-5" aria-hidden="true"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="shortcuts-list" role="list">
                        ${shortcuts.map(s => s.key ? `
                            <div class="shortcut-item" role="listitem">
                                <kbd class="shortcut-key">${s.key}</kbd>
                                <span class="shortcut-desc">${s.description}</span>
                            </div>
                        ` : `<div class="shortcut-item" style="background: transparent; border: none;"><span class="shortcut-desc" style="font-weight: 600; color: var(--text-primary);">${s.description}</span></div>`).join('')}
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        this.reinitializeIcons(modal);
        this.trapFocus(modal);
        
        // Close on escape
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeShortcutsModal();
            }
        });
    }

    closeShortcutsModal() {
        const modal = document.getElementById('shortcuts-modal');
        if (modal) {
            modal.remove();
        }
        
        // Return focus to trigger button
        if (this.lastFocusedElement) {
            this.lastFocusedElement.focus();
            this.lastFocusedElement = null;
        }
    }

    // ============================================
    // Import Modal - Enhanced with multiple formats
    // ============================================

    openImportModal() {
        // Remove any existing import modal
        this.closeImportModal();
        
        // Show the new import modal from HTML
        const modal = document.getElementById('import-modal');
        if (modal) {
            modal.classList.remove('hidden');
            modal.setAttribute('aria-hidden', 'false');
            
            // Save last focused element
            this.lastFocusedElement = document.activeElement;
            
            this.setupImportHandlers(modal);
            this.trapFocus(modal);
        }
    }

    setupImportHandlers(modal) {
        const dropzone = modal.querySelector('#import-dropzone');
        const fileInput = modal.querySelector('#import-file-input');
        
        if (!dropzone || !fileInput) return;
        
        // Reset state
        this.pendingImport = null;
        this.pendingImportFormat = null;
        this.resetImportUI(modal);
        
        dropzone.addEventListener('click', () => fileInput.click());
        
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });
        
        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('dragover');
        });
        
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleImportFile(files[0]);
            }
        });
        
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleImportFile(e.target.files[0]);
            }
        });
        
        // Close on escape
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeImportModal();
            }
        });
    }

    resetImportUI(modal) {
        const preview = modal.querySelector('#import-preview');
        const error = modal.querySelector('#import-error');
        const progress = modal.querySelector('#import-progress');
        const confirmBtn = modal.querySelector('#import-confirm-btn');
        
        preview?.classList.add('hidden');
        error?.classList.add('hidden');
        progress?.classList.add('hidden');
        if (confirmBtn) confirmBtn.disabled = true;
    }

    async handleImportFile(file) {
        const modal = document.getElementById('import-modal');
        const progress = modal?.querySelector('#import-progress');
        const progressText = modal?.querySelector('#import-progress-text');
        const errorDiv = modal?.querySelector('#import-error');
        const errorText = modal?.querySelector('#import-error-text');
        
        // Show progress
        progress?.classList.remove('hidden');
        errorDiv?.classList.add('hidden');
        
        try {
            const result = await window.importExportManager.importFile(file, (percent, message) => {
                if (progressText) {
                    progressText.textContent = message || `Processing... ${percent}%`;
                }
            });
            
            this.pendingImport = result;
            this.showImportPreview(result, file.name);
        } catch (error) {
            progress?.classList.add('hidden');
            if (errorText) errorText.textContent = error.message;
            errorDiv?.classList.remove('hidden');
        }
    }

    showImportPreview(result, filename) {
        const modal = document.getElementById('import-modal');
        const preview = modal?.querySelector('#import-preview');
        const filenameEl = modal?.querySelector('#import-filename');
        const statsEl = modal?.querySelector('#import-stats');
        const messagesPreviewEl = modal?.querySelector('#import-messages-preview');
        const confirmBtn = modal?.querySelector('#import-confirm-btn');
        const progress = modal?.querySelector('#import-progress');
        
        if (!preview) return;
        
        progress?.classList.add('hidden');
        
        // Update filename
        if (filenameEl) filenameEl.textContent = filename;
        
        // Update stats
        if (statsEl) {
            const formatLabels = {
                docx: 'Word Document',
                pdf: 'PDF Document',
                html: 'HTML Page',
                markdown: 'Markdown',
                txt: 'Text File',
                json: 'JSON Export'
            };
            
            statsEl.innerHTML = `
                <div class="import-stat">
                    <span class="import-stat-value">${result.messages.length}</span>
                    <span class="import-stat-label">Messages</span>
                </div>
                <div class="import-stat">
                    <span class="import-stat-value">${formatLabels[result.format] || result.format.toUpperCase()}</span>
                    <span class="import-stat-label">Format</span>
                </div>
                ${result.pageCount ? `
                <div class="import-stat">
                    <span class="import-stat-value">${result.pageCount}</span>
                    <span class="import-stat-label">Pages</span>
                </div>
                ` : ''}
            `;
        }
        
        // Show message preview (first 5 messages)
        if (messagesPreviewEl) {
            const previewMessages = result.messages.slice(0, 5);
            messagesPreviewEl.innerHTML = previewMessages.map(msg => `
                <div class="import-preview-message ${msg.role}">
                    <span class="import-preview-message-role">${msg.role}</span>
                    <span class="import-preview-message-content">${this.escapeHtml(msg.content.substring(0, 100))}${msg.content.length > 100 ? '...' : ''}</span>
                </div>
            `).join('');
            
            if (result.messages.length > 5) {
                messagesPreviewEl.innerHTML += `
                    <div style="text-align: center; padding: 0.5rem; color: var(--text-secondary); font-size: 0.75rem;">
                        + ${result.messages.length - 5} more messages
                    </div>
                `;
            }
        }
        
        preview.classList.remove('hidden');
        if (confirmBtn) confirmBtn.disabled = false;
    }

    async confirmImport() {
        if (!this.pendingImport || !this.pendingImport.messages.length) return;
        
        const modal = document.getElementById('import-modal');
        const confirmBtn = modal?.querySelector('#import-confirm-btn');
        
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = '<span class="animate-spin inline-block mr-2">...</span> Importing...';
        }
        
        try {
            // Create a new session for the imported conversation
            await window.chatApp.createNewSession();
            const sessionId = sessionManager.currentSessionId;
            
            if (!sessionId) {
                throw new Error('Failed to create session');
            }
            
            // Add messages to the session
            for (const msg of this.pendingImport.messages) {
                sessionManager.addMessage(sessionId, {
                    role: msg.role,
                    content: msg.content,
                    type: msg.type || null,
                    prompt: msg.prompt || null,
                    imageUrl: msg.imageUrl || null,
                    model: msg.model || null,
                    timestamp: msg.timestamp || new Date().toISOString()
                });
            }
            
            // Update session title if available
            if (this.pendingImport.title) {
                const session = sessionManager.sessions.find(s => s.id === sessionId);
                if (session) {
                    session.title = this.pendingImport.title;
                    sessionManager.saveToStorage();
                }
            }
            
            // Refresh the UI
            window.chatApp.loadSessionMessages(sessionId);
            window.chatApp.updateSessionInfo();
            uiHelpers.renderSessionsList(sessionManager.sessions, sessionId);
            
            this.showToast(`Imported ${this.pendingImport.messages.length} messages`, 'success');
            this.closeImportModal();
        } catch (error) {
            this.showToast(`Import failed: ${error.message}`, 'error');
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Import Conversation';
            }
        }
    }

    closeImportModal() {
        const modal = document.getElementById('import-modal');
        if (modal) {
            modal.classList.add('hidden');
            modal.setAttribute('aria-hidden', 'true');
        }
        this.pendingImport = null;
        this.pendingImportFormat = null;
        
        // Reset file input
        const fileInput = modal?.querySelector('#import-file-input');
        if (fileInput) fileInput.value = '';
    }

    // ============================================
    // Export Modal - Enhanced with progress
    // ============================================

    openExportModal() {
        if (!sessionManager.currentSessionId) {
            this.showToast('No active conversation to export', 'warning');
            return;
        }
        
        const modal = document.getElementById('export-modal');
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        
        // Hide progress
        const progress = modal.querySelector('#export-progress');
        if (progress) progress.classList.add('hidden');
        
        // Check if we need to add export all option
        const exportOptions = modal.querySelector('.export-options');
        if (exportOptions && sessionManager.sessions.length > 1) {
            if (!exportOptions.querySelector('[data-action="export-all"]')) {
                const exportAllBtn = document.createElement('button');
                exportAllBtn.className = 'export-option';
                exportAllBtn.setAttribute('data-action', 'export-all');
                exportAllBtn.setAttribute('onclick', 'app.exportAllConversations()');
                exportAllBtn.innerHTML = `
                    <i data-lucide="archive" class="w-8 h-8 text-orange-500"></i>
                    <span class="export-name">All Conversations</span>
                    <span class="export-desc">Export all sessions as JSON</span>
                `;
                exportOptions.appendChild(exportAllBtn);
                this.reinitializeIcons(exportAllBtn);
            }
        }
        
        this.trapFocus(modal);
    }

    showExportProgress(percent, message) {
        const modal = document.getElementById('export-modal');
        const progress = modal?.querySelector('#export-progress');
        const progressText = modal?.querySelector('#export-progress-text');
        const progressPercent = modal?.querySelector('#export-progress-percent');
        const progressFill = modal?.querySelector('#export-progress-fill');
        
        if (progress) progress.classList.remove('hidden');
        if (progressText) progressText.textContent = message || 'Exporting...';
        if (progressPercent) progressPercent.textContent = `${percent}%`;
        if (progressFill) progressFill.style.width = `${percent}%`;
    }

    hideExportProgress() {
        const modal = document.getElementById('export-modal');
        const progress = modal?.querySelector('#export-progress');
        if (progress) progress.classList.add('hidden');
    }

    closeExportModal() {
        const modal = document.getElementById('export-modal');
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
        this.hideExportProgress();
    }

    // ============================================
    // Toast Notifications
    // ============================================

    showToast(message, type = 'info', title = '') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'polite');

        const icons = {
            success: 'check-circle',
            error: 'x-circle',
            warning: 'alert-triangle',
            info: 'info'
        };

        const icon = icons[type] || icons.info;

        toast.innerHTML = `
            <div class="toast-icon" aria-hidden="true">
                <i data-lucide="${icon}" class="w-5 h-5"></i>
            </div>
            <div class="toast-content">
                ${title ? `<div class="toast-title">${title}</div>` : ''}
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close" aria-label="Close notification">
                <i data-lucide="x" class="w-4 h-4" aria-hidden="true"></i>
            </button>
        `;

        container.appendChild(toast);
        this.reinitializeIcons(toast);

        // Close button handler
        toast.querySelector('.toast-close').addEventListener('click', () => {
            this.removeToast(toast);
        });

        // Auto-remove after 5 seconds
        setTimeout(() => {
            this.removeToast(toast);
        }, 5000);
    }

    removeToast(toast) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }

    // ============================================
    // Scroll & View Utilities
    // ============================================

    scrollToBottom(smooth = true) {
        this.messageContainer.scrollTo({
            top: this.messageContainer.scrollHeight,
            behavior: smooth ? 'smooth' : 'auto'
        });
    }

    hideWelcomeMessage() {
        const welcome = document.getElementById('welcome-message');
        if (welcome) {
            welcome.style.display = 'none';
        }
    }

    showWelcomeMessage() {
        const welcome = document.getElementById('welcome-message');
        if (welcome) {
            welcome.style.display = 'flex';
        }
    }

    clearMessages() {
        const welcome = document.getElementById('welcome-message');
        this.messageContainer.innerHTML = '';
        if (welcome) {
            this.messageContainer.appendChild(welcome);
            this.showWelcomeMessage();
        }
    }

    // ============================================
    // Typing Indicator
    // ============================================

    showTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        indicator.classList.remove('hidden');
        indicator.setAttribute('aria-hidden', 'false');
    }

    hideTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        indicator.classList.add('hidden');
        indicator.setAttribute('aria-hidden', 'true');
    }

    // ============================================
    // Mobile Sidebar
    // ============================================

    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        if (this.isMinimalistMode()) {
            this.applyLayoutMode('full');
        }

        sidebar.classList.toggle('open');
        this.syncSidebarState();
    }

    closeSidebar() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        sidebar.classList.remove('open');
        this.syncSidebarState();
    }

    toggleMobileActionSheet() {
        const menu = document.getElementById('mobile-chat-menu');
        if (!menu) {
            return;
        }

        if (menu.classList.contains('hidden')) {
            this.openMobileActionSheet();
        } else {
            this.closeMobileActionSheet();
        }
    }

    openMobileActionSheet() {
        const menu = document.getElementById('mobile-chat-menu');
        const sheet = menu?.querySelector('.mobile-chat-menu__sheet');
        const trigger = document.getElementById('mobile-chat-menu-btn');
        const allowCompactActionSheet = this.isCompactActionSheetMode();
        if (!menu || !sheet || !allowCompactActionSheet) {
            return;
        }

        this.closeSidebar();
        this.closeSearch({ silent: true });
        this.closeModelSelector({ silent: true });
        this.updateMobileActionSheetUI();

        this.lastFocusedElement = document.activeElement;
        menu.classList.remove('hidden');
        menu.setAttribute('aria-hidden', 'false');
        document.body.classList.add('mobile-chat-menu-open');
        trigger?.setAttribute('aria-expanded', 'true');
        this.playMenuCue('menu-open');
        this.trapFocus(sheet);
    }

    closeMobileActionSheet(options = {}) {
        const menu = document.getElementById('mobile-chat-menu');
        const trigger = document.getElementById('mobile-chat-menu-btn');
        if (!menu) {
            return;
        }

        menu.classList.add('hidden');
        menu.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('mobile-chat-menu-open');
        trigger?.setAttribute('aria-expanded', 'false');

        if (options?.silent !== true) {
            this.playMenuCue('menu-close');
        }

        if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
            this.lastFocusedElement.focus();
            this.lastFocusedElement = null;
        }
    }

    updateMobileActionSheetUI() {
        const modelValue = document.getElementById('mobile-chat-menu-model-value');
        const themeValue = document.getElementById('mobile-chat-menu-theme-value');
        const layoutIcon = document.getElementById('mobile-chat-menu-layout-icon');
        const layoutLabel = document.getElementById('mobile-chat-menu-layout-label');
        const layoutValue = document.getElementById('mobile-chat-menu-layout-value');
        const displayName = this.getModelDisplayName({ id: this.currentModel });
        const reasoningLabel = this.getReasoningDisplayLabel(this.getCurrentReasoningEffort()).replace('Reasoning: ', '');
        const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
        const isMinimal = this.isMinimalistMode();

        if (modelValue) {
            modelValue.textContent = `${displayName} | ${reasoningLabel}`;
        }

        if (themeValue) {
            themeValue.textContent = theme === 'light' ? 'Light mode' : 'Dark mode';
        }

        if (layoutLabel) {
            layoutLabel.textContent = isMinimal ? 'Full interface' : 'Focus mode';
        }

        if (layoutValue) {
            layoutValue.textContent = isMinimal ? 'Bring back menus and tools' : 'Show chat first';
        }

        if (layoutIcon) {
            layoutIcon.setAttribute('data-lucide', isMinimal ? 'maximize-2' : 'minimize-2');
            this.reinitializeIcons(layoutIcon.parentElement || layoutIcon);
        }
    }

    handleMobileActionSheetAction(action = '') {
        this.closeMobileActionSheet({ silent: true });

        switch (action) {
            case 'search':
                this.openSearch();
                break;
            case 'models':
                this.openModelSelector();
                break;
            case 'workloads':
                window.chatApp?.toggleWorkloadsPanel();
                break;
            case 'files':
                window.fileManager?.open?.();
                break;
            case 'export':
                this.openExportModal();
                break;
            case 'theme':
                this.toggleTheme();
                break;
            case 'layout':
                this.playMenuCue('menu-select');
                this.toggleMinimalistMode();
                break;
            case 'clear':
                this.playMenuCue('menu-select');
                window.chatApp?.clearCurrentSession();
                break;
            default:
                break;
        }
    }

    // ============================================
    // Icon Management
    // ============================================

    reinitializeIcons(container = document) {
        if (window.lucide) {
            lucide.createIcons({ attrs: { 'stroke-width': 2 }, parent: container });
        }
    }

    // ============================================
    // Accessibility - Focus Trap
    // ============================================

    trapFocus(element) {
        const focusableElements = element.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        
        if (focusableElements.length === 0) return;
        
        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];
        
        // Focus first element
        firstFocusable.focus();
        
        element.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;
            
            if (e.shiftKey) {
                if (document.activeElement === firstFocusable) {
                    lastFocusable.focus();
                    e.preventDefault();
                }
            } else {
                if (document.activeElement === lastFocusable) {
                    firstFocusable.focus();
                    e.preventDefault();
                }
            }
        });
    }

    // ============================================
    // Event Listeners
    // ============================================

    setupEventListeners() {
        // Search input
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.performSearch(e.target.value);
            });
        }

        const reasoningSelect = document.getElementById('reasoning-effort-select');
        if (reasoningSelect) {
            reasoningSelect.addEventListener('change', (e) => {
                this.setCurrentReasoningEffort(e.target.value);
            });
        }

        const assistantModelSelect = document.getElementById('assistant-model-select');
        if (assistantModelSelect) {
            assistantModelSelect.addEventListener('change', (e) => {
                this.selectModel(e.target.value, { closeModal: false, showToast: true, playCue: true });
            });
        }

        const remoteAutonomyBtn = document.getElementById('remote-autonomy-btn');
        if (remoteAutonomyBtn) {
            remoteAutonomyBtn.addEventListener('click', () => {
                this.toggleRemoteBuildAutonomy();
            });
        }

        const modelListToggle = document.getElementById('model-list-toggle');
        if (modelListToggle) {
            modelListToggle.addEventListener('click', () => {
                this.toggleModelListVisibility();
                this.playMenuCue('menu-select');
            });
        }

        const soundCuesBtn = document.getElementById('sound-cues-btn');
        if (soundCuesBtn) {
            soundCuesBtn.addEventListener('click', () => {
                this.toggleSoundCues();
            });
        }

        const menuSoundsBtn = document.getElementById('menu-sounds-btn');
        if (menuSoundsBtn) {
            menuSoundsBtn.addEventListener('click', () => {
                this.toggleMenuSounds();
            });
        }

        document.querySelectorAll('[data-sound-preview]').forEach((button) => {
            button.addEventListener('click', () => {
                this.previewSoundCue(button.dataset.soundPreview || 'response');
            });
        });

        const minimalistButtons = [
            document.getElementById('minimalist-toggle-btn'),
            document.getElementById('minimalist-toggle-sidebar'),
        ].filter(Boolean);
        minimalistButtons.forEach((button) => {
            button.addEventListener('click', () => {
                this.toggleMinimalistMode();
            });
        });

        document.getElementById('mobile-chat-menu-btn')?.addEventListener('click', () => {
            this.toggleMobileActionSheet();
        });

        document.getElementById('mobile-chat-menu')?.addEventListener('click', (event) => {
            const actionNode = event.target.closest('[data-mobile-menu-action]');
            if (actionNode) {
                this.handleMobileActionSheetAction(actionNode.dataset.mobileMenuAction || '');
                return;
            }

            if (event.target.closest('[data-mobile-menu-close="true"]')) {
                this.closeMobileActionSheet();
            }
        });

        // Command palette input
        const commandInput = document.getElementById('command-input');
        if (commandInput) {
            commandInput.addEventListener('input', (e) => {
                this.renderCommandResults(e.target.value);
            });

            // Keyboard navigation for command palette
            commandInput.addEventListener('keydown', (e) => {
                const items = document.querySelectorAll('.command-item');
                const selected = document.querySelector('.command-item.selected');
                let currentIndex = Array.from(items).indexOf(selected);

                switch (e.key) {
                    case 'ArrowDown':
                        e.preventDefault();
                        currentIndex = (currentIndex + 1) % items.length;
                        break;
                    case 'ArrowUp':
                        e.preventDefault();
                        currentIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
                        break;
                    case 'Enter':
                        e.preventDefault();
                        if (selected) {
                            this.executeCommand(selected.dataset.action);
                        }
                        return;
                    case 'Escape':
                        e.preventDefault();
                        this.closeCommandPalette();
                        return;
                }

                items.forEach((item, index) => {
                    item.classList.toggle('selected', index === currentIndex);
                });
            });
        }

        // Keyboard shortcut for image generation
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
                e.preventDefault();
                this.openImageModal();
            }
        });

        // Keyboard shortcut for shortcuts help (Ctrl + /)
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === '/') {
                e.preventDefault();
                this.openShortcutsModal();
            }
        });

        // Close modals on escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeImageModal();
                this.closeImageLightbox();
                this.closeModelSelector();
                this.closeShortcutsModal();
                this.closeImportModal();
                this.closeMobileActionSheet();
            }
        });
        
        // Handle visibility change for connection monitoring
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && window.chatApp) {
                // Re-check connection when tab becomes visible
                window.chatApp.checkConnection?.();
            }
        });

        window.addEventListener('resize', () => {
            if (!this.isCompactActionSheetMode()) {
                this.closeMobileActionSheet();
            }
            this.syncSidebarState();
        });
    }

    // ============================================
    // Utilities
    // ============================================

    formatTime(isoString) {
        if (!isoString) return '';
        const date = new Date(isoString);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        
        if (isToday) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    // ============================================
    // Input Area Toggle
    // ============================================
    
    toggleInputArea() {
        const inputArea = document.getElementById('input-area');
        const toggleBtn = document.getElementById('input-toggle-btn');
        const toggleIcon = document.getElementById('input-toggle-icon');
        
        if (!inputArea || !toggleBtn) return;
        
        const isHidden = inputArea.classList.toggle('hidden');
        toggleBtn.classList.toggle('input-hidden', isHidden);
        
        // Update icon
        if (toggleIcon) {
            toggleIcon.setAttribute('data-lucide', isHidden ? 'chevron-up' : 'chevron-down');
            lucide.createIcons();
        }
        
        // Save preference
        this.storageSet('webchat_input_hidden', isHidden ? 'true' : 'false');
        
        // Scroll to bottom if showing input
        if (!isHidden) {
            setTimeout(() => this.scrollToBottom(), 100);
            // Focus input
            const messageInput = document.getElementById('message-input');
            if (messageInput) messageInput.focus();
        }
    }
    
    restoreInputAreaState() {
        if (this.isMinimalistMode() && window.matchMedia('(max-width: 640px)').matches) {
            this.ensureMobileMinimalComposer();
            return;
        }

        const isHidden = this.storageGet('webchat_input_hidden') === 'true';
        if (isHidden) {
            const inputArea = document.getElementById('input-area');
            const toggleBtn = document.getElementById('input-toggle-btn');
            const toggleIcon = document.getElementById('input-toggle-icon');
            
            if (inputArea) inputArea.classList.add('hidden');
            if (toggleBtn) toggleBtn.classList.add('input-hidden');
            if (toggleIcon) {
                toggleIcon.setAttribute('data-lucide', 'chevron-up');
                lucide.createIcons();
            }
        }
    }
    
    // ============================================
    // Draft Saving - Auto-save to localStorage
    // ============================================
    
    setupDraftSaving() {
        const messageInput = document.getElementById('message-input');
        if (!messageInput) return;
        
        // Save draft on input
        messageInput.addEventListener('input', () => {
            this.saveDraft(messageInput.value);
        });
        
        // Clear draft when message is sent
        const sendBtn = document.getElementById('send-btn');
        if (sendBtn) {
            sendBtn.addEventListener('click', () => {
                this.clearDraft();
            });
        }
    }
    
    saveDraft(content) {
        try {
            if (content && content.trim()) {
                this.storageSet('kimibuilt_message_draft', content);
                this.storageSet('kimibuilt_message_draft_time', Date.now().toString());
            } else {
                this.clearDraft();
            }
        } catch (e) {
            console.warn('Failed to save draft:', e);
        }
    }
    
    restoreDraft() {
        try {
            const draft = this.storageGet('kimibuilt_message_draft');
            const draftTime = this.storageGet('kimibuilt_message_draft_time');
            
            if (draft && draftTime) {
                const age = Date.now() - parseInt(draftTime, 10);
                const maxAge = 24 * 60 * 60 * 1000; // 24 hours
                
                if (age < maxAge) {
                    const messageInput = document.getElementById('message-input');
                    if (messageInput && !messageInput.value) {
                        messageInput.value = draft;
                        // Trigger input event to resize textarea
                        messageInput.dispatchEvent(new Event('input', { bubbles: true }));
                        this.showToast('Draft restored', 'info', 'Draft');
                    }
                } else {
                    this.clearDraft();
                }
            }
        } catch (e) {
            console.warn('Failed to restore draft:', e);
        }
    }
    
    clearDraft() {
        try {
            this.storageRemove('kimibuilt_message_draft');
            this.storageRemove('kimibuilt_message_draft_time');
        } catch (e) {
            console.warn('Failed to clear draft:', e);
        }
    }
    
    // ============================================
    // Code Block Scroll Indicators
    // ============================================
    
    setupCodeBlockScrollIndicators() {
        const checkScroll = () => {
            document.querySelectorAll('.code-block pre').forEach(pre => {
                if (pre.scrollWidth > pre.clientWidth) {
                    pre.classList.add('can-scroll');
                } else {
                    pre.classList.remove('can-scroll');
                }
            });
        };
        
        // Check on window resize
        window.addEventListener('resize', checkScroll);
        
        // Check after messages are rendered
        const observer = new MutationObserver(() => {
            setTimeout(checkScroll, 100);
        });
        
        const container = document.getElementById('messages-container');
        if (container) {
            observer.observe(container, { childList: true, subtree: true });
        }
    }
}

// Create global UI helpers instance
const uiHelpers = new UIHelpers();
window.uiHelpers = uiHelpers;
