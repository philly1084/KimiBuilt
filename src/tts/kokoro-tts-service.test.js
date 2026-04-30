const { KokoroTtsService } = require('./kokoro-tts-service');

function createAudio(wav = Buffer.from('RIFF-kokoro-audio')) {
    return {
        toWav: jest.fn(() => wav),
    };
}

describe('KokoroTtsService', () => {
    test('exposes configured voices and resolves aliases', () => {
        const service = new KokoroTtsService({
            enabled: true,
            modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX',
            defaultVoiceId: 'af_heart',
            voices: [{
                id: 'af_heart',
                label: 'Heart Studio',
                aliases: ['lessac-high'],
            }],
        });

        expect(service.getPublicConfig()).toEqual(expect.objectContaining({
            configured: true,
            provider: 'kokoro',
            defaultVoiceId: 'af_heart',
            voices: [
                expect.objectContaining({
                    id: 'af_heart',
                    provider: 'kokoro',
                    aliases: ['lessac-high'],
                }),
            ],
            diagnostics: expect.objectContaining({
                status: 'ready',
                voicesLoaded: true,
            }),
        }));
        expect(service.resolveVoiceProfile('lessac-high')).toEqual(expect.objectContaining({
            id: 'af_heart',
        }));
    });

    test('returns synthesized wav audio from kokoro-js', async () => {
        const generate = jest.fn(async () => createAudio());
        const fromPretrained = jest.fn(async () => ({ generate }));
        const service = new KokoroTtsService({
            enabled: true,
            modelId: 'test-model',
            defaultVoiceId: 'af_heart',
            voices: [{ id: 'af_heart', label: 'Heart Studio' }],
            timeoutMs: 5000,
        }, {
            importKokoro: () => ({
                KokoroTTS: {
                    from_pretrained: fromPretrained,
                },
            }),
        });

        const result = await service.synthesize({
            text: 'Hello **there**',
            voiceId: 'af_heart',
        });

        expect(fromPretrained).toHaveBeenCalledWith('test-model', {
            dtype: 'q8',
            device: 'cpu',
        });
        expect(generate).toHaveBeenCalledWith('Hello there.', {
            voice: 'af_heart',
            speed: 1,
        });
        expect(result).toEqual(expect.objectContaining({
            provider: 'kokoro',
            contentType: 'audio/wav',
            text: 'Hello there.',
            voice: expect.objectContaining({ id: 'af_heart', provider: 'kokoro' }),
        }));
        expect(result.audioBuffer.equals(Buffer.from('RIFF-kokoro-audio'))).toBe(true);
    });

    test('serializes concurrent generation requests', async () => {
        const events = [];
        let releaseFirst = null;
        let firstStarted = null;
        const firstStartedPromise = new Promise((resolve) => {
            firstStarted = resolve;
        });
        const generate = jest.fn(async (text) => {
            events.push(`start:${text}`);
            if (text === 'First request.') {
                firstStarted();
                await new Promise((resolve) => {
                    releaseFirst = resolve;
                });
            }
            events.push(`finish:${text}`);
            return createAudio(Buffer.from(`RIFF-${text}`));
        });
        const service = new KokoroTtsService({
            enabled: true,
            modelId: 'test-model',
            defaultVoiceId: 'af_heart',
            voices: [{ id: 'af_heart', label: 'Heart Studio' }],
            timeoutMs: 5000,
        }, {
            importKokoro: () => ({
                KokoroTTS: {
                    from_pretrained: jest.fn(async () => ({ generate })),
                },
            }),
        });

        const first = service.synthesize({ text: 'First request', voiceId: 'af_heart' });
        await firstStartedPromise;
        const second = service.synthesize({ text: 'Second request', voiceId: 'af_heart' });
        await Promise.resolve();
        await Promise.resolve();

        expect(generate).toHaveBeenCalledTimes(1);
        releaseFirst();
        await Promise.all([first, second]);

        expect(events).toEqual([
            'start:First request.',
            'finish:First request.',
            'start:Second request.',
            'finish:Second request.',
        ]);
    });

    test('keeps timed-out generation in the queue until the underlying work settles', async () => {
        const events = [];
        let releaseFirst = null;
        let firstStarted = null;
        const firstStartedPromise = new Promise((resolve) => {
            firstStarted = resolve;
        });
        const firstGenerated = new Promise((resolve) => {
            releaseFirst = () => {
                events.push('finish:First request.');
                resolve(createAudio(Buffer.from('RIFF-first')));
            };
        });
        const generate = jest.fn((text) => {
            events.push(`start:${text}`);
            if (text === 'First request.') {
                firstStarted();
                return firstGenerated;
            }
            events.push(`finish:${text}`);
            return Promise.resolve(createAudio(Buffer.from('RIFF-second')));
        });
        const service = new KokoroTtsService({
            enabled: true,
            modelId: 'test-model',
            defaultVoiceId: 'af_heart',
            voices: [{ id: 'af_heart', label: 'Heart Studio' }],
            timeoutMs: 5000,
        }, {
            importKokoro: () => ({
                KokoroTTS: {
                    from_pretrained: jest.fn(async () => ({ generate })),
                },
            }),
        });

        const first = service.synthesize({
            text: 'First request',
            voiceId: 'af_heart',
            timeoutMs: 1,
        });
        await firstStartedPromise;
        expect(generate).toHaveBeenCalledTimes(1);

        await expect(first).rejects.toMatchObject({
            statusCode: 504,
            code: 'tts_timeout',
        });

        const second = service.synthesize({
            text: 'Second request',
            voiceId: 'af_heart',
            timeoutMs: 5000,
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(generate).toHaveBeenCalledTimes(1);

        releaseFirst();
        await second;

        expect(events).toEqual([
            'start:First request.',
            'finish:First request.',
            'start:Second request.',
            'finish:Second request.',
        ]);
    });

    test('rejects unknown voices', async () => {
        const service = new KokoroTtsService({
            enabled: true,
            modelId: 'test-model',
            voices: [{ id: 'af_heart' }],
        });

        await expect(service.synthesize({
            text: 'Hello.',
            voiceId: 'missing',
        })).rejects.toMatchObject({
            statusCode: 400,
            code: 'unknown_voice',
        });
    });

    test('returns unavailable diagnostics when disabled', () => {
        const service = new KokoroTtsService({
            enabled: false,
            voices: [{ id: 'af_heart' }],
        });

        expect(service.getPublicConfig()).toEqual(expect.objectContaining({
            configured: false,
            provider: 'kokoro',
            defaultVoiceId: null,
            diagnostics: expect.objectContaining({
                status: 'unavailable',
                message: 'Kokoro TTS is disabled.',
            }),
        }));
    });

    test('times out slow model loading', async () => {
        const service = new KokoroTtsService({
            enabled: true,
            modelId: 'test-model',
            voices: [{ id: 'af_heart' }],
            timeoutMs: 1,
        }, {
            importKokoro: () => ({
                KokoroTTS: {
                    from_pretrained: () => new Promise(() => {}),
                },
            }),
        });

        await expect(service.synthesize({
            text: 'Hello.',
            voiceId: 'af_heart',
            timeoutMs: 1,
        })).rejects.toMatchObject({
            statusCode: 504,
            code: 'tts_timeout',
        });
    });
});
