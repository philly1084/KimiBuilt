/**
 * @fileoverview Task Status Enum and State Transition Management
 * 
 * Defines the TaskStatus enumeration and valid state transition logic
 * for the OpenAI Agent SDK task lifecycle.
 * 
 * @module TaskStatus
 * @version 1.0.0
 */

'use strict';

/**
 * Task status enumeration representing the lifecycle states of a task.
 * @readonly
 * @enum {string}
 */
const TaskStatus = Object.freeze({
  /** Task is created but not yet started */
  PENDING: 'pending',
  
  /** Task is being analyzed and planned */
  PLANNING: 'planning',
  
  /** Task is actively being executed */
  EXECUTING: 'executing',
  
  /** Task output is being verified */
  VERIFYING: 'verifying',
  
  /** Task completed successfully */
  COMPLETED: 'completed',
  
  /** Task failed due to error or constraint violation */
  FAILED: 'failed',
  
  /** Task was cancelled before completion */
  CANCELLED: 'cancelled'
});

/**
 * Valid status transitions matrix.
 * Defines which states can be transitioned to from each state.
 * @private
 * @type {Object<string, string[]>}
 */
const validTransitions = Object.freeze({
  [TaskStatus.PENDING]: [
    TaskStatus.PLANNING,    // Start planning the task
    TaskStatus.CANCELLED    // Cancel before starting
  ],
  [TaskStatus.PLANNING]: [
    TaskStatus.EXECUTING,   // Begin execution after planning
    TaskStatus.FAILED,      // Planning failed (e.g., invalid objective)
    TaskStatus.CANCELLED    // Cancel during planning
  ],
  [TaskStatus.EXECUTING]: [
    TaskStatus.VERIFYING,   // Move to verification after execution
    TaskStatus.FAILED,      // Execution failed
    TaskStatus.CANCELLED    // Cancel during execution
  ],
  [TaskStatus.VERIFYING]: [
    TaskStatus.COMPLETED,   // Verification passed
    TaskStatus.EXECUTING,   // Verification failed, retry execution
    TaskStatus.FAILED,      // Verification failed irrecoverably
    TaskStatus.CANCELLED    // Cancel during verification
  ],
  [TaskStatus.COMPLETED]: [
    // Terminal state - no transitions allowed
  ],
  [TaskStatus.FAILED]: [
    TaskStatus.PLANNING,    // Retry from planning (with same task)
    TaskStatus.PENDING      // Reset and retry entirely
  ],
  [TaskStatus.CANCELLED]: [
    TaskStatus.PENDING      // Re-queue a cancelled task
  ]
});

/**
 * Terminal states that cannot be transitioned out of under normal circumstances.
 * @readonly
 * @type {string[]}
 */
const TERMINAL_STATES = Object.freeze([
  TaskStatus.COMPLETED,
  TaskStatus.FAILED,
  TaskStatus.CANCELLED
]);

/**
 * Active states that indicate the task is in progress.
 * @readonly
 * @type {string[]}
 */
const ACTIVE_STATES = Object.freeze([
  TaskStatus.PLANNING,
  TaskStatus.EXECUTING,
  TaskStatus.VERIFYING
]);

/**
 * Checks if a status transition is valid.
 * 
 * @param {string} from - The current status
 * @param {string} to - The target status
 * @returns {boolean} True if the transition is valid, false otherwise
 * @throws {TypeError} If from or to status is not a string
 * 
 * @example
 * ```javascript
 * if (canTransition(TaskStatus.PENDING, TaskStatus.PLANNING)) {
 *   task.transitionStatus(TaskStatus.PLANNING);
 * }
 * ```
 */
function canTransition(from, to) {
  if (typeof from !== 'string') {
    throw new TypeError(`Expected 'from' to be a string, got ${typeof from}`);
  }
  if (typeof to !== 'string') {
    throw new TypeError(`Expected 'to' to be a string, got ${typeof to}`);
  }
  
  const allowedTransitions = validTransitions[from];
  if (!allowedTransitions) {
    return false;
  }
  
  return allowedTransitions.includes(to);
}

/**
 * Gets the list of valid next states from a given status.
 * 
 * @param {string} status - The current status
 * @returns {string[]} Array of valid next states (empty array for terminal states)
 * @throws {TypeError} If status is not a string
 * @throws {Error} If the status is not a valid TaskStatus value
 * 
 * @example
 * ```javascript
 * const nextStates = getAllowedTransitions(TaskStatus.EXECUTING);
 * // Returns: ['verifying', 'failed', 'cancelled']
 * ```
 */
function getAllowedTransitions(status) {
  if (typeof status !== 'string') {
    throw new TypeError(`Expected status to be a string, got ${typeof status}`);
  }
  
  if (!Object.values(TaskStatus).includes(status)) {
    throw new Error(`Invalid status: ${status}. Must be one of: ${Object.values(TaskStatus).join(', ')}`);
  }
  
  return [...(validTransitions[status] || [])];
}

/**
 * Checks if a status represents a terminal (final) state.
 * 
 * @param {string} status - The status to check
 * @returns {boolean} True if the status is terminal
 * @throws {TypeError} If status is not a string
 */
function isTerminalState(status) {
  if (typeof status !== 'string') {
    throw new TypeError(`Expected status to be a string, got ${typeof status}`);
  }
  return TERMINAL_STATES.includes(status);
}

/**
 * Checks if a status represents an active (in-progress) state.
 * 
 * @param {string} status - The status to check
 * @returns {boolean} True if the status is active
 * @throws {TypeError} If status is not a string
 */
function isActiveState(status) {
  if (typeof status !== 'string') {
    throw new TypeError(`Expected status to be a string, got ${typeof status}`);
  }
  return ACTIVE_STATES.includes(status);
}

/**
 * Gets a human-readable description of a status.
 * 
 * @param {string} status - The status
 * @returns {string} Human-readable description
 */
function getStatusDescription(status) {
  const descriptions = {
    [TaskStatus.PENDING]: 'Task is waiting to be processed',
    [TaskStatus.PLANNING]: 'Task is being analyzed and planned',
    [TaskStatus.EXECUTING]: 'Task is being executed',
    [TaskStatus.VERIFYING]: 'Task output is being verified',
    [TaskStatus.COMPLETED]: 'Task completed successfully',
    [TaskStatus.FAILED]: 'Task failed',
    [TaskStatus.CANCELLED]: 'Task was cancelled'
  };
  
  return descriptions[status] || 'Unknown status';
}

module.exports = {
  TaskStatus,
  canTransition,
  getAllowedTransitions,
  isTerminalState,
  isActiveState,
  getStatusDescription,
  // Constants for advanced use cases
  TERMINAL_STATES,
  ACTIVE_STATES
};
