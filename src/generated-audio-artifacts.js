const { artifactService } = require('./artifacts/artifact-service');
const { sessionStore } = require('./session-store');
const {
    buildArtifactDownloadPath,
    buildArtifactInlinePath,
    toAbsoluteInternalUrl,
} = require('./generated-image-artifacts');

function extensionForAudioMimeType(mimeType = '') {
    const normalized = String(mimeType || '').trim().toLowerCase();
    if (normalized === 'audio/mpeg' || normalized === 'audio/mp3') return 'mp3';
    if (normalized === 'audio/ogg') return 'ogg';
    return 'wav';
}

function slugifyAudioBase(value = '') {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
}

function buildGeneratedAudioFilename({
    filename = '',
    title = '',
    text = '',
    extension = 'wav',
} = {}) {
    const explicitFilename = String(filename || '').trim();
    if (explicitFilename) {
        return explicitFilename;
    }

    const base = slugifyAudioBase(title)
        || slugifyAudioBase(text.split(/\s+/).slice(0, 8).join(' '))
        || 'generated-audio';

    return `${base}.${extension}`;
}

function normalizeGeneratedAudioRecord(artifact = null) {
    if (!artifact?.id) {
        return null;
    }

    const downloadUrl = buildArtifactDownloadPath(artifact.id);
    const inlinePath = buildArtifactInlinePath(artifact.id);

    return {
        artifactId: artifact.id,
        filename: artifact.filename,
        mimeType: artifact.mimeType,
        format: artifact.format || artifact.extension,
        downloadUrl,
        inlinePath,
        absoluteUrl: toAbsoluteInternalUrl(downloadUrl),
        absoluteInlineUrl: toAbsoluteInternalUrl(inlinePath),
    };
}

async function updateGeneratedAudioSessionState(sessionId = '', artifacts = []) {
    const artifactIds = (Array.isArray(artifacts) ? artifacts : [])
        .map((artifact) => String(artifact?.id || '').trim())
        .filter(Boolean);

    if (!sessionId || artifactIds.length === 0) {
        return null;
    }

    try {
        return await sessionStore.update(sessionId, {
            metadata: {
                lastGeneratedAudioArtifactIds: artifactIds,
            },
        });
    } catch (error) {
        console.warn('[Audio] Failed to update generated audio session state:', error.message);
        return null;
    }
}

async function persistGeneratedAudio({
    sessionId = '',
    sourceMode = 'chat',
    text = '',
    title = '',
    filename = '',
    provider = 'piper',
    voice = null,
    audioBuffer = null,
    mimeType = 'audio/wav',
    metadata = {},
} = {}) {
    if (!sessionId) {
        throw new Error('A sessionId is required to save generated audio.');
    }

    if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
        throw new Error('Audio buffer is required to save generated audio.');
    }

    const extension = extensionForAudioMimeType(mimeType);
    const stored = await artifactService.createStoredArtifact({
        sessionId,
        direction: 'generated',
        sourceMode,
        filename: buildGeneratedAudioFilename({
            filename,
            title,
            text,
            extension,
        }),
        extension,
        mimeType,
        buffer: audioBuffer,
        extractedText: String(text || '').trim(),
        previewHtml: '',
        metadata: {
            generatedBy: 'speech-generate',
            provider,
            title: title || '',
            transcript: String(text || '').trim(),
            voice: voice || null,
            ...metadata,
        },
        vectorize: Boolean(String(text || '').trim()),
    });

    const artifact = artifactService.serializeArtifact(stored);
    const normalizedAudio = normalizeGeneratedAudioRecord(artifact);
    await updateGeneratedAudioSessionState(sessionId, [artifact]);

    return {
        artifact,
        audio: normalizedAudio,
        artifactIds: artifact?.id ? [artifact.id] : [],
    };
}

module.exports = {
    buildGeneratedAudioFilename,
    extensionForAudioMimeType,
    normalizeGeneratedAudioRecord,
    persistGeneratedAudio,
    updateGeneratedAudioSessionState,
};
