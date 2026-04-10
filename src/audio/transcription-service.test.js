jest.mock('openai', () => {
    const create = jest.fn(async () => ({
        text: 'Hello from audio.',
        language: 'en',
        duration: 1.25,
    }));
    const mockClientFactory = jest.fn().mockImplementation(() => ({
        audio: {
            transcriptions: {
                create,
            },
        },
    }));
    mockClientFactory.toFile = jest.fn(async (buffer, filename, options = {}) => ({
        buffer,
        filename,
        options,
    }));
    return mockClientFactory;
});

const OpenAI = require('openai');
const {
    DEFAULT_TRANSCRIPTION_MODEL,
    TranscriptionService,
    buildCandidateModels,
    shouldRetryWithFallbackModel,
} = require('./transcription-service');

describe('TranscriptionService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('uploads audio using the dedicated transcription client config', async () => {
        const service = new TranscriptionService({
            apiKey: 'test-audio-key',
            baseURL: 'https://api.openai.com/v1',
            transcriptionModel: DEFAULT_TRANSCRIPTION_MODEL,
        });

        const result = await service.transcribe({
            audioBuffer: Buffer.from('audio-bytes'),
            filename: 'voice note.webm',
            mimeType: 'audio/webm',
            language: 'en',
            prompt: 'Transcribe clearly.',
        });

        expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({
            apiKey: 'test-audio-key',
            baseURL: 'https://api.openai.com/v1',
        }));
        expect(OpenAI.toFile).toHaveBeenCalledWith(
            expect.any(Buffer),
            'voice-note.webm',
            { type: 'audio/webm' },
        );

        const client = OpenAI.mock.results[0].value;
        expect(client.audio.transcriptions.create).toHaveBeenCalledWith(expect.objectContaining({
            model: DEFAULT_TRANSCRIPTION_MODEL,
            response_format: 'json',
            language: 'en',
            prompt: 'Transcribe clearly.',
        }));
        expect(result).toEqual({
            text: 'Hello from audio.',
            model: DEFAULT_TRANSCRIPTION_MODEL,
            language: 'en',
            duration: 1.25,
            provider: 'openai',
        });
    });

    test('returns a configuration error when no transcription api key is present', async () => {
        const service = new TranscriptionService({
            apiKey: '',
            baseURL: 'https://api.openai.com/v1',
            transcriptionModel: DEFAULT_TRANSCRIPTION_MODEL,
        });

        await expect(service.transcribe({
            audioBuffer: Buffer.from('audio-bytes'),
        })).rejects.toMatchObject({
            statusCode: 503,
            code: 'audio_unavailable',
        });
    });

    test('falls back to the next configured transcription model when the preferred one is unavailable', async () => {
        const service = new TranscriptionService({
            apiKey: 'test-audio-key',
            baseURL: 'https://api.openai.com/v1',
            transcriptionModel: DEFAULT_TRANSCRIPTION_MODEL,
            fallbackModels: ['whisper-1'],
        });

        const client = service.getClient();
        client.audio.transcriptions.create
            .mockRejectedValueOnce(Object.assign(
                new Error('The model `gpt-4o-mini-transcribe` does not exist.'),
                { status: 404, code: 'model_not_found' },
            ))
            .mockResolvedValueOnce({
                text: 'Fallback transcript.',
                language: 'en',
                duration: 1.9,
            });

        const result = await service.transcribe({
            audioBuffer: Buffer.from('audio-bytes'),
            filename: 'voice-note.webm',
            mimeType: 'audio/webm',
        });

        expect(client.audio.transcriptions.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
            model: DEFAULT_TRANSCRIPTION_MODEL,
        }));
        expect(client.audio.transcriptions.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
            model: 'whisper-1',
        }));
        expect(result).toEqual({
            text: 'Fallback transcript.',
            model: 'whisper-1',
            language: 'en',
            duration: 1.9,
            provider: 'openai',
        });
    });
});

describe('transcription helper utilities', () => {
    test('buildCandidateModels keeps unique models in stable priority order', () => {
        expect(buildCandidateModels('whisper-1', DEFAULT_TRANSCRIPTION_MODEL, ['gpt-4o-transcribe']))
            .toEqual(['whisper-1', DEFAULT_TRANSCRIPTION_MODEL, 'gpt-4o-transcribe']);
    });

    test('shouldRetryWithFallbackModel only retries model availability failures', () => {
        expect(shouldRetryWithFallbackModel({
            statusCode: 404,
            code: 'model_not_found',
            message: 'The model `gpt-4o-mini-transcribe` does not exist.',
        })).toBe(true);

        expect(shouldRetryWithFallbackModel({
            statusCode: 400,
            code: 'invalid_request_error',
            message: 'The uploaded file format is not supported.',
        })).toBe(false);
    });
});
