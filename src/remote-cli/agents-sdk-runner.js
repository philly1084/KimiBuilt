'use strict';

const { config } = require('../config');
const settingsController = require('../routes/admin/settings.controller');

function normalizeText(value = '') {
  return String(value || '').trim();
}

function trimTrailingSlash(value = '') {
  return normalizeText(value).replace(/\/+$/, '');
}

function cleanMarkerValue(value = '') {
  return normalizeText(value)
    .replace(/^`+|`+$/g, '')
    .replace(/^"+|"+$/g, '')
    .replace(/^'+|'+$/g, '');
}

function readMarkerLine(text = '', keys = []) {
  const keyPattern = keys
    .map((key) => String(key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  if (!keyPattern) {
    return '';
  }

  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(new RegExp(`^\\s*(?:[-*]\\s*)?(?:${keyPattern})\\s*[:=]\\s*(.+?)\\s*$`, 'i'));
    if (match?.[1]) {
      return cleanMarkerValue(match[1]);
    }
  }

  return '';
}

function readMarkerLines(text = '', keys = []) {
  const keyPattern = keys
    .map((key) => String(key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  if (!keyPattern) {
    return [];
  }

  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.match(new RegExp(`^\\s*(?:[-*]\\s*)?(?:${keyPattern})\\s*[:=]\\s*(.+?)\\s*$`, 'i'))?.[1] || '')
    .map((value) => cleanMarkerValue(value))
    .filter(Boolean);
}

function extractRemoteCliRunMetadata(finalOutput = '') {
  const text = String(finalOutput || '');
  const sessionId = readMarkerLine(text, ['REMOTE_CLI_SESSION_ID', 'REMOTE_CODE_SESSION_ID'])
    || cleanMarkerValue(text.match(/remote\s+session\s*:\s*`?([^`\s]+)/i)?.[1] || '');
  const workspace = readMarkerLine(text, ['WORKSPACE', 'REMOTE_WORKSPACE', 'CWD'])
    || cleanMarkerValue(text.match(/workspace\s*:\s*`?([^`\n]+)/i)?.[1] || '');
  const gitRepo = readMarkerLine(text, ['GIT_REPO', 'GIT_REMOTE', 'REPOSITORY'])
    || cleanMarkerValue(text.match(/(?:git\s+repo|repository)\s*:\s*`?([^`\n]+)/i)?.[1] || '');
  const gitCommit = readMarkerLine(text, ['GIT_COMMIT', 'COMMIT'])
    || cleanMarkerValue(text.match(/(?:git\s+commit|commit)\s*:\s*`?([a-f0-9]{7,40})/i)?.[1] || '');
  const deployment = readMarkerLine(text, ['DEPLOYMENT', 'K8S_DEPLOYMENT']);
  const publicHost = readMarkerLine(text, ['PUBLIC_HOST', 'HOST', 'URL'])
    || cleanMarkerValue(text.match(/https?:\/\/([^/\s`]+)/i)?.[1] || '');
  const uiCheckReport = readMarkerLine(text, ['UI_CHECK_REPORT']);
  const uiScreenshots = Array.from(new Set(
    readMarkerLines(text, ['UI_SCREENSHOTS', 'UI_SCREENSHOT'])
      .flatMap((value) => value.split(','))
      .map((value) => cleanMarkerValue(value))
      .filter(Boolean),
  ));

  return {
    ...(sessionId ? { sessionId } : {}),
    ...(workspace ? { workspace } : {}),
    ...(gitRepo ? { gitRepo } : {}),
    ...(gitCommit ? { gitCommit } : {}),
    ...(deployment ? { deployment } : {}),
    ...(publicHost ? { publicHost } : {}),
    ...(uiCheckReport ? { uiCheckReport } : {}),
    ...(uiScreenshots.length > 0 ? { uiScreenshots } : {}),
  };
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

