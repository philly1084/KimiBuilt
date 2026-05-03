const fs = require('fs/promises');
const os = require('os');
const path = require('path');

describe('LogsController persistence', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  test('reloads persisted logs from jsonl storage', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kimibuilt-logs-'));
    process.env = {
      ...originalEnv,
      KIMIBUILT_STATE_DIR: stateDir,
    };

    try {
      const initialModule = require('./logs.controller');
      const { LogsController, getLogsStoragePath } = initialModule;
      const controller = new LogsController({ storagePath: getLogsStoragePath() });
      controller.addLog({
        level: 'info',
        status: 'success',
        message: 'Persist me',
      });

      const reloaded = new LogsController({ storagePath: getLogsStoragePath() });
      expect(reloaded.logs[0]).toEqual(expect.objectContaining({
        level: 'info',
        status: 'success',
        message: 'Persist me',
      }));
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });
});
