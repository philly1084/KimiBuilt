const IMAGE_PAYLOAD_KEYS = [
  'url',
  'image_url',
  'imageUrl',
  'inlineUrl',
  'inlinePath',
  'downloadUrl',
  'absoluteUrl',
  'absoluteInlineUrl',
  'file_uri',
  'fileUri',
  'b64_json',
  'b64',
  'base64',
  'image_base64',
  'imageBase64',
  'data',
];

const IMAGE_ARRAY_KEYS = [
  'data',
  'images',
  'generated_images',
  'generatedImages',
  'output',
  'result',
  'content',
  'parts',
  'candidates',
];

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncate(value = '', limit = 180) {
  const normalized = normalizeText(value);
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1))}...`;
}

function getObjectKeys(value = {}, limit = 24) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value).slice(0, limit);
}

function summarizeArray(value = []) {
  if (!Array.isArray(value)) {
    return null;
  }

  const sample = value.slice(0, 3).map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return { type: typeof entry };
    }

    return {
      keys: getObjectKeys(entry, 12),
      type: normalizeText(entry.type || entry.object || entry.kind || ''),
      status: normalizeText(entry.status || ''),
      hasImagePayload: hasImagePayloadReference(entry),
    };
  });

  return {
    length: value.length,
    sample,
  };
}

function summarizeProviderResponseShape(response = null) {
  if (response == null) {
    return {
      type: 'null',
      keys: [],
    };
  }

  if (Array.isArray(response)) {
    return {
      type: 'array',
      length: response.length,
      sample: summarizeArray(response)?.sample || [],
    };
  }

  if (typeof response !== 'object') {
    return {
      type: typeof response,
      preview: truncate(response, 120),
    };
  }

  const shape = {
    type: 'object',
    keys: getObjectKeys(response),
  };

  for (const key of IMAGE_ARRAY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(response, key)) {
      if (Array.isArray(response[key])) {
        shape[key] = summarizeArray(response[key]);
      } else if (response[key] && typeof response[key] === 'object') {
        shape[key] = {
          type: 'object',
          keys: getObjectKeys(response[key], 12),
          hasImagePayload: hasImagePayloadReference(response[key]),
        };
      } else if (response[key] != null) {
        shape[key] = {
          type: typeof response[key],
          preview: truncate(response[key], 80),
        };
      }
    }
  }

  if (response.error || response.message) {
    shape.errorPreview = truncate(response.error?.message || response.message || response.error, 180);
  }

  return shape;
}

function hasTruncatedPayload(value = '') {
  return /\[truncated\s+\d+\s+chars\]/i.test(String(value || ''));
}

function hasNonTruncatedBase64(value = '') {
  const normalized = String(value || '').trim();
  return Boolean(normalized) && !hasTruncatedPayload(normalized);
}

function hasImagePayloadReference(image = {}) {
  if (!image || typeof image !== 'object') {
    return false;
  }

  if (image.url || image.image_url || image.imageUrl || image.inlineUrl || image.inlinePath
    || image.downloadUrl || image.absoluteUrl || image.absoluteInlineUrl
    || image.file_uri || image.fileUri) {
    return true;
  }

  if (hasNonTruncatedBase64(image.b64_json)
    || hasNonTruncatedBase64(image.b64)
    || hasNonTruncatedBase64(image.base64)
    || hasNonTruncatedBase64(image.image_base64)
    || hasNonTruncatedBase64(image.imageBase64)
    || hasNonTruncatedBase64(image.inline_data?.data)
    || hasNonTruncatedBase64(image.inlineData?.data)) {
    return true;
  }

  return false;
}

function hasUsableImageRecord(image = {}) {
  if (!image || typeof image !== 'object') {
    return false;
  }

  return hasImagePayloadReference(image)
    || Boolean(image.artifactId && (image.inlinePath || image.downloadUrl || image.url));
}

function countUsableImageRecords(images = []) {
  return (Array.isArray(images) ? images : []).filter((image) => hasUsableImageRecord(image)).length;
}

function summarizeImageRecordFlags(image = {}) {
  if (!image || typeof image !== 'object') {
    return {
      type: typeof image,
      usable: false,
    };
  }

  const flags = {
    keys: getObjectKeys(image, 16),
    usable: hasUsableImageRecord(image),
    hasUrl: Boolean(image.url || image.image_url || image.imageUrl),
    hasInlineUrl: Boolean(image.inlineUrl || image.inlinePath || image.absoluteInlineUrl),
    hasDownloadUrl: Boolean(image.downloadUrl || image.absoluteUrl),
    hasArtifactId: Boolean(image.artifactId || image.artifact_id),
    hasBase64: Boolean(image.b64_json || image.b64 || image.base64 || image.image_base64 || image.imageBase64),
    hasInlineData: Boolean(image.inline_data?.data || image.inlineData?.data),
    base64Truncated: hasTruncatedPayload(
      image.b64_json || image.b64 || image.base64 || image.image_base64 || image.imageBase64 || '',
    ),
    revisedPrompt: Boolean(image.revised_prompt || image.revisedPrompt),
  };

  return flags;
}

function normalizeDiagnosticsList(value = null) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter(Boolean).slice(0, 8);
  }
  return [value].filter(Boolean);
}

function summarizeBaseUrl(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  try {
    const parsed = new URL(normalized);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch (_error) {
    return truncate(normalized, 80);
  }
}

function summarizeProviderTransportFailure(error = null) {
  if (!error) {
    return null;
  }

  const message = normalizeText(error.message || error);
  const cause = error.cause && typeof error.cause === 'object' ? error.cause : {};
  const causeMessage = normalizeText(cause.message || '');
  const code = normalizeText(error.code || '');
  const causeCode = normalizeText(cause.code || '');
  const normalizedCode = String(code || causeCode || '').toUpperCase();
  const normalizedText = `${message} ${causeMessage}`.toLowerCase();
  const socketClosedByPeer = normalizedCode === 'UND_ERR_SOCKET'
    || /\b(other side closed|socket hang up|socket closed|premature close|premature socket close|closed before|terminated)\b/i.test(normalizedText);
  const dnsError = ['ENOTFOUND', 'EAI_AGAIN'].includes(normalizedCode);
  const connectionRefused = normalizedCode === 'ECONNREFUSED';
  const connectionReset = normalizedCode === 'ECONNRESET';
  const timeout = ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(normalizedCode)
    || /\b(timeout|timed out)\b/i.test(normalizedText);
  const fetchFailed = /\bfetch failed\b/i.test(normalizedText)
    || socketClosedByPeer
    || dnsError
    || connectionRefused
    || connectionReset
    || timeout;
  let category = fetchFailed ? 'fetch_failed' : '';
  if (socketClosedByPeer) {
    category = 'socket_closed_by_peer';
  } else if (dnsError) {
    category = 'dns_resolution_failed';
  } else if (connectionRefused) {
    category = 'connection_refused';
  } else if (connectionReset) {
    category = 'connection_reset';
  } else if (timeout) {
    category = 'timeout';
  }

  return {
    category,
    fetchFailed,
    socketClosedByPeer,
    dnsError,
    connectionRefused,
    connectionReset,
    timeout,
    code,
    name: normalizeText(error.name || ''),
    message: truncate(message, 240),
    cause: causeMessage || causeCode || normalizeText(cause.name || '')
      ? {
        name: normalizeText(cause.name || ''),
        message: truncate(causeMessage, 240),
        code: causeCode || null,
        errno: cause.errno || null,
        syscall: cause.syscall || null,
        hostname: cause.hostname || null,
      }
      : null,
  };
}

function classifyImageDiagnostics({
  error = null,
  transportFailure = null,
  providerResponseReceived = false,
  parsedImageCount = 0,
  returnedImageCount = 0,
  usableImageCount = 0,
  artifactCount = 0,
} = {}) {
  if (error) {
    const message = normalizeText(error.message || error).toLowerCase();
    const transport = transportFailure || summarizeProviderTransportFailure(error);
    const isFetchFailure = transport?.fetchFailed === true;

    if (isFetchFailure) {
      const socketClosedByPeer = transport?.socketClosedByPeer === true;
      return {
        status: 'failed',
        code: 'provider_fetch_failed',
        stage: 'provider_request',
        likelyCause: socketClosedByPeer
          ? 'The backend reached the image provider/router, but the remote side closed the socket before returning a complete HTTP response.'
          : 'The backend image tool could not reach the configured image provider/router before any image response was returned.',
        hints: socketClosedByPeer
          ? [
            'Inspect the image gateway/router pod logs for crashes, upstream disconnects, request body limits, or proxy timeout resets.',
            'Check whether the gateway can reach its upstream image provider and whether it closes long-running image requests before they finish.',
            'This is a provider/router transport failure, not a frontend receive/parser issue.',
          ]
          : [
            'Check OPENAI_BASE_URL, OPENAI_MEDIA_BASE_URL, image provider routing, DNS, TLS, and network access from the backend host.',
            'If this only happens through the agent tool path, inspect the backend runner/container network rather than the frontend parser.',
          ],
      };
    }

    if (/\bno\s+(?:parseable|parsable)\s+image\s+data\b/.test(message)
      || /\bno\s+(?:parseable|parsable)\s+image\s+payload\b/.test(message)
      || /\bprovider\s+returned\s+no\s+(?:parseable|parsable)\s+image\b/.test(message)) {
      return {
        status: 'failed',
        code: 'provider_response_not_parsable',
        stage: 'provider_response_parse',
        likelyCause: 'The image provider/router returned a response, but no recognizable image URL, file reference, inline_data, or base64 payload was found.',
        hints: [
          'Inspect the image router/provider response schema and map any custom image fields into the backend image normalizer.',
          'If the provider returned a refusal, moderation result, or text-only message, surface that as the image failure reason instead of an empty image result.',
          'This points at provider/router response shape or backend parsing, not the frontend receive path.',
        ],
      };
    }

    return {
      status: 'failed',
      code: 'provider_or_backend_error',
      stage: 'backend_error',
      likelyCause: 'The backend failed before it could return an image payload.',
      hints: [
        'Check the admin log error, provider status, model name, and image endpoint routing.',
      ],
    };
  }

  if (!providerResponseReceived) {
    return {
      status: 'failed',
      code: 'no_provider_response',
      stage: 'provider_request',
      likelyCause: 'The backend did not receive a provider response to parse.',
      hints: [
        'Check network routing, provider credentials, and whether the image endpoint is reachable from the backend.',
      ],
    };
  }

  if (parsedImageCount === 0) {
    return {
      status: 'failed',
      code: 'provider_response_not_parsable',
      stage: 'provider_response_parse',
      likelyCause: 'The provider/router returned HTTP success, but the backend did not find image URL, file, inline_data, or base64 fields in known response locations.',
      hints: [
        'Inspect responseShape in the admin trace to see which top-level keys came back.',
        'If the image router uses a custom schema, map that schema in openai-client image parsing.',
        'If the response contains text explaining refusal or moderation, route that as an image-generation error instead of an empty image result.',
      ],
    };
  }

  if (returnedImageCount === 0) {
    return {
      status: 'failed',
      code: 'backend_returned_no_image_records',
      stage: 'backend_response_build',
      likelyCause: 'The backend parsed provider image records, but none survived response normalization.',
      hints: [
        'Check generated image artifact persistence and response normalization.',
      ],
    };
  }

  if (usableImageCount === 0) {
    return {
      status: 'failed',
      code: 'backend_returned_no_usable_image_payload',
      stage: 'backend_response_build',
      likelyCause: 'The backend returned image records, but none contained a usable URL, artifact link, or non-truncated base64 payload.',
      hints: [
        'Check whether base64 was truncated, the provider returned metadata-only records, or artifact persistence failed.',
        'If records include unfamiliar payload keys, add them to the backend image normalizer.',
      ],
    };
  }

  if (artifactCount === 0) {
    return {
      status: 'warning',
      code: 'backend_sent_usable_unpersisted_images',
      stage: 'backend_response_build',
      likelyCause: 'The backend parsed and returned usable image payloads, but no reusable artifact was persisted.',
      hints: [
        'Inspect artifact persistence, image validation, and session-file creation before chasing frontend parsing.',
        'If final model text contains a generic image URL, verify synthesis is using persisted artifact URLs instead of inventing links.',
      ],
    };
  }

  return {
    status: 'ok',
    code: 'backend_sent_usable_images',
    stage: 'frontend_receive_or_parse',
    likelyCause: 'The backend returned usable image data and persisted reusable artifacts.',
    hints: [
      'If the UI still reports no parsable image data, focus on frontend response parsing, session file handling, or transport stripping.',
    ],
  };
}

function buildImageGenerationDiagnostics({
  route = '',
  stage = '',
  source = '',
  providerSource = '',
  providerBaseUrl = '',
  providerMetadata = null,
  upstreamDiagnostics = null,
  response = null,
  parsedImages = [],
  returnedImages = null,
  artifacts = [],
  artifactPersistence = null,
  requestedCount = 0,
  model = '',
  size = '',
  quality = '',
  prompt = '',
  error = null,
} = {}) {
  const parsedImageRecords = Array.isArray(parsedImages) ? parsedImages : [];
  const returnedImageRecords = Array.isArray(returnedImages) ? returnedImages : parsedImageRecords;
  const artifactRecords = Array.isArray(artifacts) ? artifacts : [];
  const persistence = artifactPersistence && typeof artifactPersistence === 'object'
    ? artifactPersistence
    : null;
  const providerResponse = response || (error?.providerResponse && typeof error.providerResponse === 'object'
    ? error.providerResponse
    : null);
  const transportFailure = summarizeProviderTransportFailure(error);
  const errorImageDiagnostics = error?.diagnostics?.imageGeneration
    || error?.providerResponse?.diagnostics?.imageGeneration
    || null;
  const noParseableImageDataError = error
    && /\bno\s+(?:parseable|parsable)\s+image\s+(?:data|payload)\b/i.test(String(error.message || error));
  const providerResponseReceived = Boolean(providerResponse || providerMetadata || upstreamDiagnostics || errorImageDiagnostics || noParseableImageDataError);
  const parsedImageCount = parsedImageRecords.length;
  const returnedImageCount = returnedImageRecords.length;
  const usableImageCount = countUsableImageRecords(returnedImageRecords);
  const artifactCount = artifactRecords.length;
  const classification = classifyImageDiagnostics({
    error,
    transportFailure,
    providerResponseReceived,
    parsedImageCount,
    returnedImageCount,
    usableImageCount,
    artifactCount,
  });
  const upstream = [
    ...normalizeDiagnosticsList(upstreamDiagnostics),
    ...normalizeDiagnosticsList(errorImageDiagnostics),
  ];
  const metadata = providerMetadata && typeof providerMetadata === 'object' ? providerMetadata : {};

  return {
    version: 1,
    status: classification.status,
    code: classification.code,
    stage: stage || classification.stage,
    route: normalizeText(route),
    source: normalizeText(source),
    likelyCause: classification.likelyCause,
    flags: {
      providerResponseReceived,
      backendParsedImageRecords: parsedImageCount > 0,
      backendReturnedImageRecords: returnedImageCount > 0,
      backendReturnedUsableImageRecords: usableImageCount > 0,
      artifactsPersisted: artifactCount > 0,
      likelyProviderTransportIssue: transportFailure?.fetchFailed === true,
      providerSocketClosedByPeer: transportFailure?.socketClosedByPeer === true,
      providerDnsIssue: transportFailure?.dnsError === true,
      providerConnectionRefused: transportFailure?.connectionRefused === true,
      providerConnectionReset: transportFailure?.connectionReset === true,
      providerTimeout: transportFailure?.timeout === true,
      likelyBackendParserIssue: providerResponseReceived && parsedImageCount === 0,
      likelyBackendResponseIssue: parsedImageCount > 0 && usableImageCount === 0,
      likelyArtifactPersistenceIssue: usableImageCount > 0 && artifactCount === 0,
      likelyFrontendReceiveOrParserIssue: usableImageCount > 0 && artifactCount > 0,
    },
    counts: {
      requested: Number(requestedCount || 0),
      parsedImageRecords: parsedImageCount,
      returnedImageRecords: returnedImageCount,
      usableReturnedImageRecords: usableImageCount,
      artifacts: artifactCount,
    },
    provider: {
      source: normalizeText(providerSource || metadata.providerSource || metadata.source || error?.provider),
      family: normalizeText(metadata.providerFamily || metadata.family || error?.providerFamily),
      baseUrl: summarizeBaseUrl(providerBaseUrl || metadata.baseURL || metadata.baseUrl || error?.baseURL || error?.baseUrl),
      endpoint: normalizeText(metadata.endpoint || error?.endpoint || ''),
      status: metadata.status || error?.status || error?.statusCode || null,
      requestHadResponseFormat: metadata.requestHadResponseFormat === true || error?.requestHadResponseFormat === true,
      requestVariant: metadata.requestVariant ?? error?.requestVariant ?? null,
    },
    artifactPersistence: persistence
      ? {
        sessionIdPresent: persistence.sessionIdPresent === true,
        requested: Number(persistence.requested || 0),
        attempted: Number(persistence.attempted || 0),
        persisted: Number(persistence.persisted || 0),
        failed: Number(persistence.failed || 0),
        skipped: Number(persistence.skipped || 0),
        primaryReason: normalizeText(persistence.primaryReason || ''),
        attempts: Array.isArray(persistence.attempts)
          ? persistence.attempts.slice(0, 5).map((attempt) => ({
            index: Number(attempt?.index || 0),
            status: normalizeText(attempt?.status || ''),
            reason: normalizeText(attempt?.reason || ''),
            payloadSource: normalizeText(attempt?.payloadSource || ''),
            hasSessionId: attempt?.hasSessionId === true,
            hasDecodedImage: attempt?.hasDecodedImage === true,
            mimeType: normalizeText(attempt?.mimeType || ''),
            extension: normalizeText(attempt?.extension || ''),
            byteLength: Number(attempt?.byteLength || 0),
            error: attempt?.error || null,
          }))
          : [],
      }
      : null,
    transport: transportFailure
      ? {
        category: transportFailure.category,
        socketClosedByPeer: transportFailure.socketClosedByPeer,
        dnsError: transportFailure.dnsError,
        connectionRefused: transportFailure.connectionRefused,
        connectionReset: transportFailure.connectionReset,
        timeout: transportFailure.timeout,
        code: transportFailure.code || null,
        name: transportFailure.name || null,
        message: transportFailure.message || null,
        cause: transportFailure.cause,
      }
      : null,
    request: {
      model: normalizeText(model || metadata.model),
      size: normalizeText(size),
      quality: normalizeText(quality),
      promptPreview: truncate(prompt, 120),
    },
    responseShape: providerResponse ? summarizeProviderResponseShape(providerResponse) : null,
    returnedImageFlags: returnedImageRecords.slice(0, 5).map((image) => summarizeImageRecordFlags(image)),
    upstreamDiagnostics: upstream.map((entry) => ({
      status: entry.status,
      code: entry.code,
      stage: entry.stage,
      flags: entry.flags,
      counts: entry.counts,
      provider: entry.provider,
      responseShape: entry.responseShape,
    })),
    error: error
      ? {
        message: truncate(error.message || error, 240),
        name: normalizeText(error.name || ''),
        status: error.status || error.statusCode || null,
        code: error.code || null,
        provider: error.provider || null,
        baseUrl: summarizeBaseUrl(error.baseURL || error.baseUrl || ''),
        cause: error.cause
          ? {
            name: normalizeText(error.cause.name || ''),
            message: truncate(error.cause.message || '', 240),
            code: error.cause.code || null,
            errno: error.cause.errno || null,
            syscall: error.cause.syscall || null,
            hostname: error.cause.hostname || null,
          }
          : null,
      }
      : null,
    hints: classification.hints,
    summary: `${classification.code}: ${classification.likelyCause}`,
  };
}

function formatImageDiagnosticsSummary(diagnostics = null) {
  const diag = diagnostics?.imageGeneration || diagnostics;
  if (!diag || typeof diag !== 'object') {
    return '';
  }

  const counts = diag.counts || {};
  const flags = diag.flags || {};
  const provider = diag.provider || {};
  const transport = diag.transport || {};
  const artifactPersistence = diag.artifactPersistence || {};
  const parts = [
    diag.code || 'image_diagnostics',
    diag.stage ? `stage=${diag.stage}` : '',
    provider.source ? `provider=${provider.source}` : '',
    provider.status ? `providerStatus=${provider.status}` : '',
    transport.category ? `transport=${transport.category}` : '',
    artifactPersistence.primaryReason ? `artifactPersistence=${artifactPersistence.primaryReason}` : '',
    `parsed=${Number(counts.parsedImageRecords || 0)}`,
    `returned=${Number(counts.returnedImageRecords || 0)}`,
    `usable=${Number(counts.usableReturnedImageRecords || 0)}`,
    `artifacts=${Number(counts.artifacts || 0)}`,
  ].filter(Boolean);
  const usableCount = Number(counts.usableReturnedImageRecords || 0);
  const artifactCount = Number(counts.artifacts || 0);
  const likely = (flags.likelyArtifactPersistenceIssue || (usableCount > 0 && artifactCount === 0))
    ? 'backend parsed usable image data, but no reusable artifact was persisted; inspect artifact persistence/image validation path'
    : flags.providerSocketClosedByPeer
      ? 'provider/router closed the socket before an HTTP response completed; inspect gateway logs, upstream connectivity, and proxy timeouts'
      : flags.likelyFrontendReceiveOrParserIssue
        ? 'backend sent usable persisted image data; inspect frontend receive/parser path'
        : (diag.likelyCause || '');

  return `${parts.join(' | ')}${likely ? ` | ${likely}` : ''}`;
}

module.exports = {
  buildImageGenerationDiagnostics,
  countUsableImageRecords,
  formatImageDiagnosticsSummary,
  hasImagePayloadReference,
  hasUsableImageRecord,
  summarizeProviderResponseShape,
};
