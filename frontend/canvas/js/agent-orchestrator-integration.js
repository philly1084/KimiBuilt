/**
 * Agent SDK Integration for Canvas Frontend
 * 
 * Integrates the LillyBuilt Agent SDK with the canvas editor
 * providing enhanced AI capabilities for code, document, and diagram editing.
 */

(function() {
  'use strict';
  
  // Check if Agent SDK is available
  if (typeof AgentOrchestrator === 'undefined') {
    console.warn('[Agent Integration] Agent SDK not loaded');
    return;
  }
  
  /**
   * CanvasAgentBridge - Bridges the Agent SDK with the Canvas editor
   */
  class CanvasAgentBridge {
    constructor() {
      this.orchestrator = null;
      this.currentTrace = null;
      this.isInitialized = false;
      this.canvasType = 'code';
    }
    
    /**
     * Initialize the agent bridge
     */
    async init() {
      if (this.isInitialized) return;
      
      // Create LLM client using existing CanvasAPI
      const llmClient = {
        complete: async (prompt, options = {}) => {
          const response = await fetch('/api/canvas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: prompt,
              canvasType: this.canvasType,
              existingContent: options.context || ''
            })
          });
          const data = await response.json();
          return data.content;
        }
      };
      
      // Create mock embedder
      const embedder = {
        embed: async (text) => {
          const response = await fetch('/v1/embeddings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: text, model: 'text-embedding-3-small' })
          });
          const data = await response.json();
          return data.data[0].embedding;
        }
      };
      
      // Create orchestrator
      this.orchestrator = new AgentOrchestrator({
        llmClient,
        embedder,
        config: {
          enableTracing: true,
          enableSkills: true,
          maxRetries: 3
        }
      });
      
      // Register canvas-specific tools
      this.registerCanvasTools();
      
      // Set up event handlers
      this.setupEventHandlers();
      
      this.isInitialized = true;
      console.log('[Agent Integration] Canvas bridge initialized');
    }
    
    /**
     * Register tools for canvas editing
     */
    registerCanvasTools() {
      const { ToolDefinition } = AgentOrchestrator;
      
      // Code generation tool
      this.orchestrator.registerTool(new ToolDefinition({
        id: 'canvas-generate-code',
        name: 'Generate Code',
        description: 'Generate code based on a description',
        inputSchema: {
          type: 'object',
          required: ['description', 'language'],
          properties: {
            description: { type: 'string' },
            language: { type: 'string' },
            context: { type: 'string' }
          }
        },
        sideEffects: ['write'],
        handler: async (input) => {
          const { description, language, context } = input;
          
          // Use existing CanvasAPI
          const response = await window.CanvasAPI.generate({
            message: description,
            canvasType: 'code',
            language,
            existingContent: context
          });
          
          // Set content in editor
          if (window.Editor && window.Editor.setContent) {
            window.Editor.setContent(response.content);
            window.Editor.setLanguage(language);
          }
          
          return { success: true, content: response.content, language };
        }
      }));
      
      // Document generation tool
      this.orchestrator.registerTool(new ToolDefinition({
        id: 'canvas-generate-doc',
        name: 'Generate Document',
        description: 'Generate markdown documentation',
        inputSchema: {
          type: 'object',
          required: ['topic'],
          properties: {
            topic: { type: 'string' },
            format: { type: 'string', enum: ['markdown', 'html'] },
            sections: { type: 'array', items: { type: 'string' } }
          }
        },
        sideEffects: ['write'],
        handler: async (input) => {
          const { topic, format = 'markdown', sections = [] } = input;
          
          const response = await window.CanvasAPI.generate({
            message: `Create ${format} documentation about: ${topic}`,
            canvasType: 'document',
            sections
          });
          
          if (window.Editor && window.Editor.setContent) {
            window.Editor.setContent(response.content);
          }
          
          return { success: true, content: response.content };
        }
      }));
      
      // Diagram generation tool
      this.orchestrator.registerTool(new ToolDefinition({
        id: 'canvas-generate-diagram',
        name: 'Generate Diagram',
        description: 'Generate Mermaid diagram from description',
        inputSchema: {
          type: 'object',
          required: ['description', 'diagramType'],
          properties: {
            description: { type: 'string' },
            diagramType: { type: 'string', enum: ['flowchart', 'sequence', 'class', 'state', 'er', 'gantt'] }
          }
        },
        sideEffects: ['write'],
        handler: async (input) => {
          const { description, diagramType } = input;
          
          const response = await window.CanvasAPI.generate({
            message: `Create ${diagramType} diagram: ${description}`,
            canvasType: 'diagram'
          });
          
          if (window.Editor && window.Editor.setContent) {
            window.Editor.setContent(response.content);
          }
          
          return { success: true, content: response.content, diagramType };
        }
      }));
      
      // Code refactoring tool
      this.orchestrator.registerTool(new ToolDefinition({
        id: 'canvas-refactor-code',
        name: 'Refactor Code',
        description: 'Refactor existing code with improvements',
        inputSchema: {
          type: 'object',
          required: ['code', 'instructions'],
          properties: {
            code: { type: 'string' },
            instructions: { type: 'string' },
            language: { type: 'string' }
          }
        },
        sideEffects: ['read', 'write'],
        handler: async (input) => {
          const { code, instructions, language } = input;
          
          const response = await window.CanvasAPI.generate({
            message: `Refactor this code: ${instructions}`,
            canvasType: 'code',
            language,
            existingContent: code
          });
          
          if (window.Editor && window.Editor.setContent) {
            window.Editor.setContent(response.content);
          }
          
          return { success: true, content: response.content };
        }
      }));
      
      // Code explanation tool
      this.orchestrator.registerTool(new ToolDefinition({
        id: 'canvas-explain-code',
        name: 'Explain Code',
        description: 'Get detailed explanation of code',
        inputSchema: {
          type: 'object',
          required: ['code'],
          properties: {
            code: { type: 'string' },
            language: { type: 'string' },
            detailLevel: { type: 'string', enum: ['brief', 'detailed', 'line-by-line'] }
          }
        },
        sideEffects: ['read'],
        handler: async (input) => {
          const { code, language, detailLevel = 'detailed' } = input;
          
          const response = await window.CanvasAPI.generate({
            message: `Explain this ${language || 'code'} (${detailLevel}):`,
            canvasType: 'document',
            existingContent: code
          });
          
          return { 
            success: true, 
            explanation: response.content,
            canShowInPanel: true 
          };
        }
      }));
      
      // Export tool
      this.orchestrator.registerTool(new ToolDefinition({
        id: 'canvas-export',
        name: 'Export Canvas',
        description: 'Export current canvas content',
        inputSchema: {
          type: 'object',
          required: ['format'],
          properties: {
            format: { type: 'string', enum: ['clipboard', 'download', 'png', 'svg'] },
            filename: { type: 'string' }
          }
        },
        sideEffects: ['read'],
        handler: async (input) => {
          const { format, filename } = input;
          const content = window.Editor ? window.Editor.getContent() : '';
          
          if (format === 'clipboard') {
            await navigator.clipboard.writeText(content);
            return { success: true, format, message: 'Copied to clipboard' };
          }
          
          if (format === 'download' && filename) {
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            return { success: true, format, filename };
          }
          
          return { success: false, error: 'Unsupported format' };
        }
      }));
    }
    
    /**
     * Set up event handlers
     */
    setupEventHandlers() {
      this.orchestrator.on('task:start', ({ task }) => {
        console.log('[Agent] Canvas task started:', task.id);
        this.showTracePanel();
        
        // Show loading indicator in editor
        if (window.Editor && window.Editor.setLoading) {
          window.Editor.setLoading(true, 'AI is working...');
        }
      });
      
      this.orchestrator.on('task:complete', ({ task, result }) => {
        console.log('[Agent] Canvas task completed:', task.id);
        this.currentTrace = result.trace;
        this.renderTrace(result.trace);
        
        // Hide loading indicator
        if (window.Editor && window.Editor.setLoading) {
          window.Editor.setLoading(false);
        }
      });
      
      this.orchestrator.on('task:error', ({ task, error }) => {
        console.error('[Agent] Canvas task error:', error);
        
        if (window.Editor && window.Editor.setLoading) {
          window.Editor.setLoading(false);
        }
        
        if (window.showToast) {
          window.showToast(`Error: ${error.message}`, 'error');
        }
      });
      
      this.orchestrator.on('skill:captured', ({ skill }) => {
        console.log('[Agent] Skill captured:', skill.name);
        if (window.showToast) {
          window.showToast(`Learned new skill: ${skill.name}`, 'success');
        }
      });
    }
    
    /**
     * Execute an agent task
     */
    async executeTask(objective, options = {}) {
      await this.init();
      
      const currentContent = window.Editor ? window.Editor.getContent() : '';
      
      const result = await this.orchestrator.execute({
        type: options.type || 'canvas-generation',
        objective,
        input: {
          canvasType: options.canvasType || this.canvasType,
          existingContent: options.useContext ? currentContent : '',
          language: options.language,
          ...options.input
        },
        output: {
          format: 'structured',
          destination: 'canvas'
        },
        tools: options.tools || this.getToolsForCanvasType(options.canvasType || this.canvasType),
        completionCriteria: {
          conditions: ['output-generated', 'no-errors']
        }
      }, {
        sessionId: options.sessionId || this.getSessionId(),
        useSkills: true
      });
      
      return result;
    }
    
    /**
     * Get appropriate tools for canvas type
     */
    getToolsForCanvasType(canvasType) {
      const toolsByType = {
        code: ['canvas-generate-code', 'canvas-refactor-code', 'canvas-explain-code', 'canvas-export'],
        document: ['canvas-generate-doc', 'canvas-export'],
        diagram: ['canvas-generate-diagram', 'canvas-export']
      };
      return toolsByType[canvasType] || toolsByType.code;
    }
    
    /**
     * Get current session ID
     */
    getSessionId() {
      return window.CanvasAPI && window.CanvasAPI.getSessionId 
        ? window.CanvasAPI.getSessionId() 
        : 'default-session';
    }
    
    /**
     * Set canvas type
     */
    setCanvasType(type) {
      this.canvasType = type;
    }
    
    /**
     * Show trace panel in UI
     */
    showTracePanel() {
      let panel = document.getElementById('agent-trace-panel');
      if (!panel) {
        panel = document.createElement('div');
        panel.id = 'agent-trace-panel';
        panel.className = 'agent-trace-panel';
        panel.innerHTML = `
          <div class="agent-trace-panel__header">
            <span>AI Execution Trace</span>
            <button onclick="this.parentElement.parentElement.remove()">×</button>
          </div>
          <div class="agent-trace-panel__content">
            <div class="agent-trace-loading">Processing...</div>
          </div>
        `;
        document.body.appendChild(panel);
      }
      panel.style.display = 'block';
    }
    
    /**
     * Render trace in panel
     */
    renderTrace(traceData) {
      const panel = document.getElementById('agent-trace-panel');
      if (!panel) return;
      
      const content = panel.querySelector('.agent-trace-panel__content');
      content.innerHTML = '';
      
      if (typeof TraceTimeline !== 'undefined') {
        const timeline = new TraceTimeline(content, { theme: document.body.classList.contains('dark') ? 'dark' : 'light' });
        timeline.render(traceData);
      } else {
        content.innerHTML = `<pre style="font-size: 12px; overflow-x: auto;">${JSON.stringify(traceData, null, 2)}</pre>`;
      }
    }
  }
  
  // Create global instance
  window.CanvasAgentBridge = new CanvasAgentBridge();
  
  // Override existing sendPrompt if available
  if (typeof window.CanvasApp !== 'undefined' && window.CanvasApp.sendPrompt) {
    const originalSendPrompt = window.CanvasApp.sendPrompt;
    window.CanvasApp.sendPrompt = async function(prompt, options = {}) {
      // Use orchestrator for complex generation tasks
      if (prompt.toLowerCase().includes('generate') || 
          prompt.toLowerCase().includes('create') ||
          prompt.toLowerCase().includes('refactor')) {
        return window.CanvasAgentBridge.executeTask(prompt, {
          type: 'canvas-generation',
          canvasType: window.CanvasApp.currentCanvasType,
          useContext: options.useContext
        });
      }
      
      // Fall back to original for simple queries
      return originalSendPrompt.call(this, prompt, options);
    };
  }
  
})();
