const { TaskStatus } = require('../core/TaskStatus');
const { ExecutionTrace, ExecutionStep } = require('./ExecutionTrace');

/**
 * Result of executing a single step.
 * @typedef {Object} StepResult
 * @property {boolean} success - Whether the step succeeded
 * @property {*} output - Step output
 * @property {Error} [error] - Error if failed
 * @property {number} duration - Execution duration in ms
 */

/**
 * Result of plan execution.
 * @typedef {Object} PlanExecutionResult
 * @property {*} output - Final output
 * @property {Array} results - All step results
 * @property {Object} plan - Plan state
 * @property {boolean} success - Overall success
 */

/**
 * Main execution orchestrator that coordinates planning, execution,
 * verification, and retry logic for task execution.
 * @class Executor
 */
class Executor {
  /**
   * Creates an Executor instance.
   * @param {Object} options - Configuration options
   * @param {Object} options.toolRegistry - Registry for tool execution
   * @param {Object} options.workingMemory - Working memory for context
   * @param {RetryEngine} options.retryEngine - Retry engine for failed operations
   * @param {Verifier} options.verifier - Verifier for result validation
   * @param {Planner} options.planner - Planner for execution plans
   * @param {Object} options.llmClient - LLM client for LLM operations
   */
  constructor({
    toolRegistry,
    workingMemory,
    retryEngine,
    verifier,
    planner,
    llmClient
  }) {
    /** @type {Object} Tool registry */
    this.toolRegistry = toolRegistry;
    
    /** @type {Object} Working memory */
    this.workingMemory = workingMemory;
    
    /** @type {RetryEngine} Retry engine */
    this.retryEngine = retryEngine;
    
    /** @type {Verifier} Result verifier */
    this.verifier = verifier;
    
    /** @type {Planner} Task planner */
    this.planner = planner;
    
    /** @type {Object} LLM client */
    this.llmClient = llmClient;
    
    /** @type {Object} Event handlers */
    this.eventHandlers = {
      statusChange: [],
      stepComplete: [],
      stepError: [],
      verificationComplete: []
    };
  }
  
