/**
 * @typedef {Object} TraceData
 * @property {string} id - Unique trace identifier
 * @property {string} [taskId] - Associated task identifier
 * @property {TraceStep[]} steps - Array of execution steps
 * @property {TraceMetrics} [metrics] - Execution metrics
 * @property {number} [timestamp] - Trace creation timestamp
 */

/**
 * @typedef {Object} TraceStep
 * @property {string} id - Unique step identifier
 * @property {string} type - Step type (e.g., 'plan', 'tool-call', 'llm-call', 'verify', 'error')
 * @property {string} description - Human-readable step description
 * @property {*} [input] - Step input data
 * @property {*} [output] - Step output data
 * @property {string} [error] - Error message if step failed
 * @property {TraceStepMetadata} [metadata] - Step metadata
 * @property {TraceStep[]} [substeps] - Nested substeps
 */

/**
 * @typedef {Object} TraceStepMetadata
 * @property {number} [duration] - Step execution duration in milliseconds
 * @property {number} [timestamp] - Step start timestamp
 * @property {Object} [tokens] - Token usage for LLM calls
 * @property {number} [tokens.input] - Input tokens
 * @property {number} [tokens.output] - Output tokens
 * @property {Object} [performance] - Performance metrics
 */

/**
 * @typedef {Object} TraceMetrics
 * @property {number} [totalDuration] - Total execution duration
 * @property {number} [totalSteps] - Total number of steps
 * @property {Object} [totalTokens] - Total token usage
 * @property {number} [totalTokens.input] - Total input tokens
 * @property {number} [totalTokens.output] - Total output tokens
 */

/**
 * @typedef {Object} TimelineOptions
 * @property {boolean} [showMetrics=true] - Show header with metrics
 * @property {boolean} [showDurations=true] - Show step durations
 * @property {boolean} [collapsible=true] - Allow expanding/collapsing steps
 * @property {'dark'|'light'} [theme='dark'] - UI theme
 * @property {number} [maxDepth=10] - Maximum nesting depth to render
 * @property {Function} [onStepClick] - Callback when a step is clicked
 * @property {Function} [formatTimestamp] - Custom timestamp formatter
 */

/**
 * Agent Trace Timeline UI Component
 * 
 * Visualizes execution traces in an interactive timeline format.
 * Features collapsible steps, detailed views, metrics display,
 * and export functionality.
 * 
 * @class
 * @example
 * const container = document.getElementById('trace-container');
 * const timeline = new TraceTimeline(container, {
 *   theme: 'dark',
 *   showMetrics: true,
 *   onStepClick: (step) => console.log('Clicked:', step.id)
 * });
 * 
 * timeline.render(traceData);
 */
class TraceTimeline {
  /**
   * Creates a new TraceTimeline instance.
   * 
   * @param {HTMLElement} container - DOM element to render the timeline into
   * @param {TimelineOptions} [options={}] - Configuration options
   * @throws {Error} If container is not a valid DOM element
   */
  constructor(container, options = {}) {
    if (!container || !(container instanceof HTMLElement)) {
      throw new Error('TraceTimeline requires a valid DOM container element');
    }

    /**
     * Container element for the timeline.
     * @type {HTMLElement}
     * @private
     */
    this.container = container;

    /**
     * Merged configuration options.
     * @type {TimelineOptions}
     * @private
     */
    this.options = {
      showMetrics: true,
      showDurations: true,
      collapsible: true,
      theme: 'dark',
      maxDepth: 10,
      onStepClick: null,
      formatTimestamp: null,
      ...options
    };

    /**
     * Set of currently expanded step IDs.
     * @type {Set<string>}
     * @private
     */
    this.expandedSteps = new Set();

    /**
     * Currently rendered trace data.
     * @type {TraceData|null}
     * @private
     */
    this.traceData = null;

    // Initialize CSS class on container
    this.container.classList.add('trace-timeline-container');
  }

