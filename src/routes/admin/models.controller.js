/**
 * Models Controller
 * Manages AI model configurations
 */

class ModelsController {
  constructor() {
    this.models = new Map();
    this.loadDefaultModels();
  }

  loadDefaultModels() {
    const defaultModels = [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        provider: 'openai',
        description: 'Most capable multimodal model',
        config: {
          temperature: 0.7,
          maxTokens: 4096,
          topP: 1,
          frequencyPenalty: 0,
          presencePenalty: 0
        },
        isDefault: true,
        isActive: true,
        capabilities: ['chat', 'vision', 'tools', 'json'],
        pricing: { input: 2.50, output: 10.00 },
        contextWindow: 128000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        provider: 'openai',
        description: 'Fast, cost-effective model',
        config: {
          temperature: 0.7,
          maxTokens: 4096,
          topP: 1,
          frequencyPenalty: 0,
          presencePenalty: 0
        },
        isDefault: false,
        isActive: true,
        capabilities: ['chat', 'vision', 'tools', 'json'],
        pricing: { input: 0.15, output: 0.60 },
        contextWindow: 128000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'o1-preview',
        name: 'o1 Preview',
        provider: 'openai',
        description: 'Reasoning model for complex tasks',
        config: {
          temperature: 1,
          maxTokens: 32768,
          topP: 1,
          frequencyPenalty: 0,
          presencePenalty: 0
        },
        isDefault: false,
        isActive: false,
        capabilities: ['chat', 'reasoning'],
        pricing: { input: 15.00, output: 60.00 },
        contextWindow: 128000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'o3-mini',
        name: 'o3 Mini',
        provider: 'openai',
        description: 'Fast reasoning model',
        config: {
          temperature: 1,
          maxTokens: 100000,
          topP: 1,
          frequencyPenalty: 0,
          presencePenalty: 0
        },
        isDefault: false,
        isActive: false,
        capabilities: ['chat', 'reasoning', 'tools'],
        pricing: { input: 1.10, output: 4.40 },
        contextWindow: 200000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'claude-3-opus',
        name: 'Claude 3 Opus',
        provider: 'anthropic',
        description: 'Most capable Claude model',
        config: {
          temperature: 0.7,
          maxTokens: 4096,
          topP: 1,
          frequencyPenalty: 0,
          presencePenalty: 0
        },
        isDefault: false,
        isActive: false,
        capabilities: ['chat', 'vision', 'tools'],
        pricing: { input: 15.00, output: 75.00 },
        contextWindow: 200000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'claude-3-sonnet',
        name: 'Claude 3 Sonnet',
        provider: 'anthropic',
        description: 'Balanced performance and cost',
        config: {
          temperature: 0.7,
          maxTokens: 4096,
          topP: 1,
          frequencyPenalty: 0,
          presencePenalty: 0
        },
        isDefault: false,
        isActive: false,
        capabilities: ['chat', 'vision', 'tools'],
        pricing: { input: 3.00, output: 15.00 },
        contextWindow: 200000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    defaultModels.forEach(model => {
      this.models.set(model.id, model);
    });
  }

  /**
   * Get all models
   */
  async getAll(req, res) {
    try {
      const models = Array.from(this.models.values())
        .sort((a, b) => {
          if (a.isDefault) return -1;
          if (b.isDefault) return 1;
          return 0;
        });

      res.json({ success: true, data: models });
    } catch (error) {
      console.error('Error getting models:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get model by ID
   */
  async getById(req, res) {
    try {
      const { id } = req.params;
      const model = this.models.get(id);

      if (!model) {
        return res.status(404).json({ success: false, error: 'Model not found' });
      }

      res.json({ success: true, data: model });
    } catch (error) {
      console.error('Error getting model:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Update model configuration
   */
  async update(req, res) {
    try {
      const { id } = req.params;
      const { config, isActive, description } = req.body;

      const model = this.models.get(id);
      if (!model) {
        return res.status(404).json({ success: false, error: 'Model not found' });
      }

      const updated = {
        ...model,
        updatedAt: new Date().toISOString()
      };

      if (config) {
        updated.config = { ...model.config, ...config };
      }

      if (typeof isActive === 'boolean') {
        updated.isActive = isActive;
      }

      if (description) {
        updated.description = description;
      }

      this.models.set(id, updated);

      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error updating model:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Set as default model
   */
  async activate(req, res) {
    try {
      const { id } = req.params;
      
      const model = this.models.get(id);
      if (!model) {
        return res.status(404).json({ success: false, error: 'Model not found' });
      }

      // Remove default from others
      this.models.forEach(m => {
        m.isDefault = false;
      });

      model.isDefault = true;
      model.isActive = true;
      model.updatedAt = new Date().toISOString();

      res.json({ success: true, data: model });
    } catch (error) {
      console.error('Error activating model:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get model usage statistics
   */
  async getUsageStats(req, res) {
    try {
      // This would typically aggregate from actual usage data
      // For now, return mock stats based on configured models
      const stats = Array.from(this.models.values()).map(model => ({
        modelId: model.id,
        modelName: model.name,
        requests: Math.floor(Math.random() * 1000),
        tokens: {
          input: Math.floor(Math.random() * 100000),
          output: Math.floor(Math.random() * 50000)
        },
        cost: {
          input: 0,
          output: 0,
          total: 0
        },
        avgResponseTime: Math.floor(Math.random() * 3000) + 500,
        successRate: Math.floor(Math.random() * 20) + 80
      }));

      // Calculate costs
      stats.forEach(stat => {
        const model = this.models.get(stat.modelId);
        if (model) {
          stat.cost.input = (stat.tokens.input / 1000000) * model.pricing.input;
          stat.cost.output = (stat.tokens.output / 1000000) * model.pricing.output;
          stat.cost.total = stat.cost.input + stat.cost.output;
        }
      });

      res.json({ success: true, data: stats });
    } catch (error) {
      console.error('Error getting usage stats:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new ModelsController();
