'use strict';

const {
  isDangerousCommand,
  normalizeCommandJob,
  normalizeRunnerRegistration,
} = require('./protocol');

describe('remote runner protocol', () => {
  test('normalizes runner registration with safe default capabilities', () => {
    expect(normalizeRunnerRegistration({
      runnerId: 'deploy-1',
      capabilities: ['inspect', 'nope'],
      allowedRoots: ['/opt', '/opt', ''],
    })).toEqual(expect.objectContaining({
      runnerId: 'deploy-1',
      displayName: 'deploy-1',
      capabilities: ['inspect'],
      allowedRoots: ['/opt'],
    }));
  });

  test('preserves normalized runner CLI inventory in metadata', () => {
    expect(normalizeRunnerRegistration({
      runnerId: 'deploy-1',
      metadata: {
        cli_tools: [
          { command: 'kubectl', bin: '/usr/local/bin/kubectl' },
          { name: 'kubectl', path: '/duplicate/ignored' },
          { name: 'rg', available: false },
        ],
        available_cli_tools: ['git'],
      },
    }).metadata).toEqual(expect.objectContaining({
      cliTools: [
        { name: 'kubectl', available: true, path: '/usr/local/bin/kubectl' },
        { name: 'rg', available: false, path: '' },
      ],
      availableCliTools: ['git', 'kubectl'],
    }));
  });

  test('requires command jobs to include a command', () => {
    expect(() => normalizeCommandJob({})).toThrow('job.command is required');
  });

  test('maps remote command workingDirectory to runner cwd', () => {
    expect(normalizeCommandJob({
      command: 'pwd',
      workingDirectory: '/workspace/app',
      profile: 'inspect',
    })).toEqual(expect.objectContaining({
      command: 'pwd',
      cwd: '/workspace/app',
      profile: 'inspect',
    }));
  });

  test('flags privileged commands for approval gating', () => {
    expect(isDangerousCommand('sudo systemctl restart k3s')).toBe(true);
    expect(isDangerousCommand('kubectl get pods -A -o wide')).toBe(false);
  });
});
