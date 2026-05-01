const EventEmitter = require('events');
const {
  applyCodexEventToSession,
  buildRuntimeSnapshot,
  calculateRetryDelayMs,
  createRuntimeState,
  isIssueDispatchEligible,
  normalizeState,
  sortIssuesForDispatch,
  validateDispatchConfig,
  accumulateAbsoluteTokenDeltas,
} = require('./symphony');
const { LinearIssueTrackerClient } = require('./linear-client');
const { WorkspaceManager } = require('./workspace-manager');

function nowIso() {
  return new Date().toISOString();
}

function noopAgentRunner() {
  throw new Error('agent_runner_not_configured');
}

class SymphonyOrchestrator extends EventEmitter {
  constructor({
    workflowLoader,
    trackerClient = null,
    trackerClientFactory = null,
    workspaceManager = null,
    workspaceManagerFactory = null,
    agentRunner = noopAgentRunner,
    logger = console,
    runtimeState = createRuntimeState(),
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
  } = {}) {
    super();
    if (!workflowLoader) {
      throw new Error('SymphonyOrchestrator requires a workflowLoader');
    }
    this.workflowLoader = workflowLoader;
    this.trackerClient = trackerClient;
    this.trackerClientFactory = trackerClientFactory;
    this.workspaceManager = workspaceManager;
    this.workspaceManagerFactory = workspaceManagerFactory;
    this.agentRunner = agentRunner;
    this.logger = logger;
    this.state = runtimeState;
    this.setTimeout = setTimeoutImpl;
    this.clearTimeout = clearTimeoutImpl;
    this.tickTimer = null;
    this.started = false;
    this.ticking = false;
    this.currentWorkflow = null;
  }

  async start() {
    if (this.started) {
      return;
    }
    const loaded = await this.workflowLoader.load();
    if (!loaded.validation.ok) {
      const error = new Error(`symphony_startup_validation_failed: ${loaded.validation.errors.map((entry) => entry.code).join(', ')}`);
      error.validation = loaded.validation;
      throw error;
    }
    this.applyWorkflow(loaded);
    await this.cleanupTerminalWorkspaces();
    this.started = true;
    this.scheduleNextTick(0);
  }

