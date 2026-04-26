const { config } = require('../config');
const { createResponse } = require('../openai-client');
const { piperTtsService, normalizeTextForSpeech } = require('../tts/piper-tts-service');
const { persistGeneratedAudio, updateGeneratedAudioSessionState } = require('../generated-audio-artifacts');
const { audioProcessingService } = require('../audio/audio-processing-service');
const settingsController = require('../routes/admin/settings.controller');
const {
  concatWavBuffers,
  createSilenceWavBuffer,
  normalizeWavBufferFormat,
  parseWavBuffer,
  wavFormatsMatch,
} = require('../audio/wav-utils');
const { chunkText, normalizeWhitespace, stripHtml, stripNullCharacters } = require('../utils/text');
const { parseLenientJson } = require('../utils/lenient-json');

const DEFAULT_DURATION_MINUTES = 10;
const DEFAULT_TARGET_WPM = 145;
const DEFAULT_MAX_SOURCES = 4;
const DEFAULT_SILENCE_MS = 325;
const DEFAULT_MINIMUM_VALID_TURNS = 4;
const DEFAULT_PODCAST_SEARCH_TIMEOUT_MS = 45000;
const DEFAULT_PODCAST_SCRIPT_REQUEST_TIMEOUT_MS = Math.max(
  30000,
  Number(config?.podcast?.scriptRequestTimeoutMs) || (5 * 60 * 1000),
);
const DEFAULT_PODCAST_SCRIPT_RETRY_ATTEMPTS = Math.max(
  0,
  Number(config?.podcast?.scriptRetryAttempts) || 1,
);
const DEFAULT_TRANSIENT_RETRY_ATTEMPTS = 2;
const DEFAULT_TRANSIENT_RETRY_DELAY_MS = 1200;
const DEFAULT_AUDIO_PROCESSING_RETRY_ATTEMPTS = 1;
const DEFAULT_PODCAST_RESEARCH_CONCURRENCY = Math.max(
  1,
  Math.min(12, Number(config?.podcast?.researchConcurrency) || 2),
);
const DEFAULT_PODCAST_TTS_CONCURRENCY = Math.max(
  1,
  Math.min(24, Number(config?.podcast?.ttsConcurrency) || 2),
);
const MAX_PODCAST_RESEARCH_CONCURRENCY = 12;
const MAX_PODCAST_TTS_CONCURRENCY = 24;
const PODCAST_HIGH_QUALITY_VOICE_IDS = Object.freeze([
  'lessac-high',
  'lessac-bright',
  'ljspeech-high',
  'ryan-high',
  'ryan-direct',
  'cori-high',
  'hfc-female-rich',
  'hfc-female-medium',
  'kathleen-low',
  'amy-expressive',
  'amy-broadcast',
  'amy-medium',
]);
const DEFAULT_MAX_VOICE_FALLBACK_ATTEMPTS = 2;
const MAX_PODCAST_TTS_SPLIT_DEPTH = 3;
const DEFAULT_HOST_ROSTER = Object.freeze([
  {
    key: 'hostA',
    name: 'Maya',
    role: 'Lead host',
    persona: 'Warm, curious, and good at guiding the listener through the big picture.',
    preferredVoiceIds: ['lessac-high', 'lessac-bright', 'ljspeech-high', 'hfc-female-rich'],
  },
  {
    key: 'hostB',
    name: 'Ryan',
    role: 'Co-host',
    persona: 'Grounded, calm, and precise when unpacking details, tradeoffs, and practical consequences.',
    preferredVoiceIds: ['ryan-high', 'ryan-direct', 'cori-high'],
  },
  {
    key: 'hostC',
    name: 'June',
    role: 'Co-host',
    persona: 'Sharper, more analytical, and slightly playful when unpacking details and tradeoffs.',
    preferredVoiceIds: ['cori-high', 'lessac-bright', 'amy-broadcast'],
  },
  {
    key: 'hostD',
    name: 'Elliot',
    role: 'Lead host',
    persona: 'Measured, thoughtful, and good at turning technical material into clear narrative beats.',
    preferredVoiceIds: ['ryan-direct', 'ryan-high', 'ljspeech-high'],
  },
  {
    key: 'hostE',
    name: 'Nora',
    role: 'Lead host',
    persona: 'Polished, editorial, and relaxed, with an emphasis on listener trust and clean pacing.',
    preferredVoiceIds: ['ljspeech-high', 'lessac-high', 'kathleen-low'],
  },
  {
    key: 'hostF',
    name: 'Cori',
    role: 'Co-host',
    persona: 'Concise, documentary-style, and comfortable adding perspective without overexplaining.',
    preferredVoiceIds: ['cori-high', 'lessac-high', 'ryan-high'],
  },
]);
const LEGACY_DEFAULT_HOSTS = Object.freeze([
  {
    key: 'hostA',
    name: 'Maya',
    role: 'Lead host',
    persona: 'Warm, curious, and good at guiding the listener through the big picture.',
    preferredVoiceIds: ['lessac-high', 'lessac-bright', 'ljspeech-high', 'hfc-female-rich'],
  },
  {
    key: 'hostB',
    name: 'June',
    role: 'Co-host',
    persona: 'Sharper, more analytical, and slightly playful when unpacking details and tradeoffs.',
    preferredVoiceIds: ['cori-high', 'lessac-bright', 'amy-broadcast'],
  },
]);

function resolveHighQualityVoicePool(availableVoiceIds = new Set(), preferredVoiceIds = []) {
  const preferred = uniqueOrdered(preferredVoiceIds)
    .filter((voiceId) => availableVoiceIds.has(voiceId));

  if (preferred.length > 0) {
    return preferred;
  }

  const curated = uniqueOrdered(
    PODCAST_HIGH_QUALITY_VOICE_IDS.filter((voiceId) => availableVoiceIds.has(voiceId)),
  );

  if (curated.length > 0) {
    return curated;
  }

  return uniqueOrdered(Array.from(availableVoiceIds));
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

function stripUnpairedSurrogates(value = '') {
  const input = String(value || '');
  let output = '';

  for (let index = 0; index < input.length; index += 1) {
    const codeUnit = input.charCodeAt(index);

    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const nextCodeUnit = input.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xDC00 && nextCodeUnit <= 0xDFFF) {
        output += input[index] + input[index + 1];
        index += 1;
      }
      continue;
    }

    if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      continue;
    }

    output += input[index];
  }

  return output;
}

function stripMalformedUnicodeEscapes(value = '') {
  return String(value || '')
    .replace(/\\u(?![0-9a-fA-F]{4})/g, '')
    .replace(/\\u[0-9a-fA-F]{1,3}(?![0-9a-fA-F])/g, '')
    .replace(/\\x(?![0-9a-fA-F]{2})/g, '')
    .replace(/\\x[0-9a-fA-F](?![0-9a-fA-F])/g, '')
    .replace(/\\u\{[0-9a-fA-F]+\}(?![0-9a-fA-F])/g, '');
}

