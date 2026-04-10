const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { ttsService } = require('../tts/tts-service');

const router = Router();

const synthesizeSchema = {
    text: { required: true, type: 'string' },
    voiceId: { required: false, type: 'string' },
};

router.get('/voices', (_req, res) => {
    res.json(ttsService.getPublicConfig());
});

router.post('/synthesize', validate(synthesizeSchema), async (req, res, next) => {
    try {
        const result = await ttsService.synthesize({
            text: req.body.text,
            voiceId: req.body.voiceId || '',
        });

        res.setHeader('Content-Type', result.contentType || 'audio/wav');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-TTS-Provider', result.provider || 'unknown');
        res.setHeader('X-TTS-Voice-Id', result.voice?.id || '');
        res.setHeader('X-TTS-Voice-Label', result.voice?.label || '');
        res.send(result.audioBuffer);
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({
                error: {
                    type: error.code || 'tts_error',
                    message: error.message,
                },
            });
        }

        return next(error);
    }
});

module.exports = router;
