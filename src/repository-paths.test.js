describe('repository path helpers', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('falls back to a managed workspace when the cwd is not a git repo', () => {
    jest.doMock('fs', () => ({
      constants: {
        F_OK: 0,
      },
      accessSync: jest.fn((targetPath) => {
        if (String(targetPath).endsWith('/workspace/.git')) {
          const error = new Error('ENOENT');
          error.code = 'ENOENT';
          throw error;
        }
        throw new Error(`Unexpected fs access for ${targetPath}`);
      }),
    }));

    jest.doMock('path', () => jest.requireActual('path').posix);

    const { resolveDefaultRepositoryPath } = require('./repository-paths');

    expect(resolveDefaultRepositoryPath({
      currentWorkingDirectory: '/workspace',
      dataDir: '/home/kimibuilt/.kimibuilt',
      repositoryUrl: 'https://github.com/example/app.git',
    })).toMatch(/^\/home\/kimibuilt\/\.kimibuilt\/workspaces\/example-app-[0-9a-f]{8}$/);
  });

  test('keeps an explicit default repository path when configured', () => {
    const { resolveDefaultRepositoryPath } = require('./repository-paths');

    expect(resolveDefaultRepositoryPath({
      explicitPath: '/srv/repos/kimibuilt',
      currentWorkingDirectory: '/workspace',
      dataDir: '/home/kimibuilt/.kimibuilt',
      repositoryUrl: 'https://github.com/example/app.git',
    })).toBe(require('path').resolve('/srv/repos/kimibuilt'));
  });
});
