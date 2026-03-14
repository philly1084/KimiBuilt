/**
 * @fileoverview Task Validation Schemas
 * 
 * Provides JSON Schema definitions and validation functions for Task objects
 * and their components in the OpenAI Agent SDK.
 * 
 * @module TaskSchema
 * @version 1.0.0
 */

'use strict';

const { TaskStatus } = require('./TaskStatus');

/**
 * UUID v4 regex pattern for string validation.
 * @private
 * @type {RegExp}
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * ISO 8601 date-time regex pattern.
 * @private
 * @type {RegExp}
 */
const ISO8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Valid task types.
 * @readonly
 * @type {string[]}
 */
const VALID_TASK_TYPES = Object.freeze([
  'code-generation',
  'document-edit',
  'analysis',
  'multi-step',
  'tool-call',
  'chat',
  'reasoning'
]);

/**
 * Valid input/output formats.
 * @readonly
 * @type {string[]}
 */
const VALID_FORMATS = Object.freeze([
  'text',
  'json',
  'markdown',
  'code',
  'binary',
  'base64'
]);

/**
 * Valid output destinations.
 * @readonly
 * @type {string[]}
 */
const VALID_DESTINATIONS = Object.freeze([
  'chat',
  'file',
  'memory',
  'callback',
  'stream'
]);

/**
 * Valid allowed operations for constraints.
 * @readonly
 * @type {string[]}
 */
const VALID_OPERATIONS = Object.freeze([
  'read',
  'write',
  'execute',
  'network',
  'filesystem',
  'shell'
]);

/**
 * Valid retry backoff strategies.
 * @readonly
 * @type {string[]}
 */
const VALID_BACKOFF_STRATEGIES = Object.freeze([
  'fixed',
  'linear',
  'exponential'
]);

/**
 * Valid retryable error types.
 * @readonly
 * @type {string[]}
 */
const VALID_RETRYABLE_ERRORS = Object.freeze([
  'timeout',
  'rate-limit',
  'network',
  'service-unavailable',
  'internal-error'
]);

/**
 * Task input schema definition.
 * @type {Object}
 */
