const { Router } = require('express');
const { sessionStore } = require('../session-store');
const { artifactService } = require('../artifacts/artifact-service');
const { parseMultipartRequest } = require('../utils/multipart');
const { validate } = require('../middleware/validate');

const router = Router();

const generationSchema = {
    sessionId: { required: true, type: 'string' },
    mode: { required: true, type: 'string' },
    prompt: { required: true, type: 'string' },
    format: { required: true, type: 'string' },
    artifactIds: { required: false, type: 'array' },
    existingContent: { required: false, type: 'string' },
    template: { required: false, type: 'string' },
    model: { required: false, type: 'string' },
    parentArtifactId: { required: false, type: 'string' },
};

router.post('/upload', async (req, res, next) => {
    try {
        const { fields, file } = await parseMultipartRequest(req);
        const sessionId = fields.sessionId;
        const mode = fields.mode || 'chat';
        const label = fields.label || '';
        const tags = fields.tags || [];

        if (!sessionId) {
            return res.status(400).json({ error: { message: 'sessionId is required' } });
        }

        await sessionStore.getOrCreate(sessionId, { mode });
        const artifact = await artifactService.uploadArtifact({
            sessionId,
            mode,
            label,
            tags,
            file,
        });

        res.status(201).json(artifact);
    } catch (err) {
        next(err);
    }
});

router.post('/generate', validate(generationSchema), async (req, res, next) => {
    try {
        const {
            sessionId,
            mode,
            prompt,
            format,
            artifactIds = [],
            existingContent = '',
            template = '',
            model = null,
            parentArtifactId = null,
        } = req.body;

        const session = await sessionStore.getOrCreate(sessionId, { mode });
        const result = await artifactService.generateArtifact({
            session,
            sessionId,
            mode,
            prompt,
            format,
            artifactIds,
            existingContent,
            template,
            model,
            parentArtifactId,
        });

        if (result.responseId) {
            await sessionStore.recordResponse(sessionId, result.responseId);
        }

        res.status(201).json({
            sessionId,
            responseId: result.responseId,
            artifact: result.artifact,
        });
    } catch (err) {
        next(err);
    }
});

router.get('/:id', async (req, res, next) => {
    try {
        const artifact = await artifactService.getArtifact(req.params.id);
        if (!artifact) {
            return res.status(404).json({ error: { message: 'Artifact not found' } });
        }
        res.json(artifact);
    } catch (err) {
        next(err);
    }
});

router.get('/:id/download', async (req, res, next) => {
    try {
        const artifact = await artifactService.getArtifact(req.params.id, { includeContent: true });
        if (!artifact) {
            return res.status(404).json({ error: { message: 'Artifact not found' } });
        }

        const inlineRequested = ['1', 'true', 'yes'].includes(String(req.query.inline || '').toLowerCase());
        res.setHeader('Content-Type', artifact.mimeType);
        res.setHeader(
            'Content-Disposition',
            `${inlineRequested ? 'inline' : 'attachment'}; filename="${artifact.filename}"`,
        );
        res.send(artifact.contentBuffer);
    } catch (err) {
        next(err);
    }
});

router.delete('/:id', async (req, res, next) => {
    try {
        const deleted = await artifactService.deleteArtifact(req.params.id);
        if (!deleted) {
            return res.status(404).json({ error: { message: 'Artifact not found' } });
        }
        res.status(204).end();
    } catch (err) {
        next(err);
    }
});

module.exports = router;
