/**
 * SSHExecuteTool - Execute commands on remote hosts via SSH
 */

const { ToolBase } = require('../../ToolBase');

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
        required: ['host', 'command'],
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
      host,
      port = 22,
      username,
      command,
      timeout = 60000,
      workingDirectory,
      environment = {},
      sudo = false
    } = params;

    // Get credentials from context or environment
    const credentials = await this.getCredentials(host, username, context);
    
    if (!credentials) {
      throw new Error(`No SSH credentials configured for ${host}`);
    }

    tracker.recordExecution(`ssh ${username}@${host}:${port}`, { command });

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

    // Execute SSH command
    // In production, this would use the ssh2 library
    // For now, return a simulated response
    const result = await this.executeSSH(host, port, credentials, fullCommand, timeout);

    tracker.recordNetworkCall(`ssh://${host}:${port}`, 'EXEC', {
      command: command.substring(0, 100),
      exitCode: result.exitCode
    });

    return result;
  }

  async getCredentials(host, username, context) {
    // Priority:
    // 1. Context-provided credentials
    // 2. Environment variables
    // 3. SSH config file
    // 4. Credential store
    
    if (context.sshCredentials?.[host]) {
      return context.sshCredentials[host];
    }
    
    // Check environment
    if (process.env.SSH_KEY_PATH) {
      return {
        username: username || process.env.SSH_USERNAME,
        privateKeyPath: process.env.SSH_KEY_PATH
      };
    }
    
    return null;
  }

  async executeSSH(host, port, credentials, command, timeout) {
    // This is a placeholder - would use node-ssh or ssh2 library
    console.log(`[SSH] Would execute on ${host}:${port}: ${command.substring(0, 50)}...`);
    
    // Simulate execution
    return {
      stdout: `Simulated output for: ${command.substring(0, 30)}...`,
      stderr: '',
      exitCode: 0,
      duration: 1000,
      host: `${host}:${port}`
    };
  }
}

module.exports = { SSHExecuteTool };
