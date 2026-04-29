const fsSync = require('fs');
const { config } = require('../config');
const { createServiceError, normalizeTextForSpeech } = require('./speech-text');

const DEFAULT_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DEFAULT_VOICE_ID = 'af_heart';
const DEFAULT_VOICE_LABEL = 'Heart Studio';
const DEFAULT_VOICE_DESCRIPTION = 'Primary high-quality Kokoro voice for polished local speech.';

function normalizeVoiceList(voices = []) {
    return (Array.isArray(voices) ? voices : [])
        .map((voice) => ({
            id: String(voice?.id || voice?.voiceId || '').trim(),
            label: String(voice?.label || voice?.voiceLabel || '').trim(),
            description: String(voice?.description || voice?.voiceDescription || '').trim(),
            aliases: Array.isArray(voice?.aliases)
                ? voice.aliases.map((alias) => String(alias || '').trim()).filter(Boolean)
                : [],
        }))
        .filter((voice) => voice.id);
}

function toNodeDevice(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (['cpu', 'wasm', 'webgpu'].includes(normalized)) {
        return normalized;
    }
    return 'cpu';
}

function toDtype(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (['fp32', 'fp16', 'q8', 'q4', 'q4f16'].includes(normalized)) {
        return normalized;
    }
    return 'q8';
}

function withTimeout(promise, timeoutMs, message) {
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(createServiceError(504, message, 'tts_timeout'));
        }, Math.max(1000, Number(timeoutMs) || 90000));
    });

    return Promise.race([promise, timeoutPromise])
        .finally(() => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        });
}

class KokoroTtsService {
    constructor(ttsConfig = config.tts?.kokoro || {}, dependencies = {}) {
        this.ttsConfig = {
            ...ttsConfig,
        };
        this.importKokoro = dependencies.importKokoro || (() => require('kokoro-js'));
        this.modelPromise = null;
    }

    pathExists(targetPath = '') {
        const normalizedPath = String(targetPath || '').trim();
        if (!normalizedPath) {
            return false;
        }

        try {
            return fsSync.existsSync(normalizedPath);
        } catch (_error) {
            return false;
        }
    }

    getVoiceProfiles() {
        const configured = normalizeVoiceList(this.ttsConfig.voices);
        if (configured.length > 0) {
            return configured.map((voice) => ({
                ...voice,
                ...this.toPublicVoiceProfile(voice),
            }));
        }

        return [this.toPublicVoiceProfile({
            id: DEFAULT_VOICE_ID,
            label: DEFAULT_VOICE_LABEL,
            description: DEFAULT_VOICE_DESCRIPTION,
        })];
    }

    getDiagnostics() {
        const enabled = this.ttsConfig.enabled !== false;
        const voices = this.getVoiceProfiles();
        const hasModelId = Boolean(String(this.ttsConfig.modelId || DEFAULT_MODEL_ID).trim());

        if (!enabled) {
            return {
                status: 'unavailable',
                modelReachable: false,
                voicesLoaded: voices.length > 0,
                message: 'Kokoro TTS is disabled.',
            };
        }

        if (!hasModelId) {
            return {
                status: 'misconfigured',
                modelReachable: false,
                voicesLoaded: voices.length > 0,
                message: 'Kokoro TTS is enabled, but no model ID is configured.',
            };
        }

        if (voices.length === 0) {
            return {
                status: 'misconfigured',
                modelReachable: true,
                voicesLoaded: false,
                message: 'Kokoro voices are not configured.',
            };
        }

        return {
            status: 'ready',
            modelReachable: true,
            voicesLoaded: true,
            message: `${voices.length} Kokoro voice${voices.length === 1 ? '' : 's'} ready.`,
        };
    }

    isConfigured() {
        return this.getDiagnostics().status === 'ready';
    }

    toPublicVoiceProfile(voice = {}) {
        return {
            id: String(voice.id || DEFAULT_VOICE_ID).trim() || DEFAULT_VOICE_ID,
            label: String(voice.label || DEFAULT_VOICE_LABEL).trim() || DEFAULT_VOICE_LABEL,
            description: String(voice.description || DEFAULT_VOICE_DESCRIPTION).trim() || DEFAULT_VOICE_DESCRIPTION,
            provider: 'kokoro',
            aliases: Array.isArray(voice.aliases) ? voice.aliases.slice() : [],
        };
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
        return voices.find((voice) => voice.id === defaultVoiceId || voice.aliases?.includes(defaultVoiceId)) || voices[0];
    }

