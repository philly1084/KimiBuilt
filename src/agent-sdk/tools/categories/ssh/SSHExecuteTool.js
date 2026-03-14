/**
 * SSHExecuteTool - Execute commands on remote hosts via SSH
 */

const { ToolBase } = require('../../ToolBase');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const settingsController = require('../../../../routes/admin/settings.controller');

class SSHExecuteTool extends ToolBase {
  constructor() {
    super({
      id: 'ssh-execute',
      name: 'SSH Command',
      description: 'Execute commands on remote servers via SSH',
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

    // Build full command
    let fullCommand = command;
    
    if (workingDirectory) {
      fullCommand = `cd ${workingDirectory} && ${fullCommand}`;
    }
    
    if (Object.keys(environment).length > 0) {
      const envVars = Object.entries(environment)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');
      fullCommand = `export ${envVars} && ${fullCommand}`;
    }
    
    if (sudo) {
      fullCommand = `sudo ${fullCommand}`;
    }

    const result = await this.executeSSH(connection, fullCommand, timeout);

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

  async executeSSH(connection, command, timeout) {
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
      this.wrapRemoteCommand(command),
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
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        duration: Date.now() - startedAt,
        host: `${connection.host}:${connection.port}`,
      };
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

  wrapRemoteCommand(command) {
    return `sh -lc ${this.quoteShellArg(command)}`;
  }

  quoteShellArg(value) {
    return `'${String(value || '').replace(/'/g, `'"'"'`)}'`;
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
