/**
 * Notation Helper - Editor Module
 * Handles the notation input editor with CodeMirror integration
 */

const EditorManager = {
    // CodeMirror instance
    cm: null,

    // State
    currentNotation: '',
    originalNotation: '',
    isDirty: false,

    // DOM references
    elements: {
        textarea: null,
        charCount: null,
        lineCount: null,
        clearBtn: null
    },

    // Configuration
    config: {
        theme: 'dracula',
        lineNumbers: true,
        mode: 'text',
        lineWrapping: true,
        autofocus: true,
        indentUnit: 2,
        tabSize: 2,
        extraKeys: {}
    },

    /**
     * Initialize the editor
     * @param {Object} elements - DOM element references
     * @param {Object} options - Editor options
     */
    init(elements, options = {}) {
        this.elements = {
            textarea: elements.textarea || document.getElementById('notationInput'),
            charCount: elements.charCount || document.getElementById('charCount'),
            lineCount: elements.lineCount || document.getElementById('lineCount'),
            clearBtn: elements.clearBtn || document.getElementById('clearInput')
        };

        // Merge options
        this.config = { ...this.config, ...options };

        // Initialize CodeMirror
        this._initCodeMirror();

        // Bind events
        this._bindEvents();

        return this;
    },

    /**
     * Get current notation text
     * @returns {string} Current notation
     */
    getValue() {
        return this.cm ? this.cm.getValue() : '';
    },

    /**
     * Set notation text
     * @param {string} value - Text to set
     * @param {boolean} clearHistory - Whether to clear undo history
     */
    setValue(value, clearHistory = false) {
        if (!this.cm) return;

        this.cm.setValue(value || '');
        
        if (clearHistory) {
            this.cm.clearHistory();
            this.isDirty = false;
        }

        this._updateStats();
    },

    /**
     * Insert text at cursor
     * @param {string} text - Text to insert
     */
    insert(text) {
        if (!this.cm) return;

        const doc = this.cm.getDoc();
        const cursor = doc.getCursor();
        doc.replaceRange(text, cursor);
    },

    /**
     * Replace current selection or insert at cursor
     * @param {string} text - Text to insert
     */
    replaceSelection(text) {
        if (!this.cm) return;

        this.cm.replaceSelection(text);
    },

    /**
     * Clear the editor
     */
    clear() {
        this.setValue('', true);
    },

    /**
     * Focus the editor
     */
    focus() {
        if (this.cm) {
            this.cm.focus();
        }
    },

    /**
     * Check if editor has content
     * @returns {boolean}
     */
    hasContent() {
        return this.getValue().trim().length > 0;
    },

    /**
     * Get selected text
     * @returns {string} Selected text
     */
    getSelection() {
        return this.cm ? this.cm.getSelection() : '';
    },

    /**
     * Get cursor position
     * @returns {Object} Line and ch position
     */
    getCursor() {
        return this.cm ? this.cm.getCursor() : { line: 0, ch: 0 };
    },

    /**
     * Set cursor position
     * @param {Object} pos - Position {line, ch}
     */
    setCursor(pos) {
        if (this.cm) {
            this.cm.setCursor(pos);
        }
    },

    /**
     * Get current line number
     * @returns {number} Current line number (1-based)
     */
    getCurrentLine() {
        const cursor = this.getCursor();
        return cursor.line + 1;
    },

    /**
     * Get line content
     * @param {number} line - Line number (1-based)
     * @returns {string} Line content
     */
    getLine(line) {
        if (!this.cm) return '';
        return this.cm.getLine(line - 1) || '';
    },

    /**
     * Get line count
     * @returns {number} Number of lines
     */
    getLineCount() {
        if (!this.cm) return 1;
        return this.cm.lineCount();
    },

    /**
     * Apply a suggestion to the editor
     * @param {string} suggestion - Suggestion text
     * @param {string} mode - How to apply (replace, insert, append)
     */
    applySuggestion(suggestion, mode = 'insert') {
        if (!suggestion) return;

        switch (mode) {
            case 'replace':
                this.setValue(suggestion);
                break;
            case 'append':
                const current = this.getValue();
                const separator = current.endsWith('\n') ? '' : '\n';
                this.setValue(current + separator + suggestion);
                break;
            case 'insert':
            default:
                this.insert(suggestion);
                break;
        }

        this.focus();
    },

    /**
     * Check if content has unsaved changes
     * @returns {boolean}
     */
    isModified() {
        return this.isDirty;
    },

    /**
     * Mark as saved (not dirty)
     */
    markSaved() {
        this.isDirty = false;
        this.originalNotation = this.getValue();
    },

    /**
     * Get editor statistics
     * @returns {Object} Stats object
     */
    getStats() {
        const value = this.getValue();
        const lines = value.split('\n');
        
        return {
            characters: value.length,
            lines: lines.length,
            words: value.trim() ? value.trim().split(/\s+/).length : 0,
            nonEmptyLines: lines.filter(l => l.trim()).length
        };
    },

    /**
     * Enable/disable editor
     * @param {boolean} enabled - Whether editor should be enabled
     */
    setEnabled(enabled) {
        if (this.cm) {
            this.cm.setOption('readOnly', !enabled);
        }
    },

    /**
     * Set theme
     * @param {string} theme - Theme name
     */
    setTheme(theme) {
        if (this.cm) {
            this.cm.setOption('theme', theme);
        }
    },

    /**
     * Add keyboard shortcut
     * @param {string} key - Key combination
     * @param {Function} handler - Handler function
     */
    addKeyMap(key, handler) {
        if (this.cm) {
            const keyMap = {};
            keyMap[key] = handler;
            this.cm.addKeyMap(keyMap);
        }
    },

    /**
     * Load a template into the editor
     * @param {Object} template - Template object
     */
    loadTemplate(template) {
        if (!template) return;

        this.setValue(template.notation || '', true);
        
        // Dispatch event for mode change if needed
        if (template.mode) {
            const event = new CustomEvent('templateLoaded', {
                detail: { template, mode: template.mode }
            });
            document.dispatchEvent(event);
        }

        this.focus();
    },

    // Private methods

    /**
     * Initialize CodeMirror
     * @private
     */
    _initCodeMirror() {
        if (!this.elements.textarea || typeof CodeMirror === 'undefined') {
            console.warn('CodeMirror not available or textarea not found');
            return;
        }

        this.cm = CodeMirror.fromTextArea(this.elements.textarea, {
            ...this.config,
            extraKeys: {
                'Ctrl-Enter': () => this._triggerProcess(),
                'Cmd-Enter': () => this._triggerProcess(),
                'Ctrl-Shift-Enter': () => this._triggerProcessWithContext(),
                'Cmd-Shift-Enter': () => this._triggerProcessWithContext(),
                'Ctrl-/': 'toggleComment',
                'Cmd-/': 'toggleComment',
                ...this.config.extraKeys
            }
        });

        // Listen for changes
        this.cm.on('change', () => {
            this._onChange();
        });

        // Initial stats update
        this._updateStats();
    },

    /**
     * Bind DOM events
     * @private
     */
    _bindEvents() {
        // Clear button
        if (this.elements.clearBtn) {
            this.elements.clearBtn.addEventListener('click', () => {
                this.clear();
                this.focus();
            });
        }

        // Listen for external suggestion apply events
        document.addEventListener('applySuggestion', (e) => {
            if (e.detail && e.detail.suggestion) {
                this.applySuggestion(e.detail.suggestion, 'insert');
            }
        });
    },

    /**
     * Handle editor change
     * @private
     */
    _onChange() {
        this.currentNotation = this.getValue();
        this.isDirty = this.currentNotation !== this.originalNotation;
        this._updateStats();

        // Dispatch change event
        const event = new CustomEvent('notationChange', {
            detail: { 
                value: this.currentNotation,
                isDirty: this.isDirty,
                stats: this.getStats()
            }
        });
        document.dispatchEvent(event);
    },

    /**
     * Update character and line count display
     * @private
     */
    _updateStats() {
        const stats = this.getStats();
        
        if (this.elements.charCount) {
            this.elements.charCount.textContent = `${stats.characters} chars`;
        }
        
        if (this.elements.lineCount) {
            this.elements.lineCount.textContent = `${stats.lines} line${stats.lines !== 1 ? 's' : ''}`;
        }
    },

    /**
     * Trigger process event
     * @private
     */
    _triggerProcess() {
        const event = new CustomEvent('processNotation', {
            detail: { withContext: false }
        });
        document.dispatchEvent(event);
        return true;
    },

    /**
     * Trigger process with context event
     * @private
     */
    _triggerProcessWithContext() {
        const event = new CustomEvent('processNotation', {
            detail: { withContext: true }
        });
        document.dispatchEvent(event);
        return true;
    }
};

// Export for module systems or make available globally
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EditorManager;
}
