const mockModelsList = jest.fn();

jest.mock('openai', () => {
    const OpenAI = jest.fn().mockImplementation(() => ({
        models: {
            list: mockModelsList,
        },
        responses: {
            create: jest.fn(),
        },
        chat: {
            completions: {
                create: jest.fn(),
            },
        },
    }));

    OpenAI.toFile = jest.fn();
    return OpenAI;
});

describe('openai-client image model selection', () => {
    beforeEach(() => {
        jest.resetModules();
        mockModelsList.mockReset();
        jest.doMock('./routes/admin/settings.controller', () => ({
            getSettings: jest.fn(() => ({})),
            settings: {},
        }));

        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';
        delete process.env.OPENAI_IMAGE_MODEL;
        delete process.env.OPENAI_MEDIA_API_KEY;
        delete process.env.OPENAI_MEDIA_IMAGE_MODEL;
    });

    afterEach(() => {
        delete process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_BASE_URL;
        delete process.env.OPENAI_IMAGE_MODEL;
        delete process.env.OPENAI_MEDIA_API_KEY;
        delete process.env.OPENAI_MEDIA_IMAGE_MODEL;
    });

    test('prefers the configured gateway image model while using the official OpenAI image catalog', async () => {
        process.env.OPENAI_IMAGE_MODEL = 'gpt-image-2';
        process.env.OPENAI_MEDIA_API_KEY = 'media-key';
        process.env.OPENAI_MEDIA_IMAGE_MODEL = 'gpt-image-1.5';
        mockModelsList.mockResolvedValue({ data: [] });

        const { listImageModels } = require('./openai-client');
        const models = await listImageModels();

        expect(models[0]).toEqual(expect.objectContaining({
            id: 'gpt-image-2',
        }));
        expect(models.map((model) => model.id)).toEqual(expect.arrayContaining([
            'gpt-image-1.5',
            'gpt-image-1',
            'gpt-image-1-mini',
        ]));
        expect(mockModelsList).not.toHaveBeenCalled();
    });

    test('prefers gpt-image-2 over older discovered GPT image models from a gateway', async () => {
        process.env.OPENAI_BASE_URL = 'https://gateway.example/v1';
        mockModelsList.mockResolvedValue({
            data: [
                { id: 'gpt-image-1', owned_by: 'openai' },
                { id: 'gpt-image-2', owned_by: 'openai' },
                { id: 'gpt-image-1.5', owned_by: 'openai' },
            ],
        });

        const { listImageModels } = require('./openai-client');
        const models = await listImageModels();

        expect(models.slice(0, 3).map((model) => model.id)).toEqual([
            'gpt-image-2',
            'gpt-image-1.5',
            'gpt-image-1',
        ]);
    });

    test('falls back to official media image models when the gateway key is unavailable', async () => {
        delete process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_BASE_URL;
        delete process.env.OPENAI_IMAGE_MODEL;
        process.env.OPENAI_MEDIA_API_KEY = 'media-key';
        process.env.OPENAI_MEDIA_IMAGE_MODEL = 'gpt-image-2';

        const { listImageModels } = require('./openai-client');
        const models = await listImageModels();

        expect(models[0]).toEqual(expect.objectContaining({
            id: 'gpt-image-2',
        }));
        expect(models.map((model) => model.id)).toEqual(expect.arrayContaining([
            'gpt-image-1.5',
            'gpt-image-1',
            'gpt-image-1-mini',
        ]));
    });

    test('uses the official OpenAI image catalog when the configured base URL is OpenAI', async () => {
        process.env.OPENAI_IMAGE_MODEL = 'gemini-2.0-flash-exp-image-generation';
        mockModelsList.mockResolvedValue({
            data: [
                { id: 'gemini-2.0-flash-exp-image-generation', owned_by: 'google' },
            ],
        });

        const { listImageModels } = require('./openai-client');
        const models = await listImageModels();

        expect(models[0]).toEqual(expect.objectContaining({
            id: 'gpt-image-2',
        }));
        expect(models.map((model) => model.id)).not.toContain('gemini-2.0-flash-exp-image-generation');
        expect(mockModelsList).not.toHaveBeenCalled();
    });
});
