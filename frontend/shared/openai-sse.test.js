const {
  DEFAULT_CODEX_MODEL_ID,
  buildGatewayRealtimeUrl,
  extractSSEData,
  filterCodexBackedModels,
  normalizeGatewayEventPayload,
  resolvePreferredChatModel,
  selectPreferredCodexModel,
  splitSSEFrames,
  streamGatewayResponse,
} = require('./openai-sse');

describe('openai-sse helpers', () => {
  test('splits SSE frames on double newlines', () => {
    const { frames, remainder } = splitSSEFrames('data: {"a":1}\n\ndata: {"b":2}\n\npartial');

    expect(frames).toEqual([
      'data: {"a":1}',
      'data: {"b":2}',
    ]);
    expect(remainder).toBe('partial');
  });

  test('extracts multi-line SSE data payloads', () => {
    expect(extractSSEData('event: message\ndata: {"a":1}\ndata: {"b":2}\n')).toBe('{"a":1}\n{"b":2}');
  });

  test('builds websocket URLs from the backend origin instead of the frontend preview port', () => {
    expect(buildGatewayRealtimeUrl('http://localhost:3000/v1')).toBe('ws://localhost:3000/ws');
    expect(buildGatewayRealtimeUrl('https://kimi.example.com')).toBe('wss://kimi.example.com/ws');
    expect(buildGatewayRealtimeUrl('https://kimi.example.com/api', '/realtime')).toBe('wss://kimi.example.com/realtime');
  });

  test('normalizes chat completion chunk payloads', () => {
    const events = normalizeGatewayEventPayload({
      object: 'chat.completion.chunk',
      id: 'chatcmpl_123',
      session_id: 'sess_123',
      artifacts: [{ id: 'artifact-1' }],
      choices: [{
        index: 0,
        delta: {
          content: 'Hello',
          reasoning: 'Thinking',
          tool_calls: [{ id: 'call_1', type: 'function_call', function: { name: 'search' } }],
        },
        finish_reason: 'stop',
      }],
    });

    expect(events.map((event) => event.type)).toEqual([
      'text_delta',
      'reasoning_delta',
      'tool_calls',
      'finish',
    ]);
    expect(events[0].content).toBe('Hello');
    expect(events[1].summary).toBe('Thinking');
    expect(events[2].toolCalls[0].function.name).toBe('search');
    expect(events[3].finishReason).toBe('stop');
    expect(events[0].sessionId).toBe('sess_123');
    expect(events[0].artifacts).toEqual([{ id: 'artifact-1' }]);
  });

  test('normalizes object-form reasoning from chat completion chunks', () => {
    const events = normalizeGatewayEventPayload({
      object: 'chat.completion.chunk',
      id: 'chatcmpl_456',
      choices: [{
        index: 0,
        delta: {
          reasoning: [
            { type: 'reasoning', summary: [{ text: 'Checking the request. ' }] },
            { type: 'reasoning', text: 'Choosing the direct path.' },
          ],
        },
        finish_reason: null,
      }],
    });

    expect(events.map((event) => event.type)).toEqual(['reasoning_delta']);
    expect(events[0].content).toBe('Checking the request. Choosing the direct path.');
    expect(events[0].summary).toBe('Checking the request. Choosing the direct path.');
  });

  test('normalizes response chunk payloads', () => {
    const events = normalizeGatewayEventPayload({
      object: 'response.chunk',
      id: 'resp_123',
      output_text_delta: 'Hello',
      reasoning_delta: 'Thinking',
      output: [{ id: 'call_1', type: 'function_call', name: 'search' }],
    });

    expect(events.map((event) => event.type)).toEqual([
      'text_delta',
      'reasoning_delta',
      'tool_calls',
    ]);
    expect(events[2].toolCalls).toHaveLength(1);
  });

  test('normalizes reasoning items embedded in response chunk output arrays', () => {
    const events = normalizeGatewayEventPayload({
      object: 'response.chunk',
      id: 'resp_234',
      output: [
        {
          type: 'reasoning',
          summary: [{ text: 'Checking the request. ' }],
          content: [{ type: 'output_text', text: 'Choosing the direct path.' }],
        },
      ],
    });

    expect(events.map((event) => event.type)).toEqual(['reasoning_delta']);
    expect(events[0].content).toBe('Checking the request. Choosing the direct path.');
    expect(events[0].summary).toBe('Checking the request. Choosing the direct path.');
  });

  test('normalizes custom /api/chat delta payloads', () => {
    const events = normalizeGatewayEventPayload({
      type: 'delta',
      sessionId: 'session-123',
      content: 'Hello from /api/chat',
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'text_delta',
      sessionId: 'session-123',
      content: 'Hello from /api/chat',
    });
  });

  test('normalizes progress payloads from /api/chat streams', () => {
    const events = normalizeGatewayEventPayload({
      type: 'progress',
      sessionId: 'session-456',
      progress: {
        phase: 'executing',
        detail: 'Inspecting the current state',
        totalSteps: 3,
        completedSteps: 1,
        steps: [
          { id: 'inspect', title: 'Inspect the current state', status: 'completed' },
          { id: 'implement', title: 'Implement the requested changes', status: 'in_progress' },
          { id: 'validate', title: 'Validate the result', status: 'pending' },
        ],
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'progress',
      sessionId: 'session-456',
      phase: 'executing',
      detail: 'Inspecting the current state',
      progress: expect.objectContaining({
        totalSteps: 3,
        completedSteps: 1,
      }),
    });
  });

  test('normalizes final JSON chat completion fallback text', () => {
    const events = normalizeGatewayEventPayload({
      object: 'chat.completion',
      id: 'chatcmpl_123',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'Final answer',
        },
        finish_reason: 'stop',
      }],
    }, { allowFinalText: true });

    expect(events.map((event) => event.type)).toEqual([
      'text_delta',
      'finish',
      'final',
    ]);
    expect(events[0].content).toBe('Final answer');
  });

  test('normalizes final JSON chat completion reasoning fields', () => {
    const events = normalizeGatewayEventPayload({
      object: 'chat.completion',
      id: 'chatcmpl_789',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'Final answer',
          reasoning: [
            { type: 'reasoning', summary: [{ text: 'Checked the request. ' }] },
            { type: 'reasoning', text: 'Chose the direct path.' },
          ],
        },
        finish_reason: 'stop',
      }],
    }, { allowFinalText: true });

    expect(events.map((event) => event.type)).toEqual([
      'text_delta',
      'reasoning_delta',
      'finish',
      'final',
    ]);
    expect(events[1].content).toBe('Checked the request. Chose the direct path.');
  });

  test('normalizes final JSON response reasoning items from output arrays', () => {
    const events = normalizeGatewayEventPayload({
      object: 'response',
      id: 'resp_789',
      output: [
        {
          type: 'reasoning',
          summary: [{ text: 'Checked the request. ' }],
          text: 'Chose the direct path.',
        },
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'Final answer' }],
        },
      ],
    }, { allowFinalText: true });

    expect(events.map((event) => event.type)).toEqual([
      'text_delta',
      'reasoning_delta',
      'final',
    ]);
    expect(events[0].content).toBe('Final answer');
    expect(events[1].content).toBe('Checked the request. Chose the direct path.');
  });

  test('streams final response text when SSE completion arrives without deltas', async () => {
    const payload = {
      type: 'response.completed',
      session_id: 'session-final',
      response: {
        id: 'resp-final',
        output: [{
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Recovered final answer' }],
        }],
      },
    };
    const response = new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    });

    const events = [];
    for await (const event of streamGatewayResponse(response)) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual(['text_delta', 'final', 'done']);
    expect(events[0]).toMatchObject({
      content: 'Recovered final answer',
      finalChunk: true,
      sessionId: 'session-final',
      responseId: 'resp-final',
    });
  });

  test('streams only missing final suffix after partial SSE deltas', async () => {
    const delta = { type: 'response.output_text.delta', delta: 'Partial ' };
    const completed = {
      type: 'response.completed',
      response: {
        id: 'resp-partial',
        output_text: 'Partial final answer',
      },
    };
    const response = new Response(
      `data: ${JSON.stringify(delta)}\n\ndata: ${JSON.stringify(completed)}\n\ndata: [DONE]\n\n`,
      { headers: { 'content-type': 'text/event-stream' } },
    );

    const events = [];
    for await (const event of streamGatewayResponse(response)) {
      events.push(event);
    }

    expect(events.filter((event) => event.type === 'text_delta').map((event) => event.content)).toEqual([
      'Partial ',
      'final answer',
    ]);
  });

  test('filters and selects Codex-backed models', () => {
    const models = [
      { id: 'gpt-4o' },
      { id: 'gpt-5.4-mini' },
      { id: 'gpt-5.3' },
      { id: 'claude-3-sonnet' },
      { id: 'codex-mini-latest' },
    ];

    expect(filterCodexBackedModels(models).map((model) => model.id)).toEqual([
      'gpt-5.4-mini',
      'gpt-5.3',
      'codex-mini-latest',
    ]);
    expect(selectPreferredCodexModel(models, 'claude-3-sonnet')).toBe('gpt-5.4-mini');
    expect(selectPreferredCodexModel([], '')).toBe(DEFAULT_CODEX_MODEL_ID);
  });

  test('preserves non-Codex chat models when explicitly selected', () => {
    const models = [
      { id: 'gpt-5.4-mini' },
      { id: 'claude-3-sonnet' },
      { id: 'gemini-2.5-pro' },
    ];

    expect(resolvePreferredChatModel(models, 'claude-3-sonnet')).toBe('claude-3-sonnet');
    expect(resolvePreferredChatModel([], 'claude-3-sonnet')).toBe('claude-3-sonnet');
    expect(resolvePreferredChatModel(models, 'missing-model')).toBe(DEFAULT_CODEX_MODEL_ID);
  });
});
