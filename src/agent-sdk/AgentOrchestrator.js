const { Task } = require('./core/Task');
const { ToolRegistry } = require('./tools/ToolRegistry');
const { WorkingMemory } = require('./memory/WorkingMemory');
const { SkillMemory, Skill } = require('./memory/SkillMemory');
const { SkillExtractor } = require('./memory/SkillExtractor');
const { SkillRetriever } = require('./memory/SkillRetriever');
const { Executor } = require('./execution/Executor');
const { RetryEngine } = require('./execution/RetryEngine');
const { Verifier } = require('./execution/Verifier');
const { Planner } = require('./execution/Planner');

/**
 * @typedef {Object} AgentOrchestratorConfig
 * @property {number} [maxRetries=3] - Maximum number of retry attempts for failed operations
 * @property {number} [defaultTimeout=30000] - Default timeout in milliseconds for task execution
 * @property {boolean} [enableTracing=true] - Whether to enable execution tracing
 * @property {boolean} [enableSkills=true] - Whether to enable skill learning and retrieval
 * @property {Object} [custom] - Additional custom configuration options
 */

/**
 * @typedef {Object} ExecuteOptions
 * @property {string} [sessionId='default'] - Session identifier for maintaining conversation context
 * @property {boolean} [useSkills=true] - Whether to use skills for this execution
 * @property {number} [timeout] - Override default timeout for this execution
 * @property {AbortSignal} [signal] - AbortSignal for cancellation support
 */

/**
 * @typedef {Object} ExecuteResult
 * @property {boolean} success - Whether the task executed successfully
 * @property {Object} task - Serialized task object
 * @property {*} output - The task output
 * @property {Object} [trace] - Execution trace if tracing is enabled
 * @property {string} sessionId - The session ID used for execution
 */

/**
 * @typedef {Object} OrchestratorStats
 * @property {Object} tools - Tool registry statistics
 * @property {number} sessions - Number of active sessions
 * @property {Object} skills - Skill memory statistics
 */

/**
 * Main entry point for the Agent SDK.
 * Orchestrates task execution with memory, tools, and skills.
 * 
 * The AgentOrchestrator serves as the central coordinator for all agent operations,
 * managing the lifecycle of tasks from planning through execution, verification,
 * and skill capture. It maintains working memory per session and integrates with
 * various subsystems including tool execution, retry logic, and skill learning.
 * 
 * @example
 * const orchestrator = new AgentOrchestrator({
 *   llmClient: openaiClient,
 *   embedder: embeddingClient,
 *   vectorStore: pineconeStore,
 *   config: { maxRetries: 5, enableSkills: true }
 * });
 * 
 * orchestrator.on('task:complete', ({ task, result }) => {
 *   console.log(`Task ${task.id} completed`);
 * });
 * 
 * const result = await orchestrator.execute('Analyze this data', { 
 *   sessionId: 'user-123' 
 * });
 * 
 * @class
 */
class AgentOrchestrator {
  /**
   * Creates a new AgentOrchestrator instance.
   * 
   * @param {Object} dependencies - Required dependencies
   * @param {Object} dependencies.llmClient - LLM client for generating responses and plans
   * @param {Object} dependencies.embedder - Embedding client for vector operations
   * @param {Object} dependencies.vectorStore - Vector store for skill persistence
   * @param {AgentOrchestratorConfig} [dependencies.config={}] - Configuration options
   * @throws {Error} If required dependencies (llmClient, embedder, vectorStore) are not provided
   */
  constructor({
    llmClient,
    embedder,
    vectorStore,
    config = {}
  }) {
    if (!llmClient) {
      throw new Error('AgentOrchestrator requires an llmClient');
    }
    if (!embedder) {
      throw new Error('AgentOrchestrator requires an embedder');
    }
    if (!vectorStore) {
      throw new Error('AgentOrchestrator requires a vectorStore');
    }

    this.llmClient = llmClient;
    this.embedder = embedder;
    this.vectorStore = vectorStore;

    // Initialize core execution components
    /**
     * Registry for managing available tools.
     * @type {ToolRegistry}
     * @private
     */
    this.toolRegistry = new ToolRegistry();

    /**
     * Engine for handling retry logic on failures.
     * @type {RetryEngine}
     * @private
     */
    this.retryEngine = new RetryEngine();

    /**
     * Verifier for validating execution results.
     * @type {Verifier}
     * @private
     */
    this.verifier = new Verifier();

    /**
     * Planner for creating execution strategies.
     * @type {Planner}
     * @private
     */
    this.planner = new Planner(this.toolRegistry, llmClient);

    // Memory systems
    /**
     * Map of session IDs to WorkingMemory instances.
     * @type {Map<string, WorkingMemory>}
     * @private
     */
    this.workingMemories = new Map();

    /**
     * Persistent memory for learned skills.
     * @type {SkillMemory}
     * @private
     */
    this.skillMemory = new SkillMemory(vectorStore);

    /**
     * Extractor for capturing skills from successful tasks.
     * @type {SkillExtractor}
     * @private
     */
    this.skillExtractor = new SkillExtractor(embedder);

    /**
     * Retriever for finding relevant skills for tasks.
     * @type {SkillRetriever}
     * @private
     */
    this.skillRetriever = new SkillRetriever(this.skillMemory, embedder);

    // Configuration
    /**
     * Merged configuration with defaults.
     * @type {AgentOrchestratorConfig}
     * @private
     */
    this.config = {
      maxRetries: 3,
      defaultTimeout: 30000,
      enableTracing: true,
      enableSkills: true,
      ...config
    };

    // Event handling system
    /**
     * Map of event names to arrays of handler functions.
     * @type {Map<string, Function[]>}
     * @private
     */
    this.eventHandlers = new Map();
  }

