const { v4: uuidv4 } = require('uuid');

/**
 * Step status values.
 * @typedef {('pending'|'running'|'completed'|'failed'|'skipped')} StepStatus
 */

/**
 * Represents a single step in an execution plan.
 * @typedef {Object} PlanStep
 * @property {string} id - Unique step identifier
 * @property {string} type - Step type/category
 * @property {string} description - Human-readable description
 * @property {string} tool - Tool ID to execute
 * @property {Object} [params] - Tool parameters
 * @property {StepStatus} status - Current execution status
 * @property {Error} [error] - Error if failed
 * @property {number} [estimatedTokens] - Estimated token usage
 * @property {number} [estimatedTime] - Estimated time in ms
 */

/**
 * Task analysis result.
 * @typedef {Object} TaskAnalysis
 * @property {string} complexity - Complexity level (low/medium/high)
 * @property {string[]} requiredTools - Tools required for the task
 * @property {number} estimatedSteps - Estimated number of steps
 * @property {string[]} challenges - Anticipated challenges
 * @property {Object} [metadata] - Additional analysis metadata
 */

/**
 * Execution plan with dependency graph support.
 * @class ExecutionPlan
 */
class ExecutionPlan {
  /**
   * Creates an ExecutionPlan instance.
   * @param {string} taskId - The task ID this plan is for
   */
  constructor(taskId) {
    /** @type {string} Unique plan identifier */
    this.id = uuidv4();
    
    /** @type {string} Associated task ID */
    this.taskId = taskId;
    
    /** @type {PlanStep[]} Plan steps */
    this.steps = [];
    
    /** @type {Map<string, string[]>} Step dependencies (stepId -> [dependencyStepIds]) */
    this.dependencies = new Map();
    
    /** @type {number} Estimated total tokens */
    this.estimatedTokens = 0;
    
    /** @type {number} Estimated time in milliseconds */
    this.estimatedTime = 0;
    
    /** @type {number} Plan creation timestamp */
    this.createdAt = Date.now();
  }
  
  /**
   * Adds a step to the plan with optional dependencies.
   * @param {Object} step - Step configuration
   * @param {string} step.type - Step type
   * @param {string} step.description - Step description
   * @param {string} step.tool - Tool ID
   * @param {Object} [step.params] - Tool parameters
   * @param {number} [step.estimatedTokens] - Token estimate
   * @param {number} [step.estimatedTime] - Time estimate
   * @param {string[]} [dependencies=[]] - IDs of steps this step depends on
   * @returns {string} The new step's ID
   */
  addStep(step, dependencies = []) {
    const stepWithId = {
      id: uuidv4(),
      ...step,
      status: 'pending'
    };
    
    this.steps.push(stepWithId);
    this.dependencies.set(stepWithId.id, dependencies);
    
    return stepWithId.id;
  }
  
  /**
   * Gets all steps that are ready to execute.
   * A step is ready when all its dependencies are completed.
   * @returns {PlanStep[]} Array of ready steps
   */
  getReadySteps() {
    return this.steps.filter(step => {
      if (step.status !== 'pending') return false;
      
      const deps = this.dependencies.get(step.id) || [];
      return deps.every(depId => {
        const dep = this.steps.find(s => s.id === depId);
        return dep && dep.status === 'completed';
      });
    });
  }
  
  /**
   * Gets steps that can run in parallel (all ready steps).
   * Alias for getReadySteps().
   * @returns {PlanStep[]} Array of parallelizable steps
   */
  getParallelizableSteps() {
    return this.getReadySteps();
  }
  
