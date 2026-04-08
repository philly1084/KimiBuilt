const { Router } = require('express');
const path = require('path').posix;
const { sessionStore } = require('../session-store');
const { artifactService } = require('../artifacts/artifact-service');
const { parseMultipartRequest } = require('../utils/multipart');
const { validate } = require('../middleware/validate');
const { ensureRuntimeToolManager } = require('../runtime-tool-manager');
const {
    buildFrontendBundlePreviewUrl,
    createFrontendBundleArchive,
    getArtifactFrontendBundle,
    getFrontendBundleFile,
    hasFrontendBundleArchive,
    hasExplicitFrontendBundle,
    injectBundleBaseHref,
    resolveArtifactFrontendBundleFile,
    resolveFrontendBundleContentType,
    rewriteRootRelativeFrontendPaths,
} = require('../frontend-bundles');
const {
    buildScopedSessionMetadata,
    resolveClientSurface,
    resolveSessionScope,
} = require('../session-scope');

const router = Router();

function getRequestOwnerId(req) {
    return String(req.user?.username || '').trim() || null;
}

async function getOwnedArtifact(req, artifactId, options = {}) {
    const artifact = await artifactService.getArtifact(artifactId, options);
    if (!artifact) {
        return null;
    }

    const session = await sessionStore.getOwned(artifact.sessionId, getRequestOwnerId(req));
    if (!session) {
        return null;
    }

    return artifact;
}

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
    reasoningEffort: { required: false, type: 'string' },
    executionProfile: { required: false, type: 'string' },
    memoryKeywords: { required: false, type: 'array' },
};

function buildPreviewContentBuffer(artifactId, file) {
    const filePath = String(file?.path || '').trim();
    const source = String(file?.content || '');
    if (!source) {
        return Buffer.alloc(0);
    }

    const previewRoot = buildFrontendBundlePreviewUrl(artifactId);
    if (/\.html?$/i.test(filePath)) {
        const directory = path.dirname(filePath);
        const baseHref = buildFrontendBundlePreviewUrl(
            artifactId,
            directory && directory !== '.' ? `${directory.replace(/\/+$/g, '')}/` : '',
        );
        return Buffer.from(
            injectBundleBaseHref(
                rewriteRootRelativeFrontendPaths(source, previewRoot),
                baseHref,
            ),
            'utf8',
        );
    }

    if (/\.(?:css|svg|js|mjs)$/i.test(filePath)) {
        return Buffer.from(rewriteRootRelativeFrontendPaths(source, previewRoot), 'utf8');
    }

    return Buffer.from(source, 'utf8');
}

function resolveMetadataBundlePreviewFile(artifact, requestedPath = '') {
    if (!hasExplicitFrontendBundle(artifact?.metadata || {})) {
        return null;
    }

    const file = getFrontendBundleFile(getArtifactFrontendBundle(artifact), requestedPath);
    if (!file) {
        return null;
    }

    return {
        path: file.path,
        contentType: resolveFrontendBundleContentType(file.path),
        contentBuffer: buildPreviewContentBuffer(artifact.id, file),
    };
}