  /**
   * Execute a task with full orchestration lifecycle.
   * 
   * The execution flow:
   * 1. Get or create working memory for the session
   * 2. Create and register the task
   * 3. Retrieve relevant skills from memory
   * 4. Create an executor with all dependencies
   * 5. Execute the task with event emission
   * 6. Capture skill if execution was successful
   * 
   * @param {string|Object} taskInput - Task description string or task configuration object
   * @param {ExecuteOptions} [options={}] - Execution options
   * @returns {Promise<ExecuteResult>} Execution result with task data, output, and trace
   * @throws {Error} If execution fails and all retries are exhausted
   * @fires AgentOrchestrator#task:start
   * @fires AgentOrchestrator#task:complete
   * @fires AgentOrchestrator#task:error
   */
  async execute(taskInput, options = {}) {
    const { 
      sessionId = 'default', 
      useSkills = true,
      timeout = this.config.defaultTimeout,
      signal
    } = options;

    // Get or create working memory for this session
    const workingMemory = this.getWorkingMemory(sessionId);

    // Create task from input
    const task = new Task(taskInput);
    workingMemory.setCurrentTask(task);

    // Retrieve relevant skills to provide context
    let skillContext = '';
    if (useSkills && this.config.enableSkills) {
      try {
        const skills = await this.skillRetriever.retrieveForTask(task);
        skillContext = this.skillRetriever.formatForPrompt(skills);
        workingMemory.setIntermediateResult('relevantSkills', skills);
      } catch (error) {
        console.warn('Failed to retrieve skills:', error.message);
      }
    }

    // Create executor with all dependencies
    const executor = new Executor({
      toolRegistry: this.toolRegistry,
      workingMemory,
      retryEngine: this.retryEngine,
      verifier: this.verifier,
      planner: this.planner,
      llmClient: this.llmClient,
      skillContext,
      timeout,
      signal
    });

    // Emit start event
    this.emit('task:start', { task, sessionId, timestamp: Date.now() });

    try {
      const result = await executor.execute(task);

      // Emit completion event
      this.emit('task:complete', { 
        task, 
        result, 
        sessionId, 
        timestamp: Date.now(),
        duration: result.duration 
      });

      // Capture skill if execution was successful
      if (result.success && this.config.enableSkills) {
        try {
          await this.captureSkill(task.id);
        } catch (error) {
          console.warn('Failed to capture skill:', error.message);
        }
      }

      return {
        success: result.success,
        task: task.toJSON(),
        output: result.output,
        trace: result.trace?.toJSON(),
        sessionId
      };

    } catch (error) {
      // Emit error event
      this.emit('task:error', { 
        task, 
        error: error.message, 
        sessionId, 
        timestamp: Date.now(),
        stack: error.stack 
      });
      throw error;
    }
  }

  /**
   * Capture a skill from a successfully completed task.
   * 
   * This method extracts patterns from the task execution and stores
   * them as reusable skills for future similar tasks.
   * 
   * @param {string} taskId - The ID of the task to extract skill from
   * @returns {Promise<Skill|null>} The captured skill or null if extraction failed
   * @fires AgentOrchestrator#skill:captured
   * @private
   */
  async captureSkill(taskId) {
    const task = this.findTaskInMemory(taskId);
    if (!task) {
      console.warn(`Task ${taskId} not found in memory for skill capture`);
      return null;
    }

    const skill = await this.skillExtractor.extractFromTask(task);
    if (!skill) {
      return null;
    }

    await this.skillMemory.store(skill);

    this.emit('skill:captured', { skill, taskId, timestamp: Date.now() });

    return skill;
  }

  /**
   * Register a single tool with the orchestrator.
   * 
   * @param {Object} toolDefinition - Tool definition object
   * @param {string} toolDefinition.name - Unique tool name
   * @param {string} toolDefinition.description - Tool description for LLM
   * @param {Object} toolDefinition.parameters - JSON Schema for tool parameters
   * @param {Function} toolDefinition.execute - Async function to execute the tool
   * @returns {AgentOrchestrator} This orchestrator instance for method chaining
   * @throws {Error} If tool definition is invalid
   * @example
   * orchestrator.registerTool({
   *   name: 'calculator',
   *   description: 'Perform mathematical calculations',
   *   parameters: {
   *     type: 'object',
   *     properties: {
   *       expression: { type: 'string' }
   *     },
   *     required: ['expression']
   *   },
   *   execute: async ({ expression }) => eval(expression)
   * });
   */
  registerTool(toolDefinition) {
    this.toolRegistry.register(toolDefinition);
    return this;
  }

