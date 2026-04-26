'use strict';

const {
  RunnerCommandTransport,
  executeWithRunnerPreference,
  shouldPreferRunner,
} = require('./transport');

describe('RunnerCommandTransport', () => {
  test('passes workingDirectory to remote runner cwd', async () => {
    const dispatchCommand = jest.fn(async () => ({
      stdout: '/workspace/app',
      stderr: '',
      exitCode: 0,
      duration: 10,
      host: 'runner-host',
    }));
    const transport = new RunnerCommandTransport({
      runnerService: {
        getHealthyRunner: jest.fn(() => ({ runnerId: 'runner-1' })),
        dispatchCommand,
      },
    });

    const result = await transport.execute({
      command: 'pwd',
      workingDirectory: '/workspace/app',
      profile: 'inspect',
      contextFiles: [{ filename: 'research.json', content: '{}' }],
    }, {
      sessionId: 'session-1',
      toolId: 'remote-command',
    });

    expect(result.stdout).toBe('/workspace/app');
    expect(dispatchCommand).toHaveBeenCalledWith('', expect.objectContaining({
      command: 'pwd',
      cwd: '/workspace/app',
      profile: 'inspect',
      metadata: expect.objectContaining({
        contextFiles: [{ filename: 'research.json', content: '{}' }],
      }),
    }), expect.objectContaining({
      sessionId: 'session-1',
      toolId: 'remote-command',
    }));
  });
});

describe('remote runner transport preference', () => {
  test('preferRunner overrides SSH target params', () => {
    expect(shouldPreferRunner({
      host: '10.0.0.5',
      username: 'ubuntu',
      preferRunner: true,
    })).toBe(true);
  });

  test('requireRunner blocks SSH fallback when no runner is online', async () => {
    await expect(executeWithRunnerPreference({
      params: {
        command: 'pwd',
        host: '10.0.0.5',
        requireRunner: true,
      },
      fallback: jest.fn(),
    })).rejects.toThrow('No healthy remote runner is online');
  });
});
