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

        return ['piper', 'openai'];
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

    getProviderCandidates(voiceId = '') {
        const explicitProvider = this.resolveProviderForVoice(voiceId);
        if (explicitProvider) {
            return [explicitProvider];
        }

        const orderedProviders = this.getPreferredProviderOrder()
            .map((providerId) => this.getProvider(providerId))
            .filter(Boolean);
        const readyProviders = orderedProviders.filter((provider) => provider?.getDiagnostics?.().status === 'ready');
        const candidates = [];
        const seen = new Set();

        [...readyProviders, ...orderedProviders].forEach((provider) => {
            if (!provider || seen.has(provider)) {
                return;
            }
            seen.add(provider);
            candidates.push(provider);
        });

        return candidates;
    }

    shouldFallbackAfterError(error = null) {
        const statusCode = Number(error?.statusCode || error?.status || 0);
        if (!statusCode) {
            return true;
        }

        if (statusCode >= 500 || statusCode === 429) {
            return true;
        }

        return [
            'tts_unavailable',
            'tts_failed',
            'tts_timeout',
            'tts_binary_missing',
            'tts_empty_audio',
        ].includes(String(error?.code || '').trim());
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
        const providers = this.getProviderCandidates(voiceId);
        if (providers.length === 0) {
            const error = new Error('No TTS providers are configured.');
            error.statusCode = 503;
            error.code = 'tts_unavailable';
            throw error;
        }

        const hasExplicitVoice = Boolean(String(voiceId || '').trim());
        let lastError = null;

        for (const provider of providers) {
            try {
                return await provider.synthesize({
                    text,
                    voiceId,
                });
            } catch (error) {
                lastError = error;
                if (hasExplicitVoice || !this.shouldFallbackAfterError(error)) {
                    throw error;
                }
            }
        }

        throw lastError;
    }
}

const ttsService = new TtsService();

module.exports = {
    TtsService,
    ttsService,
};
