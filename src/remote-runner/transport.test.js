'use strict';

const { RunnerCommandTransport } = require('./transport');

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
