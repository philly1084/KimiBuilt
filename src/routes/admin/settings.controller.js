/**
 * Settings Controller
 * Manages system settings and configuration
 */

const fs = require('fs').promises;
const path = require('path');

class SettingsController {
  constructor() {
    this.settings = {
      general: {
        appName: 'KimiBuilt Agent SDK',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        dateFormat: 'YYYY-MM-DD HH:mm:ss',
        dataRetention: 30, // days
        maxTasks: 10000,
        maxStorage: '1GB'
      },
      features: {
        enableTracing: true,
        enableSkills: true,
        enableDebug: false,
        autoSave: true,
        realTimeUpdates: true
      },
      api: {
        baseURL: process.env.API_BASE_URL || 'http://localhost:3000',
        timeout: 30000,
        maxRetries: 3,
        retryDelay: 1000,
        enableCORS: true,
        allowedOrigins: ['http://localhost:3000', 'http://localhost:8080']
      },
      models: {
        defaultModel: 'gpt-4o',
        fallbackModel: 'gpt-4o-mini',
        maxTokens: 4096,
        temperature: 0.7
      },
      notifications: {
        enableEmail: false,
        enableWebhook: false,
        webhookURL: '',
        emailRecipients: [],
        notifyOnError: true,
        notifyOnSuccess: false
      },
      security: {
        requireAuth: false,
        apiKeyRequired: false,
        rateLimiting: true,
        rateLimit: 100, // requests per minute
        allowedIPs: []
      }
    };

    this.loadSettings().catch((error) => {
      console.warn('[Settings] Using default dashboard settings:', error.message);
    });
  }

  /**
   * Get all settings
   */
  async getAll(req, res) {
    try {
      res.json({
        success: true,
        data: this.settings
      });
    } catch (error) {
      console.error('Error getting settings:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Update settings
   */
  async update(req, res) {
    try {
      const updates = req.body;

      // Deep merge settings
      this.settings = this.deepMerge(this.settings, updates);

      // Save to file (optional persistence)
      await this.saveSettings();

      res.json({
        success: true,
        data: this.settings,
        message: 'Settings updated successfully'
      });
    } catch (error) {
      console.error('Error updating settings:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Reset settings to defaults
   */
  async reset(req, res) {
    try {
      const { section } = req.body;

      if (section && this.settings[section]) {
        // Reset specific section
        this.settings[section] = this.getDefaultSettings()[section];
      } else {
        // Reset all
        this.settings = this.getDefaultSettings();
      }

      await this.saveSettings();

      res.json({
        success: true,
        data: this.settings,
        message: section ? `${section} settings reset` : 'All settings reset'
      });
    } catch (error) {
      console.error('Error resetting settings:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Clear system cache
   */
  async clearCache(req, res) {
    try {
      // Clear various caches
      const cleared = {
        tasks: 0,
        sessions: 0,
        logs: 0,
        traces: 0
      };

      // This would integrate with actual cache clearing logic
      // For now, just return success

      res.json({
        success: true,
        data: {
          cleared,
          timestamp: new Date().toISOString()
        },
        message: 'Cache cleared successfully'
      });
    } catch (error) {
      console.error('Error clearing cache:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Deep merge objects
   */
  deepMerge(target, source) {
    const result = { ...target };

    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
          result[key] = this.deepMerge(result[key] || {}, source[key]);
        } else {
          result[key] = source[key];
        }
      }
    }

    return result;
  }

  /**
   * Save settings to file
   */
  async saveSettings() {
    try {
      const configDir = path.join(__dirname, '../../../config');
      await fs.mkdir(configDir, { recursive: true });
      
      const settingsPath = path.join(configDir, 'dashboard-settings.json');
      await fs.writeFile(settingsPath, JSON.stringify(this.settings, null, 2));
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }

  /**
   * Load settings from file
   */
  async loadSettings() {
    try {
      const settingsPath = path.join(__dirname, '../../../config/dashboard-settings.json');
      const data = await fs.readFile(settingsPath, 'utf8');
      this.settings = JSON.parse(data);
    } catch (error) {
      // Use defaults if file doesn't exist
      console.log('Using default settings');
    }
  }

  /**
   * Get default settings
   */
  getDefaultSettings() {
    return {
      general: {
        appName: 'KimiBuilt Agent SDK',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        dateFormat: 'YYYY-MM-DD HH:mm:ss',
        dataRetention: 30,
        maxTasks: 10000,
        maxStorage: '1GB'
      },
      features: {
        enableTracing: true,
        enableSkills: true,
        enableDebug: false,
        autoSave: true,
        realTimeUpdates: true
      },
      api: {
        baseURL: 'http://localhost:3000',
        timeout: 30000,
        maxRetries: 3,
        retryDelay: 1000,
        enableCORS: true,
        allowedOrigins: ['http://localhost:3000']
      },
      models: {
        defaultModel: 'gpt-4o',
        fallbackModel: 'gpt-4o-mini',
        maxTokens: 4096,
        temperature: 0.7
      },
      notifications: {
        enableEmail: false,
        enableWebhook: false,
        webhookURL: '',
        emailRecipients: [],
        notifyOnError: true,
        notifyOnSuccess: false
      },
      security: {
        requireAuth: false,
        apiKeyRequired: false,
        rateLimiting: true,
        rateLimit: 100,
        allowedIPs: []
      }
    };
  }
}

module.exports = new SettingsController();
