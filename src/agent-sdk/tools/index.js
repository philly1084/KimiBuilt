/**
 * @fileoverview Agent SDK Tool Registry
 * 
 * This module provides the core tooling infrastructure for the OpenAI Agent SDK,
 * including tool definitions, a central registry, and side effect tracking.
 * 
 * @module @agent-sdk/tools
 * @example
 * const { ToolRegistry, ToolDefinition, SideEffectTracker } = require('@agent-sdk/tools');
 * 
 * // Create a registry
 * const registry = new ToolRegistry();
 * 
 * // Define a tool
 * const calculator = new ToolDefinition({
 *   id: 'calculator',
 *   name: 'Calculator',
 *   description: 'Performs arithmetic operations',
 *   inputSchema: {
 *     type: 'object',
 *     properties: {
 *       operation: { type: 'string', enum: ['add', 'subtract', 'multiply', 'divide'] },
 *       a: { type: 'number' },
 *       b: { type: 'number' }
 *     },
 *     required: ['operation', 'a', 'b']
 *   },
 *   handler: async ({ operation, a, b }) => {
 *     switch (operation) {
 *       case 'add': return a + b;
 *       case 'subtract': return a - b;
 *       case 'multiply': return a * b;
 *       case 'divide': return a / b;
 *     }
 *   }
 * });
 * 
 * // Register and execute
 * registry.register(calculator);
 * const result = await registry.execute('calculator', { operation: 'add', a: 5, b: 3 });
 */

// Tool Definition
const { 
  ToolDefinition, 
  ToolSideEffect 
} = require('./ToolDefinition');

// Tool Registry
const { 
  ToolRegistry, 
  ToolNotFoundError, 
  ToolRegistrationError 
} = require('./ToolRegistry');

// Side Effect Tracking
const { 
  SideEffect, 
  SideEffectTracker, 
  SideEffectType 
} = require('./SideEffectTracker');

module.exports = {
  // Core Classes
  ToolDefinition,
  ToolRegistry,
  SideEffect,
  SideEffectTracker,
  
  // Enums
  ToolSideEffect,
  SideEffectType,
  
  // Errors
  ToolNotFoundError,
  ToolRegistrationError
};

/**
 * @typedef {import('./ToolDefinition').ToolExecutionResult} ToolExecutionResult
 */