function sanitizePodcastTextForSpeech(value = '') {
  return stripMalformedUnicodeEscapes(stripUnpairedSurrogates(stripNullCharacters(value || '')))
    .replace(/\u200B/g, ' ')
    .replace(/[^\x20-\x7E\n\r\t]+/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizePodcastTextChunkForSpeech(value = '', maxTextChars = 2400) {
  const sanitized = sanitizePodcastTextForSpeech(value);
  if (!sanitized) {
    return '';
  }

  try {
    return normalizeTextForSpeech(sanitized, maxTextChars);
  } catch (error) {
    if (error?.code === 'empty_text') {
      return '';
    }
    throw error;
  }
}

function normalizeStringList(value = []) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

function uniqueOrdered(items = []) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .filter((value) => {
      const id = String(value || '').trim();
      if (!id || seen.has(id)) {
        return false;
      }

      seen.add(id);
      return true;
    });
}

function stableIndexFromText(value = '', modulo = 1) {
  const limit = Math.max(1, Number(modulo) || 1);
  const input = String(value || '');
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash * 31) + input.charCodeAt(index)) >>> 0;
  }
  return hash % limit;
}

function hasExplicitHostConfig(params = {}) {
  return ['A', 'B'].some((suffix) => (
    String(params[`host${suffix}Name`] || '').trim()
    || String(params[`host${suffix}Role`] || '').trim()
    || String(params[`host${suffix}Persona`] || '').trim()
    || String(params[`host${suffix}VoiceId`] || '').trim()
    || normalizeStringList(params[`host${suffix}VoiceIds`]).length > 0
  ));
}

function selectDefaultHostTemplates(params = {}) {
  if (hasExplicitHostConfig(params)) {
    return LEGACY_DEFAULT_HOSTS;
  }

  const leadHosts = DEFAULT_HOST_ROSTER.filter((host) => host.role === 'Lead host');
  const coHosts = DEFAULT_HOST_ROSTER.filter((host) => host.role !== 'Lead host');
  if (leadHosts.length === 0 || coHosts.length === 0) {
    return DEFAULT_HOST_ROSTER.slice(0, 2);
  }

  const seed = [
    params.topic,
    params.prompt,
    params.subject,
    params.audience,
    params.tone,
    Date.now(),
  ].filter(Boolean).join('|');
  const firstIndex = stableIndexFromText(seed, leadHosts.length);
  const secondIndex = stableIndexFromText(`${seed}|cohost`, coHosts.length);

  return [leadHosts[firstIndex], coHosts[secondIndex]];
}

function buildHostVoicePool(availableVoices = [], preferredVoiceIds = [], explicitVoiceIds = [], forcedVoiceId = '') {
  const availableVoiceIds = new Set(
    (Array.isArray(availableVoices) ? availableVoices : [])
      .map((voice) => String(voice.id || '').trim())
      .filter(Boolean),
  );
  if (availableVoiceIds.size === 0) {
    return [];
  }

  const forced = String(forcedVoiceId || '').trim();
  const preferred = uniqueOrdered(preferredVoiceIds);
  const explicit = uniqueOrdered(normalizeStringList(explicitVoiceIds));
  const requested = uniqueOrdered([
    forced,
    ...explicit,
    ...preferred,
  ]).filter(Boolean);

  const validRequested = requested.filter((voiceId) => availableVoiceIds.has(voiceId));
  if (validRequested.length > 0) {
    return validRequested;
  }

  return resolveHighQualityVoicePool(availableVoiceIds, preferredVoiceIds);
}

function sanitizePodcastText(value = '', { preserveNewlines = false } = {}) {
  const base = stripUnpairedSurrogates(stripNullCharacters(value || ''))
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');

  let normalized = '';
  try {
    normalized = base.normalize('NFKC');
  } catch (_error) {
    normalized = base;
  }

  const whitespaceNormalized = preserveNewlines
    ? normalizeWhitespace(normalized).replace(/\n{3,}/g, '\n\n')
    : normalized.replace(/\s+/g, ' ').trim();

  return whitespaceNormalized.trim();
}

function estimateWordBudget(durationMinutes = DEFAULT_DURATION_MINUTES) {
  return Math.round(durationMinutes * DEFAULT_TARGET_WPM);
}

function estimateTurnCount(durationMinutes = DEFAULT_DURATION_MINUTES) {
  return Math.max(12, Math.min(22, Math.round(durationMinutes * 1.7)));
}

function normalizeVariantFilename(filename = '', extension = 'wav') {
  const normalizedFilename = String(filename || '').trim();
  const normalizedExtension = String(extension || '').trim().replace(/^\./, '').toLowerCase() || 'wav';
  if (!normalizedFilename) {
    return '';
  }

  if (/\.[a-z0-9]+$/i.test(normalizedFilename)) {
    return normalizedFilename.replace(/\.[a-z0-9]+$/i, `.${normalizedExtension}`);
  }

  return `${normalizedFilename}.${normalizedExtension}`;
}

function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function createConcurrencyLimiter(maxConcurrency = 1) {
  const limit = Math.max(1, Number(maxConcurrency) || 1);
  const queue = [];
  let active = 0;

  async function acquire() {
    if (active < limit) {
      active += 1;
      return;
    }

    await new Promise((resolve) => queue.push(resolve));
  }

  function release() {
    if (queue.length > 0) {
      const next = queue.shift();
      next();
      return;
    }

    active = Math.max(0, active - 1);
  }

  return {
    async run(task) {
      await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}

async function mapWithConcurrency(items = [], maxConcurrency = 1, mapper = async (value) => value) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    return [];
  }

  const concurrency = Math.max(1, Math.min(list.length, Number(maxConcurrency) || 1));
  const results = new Array(list.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= list.length) {
        return;
      }

      results[currentIndex] = await mapper(list[currentIndex], currentIndex);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

function prefersMp3(params = {}) {
  if (params.exportMp3 === true) {
    return true;
  }

  const outputFormat = String(params.outputFormat || params.format || '').trim().toLowerCase();
  return outputFormat === 'mp3';
}

function requestedMixing(params = {}) {
  return params.includeIntro === true
    || params.includeOutro === true
    || params.includeMusicBed === true
    || params.includeVideo === true
    || Boolean(String(params.introPath || '').trim())
    || Boolean(String(params.outroPath || '').trim())
    || Boolean(String(params.musicBedPath || '').trim());
}

function uniqueUrls(items = []) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    const url = String(item?.url || '').trim();
    if (!url || seen.has(url)) {
      return false;
    }
    seen.add(url);
    return true;
  });
}

