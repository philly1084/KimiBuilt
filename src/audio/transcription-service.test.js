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
const { TranscriptionService } = require('./transcription-service');

describe('TranscriptionService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('uploads audio using the dedicated transcription client config', async () => {
        const service = new TranscriptionService({
            apiKey: 'test-audio-key',
            baseURL: 'https://api.openai.com/v1',
            transcriptionModel: 'gpt-4o-mini-transcribe',
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
            model: 'gpt-4o-mini-transcribe',
            response_format: 'json',
            language: 'en',
            prompt: 'Transcribe clearly.',
        }));
        expect(result).toEqual({
            text: 'Hello from audio.',
            model: 'gpt-4o-mini-transcribe',
            language: 'en',
            duration: 1.25,
            provider: 'openai',
        });
    });

    test('returns a configuration error when no transcription api key is present', async () => {
        const service = new TranscriptionService({
            apiKey: '',
            baseURL: 'https://api.openai.com/v1',
            transcriptionModel: 'gpt-4o-mini-transcribe',
        });

        await expect(service.transcribe({
            audioBuffer: Buffer.from('audio-bytes'),
        })).rejects.toMatchObject({
            statusCode: 503,
            code: 'audio_unavailable',
        });
    });
});
