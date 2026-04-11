const { config } = require('../config');
const { piperTtsService } = require('./piper-tts-service');

class TtsService {
    constructor(ttsConfig = config.tts || {}, providers = {}) {
        this.ttsConfig = {
            ...ttsConfig,
        };
        if (Object.prototype.hasOwnProperty.call(providers, 'provider')) {
            this.provider = providers.provider;
        } else if (Object.prototype.hasOwnProperty.call(providers, 'piper')) {
            this.provider = providers.piper;
        } else {
            this.provider = piperTtsService;
        }
    }

    getProvider() {
        return this.provider || null;
    }

    getPublicConfig() {
        const publicConfig = this.getProvider()?.getPublicConfig?.();
        if (!publicConfig || typeof publicConfig !== 'object') {
            return {
                configured: false,
                provider: 'none',
                maxTextChars: 2400,
                defaultVoiceId: null,
                voices: [],
                providers: [],
                diagnostics: {
                    status: 'unavailable',
                    binaryReachable: false,
                    voicesLoaded: false,
                    message: 'No TTS providers are configured.',
                },
            };
        }

        const configured = publicConfig.configured === true;
        const providerId = String(publicConfig.provider || 'piper').trim() || 'piper';
        const voices = Array.isArray(publicConfig.voices) ? publicConfig.voices : [];
        const maxTextChars = Math.max(200, Number(publicConfig.maxTextChars) || 2400);
        const defaultVoiceId = configured
            ? (String(publicConfig.defaultVoiceId || '').trim() || voices[0]?.id || null)
            : null;
        const diagnostics = publicConfig.diagnostics && typeof publicConfig.diagnostics === 'object'
            ? {
                ...publicConfig.diagnostics,
                status: String(publicConfig.diagnostics.status || '').trim() || (configured ? 'ready' : 'unavailable'),
                voicesLoaded: voices.length > 0,
            }
            : {
                status: configured ? 'ready' : 'unavailable',
                binaryReachable: configured === true,
                voicesLoaded: voices.length > 0,
                message: configured ? 'Voice playback is ready.' : 'Voice playback is unavailable.',
            };
        const providerConfig = {
            configured,
            provider: providerId,
            maxTextChars,
            defaultVoiceId,
            voices,
            diagnostics,
        };

        return {
            ...providerConfig,
            providers: [providerConfig],
        };
    }

    async synthesize({ text = '', voiceId = '' } = {}) {
        const provider = this.getProvider();
        if (!provider?.synthesize) {
            const error = new Error('No TTS providers are configured.');
            error.statusCode = 503;
            error.code = 'tts_unavailable';
            throw error;
        }

        return provider.synthesize({
            text,
            voiceId,
        });
    }
}

const ttsService = new TtsService();

module.exports = {
    TtsService,
    ttsService,
};
