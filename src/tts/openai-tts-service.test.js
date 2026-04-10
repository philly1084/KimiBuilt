jest.mock('openai', () => {
    return jest.fn().mockImplementation(() => ({
        audio: {
            speech: {
                create: jest.fn(async () => ({
                    arrayBuffer: async () => Uint8Array.from([82, 73, 70, 70]).buffer,
                })),
            },
        },
    }));
});

const OpenAI = require('openai');
const { OpenAiTtsService } = require('./openai-tts-service');

describe('OpenAiTtsService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('reports premium feminine voice presets', () => {
        const service = new OpenAiTtsService({
            enabled: true,
            apiKey: 'test-key',
            baseURL: 'https://api.openai.com/v1',
            model: 'gpt-4o-mini-tts',
            defaultVoiceId: 'openai-marin-natural',
        });

        expect(service.getPublicConfig()).toEqual(expect.objectContaining({
            configured: true,
            provider: 'openai',
            defaultVoiceId: 'openai-marin-natural',
            voices: expect.arrayContaining([
                expect.objectContaining({ id: 'openai-marin-natural', label: 'Marin natural' }),
                expect.objectContaining({ id: 'openai-coral-bright', label: 'Coral bright' }),
            ]),
        }));
    });

    test('synthesizes audio with instructions for the selected voice preset', async () => {
        const service = new OpenAiTtsService({
            enabled: true,
            apiKey: 'test-key',
            baseURL: 'https://api.openai.com/v1',
            model: 'gpt-4o-mini-tts',
            responseFormat: 'wav',
            defaultVoiceId: 'openai-marin-natural',
        });

        const result = await service.synthesize({
            text: 'Here is a clear answer.',
            voiceId: 'openai-shimmer-expressive',
        });

        const client = OpenAI.mock.results[0].value;

        expect(client.audio.speech.create).toHaveBeenCalledWith(expect.objectContaining({
            model: 'gpt-4o-mini-tts',
            voice: 'shimmer',
            response_format: 'wav',
            instructions: expect.stringContaining('expressive feminine inflection'),
        }));
        expect(result).toEqual(expect.objectContaining({
            provider: 'openai',
            contentType: 'audio/wav',
            voice: expect.objectContaining({
                id: 'openai-shimmer-expressive',
                label: 'Shimmer expressive',
            }),
        }));
        expect(Buffer.isBuffer(result.audioBuffer)).toBe(true);
    });
});
