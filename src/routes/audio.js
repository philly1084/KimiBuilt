const { Router } = require('express');
const { config } = require('../config');
const { transcribeAudio } = require('../openai-client');
const { parseMultipartRequest } = require('../utils/multipart');

const router = Router();

function createRouteError(statusCode, message, code = 'audio_error') {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

router.post('/transcribe', async (req, res, next) => {
    try {
        const { fields, file } = await parseMultipartRequest(req, {
            maxBytes: config.audio.maxUploadBytes,
        });

        if (!file?.buffer?.length) {
            throw createRouteError(400, 'An audio file upload is required.', 'audio_upload_required');
        }

        const mimeType = String(file.mimeType || '').trim().toLowerCase();
        if (mimeType && !mimeType.startsWith('audio/')) {
            throw createRouteError(400, `Unsupported audio upload type: ${file.mimeType}`, 'unsupported_audio_type');
        }

        const transcript = await transcribeAudio({
            audioBuffer: file.buffer,
            filename: file.filename || 'recording.webm',
            mimeType: file.mimeType || 'audio/webm',
            language: fields.language || '',
            prompt: fields.prompt || '',
        });

        res.setHeader('Cache-Control', 'no-store');
        res.json({
            text: transcript.text,
            model: transcript.model,
            language: transcript.language,
            duration: transcript.duration,
            provider: transcript.provider,
        });
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({
                error: {
                    type: error.code || 'audio_error',
                    message: error.message,
                },
            });
        }

        return next(error);
    }
});

module.exports = router;
