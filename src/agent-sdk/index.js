/**
 * LillyBuilt Agent SDK
 * 
 * A sophisticated AI Agent SDK providing:
 * - Structured task execution
 * - Typed tool registry with side-effect tracking
 * - Working memory + skill memory split
 * - Planner / executor / verifier loop
 * - Trace timeline UI
 * - Completion criteria + retry policy
 * - Reusable skill capture
 * 
 * @example
 * const { AgentOrchestrator } = require('@kimibuilt/agent-sdk');
 * 
 * const orchestrator = new AgentOrchestrator({
 *   llmClient: openaiClient,
 *   embedder: ollamaEmbedder,
 *   vectorStore: qdrantStore
 * });
 * 
 * const result = await orchestrator.execute({
 *   type: 'code-generation',
 *   objective: 'Generate a Python function',
 *   tools: ['file-read', 'code-execute']
 * });
 */

// Core
const { Task } = require('./core/Task');
const { TaskStatus, canTransition, getAllowedTransitions } = require('./core/TaskStatus');
const { validateTask, taskInputSchema } = require('./core/TaskSchema');

// Tools
const { ToolRegistry } = require('./tools/ToolRegistry');
const { ToolDefinition } = require('./tools/ToolDefinition');
const { SideEffectTracker, SideEffect, SideEffectType } = require('./tools/SideEffectTracker');

// Memory
const { WorkingMemory } = require('./memory/WorkingMemory');
const { SkillMemory, Skill } = require('./memory/SkillMemory');
const { SkillExtractor } = require('./memory/SkillExtractor');
const { SkillRetriever } = require('./memory/SkillRetriever');

// Execution
const { Executor } = require('./execution/Executor');
const { Planner, ExecutionPlan } = require('./execution/Planner');
const { Verifier, ValidationResult } = require('./execution/Verifier');
const { RetryEngine, RetryPolicy } = require('./execution/RetryEngine');
const { ExecutionTrace, ExecutionStep } = require('./execution/ExecutionTrace');

// Main
const { AgentOrchestrator } = require('./AgentOrchestrator');

// Version
const VERSION = '1.0.0';

module.exports = {
  VERSION,
  
  // Core
  Task,
  TaskStatus,
  canTransition,
  getAllowedTransitions,
  validateTask,
  taskInputSchema,
  
  // Tools
  ToolRegistry,
  ToolDefinition,
  SideEffectTracker,
  SideEffect,
  SideEffectType,
  
  // Memory
  WorkingMemory,
  SkillMemory,
  Skill,
  SkillExtractor,
  SkillRetriever,
  
  // Execution
  Executor,
  Planner,
  ExecutionPlan,
  Verifier,
  ValidationResult,
  RetryEngine,
  RetryPolicy,
  ExecutionTrace,
  ExecutionStep,
  
  // Main
  AgentOrchestrator
};
