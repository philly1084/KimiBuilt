/**
 * Agent SDK Integration for Notes-Notion Frontend
 * 
 * Integrates the LillyBuilt Agent SDK with the notes editor
 * providing enhanced AI capabilities with traceability and skill learning.
 */

(function() {
  'use strict';

  function extractMessageText(value) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return '';

      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          const parsed = JSON.parse(trimmed);
          const extracted = extractMessageText(parsed);
          if (extracted) return extracted;
        } catch (_error) {
          // Ignore parse failures and fall back to the raw string.
        }
      }

      return trimmed;
    }

    if (Array.isArray(value)) {
      return value.map((item) => extractMessageText(item)).filter(Boolean).join('');
    }

    if (!value || typeof value !== 'object') {
      return '';
    }

    return extractMessageText(
      value.output_text
      ?? value.text
      ?? value.content
      ?? value.message
      ?? value.response
      ?? value.output
      ?? value.data
      ?? ''
    );
  }
  
  // Check if Agent SDK is available
  if (typeof AgentOrchestrator === 'undefined') {
    console.warn('[Agent Integration] Agent SDK not loaded');
    return;
  }
  
  /**
   * NotesAgentBridge - Bridges the Agent SDK with the Notes editor
   */
  class NotesAgentBridge {
    constructor() {
      this.orchestrator = null;
      this.currentTrace = null;
      this.isInitialized = false;
    }
    
    /**
     * Initialize the agent bridge
     */
    async init() {
      if (this.isInitialized) return;
      
      // Create mock LLM client (replace with actual OpenAI client)
      const llmClient = {
        complete: async (prompt) => {
          // Use existing API client
          const response = await fetch('/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: Agent.getSelectedModel(),
              messages: [{ role: 'user', content: prompt }],
              stream: false
            })
          });
          const data = await response.json();
          return extractMessageText(data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.message ?? data);
        }
      };
      
      // Create mock embedder
      const embedder = {
        embed: async (text) => {
          // Call embedding API
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
      
      // Register notes-specific tools
      this.registerNotesTools();
      
      // Set up event handlers
      this.setupEventHandlers();
      
      this.isInitialized = true;
      console.log('[Agent Integration] Bridge initialized');
    }
    
    /**
     * Register tools for notes editing
     */
    registerNotesTools() {
      const { ToolDefinition } = AgentOrchestrator;
      
      // Block editing tool
      this.orchestrator.registerTool(new ToolDefinition({
        id: 'notes-edit-block',
        name: 'Edit Block',
        description: 'Edit a block in the notes editor',
        inputSchema: {
          type: 'object',
          required: ['blockId', 'content'],
          properties: {
            blockId: { type: 'string' },
            content: { type: 'string' },
            type: { type: 'string', enum: ['text', 'heading_1', 'heading_2', 'code'] }
          }
        },
        sideEffects: ['write'],
        handler: async (input) => {
          const { blockId, content, type } = input;
          
          // Use existing editor functions
          window.Editor.updateBlockContent(blockId, content);
          if (type) {
            window.Editor.convertBlockType(blockId, type);
          }
          window.Editor.savePage();
          window.Editor.refreshEditor();
          
          return { success: true, blockId, content };
        }
      }));
      
      // Block insertion tool
      this.orchestrator.registerTool(new ToolDefinition({
        id: 'notes-insert-block',
        name: 'Insert Block',
        description: 'Insert a new block after a specific block',
        inputSchema: {
          type: 'object',
          required: ['afterBlockId', 'type', 'content'],
          properties: {
            afterBlockId: { type: 'string' },
            type: { type: 'string' },
            content: { type: 'string' }
          }
        },
        sideEffects: ['write'],
        handler: async (input) => {
          const { afterBlockId, type, content } = input;
          const newBlock = window.Editor.insertBlockAfter(afterBlockId, type, content);
          window.Editor.savePage();
          window.Editor.refreshEditor();
          return { success: true, blockId: newBlock.id };
        }
      }));
      
      // Page summary tool
      this.orchestrator.registerTool(new ToolDefinition({
        id: 'notes-summarize',
        name: 'Summarize Page',
        description: 'Get a summary of the current page content',
        inputSchema: {
          type: 'object',
          properties: {
            maxLength: { type: 'number', default: 200 }
          }
        },
        sideEffects: ['read'],
        handler: async (input) => {
          const page = window.Editor.getCurrentPage();
          const content = page.blocks.map(b => window.Editor.extractBlockText(b)).join('\n');
          return { content, blockCount: page.blocks.length };
        }
      }));
    }
    
    /**
     * Set up event handlers
     */
    setupEventHandlers() {
      this.orchestrator.on('task:start', ({ task }) => {
        console.log('[Agent] Task started:', task.id);
        this.showTracePanel();
      });
      
      this.orchestrator.on('task:complete', ({ task, result }) => {
        console.log('[Agent] Task completed:', task.id);
        this.currentTrace = result.trace;
        this.renderTrace(result.trace);
      });
      
      this.orchestrator.on('skill:captured', ({ skill }) => {
        console.log('[Agent] Skill captured:', skill.name);
        this.showSkillNotification(skill);
      });
    }
    
    /**
     * Execute an agent task
     */
    async executeTask(objective, options = {}) {
      await this.init();
      
      const page = window.Editor.getCurrentPage();
      const pageContext = Agent.getPageContext();
      
      const result = await this.orchestrator.execute({
        type: options.type || 'document-edit',
        objective,
        input: {
          content: options.content || '',
          pageTitle: page.title,
          pageContext
        },
        output: {
          format: 'structured',
          destination: 'canvas'
        },
        tools: options.tools || ['notes-edit-block', 'notes-insert-block'],
        completionCriteria: {
          conditions: ['output-validated', 'no-errors']
        }
      }, {
        sessionId: page.id,
        useSkills: true
      });
      
      return result;
    }
    
    /**
     * Show trace panel in UI
     */
    showTracePanel() {
      // Create or show trace panel
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
      
      // Use TraceTimeline component if available
      if (typeof TraceTimeline !== 'undefined') {
        const timeline = new TraceTimeline(content, { theme: 'dark' });
        timeline.render(traceData);
      } else {
        content.innerHTML = `<pre>${JSON.stringify(traceData, null, 2)}</pre>`;
      }
    }
    
    /**
     * Show skill captured notification
     */
    showSkillNotification(skill) {
      if (window.Sidebar && window.Sidebar.showToast) {
        window.Sidebar.showToast(`Learned new skill: ${skill.name}`, 'success');
      }
    }
  }
  
  // Create global instance
  window.NotesAgentBridge = new NotesAgentBridge();
  
  // Override Agent.ask to use orchestrator
  const originalAsk = Agent.ask;
  Agent.ask = async function(question, options = {}) {
    // Use orchestrator for complex tasks
    if (question.includes('edit') || question.includes('insert') || question.includes('modify')) {
      return window.NotesAgentBridge.executeTask(question, {
        type: 'document-edit',
        tools: ['notes-edit-block', 'notes-insert-block']
      });
    }
    
    // Fall back to original for simple queries
    return originalAsk.call(this, question, options);
  };
  
})();
