/**
 * Prompts Controller
 * Manages system prompts and templates
 */

const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');

class PromptsController {
  constructor() {
    this.prompts = new Map();
    this.promptsDir = path.join(__dirname, '../../../config/prompts');
    this.loadDefaultPrompts();
  }

  async loadDefaultPrompts() {
    const defaultPrompts = [
      {
        id: 'system-default',
        name: 'System Default',
        description: 'Default system prompt for general tasks',
        content: `You are a helpful AI assistant. You have access to various tools and can execute complex tasks.

When given a task:
1. Analyze the requirements carefully
2. Use available tools when appropriate
3. Provide clear, concise responses
4. Ask for clarification if needed

Always be helpful, accurate, and efficient.`,
        variables: [],
        isDefault: true,
        category: 'system',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'code-assistant',
        name: 'Code Assistant',
        description: 'Optimized for code generation and debugging',
        content: `You are an expert software developer. Your task is to write clean, efficient, and well-documented code.

Guidelines:
- Write code that follows best practices
- Include comments for complex logic
- Handle edge cases appropriately
- Use modern language features when beneficial
- Consider performance implications

Language: {{language}}
Framework: {{framework}}`,
        variables: ['language', 'framework'],
        isDefault: false,
        category: 'coding',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'document-writer',
        name: 'Document Writer',
        description: 'For creating documentation and structured content',
        content: `You are a technical writer. Create clear, well-structured documentation.

Structure:
- Use appropriate headings
- Include table of contents for long documents
- Use code blocks for technical content
- Add examples where helpful

Document Type: {{docType}}
Target Audience: {{audience}}`,
        variables: ['docType', 'audience'],
        isDefault: false,
        category: 'writing',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'data-analyst',
        name: 'Data Analyst',
        description: 'For data analysis and insights',
        content: `You are a data analyst. Analyze data carefully and provide actionable insights.

Approach:
1. Examine data structure and patterns
2. Identify trends and anomalies
3. Calculate relevant statistics
4. Provide clear interpretations
5. Suggest next steps or recommendations

Data Context: {{context}}
Analysis Goal: {{goal}}`,
        variables: ['context', 'goal'],
        isDefault: false,
        category: 'analysis',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'planner',
        name: 'Task Planner',
        description: 'For breaking down complex tasks',
        content: `You are a project planner. Break down complex tasks into actionable steps.

Process:
1. Identify the main objective
2. Break into logical sub-tasks
3. Estimate effort for each step
4. Identify dependencies
5. Suggest execution order

Task: {{task}}
Constraints: {{constraints}}`,
        variables: ['task', 'constraints'],
        isDefault: false,
        category: 'planning',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    defaultPrompts.forEach(prompt => {
      this.prompts.set(prompt.id, prompt);
    });
  }

  /**
   * Get all prompts
   */
  async getAll(req, res) {
    try {
      const { category, search } = req.query;
      
      let prompts = Array.from(this.prompts.values());

      if (category && category !== 'all') {
        prompts = prompts.filter(p => p.category === category);
      }

      if (search) {
        const searchLower = search.toLowerCase();
        prompts = prompts.filter(p => 
          p.name.toLowerCase().includes(searchLower) ||
          p.description.toLowerCase().includes(searchLower) ||
          p.content.toLowerCase().includes(searchLower)
        );
      }

      res.json({
        success: true,
        data: prompts.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      });
    } catch (error) {
      console.error('Error getting prompts:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get prompt by ID
   */
  async getById(req, res) {
    try {
      const { id } = req.params;
      const prompt = this.prompts.get(id);

      if (!prompt) {
        return res.status(404).json({ success: false, error: 'Prompt not found' });
      }

      res.json({ success: true, data: prompt });
    } catch (error) {
      console.error('Error getting prompt:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Create new prompt
   */
  async create(req, res) {
    try {
      const { name, description, content, variables = [], category = 'custom' } = req.body;

      if (!name || !content) {
        return res.status(400).json({ 
          success: false, 
          error: 'Name and content are required' 
        });
      }

      const prompt = {
        id: uuidv4(),
        name,
        description,
        content,
        variables,
        category,
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      this.prompts.set(prompt.id, prompt);

      res.status(201).json({ success: true, data: prompt });
    } catch (error) {
      console.error('Error creating prompt:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Update prompt
   */
  async update(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;

      const prompt = this.prompts.get(id);
      if (!prompt) {
        return res.status(404).json({ success: false, error: 'Prompt not found' });
      }

      if (prompt.isDefault && updates.content) {
        // Create a copy instead of modifying default
        const newPrompt = {
          ...prompt,
          id: uuidv4(),
          name: updates.name || prompt.name,
          description: updates.description || prompt.description,
          content: updates.content,
          variables: updates.variables || prompt.variables,
          category: updates.category || prompt.category,
          isDefault: false,
          updatedAt: new Date().toISOString()
        };
        this.prompts.set(newPrompt.id, newPrompt);
        return res.json({ success: true, data: newPrompt });
      }

      const updated = {
        ...prompt,
        ...updates,
        updatedAt: new Date().toISOString()
      };

      this.prompts.set(id, updated);

      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error updating prompt:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Delete prompt
   */
  async remove(req, res) {
    try {
      const { id } = req.params;
      const prompt = this.prompts.get(id);

      if (!prompt) {
        return res.status(404).json({ success: false, error: 'Prompt not found' });
      }

      if (prompt.isDefault) {
        return res.status(400).json({ 
          success: false, 
          error: 'Cannot delete default prompts' 
        });
      }

      this.prompts.delete(id);

      res.json({ success: true, data: { id, deleted: true } });
    } catch (error) {
      console.error('Error deleting prompt:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Test prompt with variables
   */
  async test(req, res) {
    try {
      const { id } = req.params;
      const { variables = {} } = req.body;

      const prompt = this.prompts.get(id);
      if (!prompt) {
        return res.status(404).json({ success: false, error: 'Prompt not found' });
      }

      // Replace variables
      let content = prompt.content;
      Object.entries(variables).forEach(([key, value]) => {
        content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
      });

      // Count characters and tokens (approximation)
      const charCount = content.length;
      const tokenCount = Math.ceil(charCount / 4);

      res.json({
        success: true,
        data: {
          original: prompt.content,
          rendered: content,
          variables: prompt.variables,
          provided: variables,
          missing: prompt.variables.filter(v => !variables[v]),
          stats: {
            characters: charCount,
            tokens: tokenCount,
            lines: content.split('\n').length
          }
        }
      });
    } catch (error) {
      console.error('Error testing prompt:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new PromptsController();