  /**
   * Render the timeline with provided trace data.
   * This is the main entry point for displaying a trace.
   * 
   * @param {TraceData} traceData - The trace data to visualize
   * @returns {void}
   */
  render(traceData) {
    if (!traceData || !Array.isArray(traceData.steps)) {
      this.renderError('Invalid trace data: steps array is required');
      return;
    }

    this.traceData = traceData;
    this.container.innerHTML = '';

    // Create main timeline container
    const timeline = document.createElement('div');
    timeline.className = `trace-timeline trace-timeline--${this.options.theme}`;
    timeline.setAttribute('role', 'region');
    timeline.setAttribute('aria-label', 'Execution Trace Timeline');

    // Render header with metrics summary
    if (this.options.showMetrics) {
      timeline.appendChild(this.renderHeader(traceData));
    }

    // Render steps container
    const stepsContainer = document.createElement('div');
    stepsContainer.className = 'trace-timeline__steps';

    // Render each top-level step
    for (const step of traceData.steps) {
      stepsContainer.appendChild(this.renderStep(step, 0));
    }

    timeline.appendChild(stepsContainer);
    this.container.appendChild(timeline);
  }

  /**
   * Render the timeline header with summary metrics.
   * 
   * @param {TraceData} trace - The trace data
   * @returns {HTMLElement} The header element
   * @private
   */
  renderHeader(trace) {
    const header = document.createElement('div');
    header.className = 'trace-timeline__header';

    const duration = trace.metrics?.totalDuration || 0;
    const tokens = trace.metrics?.totalTokens || { input: 0, output: 0 };
    const totalTokens = tokens.input + tokens.output;
    const stepCount = trace.metrics?.totalSteps || trace.steps.length || 0;

    header.innerHTML = `
      <div class="trace-timeline__summary">
        <span class="trace-timeline__metric" title="Total execution time">
          <svg class="trace-timeline__icon" width="16" height="16" viewBox="0 0 24 24" 
               fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <span class="trace-timeline__metric-label">Duration:</span>
          <span class="trace-timeline__metric-value">${this.formatDuration(duration)}</span>
        </span>
        
        <span class="trace-timeline__metric" title="Token usage">
          <svg class="trace-timeline__icon" width="16" height="16" viewBox="0 0 24 24" 
               fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          <span class="trace-timeline__metric-label">Tokens:</span>
          <span class="trace-timeline__metric-value">${totalTokens.toLocaleString()} 
            <small>(${tokens.input.toLocaleString()} in / ${tokens.output.toLocaleString()} out)</small>
          </span>
        </span>
        
        <span class="trace-timeline__metric" title="Number of execution steps">
          <svg class="trace-timeline__icon" width="16" height="16" viewBox="0 0 24 24" 
               fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <line x1="8" y1="6" x2="21" y2="6"/>
            <line x1="8" y1="12" x2="21" y2="12"/>
            <line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/>
            <line x1="3" y1="12" x2="3.01" y2="12"/>
            <line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
          <span class="trace-timeline__metric-label">Steps:</span>
          <span class="trace-timeline__metric-value">${stepCount}</span>
        </span>
      </div>
      
      <div class="trace-timeline__actions">
        <button class="trace-timeline__btn trace-timeline__btn--expand" 
                title="Expand all steps"
                aria-label="Expand all steps">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" 
               stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
          Expand All
        </button>
        <button class="trace-timeline__btn trace-timeline__btn--collapse" 
                title="Collapse all steps"
                aria-label="Collapse all steps">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" 
               stroke="currentColor" stroke-width="2">
            <polyline points="18 15 12 9 6 15"/>
          </svg>
          Collapse All
        </button>
        <button class="trace-timeline__btn trace-timeline__btn--export" 
                title="Export trace as JSON"
                aria-label="Export trace as JSON">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" 
               stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Export JSON
        </button>
      </div>
    `;

    // Attach event handlers
    const expandBtn = header.querySelector('.trace-timeline__btn--expand');
    const collapseBtn = header.querySelector('.trace-timeline__btn--collapse');
    const exportBtn = header.querySelector('.trace-timeline__btn--export');

    expandBtn.addEventListener('click', () => this.expandAll());
    collapseBtn.addEventListener('click', () => this.collapseAll());
    exportBtn.addEventListener('click', () => this.exportTrace());

    return header;
  }

