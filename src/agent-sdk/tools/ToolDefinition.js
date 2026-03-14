/**
 * @fileoverview ToolDefinition - Base class for defining agent tools
 * 
 * This module provides the foundation for creating tool definitions in the
 * OpenAI Agent SDK. It includes input/output schema validation, timeout handling,
 * retry logic with exponential backoff, and fallback mechanisms.
 * 
 * @module ToolDefinition
 */

/**
 * Enum for side effect types that a tool may produce
 * @readonly
 * @enum {string}
 */
const ToolSideEffect = {
  READ: 'read',
  WRITE: 'write',
  NETWORK: 'network',
  EXECUTE: 'execute',
  NONE: 'none'
};

/**
 * Validates a value against a JSON schema subset
 * 
 * @private
 * @param {*} value - Value to validate
 * @param {Object} schema - JSON schema
 * @param {string} path - Current property path
 * @returns {string[]} Array of error messages
 */
function validateAgainstSchema(value, schema, path = '') {
  const errors = [];

  if (!schema || typeof schema !== 'object') {
    return errors;
  }

  // Type validation
  if (schema.type) {
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== schema.type && !(schema.type === 'integer' && actualType === 'number')) {
      errors.push(`${path}: Expected type ${schema.type}, got ${actualType}`);
      return errors; // Stop validation on type mismatch
    }
  }

  // Object validation
  if (schema.type === 'object' && schema.properties && typeof value === 'object' && value !== null) {
    // Check required fields
    if (Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (!(field in value)) {
          errors.push(`${path}: Missing required field: ${field}`);
        }
      }
    }

    // Validate properties
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in value) {
        const propErrors = validateAgainstSchema(
          value[key], 
          propSchema, 
          path ? `${path}.${key}` : key
        );
        errors.push(...propErrors);
      }
    }

    // Check additionalProperties
    if (schema.additionalProperties === false) {
      const allowedProps = new Set(Object.keys(schema.properties || {}));
      for (const key of Object.keys(value)) {
        if (!allowedProps.has(key)) {
          errors.push(`${path}: Additional property not allowed: ${key}`);
        }
      }
    }
  }

  // Array validation
  if (schema.type === 'array' && Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${path}: Array must have at least ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${path}: Array must have at most ${schema.maxItems} items`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        const itemErrors = validateAgainstSchema(item, schema.items, `${path}[${index}]`);
        errors.push(...itemErrors);
      });
    }
  }

  // String validation
  if (schema.type === 'string' && typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${path}: String must be at least ${schema.minLength} characters`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(`${path}: String must be at most ${schema.maxLength} characters`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: String does not match pattern: ${schema.pattern}`);
    }
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`${path}: String must be one of: ${schema.enum.join(', ')}`);
    }
  }

  // Number validation
  if ((schema.type === 'number' || schema.type === 'integer') && typeof value === 'number') {
    if (schema.type === 'integer' && !Number.isInteger(value)) {
      errors.push(`${path}: Value must be an integer`);
    }
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path}: Value must be >= ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${path}: Value must be <= ${schema.maximum}`);
    }
  }

  return errors;
}

/**
 * Sleep helper for retry delays
 * 
 * @private
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Base class for tool definitions in the Agent SDK
 * 
 * @class ToolDefinition
 * @description Defines the structure, behavior, and metadata for a tool that
 * can be used by an AI agent. Includes schema validation, retry logic, and
 * fallback handling.
 */
