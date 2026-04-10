const { TtsService } = require('./tts-service');

function createProvider(id, diagnosticsStatus = 'ready', synthesizeImpl = async () => ({
    provider: id,
    audioBuffer: Buffer.from(`${id}-audio`),
}), publicConfigOverrides = {}) {
    return {
        getDiagnostics: jest.fn(() => ({
            status: diagnosticsStatus,
        })),
        getPublicConfig: jest.fn(() => ({
            configured: diagnosticsStatus === 'ready',
            provider: id,
            voices: [],
            diagnostics: {
                status: diagnosticsStatus,
            },
            ...publicConfigOverrides,
        })),
        resolveVoiceProfile: jest.fn(() => null),
        synthesize: jest.fn(synthesizeImpl),
    };
}

describe('TtsService', () => {
    test('falls back to the next provider when the preferred provider fails with a retriable error', async () => {
        const piperError = new Error('Piper failed');
        piperError.statusCode = 502;
        piperError.code = 'tts_failed';

        const piper = createProvider('piper', 'ready', async () => {
            throw piperError;
        });
        const openai = createProvider('openai');
        const service = new TtsService({
            provider: 'piper',
        }, {
            piper,
            openai,
        });

        const result = await service.synthesize({
            text: 'Hello there.',
        });

        expect(piper.synthesize).toHaveBeenCalledTimes(1);
        expect(openai.synthesize).toHaveBeenCalledTimes(1);
        expect(result.provider).toBe('openai');
    });

    test('does not fall back when the request explicitly targets a provider voice', async () => {
        const piperError = new Error('Piper failed');
        piperError.statusCode = 502;
        piperError.code = 'tts_failed';

        const piper = createProvider('piper', 'ready', async () => {
            throw piperError;
        });
        piper.resolveVoiceProfile.mockImplementation((voiceId = '') => (
            voiceId === 'piper-female-natural' ? { id: voiceId } : null
        ));
        const openai = createProvider('openai');
        const service = new TtsService({
            provider: 'piper',
        }, {
            piper,
            openai,
        });

        await expect(service.synthesize({
            text: 'Hello there.',
            voiceId: 'piper-female-natural',
        })).rejects.toThrow('Piper failed');

        expect(piper.synthesize).toHaveBeenCalledTimes(1);
        expect(openai.synthesize).not.toHaveBeenCalled();
    });

    test('returns an aggregated public voice catalog across providers', () => {
        const piper = createProvider('piper', 'ready', undefined, {
            defaultVoiceId: 'piper-amy',
            voices: [
                { id: 'piper-amy', label: 'Amy', provider: 'piper' },
                { id: 'piper-hfc', label: 'HFC Rich', provider: 'piper' },
            ],
            diagnostics: {
                status: 'ready',
                message: '2 Piper voices ready.',
            },
        });
        const openai = createProvider('openai', 'ready', undefined, {
            defaultVoiceId: 'openai-marin-natural',
            voices: [
                { id: 'openai-marin-natural', label: 'Marin natural', provider: 'openai' },
            ],
            diagnostics: {
                status: 'ready',
                message: '1 OpenAI voice preset ready.',
            },
        });
        const service = new TtsService({
            provider: 'piper',
        }, {
            piper,
            openai,
        });

        expect(service.getPublicConfig()).toEqual(expect.objectContaining({
            configured: true,
            provider: 'piper',
            defaultVoiceId: 'piper-amy',
            diagnostics: expect.objectContaining({
                status: 'ready',
                voicesLoaded: true,
            }),
            voices: expect.arrayContaining([
                expect.objectContaining({ id: 'piper-amy', provider: 'piper' }),
                expect.objectContaining({ id: 'openai-marin-natural', provider: 'openai' }),
            ]),
            providers: expect.arrayContaining([
                expect.objectContaining({ provider: 'piper', configured: true }),
                expect.objectContaining({ provider: 'openai', configured: true }),
            ]),
        }));
    });

    test('does not expose voices from providers that are not configured', () => {
        const piper = createProvider('piper', 'ready', undefined, {
            defaultVoiceId: 'hfc-female-rich',
            voices: [
                { id: 'hfc-female-rich', label: 'HFC Rich', provider: 'piper' },
            ],
            diagnostics: {
                status: 'ready',
                message: '1 Piper voice ready.',
            },
        });
        const openai = createProvider('openai', 'misconfigured', undefined, {
            configured: false,
            defaultVoiceId: null,
            voices: [
                { id: 'openai-marin-natural', label: 'Marin natural', provider: 'openai' },
            ],
            diagnostics: {
                status: 'misconfigured',
                message: 'OpenAI voice playback is enabled, but no API key is configured.',
            },
        });
        const service = new TtsService({
            provider: 'piper',
        }, {
            piper,
            openai,
        });

        expect(service.getPublicConfig()).toEqual(expect.objectContaining({
            configured: true,
            provider: 'piper',
            defaultVoiceId: 'hfc-female-rich',
            voices: [
                expect.objectContaining({ id: 'hfc-female-rich', provider: 'piper' }),
            ],
            providers: expect.arrayContaining([
                expect.objectContaining({ provider: 'piper', configured: true }),
                expect.objectContaining({ provider: 'openai', configured: false }),
            ]),
        }));
    });
});
