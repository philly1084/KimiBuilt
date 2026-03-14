/**
 * @fileoverview ToolRegistry - Central registry for agent tools
 * 
 * This module provides a centralized registry for managing tool definitions,
 * categorizing tools by their side effects, and executing tools with proper
 * validation and error handling.
 * 
 * @module ToolRegistry
 * @requires ./ToolDefinition
 */

const { ToolDefinition, ToolSideEffect } = require('./ToolDefinition');

/**
 * Error thrown when a tool is not found in the registry
 * 
 * @class ToolNotFoundError
 * @extends Error
 */
class ToolNotFoundError extends Error {
  /**
   * Creates a ToolNotFoundError
   * @param {string} toolId - The tool ID that was not found
   */
  constructor(toolId) {
    super(`Tool "${toolId}" not found in registry`);
    this.name = 'ToolNotFoundError';
    this.toolId = toolId;
  }
}

/**
 * Error thrown when a tool registration fails
 * 
 * @class ToolRegistrationError
 * @extends Error
 */
class ToolRegistrationError extends Error {
  /**
   * Creates a ToolRegistrationError
   * @param {string} message - Error message
   * @param {string} toolId - The tool ID that failed registration
   */
  constructor(message, toolId) {
    super(message);
    this.name = 'ToolRegistrationError';
    this.toolId = toolId;
  }
}

/**
 * Central registry for managing tool definitions
 * 
 * @class ToolRegistry
 * @description Provides methods to register, retrieve, categorize, and execute
 * tools. Supports automatic categorization by side effects and provides
 * utilities for converting functions to tool definitions.
 */
class ToolRegistry {
  /**
   * Creates a new ToolRegistry instance
   */
  constructor() {
    /**
     * Map of tool ID to ToolDefinition
     * @type {Map<string, ToolDefinition>}
     * @private
     */
    this.tools = new Map();

    /**
     * Map of side effect type to array of tool IDs
     * @type {Map<string, string[]>}
     * @private
     */
    this.categories = new Map();

    /**
     * Map of custom category names to array of tool IDs
     * @type {Map<string, string[]>}
     * @private
     */
    this.customCategories = new Map();

    // Initialize default categories
    Object.values(ToolSideEffect).forEach(effect => {
      this.categories.set(effect, []);
    });

    /**
     * Registry statistics
     * @type {Object}
     * @private
     */
    this.stats = {
      registrations: 0,
      unregistrations: 0,
      executions: 0
    };

    /**
     * Middleware functions for tool execution
     * @type {Function[]}
     * @private
     */
    this.middleware = [];
  }

  /**
   * Registers a tool definition in the registry
   * 
   * @param {ToolDefinition} tool - The tool to register
   * @returns {ToolRegistry} This registry instance (for chaining)
   * @throws {ToolRegistrationError} If tool is not a ToolDefinition instance
   * @throws {ToolRegistrationError} If tool ID already exists
   */
  register(tool) {
    if (!(tool instanceof ToolDefinition)) {
      throw new ToolRegistrationError(
        'Tool must be a ToolDefinition instance',
        tool?.id || 'unknown'
      );
    }

    if (this.tools.has(tool.id)) {
      throw new ToolRegistrationError(
        `Tool "${tool.id}" is already registered`,
        tool.id
      );
    }

    // Register the tool
    this.tools.set(tool.id, tool);
    this.stats.registrations++;

    // Auto-categorize by side effects
    for (const effect of tool.sideEffects) {
      if (!this.categories.has(effect)) {
        this.categories.set(effect, []);
      }
      const category = this.categories.get(effect);
      if (!category.includes(tool.id)) {
        category.push(tool.id);
      }
    }

    return this;
  }

  /**
   * Registers multiple tools at once
   * 
   * @param {ToolDefinition[]} tools - Array of tools to register
   * @returns {ToolRegistry} This registry instance
   */
  registerMany(tools) {
    for (const tool of tools) {
      this.register(tool);
    }
    return this;
  }

  /**
   * Retrieves a tool by ID
   * 
   * @param {string} id - Tool identifier
   * @returns {ToolDefinition} The tool definition
   * @throws {ToolNotFoundError} If tool is not found
   */
  get(id) {
    const tool = this.tools.get(id);
    if (!tool) {
      throw new ToolNotFoundError(id);
    }
    return tool;
  }

  /**
   * Checks if a tool exists in the registry
   * 
   * @param {string} id - Tool identifier
   * @returns {boolean} True if tool exists
   */
  has(id) {
    return this.tools.has(id);
  }