class ToolDefinition {
  /**
   * Creates a new ToolDefinition instance
   * 
   * @param {Object} options - Tool configuration options
   * @param {string} options.id - Unique identifier for the tool
   * @param {string} options.name - Human-readable name
   * @param {string} options.description - Description of what the tool does
   * @param {Object} [options.inputSchema={ type: 'object', properties: {} }] - JSON schema for inputs
   * @param {Object} [options.outputSchema={ type: 'object', properties: {} }] - JSON schema for outputs
   * @param {ToolSideEffect[]} [options.sideEffects=[]] - Types of side effects this tool produces
   * @param {Function} options.handler - Async function to handle tool execution
   * @param {Function} [options.fallback] - Optional fallback handler
   * @param {number} [options.timeout=30000] - Timeout in milliseconds (default: 30s)
   * @param {number} [options.retries=0] - Number of retry attempts
   * @param {Array<{input: *, output: *}>} [options.examples=[]] - Example inputs/outputs for LLM context
   * @throws {Error} If required fields are missing
   * @throws {Error} If handler is not a function
   */
  constructor({
    id,
    name,
    description,
    inputSchema = { type: 'object', properties: {} },
    outputSchema = { type: 'object', properties: {} },
    sideEffects = [],
    handler,
    fallback,
    timeout = 30000,
    retries = 0,
    examples = []
  }) {
    // Validate required fields
    if (!id || typeof id !== 'string') {
      throw new Error('ToolDefinition requires a valid id string');
    }
    if (!name || typeof name !== 'string') {
      throw new Error('ToolDefinition requires a valid name string');
    }
    if (!description || typeof description !== 'string') {
      throw new Error('ToolDefinition requires a valid description string');
    }
    if (typeof handler !== 'function') {
      throw new Error('ToolDefinition requires a handler function');
    }

    // Validate side effects
    const validSideEffects = Object.values(ToolSideEffect);
    for (const effect of sideEffects) {
      if (!validSideEffects.includes(effect)) {
        throw new Error(`Invalid side effect: ${effect}. Must be one of: ${validSideEffects.join(', ')}`);
      }
    }

    /**
     * Unique identifier
     * @type {string}
     * @readonly
     */
    this.id = id;

    /**
     * Human-readable name
     * @type {string}
     * @readonly
     */
    this.name = name;

    /**
     * Tool description
     * @type {string}
     * @readonly
     */
    this.description = description;

    /**
     * JSON schema for input validation
     * @type {Object}
     * @readonly
     */
    this.inputSchema = inputSchema;

    /**
     * JSON schema for output validation
     * @type {Object}
     * @readonly
     */
    this.outputSchema = outputSchema;

    /**
     * Side effects produced by this tool
     * @type {ToolSideEffect[]}
     * @readonly
     */
    this.sideEffects = sideEffects;

    /**
     * Main execution handler
     * @type {Function}
     * @private
     */
    this.handler = handler;

    /**
     * Fallback handler
     * @type {Function|null}
     * @private
     */
    this.fallback = fallback || null;

    /**
     * Timeout in milliseconds
     * @type {number}
     * @readonly
     */
    this.timeout = Math.max(0, timeout);

    /**
     * Number of retry attempts
     * @type {number}
     * @readonly
     */
    this.retries = Math.max(0, retries);

    /**
     * Example inputs/outputs for LLM context
     * @type {Array<{input: *, output: *}>}
     * @readonly
     */
    this.examples = examples;

    /**
     * Statistics for this tool
     * @type {Object}
     * @private
     */
    this.stats = {
      executions: 0,
      successes: 0,
      failures: 0,
      fallbacksUsed: 0,
      averageExecutionTime: 0
    };
  }

