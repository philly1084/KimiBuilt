const path = require('path');
const {
  applyCodexEventToSession,
  buildRuntimeSnapshot,
  buildServiceConfig,
  calculateRetryDelayMs,
  createRuntimeState,
  isIssueDispatchEligible,
  parseWorkflowMarkdown,
  resolveWorkspacePath,
  sanitizeWorkspaceKey,
  sortIssuesForDispatch,
  validateDispatchConfig,
  accumulateAbsoluteTokenDeltas,
} = require('./symphony');

describe('symphony orchestration helpers', () => {
  test('parses WORKFLOW.md front matter and prompt body', () => {
    const workflow = parseWorkflowMarkdown(`---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: KIMI
polling:
  interval_ms: "15000"
agent:
  max_concurrent_agents_by_state:
    Todo: 2
hooks:
  after_create: |
    git clone repo .
    npm install
---
# Do the ticket

Issue: {{ issue.identifier }}
`);

    expect(workflow.config.tracker.kind).toBe('linear');
    expect(workflow.config.polling.interval_ms).toBe('15000');
    expect(workflow.config.agent.max_concurrent_agents_by_state.Todo).toBe(2);
    expect(workflow.config.hooks.after_create).toContain('npm install');
    expect(workflow.prompt_template).toContain('Issue: {{ issue.identifier }}');
  });

  test('builds typed service config with environment token resolution and defaults', () => {
    const config = buildServiceConfig({
      tracker: {
        kind: 'linear',
        api_key: '$LINEAR_API_KEY',
        project_slug: 'KIMI',
      },
      agent: {
        max_concurrent_agents: '4',
        max_concurrent_agents_by_state: {
          Todo: '1',
          Done: 0,
        },
      },
      codex: {
        stall_timeout_ms: 0,
      },
    }, {
      LINEAR_API_KEY: 'lin_test',
    });

    expect(config.tracker.api_key).toBe('lin_test');
    expect(config.tracker.endpoint).toBe('https://api.linear.app/graphql');
    expect(config.agent.max_concurrent_agents).toBe(4);
    expect(config.agent.max_concurrent_agents_by_state).toEqual({ todo: 1 });
    expect(config.codex.command).toBe('codex app-server');
    expect(config.codex.stall_timeout_ms).toBe(0);
  });

  test('validates dispatch-critical config', () => {
    const missing = validateDispatchConfig(buildServiceConfig({ tracker: { kind: 'linear' } }, {}));
    expect(missing.ok).toBe(false);
    expect(missing.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      'missing_tracker_api_key',
      'missing_tracker_project_slug',
    ]));

    const valid = validateDispatchConfig(buildServiceConfig({
      tracker: {
        kind: 'linear',
        api_key: '$LINEAR_API_KEY',
        project_slug: 'KIMI',
      },
    }, {
      LINEAR_API_KEY: 'lin_test',
    }));
    expect(valid.ok).toBe(true);
  });

  test('sanitizes workspace identifiers and keeps paths inside root', () => {
    expect(sanitizeWorkspaceKey('ABC-123 / risky:name')).toBe('ABC-123___risky_name');
    const resolved = resolveWorkspacePath('ABC-123 / risky:name', path.join('tmp', 'symphony'));
    expect(resolved.workspace_key).toBe('ABC-123___risky_name');
    expect(resolved.workspace_path).toContain(`${path.sep}ABC-123___risky_name`);
  });

  test('dispatch eligibility enforces required fields, blockers, claims, and per-state concurrency', () => {
    const config = buildServiceConfig({
      tracker: {
        kind: 'linear',
        api_key: 'lin_test',
        project_slug: 'KIMI',
      },
      agent: {
        max_concurrent_agents: 2,
        max_concurrent_agents_by_state: {
          'In Progress': 1,
        },
      },
    });
    const runtimeState = createRuntimeState({
      running: new Map([['run-1', { issue: { state: 'In Progress' } }]]),
      claimed: new Set(['claimed-1']),
    });

    expect(isIssueDispatchEligible({
      id: 'missing-title',
      identifier: 'KIMI-1',
      state: 'Todo',
    }, runtimeState, config)).toMatchObject({ eligible: false, reason: 'missing_required_issue_fields' });

    expect(isIssueDispatchEligible({
      id: 'blocked',
      identifier: 'KIMI-2',
      title: 'Blocked work',
      state: 'Todo',
      blocked_by: [{ identifier: 'KIMI-1', state: 'In Progress' }],
    }, runtimeState, config)).toMatchObject({ eligible: false, reason: 'blocked_todo_issue' });

    expect(isIssueDispatchEligible({
      id: 'claimed-1',
      identifier: 'KIMI-3',
      title: 'Claimed',
      state: 'Todo',
    }, runtimeState, config)).toMatchObject({ eligible: false, reason: 'already_claimed' });

    expect(isIssueDispatchEligible({
      id: 'state-cap',
      identifier: 'KIMI-4',
      title: 'State cap',
      state: 'In Progress',
    }, runtimeState, config)).toMatchObject({ eligible: false, reason: 'no_available_slots' });

    expect(isIssueDispatchEligible({
      id: 'ready',
      identifier: 'KIMI-5',
      title: 'Ready',
      state: 'Todo',
    }, runtimeState, config)).toMatchObject({ eligible: true });
  });

  test('sorts dispatch candidates by priority, age, then identifier', () => {
    const sorted = sortIssuesForDispatch([
      { identifier: 'KIMI-3', priority: null, created_at: '2026-01-01T00:00:00Z' },
      { identifier: 'KIMI-2', priority: 1, created_at: '2026-02-01T00:00:00Z' },
      { identifier: 'KIMI-1', priority: 1, created_at: '2026-01-01T00:00:00Z' },
    ]);
    expect(sorted.map((issue) => issue.identifier)).toEqual(['KIMI-1', 'KIMI-2', 'KIMI-3']);
  });

  test('calculates continuation and exponential retry backoff', () => {
    expect(calculateRetryDelayMs(99, 300000, { continuation: true })).toBe(1000);
    expect(calculateRetryDelayMs(1, 300000)).toBe(10000);
    expect(calculateRetryDelayMs(2, 300000)).toBe(20000);
    expect(calculateRetryDelayMs(10, 30000)).toBe(30000);
  });

  test('updates session telemetry and accumulates absolute token deltas once', () => {
    const runtimeState = createRuntimeState();
    let session = applyCodexEventToSession({
      session_id: 'thread-turn',
      last_reported_input_tokens: 0,
      last_reported_output_tokens: 0,
      last_reported_total_tokens: 0,
    }, {
      event: 'thread/tokenUsage/updated',
      timestamp: '2026-05-01T12:00:00Z',
      payload: {
        total_token_usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
        },
      },
    });
    session = accumulateAbsoluteTokenDeltas(runtimeState, session);
    session = accumulateAbsoluteTokenDeltas(runtimeState, session);

    expect(session.codex_input_tokens).toBe(10);
    expect(runtimeState.codex_totals).toEqual(expect.objectContaining({
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
    }));
  });

  test('builds runtime snapshot from orchestrator-owned state', () => {
    const runtimeState = createRuntimeState({
      running: new Map([
        ['issue-1', {
          issue_id: 'issue-1',
          issue_identifier: 'KIMI-1',
          issue: { state: 'Todo' },
          started_at_ms: 1000,
          workspace_path: '/tmp/symphony/KIMI-1',
          session: {
            session_id: 'thread-turn',
            turn_count: 2,
          },
        }],
      ]),
      retry_attempts: new Map([
        ['issue-2', {
          issue_id: 'issue-2',
          identifier: 'KIMI-2',
          attempt: 1,
          due_at_ms: 5000,
          error: 'turn_failed',
        }],
      ]),
      codex_totals: {
        input_tokens: 1,
        output_tokens: 2,
        total_tokens: 3,
        seconds_running: 10,
      },
    });

    const snapshot = buildRuntimeSnapshot(runtimeState, 4000);
    expect(snapshot.running).toEqual([expect.objectContaining({
      issue_id: 'issue-1',
      turn_count: 2,
    })]);
    expect(snapshot.retrying).toEqual([expect.objectContaining({ identifier: 'KIMI-2' })]);
    expect(snapshot.codex_totals.seconds_running).toBe(13);
  });
});
