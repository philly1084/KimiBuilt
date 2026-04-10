const {
  DEFAULT_CODEX_MODEL_ID,
  extractSSEData,
  filterCodexBackedModels,
  normalizeGatewayEventPayload,
  selectPreferredCodexModel,
  splitSSEFrames,
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
});
