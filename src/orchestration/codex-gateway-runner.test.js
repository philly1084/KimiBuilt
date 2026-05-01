const { ReadableStream } = require('stream/web');
const { CodexGatewayRunner, parseSseChunk } = require('./codex-gateway-runner');
const { renderPromptTemplate } = require('./prompt-renderer');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function sseResponse(chunks = []) {
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
  };
}

describe('CodexGatewayRunner', () => {
  test('renderPromptTemplate fails unknown variables and supports default/json filters', () => {
    expect(renderPromptTemplate('Issue {{ issue.identifier }} {{ issue.description | default: "none" }}', {
      issue: { id: 'id-1', identifier: 'KIMI-1', title: 'Work', state: 'Todo' },
    })).toBe('Issue KIMI-1 none');

    expect(renderPromptTemplate('{{ issue.labels | json }}', {
      issue: { id: 'id-1', identifier: 'KIMI-1', title: 'Work', state: 'Todo', labels: ['api'] },
    })).toBe('["api"]');

    expect(() => renderPromptTemplate('{{ issue.nope }}', {
      issue: { id: 'id-1', identifier: 'KIMI-1', title: 'Work', state: 'Todo' },
    })).toThrow(/Unknown template variable/);

    expect(() => renderPromptTemplate('{{ issue.title | unknown }}', {
      issue: { id: 'id-1', identifier: 'KIMI-1', title: 'Work', state: 'Todo' },
    })).toThrow(/Unknown template filter/);
  });

  test('parseSseChunk normalizes event payloads and preserves partial chunks', () => {
    const events = [];
    const remainder = parseSseChunk('event: notification\ndata: {"message":"hi"}\n\nevent: turn_', (event) => {
      events.push(event);
    });

    expect(events).toEqual([expect.objectContaining({
      event: 'notification',
      message: 'hi',
    })]);
    expect(remainder).toBe('event: turn_');
  });

  test('starts gateway run, streams completion, and forwards auth/config/prompt', async () => {
    const fetchImpl = jest.fn(async (url, options) => {
      if (url.endsWith('/api/codex-agent/run')) {
        const requestBody = JSON.parse(options.body);
        expect(options.headers.Authorization).toBe('Bearer frontend-key');
        expect(requestBody.workspacePath).toBe('C:\\tmp\\symphony_workspaces\\KIMI-1');
        expect(requestBody.prompt).toBe('Fix KIMI-1');
        expect(requestBody.config).toEqual(expect.objectContaining({
          approvalPolicy: 'never',
          threadSandbox: 'workspace-write',
          turnTimeoutMs: 3600000,
        }));
        return jsonResponse({
          ok: true,
          runId: 'run_1',
          threadId: 'thread_1',
          turnId: 'turn_1',
          sessionId: 'thread_1-turn_1',
          status: 'running',
        });
      }
      if (url.endsWith('/api/codex-agent/runs/run_1/events')) {
        return sseResponse([
          'event: thread/tokenUsage/updated\n',
          'data: {"event":"thread/tokenUsage/updated","usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}\n\n',
          'event: turn_completed\n',
          'data: {"event":"turn_completed","usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}\n\n',
        ]);
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    const runner = new CodexGatewayRunner({
      baseUrl: 'http://gateway.local/',
      apiKey: 'frontend-key',
      fetchImpl,
    });
    const events = [];

    const result = await runner.run({
      issue: { id: 'id-1', identifier: 'KIMI-1', title: 'Work', state: 'Todo' },
      workflow: { prompt_template: 'Fix {{ issue.identifier }}' },
      serviceConfig: {
        codex: {
          approval_policy: 'never',
          thread_sandbox: 'workspace-write',
          turn_timeout_ms: 3600000,
          stall_timeout_ms: 300000,
        },
      },
      workspace: { workspace_path: 'C:\\tmp\\symphony_workspaces\\KIMI-1' },
      onEvent: (event) => events.push(event),
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      runId: 'run_1',
      sessionId: 'thread_1-turn_1',
    }));
    expect(events.map((event) => event.event)).toEqual([
      'session_started',
      'thread/tokenUsage/updated',
      'turn_completed',
    ]);
  });

  test('throws on terminal failure event', async () => {
    const runner = new CodexGatewayRunner({
      baseUrl: 'http://gateway.local',
      fetchImpl: jest.fn(async (url) => {
        if (url.endsWith('/api/codex-agent/run')) {
          return jsonResponse({ ok: true, runId: 'run_2', status: 'running' });
        }
        return sseResponse([
          'event: turn_failed\n',
          'data: {"event":"turn_failed","message":"tests failed"}\n\n',
        ]);
      }),
    });

    await expect(runner.run({
      issue: { id: 'id-1', identifier: 'KIMI-1', title: 'Work', state: 'Todo' },
      workflow: { prompt_template: 'Fix it' },
      workspace: { workspace_path: 'C:\\tmp\\symphony_workspaces\\KIMI-1' },
    })).rejects.toMatchObject({
      code: 'turn_failed',
    });
  });

  test('cancels gateway run when the orchestrator aborts', async () => {
    let eventRead = false;
    const fetchImpl = jest.fn(async (url) => {
      if (url.endsWith('/api/codex-agent/run')) {
        return jsonResponse({ ok: true, runId: 'run_abort', status: 'running' });
      }
      if (url.endsWith('/api/codex-agent/runs/run_abort/events')) {
        return {
          ok: true,
          status: 200,
          body: {
            getReader() {
              return {
                async read() {
                  eventRead = true;
                  await new Promise((resolve) => setTimeout(resolve, 5));
                  return {
                    done: false,
                    value: new TextEncoder().encode(''),
                  };
                },
              };
            },
          },
        };
      }
      if (url.endsWith('/api/codex-agent/runs/run_abort/cancel')) {
        return jsonResponse({ ok: true, status: 'cancelled' });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    const runner = new CodexGatewayRunner({
      baseUrl: 'http://gateway.local',
      fetchImpl,
      logger: { warn: jest.fn() },
    });
    const controller = new AbortController();
    const promise = runner.run({
      issue: { id: 'id-1', identifier: 'KIMI-1', title: 'Work', state: 'Todo' },
      workflow: { prompt_template: 'Fix it' },
      workspace: { workspace_path: 'C:\\tmp\\symphony_workspaces\\KIMI-1' },
      signal: controller.signal,
    });
    while (!eventRead) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    controller.abort();

    await expect(promise).rejects.toThrow(/aborted/);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/cancel'), expect.objectContaining({
      method: 'POST',
    }));
  });
});
