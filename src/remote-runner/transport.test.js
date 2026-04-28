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

  test('blocks invalid kubectl set --add syntax before dispatching to runner', async () => {
    const dispatchCommand = jest.fn();
    const transport = new RunnerCommandTransport({
      runnerService: {
        getHealthyRunner: jest.fn(() => ({ runnerId: 'runner-1' })),
        dispatchCommand,
      },
    });

    await expect(transport.execute({
      command: 'kubectl set --add volume deployment/gamer -n gamer',
      profile: 'deploy',
    }, {
      toolId: 'remote-command',
    })).rejects.toThrow('kubectl set --add');

    expect(dispatchCommand).not.toHaveBeenCalled();
  });

  test('enriches failed runner kubectl output with k3s hints', async () => {
    const transport = new RunnerCommandTransport({
      runnerService: {
        getHealthyRunner: jest.fn(() => ({ runnerId: 'runner-1' })),
        dispatchCommand: jest.fn(async () => ({
          stdout: '',
          stderr: 'error: strict decoding error: unknown field "spec.app"',
          exitCode: 1,
          duration: 10,
          host: 'runner-host',
        })),
      },
    });

    await expect(transport.execute({
      command: 'kubectl apply -f /tmp/gamer.yaml',
      profile: 'deploy',
    }, {
      toolId: 'remote-command',
    })).rejects.toThrow('dry-run=server');
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
