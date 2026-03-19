const { Task } = require('./core/Task');
const { TaskStatus } = require('./core/TaskStatus');
const { ToolRegistry } = require('./tools/ToolRegistry');
const { WorkingMemory } = require('./memory/WorkingMemory');
const { SkillMemory, Skill } = require('./memory/SkillMemory');
const { SkillExtractor } = require('./memory/SkillExtractor');
const { SkillRetriever } = require('./memory/SkillRetriever');
const { Executor } = require('./execution/Executor');
const { RetryEngine } = require('./execution/RetryEngine');
const { Verifier } = require('./execution/Verifier');
const { Planner } = require('./execution/Planner');
const { VALID_TASK_TYPES } = require('./core/TaskSchema');

function createNoopVectorStore() {
  return {
    async upsert() {
      return [];
    },
    async retrieve() {
      return null;
    },
    async search() {
      return [];
    },
    async scroll() {
      return [];
    },
    async delete() {
      return undefined;
    }
  };
}

function normalizeMessageContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }
        if (entry?.type === 'text') {
          return entry.text || '';
        }
        return entry?.text || '';
      })
      .join('');
  }

  return '';
}

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
    sessionStore = null,
    memoryService = null,
    config = {}
  }) {
    if (!llmClient) {
      throw new Error('AgentOrchestrator requires an llmClient');
    }
    if (!embedder) {
      throw new Error('AgentOrchestrator requires an embedder');
    }

    const resolvedVectorStore = vectorStore || createNoopVectorStore();
    const skillsEnabled = vectorStore ? config.enableSkills !== false : false;
    if (!vectorStore) {
      console.warn('AgentOrchestrator started without a vectorStore; skill persistence is disabled');
    }

    this.llmClient = llmClient;
    this.embedder = embedder;
    this.vectorStore = resolvedVectorStore;
    this.sessionStore = sessionStore;
    this.memoryService = memoryService;

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
    this.skillMemory = new SkillMemory(resolvedVectorStore);

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
      ...config
    };
    this.config.enableSkills = skillsEnabled && this.config.enableSkills !== false;

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
    const task = new Task(this.normalizeTaskInput(taskInput, sessionId));
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
        trace: typeof result.trace?.toJSON === 'function' ? result.trace.toJSON() : result.trace,
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

  async executeConversation({
    input,
    instructions = null,
    contextMessages = [],
    recentMessages = [],
    previousResponseId = null,
    stream = false,
    model = null,
    toolManager = null,
    toolContext = {},
    enableAutomaticToolCalls = false,
    loadContextMessages = true,
    loadRecentMessages = true,
    sessionId = 'default',
    taskType = 'chat',
    metadata = {},
  } = {}) {
    const workingMemory = this.getWorkingMemory(sessionId);
    const objective = this.getConversationObjective(input);
    const resolvedContextMessages = contextMessages.length > 0
      ? contextMessages
      : loadContextMessages !== false
        ? await this.loadContextMessages(sessionId, objective)
        : [];
    const resolvedRecentMessages = recentMessages.length > 0
      ? recentMessages
      : loadRecentMessages !== false
        ? await this.loadRecentMessages(sessionId)
        : [];
    const task = new Task(this.normalizeTaskInput({
      type: this.normalizeConversationTaskType(taskType),
      objective,
      input: {
        content: objective,
        format: Array.isArray(input) ? 'json' : 'text',
      },
      context: {
        sessionId,
        metadata,
      },
      completionCriteria: {
        conditions: ['output-not-empty', 'no-errors'],
      },
    }, sessionId));

    workingMemory.setCurrentTask(task);
    this.syncWorkingMemoryTranscript(workingMemory, resolvedRecentMessages);
    if (objective) {
      workingMemory.addMessage('user', objective, { source: 'runtime' });
    }

    this.transitionRuntimeTask(task, TaskStatus.EXECUTING);
    this.emit('task:start', {
      task,
      sessionId,
      timestamp: Date.now(),
      metadata: {
        ...metadata,
        stream,
        taskType,
      },
    });

    try {
      const response = await this.llmClient.createResponse({
        input,
        previousResponseId,
        contextMessages: resolvedContextMessages,
        recentMessages: resolvedRecentMessages,
        instructions,
        stream,
        model,
        toolManager,
        toolContext: {
          sessionId,
          ...toolContext,
        },
        enableAutomaticToolCalls,
      });

        if (stream) {
          return {
            success: true,
            sessionId,
            task: task.toJSON(),
            response: this.wrapConversationStream({
              response,
              task,
              workingMemory,
              sessionId,
              model,
              userText: objective,
              metadata: {
                ...metadata,
                taskType,
              },
            }),
          };
        }
  
        const output = this.extractResponseOutput(response);
        const toolEvents = this.extractToolEvents(response);
        const duration = this.finalizeRuntimeTask(task, workingMemory, output);
        await this.persistConversationState({
          sessionId,
          userText: objective,
          assistantText: output,
          responseId: response?.id || null,
          toolEvents,
        });
        const trace = this.buildConversationTrace({
          task,
          sessionId,
          output,
          responseId: response?.id || null,
          model: response?.model || model || null,
          duration,
          metadata: {
            ...metadata,
            taskType,
            stream,
            toolEventCount: toolEvents.length,
          },
        });

      this.emit('task:complete', {
        task,
        sessionId,
        timestamp: Date.now(),
        result: {
          success: true,
          output,
          responseId: response?.id || null,
          trace,
          duration,
        },
      });

      return {
        success: true,
        sessionId,
        task: task.toJSON(),
        output,
        response,
        trace,
      };
    } catch (error) {
      this.failRuntimeTask(task);
      this.emit('task:error', {
        task,
        sessionId,
        timestamp: Date.now(),
        error: error.message,
        stack: error.stack,
        metadata: {
          ...metadata,
          taskType,
        },
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
    const existingMemory = this.workingMemories.get(sessionId);
    if (existingMemory?.isExpired()) {
      this.workingMemories.delete(sessionId);
    }

    if (!this.workingMemories.has(sessionId)) {
      this.workingMemories.set(sessionId, new WorkingMemory(sessionId));
    }
    return this.workingMemories.get(sessionId);
  }

  normalizeTaskInput(taskInput, sessionId) {
    const normalized = typeof taskInput === 'string'
      ? {
          type: 'chat',
          objective: taskInput,
          input: {
            content: taskInput,
            format: 'text'
          }
        }
      : {
          ...(taskInput || {})
        };

    const inferredObjective = typeof normalized.objective === 'string' && normalized.objective.trim()
      ? normalized.objective.trim()
      : typeof normalized.input?.content === 'string' && normalized.input.content.trim()
        ? normalized.input.content.trim()
        : '';

    const normalizedType = VALID_TASK_TYPES.includes(normalized.type)
      ? normalized.type
      : normalized.type === 'chat-interaction'
        ? 'chat'
        : 'multi-step';

    const normalizedConditions = Array.isArray(normalized.completionCriteria?.conditions)
      ? normalized.completionCriteria.conditions.map((condition) => {
          if (typeof condition === 'string') {
            return {
              type: 'custom-function',
              fn: async (_task, executionResult) => ({
                valid: condition === 'response-delivered'
                  ? Boolean(executionResult?.output)
                  : condition === 'no-errors'
                    ? !executionResult?.error
                    : true,
                message: `Normalized legacy condition "${condition}"`,
              }),
            };
          }

          return condition;
        })
      : normalized.completionCriteria?.conditions;

    return {
      ...normalized,
      type: normalizedType,
      objective: inferredObjective,
      input: {
        format: 'text',
        ...(normalized.input || {}),
        content: typeof normalized.input?.content === 'string'
          ? normalized.input.content
          : inferredObjective,
      },
      context: {
        ...(normalized.context || {}),
        sessionId: normalized.context?.sessionId || sessionId,
      },
      completionCriteria: normalized.completionCriteria
        ? {
            ...normalized.completionCriteria,
            conditions: normalizedConditions,
          }
        : normalized.completionCriteria,
    };
  }

  normalizeConversationTaskType(taskType) {
    if (VALID_TASK_TYPES.includes(taskType)) {
      return taskType;
    }

    return 'chat';
  }

  getConversationObjective(input) {
    if (typeof input === 'string') {
      return input;
    }

    if (Array.isArray(input)) {
      for (let index = input.length - 1; index >= 0; index -= 1) {
        if (input[index]?.role === 'user') {
          return normalizeMessageContent(input[index].content);
        }
      }
    }

    return '';
  }

  async loadContextMessages(sessionId, objective) {
    if (!objective || !this.memoryService?.recall) {
      return [];
    }

    return this.memoryService.recall(objective, {
      sessionId,
    });
  }

  async loadRecentMessages(sessionId, limit = 12) {
    if (!sessionId || !this.sessionStore?.getRecentMessages) {
      return [];
    }

    return this.sessionStore.getRecentMessages(sessionId, limit);
  }

  syncWorkingMemoryTranscript(workingMemory, recentMessages = []) {
    if (!Array.isArray(recentMessages) || recentMessages.length === 0) {
      return;
    }

    const existingKeys = new Set(
      workingMemory.getMessages().map((message) => `${message.role}:${message.content}`)
    );

    for (const entry of recentMessages) {
      if (!['user', 'assistant', 'system', 'tool'].includes(entry?.role)) {
        continue;
      }

      const content = normalizeMessageContent(entry?.content);
      if (!content) {
        continue;
      }

      const key = `${entry.role}:${content}`;
      if (existingKeys.has(key)) {
        continue;
      }

      workingMemory.addMessage(entry.role, content, {
        source: 'session-store',
      });
      existingKeys.add(key);
    }
  }

  extractResponseOutput(response) {
    return (response?.output || [])
      .filter((item) => item.type === 'message')
      .map((item) => (item.content || []).map((content) => content.text).join(''))
      .join('\n');
  }

  extractToolEvents(response = {}) {
    return Array.isArray(response?.metadata?.toolEvents)
      ? response.metadata.toolEvents
      : [];
  }

  wrapConversationStream({
    response,
    task,
    workingMemory,
    sessionId,
    model,
    userText = '',
    metadata = {},
  }) {
    const orchestrator = this;

    return (async function* wrappedStream() {
      let fullText = '';

      try {
        for await (const event of response) {
          if (event.type === 'response.output_text.delta') {
            fullText += event.delta;
          }

          if (event.type === 'response.completed') {
            const toolEvents = orchestrator.extractToolEvents(event.response);
            const duration = orchestrator.finalizeRuntimeTask(task, workingMemory, fullText);
            await orchestrator.persistConversationState({
              sessionId,
              userText,
              assistantText: fullText,
              responseId: event.response?.id || null,
              toolEvents,
            });
            const trace = orchestrator.buildConversationTrace({
              task,
              sessionId,
              output: fullText,
              responseId: event.response?.id || null,
              model: event.response?.model || model || null,
              duration,
              metadata: {
                ...metadata,
                stream: true,
                toolEventCount: toolEvents.length,
              },
            });

            orchestrator.emit('task:complete', {
              task,
              sessionId,
              timestamp: Date.now(),
              result: {
                success: true,
                output: fullText,
                responseId: event.response?.id || null,
                trace,
                duration,
              },
            });
          }

          yield event;
        }
      } catch (error) {
        orchestrator.failRuntimeTask(task);
        orchestrator.emit('task:error', {
          task,
          sessionId,
          timestamp: Date.now(),
          error: error.message,
          stack: error.stack,
          metadata,
        });
        throw error;
      }
    }());
  }

  transitionRuntimeTask(task, nextStatus) {
    try {
      task.transitionStatus(nextStatus);
    } catch (_error) {
      task.status = nextStatus;
    }
  }

  finalizeRuntimeTask(task, workingMemory, output) {
    if (output) {
      workingMemory.addMessage('assistant', output, { source: 'runtime' });
    }

    this.transitionRuntimeTask(task, TaskStatus.COMPLETED);
    return task.metadata?.executionTime || 0;
  }

  failRuntimeTask(task) {
    this.transitionRuntimeTask(task, TaskStatus.FAILED);
  }

  buildConversationTrace({
    task,
    sessionId,
    output,
    responseId,
    model,
    duration,
    metadata = {},
  }) {
    return {
      id: `runtime-${task.id}`,
      taskId: task.id,
      sessionId,
      model,
      responseId,
      duration,
      status: 'completed',
      createdAt: task.metadata?.createdAt || new Date().toISOString(),
      completedAt: task.metadata?.completedAt || new Date().toISOString(),
      metadata,
      steps: [
        {
          type: 'model_call',
          status: 'completed',
          description: `${metadata.taskType || task.type} runtime response`,
          outputPreview: String(output || '').slice(0, 200),
        },
      ],
    };
  }

  async persistConversationState({
    sessionId,
    userText,
    assistantText,
    responseId,
    toolEvents = [],
  }) {
    if (!sessionId) {
      return;
    }

    if (this.sessionStore?.recordResponse && responseId) {
      await this.sessionStore.recordResponse(sessionId, responseId);
    }

    const transcriptMessages = [];
    if (userText) {
      transcriptMessages.push({ role: 'user', content: userText });
    }

    for (const toolEvent of toolEvents) {
      const toolName = toolEvent?.toolCall?.function?.name || 'tool';
      const argumentsJson = toolEvent?.toolCall?.function?.arguments || '{}';
      transcriptMessages.push({
        role: 'tool',
        content: JSON.stringify({
          tool: toolName,
          arguments: argumentsJson,
          result: toolEvent?.result || {},
        }),
      });
    }

    if (assistantText) {
      transcriptMessages.push({ role: 'assistant', content: assistantText });
    }

    if (this.sessionStore?.appendMessages && transcriptMessages.length > 0) {
      await this.sessionStore.appendMessages(sessionId, transcriptMessages);
    }

    if (this.memoryService?.remember && userText) {
      await this.memoryService.remember(sessionId, userText, 'user');
    }

    if (this.memoryService?.rememberResponse && assistantText) {
      await this.memoryService.rememberResponse(sessionId, assistantText);
    }

    if (this.memoryService?.remember) {
      for (const toolEvent of toolEvents) {
        const toolName = toolEvent?.toolCall?.function?.name || 'tool';
        await this.memoryService.remember(
          sessionId,
          JSON.stringify({
            tool: toolName,
            result: toolEvent?.result || {},
          }),
          'tool',
        );
      }
    }
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