  /**
   * Lists all registered tools
   * 
   * @param {Object} [options={}] - List options
   * @param {boolean} [options.includeStats=false] - Include execution statistics
   * @returns {Object[]} Array of tool definitions as JSON
   */
  list(options = {}) {
    const { includeStats = false } = options;
    return Array.from(this.tools.values()).map(tool => {
      const json = tool.toJSON();
      if (!includeStats) {
        delete json.stats;
      }
      return json;
    });
  }

  /**
   * Lists tools that produce a specific side effect
   * 
   * @param {string} effect - Side effect type
   * @returns {ToolDefinition[]} Array of matching tools
   */
  listBySideEffect(effect) {
    const toolIds = this.categories.get(effect) || [];
    return toolIds
      .map(id => this.tools.get(id))
      .filter(Boolean); // Filter out any undefined (shouldn't happen)
  }

  /**
   * Alias for listBySideEffect
   * 
   * @param {string} category - Category name (side effect type)
   * @returns {ToolDefinition[]} Array of matching tools
   */
  listByCategory(category) {
    return this.listBySideEffect(category);
  }

  /**
   * Lists tools in a custom category
   * 
   * @param {string} category - Custom category name
   * @returns {ToolDefinition[]} Array of matching tools
   */
  listByCustomCategory(category) {
    const toolIds = this.customCategories.get(category) || [];
    return toolIds
      .map(id => this.tools.get(id))
      .filter(Boolean);
  }

  /**
   * Adds a tool to a custom category
   * 
   * @param {string} toolId - Tool identifier
   * @param {string} category - Custom category name
   * @returns {ToolRegistry} This registry instance
   * @throws {ToolNotFoundError} If tool is not found
   */
  categorize(toolId, category) {
    if (!this.has(toolId)) {
      throw new ToolNotFoundError(toolId);
    }

    if (!this.customCategories.has(category)) {
      this.customCategories.set(category, []);
    }

    const categoryTools = this.customCategories.get(category);
    if (!categoryTools.includes(toolId)) {
      categoryTools.push(toolId);
    }

    return this;
  }

  /**
   * Gets all available categories
   * 
   * @returns {Object} Object with sideEffectCategories and customCategories arrays
   */
  getCategories() {
    return {
      sideEffectCategories: Array.from(this.categories.keys()),
      customCategories: Array.from(this.customCategories.keys())
    };
  }

  /**
   * Validates inputs for a specific tool
   * 
   * @param {string} toolId - Tool identifier
   * @param {*} inputs - Inputs to validate
   * @returns {{valid: boolean, errors: string[]}} Validation result
   * @throws {ToolNotFoundError} If tool is not found
   */
  validateInputs(toolId, inputs) {
    const tool = this.get(toolId);
    return tool.validateInput(inputs);
  }

  /**
   * Executes a tool with the given inputs
   * 
   * @param {string} toolId - Tool identifier
   * @param {*} inputs - Tool inputs
   * @param {Object} [context={}] - Execution context
   * @returns {Promise<ToolExecutionResult>} Execution result
   * @throws {ToolNotFoundError} If tool is not found
   */
  async execute(toolId, inputs, context = {}) {
    const tool = this.get(toolId);
    
    // Apply middleware
    let processedInputs = inputs;
    let processedContext = context;
    
    for (const middleware of this.middleware) {
      const result = await middleware(tool, processedInputs, processedContext);
      if (result) {
        processedInputs = result.inputs ?? processedInputs;
        processedContext = result.context ?? processedContext;
      }
    }

    this.stats.executions++;
    return tool.execute(processedInputs, processedContext);
  }

  /**
   * Executes multiple tools in parallel
   * 
   * @param {Array<{toolId: string, inputs: *, context?: Object}>} calls - Tool calls
   * @returns {Promise<Array<ToolExecutionResult>>} Execution results
   */
  async executeMany(calls) {
    const promises = calls.map(({ toolId, inputs, context = {} }) => 
      this.execute(toolId, inputs, context).catch(error => ({
        success: false,
        error: error.message,
        toolId,
        attempts: 0
      }))
    );
    return Promise.all(promises);
  }

  /**
   * Adds middleware for tool execution
   * 
   * @param {Function} middleware - Middleware function(tool, inputs, context) => {inputs?, context?}
   * @returns {ToolRegistry} This registry instance
   */
  use(middleware) {
    if (typeof middleware !== 'function') {
      throw new Error('Middleware must be a function');
    }
    this.middleware.push(middleware);
    return this;
  }

