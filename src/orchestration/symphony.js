const os = require('os');
const path = require('path');

const DEFAULT_ACTIVE_STATES = Object.freeze(['Todo', 'In Progress']);
const DEFAULT_TERMINAL_STATES = Object.freeze(['Closed', 'Cancelled', 'Canceled', 'Duplicate', 'Done']);
const DEFAULT_POLL_INTERVAL_MS = 30000;
const DEFAULT_HOOK_TIMEOUT_MS = 60000;
const DEFAULT_MAX_CONCURRENT_AGENTS = 10;
const DEFAULT_MAX_RETRY_BACKOFF_MS = 300000;
const DEFAULT_CODEX_COMMAND = 'codex app-server';
const DEFAULT_CODEX_TURN_TIMEOUT_MS = 3600000;
const DEFAULT_CODEX_READ_TIMEOUT_MS = 5000;
const DEFAULT_CODEX_STALL_TIMEOUT_MS = 300000;
const CONTINUATION_RETRY_DELAY_MS = 1000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeState(value = '') {
  return normalizeText(value).toLowerCase();
}

function toPositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.floor(numeric);
}

function splitInlineList(value = '') {
  const trimmed = normalizeText(value);
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return null;
  }
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) {
    return [];
  }
  return inner.split(',').map((entry) => parseScalar(entry)).filter((entry) => entry !== '');
}

function parseScalar(value = '') {
  const trimmed = normalizeText(value);
  if (!trimmed) {
    return '';
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  const inlineList = splitInlineList(trimmed);
  if (inlineList) {
    return inlineList;
  }
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (trimmed === 'null' || trimmed === '~') {
    return null;
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

function parseSimpleYaml(frontMatter = '') {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  const lines = String(frontMatter || '').replace(/\r\n/g, '\n').split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) {
      continue;
    }

    const indent = rawLine.match(/^\s*/)[0].length;
    const line = rawLine.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].value;

    if (line.startsWith('- ')) {
      if (!Array.isArray(parent)) {
        throw new Error('workflow_parse_error: YAML list item has no list parent');
      }
      parent.push(parseScalar(line.slice(2)));
      continue;
    }

    const match = line.match(/^([^:]+):(.*)$/);
    if (!match) {
      throw new Error(`workflow_parse_error: invalid YAML line ${index + 1}`);
    }

    const key = normalizeText(match[1]);
    const rest = match[2] || '';
    if (!key) {
      throw new Error(`workflow_parse_error: empty YAML key on line ${index + 1}`);
    }

    if (rest.trim() === '|') {
      const block = [];
      const blockIndent = indent + 2;
      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1];
        const nextIndent = nextLine.match(/^\s*/)[0].length;
        if (nextLine.trim() && nextIndent < blockIndent) {
          break;
        }
        index += 1;
        block.push(nextLine.slice(Math.min(blockIndent, nextLine.length)));
      }
      parent[key] = block.join('\n').replace(/\s+$/, '');
      continue;
    }

    if (!rest.trim()) {
      const next = lines.slice(index + 1).find((candidate) => candidate.trim() && !candidate.trim().startsWith('#'));
      const nextTrimmed = next ? next.trim() : '';
      parent[key] = nextTrimmed.startsWith('- ') ? [] : {};
      stack.push({ indent, value: parent[key] });
      continue;
    }

    parent[key] = parseScalar(rest);
  }

  return root;
}

function parseWorkflowMarkdown(contents = '') {
  const text = String(contents || '').replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) {
    return {
      config: {},
      prompt_template: text.trim(),
    };
  }

  const end = text.indexOf('\n---', 4);
  if (end === -1) {
    throw new Error('workflow_parse_error: unterminated YAML front matter');
  }

  const config = parseSimpleYaml(text.slice(4, end));
  if (!isPlainObject(config)) {
    throw new Error('workflow_front_matter_not_a_map');
  }

  return {
    config,
    prompt_template: text.slice(end + 4).trim(),
  };
}

function resolveEnvToken(value, env = process.env) {
  const text = typeof value === 'string' ? value.trim() : value;
  if (typeof text !== 'string' || !text.startsWith('$') || !/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(text)) {
    return value;
  }
  return env[text.slice(1)] || '';
}

