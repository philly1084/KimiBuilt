const express = require('express');
const request = require('supertest');

jest.mock('../middleware/validate', () => ({
    validate: () => (_req, _res, next) => next(),
}));

jest.mock('../tts/tts-service', () => ({
    ttsService: {
        getPublicConfig: jest.fn(),
        synthesize: jest.fn(),
    },
}));

const { ttsService } = require('../tts/tts-service');
const ttsRouter = require('./tts');

describe('/api/tts', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        ttsService.getPublicConfig.mockReturnValue({
            configured: true,
            provider: 'openai',
            defaultVoiceId: 'openai-marin-natural',
            diagnostics: {
                status: 'ready',
                binaryReachable: true,
                voicesLoaded: true,
                message: 'OpenAI voice playback is ready.',
            },
            voices: [{
                id: 'openai-marin-natural',
                label: 'Marin natural',
                description: 'Warm and natural.',
                provider: 'openai',
            }],
        });
    });

    test('returns voice availability', async () => {
        const app = express();
        app.use('/api/tts', ttsRouter);

        const response = await request(app).get('/api/tts/voices');

        expect(response.status).toBe(200);
        expect(response.body).toEqual(expect.objectContaining({
            configured: true,
            provider: 'openai',
            defaultVoiceId: 'openai-marin-natural',
            diagnostics: expect.objectContaining({
                status: 'ready',
                binaryReachable: true,
                voicesLoaded: true,
            }),
        }));
    });

    test('returns synthesized wav audio', async () => {
        const app = express();
        app.use(express.json());
        app.use('/api/tts', ttsRouter);

        const buffer = Buffer.from('RIFF-test-audio');
        ttsService.synthesize.mockResolvedValue({
            audioBuffer: buffer,
            contentType: 'audio/wav',
            provider: 'openai',
            voice: {
                id: 'openai-marin-natural',
                label: 'Marin natural',
            },
        });

        const response = await request(app)
            .post('/api/tts/synthesize')
            .send({
                text: 'Hello from Piper.',
                voiceId: 'openai-marin-natural',
            });

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toMatch(/audio\/wav/);
        expect(response.headers['x-tts-provider']).toBe('openai');
        expect(response.headers['x-tts-voice-id']).toBe('openai-marin-natural');
        expect(response.body.equals(buffer)).toBe(true);
    });

    test('returns JSON errors for known TTS failures', async () => {
        const app = express();
        app.use(express.json());
        app.use('/api/tts', ttsRouter);

        const error = new Error('Piper TTS is not configured.');
        error.statusCode = 503;
        error.code = 'tts_unavailable';
        ttsService.synthesize.mockRejectedValue(error);

        const response = await request(app)
            .post('/api/tts/synthesize')
            .send({
                text: 'Hello from Piper.',
            });

        expect(response.status).toBe(503);
        expect(response.body).toEqual({
            error: {
                type: 'tts_unavailable',
                message: 'Piper TTS is not configured.',
            },
        });
    });
});
