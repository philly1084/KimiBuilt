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

        const openAiReady = this.getProvider('openai')?.getDiagnostics?.().status === 'ready';
        const piperReady = this.getProvider('piper')?.getDiagnostics?.().status === 'ready';

        if (openAiReady) {
            return ['openai', 'piper'];
        }

        if (piperReady) {
            return ['piper', 'openai'];
        }

        return ['piper', 'openai'];
    }

    getProvider(providerId = '') {
        return this.providers[String(providerId || '').trim().toLowerCase()] || null;
    }

    getOrderedProviders() {
        const seen = new Set();
        return this.getPreferredProviderOrder()
            .map((providerId) => {
                const normalizedProviderId = String(providerId || '').trim().toLowerCase();
                if (!normalizedProviderId || seen.has(normalizedProviderId)) {
                    return null;
                }

                seen.add(normalizedProviderId);
                return {
                    id: normalizedProviderId,
                    provider: this.getProvider(normalizedProviderId),
                };
            })
            .filter((entry) => Boolean(entry?.provider));
    }

    getActiveProvider() {
        const order = this.getOrderedProviders();
        const readyProviderId = order.find(({ provider }) => {
            return provider?.getDiagnostics?.().status === 'ready';
        })?.id;

        if (readyProviderId) {
            return this.getProvider(readyProviderId);
        }

        return order[0]?.provider || order[1]?.provider || null;
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
        const providerConfigs = this.getOrderedProviders()
            .map(({ id, provider }) => {
                const publicConfig = provider?.getPublicConfig?.();
                if (!publicConfig || typeof publicConfig !== 'object') {
                    return null;
                }

                return {
                    configured: publicConfig.configured === true,
                    provider: String(publicConfig.provider || id).trim() || id,
                    maxTextChars: Math.max(200, Number(publicConfig.maxTextChars) || 2400),
                    defaultVoiceId: String(publicConfig.defaultVoiceId || '').trim() || null,
                    voices: Array.isArray(publicConfig.voices) ? publicConfig.voices : [],
                    diagnostics: publicConfig.diagnostics && typeof publicConfig.diagnostics === 'object'
                        ? {
                            ...publicConfig.diagnostics,
                            status: String(publicConfig.diagnostics.status || '').trim() || (publicConfig.configured ? 'ready' : 'unavailable'),
                        }
                        : {
                            status: publicConfig.configured ? 'ready' : 'unavailable',
                            binaryReachable: publicConfig.configured === true,
                            voicesLoaded: Array.isArray(publicConfig.voices) && publicConfig.voices.length > 0,
                            message: publicConfig.configured ? 'Voice playback is ready.' : 'Voice playback is unavailable.',
                        },
                };
            })
            .filter(Boolean);

        const activeConfig = providerConfigs.find((configEntry) => configEntry.diagnostics?.status === 'ready')
            || providerConfigs[0]
            || null;

        if (!activeConfig) {
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

        const configuredVoiceProviders = providerConfigs.filter((configEntry) => (
            configEntry.configured === true
            && Array.isArray(configEntry.voices)
            && configEntry.voices.length > 0
        ));

        const seenVoiceIds = new Set();
        const voices = configuredVoiceProviders
            .flatMap((configEntry) => configEntry.voices || [])
            .filter((voice) => {
                const voiceId = String(voice?.id || '').trim();
                if (!voiceId || seenVoiceIds.has(voiceId)) {
                    return false;
                }

                seenVoiceIds.add(voiceId);
                return true;
            });

        const configured = providerConfigs.some((configEntry) => configEntry.configured === true);
        const maxTextChars = activeConfig.maxTextChars
            || Math.max(200, ...providerConfigs.map((configEntry) => Number(configEntry.maxTextChars) || 2400));
        const defaultVoiceId = configured
            ? (activeConfig.defaultVoiceId || voices[0]?.id || null)
            : null;

        return {
            configured,
            provider: activeConfig.provider || 'none',
            maxTextChars,
            defaultVoiceId,
            voices,
            providers: providerConfigs,
            diagnostics: {
                ...activeConfig.diagnostics,
                voicesLoaded: voices.length > 0,
            },
        };
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
