const { TtsService } = require('./tts-service');

function createProvider(id, diagnosticsStatus = 'ready', synthesizeImpl = async () => ({
    provider: id,
    audioBuffer: Buffer.from(`${id}-audio`),
})) {
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
});