  /**
   * Marks a step as completed.
   * @param {string} stepId - The step ID
   * @param {*} [result] - Optional result data
   * @returns {boolean} Whether the step was found and updated
   */
  markStepComplete(stepId, result = null) {
    const step = this.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'completed';
      step.result = result;
      step.completedAt = Date.now();
      return true;
    }
    return false;
  }
  
  /**
   * Marks a step as failed.
   * @param {string} stepId - The step ID
   * @param {Error} error - The error that occurred
   * @returns {boolean} Whether the step was found and updated
   */
  markStepFailed(stepId, error) {
    const step = this.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'failed';
      step.error = error;
      step.failedAt = Date.now();
      return true;
    }
    return false;
  }
  
  /**
   * Marks a step as running.
   * @param {string} stepId - The step ID
   * @returns {boolean} Whether the step was found and updated
   */
  markStepRunning(stepId) {
    const step = this.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'running';
      step.startedAt = Date.now();
      return true;
    }
    return false;
  }
  
  /**
   * Skips a step and marks it as completed.
   * @param {string} stepId - The step ID
   * @param {string} [reason] - Reason for skipping
   * @returns {boolean} Whether the step was found and updated
   */
  skipStep(stepId, reason = null) {
    const step = this.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'skipped';
      step.skipReason = reason;
      step.completedAt = Date.now();
      return true;
    }
    return false;
  }
  
  /**
   * Checks if all steps are completed.
   * @returns {boolean} True if plan is complete
   */
  isComplete() {
    return this.steps.every(s => s.status === 'completed' || s.status === 'skipped');
  }
  
  /**
   * Checks if any step has failed.
   * @returns {boolean} True if any step failed
   */
  hasFailed() {
    return this.steps.some(s => s.status === 'failed');
  }
  
  /**
   * Gets all failed steps.
   * @returns {PlanStep[]} Array of failed steps
   */
  getFailedSteps() {
    return this.steps.filter(s => s.status === 'failed');
  }
  
  /**
   * Gets all completed steps.
   * @returns {PlanStep[]} Array of completed steps
   */
  getCompletedSteps() {
    return this.steps.filter(s => s.status === 'completed');
  }
  
  /**
   * Gets a step by ID.
   * @param {string} stepId - Step ID
   * @returns {PlanStep|undefined} The step or undefined
   */
  getStep(stepId) {
    return this.steps.find(s => s.id === stepId);
  }
  
  /**
   * Gets steps by type.
   * @param {string} type - Step type
   * @returns {PlanStep[]} Matching steps
   */
  getStepsByType(type) {
    return this.steps.filter(s => s.type === type);
  }
  
  /**
   * Gets the dependency graph as an adjacency list.
   * @returns {Object} Dependency graph
   */
  getDependencyGraph() {
    const graph = {};
    for (const [stepId, deps] of this.dependencies) {
      graph[stepId] = deps;
    }
    return graph;
  }
  
  /**
   * Detects circular dependencies in the plan.
   * @returns {string[]|null} Cycle path if found, null otherwise
   */
  detectCycles() {
    const visited = new Set();
    const recursionStack = new Set();
    
    const visit = (stepId, path = []) => {
      if (recursionStack.has(stepId)) {
        const cycleStart = path.indexOf(stepId);
        return [...path.slice(cycleStart), stepId];
      }
      
      if (visited.has(stepId)) {
        return null;
      }
      
      visited.add(stepId);
      recursionStack.add(stepId);
      
      const deps = this.dependencies.get(stepId) || [];
      for (const depId of deps) {
        const cycle = visit(depId, [...path, stepId]);
        if (cycle) return cycle;
      }
      
      recursionStack.delete(stepId);
      return null;
    };
    
    for (const step of this.steps) {
      const cycle = visit(step.id);
      if (cycle) return cycle;
    }
    
    return null;
  }
  
  /**
   * Validates the plan structure.
   * @returns {Object} Validation result
   */
  validate() {
    const errors = [];
    
    // Check for circular dependencies
    const cycle = this.detectCycles();
    if (cycle) {
      errors.push(`Circular dependency detected: ${cycle.join(' -> ')}`);
    }
    
    // Check for missing dependencies
    for (const [stepId, deps] of this.dependencies) {
      for (const depId of deps) {
        if (!this.steps.find(s => s.id === depId)) {
          errors.push(`Step ${stepId} depends on non-existent step ${depId}`);
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Converts the plan to a plain JSON object.
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      id: this.id,
      taskId: this.taskId,
      steps: this.steps,
      dependencies: Object.fromEntries(this.dependencies),
      estimatedTokens: this.estimatedTokens,
      estimatedTime: this.estimatedTime,
      createdAt: this.createdAt,
      progress: {
        total: this.steps.length,
        completed: this.getCompletedSteps().length,
        failed: this.getFailedSteps().length,
        pending: this.steps.filter(s => s.status === 'pending').length
      }
    };
  }
  
  /**
   * Creates a summary of the plan.
   * @returns {Object} Summary object
   */
  summarize() {
    return {
      id: this.id,
      taskId: this.taskId,
      totalSteps: this.steps.length,
      completedSteps: this.getCompletedSteps().length,
      failedSteps: this.getFailedSteps().length,
      isComplete: this.isComplete(),
      hasFailed: this.hasFailed(),
      estimatedTokens: this.estimatedTokens,
      estimatedTime: this.estimatedTime
    };
  }
}

/**
 * Creates execution plans for tasks with dependency management.
 * Supports multiple task types and adaptive planning strategies.
 * @class Planner
 */
class Planner {
  /**
   * Creates a Planner instance.
   * @param {Object} toolRegistry - Registry of available tools
   * @param {Object} llmClient - LLM client for analysis
   */
  constructor(toolRegistry, llmClient) {
    /** @type {Object} Tool registry */
    this.toolRegistry = toolRegistry;
    
    /** @type {Object} LLM client */
    this.llmClient = llmClient;
  }
  
  /**
   * Creates an execution plan for a task.
   * @param {Object} task - The task to plan
   * @param {string} task.id - Task ID
   * @param {string} task.type - Task type
   * @param {string} task.objective - Task objective/description
   * @param {Object} task.input - Task input data
   * @param {string[]} [task.tools] - Available tool IDs
   * @returns {Promise<ExecutionPlan>} The execution plan
   */
  async createPlan(task) {
    const plan = new ExecutionPlan(task.id);
    
    // Analyze task and determine approach
    const analysis = await this.analyzeTask(task);
    
    // Create steps based on analysis and task type
    switch (task.type) {
      case 'code-generation':
        this.planCodeGeneration(task, plan, analysis);
        break;
      case 'document-edit':
        this.planDocumentEdit(task, plan, analysis);
        break;
      case 'analysis':
        this.planAnalysis(task, plan, analysis);
        break;
      case 'refactoring':
        this.planRefactoring(task, plan, analysis);
        break;
      case 'testing':
        this.planTesting(task, plan, analysis);
        break;
      default:
        this.planGeneric(task, plan, analysis);
    }
    
    // Validate the plan
    const validation = plan.validate();
    if (!validation.valid) {
      throw new Error(`Invalid plan: ${validation.errors.join(', ')}`);
    }
    
    // Estimate resources
    plan.estimatedTokens = this.estimateTokens(plan, analysis);
    plan.estimatedTime = this.estimateTime(plan, analysis);
    
    return plan;
  }
  
  /**
   * Analyzes a task to determine complexity and requirements.
   * @param {Object} task - The task to analyze
   * @returns {Promise<TaskAnalysis>} Analysis result
   */
  async analyzeTask(task) {
    // Use LLM to analyze task complexity and requirements
    const prompt = `
Analyze this task and provide a JSON response with:
1. complexity: "low", "medium", or "high"
2. requiredTools: array of tool names needed
3. estimatedSteps: estimated number of execution steps (number)
4. challenges: array of anticipated challenges

Task: ${task.objective}
Type: ${task.type}
Input: ${JSON.stringify(task.input)}
Available Tools: ${JSON.stringify(task.tools || [])}

Respond with valid JSON only.`;
    
    try {
      if (this.llmClient) {
        const response = await this.llmClient.complete(prompt);
        const parsed = JSON.parse(response);
        return {
          complexity: parsed.complexity || 'medium',
          requiredTools: parsed.requiredTools || task.tools || [],
          estimatedSteps: parsed.estimatedSteps || 3,
          challenges: parsed.challenges || [],
          metadata: parsed
        };
      }
    } catch (error) {
      // Fall back to basic analysis
      console.warn('LLM analysis failed, using basic analysis:', error.message);
    }
    
    // Basic analysis fallback
    return {
      complexity: 'medium',
      requiredTools: task.tools || [],
      estimatedSteps: 3,
      challenges: [],
      metadata: {}
    };
  }
  
  /**
   * Creates a plan for code generation tasks.
   * @private
   * @param {Object} task - The task
   * @param {ExecutionPlan} plan - The plan to populate
   * @param {TaskAnalysis} analysis - Task analysis
   */
  planCodeGeneration(task, plan, analysis) {
    // Step 1: Understand requirements
    const understandStep = plan.addStep({
      type: 'understand',
      description: 'Analyze requirements and input',
      tool: 'llm-analyze',
      estimatedTokens: 500
    });
    
    // Step 2: Generate code
    const generateStep = plan.addStep({
      type: 'generate',
      description: 'Generate code based on requirements',
      tool: 'code-generate',
      estimatedTokens: 2000
    }, [understandStep]);
    
    // Step 3: Validate syntax
    const validateStep = plan.addStep({
      type: 'validate',
      description: 'Validate generated code syntax',
      tool: 'code-validate',
      estimatedTokens: 100
    }, [generateStep]);
    
    // Step 4: Run tests (optional, if test command specified)
    if (task.testCommand) {
      plan.addStep({
        type: 'test',
        description: 'Run tests on generated code',
        tool: 'command-execute',
        params: { command: task.testCommand }
      }, [validateStep]);
    }
  }
  
  /**
   * Creates a plan for document editing tasks.
   * @private
   * @param {Object} task - The task
   * @param {ExecutionPlan} plan - The plan to populate
   * @param {TaskAnalysis} analysis - Task analysis
   */
  planDocumentEdit(task, plan, analysis) {
    // Step 1: Analyze document structure
    const analyzeStep = plan.addStep({
      type: 'analyze',
      description: 'Analyze document structure',
      tool: 'doc-analyze',
      estimatedTokens: 500
    });
    
    // Step 2: Plan edits
    const planStep = plan.addStep({
      type: 'plan',
      description: 'Plan document modifications',
      tool: 'doc-plan-edits',
      estimatedTokens: 300
    }, [analyzeStep]);
    
    // Step 3: Apply edits
    plan.addStep({
      type: 'edit',
      description: 'Apply document edits',
      tool: 'doc-edit',
      estimatedTokens: 1000
    }, [planStep]);
  }
  
  /**
   * Creates a plan for analysis tasks.
   * @private
   * @param {Object} task - The task
   * @param {ExecutionPlan} plan - The plan to populate
   * @param {TaskAnalysis} analysis - Task analysis
   */
  planAnalysis(task, plan, analysis) {
    // Step 1: Gather information
    const gatherStep = plan.addStep({
      type: 'gather',
      description: 'Gather relevant information',
      tool: analysis.requiredTools.includes('web-search') ? 'web-search' : 'file-read',
      estimatedTokens: 1000
    });
    
    // Step 2: Analyze findings
    const analyzeStep = plan.addStep({
      type: 'analyze',
      description: 'Analyze gathered information',
      tool: 'llm-analyze',
      estimatedTokens: 1500
    }, [gatherStep]);
    
    // Step 3: Generate report (for complex analyses)
    if (analysis.complexity === 'high') {
      plan.addStep({
        type: 'report',
        description: 'Generate analysis report',
        tool: 'doc-generate',
        estimatedTokens: 1000
      }, [analyzeStep]);
    }
  }
  
  /**
   * Creates a plan for refactoring tasks.
   * @private
   * @param {Object} task - The task
   * @param {ExecutionPlan} plan - The plan to populate
   * @param {TaskAnalysis} analysis - Task analysis
   */
  planRefactoring(task, plan, analysis) {
    // Step 1: Analyze current code
    const analyzeStep = plan.addStep({
      type: 'analyze',
      description: 'Analyze code to refactor',
      tool: 'code-analyze',
      estimatedTokens: 1000
    });
    
    // Step 2: Create refactoring plan
    const planStep = plan.addStep({
      type: 'plan',
      description: 'Create refactoring plan',
      tool: 'llm-plan',
      estimatedTokens: 500
    }, [analyzeStep]);
    
    // Step 3: Apply refactoring
    const refactorStep = plan.addStep({
      type: 'refactor',
      description: 'Apply refactoring changes',
      tool: 'code-refactor',
      estimatedTokens: 2000
    }, [planStep]);
    
    // Step 4: Verify changes
    plan.addStep({
      type: 'verify',
      description: 'Verify refactoring results',
      tool: 'code-validate',
      estimatedTokens: 200
    }, [refactorStep]);
  }
  
  /**
   * Creates a plan for testing tasks.
   * @private
   * @param {Object} task - The task
   * @param {ExecutionPlan} plan - The plan to populate
   * @param {TaskAnalysis} analysis - Task analysis
   */
  planTesting(task, plan, analysis) {
    // Step 1: Analyze code under test
    plan.addStep({
      type: 'analyze',
      description: 'Analyze code for test generation',
      tool: 'code-analyze',
      estimatedTokens: 800
    });
    
    // Step 2: Generate tests
    const generateStep = plan.addStep({
      type: 'generate',
      description: 'Generate test cases',
      tool: 'test-generate',
      estimatedTokens: 1500
    });
    
    // Step 3: Run tests
    plan.addStep({
      type: 'run',
      description: 'Execute test suite',
      tool: 'test-run',
      estimatedTokens: 500
    }, [generateStep]);
  }
  
  /**
   * Creates a generic plan for unknown task types.
   * @private
   * @param {Object} task - The task
   * @param {ExecutionPlan} plan - The plan to populate
   * @param {TaskAnalysis} analysis - Task analysis
   */
  planGeneric(task, plan, analysis) {
    // Create generic steps based on available tools
    const tools = task.tools || analysis.requiredTools || [];
    let lastStepId = null;
    
    for (let i = 0; i < tools.length; i++) {
      const toolId = tools[i];
      const dependencies = lastStepId ? [lastStepId] : [];
      
      lastStepId = plan.addStep({
        type: 'tool-call',
        description: `Execute ${toolId}`,
        tool: toolId,
        estimatedTokens: 1000
      }, dependencies);
    }
    
    // If no tools specified, add a generic LLM step
    if (tools.length === 0) {
      plan.addStep({
        type: 'llm-call',
        description: 'Process task with LLM',
        tool: 'llm-complete',
        estimatedTokens: 1500
      });
    }
  }
  
  /**
   * Estimates total token usage for a plan.
   * @private
   * @param {ExecutionPlan} plan - The execution plan
   * @param {TaskAnalysis} analysis - Task analysis
   * @returns {number} Estimated tokens
   */
  estimateTokens(plan, analysis) {
    // Sum up individual step estimates
    const stepTokens = plan.steps.reduce((sum, step) => {
      return sum + (step.estimatedTokens || 1000);
    }, 0);
    
    // Add overhead based on complexity
    const complexityMultiplier = {
      low: 1.0,
      medium: 1.2,
      high: 1.5
    }[analysis.complexity] || 1.2;
    
    return Math.round(stepTokens * complexityMultiplier);
  }
  
  /**
   * Estimates total execution time for a plan.
   * @private
   * @param {ExecutionPlan} plan - The execution plan
   * @param {TaskAnalysis} analysis - Task analysis
   * @returns {number} Estimated time in milliseconds
   */
  estimateTime(plan, analysis) {
    // Base time per step
    const baseTime = plan.steps.length * 3000;
    
    // Add time based on complexity
    const complexityTime = {
      low: 5000,
      medium: 10000,
      high: 20000
    }[analysis.complexity] || 10000;
    
    return baseTime + complexityTime;
  }
}

module.exports = { Planner, ExecutionPlan };
