const express = require('express');
const request = require('supertest');

jest.mock('../middleware/validate', () => ({
    validate: () => (_req, _res, next) => next(),
}));

jest.mock('../tts/piper-tts-service', () => ({
    piperTtsService: {
        getPublicConfig: jest.fn(),
        synthesize: jest.fn(),
    },
}));

const { piperTtsService } = require('../tts/piper-tts-service');
const ttsRouter = require('./tts');

describe('/api/tts', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        piperTtsService.getPublicConfig.mockReturnValue({
            configured: true,
            provider: 'piper',
            defaultVoiceId: 'piper-female-natural',
            diagnostics: {
                status: 'ready',
                binaryReachable: true,
                voicesLoaded: true,
                message: 'Piper is ready.',
            },
            voices: [{
                id: 'piper-female-natural',
                label: 'Female natural',
                description: 'Clear and natural.',
                provider: 'piper',
            }],
        });
    });

    test('returns Piper voice availability', async () => {
        const app = express();
        app.use('/api/tts', ttsRouter);

        const response = await request(app).get('/api/tts/voices');

        expect(response.status).toBe(200);
        expect(response.body).toEqual(expect.objectContaining({
            configured: true,
            provider: 'piper',
            defaultVoiceId: 'piper-female-natural',
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
        piperTtsService.synthesize.mockResolvedValue({
            audioBuffer: buffer,
            contentType: 'audio/wav',
            voice: {
                id: 'piper-female-natural',
                label: 'Female natural',
            },
        });

        const response = await request(app)
            .post('/api/tts/synthesize')
            .send({
                text: 'Hello from Piper.',
                voiceId: 'piper-female-natural',
            });

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toMatch(/audio\/wav/);
        expect(response.headers['x-tts-provider']).toBe('piper');
        expect(response.headers['x-tts-voice-id']).toBe('piper-female-natural');
        expect(response.body.equals(buffer)).toBe(true);
    });

    test('returns JSON errors for known TTS failures', async () => {
        const app = express();
        app.use(express.json());
        app.use('/api/tts', ttsRouter);

        const error = new Error('Piper TTS is not configured.');
        error.statusCode = 503;
        error.code = 'tts_unavailable';
        piperTtsService.synthesize.mockRejectedValue(error);

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
