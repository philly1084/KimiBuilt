'use strict';

const { config } = require('../config');

function normalizeText(value = '') {
  return String(value || '').trim();
}

function trimTrailingSlash(value = '') {
  return normalizeText(value).replace(/\/+$/, '');
}

function normalizePositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(parsed, max));
}

function isOfficialOpenAIBaseURL(baseURL = '') {
  try {
    const parsed = new URL(baseURL);
    return parsed.hostname === 'api.openai.com' || parsed.hostname.endsWith('.api.openai.com');
  } catch (_error) {
    return false;
  }
}

function resolveAgentsApiMode({ requestedMode = '', baseURL = '' } = {}) {
  const normalized = normalizeText(requestedMode).toLowerCase();
  if (normalized === 'responses' || normalized === 'chat') {
    return normalized;
  }
  return isOfficialOpenAIBaseURL(baseURL) ? 'responses' : 'chat';
}

function loadAgentsSdk() {
  return require('@openai/agents');
}

function buildRemoteCliInstructions({
  targetId,
  cwd,
  sessionId = '',
  waitMs = 30000,
  extraInstructions = '',
} = {}) {
  return [
    'You can modify the remote server using the remote-cli MCP tools.',
    '',
    'Use remote_code_run for coding tasks.',
    `Default targetId: ${targetId}`,
    cwd ? `Default cwd: ${cwd}` : 'Default cwd: use the gateway target default.',
    '',
    'Start with compact discovery before edits: repo-map, changed-files, k8s-manifest-summary, and targeted-grep style commands are preferred over reading the whole codebase.',
    'For maintenance work, inspect only changed files, package scripts, manifests, rollout state, logs, and targeted symbols relevant to the task.',
    'For k3s delivery, use an inspect -> focused edit -> focused test/build -> image/deploy -> deploy-verify loop.',
    `For long tasks, call remote_code_run with waitMs: ${waitMs}.`,
    'If it returns status "running", call remote_code_status with the returned jobId.',
    'If continuing prior work, reuse the returned sessionId.',
    sessionId ? `Current prior remote CLI sessionId: ${sessionId}` : '',
    'Do not try to pass raw shell commands; only use the exposed tool schema.',
    extraInstructions,
  ].filter(Boolean).join('\n');
}

function buildRemoteCliPrompt({
  task,
  targetId,
  cwd,
  sessionId = '',
  waitMs = 30000,
} = {}) {
  return [
    `Task: ${task}`,
    '',
    'Execution defaults:',
    `- targetId: ${targetId}`,
    cwd ? `- cwd: ${cwd}` : '',
    sessionId ? `- continue remote CLI sessionId: ${sessionId}` : '',
    `- waitMs: ${waitMs}`,
  ].filter(Boolean).join('\n');
}

class RemoteCliAgentsSdkRunner {
  constructor(options = {}) {
    this.sdkLoader = options.sdkLoader || loadAgentsSdk;
    this.config = options.config || config.remoteCliMcp || {};
  }

  getPublicConfig() {
    return {
      enabled: this.config.enabled !== false,
      configured: Boolean(normalizeText(this.config.url) && normalizeText(this.config.apiKey)),
      url: normalizeText(this.config.url),
      name: normalizeText(this.config.name) || 'remote-cli',
      defaultTargetId: normalizeText(this.config.defaultTargetId) || 'prod',
      defaultCwd: normalizeText(this.config.defaultCwd),
      agentModel: normalizeText(this.config.agentModel),
      timeoutMs: normalizePositiveInteger(this.config.timeoutMs, 60000, { min: 1000 }),
      maxTurns: normalizePositiveInteger(this.config.maxTurns, 20, { min: 1, max: 80 }),
    };
  }

  assertConfigured() {
    if (this.config.enabled === false) {
      throw new Error('Remote CLI MCP integration is disabled.');
    }
    if (!normalizeText(this.config.url)) {
      throw new Error('REMOTE_CLI_MCP_URL or GATEWAY_URL is required for remote-cli-agent.');
    }
    if (!normalizeText(this.config.apiKey)) {
      throw new Error('REMOTE_CLI_MCP_BEARER_TOKEN or N8N_API_KEY is required for remote-cli-agent.');
    }
    if (!normalizeText(this.config.agentApiKey)) {
      throw new Error('REMOTE_CLI_AGENT_OPENAI_API_KEY or OPENAI_API_KEY is required for remote-cli-agent.');
    }
  }