function resolvePodcastScriptModelCandidates(params = {}, context = {}) {
  const requestedModel = String(params?.model || '').trim();
  const defaultModel = String(settingsController?.settings?.models?.defaultModel || '').trim();
  const fallbackModel = String(settingsController?.settings?.models?.fallbackModel || '').trim();
  const configuredModel = String(config.openai?.model || '').trim();
  const contextModel = String(context?.model || '').trim();

  return uniqueOrdered([
    requestedModel,
    contextModel,
    defaultModel,
    configuredModel,
    fallbackModel,
  ]);
}

function isTransientPodcastError(error = {}) {
  const message = String(error?.message || '').trim().toLowerCase();
  const code = String(error?.code || '').trim().toLowerCase();
  const statusCode = Number(error?.statusCode || error?.status || 0);

  if (statusCode >= 400 && statusCode < 500 && statusCode !== 408 && statusCode !== 429) {
    return false;
  }

  if (statusCode >= 500 || statusCode === 408 || statusCode === 429) {
    return true;
  }

  return [
    'connection terminated unexpectedly',
    'terminated',
    'socket hang up',
    'fetch failed',
    'econnreset',
    'etimedout',
    'timed out',
    'eai_again',
    'temporarily unavailable',
    'service unavailable',
    'bad gateway',
    'gateway timeout',
  ].some((pattern) => message.includes(pattern) || code.includes(pattern));
}

function isRetryablePodcastAudioError(error = {}) {
  const message = String(error?.message || '').trim().toLowerCase();
  const code = String(error?.code || '').trim().toLowerCase();
  const statusCode = Number(error?.statusCode || error?.status || 0);

  if (statusCode >= 400 && statusCode < 500) {
    return false;
  }

  if (['audio_asset_missing', 'audio_processing_invalid_input'].includes(code)) {
    return false;
  }

  if ([
    'no ffmpeg binary path is configured',
    'ffmpeg is missing at',
    'audio post-processing is unavailable',
    'podcast intro audio was not found at',
    'podcast outro audio was not found at',
    'podcast music bed audio was not found at',
  ].some((pattern) => message.includes(pattern))) {
    return false;
  }

  if (['audio_processing_timeout', 'audio_processing_unavailable'].includes(code)) {
    return true;
  }

  return [
    'timed out',
    'timeout',
    'resource temporarily unavailable',
    'temporarily unavailable',
    'device or resource busy',
    'connection reset',
    'broken pipe',
    'could not be started',
  ].some((pattern) => message.includes(pattern) || code.includes(pattern));
}

function isRetryablePodcastTtsError(error = {}) {
  const message = String(error?.message || '').trim().toLowerCase();
  const code = String(error?.code || '').trim().toLowerCase();
  const statusCode = Number(error?.statusCode || error?.status || 0);

  if (['empty_text', 'tts_unavailable', 'tts_binary_missing'].includes(code)) {
    return false;
  }

  if (statusCode >= 400 && statusCode < 500 && ![408, 429].includes(statusCode)) {
    return false;
  }

  if (['tts_timeout', 'tts_failed', 'tts_empty_audio'].includes(code)) {
    return true;
  }

  if (statusCode >= 500 || statusCode === 408 || statusCode === 429) {
    return true;
  }

  return [
    'timed out',
    'timeout',
    'terminated unexpectedly',
    'failed to generate audio',
    'returned an empty audio file',
    'resource temporarily unavailable',
    'temporarily unavailable',
    'device or resource busy',
    'connection reset',
    'broken pipe',
    'could not be started',
  ].some((pattern) => message.includes(pattern) || code.includes(pattern));
}

function canRetryPodcastTtsWithAnotherVoice(error = {}) {
  const code = String(error?.code || '').trim().toLowerCase();

  if (['empty_text', 'tts_unavailable', 'tts_binary_missing'].includes(code)) {
    return false;
  }

  return true;
}

function getResponseText(response = {}) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const output = Array.isArray(response?.output) ? response.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const chunk of content) {
      const text = chunk?.text || chunk?.output_text || '';
      if (typeof text === 'string' && text.trim()) {
        return text.trim();
      }
    }
  }

  return '';
}

function extractFetchedText(fetchData = {}, maxChars = 2200) {
  const body = sanitizePodcastText(fetchData?.body || '', { preserveNewlines: true });
  if (!body) {
    return '';
  }

  const contentType = String(fetchData?.headers?.['content-type'] || fetchData?.headers?.['Content-Type'] || '').toLowerCase();
  const plain = contentType.includes('html') ? stripHtml(body) : body;
  const normalized = sanitizePodcastText(plain, { preserveNewlines: true }).replace(/\n{2,}/g, '\n');
  return normalized.slice(0, maxChars).trim();
}

function buildTranscript(turns = []) {
  return (Array.isArray(turns) ? turns : [])
    .map((turn) => `${sanitizePodcastText(turn.speaker)}: ${sanitizePodcastText(turn.text)}`)
    .join('\n\n')
    .trim();
}

function normalizeTurn(turn = {}, allowedSpeakers = new Set(), speakerAliases = new Map()) {
  const speaker = sanitizePodcastText(turn?.speaker || '');
  const text = sanitizePodcastText(turn?.text || '', { preserveNewlines: true });
  const resolvedSpeaker = allowedSpeakers.has(speaker)
    ? speaker
    : speakerAliases.get(speaker);
  if (!resolvedSpeaker || !text || !allowedSpeakers.has(resolvedSpeaker)) {
    return null;
  }

  return { speaker: resolvedSpeaker, text };
}

function pickPrimaryHostVoice(voiceIds = [], usedVoiceIds = new Set()) {
  const candidates = uniqueOrdered(
    (Array.isArray(voiceIds) ? voiceIds : [])
      .map((voiceId) => String(voiceId || '').trim())
      .filter(Boolean),
  );

  if (candidates.length === 0) {
    return '';
  }

  const firstUnused = candidates.find((voiceId) => !usedVoiceIds.has(voiceId));
  const selected = firstUnused || candidates[0];
  usedVoiceIds.add(selected);
  return selected;
}

function resolveHostVoiceForTurn(host = {}, turnIndex = 0, cycleHostVoices = true) {
  const voicePool = uniqueOrdered(
    [...(Array.isArray(host?.voiceIds) ? host.voiceIds : []), host?.voiceId]
      .map((voiceId) => String(voiceId || '').trim())
      .filter(Boolean),
  );

  if (!cycleHostVoices || voicePool.length <= 1) {
    return voicePool[0] || '';
  }

  return voicePool[turnIndex % voicePool.length];
}

