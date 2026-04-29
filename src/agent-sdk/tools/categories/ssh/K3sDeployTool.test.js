jest.mock('../../../../routes/admin/settings.controller', () => ({
  getEffectiveDeployConfig: jest.fn(() => ({
    repositoryUrl: '',
    targetDirectory: '/opt/kimibuilt',
    manifestsPath: 'k8s',
    namespace: 'kimibuilt',
    deployment: 'backend',
    container: 'backend',
    branch: 'master',
    publicDomain: 'demoserver2.buzz',
    ingressClassName: 'traefik',
    tlsClusterIssuer: 'letsencrypt-prod',
  })),
  getEffectiveGiteaConfig: jest.fn(() => ({
    enabled: true,
    baseURL: 'https://gitea.demoserver2.buzz',
    token: 'gitea_test_token',
    org: 'agent-apps',
    registryHost: 'gitea.demoserver2.buzz',
    registryUsername: 'git',
  })),
}));

const settingsController = require('../../../../routes/admin/settings.controller');
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

  test('builds sync-and-apply command with repo sync and kubectl apply without an implicit rollout target', async () => {
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
    expect(command).toContain('ingress-https.yaml)');
    expect(command).toContain('if [ -f "$manifest_dir/ingress.yaml" ]; then continue; fi');
    expect(command).not.toContain('kubectl rollout status deployment/');
    expect(request.environment).toEqual(expect.objectContaining({
      GITHUB_TOKEN: 'ghp_test_token',
      KIMIBUILT_GIT_PASSWORD: 'ghp_test_token',
    }));
  });

  test('infers sync-and-apply when action is omitted for deploy-shaped params', async () => {
    const tool = new K3sDeployTool();
    tool.sshTool.handler = jest.fn().mockResolvedValue({
      stdout: 'deployment "backend" successfully rolled out',
      stderr: '',
      exitCode: 0,
      duration: 18,
      host: 'server:22',
    });

    const result = await tool.execute({
      repositoryUrl: 'https://github.com/example/app.git',
      ref: 'main',
      targetDirectory: '/opt/app',
      manifestsPath: 'k8s',
      namespace: 'kimibuilt',
    });

    expect(result.success).toBe(true);
    expect(result.data.action).toBe('sync-and-apply');
    expect(tool.sshTool.handler).toHaveBeenCalledTimes(1);
    expect(tool.sshTool.handler.mock.calls[0][0].command).not.toContain('kubectl rollout status deployment/');
  });

  test('includes rollout status in sync-and-apply only when deployment is explicitly provided', async () => {
    const tool = new K3sDeployTool();
    tool.sshTool.handler = jest.fn().mockResolvedValue({
      stdout: 'deployment "backend" successfully rolled out',
      stderr: '',
      exitCode: 0,
      duration: 18,
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
    expect(tool.sshTool.handler.mock.calls[0][0].command).toContain("kubectl rollout status deployment/backend -n 'kimibuilt' --timeout=180s");
  });

  test('rejects repository urls outside GitHub and configured Gitea', async () => {
    const tool = new K3sDeployTool();

    const result = await tool.execute({
      action: 'sync-repo',
      repositoryUrl: 'https://gitlab.com/example/app.git',
      targetDirectory: '/opt/app',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Only GitHub clone URLs or the configured Gitea host are allowed');
  });

  test('allows configured Gitea repositories and supplies Gitea credentials', async () => {
    const tool = new K3sDeployTool();
    tool.sshTool.handler = jest.fn().mockResolvedValue({
      stdout: 'synced',
      stderr: '',
      exitCode: 0,
      duration: 11,
      host: 'server:22',
    });

    const result = await tool.execute({
      action: 'sync-repo',
      repositoryUrl: 'https://gitea.demoserver2.buzz/agent-apps/site.git',
      ref: 'main',
      targetDirectory: '/srv/apps/site',
    });

    expect(result.success).toBe(true);
    const request = tool.sshTool.handler.mock.calls[0][0];
    expect(request.command).toContain("git clone --branch 'main' --single-branch 'https://gitea.demoserver2.buzz/agent-apps/site.git' '/srv/apps/site'");
    expect(request.environment).toEqual(expect.objectContaining({
      GITEA_TOKEN: 'gitea_test_token',
      KIMIBUILT_GIT_USERNAME: 'git',
      KIMIBUILT_GIT_PASSWORD: 'gitea_test_token',
    }));
  });

  test('normalizes configured Gitea SSH clone URLs to HTTPS when a token is available', () => {
    const tool = new K3sDeployTool();
    const command = tool.buildSyncRepoCommand({
      repositoryUrl: 'git@gitea.demoserver2.buzz:agent-apps/site.git',
      ref: 'main',
      targetDirectory: '/srv/apps/site',
    });

    expect(command).toContain("git clone --branch 'main' --single-branch 'https://gitea.demoserver2.buzz/agent-apps/site.git' '/srv/apps/site'");
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

  test('uses admin deploy defaults when rollout-status omits deployment details', () => {
    settingsController.getEffectiveDeployConfig.mockReturnValue({
      repositoryUrl: '',
      targetDirectory: '/opt/kimibuilt',
      manifestsPath: 'k8s',
      namespace: 'web',
      deployment: 'site',
      container: 'site',
      branch: 'main',
      publicDomain: 'demoserver2.buzz',
      ingressClassName: 'traefik',
      tlsClusterIssuer: 'letsencrypt-prod',
    });

    const tool = new K3sDeployTool();
    const command = tool.buildRolloutStatusCommand({}, { allowDefaultDeployment: true });

    expect(command).toContain("kubectl rollout status deployment/site -n 'web' --timeout=180s");
  });
});