  /**
   * Render an error message in the container.
   * 
   * @param {string} message - Error message to display
   * @private
   */
  renderError(message) {
    this.container.innerHTML = `
      <div class="trace-timeline trace-timeline--error" role="alert">
        <div class="trace-timeline__error">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" 
               stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>${this.escapeHtml(message)}</span>
        </div>
      </div>
    `;
  }

  /**
   * Render a single step in the timeline.
   * 
   * @param {TraceStep} step - The step data
   * @param {number} depth - Nesting depth (0 = top level)
   * @returns {HTMLElement} The step element
   * @private
   */
  renderStep(step, depth) {
    const stepEl = document.createElement('div');
    stepEl.className = `trace-timeline__step trace-timeline__step--${step.type}`;
    stepEl.setAttribute('data-step-id', step.id);
    stepEl.setAttribute('data-step-type', step.type);
    stepEl.style.paddingLeft = `${depth * 24}px`;

    // Limit max depth
    if (depth >= this.options.maxDepth) {
      stepEl.classList.add('trace-timeline__step--max-depth');
    }

    const isExpanded = this.expandedSteps.has(step.id);
    const hasSubsteps = step.substeps && step.substeps.length > 0 && depth < this.options.maxDepth;
    const hasError = !!step.error;

    // Build step content
    stepEl.innerHTML = this.buildStepHTML(step, {
      isExpanded,
      hasSubsteps,
      hasError,
      depth
    });

    // Attach event handlers
    const header = stepEl.querySelector('.trace-timeline__step-header');
    const toggleBtn = stepEl.querySelector('.trace-timeline__toggle');

    header.addEventListener('click', (e) => {
      // Don't toggle if clicking on a button inside the header
      if (e.target.closest('button') && !e.target.closest('.trace-timeline__toggle')) {
        return;
      }
      this.handleStepClick(step, e);
    });

    if (toggleBtn && this.options.collapsible) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleStep(step.id);
      });
    }

    // Render substeps if expanded
    if (hasSubsteps && isExpanded) {
      const substepsContainer = document.createElement('div');
      substepsContainer.className = 'trace-timeline__substeps';

      for (const substep of step.substeps) {
        substepsContainer.appendChild(this.renderStep(substep, depth + 1));
      }

      stepEl.appendChild(substepsContainer);
    }

    return stepEl;
  }

  /**
   * Build the HTML for a step.
   * 
   * @param {TraceStep} step - The step data
   * @param {Object} options - Rendering options
   * @param {boolean} options.isExpanded - Whether step is expanded
   * @param {boolean} options.hasSubsteps - Whether step has substeps
   * @param {boolean} options.hasError - Whether step has an error
   * @param {number} options.depth - Nesting depth
   * @returns {string} HTML string
   * @private
   */
  buildStepHTML(step, { isExpanded, hasSubsteps, hasError, depth }) {
    const duration = step.metadata?.duration || 0;
    const timestamp = step.metadata?.timestamp;
    const tokens = step.metadata?.tokens;

    return `
      <div class="trace-timeline__step-header" data-step-id="${this.escapeHtml(step.id)}" tabindex="0" role="button">
        ${hasSubsteps ? `
          <button class="trace-timeline__toggle ${isExpanded ? 'expanded' : ''}" 
                  aria-expanded="${isExpanded}"
                  aria-label="${isExpanded ? 'Collapse' : 'Expand'} substeps"
                  ${!this.options.collapsible ? 'disabled' : ''}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" 
                 stroke="currentColor" stroke-width="2" aria-hidden="true">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        ` : '<span class="trace-timeline__spacer" aria-hidden="true"></span>'}
        
        <span class="trace-timeline__step-icon" aria-hidden="true">
          ${this.getStepIcon(step.type)}
        </span>
        
        <span class="trace-timeline__step-type">${this.escapeHtml(step.type)}</span>
        
        <span class="trace-timeline__step-description" title="${this.escapeHtml(step.description)}">
          ${this.escapeHtml(step.description)}
        </span>
        
        ${this.options.showDurations ? `
          <span class="trace-timeline__step-duration" title="Execution time">
            ${this.formatDuration(duration)}
          </span>
        ` : ''}

        ${tokens ? `
          <span class="trace-timeline__step-tokens" title="Tokens: ${tokens.input} in / ${tokens.output} out">
            <small>${tokens.input + tokens.output}t</small>
          </span>
        ` : ''}
        
        ${hasError ? `
          <span class="trace-timeline__step-error" title="${this.escapeHtml(step.error)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" 
                 stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span class="sr-only">Error: ${this.escapeHtml(step.error)}</span>
          </span>
        ` : ''}
      </div>
      
      ${isExpanded ? this.renderStepDetails(step) : ''}
    `;
  }

  /**
   * Render detailed information for an expanded step.
   * 
   * @param {TraceStep} step - The step data
   * @returns {string} HTML string
   * @private
   */
  renderStepDetails(step) {
    const sections = [];

    if (step.input !== undefined) {
      sections.push(`
        <div class="trace-timeline__detail-section trace-timeline__detail-section--input">
          <h4 class="trace-timeline__detail-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" 
                 stroke="currentColor" stroke-width="2" aria-hidden="true">
              <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
              <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
            </svg>
            Input
          </h4>
          <pre class="trace-timeline__code"><code>${this.escapeHtml(JSON.stringify(step.input, null, 2))}</code></pre>
        </div>
      `);
    }

    if (step.output !== undefined) {
      sections.push(`
        <div class="trace-timeline__detail-section trace-timeline__detail-section--output">
          <h4 class="trace-timeline__detail-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" 
                 stroke="currentColor" stroke-width="2" aria-hidden="true">
              <polyline points="4 17 10 11 4 5"/>
              <line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
            Output
          </h4>
          <pre class="trace-timeline__code"><code>${this.escapeHtml(JSON.stringify(step.output, null, 2))}</code></pre>
        </div>
      `);
    }

    if (step.metadata && Object.keys(step.metadata).length > 0) {
      const metaData = { ...step.metadata };
      delete metaData.duration; // Already shown in header
      
      if (Object.keys(metaData).length > 0) {
        sections.push(`
          <div class="trace-timeline__detail-section trace-timeline__detail-section--metadata">
            <h4 class="trace-timeline__detail-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" 
                   stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              Metadata
            </h4>
            <pre class="trace-timeline__code"><code>${this.escapeHtml(JSON.stringify(metaData, null, 2))}</code></pre>
          </div>
        `);
      }
    }

    if (step.error) {
      sections.push(`
        <div class="trace-timeline__detail-section trace-timeline__detail-section--error">
          <h4 class="trace-timeline__detail-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" 
                 stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            Error
          </h4>
          <pre class="trace-timeline__code trace-timeline__code--error"><code>${this.escapeHtml(step.error)}</code></pre>
        </div>
      `);
    }

    if (sections.length === 0) {
      sections.push(`
        <div class="trace-timeline__detail-empty">
          No additional details available for this step.
        </div>
      `);
    }

    return `
      <div class="trace-timeline__step-details">
        ${sections.join('')}
      </div>
    `;
  }

  /**
   * Get the icon for a step type.
   * 
   * @param {string} type - Step type
   * @returns {string} Icon emoji or character
   * @private
   */
  getStepIcon(type) {
    const icons = {
      'plan': '📋',
      'tool-call': '🔧',
      'llm-call': '🤖',
      'verify': '✅',
      'error': '⚠️',
      'understand': '🧠',
      'generate': '✨',
      'validate': '✓',
      'retry': '🔄',
      'cache-hit': '💾',
      'cache-miss': '📭',
      'skill-apply': '📚',
      'skill-capture': '💡',
      'start': '▶️',
      'complete': '🏁',
      'cancel': '⏹️',
      'timeout': '⏱️'
    };
    return icons[type] || '•';
  }

  /**
   * Format a duration in milliseconds to a human-readable string.
   * 
   * @param {number} ms - Duration in milliseconds
   * @returns {string} Formatted duration string
   * @private
   */
  formatDuration(ms) {
    if (ms === undefined || ms === null) return '--';
    if (ms < 1) return '<1ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(1);
    return `${minutes}m ${seconds}s`;
  }

  /**
   * Escape HTML special characters.
   * 
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   * @private
   */
  escapeHtml(text) {
    if (typeof text !== 'string') return String(text);
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Handle click on a step.
   * 
   * @param {TraceStep} step - The clicked step
   * @param {Event} event - Click event
   * @private
   */
  handleStepClick(step, event) {
    // Call user callback if provided
    if (typeof this.options.onStepClick === 'function') {
      this.options.onStepClick(step, event);
    }

    // Toggle expansion if clicking the header
    if (this.options.collapsible && step.substeps?.length > 0) {
      this.toggleStep(step.id);
    }
  }

  /**
   * Toggle expansion state of a step.
   * 
   * @param {string} stepId - Step identifier
   * @returns {boolean} New expansion state
   */
  toggleStep(stepId) {
    if (this.expandedSteps.has(stepId)) {
      this.expandedSteps.delete(stepId);
    } else {
      this.expandedSteps.add(stepId);
    }
    
    // Re-render to reflect changes
    if (this.traceData) {
      this.render(this.traceData);
    }
    
    return this.expandedSteps.has(stepId);
  }

  /**
   * Expand all collapsible steps.
   * 
   * @returns {number} Number of steps expanded
   */
  expandAll() {
    if (!this.traceData) return 0;
    
    let count = 0;
    const addStepIds = (steps) => {
      for (const step of steps) {
        if (step.substeps?.length > 0) {
          this.expandedSteps.add(step.id);
          count++;
          addStepIds(step.substeps);
        }
      }
    };
    
    addStepIds(this.traceData.steps);
    this.render(this.traceData);
    return count;
  }

  /**
   * Collapse all steps.
   * 
   * @returns {number} Number of steps that were expanded
   */
  collapseAll() {
    const count = this.expandedSteps.size;
    this.expandedSteps.clear();
    
    if (this.traceData) {
      this.render(this.traceData);
    }
    
    return count;
  }

  /**
   * Export the current trace as a JSON file download.
   * 
   * @returns {void}
   */
  exportTrace() {
    if (!this.traceData) {
      console.warn('No trace data to export');
      return;
    }

    const data = JSON.stringify(this.traceData, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `trace-${this.traceData.id || Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  }

  /**
   * Get the current expansion state.
   * 
   * @returns {string[]} Array of expanded step IDs
   */
  getExpandedSteps() {
    return Array.from(this.expandedSteps);
  }

  /**
   * Set which steps should be expanded.
   * 
   * @param {string[]} stepIds - Array of step IDs to expand
   */
  setExpandedSteps(stepIds) {
    this.expandedSteps = new Set(stepIds);
    if (this.traceData) {
      this.render(this.traceData);
    }
  }

  /**
   * Update the timeline options.
   * 
   * @param {Partial<TimelineOptions>} newOptions - Options to update
   */
  updateOptions(newOptions) {
    this.options = { ...this.options, ...newOptions };
    if (this.traceData) {
      this.render(this.traceData);
    }
  }

  /**
   * Destroy the timeline and clean up.
   */
  destroy() {
    this.expandedSteps.clear();
    this.traceData = null;
    if (this.container) {
      this.container.innerHTML = '';
      this.container.classList.remove('trace-timeline-container');
    }
  }
}

// Export for different module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TraceTimeline };
}
if (typeof window !== 'undefined') {
  window.TraceTimeline = TraceTimeline;
}
