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

function shouldRetryWithFallbackProvider(error) {
    const statusCode = Number(error?.statusCode || error?.status || 0) || 0;
    const errorCode = String(error?.code || error?.type || '').trim().toLowerCase();
    const message = String(error?.message || '').trim().toLowerCase();
    const providerIssuePattern = /(api key|authentication|auth|permission|access|forbidden|unauthorized|endpoint|route|path|method not allowed|not found|unsupported|not available|does not exist)/i;
    const fileIssuePattern = /(file format|audio format|upload(ed)? file|mime type|unsupported audio)/i;

    if (fileIssuePattern.test(message)) {
        return false;
    }

    if ([
        'invalid_api_key',
        'authentication_error',
        'permission_error',
        'access_denied',
        'not_found_error',
    ].includes(errorCode)) {
        return true;
    }

    if ([401, 403, 404, 405, 501].includes(statusCode)) {
        return true;
    }

    return providerIssuePattern.test(message);
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
        this.clientCache = new Map();
    }

    getProviderCandidates() {
        const configuredCandidates = Array.isArray(this.audioConfig.providerCandidates)
            ? this.audioConfig.providerCandidates
            : [];
        const candidates = configuredCandidates.length > 0
            ? configuredCandidates
            : [{
                id: 'primary',
                apiKey: this.audioConfig.apiKey,
                baseURL: this.audioConfig.baseURL,
            }];
        const seen = new Set();

        return candidates
            .map((candidate, index) => ({
                id: String(candidate?.id || `provider-${index + 1}`).trim() || `provider-${index + 1}`,
                apiKey: String(candidate?.apiKey || '').trim(),
                baseURL: String(candidate?.baseURL || this.audioConfig.baseURL || '').trim() || 'https://api.openai.com/v1',
            }))
            .filter((candidate) => {
                if (!candidate.apiKey) {
                    return false;
                }

                const cacheKey = `${candidate.apiKey}::${candidate.baseURL}`;
                if (seen.has(cacheKey)) {
                    return false;
                }
                seen.add(cacheKey);
                return true;
            });
    }

    getClient(providerConfig = {}) {
        const apiKey = String(providerConfig.apiKey || this.audioConfig.apiKey || '').trim();
        const baseURL = String(providerConfig.baseURL || this.audioConfig.baseURL || '').trim();
        const cacheKey = `${apiKey}::${baseURL}`;

        if (!this.clientCache.has(cacheKey)) {
            this.clientCache.set(cacheKey, new OpenAI({
                apiKey,
                baseURL,
            }));
        }

        return this.clientCache.get(cacheKey);
    }

    assertConfigured() {
        if (this.getProviderCandidates().length > 0) {
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
        const providerCandidates = this.getProviderCandidates();
        const effectiveMimeType = String(mimeType || 'audio/webm').trim() || 'audio/webm';
        const extension = effectiveMimeType.includes('/')
            ? effectiveMimeType.split('/')[1].split(';')[0].trim() || 'webm'
            : 'webm';
        let lastError = null;

        providerLoop:
        for (let providerIndex = 0; providerIndex < providerCandidates.length; providerIndex += 1) {
            const providerCandidate = providerCandidates[providerIndex];

            for (let modelIndex = 0; modelIndex < candidateModels.length; modelIndex += 1) {
                const candidateModel = candidateModels[modelIndex];
                const hasFallbackModel = modelIndex < (candidateModels.length - 1);
                const hasFallbackProvider = providerIndex < (providerCandidates.length - 1);

                try {
                    const upload = await toFile(
                        audioBuffer,
                        sanitizeUploadFilename(filename, extension),
                        { type: effectiveMimeType },
                    );

                    const response = await this.getClient(providerCandidate).audio.transcriptions.create({
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
                    lastError = wrappedError;

                    if (hasFallbackModel && shouldRetryWithFallbackModel(wrappedError)) {
                        continue;
                    }

                    if (hasFallbackProvider && (shouldRetryWithFallbackProvider(wrappedError) || shouldRetryWithFallbackModel(wrappedError))) {
                        continue providerLoop;
                    }

                    throw wrappedError;
                }
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
    shouldRetryWithFallbackProvider,
    shouldRetryWithFallbackModel,
};
