/**
 * Skills Controller
 * Manages skills via the Unified Registry
 * Skills are automatically created when tools are registered
 */

const { getUnifiedRegistry } = require('../../agent-sdk/registry/UnifiedRegistry');
const { getToolManager } = require('../../agent-sdk/tools');

class SkillsController {
  constructor() {
    this.registry = getUnifiedRegistry();
  }

  async ensureInitialized() {
    const toolManager = getToolManager();
    await toolManager.initialize();
    return toolManager;
  }

  /**
   * Get all skills from unified registry
   */
  async getAll(req, res) {
    try {
      await this.ensureInitialized();
      const { category = 'all', status = 'all', search = '' } = req.query;

      // Get skills from unified registry
      let skills = this.registry.getAllSkills();

      // Apply category filter
      if (category && category !== 'all') {
        skills = skills.filter(s => s.category === category);
      }

      // Apply status filter
      if (status === 'enabled') {
        skills = skills.filter(s => s.enabled);
      } else if (status === 'disabled') {
        skills = skills.filter(s => !s.enabled);
      }

      // Apply search filter
      if (search) {
        const searchLower = search.toLowerCase();
        skills = skills.filter(s =>
          s.name.toLowerCase().includes(searchLower) ||
          s.description.toLowerCase().includes(searchLower) ||
          s.category.toLowerCase().includes(searchLower) ||
          s.triggerPatterns?.some(p => p.toLowerCase().includes(searchLower))
        );
      }

      // Sort by usage count
      skills.sort((a, b) => (b.stats?.usageCount || 0) - (a.stats?.usageCount || 0));

      res.json({
        success: true,
        data: skills,
        meta: {
          total: skills.length,
          categories: this.registry.getCategories(),
          byCategory: this.getStatsByCategory(skills)
        }
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
      await this.ensureInitialized();
      const { id } = req.params;
      const skill = this.registry.getSkill(id);

      if (!skill) {
        return res.status(404).json({ success: false, error: 'Skill not found' });
      }

      // Add tool details
      const tool = this.registry.getTool(id);
      const manifest = this.registry.getManifest(id);
      const stats = this.registry.getStats(id);

      res.json({
        success: true,
        data: {
          ...skill,
          tool: tool ? {
            sideEffects: tool.backend?.sideEffects,
            sandbox: tool.backend?.sandbox,
            timeout: tool.backend?.timeout
          } : null,
          manifest: manifest || null,
          stats: stats || null
        }
      });
    } catch (error) {
      console.error('Error getting skill:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Update skill configuration
   */
  async update(req, res) {
    try {
      await this.ensureInitialized();
      const { id } = req.params;
      const updates = req.body;

      const skill = this.registry.getSkill(id);
      if (!skill) {
        return res.status(404).json({ success: false, error: 'Skill not found' });
      }

      // Update via registry
      const updated = this.registry.updateSkillConfig(id, updates);

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
      await this.ensureInitialized();
      const { id } = req.params;
      
      const success = this.registry.setSkillEnabled(id, true);
      if (!success) {
        return res.status(404).json({ success: false, error: 'Skill not found' });
      }

      const skill = this.registry.getSkill(id);
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
      await this.ensureInitialized();
      const { id } = req.params;
      
      const success = this.registry.setSkillEnabled(id, false);
      if (!success) {
        return res.status(404).json({ success: false, error: 'Skill not found' });
      }

      const skill = this.registry.getSkill(id);
      res.json({ success: true, data: skill });
    } catch (error) {
      console.error('Error disabling skill:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Delete skill (unregisters tool)
   */
  async remove(req, res) {
    try {
      await this.ensureInitialized();
      const { id } = req.params;

      if (!this.registry.getSkill(id)) {
        return res.status(404).json({ success: false, error: 'Skill not found' });
      }

      // Unregister the tool (removes skill, tool, and manifest)
      this.registry.unregister(id);

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
      await this.ensureInitialized();
      const { q } = req.query;

      if (!q) {
        return res.json({ success: true, data: [] });
      }

      const results = this.registry.search(q);

      res.json({
        success: true,
        data: {
          skills: results.skills,
          tools: results.tools
        }
      });
    } catch (error) {
      console.error('Error searching skills:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get tool categories
   */
  async getCategories(req, res) {
    try {
      await this.ensureInitialized();
      const categories = this.registry.getCategories();
      
      // Add counts
      const categoriesWithCounts = categories.map(cat => ({
        name: cat,
        count: this.registry.getSkillsByCategory(cat).length
      }));

      res.json({
        success: true,
        data: categoriesWithCounts
      });
    } catch (error) {
      console.error('Error getting categories:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get registry statistics
   */
  async getStats(req, res) {
    try {
      await this.ensureInitialized();
      const skills = this.registry.getAllSkills();
      
      res.json({
        success: true,
        data: {
          total: skills.length,
          enabled: skills.filter(s => s.enabled).length,
          disabled: skills.filter(s => !s.enabled).length,
          byCategory: this.getStatsByCategory(skills),
          totalInvocations: skills.reduce((sum, s) => sum + (s.stats?.usageCount || 0), 0)
        }
      });
    } catch (error) {
      console.error('Error getting stats:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Execute a skill (invoke its tool)
   */
  async execute(req, res) {
    try {
      const toolManager = await this.ensureInitialized();
      const { id } = req.params;
      const params = req.body;

      const skill = this.registry.getSkill(id);
      if (!skill) {
        return res.status(404).json({ success: false, error: 'Skill not found' });
      }

      if (!skill.enabled) {
        return res.status(400).json({ success: false, error: 'Skill is disabled' });
      }

      // Get tool manager and execute
      const result = await toolManager.executeTool(id, params, {
        sessionId: req.body.sessionId,
        userId: req.user?.id
      });

      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error executing skill:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // Helper methods

  getStatsByCategory(skills) {
    const byCategory = {};
    
    skills.forEach(skill => {
      const cat = skill.category || 'uncategorized';
      if (!byCategory[cat]) {
        byCategory[cat] = { count: 0, enabled: 0 };
      }
      byCategory[cat].count++;
      if (skill.enabled) {
        byCategory[cat].enabled++;
      }
    });

    return byCategory;
  }
}

module.exports = new SkillsController();