function resolveTurnVoicePlan(turns = [], hosts = [], options = {}) {
  const cycleHostVoices = options?.cycleHostVoices === true;
  const hostByName = new Map((Array.isArray(hosts) ? hosts : []).map((host) => [host.name, host]));
  const hostTurnCounts = new Map();
  const turnPlans = [];

  for (const turn of Array.isArray(turns) ? turns : []) {
    const host = hostByName.get(turn.speaker);
    if (!host) {
      throw new Error(`No Piper voice is configured for speaker "${turn.speaker}".`);
    }

    const turnIndex = Number(hostTurnCounts.get(turn.speaker) || 0);
    const requestedTurnVoiceId = String(turn?.voiceId || '').trim();
    const voiceId = requestedTurnVoiceId || resolveHostVoiceForTurn(host, turnIndex, cycleHostVoices);
    hostTurnCounts.set(turn.speaker, turnIndex + 1);

    turnPlans.push({
      speaker: turn.speaker,
      text: turn.text,
      voiceId,
      host,
      voiceIds: Array.isArray(host?.voiceIds) ? host.voiceIds.slice() : [],
    });
  }

  return {
    plans: turnPlans,
  };
}

function resolveHosts(params = {}, voiceConfig = {}) {
  const availableVoices = Array.isArray(voiceConfig?.voices) ? voiceConfig.voices : [];
  const usedVoiceIds = new Set();
  const hostTemplates = selectDefaultHostTemplates(params);
  const explicitARequested = Boolean(
    String(params.hostAVoiceId || '').trim() || params.hostAVoiceIds?.length,
  );
  const explicitBRequested = Boolean(
    String(params.hostBVoiceId || '').trim() || params.hostBVoiceIds?.length,
  );

  const hosts = hostTemplates.slice(0, 2).map((defaultHost, index) => {
    const suffix = index === 0 ? 'A' : 'B';
    const providedVoiceId = String(params[`host${suffix}VoiceId`] || '').trim();
    const requestedVoiceIds = normalizeStringList(params[`host${suffix}VoiceIds`]);
    const voiceIds = buildHostVoicePool(
      availableVoices,
      defaultHost.preferredVoiceIds,
      requestedVoiceIds,
      providedVoiceId,
    );

    const configuredVoiceIds = uniqueOrdered([
      ...voiceIds,
      ...(voiceIds.length === 0 ? [
        String(providedVoiceId || '').trim(),
        String(voiceConfig?.defaultVoiceId || '').trim(),
      ] : []),
    ]).filter(Boolean);
    const voiceId = pickPrimaryHostVoice(configuredVoiceIds, usedVoiceIds);

    const fullVoicePool = uniqueOrdered(
      [voiceId, ...configuredVoiceIds]
        .map((id) => String(id || '').trim())
        .filter(Boolean),
    );

    return {
      name: sanitizePodcastText(params[`host${suffix}Name`] || defaultHost.name) || defaultHost.name,
      role: sanitizePodcastText(params[`host${suffix}Role`] || defaultHost.role) || defaultHost.role,
      persona: sanitizePodcastText(params[`host${suffix}Persona`] || defaultHost.persona) || defaultHost.persona,
      voiceIds: fullVoicePool,
      voiceId,
    };
  });

  if (!explicitARequested && !explicitBRequested && hosts.length >= 2) {
    const hostAVoices = hosts[0].voiceIds;
    const hostBVoices = hosts[1].voiceIds;
    if (hostAVoices.length > 1 && hostBVoices.length > 1
      && hostAVoices.join('|') === hostBVoices.join('|')) {
      hosts[1].voiceIds = hostBVoices.slice(1).concat(hostBVoices.slice(0, 1));
    }
  }

  return hosts;
}

function resolvePodcastTtsTimeoutMs(params = {}, voiceConfig = {}) {
  const configuredTimeoutMs = Math.max(
    1000,
    Number(voiceConfig?.podcastTimeoutMs)
      || Number(voiceConfig?.timeoutMs)
      || 45000,
  );

  return clampNumber(params.ttsTimeoutMs, 1000, 15 * 60 * 1000, configuredTimeoutMs);
}

function resolvePodcastChunkMaxChars(params = {}, voiceConfig = {}) {
  const maxTextChars = Math.max(200, Number(voiceConfig?.maxTextChars) || 2400);
  const safeMaxChunkChars = Math.max(250, maxTextChars - 160);
  const configuredChunkChars = clampNumber(
    voiceConfig?.podcastChunkChars,
    250,
    safeMaxChunkChars,
    Math.min(900, safeMaxChunkChars),
  );

  return clampNumber(params.ttsChunkMaxChars, 250, safeMaxChunkChars, configuredChunkChars);
}

function resolvePodcastScriptRequestTimeoutMs(params = {}) {
  return clampNumber(
    params.scriptTimeoutMs,
    30000,
    900000,
    DEFAULT_PODCAST_SCRIPT_REQUEST_TIMEOUT_MS,
  );
}

function resolvePodcastResearchConcurrency(params = {}) {
  return clampNumber(
    params.researchConcurrency,
    1,
    MAX_PODCAST_RESEARCH_CONCURRENCY,
    DEFAULT_PODCAST_RESEARCH_CONCURRENCY,
  );
}

function resolvePodcastTtsConcurrency(params = {}) {
  return clampNumber(
    params.ttsConcurrency,
    1,
    MAX_PODCAST_TTS_CONCURRENCY,
    DEFAULT_PODCAST_TTS_CONCURRENCY,
  );
}

