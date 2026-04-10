const { TtsService } = require('./tts-service');

function buildProvider({
    provider = 'piper',
    status = 'ready',
    defaultVoiceId = 'voice-1',
} = {}) {
    return {
        getDiagnostics: jest.fn(() => ({
            status,
        })),
        getPublicConfig: jest.fn(() => ({
            configured: status === 'ready',
            provider,
            defaultVoiceId,
            voices: [{ id: defaultVoiceId, provider }],
            diagnostics: { status },
        })),
        resolveVoiceProfile: jest.fn((voiceId = '') => (
            voiceId === defaultVoiceId ? { id: defaultVoiceId, provider } : null
        )),
        synthesize: jest.fn(async ({ text = '', voiceId = '' } = {}) => ({
            provider,
            audioBuffer: Buffer.from(text || voiceId || provider),
            voice: { id: voiceId || defaultVoiceId, provider },
        })),
    };
}

describe('TtsService', () => {
    test('prefers local Piper when provider is auto', () => {
        const piper = buildProvider({ provider: 'piper', status: 'ready', defaultVoiceId: 'hfc-female-rich' });
        const openai = buildProvider({ provider: 'openai', status: 'ready', defaultVoiceId: 'openai-marin-natural' });
        const service = new TtsService({
            provider: 'auto',
        }, {
            piper,
            openai,
        });

        const config = service.getPublicConfig();

        expect(config.provider).toBe('piper');
        expect(config.defaultVoiceId).toBe('hfc-female-rich');
    });

    test('routes synthesis to the provider that owns the selected voice', async () => {
        const piper = buildProvider({ provider: 'piper', status: 'ready', defaultVoiceId: 'hfc-female-rich' });
        const openai = buildProvider({ provider: 'openai', status: 'ready', defaultVoiceId: 'openai-marin-natural' });
        const service = new TtsService({
            provider: 'piper',
        }, {
            piper,
            openai,
        });

        await service.synthesize({
            text: 'Hello there.',
            voiceId: 'openai-marin-natural',
        });

        expect(openai.synthesize).toHaveBeenCalledWith(expect.objectContaining({
            text: 'Hello there.',
            voiceId: 'openai-marin-natural',
        }));
        expect(piper.synthesize).not.toHaveBeenCalled();
    });
});