router.post('/upload', async (req, res, next) => {
    try {
        const { fields, file } = await parseMultipartRequest(req);
        let sessionId = fields.sessionId;
        const mode = fields.mode || 'chat';
        const label = fields.label || '';
        const tags = fields.tags || [];
        const ownerId = getRequestOwnerId(req);
        const requestedSessionMetadata = buildScopedSessionMetadata({
            mode,
            taskType: fields.taskType || mode,
            clientSurface: resolveClientSurface(fields, null, mode),
        });
        const session = ownerId
            ? await sessionStore.resolveOwnedSession(sessionId, requestedSessionMetadata, ownerId)
            : sessionId
                ? await sessionStore.getOrCreate(sessionId, requestedSessionMetadata)
                : await sessionStore.create(requestedSessionMetadata);
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }
        sessionId = session.id;
        const artifact = await artifactService.uploadArtifact({
            sessionId,
            session,
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
            sessionId: requestedSessionId,
            mode,
            prompt,
            format,
            artifactIds = [],
            existingContent = '',
            template = '',
            model = null,
            parentArtifactId = null,
            reasoningEffort = null,
            executionProfile = 'default',
            memoryKeywords = [],
        } = req.body;

        const ownerId = getRequestOwnerId(req);
        const requestTimezone = req.body?.timezone || req.get('x-user-timezone') || null;
        const requestNow = req.body?.now || req.get('x-user-now') || null;
        const requestedSessionMetadata = buildScopedSessionMetadata({
            mode,
            taskType: req.body?.taskType || mode,
            clientSurface: resolveClientSurface(req.body || {}, null, mode),
        });
        const session = ownerId
            ? await sessionStore.resolveOwnedSession(requestedSessionId, requestedSessionMetadata, ownerId)
            : requestedSessionId
                ? await sessionStore.getOrCreate(requestedSessionId, requestedSessionMetadata)
                : await sessionStore.create(requestedSessionMetadata);
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }
        const sessionId = session.id;
        const clientSurface = resolveClientSurface(req.body || {}, session, mode);
        const memoryScope = resolveSessionScope({
            ...requestedSessionMetadata,
            clientSurface,
        }, session);
        const toolManager = await ensureRuntimeToolManager(req.app);
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
            reasoningEffort,
            toolManager,
            toolContext: {
                sessionId,
                route: '/api/artifacts/generate',
                transport: 'http',
                memoryService: req.app.locals.memoryService,
                ownerId,
                clientSurface,
                memoryScope,
                memoryKeywords,
                timezone: requestTimezone,
                now: requestNow,
                workloadService: req.app.locals.agentWorkloadService,
            },
            executionProfile,
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
        const artifact = await getOwnedArtifact(req, req.params.id);
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
        const artifact = await getOwnedArtifact(req, req.params.id, { includeContent: true });
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

router.get('/:id/preview', async (req, res, next) => {
    try {
        const artifact = await getOwnedArtifact(req, req.params.id, { includeContent: true });
        if (!artifact) {
            return res.status(404).json({ error: { message: 'Artifact not found' } });
        }

        const zipPreview = resolveArtifactFrontendBundleFile(artifact, '');
        if (zipPreview) {
            res.setHeader('Content-Type', zipPreview.contentType);
            res.setHeader('Cache-Control', 'no-store');
            res.send(zipPreview.contentBuffer);
            return;
        }

        const previewFile = resolveMetadataBundlePreviewFile(artifact);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send(previewFile?.contentBuffer || artifact.contentBuffer);
    } catch (err) {
        next(err);
    }
});

router.get('/:id/preview/*', async (req, res, next) => {
    try {
        const artifact = await getOwnedArtifact(req, req.params.id, { includeContent: true });
        if (!artifact) {
            return res.status(404).json({ error: { message: 'Artifact not found' } });
        }

        const zipPreview = resolveArtifactFrontendBundleFile(artifact, String(req.params[0] || '').trim());
        if (zipPreview) {
            res.setHeader('Content-Type', zipPreview.contentType);
            res.setHeader('Cache-Control', 'no-store');
            res.send(zipPreview.contentBuffer);
            return;
        }

        const requestedPath = String(req.params[0] || '').trim();
        const previewFile = resolveMetadataBundlePreviewFile(artifact, requestedPath);
        if (!previewFile) {
            return res.status(404).json({ error: { message: 'Preview file not found' } });
        }

        res.setHeader('Content-Type', previewFile.contentType);
        res.setHeader('Cache-Control', 'no-store');
        res.send(previewFile.contentBuffer);
    } catch (err) {
        next(err);
    }
});

router.get('/:id/bundle', async (req, res, next) => {
    try {
        const artifact = await getOwnedArtifact(req, req.params.id, { includeContent: true });
        if (!artifact) {
            return res.status(404).json({ error: { message: 'Artifact not found' } });
        }

        const isZipBundleArtifact = String(artifact.extension || '').toLowerCase() === 'zip'
            && artifact?.metadata?.siteBundle;
        if (isZipBundleArtifact) {
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${artifact.filename || 'frontend-bundle.zip'}"`);
            res.send(artifact.contentBuffer);
            return;
        }

        const bundle = getArtifactFrontendBundle(artifact);
        if (!hasFrontendBundleArchive(bundle)) {
            return res.status(404).json({ error: { message: 'Artifact bundle not found' } });
        }

        const zipBuffer = createFrontendBundleArchive(bundle);
        const baseName = String(artifact.filename || 'site').replace(/\.[a-z0-9]+$/i, '') || 'site';

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${baseName}.zip"`);
        res.send(zipBuffer);
    } catch (err) {
        next(err);
    }
});

router.get('/:id/site', async (req, res, next) => {
    try {
        const artifact = await getOwnedArtifact(req, req.params.id);
        if (!artifact) {
            return res.status(404).json({ error: { message: 'Artifact not found' } });
        }

        res.redirect(302, buildFrontendBundlePreviewUrl(req.params.id));
    } catch (err) {
        next(err);
    }
});

router.get('/:id/site/*', async (req, res, next) => {
    try {
        const artifact = await getOwnedArtifact(req, req.params.id, { includeContent: true });
        if (!artifact) {
            return res.status(404).json({ error: { message: 'Artifact not found' } });
        }

        const requestedPath = String(req.params[0] || '').trim();
        let resolved = resolveArtifactFrontendBundleFile(artifact, requestedPath);
        if (!resolved) {
            resolved = resolveMetadataBundlePreviewFile(artifact, requestedPath);
        }

        if (!resolved) {
            return res.status(404).json({ error: { message: 'Artifact site asset not found' } });
        }

        res.setHeader('Content-Type', resolved.contentType);
        res.setHeader('Cache-Control', 'no-store');
        res.send(resolved.contentBuffer);
    } catch (err) {
        next(err);
    }
});

router.delete('/:id', async (req, res, next) => {
    try {
        const artifact = await getOwnedArtifact(req, req.params.id);
        if (!artifact) {
            return res.status(404).json({ error: { message: 'Artifact not found' } });
        }

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
