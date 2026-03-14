const { Skill } = require('./SkillMemory');

/**
 * @typedef {Object} TaskStep
 * @property {string} type - Step type
 * @property {string} description - Step description
 * @property {string[]} [toolsUsed] - Tools used in this step
 * @property {Object} [input] - Step input parameters
 */

/**
 * @typedef {Object} TaskResult
 * @property {any} data - Result data
 * @property {string} [format] - Result format
 * @property {Object} [metadata] - Additional metadata
 */

/**
 * @typedef {Object} Task
 * @property {string} id - Task ID
 * @property {string} type - Task type (e.g., 'code-generation', 'analysis')
 * @property {string} objective - Task objective/description
 * @property {any} input - Task input
 * @property {TaskResult} results - Task results
 * @property {TaskStep[]} steps - Steps taken to complete the task
 * @property {string[]} tools - Tools used in the task
 * @property {'pending'|'in_progress'|'completed'|'failed'} status - Task status
 * @property {Object} [metadata] - Additional task metadata
 */

/**
 * @typedef {Object} ExtractedSkill
 * @property {string} name - Generated skill name
 * @property {string} description - Skill description
 * @property {string[]} triggerPatterns - Keywords that trigger this skill
 * @property {Object[]} successExamples - Examples of successful executions
 * @property {string[]} toolPreferences - Preferred tools
 * @property {Object} parameterTemplates - Reusable parameter patterns
 * @property {string[]} tags - Skill tags
 * @property {string} category - Skill category
 * @property {string} difficulty - Difficulty level
 */

/**
 * @interface Embedder
 * @method embed(text: string): Promise<number[]> - Generates vector embedding for text
 */

/**
 * Extracts reusable skills from successful task executions.
 * Analyzes task patterns, tool usage, and outcomes to create
 * generalizable skills with embeddings for semantic search.
 * 
 * @class SkillExtractor
 * @example
 * const extractor = new SkillExtractor(embedder);
 * const skill = await extractor.extractFromTask(completedTask);
 * if (skill) {
 *   await skillMemory.store(skill);
 * }
 */
class SkillExtractor {
  /**
   * Creates a new SkillExtractor instance.
   * 
   * @param {Embedder} embedder - Embedding provider for generating vector representations
   * @throws {Error} If embedder is not provided or missing embed method
   */
  constructor(embedder) {
    if (!embedder) {
      throw new Error('embedder is required');
    }
    if (typeof embedder.embed !== 'function') {
      throw new Error('embedder must implement embed method');
    }
    
    this.embedder = embedder;
  }
  
  /**
   * Extracts a skill from a completed task.
   * Only extracts from tasks with 'completed' status.
   * 
   * @param {Task} task - The completed task to extract from
   * @returns {Promise<Skill|null>} Extracted skill or null if task not completed
   * @throws {TypeError} If task is not a valid object
   * @throws {Error} If embedding generation fails
   */
  async extractFromTask(task) {
    if (!task || typeof task !== 'object') {
      throw new TypeError('task must be an object');
    }
    
    // Only extract from successful tasks
    if (task.status !== 'completed') {
      return null;
    }
    
    if (!task.steps || !Array.isArray(task.steps)) {
      throw new TypeError('task.steps must be an array');
    }
    
    try {
      // Generate skill name and description
      const name = this.generateSkillName(task);
      const description = this.generateDescription(task);
      
      // Extract trigger patterns
      const triggerPatterns = this.extractTriggerPatterns(task);
      
      // Extract tool preferences
      const toolPreferences = [...new Set(
        task.steps.flatMap(s => s.toolsUsed || [])
      )];
      
      // Extract parameter templates
      const parameterTemplates = this.extractParameterTemplates(task);
      
      // Create success example
      const successExample = {
        input: task.input,
        output: task.results,
        steps: task.steps.map(s => ({
          type: s.type,
          description: s.description
        }))
      };
      
      // Generate embedding for semantic search
      const embeddingText = `${name} ${description} ${triggerPatterns.join(' ')}`;
      const embedding = await this.embedder.embed(embeddingText);
      
      if (!Array.isArray(embedding)) {
        throw new Error('Embedder must return an array');
      }
      
      // Create skill
      const skill = new Skill({
        name,
        description,
        triggerPatterns,
        successExamples: [successExample],
        toolPreferences,
        parameterTemplates,
        createdFrom: task.id,
        metadata: {
          embedding,
          tags: this.extractTags(task),
          category: this.categorize(task),
          difficulty: this.assessDifficulty(task)
        }
      });
      
      return skill;
    } catch (error) {
      throw new Error(`Failed to extract skill from task: ${error.message}`);
    }
  }
  
