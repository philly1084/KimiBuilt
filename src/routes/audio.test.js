const express = require('express');
const request = require('supertest');

jest.mock('../utils/multipart', () => ({
    parseMultipartRequest: jest.fn(),
}));

jest.mock('../openai-client', () => ({
    transcribeAudio: jest.fn(),
}));

const { parseMultipartRequest } = require('../utils/multipart');
const { transcribeAudio } = require('../openai-client');
const audioRouter = require('./audio');

describe('/api/audio', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('transcribes uploaded audio', async () => {
        parseMultipartRequest.mockResolvedValue({
            fields: {
                language: 'en',
                prompt: 'Summarize clearly.',
            },
            file: {
                filename: 'recording.webm',
                mimeType: 'audio/webm',
                buffer: Buffer.from('audio-bytes'),
            },
        });
        transcribeAudio.mockResolvedValue({
            text: 'Hello from audio.',
            model: 'gpt-4o-mini-transcribe',
            language: 'en',
            duration: 1.2,
            provider: 'openai',
        });

        const app = express();
        app.use('/api/audio', audioRouter);

        const response = await request(app)
            .post('/api/audio/transcribe')
            .set('content-type', 'multipart/form-data; boundary=test-boundary')
            .send('ignored');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            text: 'Hello from audio.',
            model: 'gpt-4o-mini-transcribe',
            language: 'en',
            duration: 1.2,
            provider: 'openai',
        });
        expect(transcribeAudio).toHaveBeenCalledWith(expect.objectContaining({
            filename: 'recording.webm',
            mimeType: 'audio/webm',
            language: 'en',
            prompt: 'Summarize clearly.',
        }));
    });

    test('rejects missing uploads', async () => {
        parseMultipartRequest.mockResolvedValue({
            fields: {},
            file: null,
        });

        const app = express();
        app.use('/api/audio', audioRouter);

        const response = await request(app)
            .post('/api/audio/transcribe')
            .set('content-type', 'multipart/form-data; boundary=test-boundary')
            .send('ignored');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
            error: {
                type: 'audio_upload_required',
                message: 'An audio file upload is required.',
            },
        });
    });

    test('rejects non-audio uploads', async () => {
        parseMultipartRequest.mockResolvedValue({
            fields: {},
            file: {
                filename: 'note.txt',
                mimeType: 'text/plain',
                buffer: Buffer.from('not-audio'),
            },
        });

        const app = express();
        app.use('/api/audio', audioRouter);

        const response = await request(app)
            .post('/api/audio/transcribe')
            .set('content-type', 'multipart/form-data; boundary=test-boundary')
            .send('ignored');

        expect(response.status).toBe(400);
        expect(response.body.error.type).toBe('unsupported_audio_type');
    });

    test('accepts audio-only recorder uploads that arrive with a video container mime type', async () => {
        parseMultipartRequest.mockResolvedValue({
            fields: {},
            file: {
                filename: 'recording.webm',
                mimeType: 'video/webm',
                buffer: Buffer.from('audio-bytes'),
            },
        });
        transcribeAudio.mockResolvedValue({
            text: 'Recovered transcript.',
            model: 'gpt-4o-mini-transcribe',
            language: 'en',
            duration: 1.2,
            provider: 'openai',
        });

        const app = express();
        app.use('/api/audio', audioRouter);

        const response = await request(app)
            .post('/api/audio/transcribe')
            .set('content-type', 'multipart/form-data; boundary=test-boundary')
            .send('ignored');

        expect(response.status).toBe(200);
        expect(transcribeAudio).toHaveBeenCalledWith(expect.objectContaining({
            filename: 'recording.webm',
            mimeType: 'audio/webm',
        }));
    });
});
