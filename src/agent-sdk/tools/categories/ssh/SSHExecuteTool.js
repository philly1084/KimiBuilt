/**
 * SSHExecuteTool - Execute commands on remote hosts via SSH
 */

const { ToolBase } = require('../../ToolBase');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const settingsController = require('../../../../routes/admin/settings.controller');
const { executeWithRunnerPreference, shouldPreferRunner } = require('../../../../remote-runner/transport');

class SSHExecuteTool extends ToolBase {
  constructor(overrides = {}) {
    super({
      id: overrides.id || 'ssh-execute',
      name: overrides.name || 'SSH Command',
      description: overrides.description || 'Execute commands on remote servers via SSH',
      category: 'ssh',
      version: '1.0.0',
      backend: {
        sideEffects: ['network', 'execute'],
        sandbox: { network: true },
        timeout: 60000
      },
      inputSchema: {
        type: 'object',
        required: ['command'],
        properties: {
          host: {
            type: 'string',
            description: 'Remote host (IP or hostname)'
          },
          port: {
            type: 'integer',
            default: 22,
            description: 'SSH port'
          },
          username: {
            type: 'string',
            description: 'SSH username'
          },
          command: {
            type: 'string',
            description: 'Command to execute'
          },
          timeout: {
            type: 'integer',
            default: 60000,
            description: 'Command timeout in ms'
          },
          workingDirectory: {
            type: 'string',
            description: 'Working directory on remote host'
          },
          environment: {
            type: 'object',
            description: 'Environment variables to set'
          },
          sudo: {
            type: 'boolean',
            default: false,
            description: 'Execute with sudo'
          }
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          exitCode: { type: 'integer' },
          duration: { type: 'integer' },
          host: { type: 'string' }
        }
      }
    });

    // SSH connections cache
    this.connections = new Map();
  }

  async handler(params, context, tracker) {
    const {
      host: requestedHost,
      port: requestedPort,
      username: requestedUsername,
      command,
      timeout = 60000,
      workingDirectory,
      environment = {},
      sudo = false
    } = params;

    const canUseRunner = !context?.skipRunner
      && !String(this.id || '').includes('internal')
      && shouldPreferRunner(params);

    if (canUseRunner) {
      return executeWithRunnerPreference({
        params: {
          command,
          timeout,
          workingDirectory,
          environment,
          sudo,
          profile: 'deploy',
          approval: params.approval || {},
        },
        context: {
          ...context,
          toolId: this.id,
        },
        tracker,
        fallback: () => this.handler({
          ...params,
          host: requestedHost,
          port: requestedPort,
          username: requestedUsername,
        }, {
          ...context,
          skipRunner: true,
        }, tracker),
      });
    }

    const connection = await this.getConnectionConfig({
      host: requestedHost,
      port: requestedPort,
      username: requestedUsername,
      context,
    });
    
    if (!connection.host) {
      throw new Error('No SSH host configured. Set one in Admin Settings or the cluster secret.');
    }

    if (!connection.username) {
      throw new Error(`No SSH username configured for ${connection.host}`);
    }

    if (!connection.password && !connection.privateKeyPath) {
      throw new Error(`No SSH password or private key configured for ${connection.host}`);
    }

    tracker.recordExecution(`ssh ${connection.username}@${connection.host}:${connection.port}`, { command });

    const executionScript = this.buildExecutionScript({
      command,
      workingDirectory,
      environment,
    });

    const result = await this.executeSSH(connection, executionScript, timeout, {
      sudo,
      originalCommand: command,
    });

    tracker.recordNetworkCall(`ssh://${connection.host}:${connection.port}`, 'EXEC', {
      command: command.substring(0, 100),
      exitCode: result.exitCode
    });

    return result;
  }

  async getConnectionConfig({ host, port, username, context }) {
    const configured = settingsController.getEffectiveSshConfig();
    const contextual = this.getContextCredentials(host, context);
    const defaultConfig = configured.enabled ? configured : {};

    return {
      host: host || contextual.host || defaultConfig.host,
      port: port || contextual.port || defaultConfig.port || 22,
      username: username || contextual.username || defaultConfig.username,
      password: contextual.password || defaultConfig.password || '',
      privateKeyPath: contextual.privateKeyPath || defaultConfig.privateKeyPath || '',
    };
  }

