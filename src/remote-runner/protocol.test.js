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

  test('requires command jobs to include a command', () => {
    expect(() => normalizeCommandJob({})).toThrow('job.command is required');
  });

  test('flags privileged commands for approval gating', () => {
    expect(isDangerousCommand('sudo systemctl restart k3s')).toBe(true);
    expect(isDangerousCommand('kubectl get pods -A -o wide')).toBe(false);
  });
});