  createMcpServer(MCPServerStreamableHttp, params = {}) {
    const url = normalizeText(params.url || this.config.url);
    const token = normalizeText(params.apiKey || this.config.apiKey);
    const name = normalizeText(params.name || this.config.name) || 'remote-cli';
    const timeoutMs = normalizePositiveInteger(params.timeoutMs || this.config.timeoutMs, 60000, { min: 1000 });

    return new MCPServerStreamableHttp({
      url,
      name,
      cacheToolsList: true,
      timeout: timeoutMs,
      ...(params.mcpSessionId ? { sessionId: normalizeText(params.mcpSessionId) } : {}),
      requestInit: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });
  }

  createModelProvider(OpenAIProvider) {
    return new OpenAIProvider({
      apiKey: normalizeText(this.config.agentApiKey),
      baseURL: normalizeText(this.config.agentBaseURL) || undefined,
    });
  }

  async run(input = {}) {
    const task = normalizeText(input.task || input.prompt || input.message);
    if (!task) {
      throw new Error('remote-cli-agent requires a task.');
    }
    this.assertConfigured();

    const sdk = this.sdkLoader();
    const {
      Agent,
      MCPServerStreamableHttp,
      OpenAIProvider,
      Runner,
      setOpenAIAPI,
    } = sdk;

    if (!Agent || !MCPServerStreamableHttp || !OpenAIProvider || !Runner) {
      throw new Error('@openai/agents is installed but did not expose the expected Agents SDK classes.');
    }

    const targetId = normalizeText(input.targetId || input.target_id || this.config.defaultTargetId) || 'prod';
    const cwd = normalizeText(input.cwd || input.workingDirectory || input.working_directory || this.config.defaultCwd);
    const sessionId = normalizeText(input.sessionId || input.session_id || input.remoteSessionId || input.remote_session_id);
    const waitMs = normalizePositiveInteger(input.waitMs || input.wait_ms, 30000, { min: 1000, max: 300000 });
    const maxTurns = normalizePositiveInteger(input.maxTurns || input.max_turns || this.config.maxTurns, 20, { min: 1, max: 80 });
    const model = normalizeText(input.model || this.config.agentModel) || 'gpt-4o';
    const apiMode = resolveAgentsApiMode({
      requestedMode: this.config.agentApiMode,
      baseURL: this.config.agentBaseURL,
    });

    if (typeof setOpenAIAPI === 'function') {
      setOpenAIAPI(apiMode);
    }

    const remoteCli = this.createMcpServer(MCPServerStreamableHttp, input);
    const instructions = buildRemoteCliInstructions({
      targetId,
      cwd,
      sessionId,
      waitMs,
      extraInstructions: input.instructions || input.extraInstructions || '',
    });
    const agent = new Agent({
      name: normalizeText(input.agentName || input.agent_name) || 'Remote coding agent',
      model,
      instructions,
      mcpServers: [remoteCli],
    });
    const runner = new Runner({
      model,
      modelProvider: this.createModelProvider(OpenAIProvider),
      tracingDisabled: true,
      workflowName: 'Remote CLI MCP coding task',
    });

    try {
      await remoteCli.connect();
      const result = await runner.run(agent, buildRemoteCliPrompt({
        task,
        targetId,
        cwd,
        sessionId,
        waitMs,
      }), {
        maxTurns,
      });

      return {
        finalOutput: result.finalOutput || '',
        mcpSessionId: remoteCli.sessionId || input.mcpSessionId || null,
        targetId,
        cwd,
        sessionId: sessionId || null,
        model,
        apiMode,
      };
    } finally {
      await remoteCli.close().catch((error) => {
        console.warn('[RemoteCliAgentsSdkRunner] Failed to close MCP connection:', error.message);
      });
    }
  }
}

const remoteCliAgentsSdkRunner = new RemoteCliAgentsSdkRunner();

module.exports = {
  RemoteCliAgentsSdkRunner,
  buildRemoteCliInstructions,
  buildRemoteCliPrompt,
  remoteCliAgentsSdkRunner,
  resolveAgentsApiMode,
  trimTrailingSlash,
};