function expandPathLike(value, env = process.env) {
  let resolved = resolveEnvToken(value, env);
  if (typeof resolved !== 'string') {
    return resolved;
  }
  if (resolved === '~') {
    return os.homedir();
  }
  if (resolved.startsWith(`~${path.sep}`) || resolved.startsWith('~/')) {
    return path.join(os.homedir(), resolved.slice(2));
  }
  return resolved;
}

function normalizeStringList(value, fallback = []) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const normalized = value.map((entry) => normalizeText(entry)).filter(Boolean);
  return normalized.length > 0 ? normalized : [...fallback];
}

function normalizeStateLimitMap(value = {}) {
  if (!isPlainObject(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value)
    .map(([state, limit]) => [normalizeState(state), toPositiveInteger(limit, 0)])
    .filter(([state, limit]) => state && limit > 0));
}

function buildServiceConfig(workflowConfig = {}, env = process.env) {
  const tracker = isPlainObject(workflowConfig.tracker) ? workflowConfig.tracker : {};
  const polling = isPlainObject(workflowConfig.polling) ? workflowConfig.polling : {};
  const workspace = isPlainObject(workflowConfig.workspace) ? workflowConfig.workspace : {};
  const hooks = isPlainObject(workflowConfig.hooks) ? workflowConfig.hooks : {};
  const agent = isPlainObject(workflowConfig.agent) ? workflowConfig.agent : {};
  const codex = isPlainObject(workflowConfig.codex) ? workflowConfig.codex : {};
  const worker = isPlainObject(workflowConfig.worker) ? workflowConfig.worker : {};
  const server = isPlainObject(workflowConfig.server) ? workflowConfig.server : {};

  const trackerKind = normalizeText(tracker.kind);
  const apiKey = resolveEnvToken(tracker.api_key || (trackerKind === 'linear' ? '$LINEAR_API_KEY' : ''), env);
  const workspaceRoot = expandPathLike(workspace.root || path.join(os.tmpdir(), 'symphony_workspaces'), env);

  return {
    tracker: {
      kind: trackerKind,
      endpoint: normalizeText(tracker.endpoint) || (trackerKind === 'linear' ? 'https://api.linear.app/graphql' : ''),
      api_key: normalizeText(apiKey),
      project_slug: normalizeText(tracker.project_slug),
      active_states: normalizeStringList(tracker.active_states, DEFAULT_ACTIVE_STATES),
      terminal_states: normalizeStringList(tracker.terminal_states, DEFAULT_TERMINAL_STATES),
    },
    polling: {
      interval_ms: toPositiveInteger(polling.interval_ms, DEFAULT_POLL_INTERVAL_MS),
    },
    workspace: {
      root: workspaceRoot,
    },
    hooks: {
      after_create: hooks.after_create || null,
      before_run: hooks.before_run || null,
      after_run: hooks.after_run || null,
      before_remove: hooks.before_remove || null,
      timeout_ms: toPositiveInteger(hooks.timeout_ms, DEFAULT_HOOK_TIMEOUT_MS),
    },
    agent: {
      max_concurrent_agents: toPositiveInteger(agent.max_concurrent_agents, DEFAULT_MAX_CONCURRENT_AGENTS),
      max_turns: toPositiveInteger(agent.max_turns, 20),
      max_retry_backoff_ms: toPositiveInteger(agent.max_retry_backoff_ms, DEFAULT_MAX_RETRY_BACKOFF_MS),
      max_concurrent_agents_by_state: normalizeStateLimitMap(agent.max_concurrent_agents_by_state),
    },
    worker: {
      ssh_hosts: normalizeStringList(worker.ssh_hosts, []),
      max_concurrent_agents_per_host: toPositiveInteger(worker.max_concurrent_agents_per_host, 0),
    },
    codex: {
      command: normalizeText(codex.command) || DEFAULT_CODEX_COMMAND,
      approval_policy: codex.approval_policy || null,
      thread_sandbox: codex.thread_sandbox || null,
      turn_sandbox_policy: codex.turn_sandbox_policy || null,
      turn_timeout_ms: toPositiveInteger(codex.turn_timeout_ms, DEFAULT_CODEX_TURN_TIMEOUT_MS),
      read_timeout_ms: toPositiveInteger(codex.read_timeout_ms, DEFAULT_CODEX_READ_TIMEOUT_MS),
      stall_timeout_ms: Number(codex.stall_timeout_ms) <= 0
        ? 0
        : toPositiveInteger(codex.stall_timeout_ms, DEFAULT_CODEX_STALL_TIMEOUT_MS),
    },
    server: {
      port: Number.isFinite(Number(server.port)) ? Number(server.port) : null,
    },
  };
}

