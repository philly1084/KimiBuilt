const { K3sDeployTool } = require('./K3sDeployTool');

describe('K3sDeployTool', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      GITHUB_TOKEN: 'ghp_test_token',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

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
    const request = tool.sshTool.handler.mock.calls[0][0];
    const command = request.command;
    expect(command).toContain("git clone --branch 'main' --single-branch 'https://github.com/example/app.git' '/opt/app'");
    expect(command).toContain('export GIT_ASKPASS="$git_askpass_script"');
    expect(command).toContain('if [ -f "$manifest_dir/namespace.yaml" ]; then kubectl apply -f "$manifest_dir/namespace.yaml"; fi');
    expect(command).toContain('if [ -f "$manifest_dir/cluster-issuer.yaml" ]; then kubectl apply -f "$manifest_dir/cluster-issuer.yaml"; fi');
    expect(command).toContain('namespace.yaml|cluster-issuer.yaml|secret.yaml|rancher-simple.yaml|rancher-stack-update.yaml');
    expect(command).toContain("kubectl rollout status deployment/backend -n 'kimibuilt' --timeout=180s");
    expect(request.environment).toEqual(expect.objectContaining({
      GITHUB_TOKEN: 'ghp_test_token',
      KIMIBUILT_GIT_PASSWORD: 'ghp_test_token',
    }));
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

  test('converts GitHub SSH clone URLs to HTTPS when a token is available', () => {
    const tool = new K3sDeployTool();
    const command = tool.buildSyncRepoCommand({
      repositoryUrl: 'git@github.com:example/app.git',
      ref: 'main',
      targetDirectory: '/opt/app',
    });

    expect(command).toContain("git clone --branch 'main' --single-branch 'https://github.com/example/app.git' '/opt/app'");
  });
});
