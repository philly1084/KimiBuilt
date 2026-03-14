/**
 * DockerExecTool - Execute commands in Docker containers
 */

const { ToolBase } = require('../../ToolBase');

class DockerExecTool extends ToolBase {
  constructor() {
    super({
      id: 'docker-exec',
      name: 'Docker Execute',
      description: 'Execute commands in Docker containers',
      category: 'ssh',
      version: '1.0.0',
      backend: {
        sideEffects: ['execute'],
        sandbox: { filesystem: true },
        timeout: 60000
      },
      inputSchema: {
        type: 'object',
        required: ['container', 'command'],
        properties: {
          container: {
            type: 'string',
            description: 'Container name or ID'
          },
          command: {
            type: 'string',
            description: 'Command to execute'
          },
          workingDir: {
            type: 'string',
            description: 'Working directory in container'
          },
          environment: {
            type: 'object',
            description: 'Environment variables'
          },
          user: {
            type: 'string',
            description: 'User to run as'
          },
          privileged: {
            type: 'boolean',
            default: false,
            description: 'Run in privileged mode'
          },
          timeout: {
            type: 'integer',
            default: 60000
          }
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          exitCode: { type: 'integer' },
          container: { type: 'string' },
          duration: { type: 'integer' }
        }
      }
    });
  }

  async handler(params, context, tracker) {
    const {
      container,
      command,
      workingDir,
      environment = {},
      user,
      privileged = false,
      timeout = 60000
    } = params;

    // Build docker exec command
    const dockerArgs = ['exec'];
    
    if (workingDir) {
      dockerArgs.push('-w', workingDir);
    }
    
    if (user) {
      dockerArgs.push('-u', user);
    }
    
    if (privileged) {
      dockerArgs.push('--privileged');
    }
    
    // Add environment variables
    for (const [key, value] of Object.entries(environment)) {
      dockerArgs.push('-e', `${key}=${value}`);
    }
    
    dockerArgs.push(container, 'sh', '-c', command);

    tracker.recordExecution(`docker ${dockerArgs.join(' ')}`);

    // Execute docker command
    const result = await this.executeDocker(dockerArgs, timeout);
    
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      container,
      duration: result.duration
    };
  }

  async executeDocker(args, timeout) {
    const { spawn } = require('child_process');
    
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const child = spawn('docker', args, {
        timeout,
        env: process.env
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      child.on('close', (exitCode) => {
        resolve({
          stdout,
          stderr,
          exitCode: exitCode || 0,
          duration: Date.now() - startTime
        });
      });
      
      child.on('error', (error) => {
        reject(error);
      });
    });
  }
}

module.exports = { DockerExecTool };
