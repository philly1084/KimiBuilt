describe('runtime state path resolution', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('falls back to the user state directory when the project root is not writable', () => {
    process.env = { ...originalEnv };

    jest.doMock('os', () => ({
      homedir: () => '/home/kimibuilt',
    }));

    jest.doMock('fs', () => ({
      constants: {
        F_OK: 0,
        W_OK: 2,
      },
      accessSync: jest.fn((targetPath, mode) => {
        if (mode === 0 && targetPath === '/app/soul.md') {
          const error = new Error('ENOENT');
          error.code = 'ENOENT';
          throw error;
        }

        if (mode === 2 && targetPath === '/app') {
          const error = new Error('EACCES');
          error.code = 'EACCES';
          throw error;
        }

        return undefined;
      }),
    }));

    jest.doMock('path', () => jest.requireActual('path').posix);

    const { resolvePreferredWritableFile } = require('./runtime-state-paths');

    expect(resolvePreferredWritableFile('/app/soul.md', ['soul.md'])).toBe('/home/kimibuilt/.kimibuilt/soul.md');
  });

  test('keeps the project file when the repo path is writable', () => {
    process.env = { ...originalEnv };

    jest.doMock('os', () => ({
      homedir: () => '/home/kimibuilt',
    }));

    jest.doMock('fs', () => ({
      constants: {
        F_OK: 0,
        W_OK: 2,
      },
      accessSync: jest.fn(() => undefined),
    }));

    jest.doMock('path', () => jest.requireActual('path').posix);

    const { resolvePreferredWritableFile } = require('./runtime-state-paths');

    expect(resolvePreferredWritableFile('/app/soul.md', ['soul.md'])).toBe('/app/soul.md');
  });

  test('prefers the configured state directory even when the repo path is writable', () => {
    process.env = {
      ...originalEnv,
      KIMIBUILT_STATE_DIR: '/persistent/runtime-state',
    };

    jest.doMock('os', () => ({
      homedir: () => '/home/kimibuilt',
    }));

    jest.doMock('fs', () => ({
      constants: {
        F_OK: 0,
        W_OK: 2,
      },
      accessSync: jest.fn(() => undefined),
    }));

    jest.doMock('path', () => jest.requireActual('path').posix);

    const { resolvePreferredWritableFile } = require('./runtime-state-paths');

    expect(resolvePreferredWritableFile('/app/soul.md', ['soul.md'])).toBe('/persistent/runtime-state/soul.md');
  });
});
