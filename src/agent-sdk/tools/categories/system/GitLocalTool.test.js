const { GitLocalTool } = require('./GitLocalTool');

describe('GitLocalTool', () => {
  test('builds save-and-push flow with staged paths and current branch push', async () => {
    const tool = new GitLocalTool();
    const commands = [];

    tool.resolveRepoRoot = jest.fn().mockResolvedValue('/repo');
    tool.getCurrentBranch = jest.fn().mockResolvedValue('master');
    tool.spawnGit = jest.fn().mockImplementation(async (args) => {
      commands.push(args);
      return {
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        duration: 5,
      };
    });

    const result = await tool.execute({
      action: 'save-and-push',
      repositoryPath: '/repo',
      paths: ['src/app.js'],
      message: 'Update app',
    });

    expect(result.success).toBe(true);
    expect(commands).toEqual([
      ['add', '--', 'src/app.js'],
      ['commit', '-m', 'Update app'],
      ['push', 'origin', 'master'],
    ]);
  });

  test('rejects invalid pathspecs that look like flags', async () => {
    const tool = new GitLocalTool();
    tool.resolveRepoRoot = jest.fn().mockResolvedValue('/repo');

    const result = await tool.execute({
      action: 'add',
      repositoryPath: '/repo',
      paths: ['--all'],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('cannot start with');
  });

  test('reports branch, head, upstream, and remotes without failing when upstream is missing', async () => {
    const tool = new GitLocalTool();

    tool.resolveRepoRoot = jest.fn().mockResolvedValue('/repo');
    tool.getCurrentBranch = jest.fn().mockResolvedValue('main');
    tool.spawnGit = jest.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'abc123', stderr: '', duration: 3 })
      .mockRejectedValueOnce(Object.assign(new Error('no upstream'), {
        exitCode: 128,
        stdout: '',
        stderr: 'fatal: no upstream configured',
      }))
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'origin https://github.com/example/repo.git (fetch)\norigin https://github.com/example/repo.git (push)',
        stderr: '',
        duration: 4,
      });

    const result = await tool.execute({
      action: 'remote-info',
      repositoryPath: '/repo',
    });

    expect(result.success).toBe(true);
    expect(result.data.stdout).toContain('branch: main');
    expect(result.data.stdout).toContain('head: abc123');
    expect(result.data.stdout).toContain('upstream: none');
    expect(result.data.stdout).toContain('origin https://github.com/example/repo.git (fetch)');
  });
});
