jest.mock('./logs.controller', () => ({
  addLog: jest.fn(),
}));

jest.mock('./traces.controller', () => ({
  addTrace: jest.fn(),
  traces: new Map(),
}));

jest.mock('../../memory/vector-store', () => ({
  vectorStore: {},
}));

jest.mock('../../agent-sdk/registry/UnifiedRegistry', () => ({
  getUnifiedRegistry: jest.fn(() => ({
    on: jest.fn(),
  })),
}));

const DashboardController = require('./dashboard.controller');
const tracesController = require('./traces.controller');

describe('DashboardController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('includes execution trace steps in the admin timeline', () => {
    const controller = new DashboardController(null);
    const task = controller.recordRuntimeTaskStart({
      sessionId: 'session-1',
      input: 'Use remote-build to inspect the cluster and keep going.',
      model: 'gpt-test',
      mode: 'chat',
      transport: 'http',
      metadata: {},
    });

    controller.recordRuntimeTaskComplete(task.id, {
      responseId: 'resp-1',
      output: 'Completed the obvious next server checks.',
      model: 'gpt-test',
      duration: 1200,
      metadata: {
        executionTrace: [
          {
            type: 'approval',
            name: 'Remote-build autonomy approved',
            status: 'completed',
            startTime: '2026-03-22T12:00:00.000Z',
            endTime: '2026-03-22T12:00:00.050Z',
            details: {
              approved: true,
              source: 'frontend',
            },
          },
          {
            type: 'planning',
            name: 'Plan round 1',
            status: 'completed',
            startTime: '2026-03-22T12:00:00.050Z',
            endTime: '2026-03-22T12:00:00.150Z',
            details: {
              round: 1,
              stepCount: 2,
            },
          },
        ],
        toolEvents: [
          {
            toolCall: {
              function: {
                name: 'ssh-execute',
                arguments: JSON.stringify({ command: 'hostname && uptime' }),
              },
            },
            result: {
              success: true,
              duration: 400,
            },
            reason: 'Inspect the remote host',
          },
        ],
      },
    });

    const trace = tracesController.addTrace.mock.calls[0][0];
    expect(trace.timeline.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      'Remote-build autonomy approved',
      'Plan round 1',
      'Tool call (ssh-execute)',
      'Model response (gpt-test)',
    ]));
    expect(trace.timeline.find((entry) => entry.name === 'Remote-build autonomy approved')).toMatchObject({
      type: 'approval',
      details: expect.objectContaining({
        approved: true,
        source: 'frontend',
      }),
    });
  });
});
