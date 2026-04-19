const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('./routes/admin/settings.controller', () => ({
  getEffectiveSshConfig: jest.fn(() => ({
    enabled: true,
    host: 'ubuntu-32gb-fsn1-2',
    port: 22,
    username: 'ubuntu',
  })),
  getEffectiveDeployConfig: jest.fn(() => ({
    repositoryUrl: 'https://github.com/example/app.git',
    targetDirectory: '/opt/kimibuilt',
    manifestsPath: 'k8s',
    namespace: 'web',
    deployment: 'site',
    container: 'site',
    branch: 'main',
    publicDomain: 'game.demoserver2.buzz',
    ingressClassName: 'traefik',
    tlsClusterIssuer: 'letsencrypt-prod',
  })),
}));

const { ClusterStateRegistry } = require('./cluster-state-registry');

describe('ClusterStateRegistry', () => {
  let registry;
  let storageDir;
  let storagePath;

  beforeEach(() => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimibuilt-cluster-registry-'));
    storagePath = path.join(storageDir, 'cluster-state-registry.json');
    registry = new ClusterStateRegistry();
    registry.setStoragePathForTests(storagePath);
  });

  afterEach(() => {
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  test('records deploy and verification context from remote tool events', () => {
    registry.recordToolEvents({
      objective: 'Deploy the game host to game.demoserver2.buzz and verify ingress, TLS, HTTPS, /app/index.html, and the nginx site file.',
      controlState: {
        lastSshTarget: {
          host: 'ubuntu-32gb-fsn1-2',
          username: 'ubuntu',
          port: 22,
        },
      },
      toolEvents: [
        {
          toolCall: {
            function: {
              name: 'k3s-deploy',
              arguments: JSON.stringify({
                repositoryUrl: 'https://github.com/example/app.git',
                ref: 'main',
                targetDirectory: '/opt/kimibuilt',
                manifestsPath: 'k8s',
                namespace: 'web',
                deployment: 'site',
              }),
            },
          },
          result: {
            success: true,
            toolId: 'k3s-deploy',
            timestamp: '2026-04-18T12:00:00.000Z',
            data: {
              action: 'sync-and-apply',
              host: 'ubuntu-32gb-fsn1-2:22',
              command: 'kubectl rollout status deployment/site -n \'web\' --timeout=180s',
              stdout: 'deployment "site" successfully rolled out',
            },
          },
          reason: 'Run the standard k3s deployment flow.',
        },
        {
          toolCall: {
            function: {
              name: 'remote-command',
              arguments: JSON.stringify({
                workflowAction: 'verify-deployment',
                command: [
                  'set -e',
                  'kubectl rollout status deployment/site -n \'web\' --timeout=180s',
                  'kubectl get svc,ingress -n \'web\'',
                  'expected_host=\'game.demoserver2.buzz\'',
                  'tls_secret=$(kubectl get ingress -n \'web\' -o jsonpath=\'{range .items[*].spec.tls[*]}{.secretName}{"\\n"}{end}\' | grep -v \'^$\' | head -n 1 || true)',
                  'kubectl get secret "$tls_secret" -n \'web\' >/dev/null',
                  'curl -fsSIL --max-time 20 "https://$host"',
                  'find /app -maxdepth 2 -type f',
                  'ls /etc/nginx/sites-available/game.demoserver2.buzz',
                ].join('\n'),
              }),
            },
          },
          result: {
            success: true,
            toolId: 'remote-command',
            timestamp: '2026-04-18T12:05:00.000Z',
            data: {
              host: 'ubuntu-32gb-fsn1-2:22',
              stdout: [
                '--- ingress hosts ---',
                'game.demoserver2.buzz',
                'HTTP/2 200',
                '/app/index.html',
                '/etc/nginx/sites-available/game.demoserver2.buzz',
              ].join('\n'),
            },
          },
          reason: 'Verify ingress, TLS, and public HTTPS.',
        },
      ],
    });

    const deployments = registry.listDeployments();
    expect(deployments).toHaveLength(1);
    expect(deployments[0]).toEqual(expect.objectContaining({
      host: 'ubuntu-32gb-fsn1-2',
      namespace: 'web',
      deployment: 'site',
      publicDomain: 'game.demoserver2.buzz',
    }));
    expect(deployments[0].verification).toEqual(expect.objectContaining({
      rollout: true,
      ingress: true,
      tls: true,
      https: true,
    }));
    expect(deployments[0].paths).toEqual(expect.arrayContaining([
      '/app/index.html',
      '/etc/nginx/sites-available/game.demoserver2.buzz',
    ]));

    const summary = registry.buildPromptSummary();
    expect(summary).toContain('game.demoserver2.buzz');
    expect(summary).toContain('/app/index.html');
    expect(summary).toContain('rollout yes');

    const reloadedRegistry = new ClusterStateRegistry();
    reloadedRegistry.setStoragePathForTests(storagePath);
    expect(reloadedRegistry.getRuntimeSummary()).toEqual(expect.objectContaining({
      targetCount: 1,
      deploymentCount: 1,
    }));
  });
});
