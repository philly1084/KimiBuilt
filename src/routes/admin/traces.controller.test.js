const fs = require('fs/promises');
const os = require('os');
const path = require('path');

describe('TracesController persistence', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  test('does not seed demo traces by default and reloads persisted traces', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kimibuilt-traces-'));
    process.env = {
      ...originalEnv,
      KIMIBUILT_STATE_DIR: stateDir,
    };

    try {
      const initialModule = require('./traces.controller');
      const { TracesController, getTracesStoragePath } = initialModule;
      const controller = new TracesController({ storagePath: getTracesStoragePath() });
      expect(controller.traces.size).toBe(0);

      controller.addTrace({
        id: 'trace-runtime-1',
        taskId: 'task-1',
        sessionId: 'session-1',
        status: 'completed',
        startTime: '2026-05-03T00:00:00.000Z',
        endTime: '2026-05-03T00:00:01.000Z',
        duration: 1000,
        model: 'gpt-test',
        input: 'hello',
        output: 'world',
        timeline: [],
        metrics: {},
        createdAt: '2026-05-03T00:00:00.000Z',
      });

      const reloaded = new TracesController({ storagePath: getTracesStoragePath() });
      expect(reloaded.traces.get('trace-runtime-1')).toEqual(expect.objectContaining({
        taskId: 'task-1',
        status: 'completed',
      }));
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });
});
