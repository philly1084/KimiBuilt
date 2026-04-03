const { ToolManager } = require('./index');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

describe('ToolManager image tools', () => {
  test('registers restricted git and k3s deploy tools', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    expect(toolManager.getTool('git-safe')).toBeTruthy();
    expect(toolManager.getTool('k3s-deploy')).toBeTruthy();
  });

  test('normalizes markdown-wrapped image URLs before validation', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const result = await toolManager.executeTool('image-from-url', {
      url: '![Hero image](https://images.unsplash.com/photo-12345?fit=crop&w=1200).',
    });

    expect(result.success).toBe(true);
    expect(result.data.image.url).toBe('https://images.unsplash.com/photo-12345?fit=crop&w=1200');
    expect(result.data.markdownImage).toContain('https://images.unsplash.com/photo-12345?fit=crop&w=1200');
  });

  test('accepts file-write content aliases and writes the file body', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kimibuilt-file-write-'));
    try {
      const targetPath = path.join(tempDir, 'sample.html');

      const result = await toolManager.executeTool('file-write', {
        path: targetPath,
        html: '<!DOCTYPE html><html><body><h1>Hello</h1></body></html>',
      });

      const written = await fs.readFile(targetPath, 'utf8');

      expect(result.success).toBe(true);
      expect(result.data.path).toBe(targetPath);
      expect(written).toContain('<h1>Hello</h1>');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('returns a helpful error when file-write is called without content', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const result = await toolManager.executeTool('file-write', {
      path: 'missing-content.txt',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('file-write requires a `content` string');
  });

  test('creates a workload from structured cron fields when request is omitted', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const createWorkload = jest.fn(async (payload) => ({
      id: 'workload-1',
      ...payload,
    }));

    const result = await toolManager.executeTool('agent-workload', {
      action: 'create_from_scenario',
      prompt: 'summarize blockers from this conversation',
      trigger: {
        type: 'cron',
        expression: '5 23 * * *',
        timezone: 'America/Halifax',
      },
    }, {
      ownerId: 'user-1',
      sessionId: 'session-1',
      timezone: 'America/Halifax',
      workloadService: {
        isAvailable: () => true,
        createWorkload,
      },
    });

    expect(result.success).toBe(true);
    expect(createWorkload).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      title: 'Summarize Blockers From This Conversation',
      prompt: 'summarize blockers from this conversation',
      trigger: {
        type: 'cron',
        expression: '5 23 * * *',
        timezone: 'America/Halifax',
      },
      metadata: expect.objectContaining({
        createdFromScenario: true,
        scenarioRequest: 'summarize blockers from this conversation',
      }),
    }), 'user-1');
    expect(result.data.message).toContain('Every day at 11:05 PM');
  });

  test('infers a cron trigger for create when the prompt still contains schedule text', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const createWorkload = jest.fn(async (payload) => ({
      id: 'workload-2',
      ...payload,
    }));

    const result = await toolManager.executeTool('agent-workload', {
      action: 'create',
      prompt: 'Every weekday at 8:30 AM review the latest repo activity and summarize blockers.',
    }, {
      ownerId: 'user-1',
      sessionId: 'session-1',
      timezone: 'America/Halifax',
      workloadService: {
        isAvailable: () => true,
        createWorkload,
      },
    });

    expect(result.success).toBe(true);
    expect(createWorkload).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      title: 'Review The Latest Repo Activity',
      prompt: 'review the latest repo activity and summarize blockers.',
      trigger: {
        type: 'cron',
        expression: '30 8 * * 1-5',
        timezone: 'America/Halifax',
      },
      metadata: expect.objectContaining({
        createdFromScenario: true,
        scenarioRequest: 'Every weekday at 8:30 AM review the latest repo activity and summarize blockers.',
      }),
    }), 'user-1');
    expect(result.data.message).toContain('Every weekday at 8:30 AM');
  });

  test('extracts a structured remote execution from a scheduled server command request', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const createWorkload = jest.fn(async (payload) => ({
      id: 'workload-remote-1',
      ...payload,
    }));

    const result = await toolManager.executeTool('agent-workload', {
      action: 'create_from_scenario',
      request: 'Run `date` on the server in 5 minutes.',
      timezone: 'UTC',
    }, {
      ownerId: 'user-1',
      sessionId: 'session-1',
      timezone: 'UTC',
      now: '2026-04-02T09:00:00.000Z',
      workloadService: {
        isAvailable: () => true,
        createWorkload,
        sessionStore: {
          getOwned: jest.fn(async () => ({
            id: 'session-1',
            metadata: {
              lastSshTarget: {
                host: '10.0.0.5',
                username: 'ubuntu',
                port: 22,
              },
            },
          })),
        },
      },
    });

    expect(result.success).toBe(true);
    expect(createWorkload).toHaveBeenCalledWith(expect.objectContaining({
      execution: {
        tool: 'remote-command',
        params: {
          host: '10.0.0.5',
          username: 'ubuntu',
          port: 22,
          command: 'date',
        },
      },
      trigger: expect.objectContaining({
        type: 'once',
        runAt: '2026-04-02T09:05:00.000Z',
      }),
      callableSlug: undefined,
    }), 'user-1');
  });

  test('canonicalizes malformed remote command workload params into a scheduled structured create', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const createWorkload = jest.fn(async (payload) => ({
      id: 'workload-remote-2',
      ...payload,
    }));

    const result = await toolManager.executeTool('agent-workload', {
      action: 'create_from_scenario',
      command: 'date',
      schedule: 'in 5 minutes',
      title: 'Check remote time',
      tool: 'remote-command',
    }, {
      ownerId: 'user-1',
      sessionId: 'session-1',
      timezone: 'UTC',
      now: '2026-04-02T09:00:00.000Z',
      workloadService: {
        isAvailable: () => true,
        createWorkload,
        sessionStore: {
          getOwned: jest.fn(async () => ({
            id: 'session-1',
            metadata: {
              lastSshTarget: {
                host: '10.0.0.5',
                username: 'ubuntu',
                port: 22,
              },
            },
          })),
        },
      },
    });

    expect(result.success).toBe(true);
    expect(createWorkload).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Check remote time',
      trigger: {
        type: 'once',
        runAt: '2026-04-02T09:05:00.000Z',
      },
      execution: {
        tool: 'remote-command',
        params: {
          host: '10.0.0.5',
          username: 'ubuntu',
          port: 22,
          command: 'date',
        },
      },
      metadata: expect.objectContaining({
        createdFromScenario: true,
        scenarioRequest: 'Run `date` on the server in 5 minutes',
      }),
    }), 'user-1');
  });

  test('reconstructs a fragmented scheduled workload request from recent transcript context', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const createWorkload = jest.fn(async (payload) => ({
      id: 'workload-fragmented-1',
      ...payload,
    }));

    const result = await toolManager.executeTool('agent-workload', {
      action: 'create_from_scenario',
      request: 'run it five minutes from now',
    }, {
      ownerId: 'user-1',
      sessionId: 'session-1',
      timezone: 'UTC',
      now: '2026-04-02T09:00:00.000Z',
      recentMessages: [
        { role: 'user', content: 'gather information on the k3s cluster on the server' },
      ],
      workloadService: {
        isAvailable: () => true,
        createWorkload,
      },
    });

    expect(result.success).toBe(true);
    expect(createWorkload).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('gather information on the k3s cluster on the server'),
      trigger: {
        type: 'once',
        runAt: '2026-04-02T09:05:00.000Z',
      },
      metadata: expect.objectContaining({
        createdFromScenario: true,
        scenarioRequest: expect.stringContaining('gather information on the k3s cluster on the server'),
      }),
    }), 'user-1');
  });

  test('rejects ambiguous scenario requests instead of silently creating a manual workload', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const createWorkload = jest.fn(async (payload) => ({
      id: 'workload-3',
      ...payload,
    }));

    const result = await toolManager.executeTool('agent-workload', {
      action: 'create_from_scenario',
      request: 'Can you run one that',
    }, {
      ownerId: 'user-1',
      sessionId: 'session-1',
      timezone: 'America/Halifax',
      workloadService: {
        isAvailable: () => true,
        createWorkload,
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('needs a schedule');
    expect(createWorkload).not.toHaveBeenCalled();
  });
});
