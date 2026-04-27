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

function normalizeBase64Payload(value = '') {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return '';
    }

    const dataUrl = decodeDataUrl(normalized);
    if (dataUrl?.buffer?.length) {
        return normalized;
    }

    return normalized.replace(/\s+/g, '');
}

function decodeDataUrl(url = '') {
    const normalized = String(url || '').trim();
    const match = normalized.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
    if (!match?.[1] || !match?.[2]) {
        return null;
    }

    const buffer = decodeBase64ImageBuffer(match[2]);
    if (!buffer) {
        return null;
    }

    return normalizeDecodedImageBuffer(buffer, match[1]);
}

function isTruncatedImagePayload(value = '') {
    return /\[truncated\s+\d+\s+chars\]/i.test(String(value || ''));
}

function decodeBase64ImageBuffer(value = '') {
    const normalized = String(value || '').replace(/\s+/g, '');
    if (!normalized || isTruncatedImagePayload(normalized)) {
        return null;
    }

    if (normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
        return null;
    }

    const buffer = Buffer.from(normalized, 'base64');
    return buffer.length > 0 ? buffer : null;
}

function sniffImageMimeType(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        return null;
    }

    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return 'image/png';
    }
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'image/jpeg';
    }
    if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) {
        return 'image/gif';
    }
    if (buffer.length >= 12
        && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
        && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
        return 'image/webp';
    }

    const prefix = buffer.subarray(0, Math.min(buffer.length, 256)).toString('utf8').trimStart().toLowerCase();
    if (prefix.startsWith('<svg') || prefix.startsWith('<?xml')) {
        return 'image/svg+xml';
    }

    return null;
}

function readPngDimensions(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 24) {
        return null;
    }
    return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
    };
}

function readGifDimensions(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 10) {
        return null;
    }
    return {
        width: buffer.readUInt16LE(6),
        height: buffer.readUInt16LE(8),
    };
}

function readJpegDimensions(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
        return null;
    }

    let offset = 2;
    while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
            offset += 1;
            continue;
        }

        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        if (length < 2) {
            return null;
        }

        if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
            return {
                width: buffer.readUInt16BE(offset + 7),
                height: buffer.readUInt16BE(offset + 5),
            };
        }

        offset += 2 + length;
    }

    return null;
}

function readImageDimensions(buffer, mimeType = '') {
    if (mimeType === 'image/png') return readPngDimensions(buffer);
    if (mimeType === 'image/gif') return readGifDimensions(buffer);
    if (mimeType === 'image/jpeg') return readJpegDimensions(buffer);
    return null;
}

function normalizeDecodedImageBuffer(buffer, preferredMimeType = 'image/png') {
    const sniffedMimeType = sniffImageMimeType(buffer);
    if (!sniffedMimeType) {
        return null;
    }

    const mimeType = sniffedMimeType || String(preferredMimeType || 'image/png').trim().toLowerCase();
    const dimensions = readImageDimensions(buffer, mimeType);
    if (dimensions && dimensions.width <= 1 && dimensions.height <= 1) {
        return null;
    }

    return {
        mimeType,
        extension: extensionForMimeType(mimeType),
        buffer,
    };
}

function decodeGeneratedImage(image = {}) {
    const base64Value = [
        image?.b64_json,
        image?.b64,
        image?.base64,
        image?.image_base64,
        image?.imageBase64,
        image?.data,
        image?.inline_data?.data,
        image?.inlineData?.data,
    ].find((value) => typeof value === 'string' && value.trim());

    if (typeof base64Value === 'string' && base64Value.trim()) {
        const dataUrl = decodeDataUrl(base64Value);
        if (dataUrl) {
            return dataUrl;
        }

        const mimeType = String(
            image?.mimeType
            || image?.mime_type
            || image?.inline_data?.mime_type
            || image?.inlineData?.mimeType
            || 'image/png',
        ).trim().toLowerCase();
        const buffer = decodeBase64ImageBuffer(normalizeBase64Payload(base64Value));
        const decoded = buffer ? normalizeDecodedImageBuffer(buffer, mimeType) : null;
        if (decoded) {
            return decoded;
        }
    }

    return decodeDataUrl(
        image?.url
        || image?.image_url
        || image?.imageUrl
        || image?.file_uri
        || image?.fileUri
        || '',
    );
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
    const filePath = resolveGeneratedImageLocalPath(
        image?.url
        || image?.path
        || image?.file
        || image?.file_path
        || image?.filePath
        || image?.file_uri
        || image?.fileUri
        || '',
    );
    if (!filePath) {
        return null;
    }

    try {
        const buffer = await fs.readFile(filePath);
        const mimeType = inferMimeTypeFromUrl(filePath);
        return normalizeDecodedImageBuffer(buffer, mimeType);
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
    const imageUrl = String(
        image?.url
        || image?.image_url
        || image?.imageUrl
        || image?.file_uri
        || image?.fileUri
        || '',
    ).trim();
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
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const decoded = normalizeDecodedImageBuffer(buffer, mimeType);
        if (!decoded) {
            throw new Error('Downloaded response was not a usable image');
        }

        return decoded;
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
    const prompt = String(image?.prompt || '').trim() || null;
    if (!storedArtifact?.id) {
        return {
            url: image?.url || null,
            b64_json: image?.b64_json || null,
            revised_prompt: revisedPrompt,
            revisedPrompt,
            prompt,
            artifactId: null,
            downloadUrl: null,
            inlinePath: null,
            inlineUrl: null,
            absoluteUrl: null,
            filename: null,
        };
    }

    const downloadUrl = buildArtifactDownloadPath(storedArtifact.id);
    const inlinePath = buildArtifactInlinePath(storedArtifact.id);
    return {
        url: inlinePath,
        b64_json: null,
        revised_prompt: revisedPrompt,
        revisedPrompt,
        prompt,
        artifactId: storedArtifact.id,
        downloadUrl,
        inlinePath,
        inlineUrl: inlinePath,
        absoluteUrl: toAbsoluteInternalUrl(inlinePath),
        filename: storedArtifact.filename || null,
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
        const imagePrompt = String(image?.prompt || prompt || '').trim();
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
                    filename: buildGeneratedImageFilename(imagePrompt, index, decoded.extension),
                    extension: decoded.extension,
                    mimeType: decoded.mimeType,
                    buffer: decoded.buffer,
                    extractedText: '',
                    previewHtml: '',
                    metadata: {
                        generatedBy: 'image-generate',
                        imageIndex: index + 1,
                        model: model || null,
                        title: image?.revised_prompt || image?.revisedPrompt || imagePrompt || '',
                        altText: image?.revised_prompt || image?.revisedPrompt || imagePrompt || '',
                        sourcePrompt: imagePrompt,
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
