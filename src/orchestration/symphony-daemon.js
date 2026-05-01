const http = require('http');
const { createCodexGatewayAgentRunner } = require('./codex-gateway-runner');
const { SymphonyOrchestrator } = require('./symphony-orchestrator');
const { WorkflowLoader } = require('./workflow-loader');

function normalizeText(value = '') {
  return String(value || '').trim();
}

function parseArgs(argv = []) {
  const args = {
    workflowPath: '',
    codexAgentBaseUrl: '',
    codexAgentApiKey: '',
    statusPort: null,
    once: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--help' || value === '-h') {
      args.help = true;
      continue;
    }
    if (value === '--workflow' || value === '--workflow-path') {
      args.workflowPath = normalizeText(argv[index + 1]);
      index += 1;
      continue;
    }
    if (value === '--codex-agent-base-url' || value === '--gateway') {
      args.codexAgentBaseUrl = normalizeText(argv[index + 1]);
      index += 1;
      continue;
    }
    if (value === '--codex-agent-api-key' || value === '--api-key') {
      args.codexAgentApiKey = normalizeText(argv[index + 1]);
      index += 1;
      continue;
    }
    if (value === '--status-port' || value === '--port') {
      args.statusPort = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (value === '--once') {
      args.once = true;
    }
  }

  return args;
}

function resolveDaemonConfig({
  argv = [],
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const args = parseArgs(argv);
  const workflowPath = normalizeText(args.workflowPath)
    || normalizeText(env.SYMPHONY_WORKFLOW_PATH)
    || normalizeText(env.WORKFLOW_PATH)
    || 'WORKFLOW.md';
  const codexAgentBaseUrl = normalizeText(args.codexAgentBaseUrl)
    || normalizeText(env.CODEX_AGENT_BASE_URL)
    || normalizeText(env.SYMPHONY_CODEX_AGENT_BASE_URL)
    || normalizeText(env.KIMIBUILT_CODEX_AGENT_BASE_URL)
    || normalizeText(env.KIMIBUILT_BACKEND_URL)
    || normalizeText(env.API_BASE_URL)
    || 'http://localhost:3000';
  const codexAgentApiKey = normalizeText(args.codexAgentApiKey)
    || normalizeText(env.CODEX_AGENT_API_KEY)
    || normalizeText(env.FRONTEND_API_KEY)
    || normalizeText(env.KIMIBUILT_FRONTEND_API_KEY)
    || '';
  const statusPort = Number.isFinite(args.statusPort)
    ? args.statusPort
    : Number(env.SYMPHONY_STATUS_PORT || env.SYMPHONY_PORT || NaN);

  return {
    help: args.help,
    once: args.once || /^(?:1|true|yes)$/i.test(normalizeText(env.SYMPHONY_RUN_ONCE)),
    workflowPath,
    cwd,
    codexAgentBaseUrl,
    codexAgentApiKey,
    statusPort: Number.isFinite(statusPort) ? statusPort : null,
  };
}

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: kimibuilt-symphony [--workflow WORKFLOW.md] [--codex-agent-base-url URL] [--codex-agent-api-key KEY] [--status-port PORT] [--once]',
    '',
    'Environment:',
    '  SYMPHONY_WORKFLOW_PATH        Path to WORKFLOW.md. Defaults to ./WORKFLOW.md.',
    '  CODEX_AGENT_BASE_URL          Gateway base URL exposing /api/codex-agent/*.',
    '  FRONTEND_API_KEY              Bearer key for the Codex frontend-agent API.',
    '  SYMPHONY_STATUS_PORT          Optional local JSON status server port.',
    '',
  ].join('\n'));
}

function createStatusServer(orchestrator) {
  return http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === '/snapshot' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(orchestrator.snapshot()));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });
}

function createSymphonyDaemon({
  argv = [],
  env = process.env,
  cwd = process.cwd(),
  logger = console,
  fetchImpl = global.fetch,
  workflowLoader = null,
  agentRunner = null,
  orchestrator = null,
} = {}) {
  const daemonConfig = resolveDaemonConfig({ argv, env, cwd });
  const loader = workflowLoader || new WorkflowLoader({
    workflowPath: daemonConfig.workflowPath,
    cwd,
    env,
    logger,
  });
  const runner = agentRunner || createCodexGatewayAgentRunner({
    baseUrl: daemonConfig.codexAgentBaseUrl,
    apiKey: daemonConfig.codexAgentApiKey,
    fetchImpl,
    logger,
  });
  const symphony = orchestrator || new SymphonyOrchestrator({
    workflowLoader: loader,
    agentRunner: runner,
    logger,
  });

  return {
    config: daemonConfig,
    workflowLoader: loader,
    agentRunner: runner,
    orchestrator: symphony,
  };
}

async function startSymphonyDaemon(options = {}) {
  const logger = options.logger || console;
  const daemon = createSymphonyDaemon({ ...options, logger });
  if (daemon.config.help) {
    printUsage(options.stderr || process.stderr);
    return { ...daemon, statusServer: null };
  }

  let statusServer = null;
  await daemon.orchestrator.start();
  logger.log?.(`[Symphony] started workflow=${daemon.config.workflowPath} codex_agent_base_url=${daemon.config.codexAgentBaseUrl}`);

  if (daemon.config.statusPort != null) {
    statusServer = createStatusServer(daemon.orchestrator);
    await new Promise((resolve) => {
      statusServer.listen(daemon.config.statusPort, resolve);
    });
    logger.log?.(`[Symphony] status_server_started port=${statusServer.address().port}`);
  }

  if (daemon.config.once) {
    await daemon.orchestrator.tick();
    daemon.orchestrator.stop();
    if (statusServer) {
      await new Promise((resolve) => statusServer.close(resolve));
    }
  }

  return {
    ...daemon,
    statusServer,
  };
}

module.exports = {
  createStatusServer,
  createSymphonyDaemon,
  parseArgs,
  printUsage,
  resolveDaemonConfig,
  startSymphonyDaemon,
};
