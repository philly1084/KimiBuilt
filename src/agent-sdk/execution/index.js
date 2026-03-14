/**
 * Execution System for Agent SDK
 * 
 * Provides comprehensive task execution capabilities including:
 * - Execution tracing and monitoring
 * - Retry policies with multiple backoff strategies
 * - Output verification and validation
 * - Intelligent planning with dependency management
 * - Full execution orchestration
 * 
 * @module execution
 * @requires uuid
 * @requires ajv
 */

const { ExecutionTrace, ExecutionStep } = require('./ExecutionTrace');
const { RetryPolicy, RetryEngine } = require('./RetryEngine');
const { Verifier, ValidationResult } = require('./Verifier');
const { Planner, ExecutionPlan } = require('./Planner');
const { Executor } = require('./Executor');

/**
 * Execution system version.
 * @type {string}
 */
const VERSION = '1.0.0';

/**
 * Creates a fully configured execution system.
 * @param {Object} options - Configuration options
 * @param {Object} options.toolRegistry - Tool registry
 * @param {Object} options.workingMemory - Working memory
 * @param {Object} options.llmClient - LLM client
 * @returns {Object} Configured execution system
 */
function createExecutionSystem(options = {}) {
  const {
    toolRegistry,
    workingMemory,
    llmClient
  } = options;
  
  // Create components
  const retryEngine = new RetryEngine();
  const verifier = new Verifier();
  const planner = new Planner(toolRegistry, llmClient);
  
  const executor = new Executor({
    toolRegistry,
    workingMemory,
    retryEngine,
    verifier,
    planner,
    llmClient
  });
  
  return {
    executor,
    planner,
    verifier,
    retryEngine,
    ExecutionTrace,
    ExecutionStep,
    RetryPolicy,
    ExecutionPlan,
    ValidationResult
  };
}

module.exports = {
  // Version
  VERSION,
  
  // Trace - Execution tracking
  /**
   * ExecutionTrace captures detailed execution traces for tasks.
   * @type {typeof ExecutionTrace}
   */
  ExecutionTrace,
  
  /**
   * ExecutionStep represents a single step in an execution trace.
   * @type {typeof ExecutionStep}
   */
  ExecutionStep,
  
  // Retry - Retry policies and engine
  /**
   * RetryPolicy defines retry behavior with configurable backoff.
   * @type {typeof RetryPolicy}
   */
  RetryPolicy,
  
  /**
   * RetryEngine manages multiple retry policies.
   * @type {typeof RetryEngine}
   */
  RetryEngine,
  
  // Verification - Output validation
  /**
   * Verifier validates task outputs against criteria.
   * @type {typeof Verifier}
   */
  Verifier,
  
  /**
   * ValidationResult represents a single validation criterion result.
   * @type {typeof ValidationResult}
   */
  ValidationResult,
  
  // Planning - Task planning
  /**
   * Planner creates execution plans for tasks.
   * @type {typeof Planner}
   */
  Planner,
  
  /**
   * ExecutionPlan represents a plan with dependency graph.
   * @type {typeof ExecutionPlan}
   */
  ExecutionPlan,
  
  // Execution - Main orchestrator
  /**
   * Executor orchestrates the full task execution flow.
   * @type {typeof Executor}
   */
  Executor,
  
  // Factory function
  /**
   * Factory function to create a complete execution system.
   * @type {typeof createExecutionSystem}
   */
  createExecutionSystem
};
