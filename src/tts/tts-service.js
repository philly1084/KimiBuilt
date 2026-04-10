const { config } = require('../config');
const { openAiTtsService } = require('./openai-tts-service');
const { piperTtsService } = require('./piper-tts-service');

class TtsService {
    constructor(ttsConfig = config.tts || {}, providers = {}) {
        this.ttsConfig = {
            ...ttsConfig,
        };
        this.providers = {
            openai: providers.openai || openAiTtsService,
            piper: providers.piper || piperTtsService,
        };
    }

    getPreferredProviderOrder() {
        const configuredPreference = String(this.ttsConfig.provider || 'auto').trim().toLowerCase();
        if (configuredPreference === 'openai') {
            return ['openai', 'piper'];
        }

        if (configuredPreference === 'piper') {
            return ['piper', 'openai'];
        }

        return ['openai', 'piper'];
    }

    getProvider(providerId = '') {
        return this.providers[String(providerId || '').trim().toLowerCase()] || null;
    }

    getActiveProvider() {
        const order = this.getPreferredProviderOrder();
        const readyProviderId = order.find((providerId) => {
            const provider = this.getProvider(providerId);
            return provider?.getDiagnostics?.().status === 'ready';
        });

        if (readyProviderId) {
            return this.getProvider(readyProviderId);
        }

        return this.getProvider(order[0]) || this.getProvider(order[1]) || null;
    }

    resolveProviderForVoice(voiceId = '') {
        const normalizedVoiceId = String(voiceId || '').trim();
        if (!normalizedVoiceId) {
            return null;
        }

        return Object.values(this.providers).find((provider) => (
            typeof provider?.resolveVoiceProfile === 'function'
            && Boolean(provider.resolveVoiceProfile(normalizedVoiceId))
        )) || null;
    }

    getPublicConfig() {
        const activeProvider = this.getActiveProvider();
        if (!activeProvider) {
            return {
                configured: false,
                provider: 'none',
                maxTextChars: 2400,
                defaultVoiceId: null,
                voices: [],
                diagnostics: {
                    status: 'unavailable',
                    binaryReachable: false,
                    voicesLoaded: false,
                    message: 'No TTS providers are configured.',
                },
            };
        }

        return activeProvider.getPublicConfig();
    }

    async synthesize({ text = '', voiceId = '' } = {}) {
        const provider = this.resolveProviderForVoice(voiceId) || this.getActiveProvider();
        if (!provider) {
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
