const fs = require('fs/promises');
const { artifactService } = require('./artifacts/artifact-service');
const { config } = require('./config');
const { sessionStore } = require('./session-store');

function buildArtifactDownloadPath(artifactId = '') {
    return `/api/artifacts/${artifactId}/download`;
}

function buildArtifactInlinePath(artifactId = '') {
    return `${buildArtifactDownloadPath(artifactId)}?inline=1`;
}

function getInternalApiBaseUrl() {
    const configured = String(process.env.API_BASE_URL || '').trim();
    if (configured) {
        try {
            return new URL(configured).toString().replace(/\/+$/, '');
        } catch (_error) {
            // Fall through to the local runtime url when API_BASE_URL is invalid.
        }
    }

    return `http://127.0.0.1:${config.port || 3000}`;
}

function toAbsoluteInternalUrl(value = '') {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return null;
    }

    if (/^https?:\/\//i.test(normalized)) {
        return normalized;
    }

    try {
        return new URL(normalized, `${getInternalApiBaseUrl()}/`).toString();
    } catch (_error) {
        return null;
    }
}

function extensionForMimeType(mimeType = '') {
    const normalized = String(mimeType || '').trim().toLowerCase();
    if (normalized === 'image/jpeg') return 'jpg';
    if (normalized === 'image/svg+xml') return 'svg';
    if (normalized === 'image/webp') return 'webp';
    if (normalized === 'image/gif') return 'gif';
    return 'png';
}

function decodeDataUrl(url = '') {
    const normalized = String(url || '').trim();
    const match = normalized.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i);
    if (!match?.[1] || !match?.[2]) {
        return null;
    }

    return {
        mimeType: match[1].toLowerCase(),
        extension: extensionForMimeType(match[1]),
        buffer: Buffer.from(match[2], 'base64'),
    };
}

function decodeGeneratedImage(image = {}) {
    if (typeof image?.b64_json === 'string' && image.b64_json.trim()) {
        return {
            mimeType: 'image/png',
            extension: 'png',
            buffer: Buffer.from(image.b64_json.trim(), 'base64'),
        };
    }

    return decodeDataUrl(image?.url || '');
}

function resolveGeneratedImageLocalPath(url = '') {
    const normalized = String(url || '').trim();
    if (!normalized) {
        return null;
    }

    let candidate = normalized;
    if (/^sandbox:/i.test(candidate)) {
        candidate = candidate.replace(/^sandbox:/i, '');
    } else if (!/^(?:file:|\/|[a-z]:[\\/])/i.test(candidate)) {
        return null;
    }

    if (/^file:/i.test(candidate)) {
        try {
            const parsed = new URL(candidate);
            candidate = parsed.pathname || '';
        } catch (_error) {
            return null;
        }
    }

    candidate = decodeURIComponent(String(candidate || '').trim());
    if (!candidate) {
        return null;
    }

    if (/^\/[a-z]:[\\/]/i.test(candidate)) {
        candidate = candidate.slice(1);
    }

    return candidate;
}

async function readGeneratedImageFromLocalPath(image = {}) {
    const filePath = resolveGeneratedImageLocalPath(image?.url || '');
    if (!filePath) {
        return null;
    }

    try {
        const buffer = await fs.readFile(filePath);
        const mimeType = inferMimeTypeFromUrl(filePath);
        return {
            mimeType,
            extension: extensionForMimeType(mimeType),
            buffer,
        };
    } catch (error) {
        console.warn('[Images] Failed to read generated sandbox image for persistence:', error.message);
        return null;
    }
}