  /**
   * Register multiple tools at once.
   * 
   * @param {Object[]} tools - Array of tool definition objects
   * @returns {AgentOrchestrator} This orchestrator instance for method chaining
   */
  registerTools(tools) {
    for (const tool of tools) {
      this.registerTool(tool);
    }
    return this;
  }

  /**
   * Get or create working memory for a session.
   * 
   * @param {string} sessionId - Unique session identifier
   * @returns {WorkingMemory} The working memory instance for this session
   */
  getWorkingMemory(sessionId) {
    if (!this.workingMemories.has(sessionId)) {
      this.workingMemories.set(sessionId, new WorkingMemory(sessionId));
    }
    return this.workingMemories.get(sessionId);
  }

  /**
   * Clear working memory for a specific session.
   * This frees up memory and resets the session state.
   * 
   * @param {string} sessionId - Session identifier to clear
   * @returns {boolean} True if a session was cleared, false if not found
   */
  clearWorkingMemory(sessionId) {
    return this.workingMemories.delete(sessionId);
  }

  /**
   * Clear all working memories across all sessions.
   * Use with caution as this resets all conversation contexts.
   * 
   * @returns {number} Number of sessions cleared
   */
  clearAllWorkingMemories() {
    const count = this.workingMemories.size;
    this.workingMemories.clear();
    return count;
  }

  /**
   * Find a task in any active working memory.
   * Searches across all sessions for the specified task ID.
   * 
   * @param {string} taskId - Task identifier to search for
   * @returns {Task|null} The found task or null if not found
   * @private
   */
  findTaskInMemory(taskId) {
    for (const [sessionId, memory] of this.workingMemories) {
      if (memory.currentTask?.id === taskId) {
        return memory.currentTask;
      }
    }
    return null;
  }

  /**
   * Register an event handler.
   * 
   * Supported events:
   * - 'task:start' - Emitted when a task begins execution
   * - 'task:complete' - Emitted when a task completes successfully
   * - 'task:error' - Emitted when a task fails
   * - 'skill:captured' - Emitted when a skill is learned from a task
   * 
   * @param {string} event - Event name to listen for
   * @param {Function} handler - Event handler function
   * @returns {AgentOrchestrator} This orchestrator instance for method chaining
   */
  on(event, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Event handler must be a function');
    }
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
    return this;
  }

  /**
   * Remove an event handler.
   * 
   * @param {string} event - Event name
   * @param {Function} handler - Handler function to remove
   * @returns {boolean} True if handler was found and removed
   */
  off(event, handler) {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) return false;
    
    const index = handlers.indexOf(handler);
    if (index > -1) {
      handlers.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Emit an event to all registered handlers.
   * Handlers are called synchronously but errors are caught and logged.
   * 
   * @param {string} event - Event name to emit
   * @param {Object} data - Event data payload
   * @returns {number} Number of handlers invoked
   * @private
   */
  emit(event, data) {
    const handlers = this.eventHandlers.get(event) || [];
    let invoked = 0;
    
    for (const handler of handlers) {
      try {
        handler(data);
        invoked++;
      } catch (error) {
        console.error(`Event handler error for ${event}:`, error);
      }
    }
    
    return invoked;
  }

  /**
   * Get comprehensive orchestrator statistics.
   * 
   * @returns {OrchestratorStats} Statistics object containing tool, session, and skill counts
   */
  getStats() {
    return {
      tools: this.toolRegistry.getStats(),
      sessions: this.workingMemories.size,
      skills: this.skillMemory.getStats?.() || { total: 0 },
      config: {
        maxRetries: this.config.maxRetries,
        defaultTimeout: this.config.defaultTimeout,
        enableTracing: this.config.enableTracing,
        enableSkills: this.config.enableSkills
      }
    };
  }

  /**
   * Get a list of all active session IDs.
   * 
   * @returns {string[]} Array of session identifiers
   */
  getActiveSessions() {
    return Array.from(this.workingMemories.keys());
  }

  /**
   * Check if a session has active working memory.
   * 
   * @param {string} sessionId - Session identifier to check
   * @returns {boolean} True if session exists
   */
  hasSession(sessionId) {
    return this.workingMemories.has(sessionId);
  }

  /**
   * Gracefully shutdown the orchestrator.
   * Clears all working memories and releases resources.
   * 
   * @returns {Promise<void>}
   */
  async shutdown() {
    this.clearAllWorkingMemories();
    this.eventHandlers.clear();
  }
}

module.exports = { AgentOrchestrator };
