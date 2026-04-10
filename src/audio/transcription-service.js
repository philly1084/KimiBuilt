const OpenAI = require('openai');
const { toFile } = OpenAI;
const { config } = require('../config');

function sanitizeUploadFilename(filename = '', fallbackExtension = 'webm') {
    const normalized = String(filename || '').trim();
    const cleaned = normalized.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
    if (cleaned) {
        return cleaned;
    }

    return `recording.${fallbackExtension}`;
}

class TranscriptionService {
    constructor(audioConfig = config.audio || {}) {
        this.audioConfig = {
            ...audioConfig,
        };
        this.client = null;
    }

    getClient() {
        if (!this.client) {
            this.client = new OpenAI({
                apiKey: this.audioConfig.apiKey,
                baseURL: this.audioConfig.baseURL,
            });
        }

        return this.client;
    }

    assertConfigured() {
        if (String(this.audioConfig.apiKey || '').trim()) {
            return;
        }

        const error = new Error('Audio transcription is not configured.');
        error.statusCode = 503;
        error.code = 'audio_unavailable';
        throw error;
    }

    async transcribe({
        audioBuffer,
        filename = 'recording.webm',
        mimeType = 'audio/webm',
        language = '',
        prompt = '',
        model = null,
    } = {}) {
        if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
            const error = new Error('An audio buffer is required for transcription.');
            error.statusCode = 400;
            error.code = 'audio_buffer_required';
            throw error;
        }

        this.assertConfigured();

        const effectiveModel = String(model || this.audioConfig.transcriptionModel || '').trim()
            || 'gpt-4o-mini-transcribe';
        const effectiveMimeType = String(mimeType || 'audio/webm').trim() || 'audio/webm';
        const extension = effectiveMimeType.includes('/')
            ? effectiveMimeType.split('/')[1].split(';')[0].trim() || 'webm'
            : 'webm';

        try {
            const upload = await toFile(
                audioBuffer,
                sanitizeUploadFilename(filename, extension),
                { type: effectiveMimeType },
            );

            const response = await this.getClient().audio.transcriptions.create({
                file: upload,
                model: effectiveModel,
                response_format: 'json',
                ...(String(language || '').trim() ? { language: String(language).trim() } : {}),
                ...(String(prompt || '').trim() ? { prompt: String(prompt).trim() } : {}),
            });

            return {
                text: String(response?.text || '').trim(),
                model: effectiveModel,
                language: String(response?.language || language || '').trim(),
                duration: Number.isFinite(response?.duration) ? response.duration : null,
                provider: 'openai',
            };
        } catch (error) {
            if (error?.statusCode) {
                throw error;
            }

            const wrappedError = new Error(error?.message || 'Audio transcription failed.');
            wrappedError.statusCode = Number(error?.status || 0) || 502;
            wrappedError.code = error?.code || 'audio_transcription_failed';
            throw wrappedError;
        }
    }
}

const transcriptionService = new TranscriptionService();

module.exports = {
    TranscriptionService,
    transcriptionService,
    sanitizeUploadFilename,
};
