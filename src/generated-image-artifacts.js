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

function getGeneratedImageStringFields(image = {}) {
    return [
        image?.b64_json,
        image?.b64,
        image?.base64,
        image?.image_base64,
        image?.imageBase64,
        image?.data,
        image?.inline_data?.data,
        image?.inlineData?.data,
        image?.url,
        image?.image_url,
        image?.imageUrl,
        image?.file_uri,
        image?.fileUri,
        image?.path,
        image?.file,
        image?.file_path,
        image?.filePath,
    ].filter((value) => typeof value === 'string' && value.trim());
}

function inferGeneratedImagePayloadSource(image = {}) {
    const directInlineValue = [
        image?.b64_json,
        image?.b64,
        image?.base64,
        image?.image_base64,
        image?.imageBase64,
        image?.data,
        image?.inline_data?.data,
        image?.inlineData?.data,
    ].find((value) => typeof value === 'string' && value.trim());
    if (directInlineValue) {
        return /^data:image\//i.test(String(directInlineValue).trim())
            ? 'data_url'
            : 'b64_json';
    }

    const urlValue = String(
        image?.url
        || image?.image_url
        || image?.imageUrl
        || image?.file_uri
        || image?.fileUri
        || '',
    ).trim();
    if (/^data:image\//i.test(urlValue)) return 'data_url';
    if (/^https?:\/\//i.test(urlValue)) return 'remote_url';
    if (resolveGeneratedImageLocalPath(
        urlValue
        || image?.path
        || image?.file
        || image?.file_path
        || image?.filePath
        || '',
    )) {
        return 'local_path';
    }

    return 'missing';
}

function buildPersistenceAttempt({
    index = 0,
    image = {},
    status = 'skipped',
    reason = '',
    decoded = null,
    error = null,
    remoteDownload = null,
} = {}) {
    const payloadSource = inferGeneratedImagePayloadSource(image);
    return {
        index: index + 1,
        status,
        reason,
        payloadSource,
        hasSessionId: false,
        hasDecodedImage: Boolean(decoded?.buffer?.length),
        mimeType: decoded?.mimeType || null,
        extension: decoded?.extension || null,
        byteLength: decoded?.buffer?.length || 0,
        remoteDownload,
        error: error ? {
            message: String(error.message || error).slice(0, 240),
            name: String(error.name || '').trim() || null,
            code: error.code || null,
        } : null,
    };
}

function summarizeArtifactPersistence({ sessionId = '', images = [], attempts = [], artifacts = [] } = {}) {
    const normalizedAttempts = Array.isArray(attempts) ? attempts : [];
    const persisted = Array.isArray(artifacts) ? artifacts.length : 0;
    const failed = normalizedAttempts.filter((attempt) => attempt.status === 'failed').length;
    const skipped = normalizedAttempts.filter((attempt) => attempt.status === 'skipped').length;
    const primaryProblem = normalizedAttempts.find((attempt) => attempt.status !== 'persisted') || null;

    return {
        sessionIdPresent: Boolean(String(sessionId || '').trim()),
        requested: Array.isArray(images) ? images.length : 0,
        attempted: normalizedAttempts.length,
        persisted,
        failed,
        skipped,
        primaryReason: primaryProblem?.reason || (persisted > 0 ? 'persisted' : ''),
        attempts: normalizedAttempts.slice(0, 5),
    };
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

function parseUrlSafely(value = '') {
    try {
        return new URL(String(value || '').trim());
    } catch (_error) {
        return null;
    }
}

function summarizeRemoteImageUrl(value = '') {
    const parsed = parseUrlSafely(value);
    if (!parsed) {
        return null;
    }

    return {
        host: parsed.host,
        protocol: parsed.protocol.replace(/:$/, ''),
        path: parsed.pathname.slice(0, 240),
        queryPresent: Boolean(parsed.search),
        redactedUrl: `${parsed.origin}${parsed.pathname}`.slice(0, 320),
    };
}

function configuredBaseUrlMatches(url = '', baseUrl = '') {
    const parsedUrl = parseUrlSafely(url);
    const parsedBase = parseUrlSafely(baseUrl);
    return Boolean(parsedUrl && parsedBase && parsedUrl.origin === parsedBase.origin);
}

function buildGeneratedImageDownloadRequest(imageUrl = '') {
    const headers = {
        Accept: 'image/*',
    };
    const openaiApiKey = String(config.openai?.apiKey || '').trim();
    const mediaApiKey = String(config.media?.apiKey || '').trim();
    const matchesOpenAiBase = configuredBaseUrlMatches(imageUrl, config.openai?.baseURL);
    const matchesMediaBase = configuredBaseUrlMatches(imageUrl, config.media?.baseURL);
    const apiKey = matchesMediaBase && mediaApiKey ? mediaApiKey : openaiApiKey;

    let authHeadersAttached = false;
    if ((matchesOpenAiBase || matchesMediaBase) && apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
        headers['x-api-key'] = apiKey;
        authHeadersAttached = true;
    }

    return {
        headers,
        authHeadersAttached,
    };
}

function summarizeBufferSignature(buffer = null) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        return {
            firstBytesHex: '',
            asciiPreview: '',
            detected: 'empty',
        };
    }

    const firstBytes = buffer.subarray(0, Math.min(buffer.length, 16));
    const firstBytesHex = Array.from(firstBytes)
        .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');
    const asciiPreview = firstBytes
        .toString('latin1')
        .replace(/[^\x20-\x7E]/g, '.');
    let detected = 'unknown';
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        detected = 'png';
    } else if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        detected = 'jpeg';
    } else if (buffer.length >= 12
        && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
        && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
        detected = 'webp';
    } else if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) {
        detected = 'gif';
    } else if (/^\s*(?:<\?xml\b|<svg\b)/i.test(buffer.subarray(0, Math.min(buffer.length, 256)).toString('utf8'))) {
        detected = 'svg';
    } else if (/^\s*[{[]/.test(buffer.subarray(0, Math.min(buffer.length, 32)).toString('utf8'))) {
        detected = 'json_or_text';
    } else if (/^\s*</.test(buffer.subarray(0, Math.min(buffer.length, 32)).toString('utf8'))) {
        detected = 'html_or_xml';
    }

    return {
        firstBytesHex,
        asciiPreview,
        detected,
    };
}

function buildResponsePreview(buffer = null, contentType = '') {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        return '';
    }

    const normalizedContentType = String(contentType || '').toLowerCase();
    if (!/^(text\/|application\/(?:json|xml|problem\+json)\b)/i.test(normalizedContentType)) {
        return '';
    }

    return redactDiagnosticText(buffer
        .subarray(0, 400)
        .toString('utf8')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240));
}