  /**
   * Generates a skill name from the task objective.
   * Extracts significant words and formats them as a title.
   * 
   * @param {Task} task - The task to generate name from
   * @returns {string} Generated skill name
   * @throws {TypeError} If task.objective is not a string
   */
  generateSkillName(task) {
    if (!task.objective || typeof task.objective !== 'string') {
      throw new TypeError('task.objective must be a string');
    }
    
    // Extract key words from objective
    const words = task.objective
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(' ')
      .filter(w => w.length > 3)
      .slice(0, 5);
    
    return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  
  /**
   * Generates a skill description from task information.
   * 
   * @param {Task} task - The task to generate description from
   * @returns {string} Generated description
   * @throws {TypeError} If required task properties are invalid
   */
  generateDescription(task) {
    if (!task.objective || typeof task.objective !== 'string') {
      throw new TypeError('task.objective must be a string');
    }
    if (!task.steps || !Array.isArray(task.steps)) {
      throw new TypeError('task.steps must be an array');
    }
    
    const toolList = task.tools && Array.isArray(task.tools) 
      ? task.tools.join(', ') 
      : 'various tools';
    
    return `Successfully completed: ${task.objective}. Used ${task.steps.length} steps with tools: ${toolList}.`;
  }
  
  /**
   * Extracts trigger patterns from the task objective.
   * Includes action verbs and significant keywords.
   * 
   * @param {Task} task - The task to extract patterns from
   * @returns {string[]} Array of trigger patterns
   * @throws {TypeError} If task.objective is not a string
   */
  extractTriggerPatterns(task) {
    if (!task.objective || typeof task.objective !== 'string') {
      throw new TypeError('task.objective must be a string');
    }
    
    // Extract keywords that could trigger this skill
    const objective = task.objective.toLowerCase();
    const words = objective.split(' ').filter(w => w.length > 4);
    
    // Return top keywords + action verbs
    const actionVerbs = ['generate', 'create', 'build', 'parse', 'analyze', 'transform', 
                         'convert', 'extract', 'summarize', 'validate', 'format'];
    const foundVerbs = actionVerbs.filter(v => objective.includes(v));
    
    // Remove duplicates and limit total patterns
    const patterns = [...new Set([...foundVerbs, ...words.slice(0, 5)])];
    return patterns.slice(0, 8);
  }
  
  /**
   * Extracts reusable parameter templates from task steps.
   * Identifies common parameter keys and their values.
   * 
   * @param {Task} task - The task to extract templates from
   * @returns {Object} Parameter templates grouped by key
   */
  extractParameterTemplates(task) {
    if (!task.steps || !Array.isArray(task.steps)) {
      throw new TypeError('task.steps must be an array');
    }
    
    const templates = {};
    
    for (const step of task.steps) {
      if (step.input && typeof step.input === 'object') {
        for (const [key, value] of Object.entries(step.input)) {
          if (typeof value === 'string' && value.length < 100) {
            if (!templates[key]) templates[key] = [];
            if (!templates[key].includes(value)) {
              templates[key].push(value);
            }
          }
        }
      }
    }
    
    // Limit template values per key
    for (const key of Object.keys(templates)) {
      templates[key] = templates[key].slice(0, 5);
    }
    
    return templates;
  }
  
  /**
   * Extracts tags from task information for categorization.
   * 
   * @param {Task} task - The task to extract tags from
   * @returns {string[]} Array of tags
   */
  extractTags(task) {
    const tags = [];
    
    if (task.type) {
      tags.push(task.type);
    }
    
    if (task.tools && Array.isArray(task.tools)) {
      if (task.tools.includes('code-execute')) tags.push('code');
      if (task.tools.includes('file-read')) tags.push('files');
      if (task.tools.includes('file-write')) tags.push('files');
      if (task.tools.includes('web-search')) tags.push('research');
      if (task.tools.includes('web-fetch')) tags.push('research');
    }
    
    return tags;
  }
  
  /**
   * Categorizes a task based on its type and content.
   * 
   * @param {Task} task - The task to categorize
   * @returns {string} Category name
   */
  categorize(task) {
    if (!task.type) return 'general';
    
    const typeMap = {
      'code-generation': 'coding',
      'code-refactor': 'coding',
      'code-review': 'coding',
      'document-edit': 'writing',
      'document-create': 'writing',
      'analysis': 'analysis',
      'data-analysis': 'analysis',
      'research': 'research',
      'debug': 'debugging'
    };
    
    return typeMap[task.type] || 'general';
  }
  
  /**
   * Assesses the difficulty level of a task.
   * Based on number of steps and tools used.
   * 
   * @param {Task} task - The task to assess
   * @returns {string} Difficulty level ('beginner', 'intermediate', 'advanced')
   */
  assessDifficulty(task) {
    if (!task.steps || !Array.isArray(task.steps)) {
      return 'intermediate';
    }
    
    const steps = task.steps.length;
    const tools = task.tools && Array.isArray(task.tools) ? task.tools.length : 0;
    
    if (steps > 5 || tools > 3) return 'advanced';
    if (steps > 2 || tools > 1) return 'intermediate';
    return 'beginner';
  }
  
  /**
   * Validates that a skill can be extracted from a task.
   * Checks for minimum requirements.
   * 
   * @param {Task} task - The task to validate
   * @returns {Object} Validation result with isValid and reason
   */
  validateTaskForExtraction(task) {
    if (!task || typeof task !== 'object') {
      return { isValid: false, reason: 'Task must be an object' };
    }
    
    if (task.status !== 'completed') {
      return { isValid: false, reason: 'Task must have status "completed"' };
    }
    
    if (!task.objective || typeof task.objective !== 'string') {
      return { isValid: false, reason: 'Task must have a string objective' };
    }
    
    if (!task.steps || !Array.isArray(task.steps) || task.steps.length === 0) {
      return { isValid: false, reason: 'Task must have at least one step' };
    }
    
    return { isValid: true, reason: null };
  }
}

module.exports = { SkillExtractor };