const taskInputSchema = {
  type: 'object',
  required: ['type', 'objective'],
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      description: 'Unique identifier for the task (UUID v4)'
    },
    type: {
      type: 'string',
      enum: VALID_TASK_TYPES,
      description: 'The type of task to be executed'
    },
    objective: {
      type: 'string',
      minLength: 1,
      maxLength: 1000,
      description: 'Clear description of what the task should accomplish'
    },
    context: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          format: 'uuid',
          description: 'ID of the parent session'
        },
        parentTaskId: {
          type: 'string',
          format: 'uuid',
          description: 'ID of the parent task if this is a subtask'
        },
        priority: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
          default: 5,
          description: 'Task priority from 1 (highest) to 10 (lowest)'
        },
        deadline: {
          type: 'string',
          format: 'date-time',
          description: 'ISO 8601 deadline for task completion'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for categorization'
        },
        metadata: {
          type: 'object',
          additionalProperties: true,
          description: 'Additional context metadata'
        }
      },
      additionalProperties: true
    },
    input: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          default: '',
          description: 'Primary input content'
        },
        format: {
          type: 'string',
          enum: VALID_FORMATS,
          default: 'text',
          description: 'Format of the input content'
        },
        attachments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: { type: 'string' },
              content: {},
              path: { type: 'string' }
            },
            required: ['name']
          },
          default: [],
          description: 'Attached files or data'
        },
        references: {
          type: 'array',
          items: { type: 'string' },
          description: 'Reference IDs or URLs'
        }
      },
      additionalProperties: true
    },
    output: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: VALID_FORMATS,
          default: 'text',
          description: 'Expected output format'
        },
        schema: {
          type: 'object',
          description: 'JSON Schema for structured output validation'
        },
        destination: {
          type: 'string',
          enum: VALID_DESTINATIONS,
          default: 'chat',
          description: 'Where the output should be delivered'
        },
        filePath: {
          type: 'string',
          description: 'File path if destination is "file"'
        }
      },
      additionalProperties: true
    },
    tools: {
      type: 'array',
      items: {
        type: 'string',
        minLength: 1
      },
      default: [],
      description: 'List of tool names available for this task'
    },
    constraints: {
      type: 'object',
      properties: {
        maxTokens: {
          type: 'integer',
          minimum: 1,
          maximum: 128000,
          default: 4000,
          description: 'Maximum tokens allowed for LLM calls'
        },
        maxSteps: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 10,
          description: 'Maximum execution steps allowed'
        },
        timeout: {
          type: 'integer',
          minimum: 1000,
          description: 'Timeout in milliseconds'
        },
        allowedOperations: {
          type: 'array',
          items: {
            type: 'string',
            enum: VALID_OPERATIONS
          },
          default: ['read'],
          description: 'Operations the task is permitted to perform'
        },
        forbiddenPaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths that cannot be accessed'
        },
        requireApproval: {
          type: 'array',
          items: { type: 'string' },
          description: 'Operations requiring explicit approval'
        }
      },
      additionalProperties: true
    },
    completionCriteria: {
      type: 'object',
      properties: {
        conditions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['output-present', 'format-valid', 'custom-check']
              },
              check: { type: 'string' },
              expected: {}
            }
          },
          default: [],
          description: 'Conditions that must be met for completion'
        },
        minConfidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          default: 0.8,
          description: 'Minimum confidence score for completion'
        },
        customValidator: {
          type: 'string',
          description: 'Custom validation function name or path'
        }
      },
      additionalProperties: true
    },
    retryPolicy: {
      type: 'object',
      properties: {
        maxAttempts: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
          default: 3,
          description: 'Maximum retry attempts'
        },
        backoff: {
          type: 'string',
          enum: VALID_BACKOFF_STRATEGIES,
          default: 'exponential',
          description: 'Backoff strategy between retries'
        },
        initialDelay: {
          type: 'integer',
          minimum: 0,
          default: 1000,
          description: 'Initial delay in milliseconds'
        },
        maxDelay: {
          type: 'integer',
          minimum: 0,
          default: 60000,
          description: 'Maximum delay in milliseconds'
        },
        retryableErrors: {
          type: 'array',
          items: {
            type: 'string',
            enum: VALID_RETRYABLE_ERRORS
          },
          default: ['timeout', 'rate-limit'],
          description: 'Error types that trigger a retry'
        }
      },
      additionalProperties: false
    },
    status: {
      type: 'string',
      enum: Object.values(TaskStatus),
      default: TaskStatus.PENDING,
      description: 'Current status of the task'
    },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string' },
          status: { type: 'string' },
          input: {},
          output: {},
          timestamp: { type: 'string' }
        }
      },
      default: [],
      description: 'Execution steps'
    },
    results: {
      type: 'object',
      additionalProperties: true,
      default: {},
      description: 'Task execution results'
    },
    metadata: {
      type: 'object',
      properties: {
        createdAt: {
          type: 'string',
          format: 'date-time'
        },
        updatedAt: {
          type: 'string',
          format: 'date-time'
        },
        completedAt: {
          type: ['string', 'null'],
          format: 'date-time'
        },
        attempts: {
          type: 'integer',
          minimum: 0,
          default: 0
        },
        tokensUsed: {
          type: 'integer',
          minimum: 0,
          default: 0
        },
        executionTime: {
          type: 'integer',
          minimum: 0,
          default: 0
        }
      },
      additionalProperties: true
    }
  },
  additionalProperties: false
};

/**
 * Validation result type definition.
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether validation passed
 * @property {string[]} errors - Array of error messages
 * @property {string[]} warnings - Array of warning messages
 * @property {Object} [details] - Detailed validation information
 */