function redactDiagnosticText(value = '') {
    return String(value || '')
        .replace(/(authorization|api[_-]?key|token|signature|sig|secret|password)=([^&\s"'<>]+)/gi, '$1=[redacted]')
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
        .replace(/sk-[A-Za-z0-9_-]{12,}/gi, 'sk-[redacted]');
}

function buildRemoteDownloadFailure({
    imageUrl = '',
    reason = '',
    response = null,
    contentType = '',
    buffer = null,
    error = null,
    authHeadersAttached = false,
    timeoutMs = 15000,
} = {}) {
    const contentLength = response?.headers?.get?.('content-length') || null;
    const finalUrl = response?.url || imageUrl;
    const redirected = response?.redirected === true || finalUrl !== imageUrl;
    return {
        reason,
        url: summarizeRemoteImageUrl(imageUrl),
        finalUrl: summarizeRemoteImageUrl(finalUrl),
        authHeadersAttached,
        timeoutMs,
        redirected,
        redirectCount: redirected ? null : 0,
        status: response?.status || null,
        statusText: response?.statusText || '',
        contentType: contentType || '',
        contentLength,
        byteLength: Buffer.isBuffer(buffer) ? buffer.length : 0,
        bodySniff: summarizeBufferSignature(buffer),
        responsePreview: buildResponsePreview(buffer, contentType),
        error: error ? {
            message: String(error.message || error).slice(0, 240),
            name: String(error.name || '').trim() || null,
            code: error.code || error.cause?.code || null,
            cause: error.cause ? {
                message: String(error.cause.message || '').slice(0, 240),
                name: String(error.cause.name || '').trim() || null,
                code: error.cause.code || null,
            } : null,
        } : null,
    };
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
        return {
            decoded: null,
            failure: null,
        };
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutMs = 15000;
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const request = buildGeneratedImageDownloadRequest(imageUrl);

    try {
        const response = await fetch(imageUrl, {
            method: 'GET',
            signal: controller?.signal,
            redirect: 'follow',
            headers: request.headers,
        });
        const contentType = String(response.headers?.get?.('content-type') || '').trim().toLowerCase();
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (!response.ok) {
            return {
                decoded: null,
                failure: buildRemoteDownloadFailure({
                    imageUrl,
                    reason: 'http_error',
                    response,
                    contentType,
                    buffer,
                    authHeadersAttached: request.authHeadersAttached,
                    timeoutMs,
                }),
            };
        }

        const mimeType = contentType.startsWith('image/')
            ? contentType.split(';')[0].trim()
            : inferMimeTypeFromUrl(imageUrl);
        const decoded = normalizeDecodedImageBuffer(buffer, mimeType);
        if (!decoded) {
            return {
                decoded: null,
                failure: buildRemoteDownloadFailure({
                    imageUrl,
                    reason: contentType && !contentType.startsWith('image/')
                        ? 'non_image_response'
                        : 'invalid_image_bytes',
                    response,
                    contentType,
                    buffer,
                    authHeadersAttached: request.authHeadersAttached,
                    timeoutMs,
                }),
            };
        }

        return {
            decoded,
            failure: null,
        };
    } catch (error) {
        console.warn('[Images] Failed to download generated image URL for persistence:', error.message);
        return {
            decoded: null,
            failure: buildRemoteDownloadFailure({
                imageUrl,
                reason: 'fetch_failed',
                error,
                authHeadersAttached: request.authHeadersAttached,
                timeoutMs,
            }),
        };
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

function normalizeGeneratedImageRecord(image = {}, storedArtifact = null, options = {}) {
    const revisedPrompt = image?.revised_prompt || image?.revisedPrompt || null;
    const prompt = String(image?.prompt || '').trim() || null;
    if (!storedArtifact?.id) {
        const includeOriginalPayload = options.includeOriginalPayload !== false;
        return {
            url: includeOriginalPayload ? image?.url || null : null,
            b64_json: includeOriginalPayload ? image?.b64_json || null : null,
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
    const persistenceAttempts = [];

    for (let index = 0; index < (Array.isArray(images) ? images : []).length; index += 1) {
        const image = images[index] || {};
        const imagePrompt = String(image?.prompt || prompt || '').trim();
        let storedArtifact = null;
        let persistenceAttempt = null;
        let remoteDownloadFailure = null;
        let decoded = decodeGeneratedImage(image)
            || await readGeneratedImageFromLocalPath(image);
        if (!decoded) {
            const download = await downloadGeneratedImage(image);
            decoded = download?.decoded || null;
            remoteDownloadFailure = download?.failure || null;
        }

        if (!sessionId) {
            persistenceAttempt = buildPersistenceAttempt({
                index,
                image,
                status: 'skipped',
                reason: 'missing_session_id',
                decoded,
            });
        } else if (!decoded?.buffer?.length) {
            persistenceAttempt = buildPersistenceAttempt({
                index,
                image,
                status: 'skipped',
                reason: remoteDownloadFailure?.reason
                    ? `remote_url_${remoteDownloadFailure.reason}`
                    : 'no_decodable_image_payload',
                decoded,
                remoteDownload: remoteDownloadFailure,
            });
            persistenceAttempt.hasSessionId = true;
        } else {
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
                persistenceAttempt = buildPersistenceAttempt({
                    index,
                    image,
                    status: 'persisted',
                    reason: 'persisted',
                    decoded,
                });
                persistenceAttempt.hasSessionId = true;
            } catch (error) {
                console.warn('[Images] Failed to persist generated image artifact:', error.message);
                persistenceAttempt = buildPersistenceAttempt({
                    index,
                    image,
                    status: 'failed',
                    reason: 'artifact_store_failed',
                    decoded,
                    error,
                });
                persistenceAttempt.hasSessionId = true;
            }
        }

        persistenceAttempts.push(persistenceAttempt);
        normalizedImages.push(normalizeGeneratedImageRecord(image, storedArtifact, {
            includeOriginalPayload: Boolean(decoded?.buffer?.length),
        }));
    }

    await updateGeneratedImageSessionState(sessionId, artifacts);
    const artifactPersistence = summarizeArtifactPersistence({
        sessionId,
        images,
        attempts: persistenceAttempts,
        artifacts,
    });

    return {
        images: normalizedImages,
        artifacts,
        artifactIds: artifacts.map((artifact) => artifact.id),
        artifactPersistence,
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