function validateDispatchConfig(serviceConfig = {}) {
  const errors = [];
  const trackerKind = normalizeText(serviceConfig?.tracker?.kind);
  if (!trackerKind) {
    errors.push({ code: 'missing_tracker_kind', message: 'tracker.kind is required.' });
  } else if (trackerKind !== 'linear') {
    errors.push({ code: 'unsupported_tracker_kind', message: `Unsupported tracker.kind: ${trackerKind}` });
  }
  if (!normalizeText(serviceConfig?.tracker?.api_key)) {
    errors.push({ code: 'missing_tracker_api_key', message: 'tracker.api_key is required after environment resolution.' });
  }
  if (trackerKind === 'linear' && !normalizeText(serviceConfig?.tracker?.project_slug)) {
    errors.push({ code: 'missing_tracker_project_slug', message: 'tracker.project_slug is required for Linear dispatch.' });
  }
  if (!normalizeText(serviceConfig?.codex?.command)) {
    errors.push({ code: 'missing_codex_command', message: 'codex.command is required.' });
  }
  return {
    ok: errors.length === 0,
    errors,
  };
}

function sanitizeWorkspaceKey(identifier = '') {
  return normalizeText(identifier).replace(/[^A-Za-z0-9._-]/g, '_');
}

function isPathInsideRoot(childPath = '', rootPath = '') {
  const resolvedChild = path.resolve(childPath);
  const resolvedRoot = path.resolve(rootPath);
  const relative = path.relative(resolvedRoot, resolvedChild);
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveWorkspacePath(identifier = '', workspaceRoot = '') {
  const workspaceKey = sanitizeWorkspaceKey(identifier);
  if (!workspaceKey) {
    throw new Error('invalid_workspace_key');
  }
  const rootPath = path.resolve(workspaceRoot || path.join(os.tmpdir(), 'symphony_workspaces'));
  const workspacePath = path.resolve(rootPath, workspaceKey);
  if (!isPathInsideRoot(workspacePath, rootPath)) {
    throw new Error('workspace_path_outside_root');
  }
  return {
    workspace_key: workspaceKey,
    workspace_path: workspacePath,
    workspace_root: rootPath,
  };
}

function normalizeIssue(issue = {}) {
  return {
    id: normalizeText(issue.id),
    identifier: normalizeText(issue.identifier),
    title: normalizeText(issue.title),
    description: issue.description == null ? null : String(issue.description),
    priority: Number.isInteger(issue.priority) ? issue.priority : null,
    state: normalizeText(issue.state),
    branch_name: issue.branch_name || null,
    url: issue.url || null,
    labels: Array.isArray(issue.labels) ? issue.labels.map((label) => normalizeState(label)).filter(Boolean) : [],
    blocked_by: Array.isArray(issue.blocked_by) ? issue.blocked_by : [],
    created_at: issue.created_at || null,
    updated_at: issue.updated_at || null,
  };
}

function isBlockerTerminal(blocker = {}, terminalStates = []) {
  const blockerState = normalizeState(blocker.state);
  return Boolean(blockerState) && terminalStates.map(normalizeState).includes(blockerState);
}

function countRunningByState(running = new Map()) {
  const counts = new Map();
  for (const entry of running.values()) {
    const state = normalizeState(entry?.issue?.state || entry?.state);
    if (!state) {
      continue;
    }
    counts.set(state, (counts.get(state) || 0) + 1);
  }
  return counts;
}

function getAvailableSlots({
  running = new Map(),
  maxConcurrentAgents = DEFAULT_MAX_CONCURRENT_AGENTS,
  state = '',
  maxConcurrentAgentsByState = {},
} = {}) {
  const globalLimit = toPositiveInteger(maxConcurrentAgents, DEFAULT_MAX_CONCURRENT_AGENTS);
  const globalSlots = Math.max(globalLimit - running.size, 0);
  const normalizedState = normalizeState(state);
  const stateLimit = maxConcurrentAgentsByState[normalizedState];
  if (!stateLimit) {
    return globalSlots;
  }
  const stateCounts = countRunningByState(running);
  return Math.min(globalSlots, Math.max(stateLimit - (stateCounts.get(normalizedState) || 0), 0));
}

function isIssueDispatchEligible(issue = {}, runtimeState = {}, serviceConfig = {}) {
  const normalizedIssue = normalizeIssue(issue);
  const activeStates = normalizeStringList(serviceConfig?.tracker?.active_states, DEFAULT_ACTIVE_STATES).map(normalizeState);
  const terminalStates = normalizeStringList(serviceConfig?.tracker?.terminal_states, DEFAULT_TERMINAL_STATES).map(normalizeState);
  const state = normalizeState(normalizedIssue.state);

  if (!normalizedIssue.id || !normalizedIssue.identifier || !normalizedIssue.title || !state) {
    return { eligible: false, reason: 'missing_required_issue_fields' };
  }
  if (!activeStates.includes(state) || terminalStates.includes(state)) {
    return { eligible: false, reason: 'inactive_issue_state' };
  }
  if (runtimeState.running?.has?.(normalizedIssue.id)) {
    return { eligible: false, reason: 'already_running' };
  }
  if (runtimeState.claimed?.has?.(normalizedIssue.id)) {
    return { eligible: false, reason: 'already_claimed' };
  }
  if (state === 'todo' && normalizedIssue.blocked_by.some((blocker) => !isBlockerTerminal(blocker, terminalStates))) {
    return { eligible: false, reason: 'blocked_todo_issue' };
  }

  const slots = getAvailableSlots({
    running: runtimeState.running || new Map(),
    maxConcurrentAgents: serviceConfig?.agent?.max_concurrent_agents,
    state,
    maxConcurrentAgentsByState: serviceConfig?.agent?.max_concurrent_agents_by_state || {},
  });
  if (slots <= 0) {
    return { eligible: false, reason: 'no_available_slots' };
  }

  return { eligible: true, reason: 'eligible' };
}

function compareIssuePriority(a = {}, b = {}) {
  const aPriority = Number.isInteger(a.priority) ? a.priority : Number.MAX_SAFE_INTEGER;
  const bPriority = Number.isInteger(b.priority) ? b.priority : Number.MAX_SAFE_INTEGER;
  if (aPriority !== bPriority) {
    return aPriority - bPriority;
  }
  const aCreated = Date.parse(a.created_at || '') || Number.MAX_SAFE_INTEGER;
  const bCreated = Date.parse(b.created_at || '') || Number.MAX_SAFE_INTEGER;
  if (aCreated !== bCreated) {
    return aCreated - bCreated;
  }
  return normalizeText(a.identifier).localeCompare(normalizeText(b.identifier));
}

function sortIssuesForDispatch(issues = []) {
  return [...(Array.isArray(issues) ? issues : [])].sort(compareIssuePriority);
}

function calculateRetryDelayMs(attempt = 1, maxRetryBackoffMs = DEFAULT_MAX_RETRY_BACKOFF_MS, { continuation = false } = {}) {
  if (continuation) {
    return CONTINUATION_RETRY_DELAY_MS;
  }
  const normalizedAttempt = toPositiveInteger(attempt, 1);
  const maxBackoff = toPositiveInteger(maxRetryBackoffMs, DEFAULT_MAX_RETRY_BACKOFF_MS);
  return Math.min(10000 * (2 ** (normalizedAttempt - 1)), maxBackoff);
}

function createRuntimeState(overrides = {}) {
  return {
    poll_interval_ms: DEFAULT_POLL_INTERVAL_MS,
    max_concurrent_agents: DEFAULT_MAX_CONCURRENT_AGENTS,
    running: new Map(),
    claimed: new Set(),
    retry_attempts: new Map(),
    completed: new Set(),
    codex_totals: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      seconds_running: 0,
    },
    codex_rate_limits: null,
    ...overrides,
  };
}

