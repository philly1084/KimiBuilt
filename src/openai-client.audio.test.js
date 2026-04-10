jest.mock('openai', () => {
    const transcriptionsCreate = jest.fn(async () => ({
        text: 'Transcribed words',
        language: 'en',
        duration: 2.4,
    }));

    const MockOpenAI = jest.fn().mockImplementation(() => ({
        audio: {
            transcriptions: {
                create: transcriptionsCreate,
            },
        },
        responses: {
            create: jest.fn(),
        },
        chat: {
            completions: {
                create: jest.fn(),
            },
        },
    }));

    MockOpenAI.toFile = jest.fn(async (buffer, name, options = {}) => ({
        buffer,
        name,
        type: options.type || '',
    }));

    return MockOpenAI;
});

describe('openai-client audio transcription', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.doMock('./routes/admin/settings.controller', () => ({
            getSettings: jest.fn(() => ({})),
        }));
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';
    });

    test('uploads audio to the transcription endpoint with the configured model', async () => {
        const OpenAI = require('openai');
        const { transcribeAudio } = require('./openai-client');

        const result = await transcribeAudio({
            audioBuffer: Buffer.from('audio-data'),
            filename: 'voice-note.webm',
            mimeType: 'audio/webm',
            language: 'en',
            prompt: 'Summarize clearly.',
        });

        const client = OpenAI.mock.results[0].value;

        expect(OpenAI.toFile).toHaveBeenCalledWith(
            expect.any(Buffer),
            'voice-note.webm',
            { type: 'audio/webm' },
        );
        expect(client.audio.transcriptions.create).toHaveBeenCalledWith(expect.objectContaining({
            file: expect.objectContaining({
                name: 'voice-note.webm',
                type: 'audio/webm',
            }),
            model: 'gpt-4o-mini-transcribe',
            response_format: 'json',
            language: 'en',
            prompt: 'Summarize clearly.',
        }));
        expect(result).toEqual({
            text: 'Transcribed words',
            model: 'gpt-4o-mini-transcribe',
            language: 'en',
            duration: 2.4,
            provider: 'openai',
        });
    });
});
