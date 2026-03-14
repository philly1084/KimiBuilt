/**
 * Skills Controller
 * Manages learned/reusable skills
 */

const { v4: uuidv4 } = require('uuid');

class SkillsController {
  constructor() {
    this.skills = new Map();
    this.loadDefaultSkills();
  }

  loadDefaultSkills() {
    const defaultSkills = [
      {
        id: 'skill-1',
        name: 'Code Review Pattern',
        description: 'Reviews code for best practices and potential issues',
        category: 'coding',
        triggerPattern: 'review.*code|code.*review',
        implementation: {
          type: 'prompt',
          content: 'Review this code for:\n1. Best practices\n2. Potential bugs\n3. Performance issues\n4. Security concerns\n\nCode:\n{{code}}'
        },
        stats: {
          usageCount: 156,
          successRate: 94,
          avgExecutionTime: 2340
        },
        isEnabled: true,
        isLearned: true,
        sourceTask: 'task-abc-123',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'skill-2',
        name: 'Documentation Generator',
        description: 'Generates comprehensive documentation from code',
        category: 'writing',
        triggerPattern: 'document.*code|generate.*docs',
        implementation: {
          type: 'prompt',
          content: 'Generate documentation for this code:\n\n{{code}}\n\nInclude:\n- Function descriptions\n- Parameter explanations\n- Return value details\n- Usage examples'
        },
        stats: {
          usageCount: 89,
          successRate: 91,
          avgExecutionTime: 3450
        },
        isEnabled: true,
        isLearned: true,
        sourceTask: 'task-def-456',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'skill-3',
        name: 'API Endpoint Creator',
        description: 'Creates REST API endpoints with proper structure',
        category: 'coding',
        triggerPattern: 'create.*api|api.*endpoint',
        implementation: {
          type: 'prompt',
          content: 'Create a REST API endpoint for:\n\nRequirements: {{requirements}}\n\nInclude:\n- Route definition\n- Request validation\n- Response format\n- Error handling'
        },
        stats: {
          usageCount: 67,
          successRate: 88,
          avgExecutionTime: 2890
        },
        isEnabled: true,
        isLearned: true,
        sourceTask: 'task-ghi-789',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'skill-4',
        name: 'Data Analysis Report',
        description: 'Analyzes data and generates insights report',
        category: 'analysis',
        triggerPattern: 'analyze.*data|data.*analysis',
        implementation: {
          type: 'prompt',
          content: 'Analyze this data and provide insights:\n\nData: {{data}}\n\nInclude:\n- Key trends\n- Statistical summary\n- Anomalies\n- Recommendations'
        },
        stats: {
          usageCount: 45,
          successRate: 96,
          avgExecutionTime: 4120
        },
        isEnabled: false,
        isLearned: true,
        sourceTask: 'task-jkl-012',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    defaultSkills.forEach(skill => {
      this.skills.set(skill.id, skill);
    });
  }

  /**
   * Get all skills
   */
  async getAll(req, res) {
    try {
      const { category = 'all', status = 'all', search = '' } = req.query;

      let skills = Array.from(this.skills.values());

      if (category && category !== 'all') {
        skills = skills.filter(s => s.category === category);
      }

      if (status === 'enabled') {
        skills = skills.filter(s => s.isEnabled);
      } else if (status === 'disabled') {
        skills = skills.filter(s => !s.isEnabled);
      }

      if (search) {
        const searchLower = search.toLowerCase();
        skills = skills.filter(s =>
          s.name.toLowerCase().includes(searchLower) ||
          s.description.toLowerCase().includes(searchLower) ||
          s.category.toLowerCase().includes(searchLower)
        );
      }

      res.json({
        success: true,
        data: skills.sort((a, b) => b.stats.usageCount - a.stats.usageCount)
      });
    } catch (error) {
      console.error('Error getting skills:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get skill by ID
   */
  async getById(req, res) {
    try {
      const { id } = req.params;
      const skill = this.skills.get(id);

      if (!skill) {
        return res.status(404).json({ success: false, error: 'Skill not found' });
      }

      res.json({ success: true, data: skill });
    } catch (error) {
      console.error('Error getting skill:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Update skill
   */
  async update(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;

      const skill = this.skills.get(id);
      if (!skill) {
        return res.status(404).json({ success: false, error: 'Skill not found' });
      }

      const updated = {
        ...skill,
        ...updates,
        updatedAt: new Date().toISOString()
      };

      this.skills.set(id, updated);

      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error updating skill:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Enable skill
   */
  async enable(req, res) {
    try {
      const { id } = req.params;
      const skill = this.skills.get(id);

      if (!skill) {
        return res.status(404).json({ success: false, error: 'Skill not found' });
      }

      skill.isEnabled = true;
      skill.updatedAt = new Date().toISOString();

      res.json({ success: true, data: skill });
    } catch (error) {
      console.error('Error enabling skill:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Disable skill
   */
  async disable(req, res) {
    try {
      const { id } = req.params;
      const skill = this.skills.get(id);

      if (!skill) {
        return res.status(404).json({ success: false, error: 'Skill not found' });
      }

      skill.isEnabled = false;
      skill.updatedAt = new Date().toISOString();

      res.json({ success: true, data: skill });
    } catch (error) {
      console.error('Error disabling skill:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Delete skill
   */
  async remove(req, res) {
    try {
      const { id } = req.params;

      if (!this.skills.has(id)) {
        return res.status(404).json({ success: false, error: 'Skill not found' });
      }

      this.skills.delete(id);

      res.json({ success: true, data: { id, deleted: true } });
    } catch (error) {
      console.error('Error deleting skill:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Search skills
   */
  async search(req, res) {
    try {
      const { q } = req.query;

      if (!q) {
        return res.json({ success: true, data: [] });
      }

      const searchLower = q.toLowerCase();
      const results = Array.from(this.skills.values()).filter(skill =>
        skill.name.toLowerCase().includes(searchLower) ||
        skill.description.toLowerCase().includes(searchLower) ||
        skill.triggerPattern?.toLowerCase().includes(searchLower)
      );

      res.json({ success: true, data: results });
    } catch (error) {
      console.error('Error searching skills:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new SkillsController();