  /**
   * Validates input against the input schema
   * 
   * @param {*} input - Input to validate
   * @returns {{valid: boolean, errors: string[]}} Validation result
   */
  validateInput(input) {
    const errors = validateAgainstSchema(input, this.inputSchema);
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validates output against the output schema
   * 
   * @param {*} output - Output to validate
   * @returns {{valid: boolean, errors: string[]}} Validation result
   */
  validateOutput(output) {
    const errors = validateAgainstSchema(output, this.outputSchema);
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Executes the tool with validation, timeout, and retry logic
   * 
   * @param {*} input - Tool input
   * @param {Object} [context={}] - Execution context
   * @param {string} [context.requestId] - Unique request identifier
   * @param {Object} [context.metadata] - Additional metadata
   * @param {AbortSignal} [context.signal] - Abort signal for cancellation
   * @returns {Promise<ToolExecutionResult>} Execution result
   */
  async execute(input, context = {}) {
    const startTime = Date.now();
    this.stats.executions++;

    try {
      // Validate input
      const validation = this.validateInput(input);
      if (!validation.valid) {
        throw new Error(`Invalid input: ${validation.errors.join('; ')}`);
      }

      // Check for abort signal
      if (context.signal?.aborted) {
        throw new Error('Tool execution aborted');
      }

      let lastError;
      let usedFallback = false;

      // Execute with retries
      for (let attempt = 0; attempt <= this.retries; attempt++) {
        try {
          // Create timeout promise
          const timeoutPromise = new Promise((_, reject) => {
            const timer = setTimeout(() => {
              reject(new Error(`Tool timeout after ${this.timeout}ms`));
            }, this.timeout);

            // Clean up timer if aborted
            if (context.signal) {
              context.signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error('Tool execution aborted'));
              }, { once: true });
            }
          });

          // Execute handler with race against timeout
          const result = await Promise.race([
            this.handler(input, context),
            timeoutPromise
          ]);

          // Validate output
          const outputValidation = this.validateOutput(result);
          if (!outputValidation.valid) {
            console.warn(`Tool ${this.id} output validation warnings:`, outputValidation.errors);
          }

          // Update stats
          this.stats.successes++;
          const executionTime = Date.now() - startTime;
          this._updateAverageExecutionTime(executionTime);

          return {
            success: true,
            result,
            toolId: this.id,
            attempt: attempt + 1,
            executionTime,
            usedFallback
          };

        } catch (error) {
          lastError = error;

          // Check if this was an abort
          if (error.message === 'Tool execution aborted' || context.signal?.aborted) {
            throw error;
          }

          // Try fallback on final attempt
          if (attempt === this.retries && this.fallback) {
            try {
              const result = await this.fallback(input, context, error);
              this.stats.fallbacksUsed++;
              usedFallback = true;

              // Validate fallback output
              const outputValidation = this.validateOutput(result);
              if (!outputValidation.valid) {
                console.warn(`Tool ${this.id} fallback output validation warnings:`, outputValidation.errors);
              }

              this.stats.successes++;
              const executionTime = Date.now() - startTime;
              this._updateAverageExecutionTime(executionTime);

              return {
                success: true,
                result,
                toolId: this.id,
                attempt: attempt + 1,
                executionTime,
                usedFallback: true
              };
            } catch (fallbackError) {
              lastError = fallbackError;
            }
          }

          // Retry with exponential backoff if not final attempt
          if (attempt < this.retries) {
            const delay = 1000 * Math.pow(2, attempt);
            await sleep(delay);
          }
        }
      }

      // All retries exhausted
      this.stats.failures++;
      const executionTime = Date.now() - startTime;

      return {
        success: false,
        error: lastError.message,
        toolId: this.id,
        attempts: this.retries + 1,
        executionTime
      };

    } catch (error) {
      this.stats.failures++;
      throw error;
    }
  }

  /**
   * Updates the average execution time statistic
   * 
   * @private
   * @param {number} executionTime - New execution time
   */
  _updateAverageExecutionTime(executionTime) {
    const { executions, averageExecutionTime } = this.stats;
    this.stats.averageExecutionTime = 
      (averageExecutionTime * (executions - 1) + executionTime) / executions;
  }

  /**
   * Gets execution statistics for this tool
   * 
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.executions > 0 
        ? (this.stats.successes / this.stats.executions * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  /**
   * Resets execution statistics
   * 
   * @returns {void}
   */
  resetStats() {
    this.stats = {
      executions: 0,
      successes: 0,
      failures: 0,
      fallbacksUsed: 0,
      averageExecutionTime: 0
    };
  }

  /**
   * Adds an example input/output pair for LLM context
   * 
   * @param {*} input - Example input
   * @param {*} output - Example output
   * @param {string} [description] - Optional description
   * @returns {void}
   */
  addExample(input, output, description) {
    const example = { input, output };
    if (description) {
      example.description = description;
    }
    this.examples.push(example);
  }

  /**
   * Converts the tool definition to a JSON-serializable object
   * 
   * @returns {Object} JSON representation (suitable for LLM context)
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      inputSchema: this.inputSchema,
      outputSchema: this.outputSchema,
      sideEffects: this.sideEffects,
      timeout: this.timeout,
      retries: this.retries,
      examples: this.examples,
      stats: this.getStats()
    };
  }

  /**
   * Converts to OpenAI function calling format
   * 
   * @returns {Object} OpenAI function definition
   */
  toOpenAIFunction() {
    return {
      type: 'function',
      function: {
        name: this.id,
        description: this.description,
        parameters: this.inputSchema
      }
    };
  }
}

/**
 * @typedef {Object} ToolExecutionResult
 * @property {boolean} success - Whether execution succeeded
 * @property {*} [result] - Tool result (if success)
 * @property {string} [error] - Error message (if failure)
 * @property {string} toolId - Tool identifier
 * @property {number} attempt - Attempt number (1-based)
 * @property {number} [attempts] - Total attempts made (on failure)
 * @property {number} [executionTime] - Execution time in ms
 * @property {boolean} [usedFallback] - Whether fallback was used
 */

module.exports = { 
  ToolDefinition,
  ToolSideEffect
};
