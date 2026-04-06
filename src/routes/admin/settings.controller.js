/**
 * Settings Controller
 * Manages system settings and configuration
 */

const fs = require('fs').promises;
const path = require('path');
const { config } = require('../../config');
const {
  getEffectiveSoulConfig,
  resetSoulFile,
  writeSoulFile,
} = require('../../agent-soul');
const { resolvePreferredWritableFile } = require('../../runtime-state-paths');

const OPENCODE_OPAQUE_ENV_KEYS = ['GITHUB_TOKEN', 'GH_TOKEN'];

class SettingsController {
  constructor() {
    this.settings = {
      general: {
        appName: 'LillyBuilt Agent SDK',
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
      personality: {
        enabled: true,
        displayName: 'Agent Soul'
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
      },
      integrations: {
        ssh: {
          enabled: false,
          host: '',
          port: 22,
          username: '',
          password: '',
          privateKeyPath: '',
        },
        opencode: {
          enabled: config.opencode.enabled !== false,
          binaryPath: config.opencode.binaryPath || 'opencode',
          defaultAgent: config.opencode.defaultAgent || 'build',
          defaultModel: config.opencode.defaultModel || '',
          allowedWorkspaceRoots: [...(config.opencode.allowedWorkspaceRoots || [])],
          remoteDefaultWorkspace: config.opencode.remoteDefaultWorkspace || '',
          providerEnvAllowlist: [...(config.opencode.providerEnvAllowlist || [])],
          remoteAutoInstall: config.opencode.remoteAutoInstall === true,
        }
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
        data: this.getPublicSettings()
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
      const updates = JSON.parse(JSON.stringify(req.body || {}));
      this.applyPersonalityUpdate(updates);
      const normalizedUpdates = this.normalizeIncomingSettings(updates);

      // Deep merge settings
      this.settings = this.deepMerge(this.settings, normalizedUpdates);

      // Save to file (optional persistence)
      await this.saveSettings();

      res.json({
        success: true,
        data: this.getPublicSettings(),
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
        if (section === 'personality') {
          resetSoulFile();
        }
      } else {
        // Reset all
        this.settings = this.getDefaultSettings();
        resetSoulFile();
      }

      await this.saveSettings();

      res.json({
        success: true,
        data: this.getPublicSettings(),
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
      const settingsPath = this.getSettingsPath();
      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
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
      const settingsPath = this.getSettingsPath();
      const data = await fs.readFile(settingsPath, 'utf8');
      this.settings = this.deepMerge(this.getDefaultSettings(), JSON.parse(data));
    } catch (error) {
      // Use defaults if file doesn't exist
      if (process.env.NODE_ENV !== 'test') {
        console.log('Using default settings');
      }
    }
  }

  normalizeIncomingSettings(updates = {}) {
    const normalized = JSON.parse(JSON.stringify(updates || {}));
    const personalityUpdate = normalized.personality;

    if (personalityUpdate && typeof personalityUpdate === 'object') {
      const currentPersonality = this.settings?.personality || {};
      const nextPersonality = {
        ...personalityUpdate,
      };

      if (nextPersonality.enabled !== undefined) {
        nextPersonality.enabled = Boolean(nextPersonality.enabled);
      }

      if (nextPersonality.displayName !== undefined) {
        nextPersonality.displayName = String(nextPersonality.displayName || '').trim()
          || currentPersonality.displayName
          || 'Agent Soul';
      }

      delete nextPersonality.content;
      delete nextPersonality.defaultContent;
      delete nextPersonality.filePath;
      delete nextPersonality.absoluteFilePath;
      delete nextPersonality.updatedAt;
      delete nextPersonality.source;

      if (Object.keys(nextPersonality).length === 0) {
        delete normalized.personality;
      } else {
        normalized.personality = nextPersonality;
      }
    }
    const sshUpdate = normalized.integrations?.ssh;

    if (sshUpdate) {
      const currentSsh = this.settings?.integrations?.ssh || {};
      const nextSsh = {
        ...sshUpdate,
      };

      if (nextSsh.host !== undefined) {
        nextSsh.host = String(nextSsh.host || '').trim();
      }

      if (nextSsh.username !== undefined) {
        nextSsh.username = String(nextSsh.username || '').trim();
      }

      if (nextSsh.privateKeyPath !== undefined) {
        nextSsh.privateKeyPath = String(nextSsh.privateKeyPath || '').trim();
      }

      if (nextSsh.port !== undefined) {
        const parsedPort = parseInt(nextSsh.port, 10);
        nextSsh.port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : (currentSsh.port || 22);
      }

      if (nextSsh.enabled !== undefined) {
        nextSsh.enabled = Boolean(nextSsh.enabled);
      }

      const clearPassword = Boolean(nextSsh.clearPassword);
      delete nextSsh.clearPassword;
      delete nextSsh.hasPassword;
      delete nextSsh.source;
      delete nextSsh.configured;

      if (clearPassword) {
        nextSsh.password = '';
      } else if (nextSsh.password === undefined || nextSsh.password === null || nextSsh.password === '') {
        nextSsh.password = currentSsh.password || '';
      } else {
        nextSsh.password = String(nextSsh.password);
      }

      normalized.integrations = {
        ...(normalized.integrations || {}),
        ssh: nextSsh,
      };
    }

    const opencodeUpdate = normalized.integrations?.opencode;
    if (opencodeUpdate) {
      const currentOpencode = this.settings?.integrations?.opencode || {};
      const nextOpencode = {
        ...opencodeUpdate,
      };

      if (nextOpencode.enabled !== undefined) {
        nextOpencode.enabled = Boolean(nextOpencode.enabled);
      }
      if (nextOpencode.remoteAutoInstall !== undefined) {
        nextOpencode.remoteAutoInstall = Boolean(nextOpencode.remoteAutoInstall);
      }
      if (nextOpencode.binaryPath !== undefined) {
        nextOpencode.binaryPath = String(nextOpencode.binaryPath || '').trim() || currentOpencode.binaryPath || 'opencode';
      }
      if (nextOpencode.defaultAgent !== undefined) {
        nextOpencode.defaultAgent = String(nextOpencode.defaultAgent || '').trim().toLowerCase() || currentOpencode.defaultAgent || 'build';
      }
      if (nextOpencode.defaultModel !== undefined) {
        nextOpencode.defaultModel = String(nextOpencode.defaultModel || '').trim();
      }
      if (nextOpencode.remoteDefaultWorkspace !== undefined) {
        nextOpencode.remoteDefaultWorkspace = String(nextOpencode.remoteDefaultWorkspace || '').trim();
      }
      if (nextOpencode.allowedWorkspaceRoots !== undefined) {
        nextOpencode.allowedWorkspaceRoots = this.normalizeStringArray(
          nextOpencode.allowedWorkspaceRoots,
          currentOpencode.allowedWorkspaceRoots || [],
        );
      }
      if (nextOpencode.providerEnvAllowlist !== undefined) {
        nextOpencode.providerEnvAllowlist = this.normalizeStringArray(
          nextOpencode.providerEnvAllowlist,
          currentOpencode.providerEnvAllowlist || [],
        );
      }

      normalized.integrations = {
        ...(normalized.integrations || {}),
        opencode: nextOpencode,
      };
    }

    return normalized;
  }

  getPublicSettings() {
    const publicSettings = JSON.parse(JSON.stringify(this.settings));
    const ssh = publicSettings.integrations?.ssh;
    const authEnabled = Boolean(config.auth.username && config.auth.password && config.auth.jwtSecret);
    publicSettings.personality = this.getEffectivePersonalityConfig();

    if (ssh) {
      const effective = this.getEffectiveSshConfig();
      delete ssh.password;
      ssh.enabled = Boolean(effective.enabled);
      ssh.hasPassword = Boolean(effective.password);
      ssh.configured = Boolean(effective.enabled && effective.host && effective.username && (effective.password || effective.privateKeyPath));
      ssh.source = effective.source;
      ssh.privateKeyPath = effective.privateKeyPath || '';
      ssh.host = effective.host || '';
      ssh.port = effective.port || 22;
      ssh.username = effective.username || '';
    }

    if (publicSettings.integrations?.opencode) {
      publicSettings.integrations.opencode = this.getEffectiveOpencodeConfig();
    }

    if (publicSettings.security) {
      publicSettings.security.requireAuth = authEnabled;
    }

    return publicSettings;
  }

  getSettingsPath() {
    const configured = String(process.env.KIMIBUILT_SETTINGS_PATH || '').trim();
    if (configured) {
      return path.resolve(path.join(__dirname, '../../..'), configured);
    }

    return resolvePreferredWritableFile(
      path.join(__dirname, '../../../config/dashboard-settings.json'),
      ['dashboard-settings.json'],
    );
  }

  getEffectivePersonalityConfig() {
    return getEffectiveSoulConfig(this.settings?.personality || {});
  }

  applyPersonalityUpdate(updates = {}) {
    const personalityUpdate = updates?.personality;
    if (!personalityUpdate || typeof personalityUpdate !== 'object') {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(personalityUpdate, 'content')) {
      writeSoulFile(personalityUpdate.content);
    }
  }

  getEffectiveSshConfig() {
    const stored = this.settings?.integrations?.ssh || {};
    const envHost = process.env.KIMIBUILT_SSH_HOST || process.env.SSH_HOST || '';
    const envPort = parseInt(process.env.KIMIBUILT_SSH_PORT || process.env.SSH_PORT || '', 10);
    const envUsername = process.env.KIMIBUILT_SSH_USERNAME || process.env.SSH_USERNAME || '';
    const envPassword = process.env.KIMIBUILT_SSH_PASSWORD || process.env.SSH_PASSWORD || '';
    const envPrivateKeyPath = process.env.KIMIBUILT_SSH_KEY_PATH || process.env.SSH_KEY_PATH || '';

    const host = envHost || stored.host || '';
    const username = envUsername || stored.username || '';
    const port = Number.isFinite(envPort) && envPort > 0 ? envPort : (stored.port || 22);
    const password = envPassword || stored.password || '';
    const privateKeyPath = envPrivateKeyPath || stored.privateKeyPath || '';
    const enabled = Boolean(stored.enabled || envHost || envUsername || envPassword || envPrivateKeyPath);
    const source = envHost || envUsername || envPassword || envPrivateKeyPath ? 'cluster-secret' : 'dashboard';

    return {
      enabled,
      host,
      port,
      username,
      password,
      privateKeyPath,
      source,
    };
  }

  getEffectiveOpencodeConfig() {
    const stored = this.settings?.integrations?.opencode || {};
    const providerEnvAllowlist = this.normalizeStringArray(
      stored.providerEnvAllowlist,
      config.opencode.providerEnvAllowlist || [],
    );

    for (const key of OPENCODE_OPAQUE_ENV_KEYS) {
      if (!providerEnvAllowlist.includes(key)) {
        providerEnvAllowlist.push(key);
      }
    }

    return {
      enabled: stored.enabled !== false && config.opencode.enabled !== false,
      binaryPath: String(stored.binaryPath || config.opencode.binaryPath || 'opencode').trim() || 'opencode',
      defaultAgent: String(stored.defaultAgent || config.opencode.defaultAgent || 'build').trim().toLowerCase() || 'build',
      defaultModel: String(stored.defaultModel || config.opencode.defaultModel || '').trim(),
      allowedWorkspaceRoots: this.normalizeStringArray(
        stored.allowedWorkspaceRoots,
        config.opencode.allowedWorkspaceRoots || [],
      ),
      remoteDefaultWorkspace: String(stored.remoteDefaultWorkspace || config.opencode.remoteDefaultWorkspace || '').trim(),
      providerEnvAllowlist,
      remoteAutoInstall: stored.remoteAutoInstall === true || config.opencode.remoteAutoInstall === true,
    };
  }

  normalizeStringArray(value, fallback = []) {
    const source = Array.isArray(value)
      ? value
      : String(value || '')
        .split(',');
    const normalized = source
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);

    return normalized.length > 0 ? Array.from(new Set(normalized)) : [...fallback];
  }

  /**
   * Get default settings
   */
  getDefaultSettings() {
    return {
      general: {
        appName: 'LillyBuilt Agent SDK',
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
      personality: {
        enabled: true,
        displayName: 'Agent Soul'
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
      },
      integrations: {
        ssh: {
          enabled: false,
          host: '',
          port: 22,
          username: '',
          password: '',
          privateKeyPath: '',
        },
        opencode: {
          enabled: config.opencode.enabled !== false,
          binaryPath: config.opencode.binaryPath || 'opencode',
          defaultAgent: config.opencode.defaultAgent || 'build',
          defaultModel: config.opencode.defaultModel || '',
          allowedWorkspaceRoots: [...(config.opencode.allowedWorkspaceRoots || [])],
          remoteDefaultWorkspace: config.opencode.remoteDefaultWorkspace || '',
          providerEnvAllowlist: [...(config.opencode.providerEnvAllowlist || [])],
          remoteAutoInstall: config.opencode.remoteAutoInstall === true,
        }
      }
    };
  }
}

module.exports = new SettingsController();
