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
});