function buildResearchPrompt({
  topic,
  audience,
  tone,
  durationMinutes,
  hosts,
  sources,
  videoFormat = false,
}) {
  const wordBudget = estimateWordBudget(durationMinutes);
  const turnCount = estimateTurnCount(durationMinutes);

  const sourceText = sources.map((source, index) => [
    `Source ${index + 1}: ${sanitizePodcastText(source.title || 'Untitled source')}`,
    `URL: ${sanitizePodcastText(source.url)}`,
    source.snippet ? `Snippet: ${sanitizePodcastText(source.snippet, { preserveNewlines: true })}` : '',
    source.content ? `Excerpt: ${sanitizePodcastText(source.content, { preserveNewlines: true })}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');

  return `
Create a scripted two-host podcast episode as strict JSON.

Topic: ${sanitizePodcastText(topic)}
Audience: ${sanitizePodcastText(audience)}
Tone: ${sanitizePodcastText(tone)}
Target duration minutes: ${durationMinutes}
Approximate total word budget: ${wordBudget}
Target turn count: ${turnCount}

Host 1:
- name: ${sanitizePodcastText(hosts[0].name)}
- role: ${sanitizePodcastText(hosts[0].role)}
- persona: ${sanitizePodcastText(hosts[0].persona)}

Host 2:
- name: ${sanitizePodcastText(hosts[1].name)}
- role: ${sanitizePodcastText(hosts[1].role)}
- persona: ${sanitizePodcastText(hosts[1].persona)}

Use only the sourced information below. Do not invent facts. If a point is uncertain, phrase it carefully.
Write like a real podcast: light rapport, clean transitions, informative explanations, occasional reactions, but no filler overload.
Keep each turn to one paragraph. No stage directions. No markdown. No URLs in spoken text.
Open with a strong hook and end with a concise wrap-up.
${videoFormat ? 'Structure the episode like a YouTube information show: cold open hook, quick setup, evidence beats, why-it-matters sections, and a concrete final takeaway. Keep it conversational, but make each segment feel intentional and paced for viewers.' : ''}
Write for speech delivery, not for reading: use contractions, shorter sentences, and natural hand-offs.
Avoid stacked statistics, semicolons, parenthetical asides, and phrasing that sounds like a report being read aloud.
Spell out or rephrase awkward abbreviations and symbols so Piper can read them smoothly.

Return exactly this JSON shape:
{
  "title": "string",
  "summary": "string",
  "turns": [
    { "speaker": "${hosts[0].name}", "text": "string" },
    { "speaker": "${hosts[1].name}", "text": "string" }
  ]
}

Research:
${sourceText}
  `.trim();
}

class PodcastService {
  constructor(dependencies = {}) {
    this.createResponse = dependencies.createResponse || createResponse;
    this.ttsService = dependencies.ttsService || piperTtsService;
    this.persistGeneratedAudio = dependencies.persistGeneratedAudio || persistGeneratedAudio;
    this.updateGeneratedAudioSessionState = dependencies.updateGeneratedAudioSessionState || updateGeneratedAudioSessionState;
    this.audioProcessingService = dependencies.audioProcessingService || audioProcessingService;
  }

  async retryTransientOperation(operation, {
    label = 'podcast operation',
    retries = DEFAULT_TRANSIENT_RETRY_ATTEMPTS,
    retryDelayMs = DEFAULT_TRANSIENT_RETRY_DELAY_MS,
    shouldRetry = isTransientPodcastError,
  } = {}) {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (typeof shouldRetry !== 'function' || !shouldRetry(error) || attempt >= retries) {
          throw error;
        }

        console.warn(`[PodcastService] Retrying ${label} after transient failure: ${error.message}`);
        await wait(Math.max(0, Number(retryDelayMs) || 0) * (attempt + 1));
      }
    }

    throw lastError || new Error(`${label} failed.`);
  }

  async runTool(executeTool, toolId, params, context) {
    return this.retryTransientOperation(async () => {
      const result = await executeTool(toolId, params, context);
      if (!result?.success) {
        const error = new Error(result?.error || `${toolId} failed.`);
        if (result?.errorCode) {
          error.code = result.errorCode;
        }
        if (Number.isFinite(Number(result?.statusCode))) {
          error.statusCode = Number(result.statusCode);
        }
        throw error;
      }
      return result.data;
    }, {
      label: toolId,
    });
  }

  async researchTopic({
    topic,
    searchDomains = [],
    sourceUrls = [],
    maxSources = DEFAULT_MAX_SOURCES,
    concurrency = DEFAULT_PODCAST_RESEARCH_CONCURRENCY,
  }, context = {}) {
    if (typeof context?.executeTool !== 'function') {
      throw new Error('Podcast research requires tool execution support.');
    }

    const seededSources = (Array.isArray(sourceUrls) ? sourceUrls : [])
      .map((url) => ({
        title: url,
        url: String(url || '').trim(),
        snippet: '',
      }))
      .filter((entry) => entry.url);

    let searchData = null;
    let searchError = null;
    try {
      searchData = await this.runTool(context.executeTool, 'web-search', {
        query: `${topic} explainer key facts overview`,
        engine: 'perplexity',
        researchMode: 'search',
        limit: Math.max(maxSources * 2, 6),
        timeout: DEFAULT_PODCAST_SEARCH_TIMEOUT_MS,
        includeSnippets: true,
        includeUrls: true,
        domains: searchDomains,
        region: 'us-en',
        timeRange: 'all',
      }, context.toolContext);
    } catch (error) {
      searchError = error;
      if (seededSources.length === 0) {
        throw error;
      }
    }

    const candidates = uniqueUrls([
      ...seededSources,
      ...(Array.isArray(searchData?.verifiedPages) ? searchData.verifiedPages : []),
      ...(Array.isArray(searchData?.results) ? searchData.results : []),
      ...(Array.isArray(searchData?.citations) ? searchData.citations : []),
    ]).slice(0, maxSources);

    if (candidates.length === 0) {
      throw searchError || new Error('Podcast research did not return any usable sources.');
    }

    const verifiedSources = (await mapWithConcurrency(candidates, concurrency, async (candidate) => {
      const url = String(candidate?.url || '').trim();
      if (!url) {
        return null;
      }

      try {
        const fetched = await this.runTool(context.executeTool, 'web-fetch', {
          url,
          timeout: 20000,
          cache: true,
        }, context.toolContext);

        return {
          title: String(candidate?.title || url).trim() || url,
          url,
          snippet: String(candidate?.snippet || '').trim(),
          content: extractFetchedText(fetched),
        };
      } catch (_error) {
        return {
          title: String(candidate?.title || url).trim() || url,
          url,
          snippet: String(candidate?.snippet || '').trim(),
          content: '',
        };
      }
    })).filter(Boolean);

    if (verifiedSources.length === 0) {
      if (searchError) {
        throw searchError;
      }
      throw new Error('Podcast research did not return any usable sources.');
    }

    return verifiedSources;
  }

  async generateScript({
    topic,
    audience,
    tone,
    durationMinutes,
    hosts,
    sources,
    models = [],
    reasoningEffort,
    requestTimeoutMs = DEFAULT_PODCAST_SCRIPT_REQUEST_TIMEOUT_MS,
    videoFormat = false,
  }) {
    const modelCandidates = uniqueOrdered(Array.isArray(models) ? models : [models]);
    const prompt = buildResearchPrompt({
      topic,
      audience,
      tone,
      durationMinutes,
      hosts,
      sources,
      videoFormat,
    });
    const allowedSpeakers = new Set(hosts.map((host) => host.name));
    const speakerAliases = new Map([
      ['Maya', hosts[0]?.name],
      ['June', hosts[1]?.name],
      ['Host 1', hosts[0]?.name],
      ['Host 2', hosts[1]?.name],
    ].filter(([, mapped]) => allowedSpeakers.has(mapped)));
    let lastError = null;

    for (const modelCandidate of (modelCandidates.length > 0 ? modelCandidates : [''])) {
      try {
        const response = await this.retryTransientOperation(() => this.createResponse({
          input: prompt,
          instructions: 'You write polished, factual, natural-sounding podcast scripts and must return valid JSON only.',
          stream: false,
          model: modelCandidate || undefined,
          reasoningEffort,
          enableAutomaticToolCalls: false,
          requestTimeoutMs,
          requestMaxRetries: 0,
        }), {
          label: 'podcast script generation',
          retries: DEFAULT_PODCAST_SCRIPT_RETRY_ATTEMPTS,
        });

        const parsed = parseLenientJson(getResponseText(response));
        const turns = (Array.isArray(parsed?.turns) ? parsed.turns : [])
          .map((turn) => normalizeTurn(turn, allowedSpeakers, speakerAliases))
          .filter(Boolean);
        const representedSpeakers = new Set(turns.map((turn) => turn.speaker));

        if (turns.length < DEFAULT_MINIMUM_VALID_TURNS || representedSpeakers.size < allowedSpeakers.size) {
          throw new Error('Podcast script generation returned too few valid turns.');
        }

        return {
          title: String(parsed?.title || `${topic} Podcast`).trim() || `${topic} Podcast`,
          summary: String(parsed?.summary || '').trim(),
          turns,
        };
      } catch (error) {
        lastError = error;
        if (modelCandidate && modelCandidates[modelCandidates.length - 1] !== modelCandidate) {
          console.warn(`[PodcastService] Falling back podcast script generation from model "${modelCandidate}" after: ${error.message}`);
          continue;
        }
        throw error;
      }
    }

    throw lastError || new Error('Podcast script generation failed.');
  }

  async synthesizeChunkBuffer(text = '', host = {}, options = {}, splitDepth = 0) {
    const timeoutMs = Math.max(1000, Number(options.ttsTimeoutMs) || 45000);
    const minimumChunkChars = Math.max(250, Number(options.minimumChunkChars) || 350);
    const maxTextChars = Math.max(
      200,
      Number(options.maxTextChars)
        || Number(this.ttsService?.getPublicConfig?.().maxTextChars)
        || 2400,
    );
    const runSynthesis = typeof options.runSynthesis === 'function'
      ? options.runSynthesis
      : async (task) => task();
    const normalizedText = normalizePodcastTextChunkForSpeech(text, maxTextChars);
    if (!normalizedText) {
      return [];
    }
    const allowVoiceFallback = options.allowVoiceFallback === true;
    const candidateVoices = uniqueOrdered([
      options.voiceId,
      host?.voiceId,
      ...(allowVoiceFallback ? (Array.isArray(options.voiceIds) ? options.voiceIds : []) : []),
      ...(allowVoiceFallback ? (Array.isArray(host?.voiceIds) ? host.voiceIds : []) : []),
    ].filter(Boolean));
    const resolvedHostName = String(host?.name || '').trim() || 'podcast host';
    if (candidateVoices.length === 0) {
      throw new Error(`No Piper voice is configured for speaker "${resolvedHostName}".`);
    }

    const maxVoiceAttempts = Math.max(
      1,
      Math.min(candidateVoices.length, DEFAULT_MAX_VOICE_FALLBACK_ATTEMPTS),
    );
    const preferredVoiceOffset = Math.max(0, Number(options.voiceAttemptOffset) || 0);
    let lastError = null;

    for (let attempt = 0; attempt < maxVoiceAttempts; attempt += 1) {
      const voiceId = candidateVoices[(preferredVoiceOffset + attempt) % candidateVoices.length];
      try {
        const synthesis = await runSynthesis(() => this.ttsService.synthesize({
          text: normalizedText,
          voiceId,
          timeoutMs,
        }));
        return [synthesis];
      } catch (error) {
        lastError = error;
        const hasMoreVoiceFallbacks = attempt < (maxVoiceAttempts - 1);
        if (hasMoreVoiceFallbacks && canRetryPodcastTtsWithAnotherVoice(error)) {
          continue;
        }
        break;
      }
    }

    if (!lastError) {
      throw new Error('Podcast TTS failed before audio generation could start.');
    }

    if (!isRetryablePodcastTtsError(lastError)
      || splitDepth >= MAX_PODCAST_TTS_SPLIT_DEPTH
      || normalizedText.length <= minimumChunkChars) {
      throw lastError;
    }

    const nextChunkSize = Math.max(minimumChunkChars, Math.floor(normalizedText.length / 2));
    if (nextChunkSize >= normalizedText.length) {
      throw lastError;
    }

    const retryChunks = chunkText(normalizedText, nextChunkSize)
      .map((retryChunk) => normalizePodcastTextChunkForSpeech(retryChunk, maxTextChars))
      .filter(Boolean);
    if (retryChunks.length <= 1) {
      throw lastError;
    }

    const fallbackOffset = (preferredVoiceOffset + 1) % candidateVoices.length;
    const nestedSyntheses = await mapWithConcurrency(
      retryChunks,
      retryChunks.length,
      async (retryChunk) => this.synthesizeChunkBuffer(
        retryChunk,
        host,
        {
          ...options,
          voiceAttemptOffset: fallbackOffset,
          voiceIds: candidateVoices,
          allowVoiceFallback,
          maxTextChars,
          minimumChunkChars,
        },
        splitDepth + 1,
      ),
    );

    return nestedSyntheses.flat();
  }

  buildSynthesisSegments(turns = [], hosts = [], options = {}) {
    const maxTextChars = Math.max(200, Number(this.ttsService?.getPublicConfig?.().maxTextChars) || 2400);
    const cycleHostVoices = options?.cycleHostVoices === true;
    const chunkMaxChars = clampNumber(
      options.chunkMaxChars,
      250,
      Math.max(250, maxTextChars - 160),
      Math.min(900, Math.max(250, maxTextChars - 160)),
    );
    const minimumChunkChars = clampNumber(
      options.minimumChunkChars,
      250,
      chunkMaxChars,
      Math.max(350, Math.floor(chunkMaxChars / 2)),
    );
    const hostByName = new Map(hosts.map((host) => [host.name, host]));
    const hostTurnCounts = new Map();
    const segments = [];

    for (const turn of turns) {
      const host = hostByName.get(turn.speaker);
      const turnVoiceId = String(turn?.voiceId || '').trim();
      const turnIndex = Number(hostTurnCounts.get(turn.speaker) || 0);
      const resolvedVoiceId = turnVoiceId
        || resolveHostVoiceForTurn(host, turnIndex, cycleHostVoices)
        || host?.voiceId
        || '';
      hostTurnCounts.set(turn.speaker, turnIndex + 1);

      if (!resolvedVoiceId) {
        throw new Error(`No Piper voice is configured for speaker "${turn.speaker}".`);
      }

      const hostForTurn = {
        ...(host || {}),
        voiceId: resolvedVoiceId,
      };
      const chunks = chunkText(turn.text, chunkMaxChars);
      for (const chunk of chunks) {
        const normalizedChunk = normalizePodcastTextChunkForSpeech(chunk, maxTextChars);
        if (!normalizedChunk) {
          continue;
        }
        segments.push({
          speaker: turn.speaker,
          text: normalizedChunk,
          host: hostForTurn,
          voiceId: resolvedVoiceId,
          voiceIds: Array.isArray(hostForTurn.voiceIds) ? hostForTurn.voiceIds : [],
          minimumChunkChars,
        });
      }
    }

    return segments;
  }

  async synthesizeTurns(turns = [], hosts = [], options = {}) {
    const silenceMs = clampNumber(options.silenceMs, 100, 1200, DEFAULT_SILENCE_MS);
    const ttsConcurrency = clampNumber(
      options.ttsConcurrency,
      1,
      MAX_PODCAST_TTS_CONCURRENCY,
      DEFAULT_PODCAST_TTS_CONCURRENCY,
    );
    const synthesisSegments = this.buildSynthesisSegments(turns, hosts, options);
    const limiter = createConcurrencyLimiter(ttsConcurrency);
    const synthesizedSegments = await mapWithConcurrency(
      synthesisSegments,
      ttsConcurrency,
      async (segment) => this.synthesizeChunkBuffer(segment.text, segment.host, {
        voiceId: segment.voiceId,
        voiceIds: segment.voiceIds,
        ttsTimeoutMs: options.ttsTimeoutMs,
        allowVoiceFallback: options.allowVoiceFallback === true,
        maxTextChars: Number(this.ttsService?.getPublicConfig?.().maxTextChars) || 2400,
        minimumChunkChars: segment.minimumChunkChars,
        runSynthesis: (task) => limiter.run(task),
      }),
    );

    const orderedSyntheses = synthesizedSegments.flat();
    if (orderedSyntheses.length === 0) {
      throw new Error('Podcast script did not produce any speakable audio.');
    }

    let outputFormat = null;
    const wavBuffers = [];
    for (const synthesis of orderedSyntheses) {
      const parsedSynthesisBuffer = parseWavBuffer(synthesis.audioBuffer);
      if (!outputFormat) {
        outputFormat = parsedSynthesisBuffer;
      }

      const normalizedAudioBuffer = wavFormatsMatch(parsedSynthesisBuffer, outputFormat)
        ? synthesis.audioBuffer
        : normalizeWavBufferFormat(synthesis.audioBuffer, outputFormat);

      wavBuffers.push(normalizedAudioBuffer);
      wavBuffers.push(createSilenceWavBuffer(outputFormat, silenceMs));
    }

    while (wavBuffers.length > 0) {
      const lastBuffer = wavBuffers[wavBuffers.length - 1];
      try {
        const parsed = parseWavBuffer(lastBuffer);
        if (parsed.data.every((value) => value === 0)) {
          wavBuffers.pop();
          continue;
        }
      } catch (_error) {
        break;
      }
      break;
    }

    return concatWavBuffers(wavBuffers);
  }

  async createPodcast(params = {}, context = {}) {
    const sessionId = String(context?.sessionId || '').trim();
    if (!sessionId) {
      throw new Error('podcast requires an active session so the audio can be saved.');
    }

    const topic = String(params.topic || params.prompt || params.subject || '').trim();
    const normalizedTopic = sanitizePodcastText(topic);
    if (!normalizedTopic) {
      throw new Error('podcast requires a topic, prompt, or subject.');
    }

    const durationMinutes = clampNumber(params.durationMinutes, 3, 30, DEFAULT_DURATION_MINUTES);
    const audience = sanitizePodcastText(params.audience || 'general') || 'general';
    const tone = sanitizePodcastText(params.tone || 'informative, conversational') || 'informative, conversational';
    const maxSources = clampNumber(params.maxSources, 2, 6, DEFAULT_MAX_SOURCES);
    const voiceConfig = this.ttsService.getPublicConfig();
    const hosts = resolveHosts(params, voiceConfig);
    const podcastTtsTimeoutMs = resolvePodcastTtsTimeoutMs(params, voiceConfig);
    const podcastChunkMaxChars = resolvePodcastChunkMaxChars(params, voiceConfig);
    const podcastScriptRequestTimeoutMs = resolvePodcastScriptRequestTimeoutMs(params);
    const podcastResearchConcurrency = resolvePodcastResearchConcurrency(params);
    const podcastTtsConcurrency = resolvePodcastTtsConcurrency(params);
    const executeTool = typeof context?.toolManager?.executeTool === 'function'
      ? context.toolManager.executeTool.bind(context.toolManager)
      : null;
    const sources = await this.researchTopic({
      topic: normalizedTopic,
      searchDomains: params.searchDomains || params.domains || [],
      sourceUrls: params.sourceUrls || params.urls || [],
      maxSources,
      concurrency: podcastResearchConcurrency,
    }, {
      executeTool,
      toolContext: context,
    });

    const script = await this.generateScript({
      topic: normalizedTopic,
      audience,
      tone,
      durationMinutes,
      hosts,
      sources,
      models: resolvePodcastScriptModelCandidates(params, context),
      reasoningEffort: params.reasoningEffort || context.reasoningEffort || undefined,
      requestTimeoutMs: podcastScriptRequestTimeoutMs,
      videoFormat: params.includeVideo === true,
    });
    const turnVoicePlan = resolveTurnVoicePlan(script.turns, hosts, {
      cycleHostVoices: params.cycleHostVoices === true,
    });
    const transcript = buildTranscript(script.turns);
    const wantsMp3 = prefersMp3(params);
    const wantsMixing = requestedMixing(params);
    const audioProcessingConfig = this.audioProcessingService?.getPublicConfig?.() || null;
    const wantsEnhancement = params.enhanceSpeech === true && audioProcessingConfig?.configured === true;

    // Validate TTS compatibility before starting the full run.
    script.turns.forEach((turn) => {
      normalizeTextForSpeech(turn.text, Math.max(200, Number(voiceConfig.maxTextChars) || 2400));
    });

    const cycleHostVoices = params.cycleHostVoices === true;
    const allowVoiceFallback = params.allowVoiceFallback !== false;
    const speechWavBuffer = await this.synthesizeTurns(
      turnVoicePlan.plans,
      hosts,
      {
        silenceMs: clampNumber(params.pauseMs, 100, 1200, DEFAULT_SILENCE_MS),
        ttsTimeoutMs: podcastTtsTimeoutMs,
        chunkMaxChars: podcastChunkMaxChars,
        ttsConcurrency: podcastTtsConcurrency,
        cycleHostVoices,
        allowVoiceFallback,
      },
    );
    const finalAudioBuffer = (wantsMixing || wantsEnhancement)
      ? await this.retryTransientOperation(
        () => this.audioProcessingService.composePodcastAudio({
          speechWavBuffer,
          includeIntro: params.includeIntro === true,
          includeOutro: params.includeOutro === true,
          includeMusicBed: params.includeMusicBed === true || params.includeVideo === true,
          enhanceSpeech: wantsEnhancement,
          introPath: params.introPath || '',
          outroPath: params.outroPath || '',
          musicBedPath: params.musicBedPath || '',
          speechVolume: params.speechVolume,
          musicVolume: params.musicVolume,
          introVolume: params.introVolume,
          outroVolume: params.outroVolume,
        }),
        {
          label: 'podcast audio post-processing',
          retries: DEFAULT_AUDIO_PROCESSING_RETRY_ATTEMPTS,
          retryDelayMs: 900,
          shouldRetry: isRetryablePodcastAudioError,
        },
      )
      : speechWavBuffer;
    const episodeTitle = sanitizePodcastText(params.title || script.title || `${normalizedTopic} Podcast`);
    const persistedArtifacts = [];
    const audioVariants = [];

    const persistedWav = await this.persistGeneratedAudio({
      sessionId,
      sourceMode: String(context?.clientSurface || context?.taskType || 'chat').trim() || 'chat',
      text: transcript,
      title: episodeTitle,
      filename: normalizeVariantFilename(params.filename || '', 'wav'),
      provider: 'piper',
      voice: {
        provider: 'piper',
        episodeVoices: hosts.map((host) => ({
          speaker: host.name,
          voiceId: host.voiceId,
        })),
      },
      audioBuffer: finalAudioBuffer,
      mimeType: 'audio/wav',
      metadata: {
        createdByAgentTool: true,
        generatedBy: 'podcast',
        topic: normalizedTopic,
        durationMinutes,
        audience,
        tone,
        turnVoices: turnVoicePlan.plans.map((turn) => ({
          speaker: turn.speaker,
          voiceId: turn.voiceId,
        })),
        hosts,
        sources,
        summary: script.summary,
        turnCount: script.turns.length,
        processing: {
          mixed: wantsMixing,
          enhanced: wantsEnhancement,
          mp3Exported: wantsMp3,
          allowVoiceFallback,
          scriptRequestTimeoutMs: podcastScriptRequestTimeoutMs,
          researchConcurrency: podcastResearchConcurrency,
          ttsConcurrency: podcastTtsConcurrency,
          ttsTimeoutMs: podcastTtsTimeoutMs,
          ttsChunkMaxChars: podcastChunkMaxChars,
        },
      },
    });
    if (persistedWav.artifact) {
      persistedArtifacts.push(persistedWav.artifact);
    }
    if (persistedWav.audio) {
      audioVariants.push({
        format: 'wav',
        ...persistedWav.audio,
      });
    }

    let persistedMp3 = null;
    if (wantsMp3) {
      const mp3Buffer = await this.retryTransientOperation(
        () => this.audioProcessingService.transcodeWavToMp3({
          wavBuffer: finalAudioBuffer,
          bitrateKbps: params.mp3BitrateKbps,
        }),
        {
          label: 'podcast mp3 export',
          retries: DEFAULT_AUDIO_PROCESSING_RETRY_ATTEMPTS,
          retryDelayMs: 900,
          shouldRetry: isRetryablePodcastAudioError,
        },
      );
      persistedMp3 = await this.persistGeneratedAudio({
        sessionId,
        sourceMode: String(context?.clientSurface || context?.taskType || 'chat').trim() || 'chat',
        text: transcript,
        title: episodeTitle,
        filename: normalizeVariantFilename(params.filename || '', 'mp3'),
        provider: 'ffmpeg',
        voice: {
          provider: 'ffmpeg',
          episodeVoices: hosts.map((host) => ({
            speaker: host.name,
            voiceId: host.voiceId,
          })),
        },
        audioBuffer: mp3Buffer,
        mimeType: 'audio/mpeg',
        metadata: {
          createdByAgentTool: true,
          generatedBy: 'podcast',
          topic: normalizedTopic,
          durationMinutes,
          audience,
          tone,
          turnVoices: turnVoicePlan.plans.map((turn) => ({
            speaker: turn.speaker,
            voiceId: turn.voiceId,
          })),
          hosts,
          sources,
          summary: script.summary,
          turnCount: script.turns.length,
          processing: {
            mixed: wantsMixing,
            enhanced: wantsEnhancement,
            mp3Exported: true,
            allowVoiceFallback,
            researchConcurrency: podcastResearchConcurrency,
            ttsConcurrency: podcastTtsConcurrency,
            ttsTimeoutMs: podcastTtsTimeoutMs,
            ttsChunkMaxChars: podcastChunkMaxChars,
          },
        },
      });
      if (persistedMp3.artifact) {
        persistedArtifacts.push(persistedMp3.artifact);
      }
      if (persistedMp3.audio) {
        audioVariants.push({
          format: 'mp3',
          ...persistedMp3.audio,
        });
      }
    }

    if (persistedArtifacts.length > 0) {
      await this.updateGeneratedAudioSessionState(sessionId, persistedArtifacts);
    }
    const primaryAudio = persistedMp3?.audio || persistedWav.audio || null;
    const primaryArtifact = persistedMp3?.artifact || persistedWav.artifact || null;

    return {
      title: sanitizePodcastText(script.title),
      summary: script.summary,
      durationMinutes,
      estimatedWordCount: transcript.split(/\s+/).filter(Boolean).length,
      hosts,
      sources,
      script: {
        title: script.title,
        summary: script.summary,
        turns: script.turns,
        transcript,
      },
      processing: {
        mixed: wantsMixing,
        enhanced: wantsEnhancement,
        mp3Exported: wantsMp3,
        allowVoiceFallback,
        researchConcurrency: podcastResearchConcurrency,
        ttsConcurrency: podcastTtsConcurrency,
        ttsTimeoutMs: podcastTtsTimeoutMs,
        ttsChunkMaxChars: podcastChunkMaxChars,
        audioProcessing: audioProcessingConfig,
      },
      artifact: primaryArtifact,
      artifacts: persistedArtifacts,
      artifactIds: persistedArtifacts.map((artifact) => artifact.id).filter(Boolean),
      audio: primaryAudio,
      audioVariants,
    };
  }
}

const podcastService = new PodcastService();

module.exports = {
  PodcastService,
  podcastService,
};