  stop() {
    this.started = false;
    if (this.tickTimer) {
      this.clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    for (const retry of this.state.retry_attempts.values()) {
      if (retry.timer_handle) {
        this.clearTimeout(retry.timer_handle);
      }
    }
    this.state.retry_attempts.clear();
    for (const running of this.state.running.values()) {
      running.abortController?.abort?.();
    }
    this.workflowLoader.close?.();
  }

  applyWorkflow(loaded = {}) {
    this.currentWorkflow = loaded;
    const config = loaded.serviceConfig;
    this.state.poll_interval_ms = config.polling.interval_ms;
    this.state.max_concurrent_agents = config.agent.max_concurrent_agents;
    if (!this.trackerClient) {
      this.trackerClient = this.trackerClientFactory
        ? this.trackerClientFactory(config)
        : new LinearIssueTrackerClient({
          endpoint: config.tracker.endpoint,
          apiKey: config.tracker.api_key,
          projectSlug: config.tracker.project_slug,
        });
    }
    if (!this.workspaceManager) {
      this.workspaceManager = this.workspaceManagerFactory
        ? this.workspaceManagerFactory(config)
        : new WorkspaceManager({
          workspaceRoot: config.workspace.root,
          hooks: config.hooks,
          logger: this.logger,
        });
    } else {
      this.workspaceManager.updateConfig?.({
        workspaceRoot: config.workspace.root,
        hooks: config.hooks,
      });
    }
  }

  scheduleNextTick(delayMs = null) {
    if (!this.started) {
      return;
    }
    if (this.tickTimer) {
      this.clearTimeout(this.tickTimer);
    }
    const delay = delayMs == null ? this.state.poll_interval_ms : delayMs;
    this.tickTimer = this.setTimeout(() => {
      this.tick().catch((error) => {
        this.logger.error?.(`[Symphony] tick_failed error=${error.message}`);
        this.emit('error', error);
      });
    }, delay);
  }

  async tick() {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    try {
      const loaded = await this.workflowLoader.loadLastGoodOrThrow();
      this.applyWorkflow(loaded);
      await this.reconcileRunning();

      const validation = validateDispatchConfig(loaded.serviceConfig);
      if (!validation.ok) {
        this.logger.error?.(`[Symphony] dispatch_validation_failed errors=${validation.errors.map((entry) => entry.code).join(',')}`);
        return;
      }

      const candidates = await this.trackerClient.fetchCandidateIssues(loaded.serviceConfig.tracker.active_states);
      await this.dispatchCandidates(candidates);
      this.emit('snapshot', this.snapshot());
    } catch (error) {
      this.logger.error?.(`[Symphony] tick_error error=${error.message}`);
      this.emit('tick_error', error);
    } finally {
      this.ticking = false;
      this.scheduleNextTick();
    }
  }

  async cleanupTerminalWorkspaces() {
    const config = this.currentWorkflow?.serviceConfig;
    if (!config || !this.trackerClient || !this.workspaceManager) {
      return;
    }
    try {
      const terminalIssues = await this.trackerClient.fetchIssuesByStates(config.tracker.terminal_states);
      for (const issue of terminalIssues) {
        await this.workspaceManager.cleanupWorkspace(issue);
      }
    } catch (error) {
      this.logger.warn?.(`[Symphony] startup_terminal_cleanup_failed error=${error.message}`);
    }
  }

  async dispatchCandidates(candidates = []) {
    const sorted = sortIssuesForDispatch(candidates);
    for (const issue of sorted) {
      const result = isIssueDispatchEligible(issue, this.state, this.currentWorkflow.serviceConfig);
      if (!result.eligible) {
        continue;
      }
      await this.dispatchIssue(issue, { attempt: null });
    }
  }

  async dispatchIssue(issue = {}, { attempt = null } = {}) {
    const config = this.currentWorkflow.serviceConfig;
    const issueId = issue.id;
    this.state.claimed.add(issueId);
    const abortController = new AbortController();
    const startedAt = nowIso();
    const startedAtMs = Date.now();
    let workspace = null;
    const runningEntry = {
      issue_id: issue.id,
      issue_identifier: issue.identifier,
      issue,
      attempt,
      status: 'PreparingWorkspace',
      started_at: startedAt,
      started_at_ms: startedAtMs,
      abortController,
      session: {
        session_id: null,
        thread_id: null,
        turn_id: null,
        turn_count: 0,
        codex_input_tokens: 0,
        codex_output_tokens: 0,
        codex_total_tokens: 0,
        last_reported_input_tokens: 0,
        last_reported_output_tokens: 0,
        last_reported_total_tokens: 0,
      },
    };
    this.state.running.set(issueId, runningEntry);
    this.logger.log?.(`[Symphony] dispatch_started issue_id=${issue.id} issue_identifier=${issue.identifier}`);

    try {
      workspace = await this.workspaceManager.ensureWorkspace(issue);
      runningEntry.workspace_path = workspace.workspace_path;
      runningEntry.status = 'BuildingPrompt';
      runningEntry.status = 'StreamingTurn';
      await this.workspaceManager.beforeRun(workspace.workspace_path);
      const result = await this.agentRunner({
        issue,
        attempt,
        workflow: this.currentWorkflow.definition,
        serviceConfig: config,
        workspace,
        signal: abortController.signal,
        onEvent: (event) => this.handleCodexEvent(issueId, event),
      });
      runningEntry.status = 'Succeeded';
      await this.workspaceManager.afterRun(workspace.workspace_path);
      await this.handleWorkerExit(issue, {
        ok: true,
        result,
        startedAtMs,
      });
    } catch (error) {
      runningEntry.status = abortController.signal.aborted ? 'CanceledByReconciliation' : 'Failed';
      if (workspace?.workspace_path) {
        await this.workspaceManager.afterRun(workspace.workspace_path);
      }
      await this.handleWorkerExit(issue, {
        ok: false,
        error,
        startedAtMs,
      });
    }
  }

  handleCodexEvent(issueId = '', event = {}) {
    const running = this.state.running.get(issueId);
    if (!running) {
      return;
    }
    running.session = applyCodexEventToSession(running.session || {}, event);
    running.session = accumulateAbsoluteTokenDeltas(this.state, running.session);
    if (event.rate_limits || event.rateLimits) {
      this.state.codex_rate_limits = event.rate_limits || event.rateLimits;
    }
    this.emit('codex_event', {
      issue_id: issueId,
      issue_identifier: running.issue_identifier,
      event,
    });
  }

  async handleWorkerExit(issue = {}, { ok = false, error = null, startedAtMs = Date.now() } = {}) {
    const running = this.state.running.get(issue.id);
    this.state.running.delete(issue.id);
    const elapsedSeconds = Math.max((Date.now() - startedAtMs) / 1000, 0);
    this.state.codex_totals.seconds_running = Number(this.state.codex_totals.seconds_running || 0) + elapsedSeconds;

    if (ok) {
      this.state.completed.add(issue.id);
      this.logger.log?.(`[Symphony] worker_completed issue_id=${issue.id} issue_identifier=${issue.identifier}`);
      this.scheduleRetry(issue, {
        attempt: 1,
        continuation: true,
        error: null,
      });
    } else if (running?.status === 'CanceledByReconciliation') {
      this.releaseIssue(issue.id);
      this.logger.warn?.(`[Symphony] worker_cancelled issue_id=${issue.id} issue_identifier=${issue.identifier}`);
    } else {
      const previous = this.state.retry_attempts.get(issue.id);
      const runningAttempt = Number(running?.attempt || 0);
      this.scheduleRetry(issue, {
        attempt: previous ? previous.attempt + 1 : runningAttempt + 1,
        continuation: false,
        error: error?.message || 'worker_failed',
      });
    }
  }

  scheduleRetry(issue = {}, { attempt = 1, continuation = false, error = null } = {}) {
    const existing = this.state.retry_attempts.get(issue.id);
    if (existing?.timer_handle) {
      this.clearTimeout(existing.timer_handle);
    }
    const delay = calculateRetryDelayMs(
      attempt,
      this.currentWorkflow?.serviceConfig?.agent?.max_retry_backoff_ms,
      { continuation },
    );
    const dueAtMs = Date.now() + delay;
    const entry = {
      issue_id: issue.id,
      identifier: issue.identifier,
      attempt,
      due_at_ms: dueAtMs,
      error,
      timer_handle: this.setTimeout(() => {
        this.handleRetry(issue.id).catch((retryError) => {
          this.logger.error?.(`[Symphony] retry_failed issue_id=${issue.id} error=${retryError.message}`);
        });
      }, delay),
    };
    this.state.claimed.add(issue.id);
    this.state.retry_attempts.set(issue.id, entry);
    this.logger.log?.(`[Symphony] retry_queued issue_id=${issue.id} issue_identifier=${issue.identifier} attempt=${attempt} delay_ms=${delay}`);
    return entry;
  }

  async handleRetry(issueId = '') {
    const retry = this.state.retry_attempts.get(issueId);
    if (!retry) {
      return;
    }
    this.state.retry_attempts.delete(issueId);
    const candidates = await this.trackerClient.fetchCandidateIssues(this.currentWorkflow.serviceConfig.tracker.active_states);
    const issue = candidates.find((candidate) => candidate.id === issueId);
    if (!issue) {
      this.releaseIssue(issueId);
      return;
    }
    this.state.claimed.delete(issueId);
    const eligibility = isIssueDispatchEligible(issue, this.state, this.currentWorkflow.serviceConfig);
    if (!eligibility.eligible) {
      if (eligibility.reason === 'no_available_slots') {
        this.scheduleRetry(issue, {
          attempt: retry.attempt + 1,
          error: 'no available orchestrator slots',
        });
      } else {
        this.releaseIssue(issueId);
      }
      return;
    }
    await this.dispatchIssue(issue, { attempt: retry.attempt });
  }

  async reconcileRunning() {
    await this.detectStalls();
    const ids = Array.from(this.state.running.keys());
    if (ids.length === 0) {
      return;
    }
    let refreshed = null;
    try {
      refreshed = await this.trackerClient.fetchIssueStatesByIds(ids);
    } catch (error) {
      this.logger.warn?.(`[Symphony] state_refresh_failed error=${error.message}`);
      return;
    }
    const config = this.currentWorkflow.serviceConfig;
    const active = config.tracker.active_states.map(normalizeState);
    const terminal = config.tracker.terminal_states.map(normalizeState);

    for (const id of ids) {
      const running = this.state.running.get(id);
      const latest = refreshed.get(id);
      if (!running || !latest) {
        continue;
      }
      const state = normalizeState(latest.state);
      if (terminal.includes(state)) {
        running.abortController?.abort?.();
        this.releaseIssue(id);
        await this.workspaceManager.cleanupWorkspace(latest);
      } else if (active.includes(state)) {
        running.issue = latest;
      } else {
        running.abortController?.abort?.();
        this.releaseIssue(id);
      }
    }
  }

  async detectStalls() {
    const stallTimeoutMs = Number(this.currentWorkflow?.serviceConfig?.codex?.stall_timeout_ms || 0);
    if (stallTimeoutMs <= 0) {
      return;
    }
    const now = Date.now();
    for (const running of this.state.running.values()) {
      const lastEventMs = Date.parse(running.session?.last_codex_timestamp || '') || running.started_at_ms;
      if (now - lastEventMs > stallTimeoutMs) {
        running.status = 'Stalled';
        running.abortController?.abort?.();
        await this.handleWorkerExit(running.issue, {
          ok: false,
          error: new Error('stalled'),
          startedAtMs: running.started_at_ms,
        });
      }
    }
  }

  releaseIssue(issueId = '') {
    const retry = this.state.retry_attempts.get(issueId);
    if (retry?.timer_handle) {
      this.clearTimeout(retry.timer_handle);
    }
    this.state.retry_attempts.delete(issueId);
    this.state.running.delete(issueId);
    this.state.claimed.delete(issueId);
  }

  snapshot() {
    return buildRuntimeSnapshot(this.state);
  }
}

module.exports = {
  SymphonyOrchestrator,
};
