const OpenAI = require('openai');
const { toFile } = OpenAI;
const { config } = require('../config');

const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';
const DEFAULT_FALLBACK_TRANSCRIPTION_MODELS = Object.freeze([
    DEFAULT_TRANSCRIPTION_MODEL,
    'gpt-4o-transcribe',
    'whisper-1',
]);

function sanitizeUploadFilename(filename = '', fallbackExtension = 'webm') {
    const normalized = String(filename || '').trim();
    const cleaned = normalized.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
    if (cleaned) {
        return cleaned;
    }

    return `recording.${fallbackExtension}`;
}

function normalizeRequestedModel(model = '') {
    const normalized = String(model || '').trim();
    if (!normalized || normalized.toLowerCase() === 'auto') {
        return '';
    }

    return normalized;
}

function buildCandidateModels(requestedModel = '', configuredModel = '', configuredFallbackModels = []) {
    const candidateModels = [
        normalizeRequestedModel(requestedModel),
        normalizeRequestedModel(configuredModel),
        ...(Array.isArray(configuredFallbackModels) ? configuredFallbackModels : [])
            .map((entry) => normalizeRequestedModel(entry))
            .filter(Boolean),
        ...DEFAULT_FALLBACK_TRANSCRIPTION_MODELS,
    ].filter(Boolean);

    return [...new Set(candidateModels)];
}

function shouldRetryWithFallbackModel(error) {
    const statusCode = Number(error?.statusCode || error?.status || 0) || 0;
    const errorCode = String(error?.code || error?.type || '').trim().toLowerCase();
    const message = String(error?.message || '').trim().toLowerCase();
    const modelIssuePattern = /(model|transcrib|whisper|gpt-4o).*(not found|not available|unsupported|invalid|unknown|access|tier|enabled|exist)|audio transcriptions?.*(unsupported|unavailable)/i;

    if ([
        'model_not_found',
        'unsupported_model',
        'invalid_model',
        'unknown_model',
        'not_found_error',
    ].includes(errorCode)) {
        return true;
    }

    if ([400, 403, 404, 405, 422, 501].includes(statusCode) && modelIssuePattern.test(message)) {
        return true;
    }

    return modelIssuePattern.test(message);
}

function wrapTranscriptionError(error) {
    if (error?.statusCode) {
        return error;
    }

    const wrappedError = new Error(error?.message || 'Audio transcription failed.');
    wrappedError.statusCode = Number(error?.status || 0) || 502;
    wrappedError.code = error?.code || 'audio_transcription_failed';
    return wrappedError;
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

        const candidateModels = buildCandidateModels(
            model,
            this.audioConfig.transcriptionModel,
            this.audioConfig.fallbackModels,
        );
        const effectiveMimeType = String(mimeType || 'audio/webm').trim() || 'audio/webm';
        const extension = effectiveMimeType.includes('/')
            ? effectiveMimeType.split('/')[1].split(';')[0].trim() || 'webm'
            : 'webm';
        let lastError = null;

        for (let index = 0; index < candidateModels.length; index += 1) {
            const candidateModel = candidateModels[index];

            try {
                const upload = await toFile(
                    audioBuffer,
                    sanitizeUploadFilename(filename, extension),
                    { type: effectiveMimeType },
                );

                const response = await this.getClient().audio.transcriptions.create({
                    file: upload,
                    model: candidateModel,
                    response_format: 'json',
                    ...(String(language || '').trim() ? { language: String(language).trim() } : {}),
                    ...(String(prompt || '').trim() ? { prompt: String(prompt).trim() } : {}),
                });

                return {
                    text: String(response?.text || '').trim(),
                    model: candidateModel,
                    language: String(response?.language || language || '').trim(),
                    duration: Number.isFinite(response?.duration) ? response.duration : null,
                    provider: 'openai',
                };
            } catch (error) {
                const wrappedError = wrapTranscriptionError(error);
                const hasFallbackCandidate = index < (candidateModels.length - 1);

                if (hasFallbackCandidate && shouldRetryWithFallbackModel(wrappedError)) {
                    lastError = wrappedError;
                    continue;
                }

                throw wrappedError;
            }
        }

        throw lastError || wrapTranscriptionError(new Error('Audio transcription failed.'));
    }
}

const transcriptionService = new TranscriptionService();

module.exports = {
    DEFAULT_FALLBACK_TRANSCRIPTION_MODELS,
    DEFAULT_TRANSCRIPTION_MODEL,
    TranscriptionService,
    buildCandidateModels,
    transcriptionService,
    sanitizeUploadFilename,
    shouldRetryWithFallbackModel,
};
