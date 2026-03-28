const { K3sDeployTool } = require('./K3sDeployTool');

describe('K3sDeployTool', () => {
  test('builds sync-and-apply command with repo sync and kubectl apply', async () => {
    const tool = new K3sDeployTool();
    tool.sshTool.handler = jest.fn().mockResolvedValue({
      stdout: 'applied',
      stderr: '',
      exitCode: 0,
      duration: 25,
      host: 'server:22',
    });

    const result = await tool.execute({
      action: 'sync-and-apply',
      repositoryUrl: 'https://github.com/example/app.git',
      ref: 'main',
      targetDirectory: '/opt/app',
      manifestsPath: 'k8s',
      namespace: 'kimibuilt',
      deployment: 'backend',
    });

    expect(result.success).toBe(true);
    expect(tool.sshTool.handler).toHaveBeenCalledTimes(1);
    const command = tool.sshTool.handler.mock.calls[0][0].command;
    expect(command).toContain("git clone --branch 'main' --single-branch 'https://github.com/example/app.git' '/opt/app'");
    expect(command).toContain("kubectl apply -f '/opt/app/k8s'");
    expect(command).toContain("kubectl rollout status deployment/backend -n 'kimibuilt' --timeout=180s");
  });

  test('rejects non-github repository urls for sync', async () => {
    const tool = new K3sDeployTool();

    const result = await tool.execute({
      action: 'sync-repo',
      repositoryUrl: 'https://gitlab.com/example/app.git',
      targetDirectory: '/opt/app',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Only GitHub clone URLs are allowed');
  });
});
