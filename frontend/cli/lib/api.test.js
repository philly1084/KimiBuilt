const mockGetApiBaseUrl = jest.fn();
const mockConfigGet = jest.fn();
const mockChatCompletionsCreate = jest.fn();
const mockOpenAI = jest.fn().mockImplementation(() => ({
  chat: {
    completions: {
      create: mockChatCompletionsCreate,
    },
  },
}));

jest.mock('./config', () => ({
  getApiBaseUrl: (...args) => mockGetApiBaseUrl(...args),
  get: (...args) => mockConfigGet(...args),
}));

jest.mock('openai', () => mockOpenAI);

const { OpenAIClient } = require('./api');

describe('OpenAIClient provider sessions', () => {
  beforeEach(() => {
    mockGetApiBaseUrl.mockReturnValue('http://localhost:8080/v1');
    mockConfigGet.mockImplementation((key, defaultValue) => {
      if (key === 'frontendApiKey') {
        return 'config-front-key';
      }
      return defaultValue;
    });
    mockChatCompletionsCreate.mockReset();
    mockOpenAI.mockClear();
    global.fetch = jest.fn();
    delete process.env.KIMIBUILT_FRONTEND_API_KEY;
    delete process.env.FRONTEND_API_KEY;
    delete process.env.KIMIBUILT_GATEWAY_API_KEY;
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('getProviderCapabilities uses frontend auth against admin endpoint', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      headers: {
        get: jest.fn(() => 'application/json'),
      },
      json: jest.fn(async () => ({
        data: [
          { providerId: 'codex-cli', supportsSessions: true },
        ],
      })),
    });

    const client = new OpenAIClient();
    const result = await client.getProviderCapabilities();

    expect(result).toEqual([{ providerId: 'codex-cli', supportsSessions: true }]);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/admin/provider-capabilities',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: 'Bearer config-front-key',
        }),
      }),
    );
  });

  test('createProviderSession posts the expected provider session body', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      headers: {
        get: jest.fn(() => 'application/json'),
      },
      json: jest.fn(async () => ({
        session: {
          id: 'session-1',
          providerId: 'gemini-cli',
          cwd: 'C:\\repos\\demo',
        },
        streamUrl: '/admin/provider-sessions/session-1/stream?token=test-token',
      })),
    });

    const client = new OpenAIClient();
    const created = await client.createProviderSession({
      providerId: 'gemini-cli',
      cwd: 'C:\\repos\\demo',
      cols: 120,
      rows: 40,
    });

    expect(created.session.id).toBe('session-1');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/admin/provider-sessions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer config-front-key',
        }),
        body: JSON.stringify({
          providerId: 'gemini-cli',
          mode: 'interactive',
          cwd: 'C:\\repos\\demo',
          cols: 120,
          rows: 40,
        }),
      }),
    );
  });

  test('streamProviderSession parses output, status, and exit events', async () => {
    const streamPayload = [
      'event: output',
      'data: {"cursor":1,"data":"hello\\n"}',
      '',
      ': keepalive',
      '',
      'event: status',
      'data: {"cursor":2,"status":"running","message":"ready"}',
      '',
      'event: exit',
      'data: {"cursor":3,"exitCode":0}',
      '',
    ].join('\n');

    const reader = {
      read: jest.fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(streamPayload),
        })
        .mockResolvedValueOnce({
          done: true,
          value: undefined,
        }),
      releaseLock: jest.fn(),
    };

    global.fetch.mockResolvedValue({
      ok: true,
      headers: {
        get: jest.fn(() => 'text/event-stream'),
      },
      body: {
        getReader: () => reader,
      },
    });

    const client = new OpenAIClient();
    const events = [];
    for await (const event of client.streamProviderSession('/admin/provider-sessions/session-1/stream?token=test-token', { after: 7 })) {
      events.push(event);
    }

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/admin/provider-sessions/session-1/stream?token=test-token&after=7',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
        },
      }),
    );
    expect(events).toEqual([
      { type: 'output', cursor: 1, data: 'hello\n' },
      { type: 'status', cursor: 2, status: 'running', message: 'ready' },
      { type: 'exit', cursor: 3, exitCode: 0 },
    ]);
    expect(reader.releaseLock).toHaveBeenCalled();
  });

  test('provider session commands fail fast when no frontend auth token is configured', async () => {
    mockConfigGet.mockImplementation((key, defaultValue) => defaultValue);

    const client = new OpenAIClient();
    await expect(client.getProviderCapabilities()).rejects.toThrow(
      'Provider CLI access requires a frontend API key.',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
