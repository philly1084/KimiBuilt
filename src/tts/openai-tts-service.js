const OpenAI = require('openai');
const { config } = require('../config');
const {
    createServiceError,
    normalizeTextForSpeech,
} = require('./piper-tts-service');

const OPENAI_VOICE_PRESETS = [
    {
        id: 'openai-marin-natural',
        label: 'Marin natural',
        description: 'Premium feminine voice with a balanced, warm, natural delivery.',
        voice: 'marin',
        instructions: 'Speak with a warm, confident feminine tone. Keep pacing smooth, articulation clean, and inflection natural and grounded.',
    },
    {
        id: 'openai-coral-bright',
        label: 'Coral bright',
        description: 'Lighter feminine voice with upbeat clarity and friendly lift.',
        voice: 'coral',
        instructions: 'Use a bright feminine tone with friendly lift, crisp phrasing, and subtle upward inflection at transitions.',
    },
    {
        id: 'openai-nova-soft',
        label: 'Nova soft',
        description: 'Soft feminine voice suited to calm, supportive replies.',
        voice: 'nova',
        instructions: 'Speak softly and clearly with a feminine tone. Favor gentle phrasing, relaxed pacing, and reassuring inflection.',
    },
    {
        id: 'openai-shimmer-expressive',
        label: 'Shimmer expressive',
        description: 'Expressive feminine voice with stronger emotional contour.',
        voice: 'shimmer',
        instructions: 'Deliver the response with expressive feminine inflection, clear emphasis, and polished conversational rhythm.',
    },
];

class OpenAiTtsService {
    constructor(ttsConfig = config.tts?.openai || {}) {
        this.ttsConfig = {
            ...ttsConfig,
        };
        this.client = null;
    }

    getClient() {
        if (!this.client) {
            this.client = new OpenAI({
                apiKey: this.ttsConfig.apiKey,
                baseURL: this.ttsConfig.baseURL,
            });
        }

        return this.client;
    }

    getVoiceProfiles() {
        return OPENAI_VOICE_PRESETS.map((voice) => ({
            ...voice,
            provider: 'openai',
        }));
    }

    resolveVoiceProfile(voiceId = '') {
        const voices = this.getVoiceProfiles();
        const requestedVoiceId = String(voiceId || '').trim();
        if (requestedVoiceId) {
            return voices.find((voice) => voice.id === requestedVoiceId) || null;
        }

        const defaultVoiceId = String(this.ttsConfig.defaultVoiceId || '').trim();
        return voices.find((voice) => voice.id === defaultVoiceId) || voices[0] || null;
    }

    getDiagnostics() {
        if (this.ttsConfig.enabled === false) {
            return {
                status: 'unavailable',
                binaryReachable: false,
                voicesLoaded: this.getVoiceProfiles().length > 0,
                message: 'OpenAI voice playback is disabled.',
            };
        }

        if (!String(this.ttsConfig.apiKey || '').trim()) {
            return {
                status: 'misconfigured',
                binaryReachable: false,
                voicesLoaded: this.getVoiceProfiles().length > 0,
                message: 'OpenAI voice playback is enabled, but no API key is configured.',
            };
        }

        if (!String(this.ttsConfig.model || '').trim()) {
            return {
                status: 'misconfigured',
                binaryReachable: false,
                voicesLoaded: this.getVoiceProfiles().length > 0,
                message: 'OpenAI voice playback is enabled, but no TTS model is configured.',
            };
        }

        return {
            status: 'ready',
            binaryReachable: true,
            voicesLoaded: this.getVoiceProfiles().length > 0,
            message: `${this.getVoiceProfiles().length} OpenAI voice presets ready.`,
        };
    }

    isConfigured() {
        return this.getDiagnostics().status === 'ready';
    }

    getPublicConfig() {
        const diagnostics = this.getDiagnostics();
        const configured = diagnostics.status === 'ready';
        const voices = this.getVoiceProfiles().map((voice) => ({
            id: voice.id,
            label: voice.label,
            description: voice.description,
            provider: 'openai',
        }));
        const defaultVoice = configured ? this.resolveVoiceProfile() : null;

        return {
            configured,
            provider: 'openai',
            maxTextChars: Math.max(200, Number(this.ttsConfig.maxTextChars) || 3600),
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
            diagnostics.message || 'OpenAI voice playback is not configured.',
            'tts_unavailable',
        );
    }

    async synthesize({ text = '', voiceId = '' } = {}) {
        this.assertConfigured();

        const voice = this.resolveVoiceProfile(voiceId);
        if (!voice) {
            throw createServiceError(400, `Unknown OpenAI voice "${voiceId}".`, 'unknown_voice');
        }

        const speakableText = normalizeTextForSpeech(
            text,
            Math.max(200, Number(this.ttsConfig.maxTextChars) || 3600),
        );

        try {
            const response = await this.getClient().audio.speech.create({
                model: this.ttsConfig.model,
                voice: voice.voice,
                input: speakableText,
                instructions: String(voice.instructions || this.ttsConfig.defaultInstructions || '').trim() || undefined,
                response_format: this.ttsConfig.responseFormat || 'wav',
            });

            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = Buffer.from(arrayBuffer);
            if (!audioBuffer.length) {
                throw createServiceError(502, 'OpenAI voice playback returned empty audio.', 'tts_empty_audio');
            }

            return {
                audioBuffer,
                contentType: this.ttsConfig.responseFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav',
                provider: 'openai',
                voice: {
                    id: voice.id,
                    label: voice.label,
                    description: voice.description,
                    provider: 'openai',
                },
                text: speakableText,
            };
        } catch (error) {
            if (error?.statusCode) {
                throw error;
            }

            throw createServiceError(502, error.message || 'OpenAI voice playback failed.', 'tts_failed');
        }
    }
}

const openAiTtsService = new OpenAiTtsService();

module.exports = {
    OPENAI_VOICE_PRESETS,
    OpenAiTtsService,
    openAiTtsService,
};
