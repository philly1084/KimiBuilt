/**
 * ToolBase - Abstract base class for all tools
 * Provides common functionality for execution, validation, and error handling
 */

class ToolBase {
  constructor(definition) {
    const defaultHandler = typeof this.handler === 'function' ? this.handler.bind(this) : null;

    this.id = definition.id;
    this.name = definition.name || definition.id;
    this.description = definition.description || '';
    this.category = definition.category || 'system';
    this.version = definition.version || '1.0.0';
    
    // Backend configuration
    this.handler = definition.backend?.handler || defaultHandler;
    this.sideEffects = definition.backend?.sideEffects || [];
    this.sandbox = definition.backend?.sandbox || {};
    this.timeout = definition.backend?.timeout || 30000;
    
    // Schemas
    this.inputSchema = definition.inputSchema || { type: 'object' };
    this.outputSchema = definition.outputSchema || { type: 'object' };
    
    // Hooks
    this.beforeExecute = definition.hooks?.beforeExecute;
    this.afterExecute = definition.hooks?.afterExecute;
    this.onError = definition.hooks?.onError;
    
    // Side effect tracking
    this.sideEffectTracker = new SideEffectTracker();
  }

  /**
   * Execute the tool with given parameters
   */
  async execute(params = {}, context = {}) {
    const startTime = Date.now();
    
    try {
      // Pre-execution hooks
      if (this.beforeExecute) {
        await this.beforeExecute(params, context);
      }
      
      // Validate inputs
      this.validateInputs(params);
      
      // Execute with timeout
      const result = await this.executeWithTimeout(params, context);
      
      // Validate outputs
      this.validateOutputs(result);
      
      // Post-execution hooks
      if (this.afterExecute) {
        await this.afterExecute(result, params, context);
      }
      
      const duration = Date.now() - startTime;
      
      return {
        success: true,
        data: result,
        duration,
        sideEffects: this.sideEffectTracker.getAll(),
        toolId: this.id,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Error hook
      if (this.onError) {
        await this.onError(error, params, context);
      }
      
      return {
        success: false,
        error: error.message,
        errorType: error.name,
        duration,
        sideEffects: this.sideEffectTracker.getAll(),
        toolId: this.id,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Execute with timeout protection
   */
  async executeWithTimeout(params, context) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Tool ${this.id} timed out after ${this.timeout}ms`));
      }, this.timeout);
      
      Promise.resolve(this.handler(params, context, this.sideEffectTracker))
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Validate input parameters against schema
   */
  validateInputs(params) {
    if (!this.inputSchema) return;
    
    const required = this.inputSchema.required || [];
    const properties = this.inputSchema.properties || {};
    
    // Check required fields
    for (const field of required) {
      if (params[field] === undefined || params[field] === null) {
        throw new Error(`Missing required parameter: ${field}`);
      }
    }
    
    // Type validation (basic)
    for (const [key, value] of Object.entries(params)) {
      const propSchema = properties[key];
      if (propSchema && propSchema.type) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== propSchema.type && !(propSchema.type === 'integer' && actualType === 'number')) {
          throw new Error(`Invalid type for ${key}: expected ${propSchema.type}, got ${actualType}`);
        }
      }
    }
  }

  /**
   * Validate outputs against schema
   */
  validateOutputs(result) {
    if (!this.outputSchema) return;
    // Basic validation - can be enhanced with JSON Schema validator
  }

  /**
   * Get tool definition for registry
   */
  toDefinition() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      category: this.category,
      version: this.version,
      backend: {
        handler: this.handler,
        sideEffects: this.sideEffects,
        sandbox: this.sandbox,
        timeout: this.timeout
      },
      inputSchema: this.inputSchema,
      outputSchema: this.outputSchema
    };
  }

  /**
   * Check if tool has side effect
   */
  hasSideEffect(effect) {
    return this.sideEffects.includes(effect);
  }

  /**
   * Check if tool can be undone
   */
  canUndo() {
    return this.sideEffectTracker.canUndo();
  }

  /**
   * Undo side effects
   */
  async undo() {
    return this.sideEffectTracker.undo();
  }
}

/**
 * SideEffectTracker - Tracks and manages side effects
 */
class SideEffectTracker {
  constructor() {
    this.reads = [];      // Files/data read
    this.writes = [];     // Files/data written
    this.networkCalls = []; // Network requests made
    this.executions = []; // Commands executed
    this.undoStack = [];  // Operations that can be undone
  }

  recordRead(source, data = null) {
    this.reads.push({ source, timestamp: new Date().toISOString(), data });
  }

  recordWrite(destination, data = null, undoOperation = null) {
    this.writes.push({ destination, timestamp: new Date().toISOString(), data });
    if (undoOperation) {
      this.undoStack.push({ type: 'write', destination, undoOperation });
    }
  }

  recordNetworkCall(url, method = 'GET', response = null) {
    this.networkCalls.push({ url, method, timestamp: new Date().toISOString(), response });
  }

  recordExecution(command, result = null) {
    this.executions.push({ command, timestamp: new Date().toISOString(), result });
  }

  getAll() {
    return {
      reads: this.reads,
      writes: this.writes,
      networkCalls: this.networkCalls,
      executions: this.executions
    };
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  async undo() {
    const undone = [];
    
    // Process undo stack in reverse
    while (this.undoStack.length > 0) {
      const operation = this.undoStack.pop();
      
      try {
        if (operation.undoOperation) {
          await operation.undoOperation();
          undone.push(operation);
        }
      } catch (error) {
        console.error(`Failed to undo operation: ${error.message}`);
      }
    }
    
    return undone;
  }

  clear() {
    this.reads = [];
    this.writes = [];
    this.networkCalls = [];
    this.executions = [];
    this.undoStack = [];
  }
}

module.exports = { ToolBase, SideEffectTracker };
