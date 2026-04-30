const { config } = require('../config');
const { createServiceError, normalizeTextForSpeech } = require('./speech-text');

const DEFAULT_PROVIDER = 'openai';
const DEFAULT_MODEL_ID = 'gpt-4o-mini-tts';
const DEFAULT_VOICE_ID = 'coral';
const DEFAULT_RESPONSE_FORMAT = 'wav';
const DEFAULT_INSTRUCTIONS = 'Use a natural, clear podcast delivery with steady pacing, clean articulation, and light conversational energy.';

const BUILT_IN_VOICES = Object.freeze([
    {
        id: 'coral',
        label: 'Coral Host',
        description: 'Warm, polished podcast host voice.',
        aliases: ['af_heart', 'heart-studio', 'piper-female-natural', 'hfc-female-rich'],
        instructions: 'Warm lead host delivery with confident pacing and clear transitions.',
    },
    {
        id: 'verse',
        label: 'Verse Co-host',
        description: 'Grounded conversational co-host voice.',
        aliases: ['am_adam', 'ryan-high', 'ryan-direct'],
        instructions: 'Grounded co-host delivery with a calm, conversational rhythm.',
    },
    {
        id: 'nova',
        label: 'Nova Energy',
        description: 'Bright, expressive studio voice.',
        aliases: ['af_bella', 'ljspeech-high', 'amy-expressive'],
        instructions: 'Expressive podcast delivery with crisp articulation and natural emphasis.',
    },
    {
        id: 'sage',
        label: 'Sage Editorial',
        description: 'Measured editorial podcast voice.',
        aliases: ['bf_emma', 'cori-high', 'lessac-high'],
        instructions: 'Measured editorial delivery with thoughtful pauses and clean diction.',
    },
    {
        id: 'alloy',
        label: 'Alloy Neutral',
        description: 'Balanced neutral narration voice.',
        aliases: ['amy-medium'],
    },
    {
        id: 'ash',
        label: 'Ash Studio',
        description: 'Steady studio narration voice.',
        aliases: [],
    },
    {
        id: 'ballad',
        label: 'Ballad Story',
        description: 'Narrative voice suited to long-form storytelling.',
        aliases: [],
    },
    {
        id: 'echo',
        label: 'Echo Direct',
        description: 'Direct, clear speech voice.',
        aliases: [],
    },
    {
        id: 'fable',
        label: 'Fable Narrative',
        description: 'Story-forward narration voice.',
        aliases: [],
    },
    {
        id: 'onyx',
        label: 'Onyx Deep',
        description: 'Lower-register narration voice.',
        aliases: ['bm_george'],
    },
    {
        id: 'shimmer',
        label: 'Shimmer Bright',
        description: 'Bright polished narration voice.',
        aliases: ['amy-broadcast'],
    },
    {
        id: 'marin',
        label: 'Marin Natural',
        description: 'Natural clear studio voice.',
        aliases: [],
    },
    {
        id: 'cedar',
        label: 'Cedar Warm',
        description: 'Warm grounded studio voice.',
        aliases: [],
    },
]);

const RESPONSE_FORMAT_CONTENT_TYPES = {
    aac: 'audio/aac',
    flac: 'audio/flac',
    mp3: 'audio/mpeg',
    opus: 'audio/opus',
    pcm: 'audio/pcm',
    wav: 'audio/wav',
};

function normalizeVoiceList(voices = []) {
    return (Array.isArray(voices) ? voices : [])
        .map((voice) => ({
            id: String(voice?.id || voice?.voiceId || '').trim(),
            label: String(voice?.label || voice?.voiceLabel || '').trim(),
            description: String(voice?.description || voice?.voiceDescription || '').trim(),
            instructions: String(voice?.instructions || voice?.styleInstructions || '').trim(),
            custom: voice?.custom === true || String(voice?.type || '').trim().toLowerCase() === 'custom',
            aliases: Array.isArray(voice?.aliases)
                ? voice.aliases.map((alias) => String(alias || '').trim()).filter(Boolean)
                : [],
        }))
        .filter((voice) => voice.id);
}

function normalizeResponseFormat(value = '') {
    const normalized = String(value || DEFAULT_RESPONSE_FORMAT).trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(RESPONSE_FORMAT_CONTENT_TYPES, normalized)
        ? normalized
        : DEFAULT_RESPONSE_FORMAT;
}

function modelSupportsInstructions(modelId = '') {
    const normalized = String(modelId || '').trim().toLowerCase();
    return normalized !== 'tts-1' && normalized !== 'tts-1-hd';
}

function withTrailingSpeechPath(baseURL = '') {
    const normalized = String(baseURL || '').trim().replace(/\/+$/, '');
    return `${normalized}/audio/speech`;
}

