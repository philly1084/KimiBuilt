/**
 * SandboxTool - Execute code in isolated Docker containers
 */

const { ToolBase } = require('../../ToolBase');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class SandboxTool extends ToolBase {
  constructor() {
    super({
      id: 'code-sandbox',
      name: 'Code Sandbox',
      description: 'Execute code in isolated Docker containers with resource limits',
      category: 'sandbox',
      version: '1.0.0',
      backend: {
        sideEffects: ['execute', 'filesystem'],
        sandbox: { network: false, filesystem: 'isolated' },
        timeout: 60000
      },
      inputSchema: {
        type: 'object',
        required: ['language', 'code'],
        properties: {
          language: {
            type: 'string',
            enum: ['javascript', 'python', 'bash', 'sql', 'ruby', 'go', 'rust'],
            description: 'Programming language'
          },
          code: {
            type: 'string',
            description: 'Code to execute'
          },
          inputs: {
            type: 'object',
            description: 'Input data for the code'
          },
          dependencies: {
            type: 'array',
            items: { type: 'string' },
            description: 'Package dependencies to install'
          },
          environment: {
            type: 'object',
            description: 'Environment variables'
          },
          limits: {
            type: 'object',
            description: 'Resource limits',
            properties: {
              cpu: { type: 'string', default: '0.5' },
              memory: { type: 'string', default: '512m' },
              timeout: { type: 'integer', default: 30000 },
              maxOutput: { type: 'integer', default: 100000 }
            }
          },
          network: {
            type: 'boolean',
            default: false,
            description: 'Allow network access'
          }
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          exitCode: { type: 'integer' },
          executionTime: { type: 'number' },
          memoryUsage: { type: 'number' },
          killed: { type: 'boolean' },
          killReason: { type: 'string' }
        }
      }
    });

    // Track running containers
    this.containers = new Map();
    this.tempDir = path.join(os.tmpdir(), 'agent-sandbox');
  }

  async handler(params, context, tracker) {
    const {
      language,
      code,
      inputs = {},
      dependencies = [],
      environment = {},
      limits = {},
      network = false
    } = params;

    const {
      cpu = '0.5',
      memory = '512m',
      timeout = 30000,
      maxOutput = 100000
    } = limits;

    // Create temp workspace
    const workspaceId = `sandbox-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const workspacePath = path.join(this.tempDir, workspaceId);
    
    await fs.mkdir(workspacePath, { recursive: true });

    try {
      // Write code file
      const codeFile = await this.writeCodeFile(workspacePath, language, code);
      
      // Write inputs
      if (Object.keys(inputs).length > 0) {
        await fs.writeFile(
          path.join(workspacePath, 'input.json'),
          JSON.stringify(inputs, null, 2)
        );
      }

      // Get Docker configuration
      const dockerConfig = this.getDockerConfig(language, dependencies);

      tracker.recordExecution(`docker run ${dockerConfig.image}`, {
        language,
        timeout,
        network: network ? 'enabled' : 'disabled'
      });

      // Execute in Docker
      const result = await this.executeInDocker({
        workspacePath,
        image: dockerConfig.image,
        command: dockerConfig.command,
        codeFile,
        cpu,
        memory,
        timeout,
        maxOutput,
        network,
        environment
      });

      // Track container
      if (result.containerId) {
        this.containers.set(result.containerId, {
          createdAt: new Date().toISOString(),
          language,
          status: result.exitCode === 0 ? 'success' : 'failed'
        });
      }

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        executionTime: result.executionTime,
        memoryUsage: result.memoryUsage,
        killed: result.killed,
        killReason: result.killReason
      };

    } finally {
      // Cleanup
      await this.cleanup(workspacePath);
    }
  }

  async writeCodeFile(workspacePath, language, code) {
    const extensions = {
      javascript: 'js',
      python: 'py',
      bash: 'sh',
      sql: 'sql',
      ruby: 'rb',
      go: 'go',
      rust: 'rs'
    };

    const filenames = {
      javascript: 'index.js',
      python: 'main.py',
      bash: 'script.sh',
      sql: 'query.sql',
      ruby: 'main.rb',
      go: 'main.go',
      rust: 'main.rs'
    };

    const filename = filenames[language] || `main.${extensions[language]}`;
    const filepath = path.join(workspacePath, filename);
    
    await fs.writeFile(filepath, code);
    
    return filename;
  }

  getDockerConfig(language, dependencies) {
    const configs = {
      javascript: {
        image: 'node:18-alpine',
        command: (file) => ['node', file]
      },
      python: {
        image: 'python:3.11-alpine',
        command: (file) => ['python', file]
      },
      bash: {
        image: 'alpine:latest',
        command: (file) => ['sh', file]
      },
      ruby: {
        image: 'ruby:3.2-alpine',
        command: (file) => ['ruby', file]
      },
      go: {
        image: 'golang:1.21-alpine',
        command: (file) => ['go', 'run', file]
      },
      rust: {
        image: 'rust:1.73-alpine',
        command: (file) => ['rustc', file, '-o', 'main', '&&', './main']
      }
    };

    return configs[language] || configs.javascript;
  }

  async executeInDocker(config) {
    const {
      workspacePath,
      image,
      command,
      codeFile,
      cpu,
      memory,
      timeout,
      maxOutput,
      network,
      environment
    } = config;

    return new Promise(async (resolve, reject) => {
      const startTime = Date.now();
      let killed = false;
      let killReason = null;
      let stdout = '';
      let stderr = '';

      // Build docker run command
      const dockerArgs = [
        'run',
        '--rm',
        '--cpus', cpu,
        '--memory', memory,
        '--memory-swap', memory,
        '--pids-limit', '100',
        '--network', network ? 'bridge' : 'none',
        '-v', `${workspacePath}:/workspace:ro`,
        '-w', '/workspace',
        '--read-only',
        '--tmpfs', '/tmp:noexec,nosuid,size=100m'
      ];

      // Add environment variables
      Object.entries(environment).forEach(([key, value]) => {
        dockerArgs.push('-e', `${key}=${value}`);
      });

      dockerArgs.push(image);
      dockerArgs.push(...command(codeFile));

      const child = spawn('docker', dockerArgs, {
        timeout: timeout + 5000 // Docker timeout + buffer
      });

      // Set up timeout
      const timeoutId = setTimeout(() => {
        killed = true;
        killReason = 'timeout';
        child.kill('SIGKILL');
      }, timeout);

      // Collect output with limit
      child.stdout.on('data', (data) => {
        if (stdout.length < maxOutput) {
          stdout += data.toString();
          if (stdout.length > maxOutput) {
            stdout = stdout.substring(0, maxOutput) + '\n... (output truncated)';
          }
        }
      });

      child.stderr.on('data', (data) => {
        if (stderr.length < maxOutput) {
          stderr += data.toString();
          if (stderr.length > maxOutput) {
            stderr = stderr.substring(0, maxOutput) + '\n... (output truncated)';
          }
        }
      });

      child.on('close', (exitCode, signal) => {
        clearTimeout(timeoutId);

        const executionTime = Date.now() - startTime;

        if (signal === 'SIGKILL' && !killed) {
          killed = true;
          killReason = 'memory';
        }

        resolve({
          stdout,
          stderr,
          exitCode: exitCode || 0,
          executionTime,
          memoryUsage: 0, // Would need cgroups for accurate measurement
          killed,
          killReason
        });
      });

      child.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  async cleanup(workspacePath) {
    try {
      await fs.rm(workspacePath, { recursive: true, force: true });
    } catch (error) {
      console.error(`[SandboxTool] Cleanup failed: ${error.message}`);
    }
  }

  /**
   * Get running container stats
   */
  getContainerStats() {
    return Array.from(this.containers.entries()).map(([id, info]) => ({
      id,
      ...info
    }));
  }

  /**
   * Prune old containers from tracking
   */
  pruneContainers(maxAge = 3600000) {
    const now = Date.now();
    for (const [id, info] of this.containers) {
      const created = new Date(info.createdAt).getTime();
      if (now - created > maxAge) {
        this.containers.delete(id);
      }
    }
  }
}

module.exports = { SandboxTool };