  getContextCredentials(host, context = {}) {
    if (!context?.sshCredentials) {
      return {};
    }

    if (host && context.sshCredentials[host]) {
      return context.sshCredentials[host];
    }

    return context.sshCredentials.default || {};
  }

  async executeSSH(connection, executionScript, timeout, options = {}) {
    const sshPath = await this.findSshBinary();
    const askPassScript = connection.password ? await this.createAskPassScript() : null;
    const startedAt = Date.now();

    const sshArgs = [
      '-p',
      String(connection.port || 22),
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=/dev/null',
      '-o',
      'LogLevel=ERROR',
      '-o',
      'ConnectTimeout=15',
      '-o',
      'ServerAliveInterval=15',
      '-o',
      'ServerAliveCountMax=3',
    ];

    if (connection.privateKeyPath) {
      sshArgs.push('-i', connection.privateKeyPath);
    }

    if (connection.password) {
      sshArgs.push(
        '-o',
        'PreferredAuthentications=password,keyboard-interactive',
        '-o',
        'PubkeyAuthentication=no',
      );
    }

    sshArgs.push(
      `${connection.username}@${connection.host}`,
      this.buildRemoteLauncher({ sudo: options.sudo }),
    );

    const env = {
      ...process.env,
      LC_ALL: 'C',
    };

    if (connection.password && askPassScript) {
      env.SSH_ASKPASS = askPassScript;
      env.SSH_ASKPASS_REQUIRE = 'force';
      env.DISPLAY = env.DISPLAY || 'kimibuilt:0';
      env.KIMIBUILT_SSH_PASSWORD = connection.password;
    }

    try {
      const result = await this.spawnProcess(sshPath, sshArgs, {
        env,
        timeout,
        stdio: ['pipe', 'pipe', 'pipe'],
        input: executionScript,
      });

      return {
        stdout: result.stdout,
        stderr: this.stripBenignSshWarnings(result.stderr),
        exitCode: result.exitCode,
        duration: Date.now() - startedAt,
        host: `${connection.host}:${connection.port}`,
        shellMode: options.sudo ? 'sudo-shell-script' : 'shell-script',
      };
    } catch (error) {
      throw this.enrichExecutionError(error, {
        command: options.originalCommand || '',
        host: `${connection.host}:${connection.port}`,
      });
    } finally {
      if (askPassScript) {
        await fs.rm(path.dirname(askPassScript), { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  async findSshBinary() {
    const candidates = ['/usr/bin/ssh', '/bin/ssh', 'ssh'];

    for (const candidate of candidates) {
      try {
        await this.spawnProcess(candidate, ['-V'], {
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        return candidate;
      } catch (error) {
        if (!/ENOENT/i.test(error.message)) {
          return candidate;
        }
      }
    }

    throw new Error('SSH client is not installed in the backend container');
  }

  async createAskPassScript() {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kimibuilt-ssh-'));
    const scriptPath = path.join(tempDir, 'askpass.sh');
    await fs.writeFile(scriptPath, '#!/bin/sh\necho "$KIMIBUILT_SSH_PASSWORD"\n', { mode: 0o700 });
    await fs.chmod(scriptPath, 0o700);
    return scriptPath;
  }

  buildExecutionScript({ command, workingDirectory, environment = {} }) {
    const lines = [];

    if (workingDirectory) {
      lines.push(`cd -- ${this.quoteShellArg(workingDirectory)}`);
    }

    Object.entries(environment || {}).forEach(([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(key || ''))) {
        return;
      }
      lines.push(`export ${key}=${this.quoteShellArg(String(value ?? ''))}`);
    });

    lines.push(String(command || '').trim());
    lines.push('');

    return lines.filter(Boolean).join('\n');
  }

  buildRemoteLauncher({ sudo = false } = {}) {
    if (sudo) {
      return 'if command -v bash >/dev/null 2>&1; then exec sudo -n bash -seuo pipefail; else exec sudo -n sh -seu; fi';
    }

    return 'if command -v bash >/dev/null 2>&1; then exec bash -seuo pipefail; else exec sh -seu; fi';
  }

  quoteShellArg(value) {
    return `'${String(value || '').replace(/'/g, `'"'"'`)}'`;
  }

  stripBenignSshWarnings(text = '') {
    return String(text || '')
      .split(/\r?\n/)
      .filter((line) => !/Warning: Permanently added .* to the list of known hosts\./i.test(String(line || '').trim()))
      .join('\n')
      .trim();
  }

  enrichExecutionError(error, { command = '', host = '' } = {}) {
    const enrichedError = error;
    const stderr = this.stripBenignSshWarnings(error?.stderr || '');
    const stdout = String(error?.stdout || '').trim();
    const combined = `${stderr}\n${stdout}\n${error?.message || ''}`.toLowerCase();
    const hints = [];

    if (/unterminated quoted string|syntax error/i.test(combined)) {
      hints.push('Remote shell syntax failed. Prefer simple Bash/POSIX commands and avoid nested quote chains or shell fragments copied from another context.');
    }

    if (/\brg: not found\b|\bripgrep\b/.test(combined) || /\brg\b/.test(command)) {
      hints.push('`rg` is often not installed on Ubuntu servers. Prefer `find` and `grep -R` unless you install ripgrep first.');
    }

    if (/\bdocker-compose: not found\b/.test(combined) || /\bdocker-compose\b/.test(command)) {
      hints.push('Many Ubuntu hosts only have the Docker plugin. Prefer `docker compose` before `docker-compose`.');
    }

    if (/\bifconfig: not found\b/.test(combined) || /\bifconfig\b/.test(command)) {
      hints.push('On modern Ubuntu, prefer `ip addr` instead of `ifconfig`.');
    }

    if (/\bnetstat: not found\b/.test(combined) || /\bnetstat\b/.test(command)) {
      hints.push('On modern Ubuntu, prefer `ss -tulpn` instead of `netstat`.');
    }

    if (/\byum: not found\b/.test(combined) || /\byum\b/.test(command)) {
      hints.push('This looks like Ubuntu. Prefer `apt-get` or `apt` rather than `yum`.');
    }

    if (/cannot execute binary file|exec format error/.test(combined)) {
      hints.push('This host may be ARM64/aarch64. Verify `uname -m` and use Linux arm64 binaries instead of x86_64 builds.');
    }

    if (/sudo: a password is required/.test(combined)) {
      hints.push('The remote account requires an interactive sudo password. Use a root-capable account or a non-interactive sudo configuration for automation.');
    }

    if (hints.length > 0) {
      enrichedError.hints = hints;
      enrichedError.message = [
        error?.message || `SSH execution failed${host ? ` on ${host}` : ''}`,
        '',
        'Hints:',
        ...hints.map((hint) => `- ${hint}`),
      ].join('\n');
    }

    return enrichedError;
  }

  spawnProcess(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, options);
      let stdout = '';
      let stderr = '';
      let timeoutId = null;

      if (options.timeout) {
        timeoutId = setTimeout(() => {
          child.kill('SIGTERM');
          const error = new Error(`${command} timed out after ${options.timeout}ms`);
          error.code = 'ETIMEDOUT';
          reject(error);
        }, options.timeout);
      }

      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      if (child.stdin && options.input !== undefined) {
        child.stdin.write(String(options.input));
        child.stdin.end();
      }

      child.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        reject(error);
      });

      child.on('close', (exitCode) => {
        if (timeoutId) clearTimeout(timeoutId);
        if (exitCode === 0) {
          resolve({ exitCode, stdout, stderr });
          return;
        }

        const message = stderr.trim() || stdout.trim() || `${command} exited with code ${exitCode}`;
        const error = new Error(message);
        error.exitCode = exitCode;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      });
    });
  }
}

module.exports = { SSHExecuteTool };