  /**
   * Registers an event handler.
   * @param {string} event - Event name: 'statusChange', 'stepComplete', 'stepError', 'verificationComplete'
   * @param {Function} handler - Event handler function
   * @returns {Executor} This executor for chaining
   */
  on(event, handler) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].push(handler);
    }
    return this;
  }
  
  /**
   * Emits an event to registered handlers.
   * @private
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  emit(event, data) {
    if (this.eventHandlers[event]) {
      for (const handler of this.eventHandlers[event]) {
        try {
          handler(data);
        } catch (error) {
          console.error(`Event handler error for ${event}:`, error);
        }
      }
    }
  }
  
  /**
   * Executes a task through the full lifecycle: planning, execution, verification.
   * @param {Object} task - The task to execute
   * @returns {Promise<Object>} Execution result with trace and verification
   */
  async execute(task) {
    const trace = new ExecutionTrace(task.id);
    
    try {
      // Transition to planning
      this.transitionTaskStatus(task, TaskStatus.PLANNING);
      
      // Create execution plan
      let plan;
      try {
        plan = await this.planner.createPlan(task);
      } catch (planError) {
        this.transitionTaskStatus(task, TaskStatus.FAILED);
        trace.finalize();
        return {
          success: false,
          error: `Planning failed: ${planError.message}`,
          trace: trace.toJSON()
        };
      }
      
      // Transition to executing
      this.transitionTaskStatus(task, TaskStatus.EXECUTING);
      
      // Execute plan
      const result = await this.executePlan(task, plan, trace);
      
      // Check if plan execution failed
      if (!result.success) {
        this.transitionTaskStatus(task, TaskStatus.FAILED);
        trace.finalize();
        return {
          success: false,
          error: result.error,
          trace: trace.toJSON(),
          plan: plan.toJSON()
        };
      }
      
      // Transition to verifying
      this.transitionTaskStatus(task, TaskStatus.VERIFYING);
      
      // Verify result
      let verification;
      try {
        verification = await this.verifier.verify(task, result);
      } catch (verifyError) {
        verification = {
          valid: false,
          passed: 0,
          total: 1,
          results: [{
            valid: false,
            criterion: 'verification',
            message: `Verification error: ${verifyError.message}`,
            timestamp: new Date().toISOString()
          }],
          timestamp: new Date().toISOString()
        };
      }
      
      this.emit('verificationComplete', { task, verification });
      
      if (verification.valid) {
        this.transitionTaskStatus(task, TaskStatus.COMPLETED);
        result.success = true;
      } else {
        // Check if we can retry the entire task
        if (task.canRetry && task.canRetry()) {
          if (task.incrementAttempt) {
            task.incrementAttempt();
          }
          return this.execute(task); // Retry entire task
        }
        
        this.transitionTaskStatus(task, TaskStatus.FAILED);
        result.success = false;
        result.verificationFailed = true;
        result.verification = verification;
      }
      
      trace.finalize();
      result.trace = trace.toJSON();
      result.verification = verification;
      
      return result;
      
    } catch (error) {
      this.transitionTaskStatus(task, TaskStatus.FAILED);
      trace.finalize();
      
      return {
        success: false,
        error: error.message,
        stack: error.stack,
        trace: trace.toJSON()
      };
    }
  }
  
  /**
   * Transitions task status and emits event.
   * @private
   * @param {Object} task - The task
   * @param {TaskStatus} status - New status
   */
  transitionTaskStatus(task, status) {
    if (task.transitionStatus) {
      task.transitionStatus(status);
    } else {
      task.status = status;
    }
    this.emit('statusChange', { task, status });
  }
  
  /**
   * Executes all steps in a plan respecting dependencies.
   * @private
   * @param {Object} task - The task
   * @param {ExecutionPlan} plan - The execution plan
   * @param {ExecutionTrace} trace - Execution trace
   * @returns {Promise<PlanExecutionResult>} Execution result
   */
  async executePlan(task, plan, trace) {
    const results = [];
    
    while (!plan.isComplete() && !plan.hasFailed()) {
      const readySteps = plan.getReadySteps();
      
      if (readySteps.length === 0 && !plan.isComplete()) {
        // Deadlock detected - no ready steps but plan not complete
        return {
          success: false,
          error: 'Execution deadlock: no ready steps but plan incomplete',
          results,
          plan: plan.toJSON()
        };
      }
      
      for (const step of readySteps) {
        plan.markStepRunning(step.id);
        
        const stepTrace = new ExecutionStep({
          type: step.type,
          description: step.description,
          input: step.params || step
        });
        
        const startTime = Date.now();
        
        try {
          // Execute with retry logic
          const retryResult = await this.executeStepWithRetry(step, task);
          
          if (retryResult.success) {
            stepTrace.output = retryResult.result;
            stepTrace.setDuration(startTime);
            
            if (retryResult.attempts > 1) {
              stepTrace.metadata.retries = retryResult.attempts - 1;
            }
            
            plan.markStepComplete(step.id, retryResult.result);
            results.push({
              step: step.id,
              success: true,
              output: retryResult.result
            });
            
            this.emit('stepComplete', { task, step, result: retryResult.result });
          } else {
            throw retryResult.error || new Error('Step failed after retries');
          }
          
        } catch (error) {
          stepTrace.error = error.message;
          stepTrace.setDuration(startTime);
          plan.markStepFailed(step.id, error);
          
          results.push({
            step: step.id,
            success: false,
            error: error.message
          });
          
          this.emit('stepError', { task, step, error });
          
          // Check if we should continue or abort
          if (!this.shouldContinueOnError(step, task)) {
            return {
              success: false,
              error: `Step "${step.description}" failed: ${error.message}`,
              results,
              plan: plan.toJSON()
            };
          }
        }
        
        trace.addStep(stepTrace);
      }
    }
    
    const success = plan.isComplete() && !plan.hasFailed();
    
    return {
      success,
      output: results.length > 0 ? results[results.length - 1].output : null,
      results,
      plan: plan.toJSON(),
      error: plan.hasFailed() ? 'One or more steps failed' : undefined
    };
  }
  
  /**
   * Executes a step with retry logic.
   * @private
   * @param {Object} step - The step to execute
   * @param {Object} task - The task context
   * @returns {Promise<Object>} Retry result
   */
  async executeStepWithRetry(step, task) {
    const operation = () => this.executeStep(step, task);
    
    // Use task-specific retry policy or default
    const policy = task.retryPolicy || this.retryEngine?.defaultPolicy;
    
    if (this.retryEngine) {
      return this.retryEngine.executeWithRetry(operation, policy);
    }
    
    // Fallback to direct execution without retry
    try {
      const result = await operation();
      return { success: true, result, attempts: 1, policy: 'none' };
    } catch (error) {
      return { success: false, error, attempts: 1, policy: 'none' };
    }
  }
  
  /**
   * Determines whether to continue execution after a step error.
   * @private
   * @param {Object} step - The failed step
   * @param {Object} task - The task
   * @returns {boolean} Whether to continue
   */
  shouldContinueOnError(step, task) {
    // Check task configuration
    if (task.continueOnError) return true;
    
    // Check step configuration
    if (step.continueOnError) return true;
    
    // Check if step is optional
    if (step.optional) return true;
    
    // Default: stop on error
    return false;
  }
  
  /**
   * Executes a single step based on its type.
   * @private
   * @param {Object} step - The step to execute
   * @param {Object} task - The task context
   * @returns {Promise<*>} Step result
   * @throws {Error} If step type is unknown or execution fails
   */
  async executeStep(step, task) {
    switch (step.type) {
      case 'tool-call':
        return this.executeToolCall(step, task);
      
      case 'llm-call':
        return this.executeLLMCall(step, task);
      
      case 'understand':
      case 'analyze':
      case 'plan':
        // These are typically LLM-based analysis steps
        return this.executeLLMCall(step, task);
      
      case 'generate':
      case 'edit':
      case 'refactor':
        // Code/doc generation steps
        return step.tool 
          ? this.executeToolCall(step, task)
          : this.executeLLMCall(step, task);
      
      case 'validate':
      case 'verify':
      case 'test':
      case 'run':
        // Validation/testing steps
        return this.executeToolCall(step, task);
      
      case 'gather':
        // Information gathering
        return this.executeToolCall(step, task);
      
      case 'report':
        // Report generation
        return this.executeLLMCall(step, task);
      
      default:
        // Try to execute as tool call if tool is specified
        if (step.tool && this.toolRegistry) {
          return this.executeToolCall(step, task);
        }
        // Fall back to LLM call
        if (this.llmClient) {
          return this.executeLLMCall(step, task);
        }
        throw new Error(`Unknown step type: ${step.type} and no fallback available`);
    }
  }
  
  /**
   * Executes a tool call step.
   * @private
   * @param {Object} step - The step
   * @param {Object} task - The task context
   * @returns {Promise<*>} Tool result
   */
  async executeToolCall(step, task) {
    if (!this.toolRegistry) {
      throw new Error('Tool registry not available for tool-call step');
    }
    
    const params = this.resolveParams(step.params || {}, task);
    
    return this.toolRegistry.execute(step.tool, params, {
      task,
      workingMemory: this.workingMemory,
      step
    });
  }
  
  /**
   * Executes an LLM call step.
   * @private
   * @param {Object} step - The step
   * @param {Object} task - The task context
   * @returns {Promise<*>} LLM response
   */
  async executeLLMCall(step, task) {
    if (!this.llmClient) {
      throw new Error('LLM client not available for llm-call step');
    }
    
    // Construct prompt from step or use provided prompt
    const prompt = step.prompt || step.params?.prompt || this.constructPrompt(step, task);
    
    const options = {
      temperature: step.temperature,
      maxTokens: step.maxTokens,
      ...step.llmOptions
    };
    
    return this.llmClient.complete(prompt, options);
  }
  
  /**
   * Constructs a prompt for LLM steps.
   * @private
   * @param {Object} step - The step
   * @param {Object} task - The task
   * @returns {string} Constructed prompt
   */
  constructPrompt(step, task) {
    const parts = [
      `Task: ${task.objective}`,
      `Step: ${step.description}`,
      `Type: ${step.type}`
    ];
    
    if (task.input) {
      parts.push(`Input: ${JSON.stringify(task.input, null, 2)}`);
    }
    
    if (step.params) {
      parts.push(`Parameters: ${JSON.stringify(step.params, null, 2)}`);
    }
    
    return parts.join('\n\n');
  }
  
  /**
   * Resolves parameter placeholders in step params.
   * @private
   * @param {Object} params - Parameters with possible placeholders
   * @param {Object} task - Task context for variable resolution
   * @returns {Object} Resolved parameters
   */
  resolveParams(params, task) {
    const resolved = {};
    
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
        // Resolve placeholder from task or working memory
        const path = value.slice(2, -2).trim();
        resolved[key] = this.resolveValue(path, task);
      } else {
        resolved[key] = value;
      }
    }
    
    return resolved;
  }
  
  /**
   * Resolves a value path from task or working memory.
   * @private
   * @param {string} path - Dot-notation path
   * @param {Object} task - Task context
   * @returns {*} Resolved value
   */
  resolveValue(path, task) {
    const parts = path.split('.');
    let value = task;
    
    for (const part of parts) {
      if (value === undefined || value === null) {
        return undefined;
      }
      value = value[part];
    }
    
    // Fallback to working memory
    if (value === undefined && this.workingMemory) {
      value = this.workingMemory.get(path);
    }
    
    return value;
  }
  
  /**
   * Gets executor status summary.
   * @returns {Object} Status object
   */
  getStatus() {
    return {
      hasToolRegistry: !!this.toolRegistry,
      hasWorkingMemory: !!this.workingMemory,
      hasRetryEngine: !!this.retryEngine,
      hasVerifier: !!this.verifier,
      hasPlanner: !!this.planner,
      hasLLMClient: !!this.llmClient,
      eventHandlers: Object.fromEntries(
        Object.entries(this.eventHandlers).map(([k, v]) => [k, v.length])
      )
    };
  }
}

module.exports = { Executor };