function inferMimeTypeFromUrl(url = '') {
    const normalized = String(url || '').trim().toLowerCase();
    if (!normalized) {
        return 'image/png';
    }

    if (/\.jpe?g(?:[?#].*)?$/.test(normalized)) return 'image/jpeg';
    if (/\.svg(?:[?#].*)?$/.test(normalized)) return 'image/svg+xml';
    if (/\.webp(?:[?#].*)?$/.test(normalized)) return 'image/webp';
    if (/\.gif(?:[?#].*)?$/.test(normalized)) return 'image/gif';
    return 'image/png';
}

async function downloadGeneratedImage(image = {}) {
    const imageUrl = String(image?.url || '').trim();
    if (!/^https?:\/\//i.test(imageUrl) || typeof fetch !== 'function') {
        return null;
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 15000) : null;

    try {
        const response = await fetch(imageUrl, {
            method: 'GET',
            signal: controller?.signal,
            headers: {
                Accept: 'image/*',
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const contentType = String(response.headers?.get?.('content-type') || '').trim().toLowerCase();
        const mimeType = contentType.startsWith('image/')
            ? contentType.split(';')[0].trim()
            : inferMimeTypeFromUrl(imageUrl);
        const extension = extensionForMimeType(mimeType);
        const arrayBuffer = await response.arrayBuffer();

        return {
            mimeType,
            extension,
            buffer: Buffer.from(arrayBuffer),
        };
    } catch (error) {
        console.warn('[Images] Failed to download generated image URL for persistence:', error.message);
        return null;
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

function buildGeneratedImageFilename(prompt = '', index = 0, extension = 'png') {
    const base = String(prompt || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'generated-image';

    return `${base}-${String(index + 1).padStart(2, '0')}.${extension}`;
}

function normalizeGeneratedImageRecord(image = {}, storedArtifact = null) {
    const revisedPrompt = image?.revised_prompt || image?.revisedPrompt || null;
    if (!storedArtifact?.id) {
        return {
            url: image?.url || null,
            b64_json: image?.b64_json || null,
            revised_prompt: revisedPrompt,
            artifactId: null,
            downloadUrl: null,
            inlinePath: null,
            absoluteUrl: null,
        };
    }

    const downloadUrl = buildArtifactDownloadPath(storedArtifact.id);
    const inlinePath = buildArtifactInlinePath(storedArtifact.id);
    return {
        url: inlinePath,
        b64_json: null,
        revised_prompt: revisedPrompt,
        artifactId: storedArtifact.id,
        downloadUrl,
        inlinePath,
        absoluteUrl: toAbsoluteInternalUrl(inlinePath),
    };
}

async function updateGeneratedImageSessionState(sessionId = '', artifacts = []) {
    const artifactIds = (Array.isArray(artifacts) ? artifacts : [])
        .map((artifact) => String(artifact?.id || '').trim())
        .filter(Boolean);

    if (!sessionId || artifactIds.length === 0) {
        return null;
    }

    try {
        return await sessionStore.update(sessionId, {
            metadata: {
                lastGeneratedImageArtifactIds: artifactIds,
            },
        });
    } catch (error) {
        console.warn('[Images] Failed to update generated image session state:', error.message);
        return null;
    }
}

async function persistGeneratedImages({
    sessionId = '',
    sourceMode = 'chat',
    prompt = '',
    model = null,
    images = [],
}) {
    const normalizedImages = [];
    const artifacts = [];

    for (let index = 0; index < (Array.isArray(images) ? images : []).length; index += 1) {
        const image = images[index] || {};
        let storedArtifact = null;
        const decoded = decodeGeneratedImage(image)
            || await readGeneratedImageFromLocalPath(image)
            || await downloadGeneratedImage(image);

        if (sessionId && decoded?.buffer?.length) {
            try {
                const stored = await artifactService.createStoredArtifact({
                    sessionId,
                    direction: 'generated',
                    sourceMode,
                    filename: buildGeneratedImageFilename(prompt, index, decoded.extension),
                    extension: decoded.extension,
                    mimeType: decoded.mimeType,
                    buffer: decoded.buffer,
                    extractedText: '',
                    previewHtml: '',
                    metadata: {
                        generatedBy: 'image-generate',
                        imageIndex: index + 1,
                        model: model || null,
                        title: image?.revised_prompt || image?.revisedPrompt || prompt || '',
                        altText: image?.revised_prompt || image?.revisedPrompt || prompt || '',
                        sourcePrompt: prompt,
                        revisedPrompt: image?.revised_prompt || image?.revisedPrompt || '',
                    },
                    vectorize: false,
                });

                storedArtifact = artifactService.serializeArtifact(stored);
                artifacts.push({
                    ...storedArtifact,
                    inlinePath: buildArtifactInlinePath(storedArtifact.id),
                    absoluteInlineUrl: toAbsoluteInternalUrl(buildArtifactInlinePath(storedArtifact.id)),
                });
            } catch (error) {
                console.warn('[Images] Failed to persist generated image artifact:', error.message);
            }
        }

        normalizedImages.push(normalizeGeneratedImageRecord(image, storedArtifact));
    }

    await updateGeneratedImageSessionState(sessionId, artifacts);

    return {
        images: normalizedImages,
        artifacts,
        artifactIds: artifacts.map((artifact) => artifact.id),
    };
}

module.exports = {
    buildArtifactDownloadPath,
    buildArtifactInlinePath,
    getInternalApiBaseUrl,
    persistGeneratedImages,
    toAbsoluteInternalUrl,
    updateGeneratedImageSessionState,
};
