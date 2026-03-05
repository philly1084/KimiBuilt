/**
 * Notation Helper - Annotations Module
 * Handles annotation display, navigation, and interaction
 */

const AnnotationsManager = {
    // Current annotations
    annotations: [],
    
    // DOM references
    elements: {
        panel: null,
        list: null,
        toggle: null,
        output: null
    },

    /**
     * Initialize the annotations manager
     * @param {Object} elements - DOM element references
     */
    init(elements) {
        this.elements = {
            panel: elements.panel || document.getElementById('annotationsPanel'),
            list: elements.list || document.getElementById('annotationsList'),
            toggle: elements.toggle || document.getElementById('toggleAnnotations'),
            output: elements.output || document.getElementById('outputRendered')
        };

        // Bind toggle button
        if (this.elements.toggle) {
            this.elements.toggle.addEventListener('click', () => this.toggle());
        }

        return this;
    },

    /**
     * Set annotations and render them
     * @param {Array} annotations - Array of annotation objects {line, note, type?}
     */
    setAnnotations(annotations) {
        this.annotations = annotations || [];
        this.render();
        this.highlightLines();
    },

    /**
     * Clear all annotations
     */
    clear() {
        this.annotations = [];
        this.render();
        this.clearHighlights();
    },

    /**
     * Render annotations in the sidebar
     */
    render() {
        if (!this.elements.list) return;

        if (this.annotations.length === 0) {
            this.elements.list.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-check-circle"></i>
                    <p>No annotations</p>
                </div>
            `;
            return;
        }

        this.elements.list.innerHTML = this.annotations.map((annotation, index) => `
            <div class="annotation-item ${annotation.type || ''}" 
                 data-index="${index}" 
                 data-line="${annotation.line}"
                 title="Click to navigate to line ${annotation.line}">
                <div class="annotation-line">Line ${annotation.line}</div>
                <div class="annotation-text">${this.escapeHtml(annotation.note)}</div>
            </div>
        `).join('');

        // Bind click events
        this.elements.list.querySelectorAll('.annotation-item').forEach(item => {
            item.addEventListener('click', () => {
                const line = parseInt(item.dataset.line);
                this.navigateToLine(line);
                this.selectAnnotation(parseInt(item.dataset.index));
            });
        });
    },

    /**
     * Highlight annotated lines in the output
     */
    highlightLines() {
        if (!this.elements.output) return;

        // Get all line elements in output
        const lines = this.elements.output.querySelectorAll('.output-line');
        
        lines.forEach((lineEl, index) => {
            const lineNumber = index + 1;
            const annotation = this.annotations.find(a => a.line === lineNumber);
            
            if (annotation) {
                lineEl.classList.add('has-annotation');
                if (annotation.type === 'error' || annotation.type === 'warning') {
                    lineEl.classList.add('has-error');
                }
                lineEl.dataset.annotationIndex = this.annotations.indexOf(annotation);
            } else {
                lineEl.classList.remove('has-annotation', 'has-error');
                delete lineEl.dataset.annotationIndex;
            }
        });
    },

    /**
     * Clear all line highlights
     */
    clearHighlights() {
        if (!this.elements.output) return;
        
        this.elements.output.querySelectorAll('.output-line').forEach(lineEl => {
            lineEl.classList.remove('has-annotation', 'has-error');
            delete lineEl.dataset.annotationIndex;
        });
    },

    /**
     * Navigate to a specific line
     * @param {number} lineNumber - Line number to navigate to
     */
    navigateToLine(lineNumber) {
        if (!this.elements.output) return;

        const lineEl = this.elements.output.querySelector(`[data-line="${lineNumber}"]`);
        if (lineEl) {
            lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Add temporary highlight animation
            lineEl.classList.add('navigated');
            setTimeout(() => lineEl.classList.remove('navigated'), 2000);
        }
    },

    /**
     * Select an annotation in the sidebar
     * @param {number} index - Annotation index
     */
    selectAnnotation(index) {
        if (!this.elements.list) return;

        // Remove previous selection
        this.elements.list.querySelectorAll('.annotation-item').forEach(item => {
            item.classList.remove('selected');
        });

        // Select new
        const item = this.elements.list.querySelector(`[data-index="${index}"]`);
        if (item) {
            item.classList.add('selected');
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    },

    /**
     * Toggle annotations panel visibility
     */
    toggle() {
        if (!this.elements.panel) return;
        
        this.elements.panel.classList.toggle('collapsed');
        
        // Update toggle icon
        if (this.elements.toggle) {
            const icon = this.elements.toggle.querySelector('i');
            if (icon) {
                icon.classList.toggle('fa-chevron-right');
                icon.classList.toggle('fa-chevron-left');
            }
        }
    },

    /**
     * Show annotations panel
     */
    show() {
        if (this.elements.panel) {
            this.elements.panel.classList.remove('collapsed');
        }
    },

    /**
     * Hide annotations panel
     */
    hide() {
        if (this.elements.panel) {
            this.elements.panel.classList.add('collapsed');
        }
    },

    /**
     * Get annotation count
     * @returns {number} Number of annotations
     */
    getCount() {
        return this.annotations.length;
    },

    /**
     * Get annotations for a specific line
     * @param {number} lineNumber - Line number
     * @returns {Array} Annotations for that line
     */
    getByLine(lineNumber) {
        return this.annotations.filter(a => a.line === lineNumber);
    },

    /**
     * Export annotations as comments
     * @param {string} format - Export format (markdown, html, plain)
     * @returns {string} Exported annotations
     */
    export(format = 'markdown') {
        if (this.annotations.length === 0) {
            return '';
        }

        switch (format) {
            case 'markdown':
                return this.annotations.map(a => 
                    `<!-- Line ${a.line}: ${a.note} -->`
                ).join('\n');
            
            case 'html':
                return this.annotations.map(a => 
                    `<!-- Line ${a.line}: ${a.note} -->`
                ).join('\n');
            
            case 'json':
                return JSON.stringify(this.annotations, null, 2);
            
            case 'plain':
            default:
                return this.annotations.map(a => 
                    `Line ${a.line}: ${a.note}`
                ).join('\n');
        }
    },

    /**
     * Process result text to add line annotations
     * @param {string} result - Raw result text
     * @returns {string} HTML with line annotations
     */
    processWithLineNumbers(result) {
        if (!result) return '';

        const lines = result.split('\n');
        
        return lines.map((line, index) => {
            const lineNumber = index + 1;
            const hasAnnotation = this.annotations.some(a => a.line === lineNumber);
            const annotationClass = hasAnnotation ? 'has-annotation' : '';
            
            return `<div class="output-line ${annotationClass}" data-line="${lineNumber}">
                <span class="line-number">${lineNumber}</span>
                <span class="line-content">${this.escapeHtml(line) || '&nbsp;'}</span>
            </div>`;
        }).join('');
    },

    /**
     * Parse annotations from API response
     * @param {Array} rawAnnotations - Raw annotation objects from API
     * @returns {Array} Normalized annotations
     */
    parseFromResponse(rawAnnotations) {
        if (!Array.isArray(rawAnnotations)) return [];
        
        return rawAnnotations.map(a => ({
            line: parseInt(a.line) || 0,
            note: a.note || a.message || '',
            type: a.type || 'info' // info, warning, error
        })).filter(a => a.line > 0 && a.note);
    },

    /**
     * Escape HTML special characters
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    escapeHtml(text) {
        if (!text) return '';
        
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Check if a line has annotations
     * @param {number} lineNumber - Line number
     * @returns {boolean}
     */
    hasAnnotation(lineNumber) {
        return this.annotations.some(a => a.line === lineNumber);
    },

    /**
     * Get summary of annotations by type
     * @returns {Object} Summary counts
     */
    getSummary() {
        const summary = {
            total: this.annotations.length,
            errors: 0,
            warnings: 0,
            info: 0
        };

        this.annotations.forEach(a => {
            const type = a.type || 'info';
            if (summary[type] !== undefined) {
                summary[type]++;
            }
        });

        return summary;
    }
};

// Export for module systems or make available globally
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AnnotationsManager;
}
