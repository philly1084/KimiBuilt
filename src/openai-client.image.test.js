jest.mock('openai', () => {
    const MockOpenAI = jest.fn().mockImplementation(() => ({
        models: {
            list: jest.fn(async () => ({ data: [] })),
        },
        responses: {
            create: jest.fn(),
        },
        chat: {
            completions: {
                create: jest.fn(),
            },
        },
        audio: {
            transcriptions: {
                create: jest.fn(),
            },
        },
    }));

    MockOpenAI.toFile = jest.fn(async () => null);
    return MockOpenAI;
});

describe('openai-client image generation', () => {
    let originalFetch;

    beforeEach(() => {
        jest.resetModules();
        jest.doMock('./routes/admin/settings.controller', () => ({
            getSettings: jest.fn(() => ({})),
        }));
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';
        process.env.OPENAI_MEDIA_API_KEY = 'media-key';
        process.env.OPENAI_MEDIA_IMAGE_MODEL = 'gpt-image-1';
        delete process.env.OPENAI_IMAGE_MODEL;
        originalFetch = global.fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
        delete process.env.OPENAI_MEDIA_API_KEY;
        delete process.env.OPENAI_MEDIA_IMAGE_MODEL;
    });

    test('uses the current OpenAI image generation request shape for official media calls', async () => {
        global.fetch = jest.fn(async (_url, init = {}) => ({
            ok: true,
            json: async () => ({
                created: 123,
                data: [{
                    b64_json: 'aGVsbG8=',
                    revised_prompt: 'A refined prompt',
                }],
            }),
        }));

        const { generateImage } = require('./openai-client');
        const result = await generateImage({
            prompt: 'Generate a hero image',
            model: 'gpt-image-1',
        });

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual(expect.objectContaining({
            prompt: 'Generate a hero image',
            model: 'gpt-image-1',
        }));
        expect(JSON.parse(global.fetch.mock.calls[0][1].body)).not.toHaveProperty('response_format');
        expect(result.data).toEqual([
            expect.objectContaining({
                url: 'data:image/png;base64,aGVsbG8=',
                b64_json: 'aGVsbG8=',
                revised_prompt: 'A refined prompt',
            }),
        ]);
    });

    test('retries without response_format when a provider rejects that parameter', async () => {
        process.env.OPENAI_BASE_URL = 'https://gateway.example/v1';
        process.env.OPENAI_IMAGE_MODEL = 'gpt-image-2';
        global.fetch = jest.fn()
            .mockResolvedValueOnce({
                ok: false,
                status: 400,
                text: async () => JSON.stringify({
                    error: {
                        message: 'response_format is not supported by this provider',
                    },
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    created: 123,
                    data: [{
                        url: 'https://images.example.com/generated.png',
                    }],
                }),
            });

        const { generateImage } = require('./openai-client');
        const result = await generateImage({
            prompt: 'Generate a hero image',
            model: 'gpt-image-1',
        });

        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual(expect.objectContaining({
            response_format: 'b64_json',
        }));
        expect(JSON.parse(global.fetch.mock.calls[1][1].body)).not.toHaveProperty('response_format');
        expect(result.data).toEqual([
            expect.objectContaining({
                url: 'https://images.example.com/generated.png',
                b64_json: undefined,
            }),
        ]);
    });

    test('falls back to the official media provider when the gateway image endpoint fails', async () => {
        process.env.OPENAI_BASE_URL = 'https://gateway.example/v1';
        process.env.OPENAI_IMAGE_MODEL = 'gpt-image-2';
        process.env.OPENAI_MEDIA_IMAGE_MODEL = 'gpt-image-2';
        global.fetch = jest.fn()
            .mockResolvedValueOnce({
                ok: false,
                status: 404,
                text: async () => JSON.stringify({
                    error: {
                        message: 'not found',
                    },
                }),
            })
            .mockResolvedValueOnce({
                ok: false,
                status: 404,
                text: async () => JSON.stringify({
                    error: {
                        message: 'not found',
                    },
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    created: 123,
                    data: [{
                        b64_json: 'aGVsbG8=',
                    }],
                }),
            });

        const { generateImage } = require('./openai-client');
        const result = await generateImage({
            prompt: 'Generate a hero image',
            model: 'gpt-image-2',
        });

        expect(global.fetch.mock.calls.map((call) => call[0])).toEqual([
            'https://gateway.example/v1/images/generations',
            'https://gateway.example/images/generations',
            'https://api.openai.com/v1/images/generations',
        ]);
        expect(global.fetch.mock.calls[2][1].headers.Authorization).toBe('Bearer media-key');
        expect(JSON.parse(global.fetch.mock.calls[2][1].body)).toEqual(expect.objectContaining({
            prompt: 'Generate a hero image',
            model: 'gpt-image-2',
        }));
        expect(JSON.parse(global.fetch.mock.calls[2][1].body)).not.toHaveProperty('response_format');
        expect(result.data[0]).toEqual(expect.objectContaining({
            url: 'data:image/png;base64,aGVsbG8=',
        }));
    });

    test('ignores a stale Gemini model request when the provider is official OpenAI', async () => {
        global.fetch = jest.fn(async (_url, init = {}) => ({
            ok: true,
            json: async () => ({
                created: 123,
                data: [{
                    b64_json: 'aGVsbG8=',
                }],
            }),
        }));

        const { generateImage } = require('./openai-client');
        await generateImage({
            prompt: 'Generate a hero image',
            model: 'gemini-2.0-flash-exp-image-generation',
        });

        expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual(expect.objectContaining({
            model: 'gpt-image-1',
        }));
        expect(JSON.parse(global.fetch.mock.calls[0][1].body)).not.toHaveProperty('response_format');
    });

    test('ignores a stale Gemini model request when the gateway is configured for OpenAI-style image models', async () => {
        process.env.OPENAI_BASE_URL = 'https://gateway.example/v1';
        process.env.OPENAI_IMAGE_MODEL = 'gpt-image-2';
        global.fetch = jest.fn(async (_url, init = {}) => ({
            ok: true,
            json: async () => ({
                created: 123,
                data: [{
                    b64_json: 'aGVsbG8=',
                }],
            }),
        }));

        const { generateImage } = require('./openai-client');
        await generateImage({
            prompt: 'Generate a hero image',
            model: 'gemini-2.0-flash-exp-image-generation',
        });

        expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual(expect.objectContaining({
            model: 'gpt-image-2',
            response_format: 'b64_json',
        }));
        expect(global.fetch.mock.calls[0][0]).toBe('https://gateway.example/v1/images/generations');
    });
});
