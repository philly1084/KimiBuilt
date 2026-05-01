const http = require('http');
const {
  createStatusServer,
  createSymphonyDaemon,
  parseArgs,
  resolveDaemonConfig,
  startSymphonyDaemon,
} = require('./symphony-daemon');

function requestJson(port, pathname = '/') {
  return new Promise((resolve, reject) => {
    const req = http.get({
      host: '127.0.0.1',
      port,
      path: pathname,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: JSON.parse(body),
        });
      });
    });
    req.on('error', reject);
  });
}

describe('symphony daemon wiring', () => {
  test('parseArgs accepts workflow, gateway, key, status port, and once', () => {
    expect(parseArgs([
      '--workflow', 'ops/WORKFLOW.md',
      '--gateway', 'http://gateway.local',
      '--api-key', 'front',
      '--port', '0',
      '--once',
    ])).toEqual(expect.objectContaining({
      workflowPath: 'ops/WORKFLOW.md',
      codexAgentBaseUrl: 'http://gateway.local',
      codexAgentApiKey: 'front',
      statusPort: 0,
      once: true,
    }));
  });

  test('resolveDaemonConfig falls back through expected environment variables', () => {
    const config = resolveDaemonConfig({
      argv: [],
      cwd: 'C:\\repo',
      env: {
        WORKFLOW_PATH: 'workflow/custom.md',
        KIMIBUILT_BACKEND_URL: 'http://backend.local',
        FRONTEND_API_KEY: 'front-key',
        SYMPHONY_STATUS_PORT: '3131',
        SYMPHONY_RUN_ONCE: 'true',
      },
    });

    expect(config).toEqual(expect.objectContaining({
      workflowPath: 'workflow/custom.md',
      cwd: 'C:\\repo',
      codexAgentBaseUrl: 'http://backend.local',
      codexAgentApiKey: 'front-key',
      statusPort: 3131,
      once: true,
    }));
  });

  test('createSymphonyDaemon wires injected loader, runner, and orchestrator', () => {
    const workflowLoader = { id: 'loader' };
    const agentRunner = jest.fn();
    const orchestrator = { id: 'orchestrator' };
    const daemon = createSymphonyDaemon({
      argv: ['--workflow', 'WORKFLOW.md'],
      env: {},
      workflowLoader,
      agentRunner,
      orchestrator,
    });

    expect(daemon.workflowLoader).toBe(workflowLoader);
    expect(daemon.agentRunner).toBe(agentRunner);
    expect(daemon.orchestrator).toBe(orchestrator);
  });

  test('createStatusServer exposes health and snapshot JSON', async () => {
    const server = createStatusServer({
      snapshot: () => ({
        running: [],
        retrying: [],
        codex_totals: { input_tokens: 1 },
      }),
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    await expect(requestJson(port, '/health')).resolves.toEqual({
      statusCode: 200,
      body: { ok: true },
    });
    await expect(requestJson(port, '/snapshot')).resolves.toEqual({
      statusCode: 200,
      body: expect.objectContaining({
        running: [],
        codex_totals: { input_tokens: 1 },
      }),
    });

    await new Promise((resolve) => server.close(resolve));
  });

  test('startSymphonyDaemon starts, runs once, and stops injected orchestrator', async () => {
    const orchestrator = {
      start: jest.fn(async () => {}),
      tick: jest.fn(async () => {}),
      stop: jest.fn(),
    };
    const result = await startSymphonyDaemon({
      argv: ['--once'],
      env: {},
      orchestrator,
      workflowLoader: { id: 'loader' },
      agentRunner: jest.fn(),
      logger: { log: jest.fn() },
    });

    expect(result.orchestrator).toBe(orchestrator);
    expect(orchestrator.start).toHaveBeenCalledTimes(1);
    expect(orchestrator.tick).toHaveBeenCalledTimes(1);
    expect(orchestrator.stop).toHaveBeenCalledTimes(1);
  });
});
