const fs = require('fs');

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

jest.mock('../../../../artifacts/artifact-service', () => ({
  artifactService: {
    getArtifact: jest.fn(),
  },
}));

jest.mock('../../../../research-buckets', () => ({
  researchBucketService: {
    ensureInitialized: jest.fn(),
    getRootPath: jest.fn(() => '/tmp/research-buckets/shared'),
    resolveSafePath: jest.fn(),
    validateSafeGlob: jest.fn((pattern) => pattern),
  },
}));

const { SSHExecuteTool } = require('./SSHExecuteTool');
const { artifactService } = require('../../../../artifacts/artifact-service');
const { researchBucketService } = require('../../../../research-buckets');

describe('SSHExecuteTool', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

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

  test('buildExecutionScript stages context files before running the command', () => {
    const tool = new SSHExecuteTool();

    const script = tool.buildExecutionScript({
      command: 'npm run build',
      contextFiles: [{
        filename: 'research.json',
        mimeType: 'application/json',
        content: '{"ok":true}',
      }],
    });

    expect(script).toContain('KIMIBUILT_CONTEXT_DIR=');
    expect(script).toContain('manifest.json');
    expect(script).toContain('research.json');
    expect(script).toContain('base64 -d > "$KIMIBUILT_CONTEXT_DIR/research.json"');
    expect(script).toContain('npm run build');
  });

  test('prepareContextFiles loads selected session artifacts for remote staging', async () => {
    const tool = new SSHExecuteTool();
    artifactService.getArtifact.mockResolvedValue({
      id: 'artifact-1',
      sessionId: 'session-1',
      filename: 'hero.png',
      mimeType: 'image/png',
      contentBuffer: Buffer.from('png-bytes'),
      sha256: 'sha',
      metadata: { title: 'Hero' },
    });

    const files = await tool.prepareContextFiles({
      artifactIds: ['artifact-1'],
    }, {
      sessionId: 'session-1',
    });

    expect(files).toEqual([
      expect.objectContaining({
        filename: 'hero.png',
        mimeType: 'image/png',
        artifactId: 'artifact-1',
        source: 'artifact',
        sizeBytes: 9,
      }),
    ]);
  });

  test('prepareContextFiles stages selected research bucket media with extensions preserved', async () => {
    const tool = new SSHExecuteTool();
    researchBucketService.resolveSafePath.mockReturnValue({
      absolutePath: '/tmp/research-buckets/shared/images/hero.png',
      relativePath: 'images/hero.png',
    });
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({
      isFile: () => true,
      size: 9,
    });
    jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('png-bytes'));

    const files = await tool.prepareContextFiles({
      researchBucketPaths: ['images/hero.png'],
    }, {});

    expect(files).toEqual([
      expect.objectContaining({
        filename: 'images__hero.png',
        mimeType: 'image/png',
        source: 'research-bucket',
        sourceUrl: 'research-bucket://images/hero.png',
        sizeBytes: 9,
      }),
    ]);
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

  test('enrichExecutionError explains remote inline Python indentation failures', () => {
    const tool = new SSHExecuteTool();
    const error = new Error('IndentationError: expected an indented block after if statement on line 7');
    error.stderr = '  File "<stdin>", line 8\nIndentationError: expected an indented block after if statement on line 7';

    const enriched = tool.enrichExecutionError(error, {
      command: "python3 - <<'PY'\nif marker:\nprint(marker)\nPY",
      host: '10.0.0.5:22',
    });

    expect(enriched.hints).toEqual(expect.arrayContaining([
      expect.stringContaining('Inline Python failed before the remote edit ran'),
    ]));
    expect(enriched.message).toContain('stage a real script/file');
  });

  test('stripBenignSshWarnings removes known-hosts noise from stderr', () => {
    const tool = new SSHExecuteTool();
    const cleaned = tool.stripBenignSshWarnings([
      "Warning: Permanently added 'test.demoserver2.buzz' (ED25519) to the list of known hosts.",
      'kubectl: command not found',
    ].join('\n'));

    expect(cleaned).toBe('kubectl: command not found');
  });

  test('execute honors per-call timeout overrides beyond the default backend timeout', async () => {
    jest.useFakeTimers();

    const tool = new SSHExecuteTool();
    jest.spyOn(tool, 'getConnectionConfig').mockResolvedValue({
      host: '10.0.0.5',
      port: 22,
      username: 'ubuntu',
      password: 'secret',
      privateKeyPath: '',
    });
    jest.spyOn(tool, 'buildExecutionScript').mockReturnValue('echo ok');
    const executeSsh = jest.spyOn(tool, 'executeSSH').mockImplementation((_connection, _script, timeout) => (
      new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            stdout: 'ok',
            stderr: '',
            exitCode: 0,
            duration: 70000,
            host: '10.0.0.5:22',
            observedTimeout: timeout,
          });
        }, 70000);
      })
    ));

    const executionPromise = tool.execute({
      command: 'echo ok',
      timeout: 120000,
    }, {});

    await jest.advanceTimersByTimeAsync(70000);
    const result = await executionPromise;

    expect(result.success).toBe(true);
    expect(executeSsh).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '10.0.0.5',
        username: 'ubuntu',
      }),
      'echo ok',
      120000,
      expect.objectContaining({
        originalCommand: 'echo ok',
      }),
    );
  });
});