/**
 * Validates a value against a format pattern.
 * @private
 * @param {*} value - Value to validate
 * @param {string} format - Format name
 * @returns {boolean} True if format is valid
 */
function validateFormat(value, format) {
  if (typeof value !== 'string') return false;
  
  switch (format) {
    case 'uuid':
      return UUID_REGEX.test(value);
    case 'date-time':
      return ISO8601_REGEX.test(value) && !isNaN(Date.parse(value));
    default:
      return true;
  }
}

/**
 * Validates a value against a schema property.
 * @private
 * @param {*} value - Value to validate
 * @param {Object} propSchema - Property schema
 * @param {string} path - Property path for error messages
 * @returns {string[]} Array of error messages
 */
function validateProperty(value, propSchema, path) {
  const errors = [];
  
  if (value === undefined || value === null) {
    return errors;
  }
  
  // Type validation
  if (propSchema.type) {
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== propSchema.type) {
      errors.push(`${path}: expected type '${propSchema.type}', got '${actualType}'`);
      return errors;
    }
  }
  
  // String validations
  if (typeof value === 'string') {
    if (propSchema.minLength !== undefined && value.length < propSchema.minLength) {
      errors.push(`${path}: string length ${value.length} is less than minimum ${propSchema.minLength}`);
    }
    if (propSchema.maxLength !== undefined && value.length > propSchema.maxLength) {
      errors.push(`${path}: string length ${value.length} exceeds maximum ${propSchema.maxLength}`);
    }
    if (propSchema.format && !validateFormat(value, propSchema.format)) {
      errors.push(`${path}: invalid format '${propSchema.format}'`);
    }
    if (propSchema.enum && !propSchema.enum.includes(value)) {
      errors.push(`${path}: value '${value}' is not in allowed values [${propSchema.enum.join(', ')}]`);
    }
  }
  
  // Number/Integer validations
  if (typeof value === 'number') {
    if (propSchema.minimum !== undefined && value < propSchema.minimum) {
      errors.push(`${path}: value ${value} is less than minimum ${propSchema.minimum}`);
    }
    if (propSchema.maximum !== undefined && value > propSchema.maximum) {
      errors.push(`${path}: value ${value} exceeds maximum ${propSchema.maximum}`);
    }
    if (propSchema.type === 'integer' && !Number.isInteger(value)) {
      errors.push(`${path}: expected integer, got float ${value}`);
    }
  }
  
  // Array validations
  if (Array.isArray(value)) {
    if (propSchema.items) {
      value.forEach((item, index) => {
        const itemErrors = validateProperty(item, propSchema.items, `${path}[${index}]`);
        errors.push(...itemErrors);
      });
    }
  }
  
  // Object validations
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    if (propSchema.properties) {
      Object.entries(propSchema.properties).forEach(([key, subSchema]) => {
        if (value[key] !== undefined) {
          const propErrors = validateProperty(value[key], subSchema, `${path}.${key}`);
          errors.push(...propErrors);
        }
      });
    }
  }
  
  return errors;
}

/**
 * Validates task data against the task input schema.
 * 
 * @param {Object} data - The task data to validate
 * @returns {ValidationResult} Validation result with errors and warnings
 * 
 * @example
 * ```javascript
 * const result = validateTask({
 *   type: 'code-generation',
 *   objective: 'Generate a function'
 * });
 * if (!result.valid) {
 *   console.error(result.errors);
 * }
 * ```
 */
