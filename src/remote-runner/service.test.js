'use strict';

const { EventEmitter } = require('events');
const { WebSocket } = require('ws');
const { RemoteRunnerService } = require('./service');

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = WebSocket.OPEN;
    this.sent = [];
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  }
}

describe('RemoteRunnerService', () => {
  test('rejects unauthenticated runner requests', () => {
    const service = new RemoteRunnerService({
      config: {
        enabled: true,
        token: 'secret',
      },
    });

    expect(() => service.authenticateToken('wrong')).toThrow('Invalid remote runner token');
  });

  test('registers a websocket runner and dispatches command jobs', async () => {
    const service = new RemoteRunnerService({
      config: {
        enabled: true,
        token: 'secret',
        staleAfterMs: 45000,
        jobTimeoutMs: 30000,
      },
    });
    const socket = new FakeSocket();
    service.registerRunner({
      runnerId: 'runner-1',
      capabilities: ['inspect', 'deploy'],
      allowedRoots: ['/opt'],
    }, socket);

    const pending = service.dispatchCommand('runner-1', {
      command: 'hostname',
      timeout: 30000,
    }, {
      ownerId: 'phil',
      sessionId: 'session-1',
    });

    expect(socket.sent[0]).toEqual(expect.objectContaining({
      type: 'job',
      job: expect.objectContaining({
        command: 'hostname',
      }),
    }));

    service.handleJobResult({
      jobId: socket.sent[0].job.id,
      stdout: 'deploy-host\n',
      stderr: '',
      exitCode: 0,
      duration: 10,
      host: 'runner-host',
    });

    await expect(pending).resolves.toEqual(expect.objectContaining({
      stdout: 'deploy-host\n',
      exitCode: 0,
      host: 'runner-host',
    }));
    expect(service.getJob(socket.sent[0].job.id)).toEqual(expect.objectContaining({
      status: 'completed',
      ownerId: 'phil',
      sessionId: 'session-1',
    }));
  });
});
