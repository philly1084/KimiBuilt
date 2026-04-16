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
});
