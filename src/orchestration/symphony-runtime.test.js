const path = require('path');
const { WorkflowLoader } = require('./workflow-loader');
const { WorkspaceManager } = require('./workspace-manager');
const { LinearIssueTrackerClient, normalizeLinearIssue } = require('./linear-client');
const { GitLabIssueTrackerClient, normalizeGitLabIssue } = require('./gitlab-client');
const { SymphonyOrchestrator } = require('./symphony-orchestrator');
const { buildServiceConfig, createRuntimeState } = require('./symphony');

function buildLoadedWorkflow(overrides = {}) {
  const serviceConfig = buildServiceConfig({
    tracker: {
      kind: 'linear',
      api_key: 'lin_test',
      project_slug: 'KIMI',
    },
    polling: {
      interval_ms: 1000,
    },
    workspace: {
      root: path.join('tmp', 'symphony-runtime-test'),
    },
    agent: {
      max_concurrent_agents: 2,
      max_retry_backoff_ms: 30000,
    },
    ...overrides.config,
  });
  return {
    workflowPath: 'WORKFLOW.md',
    definition: {
      config: overrides.config || {},
      prompt_template: 'Work on {{ issue.identifier }}',
    },
    serviceConfig,
    validation: { ok: true, errors: [] },
  };
}

function buildFakeTimers() {
  const timers = [];
  return {
    timers,
    setTimeoutImpl: (fn, delay) => {
      const timer = { fn, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl: (timer) => {
      if (timer) {
        timer.cleared = true;
      }
    },
  };
}

describe('Symphony runtime components', () => {
  test('WorkflowLoader reads workflow files and keeps last good config after reload failure', async () => {
    let contents = `---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: KIMI
---
Do the work
`;
    const loader = new WorkflowLoader({
      workflowPath: 'WORKFLOW.md',
      cwd: 'C:\\repo',
      env: { LINEAR_API_KEY: 'lin_test' },
      fsImpl: {
        readFile: jest.fn(async () => contents),
      },
      logger: { warn: jest.fn(), error: jest.fn() },
    });

    const loaded = await loader.load();
    expect(loaded.validation.ok).toBe(true);
    expect(loaded.definition.prompt_template).toBe('Do the work');

    contents = '---\ntracker\n';
    const fallback = await loader.loadLastGoodOrThrow();
    expect(fallback).toBe(loaded);
  });

  test('WorkspaceManager creates deterministic workspace and runs hooks in workspace cwd', async () => {
    const calls = [];
    const directories = new Set();
    const fsImpl = {
      async stat(target) {
        if (!directories.has(target)) {
          const error = new Error('missing');
          error.code = 'ENOENT';
          throw error;
        }
        return { isDirectory: () => true };
      },
      async mkdir(target) {
        directories.add(target);
      },
      async rm(target) {
        directories.delete(target);
      },
    };
    const execImpl = jest.fn((command, options, callback) => {
      calls.push({ command, cwd: options.cwd });
      callback(null, '', '');
    });
    const manager = new WorkspaceManager({
      workspaceRoot: 'C:\\tmp\\symphony',
      hooks: {
        after_create: 'echo created',
        before_run: 'echo before',
        after_run: 'echo after',
        before_remove: 'echo remove',
        timeout_ms: 5000,
      },
      fsImpl,
      execImpl,
      logger: { log: jest.fn(), warn: jest.fn() },
    });

    const workspace = await manager.ensureWorkspace({ identifier: 'KIMI-1 risky/name' });
    await manager.beforeRun(workspace.workspace_path);
    await manager.afterRun(workspace.workspace_path);
    await manager.cleanupWorkspace({ identifier: 'KIMI-1 risky/name' });

    expect(workspace.workspace_key).toBe('KIMI-1_risky_name');
    expect(calls.map((call) => call.command)).toEqual([
      'echo created',
      'echo before',
      'echo after',
      'echo remove',
    ]);
    expect(calls.every((call) => call.cwd === workspace.workspace_path)).toBe(true);
  });

  test('LinearIssueTrackerClient paginates and normalizes issues', async () => {
    const fetchImpl = jest.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      const after = body.variables.after;
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            data: {
              issues: {
                nodes: [
                  {
                    id: after ? 'id-2' : 'id-1',
                    identifier: after ? 'KIMI-2' : 'KIMI-1',
                    title: 'Work',
                    priority: 1,
                    state: { name: 'Todo' },
                    labels: { nodes: [{ name: 'Backend' }] },
                    inverseRelations: {
                      nodes: [{
                        type: 'blocks',
                        issue: { id: 'blocker-1', identifier: 'KIMI-0', state: { name: 'Done' } },
                      }],
                    },
                    createdAt: '2026-01-01T00:00:00Z',
                    updatedAt: '2026-01-02T00:00:00Z',
                  },
                ],
                pageInfo: {
                  hasNextPage: !after,
                  endCursor: after ? null : 'cursor-1',
                },
              },
            },
          };
        },
      };
    });
    const client = new LinearIssueTrackerClient({
      apiKey: 'lin_test',
      projectSlug: 'KIMI',
      fetchImpl,
    });

    const issues = await client.fetchCandidateIssues(['Todo']);
    expect(issues.map((issue) => issue.identifier)).toEqual(['KIMI-1', 'KIMI-2']);
    expect(issues[0]).toEqual(expect.objectContaining({
      state: 'Todo',
      labels: ['backend'],
      blocked_by: [expect.objectContaining({ identifier: 'KIMI-0' })],
    }));
  });

  test('normalizeLinearIssue stabilizes partial Linear payloads', () => {
    expect(normalizeLinearIssue({
      id: 'id-1',
      identifier: 'KIMI-1',
      title: 'Work',
      priority: 'not-number',
      state: { name: 'In Progress' },
      labels: { nodes: [{ name: 'API' }] },
    })).toEqual(expect.objectContaining({
      id: 'id-1',
      priority: null,
      state: 'In Progress',
      labels: ['api'],
      blocked_by: [],
    }));
  });

  test('GitLabIssueTrackerClient fetches group issues and normalizes them for Symphony', async () => {
    const fetchImpl = jest.fn(async (url, options) => {
      expect(String(url)).toContain('/api/v4/groups/agent-apps/issues');
      expect(String(url)).toContain('state=opened');
      expect(String(url)).toContain('labels=symphony');
      expect(options.headers['PRIVATE-TOKEN']).toBe('glpat_test');
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify([{
            id: 10,
            iid: 4,
            title: 'Deploy app',
            description: 'Use the cluster runner.',
            state: 'opened',
            labels: ['Symphony'],
            references: { full: 'agent-apps/site#4' },
            web_url: 'https://gitlab.demoserver2.buzz/agent-apps/site/-/issues/4',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-02T00:00:00Z',
          }]);
        },
      };
    });
    const client = new GitLabIssueTrackerClient({
      endpoint: 'https://gitlab.demoserver2.buzz',
      apiKey: 'glpat_test',
      group: 'agent-apps',
      labels: ['symphony'],
      fetchImpl,
    });

    const issues = await client.fetchCandidateIssues(['Todo']);

    expect(issues).toEqual([expect.objectContaining({
      id: '10',
      identifier: 'agent-apps/site#4',
      title: 'Deploy app',
      state: 'Todo',
      labels: ['symphony'],
      url: 'https://gitlab.demoserver2.buzz/agent-apps/site/-/issues/4',
    })]);
  });

  test('normalizeGitLabIssue maps closed issues to terminal Symphony state', () => {
    expect(normalizeGitLabIssue({
      id: 11,
      iid: 5,
      title: 'Done',
      state: 'closed',
      labels: [],
    }, { baseUrl: 'https://gitlab.example' })).toEqual(expect.objectContaining({
      id: '11',
      identifier: 'GL-5',
      state: 'Done',
    }));
  });

  test('SymphonyOrchestrator tick reconciles, validates, fetches, and dispatches eligible issues', async () => {
    const loaded = buildLoadedWorkflow();
    const workflowLoader = {
      loadLastGoodOrThrow: jest.fn(async () => loaded),
      close: jest.fn(),
    };
    const trackerClient = {
      fetchIssueStatesByIds: jest.fn(async () => new Map()),
      fetchCandidateIssues: jest.fn(async () => [
        { id: 'id-1', identifier: 'KIMI-1', title: 'Ready', state: 'Todo', priority: 1, created_at: '2026-01-01T00:00:00Z' },
      ]),
    };
    const workspaceManager = {
      updateConfig: jest.fn(),
      ensureWorkspace: jest.fn(async () => ({ workspace_path: 'C:\\tmp\\symphony\\KIMI-1', workspace_key: 'KIMI-1' })),
      beforeRun: jest.fn(),
      afterRun: jest.fn(),
    };
    const agentRunner = jest.fn(async ({ onEvent }) => {
      onEvent({
        event: 'thread/tokenUsage/updated',
        timestamp: '2026-05-01T12:00:00Z',
        payload: { total_token_usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } },
      });
      return { ok: true };
    });
    const timers = buildFakeTimers();
    const orchestrator = new SymphonyOrchestrator({
      workflowLoader,
      trackerClient,
      workspaceManager,
      agentRunner,
      runtimeState: createRuntimeState(),
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      ...timers,
    });

    await orchestrator.tick();

    expect(agentRunner).toHaveBeenCalledTimes(1);
    expect(orchestrator.state.completed.has('id-1')).toBe(true);
    expect(orchestrator.state.retry_attempts.get('id-1')).toEqual(expect.objectContaining({
      attempt: 1,
      error: null,
    }));
    expect(orchestrator.state.codex_totals).toEqual(expect.objectContaining({
      input_tokens: 2,
      output_tokens: 3,
      total_tokens: 5,
    }));
  });

  test('SymphonyOrchestrator releases running issues that leave active states', async () => {
    const loaded = buildLoadedWorkflow();
    const workflowLoader = { loadLastGoodOrThrow: jest.fn(async () => loaded) };
    const trackerClient = {
      fetchIssueStatesByIds: jest.fn(async () => new Map([
        ['id-1', { id: 'id-1', identifier: 'KIMI-1', title: 'Paused', state: 'Backlog' }],
      ])),
      fetchCandidateIssues: jest.fn(async () => []),
    };
    const abort = jest.fn();
    const orchestrator = new SymphonyOrchestrator({
      workflowLoader,
      trackerClient,
      workspaceManager: { updateConfig: jest.fn(), cleanupWorkspace: jest.fn() },
      agentRunner: jest.fn(),
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      ...buildFakeTimers(),
    });
    orchestrator.currentWorkflow = loaded;
    orchestrator.state.running.set('id-1', {
      issue_id: 'id-1',
      issue_identifier: 'KIMI-1',
      issue: { id: 'id-1', identifier: 'KIMI-1', title: 'Paused', state: 'Todo' },
      started_at_ms: Date.now(),
      abortController: { abort },
    });
    orchestrator.state.claimed.add('id-1');

    await orchestrator.reconcileRunning();

    expect(abort).toHaveBeenCalled();
    expect(orchestrator.state.running.has('id-1')).toBe(false);
    expect(orchestrator.state.claimed.has('id-1')).toBe(false);
  });

  test('SymphonyOrchestrator retry refetches candidate and redispatches when capacity is available', async () => {
    const loaded = buildLoadedWorkflow();
    const issue = { id: 'id-1', identifier: 'KIMI-1', title: 'Retry me', state: 'Todo' };
    const trackerClient = {
      fetchCandidateIssues: jest.fn(async () => [issue]),
    };
    const workspaceManager = {
      updateConfig: jest.fn(),
      ensureWorkspace: jest.fn(async () => ({ workspace_path: 'C:\\tmp\\symphony\\KIMI-1', workspace_key: 'KIMI-1' })),
      beforeRun: jest.fn(),
      afterRun: jest.fn(),
    };
    const agentRunner = jest.fn(async () => ({ ok: true }));
    const orchestrator = new SymphonyOrchestrator({
      workflowLoader: { loadLastGoodOrThrow: jest.fn(async () => loaded) },
      trackerClient,
      workspaceManager,
      agentRunner,
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      ...buildFakeTimers(),
    });
    orchestrator.currentWorkflow = loaded;
    orchestrator.state.claimed.add('id-1');
    orchestrator.state.retry_attempts.set('id-1', {
      issue_id: 'id-1',
      identifier: 'KIMI-1',
      attempt: 2,
      due_at_ms: Date.now(),
      timer_handle: null,
      error: 'turn_failed',
    });

    await orchestrator.handleRetry('id-1');

    expect(agentRunner).toHaveBeenCalledWith(expect.objectContaining({
      issue,
      attempt: 2,
    }));
  });

  test('SymphonyOrchestrator failure backoff advances from the active attempt', async () => {
    const loaded = buildLoadedWorkflow();
    const issue = { id: 'id-1', identifier: 'KIMI-1', title: 'Retry failure', state: 'Todo' };
    const orchestrator = new SymphonyOrchestrator({
      workflowLoader: { loadLastGoodOrThrow: jest.fn(async () => loaded) },
      trackerClient: { fetchCandidateIssues: jest.fn() },
      workspaceManager: {
        updateConfig: jest.fn(),
        ensureWorkspace: jest.fn(async () => ({ workspace_path: 'C:\\tmp\\symphony\\KIMI-1', workspace_key: 'KIMI-1' })),
        beforeRun: jest.fn(),
        afterRun: jest.fn(),
      },
      agentRunner: jest.fn(async () => {
        throw new Error('turn_failed');
      }),
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      ...buildFakeTimers(),
    });
    orchestrator.currentWorkflow = loaded;

    await orchestrator.dispatchIssue(issue, { attempt: 3 });

    expect(orchestrator.state.retry_attempts.get('id-1')).toEqual(expect.objectContaining({
      attempt: 4,
      error: 'turn_failed',
    }));
  });
});
