/**
 * Memory System for OpenAI Agent SDK
 * 
 * Provides comprehensive memory management for agent sessions:
 * - WorkingMemory: Ephemeral per-session memory for context management
 * - SkillMemory: Long-term storage for learned skills with vector search
 * - SkillExtractor: Extracts reusable skills from successful tasks
 * - SkillRetriever: Retrieves relevant skills using semantic + pattern matching
 * 
 * @module @openai-agent-sdk/memory
 * @example
 * const { WorkingMemory, SkillMemory, SkillExtractor, SkillRetriever } = require('@openai-agent-sdk/memory');
 * 
 * // Session memory
 * const memory = new WorkingMemory('session-123', { responseStyle: 'detailed' });
 * 
 * // Skill management
 * const skillMemory = new SkillMemory(vectorStore);
 * const extractor = new SkillExtractor(embedder);
 * const retriever = new SkillRetriever(skillMemory, embedder);
 * 
 * // Extract and store a skill
 * const skill = await extractor.extractFromTask(completedTask);
 * if (skill) await skillMemory.store(skill);
 * 
 * // Retrieve relevant skills
 * const skills = await retriever.retrieveForTask(newTask);
 */

const { WorkingMemory } = require('./WorkingMemory');
const { Skill, SkillMemory } = require('./SkillMemory');
const { SkillExtractor } = require('./SkillExtractor');
const { SkillRetriever } = require('./SkillRetriever');

module.exports = {
  /**
   * Ephemeral per-session memory class.
   * Manages conversation history, context window, and session state.
   * @type {WorkingMemory}
   */
  WorkingMemory,
  
  /**
   * Represents a learned skill.
   * @type {Skill}
   */
  Skill,
  
  /**
   * Long-term skill storage with vector search and caching.
   * @type {SkillMemory}
   */
  SkillMemory,
  
  /**
   * Extracts skills from successful task executions.
   * @type {SkillExtractor}
   */
  SkillExtractor,
  
  /**
   * Retrieves relevant skills for new tasks.
   * @type {SkillRetriever}
   */
  SkillRetriever
};
