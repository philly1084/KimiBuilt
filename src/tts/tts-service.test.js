const { TtsService } = require('./tts-service');

function createProvider(diagnosticsStatus = 'ready', synthesizeImpl = async () => ({
    provider: 'piper',
    audioBuffer: Buffer.from('piper-audio'),
}), publicConfigOverrides = {}) {
    return {
        getPublicConfig: jest.fn(() => ({
            configured: diagnosticsStatus === 'ready',
            provider: 'piper',
            voices: [{
                id: 'hfc-female-rich',
                label: 'HFC Rich',
                provider: 'piper',
            }],
            diagnostics: {
                status: diagnosticsStatus,
            },
            ...publicConfigOverrides,
        })),
        synthesize: jest.fn(synthesizeImpl),
    };
}

describe('TtsService', () => {
    test('delegates synthesis to the Piper provider', async () => {
        const piper = createProvider('ready');
        const service = new TtsService({}, {
            piper,
        });

        const result = await service.synthesize({
            text: 'Hello there.',
            voiceId: 'hfc-female-rich',
        });

        expect(piper.synthesize).toHaveBeenCalledWith({
            text: 'Hello there.',
            voiceId: 'hfc-female-rich',
        });
        expect(result.provider).toBe('piper');
    });

    test('forwards timeout overrides to the active provider when supplied', async () => {
        const piper = createProvider('ready');
        const service = new TtsService({}, {
            piper,
        });

        await service.synthesize({
            text: 'Hello there.',
            voiceId: 'hfc-female-rich',
            timeoutMs: 180000,
        });

        expect(piper.synthesize).toHaveBeenCalledWith({
            text: 'Hello there.',
            voiceId: 'hfc-female-rich',
            timeoutMs: 180000,
        });
    });

    test('returns the Piper public config plus a single-provider catalog', () => {
        const piper = createProvider('ready', undefined, {
            maxTextChars: 2400,
            defaultVoiceId: 'hfc-female-rich',
            diagnostics: {
                status: 'ready',
                message: '1 Piper voice ready.',
                binaryReachable: true,
                voicesLoaded: true,
            },
        });
        const service = new TtsService({}, {
            piper,
        });

        expect(service.getPublicConfig()).toEqual(expect.objectContaining({
            configured: true,
            provider: 'piper',
            maxTextChars: 2400,
            defaultVoiceId: 'hfc-female-rich',
            voices: [
                expect.objectContaining({ id: 'hfc-female-rich', provider: 'piper' }),
            ],
            providers: [
                expect.objectContaining({ provider: 'piper', configured: true }),
            ],
            diagnostics: expect.objectContaining({
                status: 'ready',
                voicesLoaded: true,
            }),
        }));
    });

    test('keeps Piper voices visible even when the provider is misconfigured', () => {
        const piper = createProvider('misconfigured', undefined, {
            configured: false,
            defaultVoiceId: 'hfc-female-rich',
            diagnostics: {
                status: 'misconfigured',
                message: 'Piper binary is missing.',
                binaryReachable: false,
                voicesLoaded: true,
            },
        });
        const service = new TtsService({}, {
            piper,
        });

        expect(service.getPublicConfig()).toEqual(expect.objectContaining({
            configured: false,
            provider: 'piper',
            defaultVoiceId: null,
            voices: [
                expect.objectContaining({ id: 'hfc-female-rich', provider: 'piper' }),
            ],
            providers: [
                expect.objectContaining({ provider: 'piper', configured: false }),
            ],
            diagnostics: expect.objectContaining({
                status: 'misconfigured',
                voicesLoaded: true,
            }),
        }));
    });

    test('returns an unavailable payload when no provider is configured', async () => {
        const service = new TtsService({}, {
            provider: null,
            piper: null,
        });

        expect(service.getPublicConfig()).toEqual(expect.objectContaining({
            configured: false,
            provider: 'none',
            voices: [],
            providers: [],
            diagnostics: expect.objectContaining({
                status: 'unavailable',
                voicesLoaded: false,
            }),
        }));

        await expect(service.synthesize({
            text: 'Hello there.',
        })).rejects.toMatchObject({
            statusCode: 503,
            code: 'tts_unavailable',
        });
    });

    test('surfaces Piper synthesis errors without fallback behavior', async () => {
        const piperError = new Error('Piper failed');
        piperError.statusCode = 502;
        piperError.code = 'tts_failed';

        const piper = createProvider('ready', async () => {
            throw piperError;
        });
        const service = new TtsService({}, {
            piper,
        });

        await expect(service.synthesize({
            text: 'Hello there.',
            voiceId: 'hfc-female-rich',
        })).rejects.toThrow('Piper failed');

        expect(piper.synthesize).toHaveBeenCalledTimes(1);
    });
});
