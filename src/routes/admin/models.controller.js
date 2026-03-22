/**
 * Models Controller
 * Exposes live model inventory from the configured OpenAI-compatible endpoint.
 */

const { listModels } = require('../../openai-client');
const settingsController = require('./settings.controller');
const logsController = require('./logs.controller');

const EXCLUDED_MODEL_TOKENS = [
  'embed',
  'embedding',
  'image',
  'tts',
  'transcribe',
  'audio',
  'realtime',
  'moderation',
  'omni-moderation',
  'whisper',
];

class ModelsController {
  async getAll(req, res) {
    try {
      const models = await this.getLiveModels();
      res.json({
        success: true,
        data: models,
        meta: {
          source: 'live-provider',
          count: models.length,
        },
      });
    } catch (error) {
      console.error('Error getting models:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getById(req, res) {
    try {
      const { id } = req.params;
      const model = (await this.getLiveModels()).find((entry) => entry.id === id);

      if (!model) {
        return res.status(404).json({ success: false, error: 'Model not found' });
      }

      res.json({ success: true, data: model });
    } catch (error) {
      console.error('Error getting model:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      const { config, isActive, description } = req.body;

      const model = (await this.getLiveModels()).find((entry) => entry.id === id);
      if (!model) {
        return res.status(404).json({ success: false, error: 'Model not found' });
      }

      const settings = this.ensureModelSettings();
      const catalog = settings.catalog || {};
      const existing = catalog[id] || {};

      catalog[id] = {
        ...existing,
        ...(config ? { config: { ...(existing.config || {}), ...config } } : {}),
        ...(typeof isActive === 'boolean' ? { isActive } : {}),
        ...(typeof description === 'string' ? { description } : {}),
        updatedAt: new Date().toISOString(),
      };

      settings.catalog = catalog;
      await settingsController.saveSettings();

      const updated = (await this.getLiveModels()).find((entry) => entry.id === id);
      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error updating model:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async activate(req, res) {
    try {
      const { id } = req.params;
      const model = (await this.getLiveModels()).find((entry) => entry.id === id);

      if (!model) {
        return res.status(404).json({ success: false, error: 'Model not found' });
      }

      const settings = this.ensureModelSettings();
      settings.defaultModel = id;
      settings.catalog = {
        ...(settings.catalog || {}),
        [id]: {
          ...(settings.catalog?.[id] || {}),
          isActive: true,
          updatedAt: new Date().toISOString(),
        },
      };

      await settingsController.saveSettings();

      const updated = (await this.getLiveModels()).find((entry) => entry.id === id);
      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error activating model:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getUsageStats(req, res) {
    try {
      const models = await this.getLiveModels();
      const usage = this.buildUsageStats(models);
      const summary = this.buildUsageSummary(usage);
      res.json({
        success: true,
        data: usage,
        meta: {
          source: 'runtime-logs',
          count: usage.length,
          summary,
          providerTotals: summary.providerTotals,
        },
      });
    } catch (error) {
      console.error('Error getting usage stats:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getLiveModels() {
    const providerModels = await listModels();
    const settings = this.ensureModelSettings();
    const catalog = settings.catalog || {};

    return providerModels
      .filter((model) => this.isUsableChatModel(model))
      .map((model) => this.normalizeLiveModel(model, settings, catalog[model.id] || {}))
      .sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        if (a.isFallback !== b.isFallback) return a.isFallback ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  isUsableChatModel(model = {}) {
    const id = String(model.id || '').toLowerCase();
    if (!id) return false;
    return !EXCLUDED_MODEL_TOKENS.some((token) => id.includes(token));
  }

  normalizeLiveModel(model = {}, settings = {}, override = {}) {
    const id = String(model.id || '').trim();
    const lowerId = id.toLowerCase();
    const provider = model.owned_by || 'unknown';
    const mergedConfig = {
      temperature: settings.temperature ?? 0.7,
      maxTokens: settings.maxTokens ?? 4096,
      topP: settings.topP ?? 1,
      frequencyPenalty: settings.frequencyPenalty ?? 0,
      presencePenalty: settings.presencePenalty ?? 0,
      ...(override.config || {}),
    };

    return {
      id,
      name: this.humanizeModelName(id),
      provider,
      description: override.description || `Live model exposed by ${provider}`,
      config: mergedConfig,
      isDefault: id === settings.defaultModel,
      isFallback: id === settings.fallbackModel,
      isActive: typeof override.isActive === 'boolean'
        ? override.isActive
        : id === settings.defaultModel || id === settings.fallbackModel,
      capabilities: this.inferCapabilities(lowerId),
      pricing: override.pricing || null,
      contextWindow: override.contextWindow || null,
      createdAt: model.created ? new Date(model.created * 1000).toISOString() : null,
      updatedAt: override.updatedAt || null,
      raw: {
        object: model.object || 'model',
        owned_by: provider,
      },
    };
  }

  inferCapabilities(modelId = '') {
    const capabilities = ['chat'];

    if (/(4o|vision|omni|gemini|claude-3|claude-4)/.test(modelId)) {
      capabilities.push('vision');
    }
    if (/(tool|function|4o|o3|o4|claude|gemini)/.test(modelId)) {
      capabilities.push('tools');
    }
    if (/^(o1|o3|o4)|reason/.test(modelId)) {
      capabilities.push('reasoning');
    }
    if (/(json|4o|o3|o4|gpt-5)/.test(modelId)) {
      capabilities.push('json');
    }

    return [...new Set(capabilities)];
  }

  humanizeModelName(id = '') {
    return String(id)
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  buildUsageStats(models = []) {
    const usageByModel = new Map();

    for (const log of logsController.logs || []) {
      const modelId = String(log.model || '').trim();
      if (!modelId) continue;

      const current = usageByModel.get(modelId) || {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalLatency: 0,
        successCount: 0,
      };

      current.requests += 1;
      current.totalLatency += Number(log.latency || log.duration || 0);
      current.inputTokens += Number(log.promptTokens || 0);
      current.outputTokens += Number(log.completionTokens || log.tokens || 0);
      current.successCount += log.status === 'error' ? 0 : 1;
      usageByModel.set(modelId, current);
    }

    return models.map((model) => {
      const usage = usageByModel.get(model.id) || {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalLatency: 0,
        successCount: 0,
      };

      return {
        modelId: model.id,
        modelName: model.name,
        provider: model.provider || model.raw?.owned_by || 'unknown',
        requests: usage.requests,
        tokens: {
          input: usage.inputTokens,
          output: usage.outputTokens,
          total: usage.inputTokens + usage.outputTokens,
        },
        cost: {
          input: 0,
          output: 0,
          total: 0,
        },
        avgResponseTime: usage.requests > 0 ? Math.round(usage.totalLatency / usage.requests) : 0,
        successRate: usage.requests > 0 ? Math.round((usage.successCount / usage.requests) * 100) : 0,
        isDefault: model.isDefault,
      };
    });
  }

  buildUsageSummary(usage = []) {
    const summary = {
      totalRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      providerTotals: [],
    };
    const providerMap = new Map();

    for (const entry of usage) {
      const input = Number(entry.tokens?.input || 0);
      const output = Number(entry.tokens?.output || 0);
      const total = Number(entry.tokens?.total || (input + output));
      const requests = Number(entry.requests || 0);
      const provider = String(entry.provider || 'unknown');

      if (requests <= 0 && total <= 0) {
        continue;
      }

      summary.totalRequests += requests;
      summary.totalInputTokens += input;
      summary.totalOutputTokens += output;
      summary.totalTokens += total;

      const current = providerMap.get(provider) || {
        provider,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        modelCount: 0,
      };

      current.requests += requests;
      current.inputTokens += input;
      current.outputTokens += output;
      current.totalTokens += total;
      current.modelCount += 1;
      providerMap.set(provider, current);
    }

    summary.providerTotals = Array.from(providerMap.values())
      .sort((a, b) => b.totalTokens - a.totalTokens || b.requests - a.requests || a.provider.localeCompare(b.provider));

    return summary;
  }

  ensureModelSettings() {
    if (!settingsController.settings.models) {
      settingsController.settings.models = {};
    }
    if (!settingsController.settings.models.catalog) {
      settingsController.settings.models.catalog = {};
    }
    return settingsController.settings.models;
  }
}

module.exports = new ModelsController();