function validateTask(data) {
  const errors = [];
  const warnings = [];
  
  if (!data || typeof data !== 'object') {
    return {
      valid: false,
      errors: ['Data must be a non-null object'],
      warnings: []
    };
  }
  
  // Check required fields
  if (taskInputSchema.required) {
    for (const required of taskInputSchema.required) {
      if (data[required] === undefined || data[required] === null) {
        errors.push(`Missing required field: '${required}'`);
      }
    }
  }
  
  // Validate properties
  if (taskInputSchema.properties) {
    for (const [key, propSchema] of Object.entries(taskInputSchema.properties)) {
      if (data[key] !== undefined) {
        const propErrors = validateProperty(data[key], propSchema, key);
        errors.push(...propErrors);
      }
    }
  }
  
  // Check for additional properties if not allowed
  if (taskInputSchema.additionalProperties === false) {
    const allowedProps = Object.keys(taskInputSchema.properties || {});
    const actualProps = Object.keys(data);
    const extraProps = actualProps.filter(prop => !allowedProps.includes(prop));
    if (extraProps.length > 0) {
      errors.push(`Additional properties not allowed: ${extraProps.join(', ')}`);
    }
  }
  
  // Warnings for best practices
  if (data.objective && data.objective.length < 10) {
    warnings.push('Objective is very short; consider providing more detail');
  }
  if (data.tools && data.tools.length === 0 && data.type === 'tool-call') {
    warnings.push('Task type is "tool-call" but no tools are specified');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    details: {
      checkedProperties: Object.keys(taskInputSchema.properties || {}),
      errorCount: errors.length,
      warningCount: warnings.length
    }
  };
}

/**
 * Validates task input data.
 * 
 * @param {Object} input - The input data to validate
 * @returns {ValidationResult} Validation result
 */
function validateTaskInput(input) {
  const inputSchema = taskInputSchema.properties.input;
  const errors = validateProperty(input, inputSchema, 'input');
  
  // Additional input-specific validations
  if (input && input.attachments) {
    for (const [index, attachment] of input.attachments.entries()) {
      if (!attachment.content && !attachment.path) {
        errors.push(`input.attachments[${index}]: attachment must have 'content' or 'path'`);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings: []
  };
}

/**
 * Validates task output against an expected schema.
 * 
 * @param {*} output - The output value to validate
 * @param {Object} [schema] - Expected output schema (JSON Schema)
 * @returns {ValidationResult} Validation result
 * 
 * @example
 * ```javascript
 * const result = validateTaskOutput(
 *   { name: 'test', value: 123 },
 *   { type: 'object', required: ['name', 'value'] }
 * );
 * ```
 */
function validateTaskOutput(output, schema) {
  if (!schema) {
    return { valid: true, errors: [], warnings: [] };
  }
  
  const errors = validateProperty(output, schema, 'output');
  
  // Check required fields in schema
  if (schema.required && typeof output === 'object' && output !== null) {
    for (const required of schema.required) {
      if (!(required in output)) {
        errors.push(`output: missing required field '${required}'`);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings: []
  };
}

/**
 * Validates a task status transition.
 * 
 * @param {string} fromStatus - Current status
 * @param {string} toStatus - Target status
 * @returns {ValidationResult} Validation result
 */
function validateStatusTransition(fromStatus, toStatus) {
  const { canTransition } = require('./TaskStatus');
  
  const errors = [];
  
  if (!Object.values(TaskStatus).includes(fromStatus)) {
    errors.push(`Invalid from status: '${fromStatus}'`);
  }
  if (!Object.values(TaskStatus).includes(toStatus)) {
    errors.push(`Invalid to status: '${toStatus}'`);
  }
  
  if (errors.length === 0 && !canTransition(fromStatus, toStatus)) {
    errors.push(`Invalid transition from '${fromStatus}' to '${toStatus}'`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings: []
  };
}

module.exports = {
  // Schema definitions
  taskInputSchema,
  
  // Valid constants
  VALID_TASK_TYPES,
  VALID_FORMATS,
  VALID_DESTINATIONS,
  VALID_OPERATIONS,
  VALID_BACKOFF_STRATEGIES,
  VALID_RETRYABLE_ERRORS,
  
  // Validation functions
  validateTask,
  validateTaskInput,
  validateTaskOutput,
  validateStatusTransition,
  
  // Utility functions
  validateFormat
};
