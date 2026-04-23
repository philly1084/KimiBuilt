jest.mock('../../openai-client', () => ({
  listModels: jest.fn(),
}));

jest.mock('./settings.controller', () => ({
  settings: {
    models: {
      catalog: {},
    },
  },
  saveSettings: jest.fn(),
}));

jest.mock('./logs.controller', () => ({
  logs: [],
}));

const { listModels } = require('../../openai-client');
const logsController = require('./logs.controller');
const modelsController = require('./models.controller');

describe('admin models controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    logsController.logs = [];
  });

  test('includes logged models that are missing from the live provider catalog', () => {
    logsController.logs = [{
      model: 'custom-model',
      promptTokens: 50,
      completionTokens: 25,
      tokens: 75,
      latency: 120,
      status: 'success',
    }];

    const usage = modelsController.buildUsageStats([]);

    expect(usage).toEqual([
      expect.objectContaining({
        modelId: 'custom-model',
        modelName: 'Custom Model',
        provider: 'unknown',
        requests: 1,
        tokens: {
          input: 50,
          output: 25,
          total: 75,
        },
      }),
    ]);
  });

  test('falls back to runtime logs when the live model lookup fails', async () => {
    listModels.mockRejectedValue(new Error('provider unavailable'));
    logsController.logs = [{
      model: 'gpt-offline',
      promptTokens: 10,
      completionTokens: 5,
      tokens: 15,
      latency: 50,
      status: 'success',
    }];

    const req = {};
    const res = {
      json: jest.fn(),
      status: jest.fn(function setStatus() {
        return this;
      }),
    };

    await modelsController.getUsageStats(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: [
        expect.objectContaining({
          modelId: 'gpt-offline',
          requests: 1,
          tokens: {
            input: 10,
            output: 5,
            total: 15,
          },
        }),
      ],
      meta: expect.objectContaining({
        source: 'runtime-logs',
      }),
    }));
  });

  test('does not double count explicit zero completion tokens from total log tokens', () => {
    logsController.logs = [{
      model: 'tool-only-model',
      promptTokens: 11,
      completionTokens: 0,
      tokens: 11,
      latency: 30,
      status: 'success',
    }];

    const usage = modelsController.buildUsageStats([]);

    expect(usage).toEqual([
      expect.objectContaining({
        modelId: 'tool-only-model',
        tokens: {
          input: 11,
          output: 0,
          total: 11,
        },
      }),
    ]);
  });

  test('derives the missing side from total log tokens without inflating totals', () => {
    logsController.logs = [{
      model: 'gpt-partial-log',
      promptTokens: 125,
      tokens: 165,
      latency: 80,
      status: 'success',
    }];

    const usage = modelsController.buildUsageStats([]);

    expect(usage).toEqual([
      expect.objectContaining({
        modelId: 'gpt-partial-log',
        tokens: {
          input: 125,
          output: 40,
          total: 165,
        },
      }),
    ]);
  });
});
