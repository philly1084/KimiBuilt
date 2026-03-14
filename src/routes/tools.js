/**
 * Tools API - For Frontend Tool Discovery
 * Allows frontends to query and invoke available tools
 */

const express = require('express');
const router = express.Router();
const { getUnifiedRegistry } = require('../agent-sdk/registry/UnifiedRegistry');
const { getToolManager } = require('../agent-sdk/tools');

const registry = getUnifiedRegistry();

async function ensureToolManagerInitialized() {
  const toolManager = getToolManager();
  await toolManager.initialize();
  return toolManager;
}

/**
 * GET /api/tools/available
 * Get all tools available to frontends
 */
router.get('/available', async (req, res) => {
  try {
    await ensureToolManagerInitialized();
    const { category } = req.query;
    
    let tools = registry.getFrontendTools();
    
    if (category && category !== 'all') {
      tools = tools.filter(t => t.category === category);
    }
    
    res.json({
      success: true,
      data: tools,
      meta: {
        total: tools.length,
        categories: [...new Set(tools.map(t => t.category))]
      }
    });
  } catch (error) {
    console.error('Error getting available tools:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/tools/categories
 * Get tool categories with counts
 */
router.get('/categories', async (req, res) => {
  try {
    await ensureToolManagerInitialized();
    const categories = registry.getCategories();
    const tools = registry.getFrontendTools();
    
    const result = categories.map(cat => ({
      id: cat,
      name: cat.charAt(0).toUpperCase() + cat.slice(1),
      count: tools.filter(t => t.category === cat).length,
      icon: getCategoryIcon(cat)
    }));
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error getting categories:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/tools/stats
 * Get tool usage statistics
 */
router.get('/stats', async (req, res) => {
  try {
    await ensureToolManagerInitialized();
    const stats = registry.getAllSkills().map(skill => ({
      id: skill.id,
      name: skill.name,
      category: skill.category,
      invocations: skill.stats?.invocations || 0,
      successRate: skill.stats?.successRate || 100,
      avgDuration: skill.stats?.avgDuration || 0,
      lastUsed: skill.stats?.lastUsed
    }));
    
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error getting tool stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/tools/:id
 * Get tool details
 */
router.get('/:id', async (req, res) => {
  try {
    await ensureToolManagerInitialized();
    const { id } = req.params;
    
    const tool = registry.getTool(id);
    const manifest = registry.getManifest(id);
    const skill = registry.getSkill(id);
    
    if (!tool) {
      return res.status(404).json({ success: false, error: 'Tool not found' });
    }
    
    res.json({
      success: true,
      data: {
        id: tool.id,
        name: tool.name,
        description: tool.description,
        category: tool.category,
        version: tool.version,
        manifest,
        skill: skill ? {
          enabled: skill.enabled,
          triggerPatterns: skill.triggerPatterns,
          requiresConfirmation: skill.requiresConfirmation
        } : null,
        parameters: manifest?.parameters || []
      }
    });
  } catch (error) {
    console.error('Error getting tool:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/tools/invoke
 * Invoke a tool
 */
router.post('/invoke', async (req, res) => {
  try {
    const { tool: toolId, params = {}, sessionId } = req.body;
    
    if (!toolId) {
      return res.status(400).json({ success: false, error: 'Tool ID is required' });
    }
    
    const toolManager = await ensureToolManagerInitialized();
    
    const result = await toolManager.executeTool(toolId, params, {
      sessionId,
      userId: req.user?.id,
      timestamp: new Date().toISOString()
    });
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error invoking tool:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/tools/invoke/:id
 * Invoke a specific tool
 */
router.post('/invoke/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const params = req.body;
    
    const toolManager = await ensureToolManagerInitialized();
    
    const result = await toolManager.executeTool(id, params, {
      sessionId: req.body.sessionId,
      userId: req.user?.id
    });
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error invoking tool:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper functions

function getCategoryIcon(category) {
  const icons = {
    web: 'globe',
    ssh: 'terminal',
    design: 'pen-tool',
    sandbox: 'shield',
    database: 'database',
    system: 'settings'
  };
  return icons[category] || 'tool';
}

module.exports = router;
