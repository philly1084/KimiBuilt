jest.mock('../../../../routes/admin/settings.controller', () => ({
  getEffectiveSshConfig: jest.fn(() => ({
    enabled: false,
    host: '',
    port: 22,
    username: '',
    password: '',
    privateKeyPath: '',
  })),
}));

const { SSHExecuteTool } = require('./SSHExecuteTool');

describe('SSHExecuteTool', () => {
  test('buildExecutionScript safely assembles working directory and environment', () => {
    const tool = new SSHExecuteTool();

    const script = tool.buildExecutionScript({
      command: 'hostname && uptime',
      workingDirectory: "/srv/app's current",
      environment: {
        NODE_ENV: 'production',
        INVALID_KEY_NAME: 'kept',
        'bad-key': 'ignored',
      },
    });

    expect(script).toContain(`cd -- '/srv/app'"'"'s current'`);
    expect(script).toContain(`export NODE_ENV='production'`);
    expect(script).toContain(`export INVALID_KEY_NAME='kept'`);
    expect(script).not.toContain('bad-key');
    expect(script).toContain('hostname && uptime');
  });

  test('buildRemoteLauncher prefers bash with fallback to sh and supports sudo', () => {
    const tool = new SSHExecuteTool();

    expect(tool.buildRemoteLauncher()).toContain('exec bash -seuo pipefail');
    expect(tool.buildRemoteLauncher()).toContain('exec sh -seu');
    expect(tool.buildRemoteLauncher({ sudo: true })).toContain('exec sudo -n bash -seuo pipefail');
  });

  test('enrichExecutionError adds Ubuntu and arm64 hints for common failures', () => {
    const tool = new SSHExecuteTool();
    const error = new Error('sh: 1: rg: not found');
    error.stderr = 'sh: 1: rg: not found\ncannot execute binary file: Exec format error';

    const enriched = tool.enrichExecutionError(error, {
      command: 'rg -n TODO && ./vendor/tool-linux-amd64',
      host: '10.0.0.5:22',
    });

    expect(enriched.hints).toEqual(expect.arrayContaining([
      expect.stringContaining('`rg` is often not installed on Ubuntu servers'),
      expect.stringContaining('This host may be ARM64/aarch64'),
    ]));
    expect(enriched.message).toContain('Hints:');
  });

  test('stripBenignSshWarnings removes known-hosts noise from stderr', () => {
    const tool = new SSHExecuteTool();
    const cleaned = tool.stripBenignSshWarnings([
      "Warning: Permanently added 'test.demoserver2.buzz' (ED25519) to the list of known hosts.",
      'kubectl: command not found',
    ].join('\n'));

    expect(cleaned).toBe('kubectl: command not found');
  });
});
