'use strict';

const settingsController = require('../routes/admin/settings.controller');
const { config } = require('../config');
const { remoteRunnerService } = require('./service');

function normalizeText(value = '') {
  return String(value || '').trim();
}

function createNoopTracker() {
  return {
    recordExecution() {},
    recordNetworkCall() {},
  };
}

function getPreferredRemoteTransport() {
  const managedApps = typeof settingsController.getEffectiveManagedAppsConfig === 'function'
    ? settingsController.getEffectiveManagedAppsConfig()
    : {};
  return normalizeText(managedApps.remoteTransport || managedApps.deployTarget || '').toLowerCase();
}

function shouldPreferRunner(params = {}) {
  if (config.remoteRunner?.preferred === false) {
    return false;
  }
  if (normalizeText(params.host) || normalizeText(params.username)) {
    return false;
  }
  const preferred = getPreferredRemoteTransport();
  return preferred === 'runner' || (!preferred && Boolean(remoteRunnerService.getHealthyRunner()));
}

class RunnerCommandTransport {
  constructor(options = {}) {
    this.runnerService = options.runnerService || remoteRunnerService;
  }

  isAvailable(runnerId = '') {
    return Boolean(this.runnerService.getHealthyRunner(runnerId));
  }

  async execute(params = {}, context = {}, tracker = createNoopTracker()) {
    const command = normalizeText(params.command);
    if (!command) {
      throw new Error('command is required');
    }

    const runnerId = normalizeText(params.runnerId || params.remoteRunnerId || context.runnerId);
    tracker.recordExecution(`runner ${runnerId || 'default'}`, { command });

    const result = await this.runnerService.dispatchCommand(runnerId, {
      command,
      cwd: params.workingDirectory || params.cwd,
      environment: params.environment || {},
      timeout: params.timeout,
      profile: params.profile || params.capabilityProfile || 'deploy',
      approval: params.approval || {},
      metadata: {
        toolId: context.toolId || '',
        sudo: params.sudo === true,
      },
    }, context);

    tracker.recordNetworkCall(`runner://${runnerId || 'default'}`, 'EXEC', {
      command: command.substring(0, 100),
      exitCode: result.exitCode,
    });

    if (Number(result.exitCode || 0) !== 0) {
      const error = new Error(result.stderr || result.stdout || `Remote runner command exited with code ${result.exitCode}`);
      error.exitCode = Number(result.exitCode || 0);
      error.stdout = result.stdout || '';
      error.stderr = result.stderr || '';
      error.duration = Number(result.duration || 0);
      error.host = result.host || `runner:${runnerId || 'default'}`;
      error.runnerCommandFailed = true;
      throw error;
    }

    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      exitCode: Number(result.exitCode || 0),
      duration: Number(result.duration || 0),
      host: result.host || `runner:${runnerId || 'default'}`,
      shellMode: 'runner-command',
      runnerId: runnerId || null,
    };
  }
}

async function executeWithRunnerPreference({
  params = {},
  context = {},
  tracker = createNoopTracker(),
  fallback,
} = {}) {
  const transport = new RunnerCommandTransport();
  if (shouldPreferRunner(params) && transport.isAvailable(params.runnerId || params.remoteRunnerId || context.runnerId)) {
    try {
      return await transport.execute(params, context, tracker);
    } catch (error) {
      if (error.runnerCommandFailed) {
        throw error;
      }
      if (!fallback) {
        throw error;
      }
      tracker.recordExecution('runner fallback to ssh', {
        error: error.message,
      });
    }
  }

  if (typeof fallback !== 'function') {
    const error = new Error('No healthy remote runner is online and no fallback transport is available');
    error.statusCode = 503;
    throw error;
  }

  return fallback();
}

module.exports = {
  RunnerCommandTransport,
  executeWithRunnerPreference,
  getPreferredRemoteTransport,
  shouldPreferRunner,
};