async function readErrorPayload(response) {
    try {
        const payload = await response.json();
        return payload?.error || payload || {};
    } catch (_jsonError) {
        try {
            const text = await response.text();
            return {
                message: String(text || '').trim(),
            };
        } catch (_textError) {
            return {};
        }
    }
}

class OpenAiTtsService {
    constructor(ttsConfig = config.tts?.openai || {}, dependencies = {}) {
        this.ttsConfig = {
            ...ttsConfig,
        };
        this.fetch = dependencies.fetch || global.fetch;
    }

    getBaseURL() {
        return String(this.ttsConfig.baseURL || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
    }

    getVoiceProfiles() {
        const configured = normalizeVoiceList(this.ttsConfig.voices);
        const voices = configured.length > 0 ? configured : normalizeVoiceList(BUILT_IN_VOICES);
        return voices.map((voice) => this.toPublicVoiceProfile(voice));
    }

    resolveVoiceProfile(voiceId = '') {
        const voices = this.getVoiceProfiles();
        if (voices.length === 0) {
            return null;
        }

        const requestedVoiceId = String(voiceId || '').trim();
        if (requestedVoiceId) {
            return voices.find((voice) => (
                voice.id === requestedVoiceId
                || (Array.isArray(voice.aliases) && voice.aliases.includes(requestedVoiceId))
            )) || null;
        }

        const defaultVoiceId = String(this.ttsConfig.defaultVoiceId || this.ttsConfig.voiceId || DEFAULT_VOICE_ID).trim();
        return voices.find((voice) => voice.id === defaultVoiceId || voice.aliases?.includes(defaultVoiceId)) || voices[0] || null;
    }

    getDiagnostics() {
        const enabled = this.ttsConfig.enabled !== false;
        const apiKey = String(this.ttsConfig.apiKey || '').trim();
        const modelId = String(this.ttsConfig.modelId || DEFAULT_MODEL_ID).trim();
        const baseURL = this.getBaseURL();
        const voices = this.getVoiceProfiles();

        if (!enabled) {
            return {
                status: 'unavailable',
                modelReachable: false,
                voicesLoaded: voices.length > 0,
                message: 'OpenAI TTS is disabled.',
            };
        }

        if (!apiKey) {
            return {
                status: 'misconfigured',
                modelReachable: false,
                voicesLoaded: voices.length > 0,
                message: 'OpenAI TTS is enabled, but no API key is configured.',
            };
        }

        if (!baseURL) {
            return {
                status: 'misconfigured',
                modelReachable: false,
                voicesLoaded: voices.length > 0,
                message: 'OpenAI TTS base URL is not configured.',
            };
        }

        if (!modelId) {
            return {
                status: 'misconfigured',
                modelReachable: false,
                voicesLoaded: voices.length > 0,
                message: 'OpenAI TTS is enabled, but no speech model is configured.',
            };
        }

        if (voices.length === 0) {
            return {
                status: 'misconfigured',
                modelReachable: true,
                voicesLoaded: false,
                message: 'OpenAI TTS voices are not configured.',
            };
        }

        return {
            status: 'ready',
            modelReachable: true,
            voicesLoaded: true,
            message: `${voices.length} OpenAI TTS voice${voices.length === 1 ? '' : 's'} ready.`,
        };
    }

    isConfigured() {
        return this.getDiagnostics().status === 'ready';
    }

    toPublicVoiceProfile(voice = {}) {
        return {
            id: String(voice.id || DEFAULT_VOICE_ID).trim() || DEFAULT_VOICE_ID,
            label: String(voice.label || voice.id || DEFAULT_VOICE_ID).trim() || DEFAULT_VOICE_ID,
            description: String(voice.description || 'OpenAI text-to-speech voice.').trim(),
            provider: DEFAULT_PROVIDER,
            aliases: Array.isArray(voice.aliases) ? voice.aliases.slice() : [],
            custom: voice.custom === true,
            instructions: String(voice.instructions || '').trim() || undefined,
        };
    }

    getPublicConfig() {
        const diagnostics = this.getDiagnostics();
        const configured = diagnostics.status === 'ready';
        const voices = this.getVoiceProfiles();
        const defaultVoice = configured ? this.resolveVoiceProfile() : null;
        const maxTextChars = Math.max(200, Number(this.ttsConfig.maxTextChars) || 3600);
        const timeoutMs = Math.max(1000, Number(this.ttsConfig.timeoutMs) || 120000);
        const podcastTimeoutMs = Math.max(timeoutMs, Number(this.ttsConfig.podcastTimeoutMs) || timeoutMs);
        const podcastChunkChars = Math.max(
            250,
            Math.min(maxTextChars, Number(this.ttsConfig.podcastChunkChars) || Math.min(3000, maxTextChars)),
        );

        return {
            configured,
            provider: DEFAULT_PROVIDER,
            mode: 'cloud',
            baseURL: this.getBaseURL() || null,
            modelId: String(this.ttsConfig.modelId || DEFAULT_MODEL_ID).trim() || DEFAULT_MODEL_ID,
            responseFormat: normalizeResponseFormat(this.ttsConfig.responseFormat),
            maxTextChars,
            timeoutMs,
            podcastTimeoutMs,
            podcastChunkChars,
            defaultVoiceId: configured ? (defaultVoice?.id || voices[0]?.id || null) : null,
            voices,
            diagnostics,
        };
    }

    assertConfigured() {
        const diagnostics = this.getDiagnostics();
        if (diagnostics.status === 'ready') {
            return;
        }

        throw createServiceError(
            503,
            diagnostics.message || 'OpenAI TTS is not configured.',
            'tts_unavailable',
        );
    }

    buildRequestPayload({ text, voice, responseFormat }) {
        const modelId = String(this.ttsConfig.modelId || DEFAULT_MODEL_ID).trim() || DEFAULT_MODEL_ID;
        const instructions = String(voice?.instructions || this.ttsConfig.instructions || DEFAULT_INSTRUCTIONS).trim();
        const speed = Number(this.ttsConfig.speed);
        const payload = {
            model: modelId,
            input: text,
            voice: voice?.custom === true ? { id: voice.id } : voice.id,
            response_format: responseFormat,
        };

        if (Number.isFinite(speed) && speed > 0) {
            payload.speed = Math.min(Math.max(speed, 0.25), 4);
        }

        if (instructions && modelSupportsInstructions(modelId)) {
            payload.instructions = instructions;
        }

        return payload;
    }

    async synthesize({ text = '', voiceId = '', timeoutMs, responseFormat = '' } = {}) {
        this.assertConfigured();
        if (typeof this.fetch !== 'function') {
            throw createServiceError(503, 'Fetch is not available for OpenAI TTS.', 'tts_unavailable');
        }

        const selectedVoice = this.resolveVoiceProfile(voiceId);
        if (voiceId && !selectedVoice) {
            throw createServiceError(400, `Unknown OpenAI TTS voice "${voiceId}".`, 'unknown_voice');
        }
        if (!selectedVoice) {
            throw createServiceError(503, 'OpenAI TTS has no configured voices.', 'tts_unavailable');
        }

        const outputFormat = normalizeResponseFormat(responseFormat || this.ttsConfig.responseFormat || DEFAULT_RESPONSE_FORMAT);
        const speakableText = normalizeTextForSpeech(
            text,
            Math.max(200, Number(this.ttsConfig.maxTextChars) || 3600),
        );
        const effectiveTimeoutMs = Math.max(1000, Number(timeoutMs) || Number(this.ttsConfig.timeoutMs) || 120000);
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timeoutId = controller
            ? setTimeout(() => controller.abort(), effectiveTimeoutMs)
            : null;

        try {
            const response = await this.fetch(withTrailingSpeechPath(this.getBaseURL()), {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${String(this.ttsConfig.apiKey || '').trim()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(this.buildRequestPayload({
                    text: speakableText,
                    voice: selectedVoice,
                    responseFormat: outputFormat,
                })),
                signal: controller?.signal,
            });

            if (!response.ok) {
                const errorPayload = await readErrorPayload(response);
                throw createServiceError(
                    response.status || 502,
                    errorPayload.message || 'OpenAI TTS failed.',
                    errorPayload.type || errorPayload.code || (response.status === 429 ? 'tts_rate_limited' : 'tts_failed'),
                );
            }

            const audioBuffer = Buffer.from(await response.arrayBuffer());
            if (!audioBuffer.length) {
                throw createServiceError(502, 'OpenAI TTS returned an empty audio file.', 'tts_empty_audio');
            }

            return {
                provider: DEFAULT_PROVIDER,
                audioBuffer,
                contentType: response.headers?.get?.('content-type') || RESPONSE_FORMAT_CONTENT_TYPES[outputFormat] || 'audio/wav',
                text: speakableText,
                modelId: String(this.ttsConfig.modelId || DEFAULT_MODEL_ID).trim() || DEFAULT_MODEL_ID,
                voice: this.toPublicVoiceProfile(selectedVoice),
            };
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw createServiceError(504, 'OpenAI TTS timed out before audio generation completed.', 'tts_timeout');
            }
            if (error?.statusCode) {
                throw error;
            }
            throw createServiceError(
                503,
                error?.message ? `OpenAI TTS is unavailable: ${error.message}` : 'OpenAI TTS is unavailable.',
                'tts_unavailable',
            );
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }
}

const openAiTtsService = new OpenAiTtsService();

module.exports = {
    BUILT_IN_VOICES,
    DEFAULT_MODEL_ID,
    DEFAULT_RESPONSE_FORMAT,
    DEFAULT_VOICE_ID,
    OpenAiTtsService,
    openAiTtsService,
};