    getPublicConfig() {
        const diagnostics = this.getDiagnostics();
        const configured = diagnostics.status === 'ready';
        const voices = this.getVoiceProfiles().map((voice) => this.toPublicVoiceProfile(voice));
        const defaultVoice = configured ? this.resolveVoiceProfile() : null;
        const maxTextChars = Math.max(200, Number(this.ttsConfig.maxTextChars) || 2400);
        const timeoutMs = Math.max(1000, Number(this.ttsConfig.timeoutMs) || 90000);
        const podcastTimeoutMs = Math.max(
            timeoutMs,
            Number(this.ttsConfig.podcastTimeoutMs) || timeoutMs,
        );
        const podcastChunkChars = Math.max(
            250,
            Math.min(
                maxTextChars,
                Number(this.ttsConfig.podcastChunkChars) || Math.min(900, maxTextChars),
            ),
        );

        return {
            configured,
            provider: 'kokoro',
            modelId: String(this.ttsConfig.modelId || DEFAULT_MODEL_ID).trim() || DEFAULT_MODEL_ID,
            device: toNodeDevice(this.ttsConfig.device),
            dtype: toDtype(this.ttsConfig.dtype),
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
            diagnostics.message || 'Kokoro TTS is not configured.',
            'tts_unavailable',
        );
    }

    async getModel() {
        this.assertConfigured();
        if (!this.modelPromise) {
            const modelId = String(this.ttsConfig.modelId || DEFAULT_MODEL_ID).trim() || DEFAULT_MODEL_ID;
            this.modelPromise = Promise.resolve()
                .then(() => this.importKokoro())
                .then((moduleExports) => {
                    const KokoroTTS = moduleExports?.KokoroTTS;
                    if (!KokoroTTS?.from_pretrained) {
                        throw createServiceError(503, 'kokoro-js did not expose KokoroTTS.', 'tts_unavailable');
                    }
                    return KokoroTTS.from_pretrained(modelId, {
                        dtype: toDtype(this.ttsConfig.dtype),
                        device: toNodeDevice(this.ttsConfig.device),
                    });
                })
                .catch((error) => {
                    this.modelPromise = null;
                    if (error?.statusCode) {
                        throw error;
                    }
                    throw createServiceError(
                        503,
                        error?.message ? `Kokoro model failed to load: ${error.message}` : 'Kokoro model failed to load.',
                        'tts_unavailable',
                    );
                });
        }

        return this.modelPromise;
    }

    async synthesize({ text = '', voiceId = '', timeoutMs } = {}) {
        this.assertConfigured();

        const selectedVoice = this.resolveVoiceProfile(voiceId);
        if (voiceId && !selectedVoice) {
            throw createServiceError(400, `Unknown Kokoro voice "${voiceId}".`, 'unknown_voice');
        }
        if (!selectedVoice) {
            throw createServiceError(503, 'Kokoro TTS has no configured voices.', 'tts_unavailable');
        }

        const speakableText = normalizeTextForSpeech(
            text,
            Math.max(200, Number(this.ttsConfig.maxTextChars) || 2400),
        );
        const effectiveTimeoutMs = Math.max(1000, Number(timeoutMs) || Number(this.ttsConfig.timeoutMs) || 90000);

        try {
            const model = await withTimeout(
                this.getModel(),
                effectiveTimeoutMs,
                'Kokoro TTS timed out before the model loaded.',
            );
            const audio = await withTimeout(
                model.generate(speakableText, {
                    voice: selectedVoice.id,
                    speed: Number(this.ttsConfig.speed) || 1,
                }),
                effectiveTimeoutMs,
                'Kokoro TTS timed out before audio generation completed.',
            );
            const wav = typeof audio?.toWav === 'function' ? audio.toWav() : null;
            const audioBuffer = wav ? Buffer.from(wav) : Buffer.alloc(0);
            if (!audioBuffer.length) {
                throw createServiceError(502, 'Kokoro TTS returned an empty audio file.', 'tts_empty_audio');
            }

            return {
                provider: 'kokoro',
                audioBuffer,
                contentType: 'audio/wav',
                text: speakableText,
                voice: this.toPublicVoiceProfile(selectedVoice),
            };
        } catch (error) {
            if (error?.code === 'tts_timeout') {
                this.modelPromise = null;
            }
            if (error?.statusCode) {
                throw error;
            }

            throw createServiceError(502, error.message || 'Kokoro TTS failed.', 'tts_failed');
        }
    }
}

const kokoroTtsService = new KokoroTtsService();

module.exports = {
    DEFAULT_MODEL_ID,
    DEFAULT_VOICE_DESCRIPTION,
    DEFAULT_VOICE_ID,
    DEFAULT_VOICE_LABEL,
    KokoroTtsService,
    kokoroTtsService,
};