function resolveConfiguredGiteaContext() {
  const gitea = typeof settingsController.getEffectiveGiteaConfig === 'function'
    ? settingsController.getEffectiveGiteaConfig()
    : config.gitea || {};

  const baseURL = normalizeText(gitea.baseURL);
  const org = normalizeText(gitea.org) || 'agent-apps';
  return {
    configured: Boolean(gitea.enabled !== false && baseURL),
    baseURL,
    org,
    registryHost: normalizeText(gitea.registryHost),
    hasToken: Boolean(normalizeText(gitea.token || process.env.GITEA_TOKEN)),
  };
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
  gitea = resolveConfiguredGiteaContext(),
} = {}) {
  return [
    'You can modify the remote server using the remote-cli MCP tools.',
    '',
    'Use remote_code_run for coding tasks.',
    `Default targetId: ${targetId}`,
    cwd ? `Default cwd: ${cwd}` : 'Default cwd: use the gateway target default.',
    '',
    'Treat the target as a persistent private workbench for the user: create project files, inspect state, build, test, deploy, and verify from the remote workspace when the task calls for it.',
    'Keep autonomy bounded by the task and existing safety rules. Do not mutate secrets, perform destructive deletes, force-push, install privileged packages, or leave the approved workspace without a clear user request.',
    'Start with compact discovery before edits: repo-map, changed-files, k8s-manifest-summary, and targeted-grep style commands are preferred over reading the whole codebase.',
    'For maintenance work, inspect only changed files, package scripts, manifests, rollout state, logs, and targeted symbols relevant to the task.',
    'For k3s delivery, use an inspect -> focused edit -> focused test/build -> image/deploy -> deploy-verify loop.',
    'For any k3s website/app create or edit, use a git-backed workspace as the source of truth before touching the live cluster.',
    gitea?.configured ? `Configured Gitea: ${gitea.baseURL} (org: ${gitea.org}).` : '',
    'Prefer an existing configured Gitea remote for the app. If no remote is present, initialize a local git repo in the remote workspace and commit the deployable state before build/deploy; add a Gitea remote when the task or workspace exposes one.',
    gitea?.configured ? 'For new apps without a remote, create or use a repository under the configured Gitea org when GITEA_TOKEN is available; otherwise keep a local git repo and report that no Gitea token or remote was available.' : '',
    'Before committing in a fresh remote workspace, set repo-local git user.name and user.email if they are missing.',
    'For follow-up edits, inspect git status, git log, and the current source files first. Patch the existing source, preserve prior content/assets unless explicitly replacing them, commit the change, then rebuild/redeploy.',
    'Use live Kubernetes resources, mounted files, or ConfigMaps as diagnostics or recovery input only; do not leave them as the only editable source of truth for a deployed site.',
    'For website, dashboard, or frontend work, include visual QA in the build package: run Playwright/Chromium screenshots for desktop and mobile states when the target exposes a local preview or public URL.',
    'If the KimiBuilt runner helper is present, prefer `node /app/bin/kimibuilt-ui-check.js <url> --out ui-checks` and inspect its JSON report before claiming the UI is ready.',
    'Report screenshot and report paths with marker lines when known: UI_CHECK_REPORT=<path> and UI_SCREENSHOTS=<comma-separated paths>.',
    `For long tasks, call remote_code_run with waitMs: ${waitMs}.`,
    'If it returns status "running", call remote_code_status with the returned jobId.',
    'If continuing prior work, reuse the returned sessionId.',
    sessionId ? `Current prior remote CLI sessionId: ${sessionId}` : '',
    'Do not try to pass raw shell commands; only use the exposed tool schema.',
    'Finish with marker lines for continuity when known: REMOTE_CLI_SESSION_ID=<remote_code_run sessionId>, WORKSPACE=<path>, GIT_REPO=<origin or local repo>, GIT_COMMIT=<sha>, DEPLOYMENT=<namespace/name>, PUBLIC_HOST=<host>.',
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

      const finalOutput = result.finalOutput || '';
      const runMetadata = extractRemoteCliRunMetadata(finalOutput);

      return {
        finalOutput,
        mcpSessionId: remoteCli.sessionId || input.mcpSessionId || null,
        targetId,
        cwd: runMetadata.workspace || cwd,
        sessionId: runMetadata.sessionId || sessionId || null,
        remoteCodeSessionId: runMetadata.sessionId || sessionId || null,
        gitRepo: runMetadata.gitRepo || null,
        gitCommit: runMetadata.gitCommit || null,
        deployment: runMetadata.deployment || null,
        publicHost: runMetadata.publicHost || null,
        uiCheckReport: runMetadata.uiCheckReport || null,
        uiScreenshots: runMetadata.uiScreenshots || [],
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
  extractRemoteCliRunMetadata,
  remoteCliAgentsSdkRunner,
  resolveConfiguredGiteaContext,
  resolveAgentsApiMode,
  trimTrailingSlash,
};