function extractTokenUsage(event = {}) {
  const payload = event.payload || event.usage || event;
  const usage = payload.total_token_usage || payload.tokenUsage || payload.usage || payload;
  const input = usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens ?? usage.promptTokens;
  const output = usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens ?? usage.completionTokens;
  const total = usage.total_tokens ?? usage.totalTokens ?? usage.tokens;
  return {
    input_tokens: Number.isFinite(Number(input)) ? Number(input) : null,
    output_tokens: Number.isFinite(Number(output)) ? Number(output) : null,
    total_tokens: Number.isFinite(Number(total)) ? Number(total) : null,
  };
}

function applyCodexEventToSession(session = {}, event = {}) {
  const timestamp = event.timestamp || new Date().toISOString();
  const usage = extractTokenUsage(event);
  const next = {
    ...session,
    codex_app_server_pid: event.codex_app_server_pid || session.codex_app_server_pid || null,
    last_codex_event: event.event || session.last_codex_event || null,
    last_codex_timestamp: timestamp,
    last_codex_message: event.message || event.summary || session.last_codex_message || null,
  };

  for (const key of ['input_tokens', 'output_tokens', 'total_tokens']) {
    if (usage[key] !== null) {
      const sessionKey = `codex_${key}`;
      next[sessionKey] = usage[key];
    }
  }
  return next;
}

