/**
 * Agent SDK Integration for Notation Helper Frontend
 * 
 * Integrates the LillyBuilt Agent SDK with the notation helper
 * providing enhanced AI capabilities for notation expansion, explanation, and validation.
 */

(function() {
  'use strict';
  
  // Check if Agent SDK is available
  if (typeof AgentOrchestrator === 'undefined') {
    console.warn('[Agent Integration] Agent SDK not loaded');
    return;
  }
  
  /**
   * NotationAgentBridge - Bridges the Agent SDK with the Notation Helper
   */
  class NotationAgentBridge {
    constructor() {
      this.orchestrator = null;
      this.currentTrace = null;
      this.isInitialized = false;
      this.currentMode = 'expand';
    }
    
    /**
     * Initialize the agent bridge
     */
    async init() {
      if (this.isInitialized) return;
      
      // Create LLM client using existing NotationAPI
      const llmClient = {
        complete: async (prompt, options = {}) => {
          const response = await fetch('/api/notation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              notation: options.notation || prompt,
              helperMode: options.mode || this.currentMode,
              context: options.context || ''
            })
          });
          const data = await response.json();
          return data.result || data.content;
        }
      };
      
      // Create embedder
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
      
      // Register notation-specific tools
      this.registerNotationTools();
      
      // Set up event handlers
      this.setupEventHandlers();
      
      this.isInitialized = true;
      console.log('[Agent Integration] Notation bridge initialized');
    }
    
    /**
     * Register tools for notation processing
     */
    registerNotationTools() {
      const { ToolDefinition } = AgentOrchestrator;
      
      // Notation expansion tool
      this.orchestrator.registerTool(new ToolDefinition({
        id: 'notation-expand',
        name: 'Expand Notation',
        description: 'Convert shorthand notation to full documentation',
        inputSchema: {
          type: 'object',
          required: ['notation'],
          properties: {
            notation: { type: 'string' },
            format: { type: 'string', enum: ['markdown', 'html', 'plain'] },
            context: { type: 'string' }
          }
        },
        sideEffects: ['read', 'write'],
        handler: async (input) => {
          const { notation, format = 'markdown', context = '' } = input;
          
          const response = await window.NotationAPI.process({
            notation,
            helperMode: 'expand',
            context
          });
          
          // Render in output panel
          if (window.Output && window.Output.render) {
            window.Output.render(response.result, { format });
          }
          
          return { 
            success: true, 
            result: response.result,
            annotations: response.annotations || []
          };
        }
      }));
      
      // Notation explanation tool
      this.orchestrator.registerTool(new ToolDefinition({
        id: 'notation-explain',
        name: 'Explain Notation',
        description: 'Get detailed explanation of notation meaning',
        inputSchema: {
          type: 'object',
          required: ['notation'],
          properties: {
            notation: { type: 'string' },
            detailLevel: { type: 'string', enum: ['brief', 'detailed', 'technical'] },
            context: { type: 'string' }
          }
        },
        sideEffects: ['read'],
        handler: async (input) => {
          const { notation, detailLevel = 'detailed', context = '' } = input;
          
          const response = await window.NotationAPI.process({
            notation,
            helperMode: 'explain',
            context: `${context}\n\nDetail level: ${detailLevel}`
          });
          
          if (window.Output && window.Output.render) {
            window.Output.render(response.result, { format: 'markdown' });
          }
          
          return { success: true, explanation: response.result };
        }
      }));
      
      // Notation validation tool
      this.orchestrator.registerTool(new ToolDefinition({
        id: 'notation-validate',
        name: 'Validate Notation',
        description: 'Check notation syntax and provide feedback',
        inputSchema: {
          type: 'object',
          required: ['notation'],
          properties: {
            notation: { type: 'string' },
            strictMode: { type: 'boolean', default: false }
          }
        },
        sideEffects: ['read'],
        handler: async (input) => {
          const { notation, strictMode = false } = input;
          
          const response = await window.NotationAPI.process({
            notation,
            helperMode: 'validate',
            context: strictMode ? 'Strict validation mode' : ''
          });
          
          // Render validation results
          if (window.Output && window.Output.renderValidation) {
            window.Output.renderValidation(response.result, response.annotations);
          } else if (window.Output && window.Output.render) {
            window.Output.render(response.result, { format: 'markdown' });
          }
          
          // Show annotations in sidebar
          if (window.Annotations && window.Annotations.display) {
            window.Annotations.display(response.annotations || []);
          }
          
          return { 
            success: true, 
            valid: response.valid,
            result: response.result,
            annotations: response.annotations || []
          };
        }
      }));
      
      // Template loading tool
      this.orchestrator.registerTool(new ToolDefinition({
        id: 'notation-load-template',
        name: 'Load Notation Template',
        description: 'Load a predefined notation template',
        inputSchema: {
          type: 'object',
          required: ['templateId'],
          properties: {
            templateId: { type: 'string' },
            customize: { type: 'object' }
          }
        },
        sideEffects: ['write'],
        handler: async (input) => {
          const { templateId, customize = {} } = input;
          
          if (!window.Templates || !window.Templates.get) {
            return { success: false, error: 'Templates not available' };
          }
          
          const template = window.Templates.get(templateId);
          if (!template) {
            return { success: false, error: `Template '${templateId}' not found` };
          }
          
          let notation = template.notation;
          
          // Apply customizations
          Object.entries(customize).forEach(([key, value]) => {
            notation = notation.replace(new RegExp(`{{${key}}}`, 'g'), value);
          });
          
          // Set in editor
          if (window.Editor && window.Editor.setContent) {
            window.Editor.setContent(notation);
          }
          
          // Switch to appropriate mode
          if (template.mode && window.App && window.App.setMode) {
            window.App.setMode(template.mode);
          }
          
          return { success: true, template, notation };
        }
      }));
      
      // Export result tool
      this.orchestrator.registerTool(new ToolDefinition({
        id: 'notation-export',
        name: 'Export Notation Result',
        description: 'Export processed notation result',
        inputSchema: {
          type: 'object',
          required: ['format'],
          properties: {
            format: { type: 'string', enum: ['clipboard', 'markdown', 'json'] },
            includeAnnotations: { type: 'boolean', default: true }
          }
        },
        sideEffects: ['read'],
        handler: async (input) => {
          const { format, includeAnnotations = true } = input;
          
          const result = window.Output ? window.Output.getContent() : '';
          const annotations = includeAnnotations && window.Annotations 
            ? window.Annotations.getAll() 
            : [];
          
          let exportContent;
          let filename;
          let mimeType;
          
          switch (format) {
            case 'clipboard':
              await navigator.clipboard.writeText(result);
              return { success: true, format, message: 'Copied to clipboard' };
              
            case 'markdown':
              exportContent = result;
              filename = `notation-result-${Date.now()}.md`;
              mimeType = 'text/markdown';
              break;
              
            case 'json':
              exportContent = JSON.stringify({
                result,
                annotations,
                timestamp: new Date().toISOString()
              }, null, 2);
              filename = `notation-result-${Date.now()}.json`;
              mimeType = 'application/json';
              break;
              
            default:
              return { success: false, error: 'Unsupported format' };
          }
          
          // Trigger download
          const blob = new Blob([exportContent], { type: mimeType });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
          
          return { success: true, format, filename };
        }
      }));
      
      // Smart process tool - auto-detects best mode
      this.orchestrator.registerTool(new ToolDefinition({
        id: 'notation-smart-process',
        name: 'Smart Process Notation',
        description: 'Automatically determine best processing mode for notation',
        inputSchema: {
          type: 'object',
          required: ['notation'],
          properties: {
            notation: { type: 'string' },
            context: { type: 'string' }
          }
        },
        sideEffects: ['read', 'write'],
        handler: async (input) => {
          const { notation, context = '' } = input;
          
          // Analyze notation to determine best mode
          const looksLikeCode = /[{}();=><]|function|class|def/.test(notation);
          const looksLikeDiagram = /-->|<--|\|>|\[.*\]/.test(notation);
          const isQuestion = /\?$|^what|^how|^why|^explain/.test(notation.toLowerCase().trim());
          
          let detectedMode = 'expand';
          if (isQuestion || looksLikeCode) {
            detectedMode = 'explain';
          }
          
          // Process with detected mode
          const response = await window.NotationAPI.process({
            notation,
            helperMode: detectedMode,
            context
          });
          
          if (window.Output && window.Output.render) {
            window.Output.render(response.result, { 
              format: 'markdown',
              detectedMode 
            });
          }
          
          return { 
            success: true, 
            detectedMode,
            result: response.result 
          };
        }
      }));
    }
    
    /**
     * Set up event handlers
     */
    setupEventHandlers() {
      this.orchestrator.on('task:start', ({ task }) => {
        console.log('[Agent] Notation task started:', task.id);
        
        // Show processing indicator
        if (window.App && window.App.setProcessing) {
          window.App.setProcessing(true);
        }
      });
      
      this.orchestrator.on('task:complete', ({ task, result }) => {
        console.log('[Agent] Notation task completed:', task.id);
        this.currentTrace = result.trace;
        
        // Hide processing indicator
        if (window.App && window.App.setProcessing) {
          window.App.setProcessing(false);
        }
        
        // Save to history
        if (window.History && window.History.add) {
          window.History.add({
            notation: task.input.notation,
            result: result.output,
            mode: task.input.mode || this.currentMode,
            timestamp: new Date().toISOString()
          });
        }
      });
      
      this.orchestrator.on('task:error', ({ task, error }) => {
        console.error('[Agent] Notation task error:', error);
        
        if (window.App && window.App.setProcessing) {
          window.App.setProcessing(false);
        }
        
        if (window.showToast) {
          window.showToast(`Error: ${error.message}`, 'error');
        }
      });
      
      this.orchestrator.on('skill:captured', ({ skill }) => {
        console.log('[Agent] Skill captured:', skill.name);
        if (window.showToast) {
          window.showToast(`Learned new notation pattern: ${skill.name}`, 'success');
        }
      });
    }
    
    /**
     * Execute an agent task
     */
    async executeTask(objective, options = {}) {
      await this.init();
      
      const notation = window.Editor ? window.Editor.getContent() : '';
      
      const result = await this.orchestrator.execute({
        type: options.type || 'notation-processing',
        objective,
        input: {
          notation,
          mode: options.mode || this.currentMode,
          context: options.context || '',
          ...options.input
        },
        output: {
          format: 'structured',
          destination: 'output-panel'
        },
        tools: options.tools || this.getToolsForMode(options.mode || this.currentMode),
        completionCriteria: {
          conditions: ['output-rendered', 'no-errors']
        }
      }, {
        sessionId: options.sessionId || this.getSessionId(),
        useSkills: true
      });
      
      return result;
    }
    
    /**
     * Get appropriate tools for processing mode
     */
    getToolsForMode(mode) {
      const toolsByMode = {
        expand: ['notation-expand', 'notation-export'],
        explain: ['notation-explain', 'notation-export'],
        validate: ['notation-validate', 'notation-export'],
        smart: ['notation-smart-process', 'notation-expand', 'notation-explain', 'notation-validate']
      };
      return toolsByMode[mode] || toolsByMode.smart;
    }
    
    /**
     * Set processing mode
     */
    setMode(mode) {
      this.currentMode = mode;
    }
    
    /**
     * Get current session ID
     */
    getSessionId() {
      return window.NotationAPI && window.NotationAPI.getSessionId 
        ? window.NotationAPI.getSessionId() 
        : 'notation-session-' + Date.now();
    }
  }
  
  // Create global instance
  window.NotationAgentBridge = new NotationAgentBridge();
  
  // Override existing processNotation if available
  if (typeof window.App !== 'undefined' && window.App.processNotation) {
    const originalProcess = window.App.processNotation;
    window.App.processNotation = async function(options = {}) {
      const notation = window.Editor ? window.Editor.getContent() : '';
      
      // Use orchestrator for complex notation processing
      if (notation.length > 100 || options.useOrchestrator) {
        return window.NotationAgentBridge.executeTask('Process notation', {
          type: 'notation-processing',
          mode: options.mode || window.App.currentMode,
          context: options.context,
          useOrchestrator: true
        });
      }
      
      // Fall back to original for simple queries
      return originalProcess.call(this, options);
    };
  }
  
})();