  /**
   * Creates a ToolDefinition from a function and registers it
   * 
   * @param {Function} fn - Function to convert to tool
   * @param {Object} metadata - Tool metadata
   * @param {string} [metadata.id] - Tool ID (defaults to function name)
   * @param {string} [metadata.name] - Tool name
   * @param {string} [metadata.description] - Tool description
   * @param {Object} [metadata.inputSchema] - JSON schema for inputs
   * @param {Object} [metadata.outputSchema] - JSON schema for outputs
   * @param {ToolSideEffect[]} [metadata.sideEffects] - Side effect types
   * @param {Function} [metadata.fallback] - Fallback handler
   * @param {number} [metadata.timeout] - Timeout in milliseconds
   * @param {number} [metadata.retries] - Number of retry attempts
   * @param {Array} [metadata.examples] - Example inputs/outputs
   * @returns {ToolDefinition} The created tool definition
   */
  createToolFromFunction(fn, metadata = {}) {
    const tool = new ToolDefinition({
      id: metadata.id || fn.name || `tool_${Date.now()}`,
      name: metadata.name || fn.name || 'Anonymous Tool',
      description: metadata.description || '',
      inputSchema: metadata.inputSchema || { type: 'object' },
      outputSchema: metadata.outputSchema || { type: 'object' },
      sideEffects: metadata.sideEffects || [],
      handler: fn,
      fallback: metadata.fallback,
      timeout: metadata.timeout,
      retries: metadata.retries,
      examples: metadata.examples || []
    });

    this.register(tool);
    return tool;
  }

  /**
   * Unregisters a tool from the registry
   * 
   * @param {string} id - Tool identifier
   * @returns {ToolRegistry} This registry instance
   */
  unregister(id) {
    const tool = this.tools.get(id);
    if (tool) {
      // Remove from side effect categories
      for (const effect of tool.sideEffects) {
        const category = this.categories.get(effect);
        if (category) {
          const index = category.indexOf(id);
          if (index > -1) {
            category.splice(index, 1);
          }
        }
      }

      // Remove from custom categories
      for (const [categoryName, toolIds] of this.customCategories) {
        const index = toolIds.indexOf(id);
        if (index > -1) {
          toolIds.splice(index, 1);
        }
      }

      this.tools.delete(id);
      this.stats.unregistrations++;
    }
    return this;
  }

  /**
   * Clears all tools from the registry
   * 
   * @returns {ToolRegistry} This registry instance
   */
  clear() {
    this.tools.clear();
    this.categories.clear();
    this.customCategories.clear();
    
    // Re-initialize default categories
    Object.values(ToolSideEffect).forEach(effect => {
      this.categories.set(effect, []);
    });

    return this;
  }

  /**
   * Gets registry statistics
   * 
   * @returns {Object} Statistics object
   */
  getStats() {
    const toolStats = Array.from(this.tools.values()).map(t => t.getStats());
    
    return {
      totalTools: this.tools.size,
      registrations: this.stats.registrations,
      unregistrations: this.stats.unregistrations,
      executions: this.stats.executions,
      bySideEffect: Object.fromEntries(
        Array.from(this.categories.entries()).map(([k, v]) => [k, v.length])
      ),
      byCustomCategory: Object.fromEntries(
        Array.from(this.customCategories.entries()).map(([k, v]) => [k, v.length])
      ),
      aggregateToolStats: {
        totalExecutions: toolStats.reduce((sum, s) => sum + s.executions, 0),
        totalSuccesses: toolStats.reduce((sum, s) => sum + s.successes, 0),
        totalFailures: toolStats.reduce((sum, s) => sum + s.failures, 0),
        totalFallbacksUsed: toolStats.reduce((sum, s) => sum + s.fallbacksUsed, 0)
      }
    };
  }

  /**
   * Exports all tools in OpenAI function format
   * 
   * @returns {Object[]} Array of OpenAI function definitions
   */
  toOpenAIFunctions() {
    return Array.from(this.tools.values()).map(tool => tool.toOpenAIFunction());
  }

  /**
   * Imports tools from another registry or array
   * 
   * @param {ToolRegistry|ToolDefinition[]} source - Source to import from
   * @param {Object} [options={}] - Import options
   * @param {boolean} [options.overwrite=false] - Overwrite existing tools
   * @returns {ToolRegistry} This registry instance
   */
  import(source, options = {}) {
    const { overwrite = false } = options;
    
    const tools = source instanceof ToolRegistry 
      ? Array.from(source.tools.values())
      : source;

    for (const tool of tools) {
      if (this.has(tool.id)) {
        if (overwrite) {
          this.unregister(tool.id);
        } else {
          continue; // Skip existing
        }
      }
      this.register(tool);
    }

    return this;
  }

  /**
   * Converts the registry to a JSON-serializable object
   * 
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      tools: this.list(),
      stats: this.getStats()
    };
  }
}

module.exports = { 
  ToolRegistry,
  ToolNotFoundError,
  ToolRegistrationError
};