function accumulateAbsoluteTokenDeltas(runtimeState = createRuntimeState(), session = {}) {
  const totals = runtimeState.codex_totals || {};
  const nextTotals = { ...totals };
  const tokenKeys = [
    ['input_tokens', 'codex_input_tokens', 'last_reported_input_tokens'],
    ['output_tokens', 'codex_output_tokens', 'last_reported_output_tokens'],
    ['total_tokens', 'codex_total_tokens', 'last_reported_total_tokens'],
  ];
  const nextSession = { ...session };

  for (const [totalKey, sessionKey, reportedKey] of tokenKeys) {
    const current = Number(nextSession[sessionKey] || 0);
    const previous = Number(nextSession[reportedKey] || 0);
    const delta = Math.max(current - previous, 0);
    if (delta > 0) {
      nextTotals[totalKey] = Number(nextTotals[totalKey] || 0) + delta;
      nextSession[reportedKey] = current;
    }
  }

  runtimeState.codex_totals = nextTotals;
  return nextSession;
}

function buildRuntimeSnapshot(runtimeState = createRuntimeState(), now = Date.now()) {
  const running = Array.from((runtimeState.running || new Map()).values()).map((entry) => ({
    issue_id: entry.issue_id || entry.issue?.id || null,
    issue_identifier: entry.issue_identifier || entry.issue?.identifier || null,
    state: entry.issue?.state || entry.state || null,
    session_id: entry.session?.session_id || null,
    turn_count: entry.session?.turn_count || 0,
    started_at: entry.started_at || null,
    workspace_path: entry.workspace_path || null,
  }));
  const activeSeconds = Array.from((runtimeState.running || new Map()).values()).reduce((sum, entry) => {
    const started = Number(entry.started_at_ms || Date.parse(entry.started_at || ''));
    return Number.isFinite(started) ? sum + Math.max((now - started) / 1000, 0) : sum;
  }, 0);

  return {
    running,
    retrying: Array.from((runtimeState.retry_attempts || new Map()).values()).map((entry) => ({
      issue_id: entry.issue_id,
      identifier: entry.identifier,
      attempt: entry.attempt,
      due_at_ms: entry.due_at_ms,
      error: entry.error || null,
    })),
    codex_totals: {
      input_tokens: Number(runtimeState.codex_totals?.input_tokens || 0),
      output_tokens: Number(runtimeState.codex_totals?.output_tokens || 0),
      total_tokens: Number(runtimeState.codex_totals?.total_tokens || 0),
      seconds_running: Number(runtimeState.codex_totals?.seconds_running || 0) + activeSeconds,
    },
    rate_limits: runtimeState.codex_rate_limits || null,
  };
}

module.exports = {
  CONTINUATION_RETRY_DELAY_MS,
  DEFAULT_ACTIVE_STATES,
  DEFAULT_TERMINAL_STATES,
  applyCodexEventToSession,
  buildRuntimeSnapshot,
  buildServiceConfig,
  calculateRetryDelayMs,
  createRuntimeState,
  getAvailableSlots,
  isIssueDispatchEligible,
  isPathInsideRoot,
  normalizeIssue,
  normalizeState,
  parseWorkflowMarkdown,
  resolveWorkspacePath,
  sanitizeWorkspaceKey,
  sortIssuesForDispatch,
  validateDispatchConfig,
  accumulateAbsoluteTokenDeltas,
};
