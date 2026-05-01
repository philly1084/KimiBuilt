const childProcess = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { isPathInsideRoot, resolveWorkspacePath } = require('./symphony');

function normalizeHook(value = '') {
  return String(value || '').trim();
}

function runShellHook(script = '', {
  cwd,
  timeoutMs = 60000,
  execImpl = childProcess.exec,
} = {}) {
  const command = normalizeHook(script);
  if (!command) {
    return Promise.resolve({ stdout: '', stderr: '' });
  }

  return new Promise((resolve, reject) => {
    execImpl(command, {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout = '', stderr = '') => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

class WorkspaceManager {
  constructor({
    workspaceRoot,
    hooks = {},
    logger = console,
    fsImpl = fs,
    execImpl = childProcess.exec,
  } = {}) {
    this.workspaceRoot = path.resolve(workspaceRoot || path.join(require('os').tmpdir(), 'symphony_workspaces'));
    this.hooks = hooks || {};
    this.logger = logger;
    this.fs = fsImpl;
    this.execImpl = execImpl;
  }

  updateConfig({ workspaceRoot = this.workspaceRoot, hooks = this.hooks } = {}) {
    this.workspaceRoot = path.resolve(workspaceRoot || this.workspaceRoot);
    this.hooks = hooks || {};
  }

  resolve(identifier = '') {
    return resolveWorkspacePath(identifier, this.workspaceRoot);
  }

  async ensureWorkspace(issue = {}) {
    const resolved = this.resolve(issue.identifier);
    this.assertInsideRoot(resolved.workspace_path);
    let createdNow = false;
    try {
      const stat = await this.fs.stat(resolved.workspace_path);
      if (!stat.isDirectory()) {
        throw new Error(`workspace_path_not_directory: ${resolved.workspace_path}`);
      }
    } catch (error) {
      if (error.code && error.code !== 'ENOENT') {
        throw error;
      }
      await this.fs.mkdir(resolved.workspace_path, { recursive: true });
      createdNow = true;
    }

    if (createdNow && normalizeHook(this.hooks.after_create)) {
      await this.runHook('after_create', resolved.workspace_path, { fatal: true });
    }

    return {
      path: resolved.workspace_path,
      workspace_path: resolved.workspace_path,
      workspace_key: resolved.workspace_key,
      created_now: createdNow,
    };
  }

  async beforeRun(workspacePath = '') {
    await this.runHook('before_run', workspacePath, { fatal: true });
  }

  async afterRun(workspacePath = '') {
    await this.runHook('after_run', workspacePath, { fatal: false });
  }

  async cleanupWorkspace(issue = {}) {
    const resolved = this.resolve(issue.identifier);
    this.assertInsideRoot(resolved.workspace_path);
    try {
      await this.runHook('before_remove', resolved.workspace_path, { fatal: false });
    } finally {
      await this.fs.rm(resolved.workspace_path, { recursive: true, force: true });
    }
  }

  async runHook(name = '', workspacePath = '', { fatal = false } = {}) {
    const script = normalizeHook(this.hooks[name]);
    if (!script) {
      return { skipped: true };
    }
    this.assertInsideRoot(workspacePath);
    try {
      this.logger.log?.(`[Symphony] hook_start hook=${name} cwd=${workspacePath}`);
      const result = await runShellHook(script, {
        cwd: workspacePath,
        timeoutMs: Number(this.hooks.timeout_ms) || 60000,
        execImpl: this.execImpl,
      });
      this.logger.log?.(`[Symphony] hook_completed hook=${name} cwd=${workspacePath}`);
      return result;
    } catch (error) {
      this.logger.warn?.(`[Symphony] hook_failed hook=${name} cwd=${workspacePath} error=${error.message}`);
      if (fatal) {
        throw error;
      }
      return { ignored: true, error };
    }
  }

  assertInsideRoot(workspacePath = '') {
    const resolvedWorkspace = path.resolve(workspacePath);
    if (!isPathInsideRoot(resolvedWorkspace, this.workspaceRoot)) {
      throw new Error(`workspace_path_outside_root: ${resolvedWorkspace}`);
    }
    return resolvedWorkspace;
  }
}

module.exports = {
  WorkspaceManager,
  runShellHook,
};
