const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { config } = require('../config');
const { createResponse, generateImageBatch } = require('../openai-client');
const { parseLenientJson } = require('../utils/lenient-json');
const { normalizeWhitespace, stripNullCharacters } = require('../utils/text');
const { transcriptionService } = require('../audio/transcription-service');
const { audioProcessingService } = require('../audio/audio-processing-service');
const { parseWavBuffer } = require('../audio/wav-utils');
const { artifactService } = require('../artifacts/artifact-service');
const { artifactStore } = require('../artifacts/artifact-store');
const {
  getLocalGeneratedAudioArtifact,
  isLocalGeneratedAudioArtifactId,
} = require('../generated-audio-artifacts');
const {
  buildArtifactDownloadPath,
  buildArtifactInlinePath,
  toAbsoluteInternalUrl,
} = require('../generated-image-artifacts');
const {
  normalizeGeneratedVideoRecord,
  persistGeneratedVideoLocally,
  updateGeneratedVideoSessionState,
} = require('../generated-video-artifacts');
const {
  isConfigured: isUnsplashConfigured,
  searchImages,
} = require('../unsplash-client');

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_FPS = 30;
const DEFAULT_SCENE_SECONDS = 8;
const MIN_SCENE_SECONDS = 4;
const MAX_SCENES = 36;
const DEFAULT_SEGMENT_TIMEOUT_MS = 240000;
const DEFAULT_MUX_TIMEOUT_MS = 900000;
const DEFAULT_MAX_FFMPEG_TIMEOUT_MS = 1800000;
const DEFAULT_X264_PRESET = 'veryfast';
const DEFAULT_X264_CRF = 23;
const X264_PRESETS = new Set([
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow',
]);

function createServiceError(statusCode, message, code = 'podcast_video_error') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function sanitizeText(value = '') {
  return normalizeWhitespace(stripNullCharacters(String(value || ''))).trim();
}

function slugify(value = '', fallback = 'podcast-video') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56) || fallback;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, numeric));
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.floor(numeric);
}

function resolvePodcastVideoRuntimeOptions(options = {}) {
  const configured = config.podcastVideo || {};
  const maxFfmpegTimeoutMs = normalizePositiveInteger(
    options.maxFfmpegTimeoutMs,
    normalizePositiveInteger(configured.maxFfmpegTimeoutMs, DEFAULT_MAX_FFMPEG_TIMEOUT_MS),
  );
  const sharedTimeoutMs = normalizePositiveInteger(options.ffmpegTimeoutMs || options.timeoutMs, null);
  const segmentTimeoutMs = normalizePositiveInteger(
    options.segmentTimeoutMs,
    sharedTimeoutMs || normalizePositiveInteger(configured.segmentTimeoutMs, DEFAULT_SEGMENT_TIMEOUT_MS),
  );
  const muxTimeoutMs = normalizePositiveInteger(
    options.muxTimeoutMs,
    sharedTimeoutMs || normalizePositiveInteger(configured.muxTimeoutMs, DEFAULT_MUX_TIMEOUT_MS),
  );
  const configuredPreset = String(configured.x264Preset || DEFAULT_X264_PRESET).trim().toLowerCase();
  const requestedPreset = String(options.x264Preset || '').trim().toLowerCase();
  const x264Preset = X264_PRESETS.has(requestedPreset)
    ? requestedPreset
    : X264_PRESETS.has(configuredPreset)
      ? configuredPreset
      : DEFAULT_X264_PRESET;
  const x264Crf = clampNumber(options.x264Crf ?? configured.x264Crf, 18, 32, DEFAULT_X264_CRF);

  return {
    maxFfmpegTimeoutMs,
    segmentTimeoutMs: Math.min(maxFfmpegTimeoutMs, segmentTimeoutMs),
    muxTimeoutMs: Math.min(maxFfmpegTimeoutMs, muxTimeoutMs),
    x264Preset,
    x264Crf,
  };
}

function resolveAdaptiveFfmpegTimeoutMs(baseTimeoutMs, durationSeconds, {
  fixedMs = 60000,
  perSecondMs = 1000,
  maxTimeoutMs = DEFAULT_MAX_FFMPEG_TIMEOUT_MS,
} = {}) {
  const durationMs = Math.max(0, Number(durationSeconds) || 0) * Math.max(0, perSecondMs);
  const adaptiveTimeoutMs = Math.ceil(Math.max(0, fixedMs) + durationMs);
  return Math.min(
    normalizePositiveInteger(maxTimeoutMs, DEFAULT_MAX_FFMPEG_TIMEOUT_MS),
    Math.max(normalizePositiveInteger(baseTimeoutMs, 1000), adaptiveTimeoutMs),
  );
}

function uniqueOrdered(items = []) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || '').trim())
    .filter((item) => {
      if (!item || seen.has(item)) {
        return false;
      }
      seen.add(item);
      return true;
    });
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

function splitTranscriptSegments(transcript = '') {
  const normalized = sanitizeText(transcript);
  if (!normalized) {
    return [];
  }

  const sentenceSegments = normalized
    .split(/(?<=[.!?])\s+/)
    .map((segment) => sanitizeText(segment))
    .filter(Boolean);

  if (sentenceSegments.length > 0) {
    return sentenceSegments;
  }

  return normalized
    .split(/\n+/)
    .map((segment) => sanitizeText(segment))
    .filter(Boolean);
}

function wordCount(value = '') {
  return sanitizeText(value).split(/\s+/).filter(Boolean).length;
}

function normalizeAspectRatio(aspectRatio = '16:9') {
  const normalized = String(aspectRatio || '').trim();
  if (normalized === '9:16') {
    return { aspectRatio: '9:16', width: 1080, height: 1920, orientation: 'portrait' };
  }
  if (normalized === '1:1') {
    return { aspectRatio: '1:1', width: 1080, height: 1080, orientation: 'squarish' };
  }
  return { aspectRatio: '16:9', width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, orientation: 'landscape' };
}

function normalizeImageMode(value = 'mixed') {
  const normalized = String(value || 'mixed').trim().toLowerCase();
  if (['provided', 'web', 'unsplash', 'generated', 'mixed', 'fallback'].includes(normalized)) {
    return normalized;
  }
  return 'mixed';
}

function normalizeScene(scene = {}, index = 0) {
  const start = Math.max(0, Number(scene.start ?? scene.startSeconds ?? 0) || 0);
  const end = Math.max(start + MIN_SCENE_SECONDS, Number(scene.end ?? scene.endSeconds ?? (start + DEFAULT_SCENE_SECONDS)) || (start + DEFAULT_SCENE_SECONDS));
  const summary = sanitizeText(scene.summary || scene.title || scene.caption || `Scene ${index + 1}`);
  const narration = sanitizeText(scene.narration || scene.text || scene.caption || summary);
  const visualQuery = sanitizeText(scene.visualQuery || scene.query || summary);
  const visualPrompt = sanitizeText(scene.visualPrompt || scene.prompt || visualQuery || summary);

  return {
    id: scene.id || `scene-${String(index + 1).padStart(2, '0')}`,
    index,
    start,
    end,
    duration: Math.max(MIN_SCENE_SECONDS, end - start),
    summary,
    narration,
    caption: sanitizeText(scene.caption || narration || summary).slice(0, 180),
    visualQuery,
    visualPrompt,
    imageUrl: String(scene.imageUrl || scene.image_url || '').trim() || null,
    imageSource: String(scene.imageSource || scene.image_source || '').trim() || null,
    attribution: scene.attribution || null,
  };
}

function buildFallbackStoryboard({ title = '', transcript = '', turns = [], durationSeconds = 0, sceneCount = 0 } = {}) {
  const normalizedTurns = (Array.isArray(turns) ? turns : [])
    .map((turn) => ({
      speaker: sanitizeText(turn?.speaker || ''),
      text: sanitizeText(turn?.text || ''),
    }))
    .filter((turn) => turn.text);
  const segments = normalizedTurns.length > 0
    ? normalizedTurns.map((turn) => `${turn.speaker ? `${turn.speaker}: ` : ''}${turn.text}`)
    : splitTranscriptSegments(transcript);
  const totalWords = Math.max(1, segments.reduce((sum, segment) => sum + wordCount(segment), 0));
  const desiredSceneCount = clampNumber(
    sceneCount,
    1,
    MAX_SCENES,
    Math.max(1, Math.min(MAX_SCENES, Math.ceil((durationSeconds || segments.length * DEFAULT_SCENE_SECONDS) / DEFAULT_SCENE_SECONDS))),
  );
  const grouped = [];

  if (segments.length > 0 && segments.length <= desiredSceneCount) {
    const words = segments.join(' ').split(/\s+/).filter(Boolean);
    const wordsPerScene = Math.max(1, Math.ceil(words.length / desiredSceneCount));
    for (let index = 0; index < desiredSceneCount; index += 1) {
      const chunk = words.slice(index * wordsPerScene, (index + 1) * wordsPerScene).join(' ');
      if (chunk) {
        grouped.push([chunk]);
      }
    }
  } else {
    let assignedWords = 0;
    for (const segment of segments) {
      const targetIndex = Math.min(
        desiredSceneCount - 1,
        Math.floor((assignedWords / totalWords) * desiredSceneCount),
      );
      if (!grouped[targetIndex]) {
        grouped[targetIndex] = [];
      }
      grouped[targetIndex].push(segment);
      assignedWords += wordCount(segment);
    }
  }

  const compactGroups = grouped.filter((group) => Array.isArray(group) && group.length > 0);
  if (compactGroups.length === 0) {
    compactGroups.push([sanitizeText(title) || 'Podcast episode']);
  }

  const resolvedDuration = Math.max(
    compactGroups.length * MIN_SCENE_SECONDS,
    Number(durationSeconds) || (compactGroups.length * DEFAULT_SCENE_SECONDS),
  );
  let cursor = 0;

  return compactGroups.map((group, index) => {
    const narration = group.join(' ');
    const groupWords = Math.max(1, wordCount(narration));
    const remainingGroups = compactGroups.length - index;
    const proportionalDuration = index === compactGroups.length - 1
      ? Math.max(MIN_SCENE_SECONDS, resolvedDuration - cursor)
      : Math.max(MIN_SCENE_SECONDS, (groupWords / totalWords) * resolvedDuration);
    const boundedDuration = index === compactGroups.length - 1
      ? proportionalDuration
      : Math.min(
        Math.max(MIN_SCENE_SECONDS, proportionalDuration),
        Math.max(MIN_SCENE_SECONDS, resolvedDuration - cursor - ((remainingGroups - 1) * MIN_SCENE_SECONDS)),
      );
    const start = cursor;
    const end = Math.min(resolvedDuration, start + boundedDuration);
    cursor = end;

    const words = narration.split(/\s+/).filter(Boolean);
    const summary = words.slice(0, 14).join(' ');
    return normalizeScene({
      start,
      end,
      summary: summary || `${sanitizeText(title) || 'Podcast'} scene ${index + 1}`,
      narration,
      caption: words.slice(0, 22).join(' '),
      visualQuery: summary || sanitizeText(title),
      visualPrompt: [
        'Editorial podcast visual, cinematic still frame, realistic image, no text.',
        `Topic: ${sanitizeText(title) || 'Podcast episode'}.`,
        `Moment: ${summary || narration.slice(0, 120)}.`,
      ].join(' '),
    }, index);
  });
}

function buildStoryboardPrompt({
  title = '',
  transcript = '',
  turns = [],
  durationSeconds = 0,
  sceneCount = 0,
  visualStyle = '',
} = {}) {
  const targetSceneCount = clampNumber(
    sceneCount,
    1,
    MAX_SCENES,
    Math.max(4, Math.min(MAX_SCENES, Math.ceil((durationSeconds || 60) / DEFAULT_SCENE_SECONDS))),
  );
  const turnTranscript = (Array.isArray(turns) ? turns : [])
    .map((turn) => `${sanitizeText(turn?.speaker)}: ${sanitizeText(turn?.text)}`)
    .filter((line) => line.replace(/^:\s*/, '').trim())
    .join('\n');

  return [
    'Create a timestamped visual storyboard for a podcast video.',
    `Title: ${sanitizeText(title) || 'Podcast episode'}`,
    `Duration seconds: ${Math.max(0, Number(durationSeconds) || 0) || 'unknown'}`,
    `Target scenes: ${targetSceneCount}`,
    `Visual style: ${sanitizeText(visualStyle) || 'editorial documentary, polished, realistic, minimal on-screen text'}`,
    '',
    'Return valid JSON only with this shape:',
    '{"scenes":[{"start":0,"end":8,"summary":"...","caption":"...","visualQuery":"...","visualPrompt":"..."}]}',
    '',
    'Rules:',
    '- Scene times must cover the whole episode in order without overlaps.',
    '- visualQuery should be short and useful for Unsplash search.',
    '- visualPrompt should be specific enough for image generation and must request no text in the image.',
    '- Captions should be concise excerpts aligned to the audio segment.',
    '',
    'Transcript:',
    (turnTranscript || sanitizeText(transcript)).slice(0, 18000),
  ].join('\n');
}

function decodeDataUrl(value = '') {
  const match = String(value || '').trim().match(/^data:([a-z0-9.+/-]+);base64,([a-z0-9+/=]+)$/i);
  if (!match) {
    return null;
  }

  const mimeType = match[1].toLowerCase();
  const extension = mimeType.includes('jpeg') ? 'jpg' : (mimeType.split('/')[1] || 'png').replace(/[^a-z0-9]+/g, '');
  return {
    buffer: Buffer.from(match[2], 'base64'),
    mimeType,
    extension: extension || 'png',
  };
}

function inferImageExtension(contentType = '', url = '') {
  const normalizedType = String(contentType || '').toLowerCase();
  const normalizedUrl = String(url || '').toLowerCase();
  if (normalizedType.includes('jpeg') || /\.jpe?g(?:[?#]|$)/.test(normalizedUrl)) return 'jpg';
  if (normalizedType.includes('webp') || /\.webp(?:[?#]|$)/.test(normalizedUrl)) return 'webp';
  if (normalizedType.includes('gif') || /\.gif(?:[?#]|$)/.test(normalizedUrl)) return 'gif';
  if (normalizedType.includes('svg') || /\.svg(?:[?#]|$)/.test(normalizedUrl)) return 'svg';
  return 'png';
}

function isLikelyImageUrl(url = '') {
  const normalized = String(url || '').trim();
  return /^https?:\/\//i.test(normalized)
    && /\.(?:png|jpe?g|webp|gif)(?:[?#].*)?$/i.test(normalized);
}

function resolveUrl(candidate = '', baseUrl = '') {
  const raw = String(candidate || '').trim();
  if (!raw) {
    return '';
  }

  try {
    return new URL(raw, baseUrl || undefined).toString();
  } catch (_error) {
    return '';
  }
}

function extractImageUrlsFromHtml(html = '', baseUrl = '') {
  const urls = [];
  const seen = new Set();
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/gi,
    /<img[^>]+src=["']([^"']+)["'][^>]*>/gi,
    /<source[^>]+srcset=["']([^"']+)["'][^>]*>/gi,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(html);
    while (match) {
      const rawValue = String(match[1] || '').split(',')[0].trim().split(/\s+/)[0];
      const resolved = resolveUrl(rawValue, baseUrl);
      if (resolved && !seen.has(resolved) && isLikelyImageUrl(resolved)) {
        seen.add(resolved);
        urls.push(resolved);
      }
      match = pattern.exec(html);
    }
  }

  return urls;
}

function buildPlaceholderFrameBuffer(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, seed = '') {
  const hash = Buffer.from(String(seed || 'podcast-video'));
  const r1 = 32 + (hash[0] || 0) % 90;
  const g1 = 42 + (hash[1] || 0) % 90;
  const b1 = 60 + (hash[2] || 0) % 110;
  const r2 = 120 + (hash[3] || 0) % 90;
  const g2 = 80 + (hash[4] || 0) % 100;
  const b2 = 70 + (hash[5] || 0) % 120;
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`, 'ascii');
  const pixels = Buffer.alloc(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = ((x / Math.max(1, width - 1)) * 0.65) + ((y / Math.max(1, height - 1)) * 0.35);
      const offset = (y * width + x) * 3;
      pixels[offset] = Math.round(r1 + (r2 - r1) * t);
      pixels[offset + 1] = Math.round(g1 + (g2 - g1) * t);
      pixels[offset + 2] = Math.round(b1 + (b2 - b1) * t);
    }
  }

  return Buffer.concat([header, pixels]);
}

function escapeConcatPath(filePath = '') {
  return String(filePath || '').replace(/\\/g, '/').replace(/'/g, "'\\''");
}

class PodcastVideoService {
  constructor(dependencies = {}) {
    this.createResponse = dependencies.createResponse || createResponse;
    this.generateImageBatch = dependencies.generateImageBatch || generateImageBatch;
    this.transcriptionService = dependencies.transcriptionService || transcriptionService;
    this.audioProcessingService = dependencies.audioProcessingService || audioProcessingService;
    this.artifactService = dependencies.artifactService || artifactService;
    this.artifactStore = dependencies.artifactStore || artifactStore;
    this.searchImages = dependencies.searchImages || searchImages;
    this.isUnsplashConfigured = dependencies.isUnsplashConfigured || isUnsplashConfigured;
    this.spawn = dependencies.spawn || spawn;
    this.spawnSync = dependencies.spawnSync || spawnSync;
  }

  getEffectiveFfmpegPath() {
    if (typeof this.audioProcessingService?.getEffectiveBinaryPath === 'function') {
      return this.audioProcessingService.getEffectiveBinaryPath();
    }
    return config.audioProcessing?.ffmpegBinaryPath || 'ffmpeg';
  }

  getPublicConfig() {
    const diagnostics = this.audioProcessingService?.getPublicConfig?.() || {};
    const ffmpegReady = diagnostics?.configured === true;
    const runtime = resolvePodcastVideoRuntimeOptions();
    return {
      configured: ffmpegReady,
      provider: 'ffmpeg',
      supportsMp4: ffmpegReady,
      supportsUnsplash: this.isUnsplashConfigured(),
      supportsGeneratedImages: Boolean(config.openai?.apiKey || config.media?.apiKey),
      defaults: {
        aspectRatio: '16:9',
        fps: DEFAULT_FPS,
        sceneSeconds: DEFAULT_SCENE_SECONDS,
        maxScenes: MAX_SCENES,
      },
      timeouts: {
        segmentMs: runtime.segmentTimeoutMs,
        muxMs: runtime.muxTimeoutMs,
        maxFfmpegMs: runtime.maxFfmpegTimeoutMs,
      },
      encoder: {
        videoCodec: 'libx264',
        preset: runtime.x264Preset,
        crf: runtime.x264Crf,
      },
      diagnostics: diagnostics?.diagnostics || diagnostics,
    };
  }

  assertFfmpegReady() {
    if (typeof this.audioProcessingService?.assertConfigured === 'function') {
      this.audioProcessingService.assertConfigured();
      return;
    }

    const result = this.spawnSync(this.getEffectiveFfmpegPath(), ['-version'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    if (result?.error || result?.status !== 0) {
      throw createServiceError(503, result?.error?.message || 'ffmpeg is not reachable.', 'video_processing_unavailable');
    }
  }

  async runFfmpeg(args = [], options = {}) {
    this.assertFfmpegReady();
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || Number(config.audioProcessing?.timeoutMs) || 120000);
    const binaryPath = this.getEffectiveFfmpegPath();
    const stage = sanitizeText(options.stage || 'rendering podcast video') || 'rendering podcast video';

    return new Promise((resolve, reject) => {
      const stderr = [];
      const stdout = [];
      let settled = false;
      const rejectOnce = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      };
      const resolveOnce = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };
      const child = this.spawn(binaryPath, args, {
        windowsHide: true,
      });
      const timeout = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (_error) {
          // The process may have exited between the timer firing and kill.
        }
        rejectOnce(createServiceError(
          504,
          `ffmpeg timed out while rendering podcast video (${stage}, ${timeoutMs}ms).`,
          'video_processing_timeout',
        ));
      }, timeoutMs);

      child.stdout?.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
      child.stderr?.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
      child.on('error', (error) => {
        clearTimeout(timeout);
        rejectOnce(createServiceError(503, error.message || 'ffmpeg could not be started.', 'video_processing_unavailable'));
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolveOnce({
            stdout: Buffer.concat(stdout).toString('utf8'),
            stderr: Buffer.concat(stderr).toString('utf8'),
          });
          return;
        }

        rejectOnce(createServiceError(
          502,
          `ffmpeg failed to render podcast video. ${Buffer.concat(stderr).toString('utf8').trim()}`.trim(),
          'video_processing_failed',
        ));
      });
    });
  }

  async readAudioArtifact(artifactId = '') {
    const normalizedId = String(artifactId || '').trim();
    if (!normalizedId) {
      throw createServiceError(400, 'An audioArtifactId is required.', 'audio_artifact_required');
    }

    if (isLocalGeneratedAudioArtifactId(normalizedId)) {
      const localArtifact = await getLocalGeneratedAudioArtifact(normalizedId, { includeContent: true });
      if (!localArtifact?.contentBuffer?.length) {
        throw createServiceError(404, 'Audio artifact not found.', 'audio_artifact_not_found');
      }
      return localArtifact;
    }

    const artifact = await this.artifactStore.get(normalizedId, { includeContent: true });
    if (!artifact?.contentBuffer?.length) {
      throw createServiceError(404, 'Audio artifact not found.', 'audio_artifact_not_found');
    }

    return artifact;
  }

  getAudioDurationFromWavBuffer(audioBuffer) {
    try {
      const parsed = parseWavBuffer(audioBuffer);
      const bytesPerSampleFrame = (parsed.bitsPerSample / 8) * parsed.numChannels;
      if (!bytesPerSampleFrame || !parsed.sampleRate) {
        return 0;
      }
      return parsed.data.length / bytesPerSampleFrame / parsed.sampleRate;
    } catch (_error) {
      return 0;
    }
  }

  async getAudioDurationSeconds(audioBuffer, mimeType = 'audio/wav') {
    const wavDuration = this.getAudioDurationFromWavBuffer(audioBuffer);
    if (wavDuration > 0) {
      return wavDuration;
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kimibuilt-audio-duration-'));
    const extension = String(mimeType || '').toLowerCase().includes('mpeg') ? 'mp3' : 'audio';
    const inputPath = path.join(tempDir, `input.${extension}`);

    try {
      await fs.writeFile(inputPath, audioBuffer);
      const result = await this.runFfmpeg(['-i', inputPath, '-f', 'null', '-'], {
        timeoutMs: 30000,
      }).catch((error) => {
        const stderr = String(error?.message || '');
        const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
        if (!match) {
          throw error;
        }
        return { stderr };
      });
      const match = String(result?.stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
      if (!match) {
        return 0;
      }
      return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  async planStoryboard(params = {}) {
    const title = sanitizeText(params.title || params.topic || 'Podcast video');
    const transcript = sanitizeText(params.transcript || params.script?.transcript || '');
    const turns = Array.isArray(params.turns)
      ? params.turns
      : Array.isArray(params.script?.turns)
        ? params.script.turns
        : [];
    const durationSeconds = Math.max(0, Number(params.durationSeconds || params.duration_seconds || 0) || 0);
    const sceneCount = clampNumber(params.sceneCount, 0, MAX_SCENES, 0);
    const visualStyle = sanitizeText(params.visualStyle || params.style || '');

    if (!transcript && turns.length === 0) {
      throw createServiceError(400, 'A transcript or script turns are required to plan a podcast video.', 'podcast_video_transcript_required');
    }

    if (params.useModel === false) {
      return {
        title,
        durationSeconds,
        scenes: buildFallbackStoryboard({ title, transcript, turns, durationSeconds, sceneCount }),
        planning: {
          provider: 'local',
          model: null,
        },
      };
    }

    try {
      const response = await this.createResponse({
        input: buildStoryboardPrompt({
          title,
          transcript,
          turns,
          durationSeconds,
          sceneCount,
          visualStyle,
        }),
        instructions: 'You create practical podcast video storyboards and return valid JSON only.',
        stream: false,
        model: params.model || undefined,
        reasoningEffort: params.reasoningEffort || undefined,
        enableAutomaticToolCalls: false,
        requestTimeoutMs: Math.max(30000, Number(params.planTimeoutMs) || 90000),
        requestMaxRetries: 0,
      });
      const parsed = parseLenientJson(getResponseText(response));
      const scenes = (Array.isArray(parsed?.scenes) ? parsed.scenes : [])
        .slice(0, MAX_SCENES)
        .map((scene, index) => normalizeScene(scene, index));

      if (scenes.length > 0) {
        return {
          title: sanitizeText(parsed?.title || title) || title,
          durationSeconds,
          scenes,
          planning: {
            provider: 'model',
            model: response?.model || params.model || null,
          },
        };
      }
    } catch (error) {
      console.warn(`[PodcastVideo] Falling back to local storyboard planning: ${error.message}`);
    }

    return {
      title,
      durationSeconds,
      scenes: buildFallbackStoryboard({ title, transcript, turns, durationSeconds, sceneCount }),
      planning: {
        provider: 'local-fallback',
        model: null,
      },
    };
  }

  async downloadImage(url = '') {
    const decoded = decodeDataUrl(url);
    if (decoded) {
      return decoded;
    }

    const normalizedUrl = String(url || '').trim();
    if (!/^https?:\/\//i.test(normalizedUrl) || typeof fetch !== 'function') {
      return null;
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 20000) : null;
    try {
      const response = await fetch(normalizedUrl, {
        headers: { Accept: 'image/*' },
        signal: controller?.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
      const arrayBuffer = await response.arrayBuffer();
      return {
        buffer: Buffer.from(arrayBuffer),
        mimeType: contentType.split(';')[0] || 'image/jpeg',
        extension: inferImageExtension(contentType, normalizedUrl),
      };
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  async resolveWebSearchImage(scene = {}, options = {}) {
    const executeTool = typeof options.toolManager?.executeTool === 'function'
      ? options.toolManager.executeTool.bind(options.toolManager)
      : null;
    if (!executeTool) {
      return null;
    }

    try {
      const search = await executeTool('web-search', {
        query: `${scene.visualQuery || scene.summary} photo image`,
        researchMode: 'search',
        limit: 4,
        safeSearch: true,
        includeSnippets: true,
        includeUrls: true,
      }, options.toolContext || {});
      const results = Array.isArray(search?.data?.results)
        ? search.data.results
        : Array.isArray(search?.results)
          ? search.results
          : [];

      for (const result of results.slice(0, 4)) {
        const resultUrl = String(result?.url || '').trim();
        if (!resultUrl) {
          continue;
        }

        if (isLikelyImageUrl(resultUrl)) {
          const direct = await this.downloadImage(resultUrl).catch(() => null);
          if (direct?.buffer?.length) {
            return {
              ...direct,
              source: 'web-search',
              url: resultUrl,
              attribution: {
                name: result?.source || result?.title || '',
                sourceUrl: resultUrl,
              },
            };
          }
        }

        const fetched = await executeTool('web-fetch', {
          url: resultUrl,
          timeout: 12000,
          retries: 1,
          cache: true,
        }, options.toolContext || {}).catch(() => null);
        const body = String(fetched?.data?.body || fetched?.body || '');
        const pageUrl = String(fetched?.data?.url || fetched?.url || resultUrl);
        const imageUrls = extractImageUrlsFromHtml(body, pageUrl);

        for (const imageUrl of imageUrls.slice(0, 4)) {
          const downloaded = await this.downloadImage(imageUrl).catch(() => null);
          if (downloaded?.buffer?.length) {
            return {
              ...downloaded,
              source: 'web-search',
              url: imageUrl,
              attribution: {
                name: result?.source || result?.title || '',
                sourceUrl: resultUrl,
              },
            };
          }
        }
      }
    } catch (error) {
      console.warn(`[PodcastVideo] Web-search image lookup failed for scene ${scene.id}: ${error.message}`);
    }

    return null;
  }

  async resolveSceneImage(scene = {}, options = {}) {
    const imageMode = normalizeImageMode(options.imageMode);
    const orientation = options.orientation || 'landscape';

    if (scene.imageUrl) {
      const downloaded = await this.downloadImage(scene.imageUrl).catch(() => null);
      if (downloaded?.buffer?.length) {
        return {
          ...downloaded,
          source: scene.imageSource || 'provided',
          url: scene.imageUrl,
          attribution: scene.attribution || null,
        };
      }
    }

    const allowWebSearch = ['mixed', 'web'].includes(imageMode);
    if (allowWebSearch) {
      const webImage = await this.resolveWebSearchImage(scene, options);
      if (webImage?.buffer?.length) {
        return webImage;
      }
    }

    const allowUnsplash = ['mixed', 'unsplash'].includes(imageMode);
    if (allowUnsplash && this.isUnsplashConfigured()) {
      try {
        const results = await this.searchImages(scene.visualQuery || scene.summary, {
          page: 1,
          perPage: 1,
          orientation,
        });
        const image = results?.results?.[0] || null;
        const imageUrl = image?.urls?.regular || image?.urls?.full || image?.urls?.small || '';
        const downloaded = await this.downloadImage(imageUrl);
        if (downloaded?.buffer?.length) {
          return {
            ...downloaded,
            source: 'unsplash',
            url: imageUrl,
            attribution: image?.author ? {
              name: image.author.name,
              username: image.author.username,
              link: image.author.link,
              sourceUrl: image.links?.html || null,
            } : null,
            unsplash: image,
          };
        }
      } catch (error) {
        console.warn(`[PodcastVideo] Unsplash image lookup failed for scene ${scene.id}: ${error.message}`);
      }
    }

    const allowGenerated = ['mixed', 'generated'].includes(imageMode) && options.generateImages === true;
    if (allowGenerated) {
      try {
        const response = await this.generateImageBatch({
          prompt: scene.visualPrompt || scene.visualQuery || scene.summary,
          model: options.imageModel || null,
          size: options.imageSize || (orientation === 'portrait' ? '1024x1536' : '1536x1024'),
          quality: options.imageQuality || 'auto',
          background: 'opaque',
          n: 1,
        });
        const generatedImage = response?.data?.[0] || null;
        const downloaded = await this.downloadImage(generatedImage?.url || '');
        if (downloaded?.buffer?.length) {
          return {
            ...downloaded,
            source: 'generated',
            url: generatedImage?.url || null,
            attribution: null,
            revisedPrompt: generatedImage?.revised_prompt || null,
          };
        }
      } catch (error) {
        console.warn(`[PodcastVideo] Generated image failed for scene ${scene.id}: ${error.message}`);
      }
    }

    return {
      buffer: buildPlaceholderFrameBuffer(options.width, options.height, scene.visualPrompt || scene.summary),
      mimeType: 'image/x-portable-pixmap',
      extension: 'ppm',
      source: 'fallback',
      url: null,
      attribution: null,
    };
  }

  async prepareSceneImages(scenes = [], options = {}) {
    const assets = [];
    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index];
      const image = await this.resolveSceneImage(scene, options);
      const filePath = path.join(options.tempDir, `scene-${String(index + 1).padStart(3, '0')}.${image.extension || 'png'}`);
      await fs.writeFile(filePath, image.buffer);
      assets.push({
        ...image,
        path: filePath,
      });
    }
    return assets;
  }

  async renderMp4({
    audioBuffer,
    audioMimeType = 'audio/wav',
    scenes = [],
    title = 'Podcast video',
    aspectRatio = '16:9',
    imageMode = 'mixed',
    generateImages = false,
    imageModel = null,
    ffmpegTimeoutMs = null,
    segmentTimeoutMs = null,
    muxTimeoutMs = null,
    maxFfmpegTimeoutMs = null,
    x264Preset = null,
    x264Crf = null,
    toolManager = null,
    toolContext = {},
  } = {}) {
    if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
      throw createServiceError(400, 'An audio buffer is required to render podcast video.', 'podcast_video_audio_required');
    }
    const normalizedScenes = (Array.isArray(scenes) ? scenes : [])
      .slice(0, MAX_SCENES)
      .map((scene, index) => normalizeScene(scene, index));
    if (normalizedScenes.length === 0) {
      throw createServiceError(400, 'At least one storyboard scene is required to render podcast video.', 'podcast_video_scenes_required');
    }

    const dimensions = normalizeAspectRatio(aspectRatio);
    const runtime = resolvePodcastVideoRuntimeOptions({
      ffmpegTimeoutMs,
      segmentTimeoutMs,
      muxTimeoutMs,
      maxFfmpegTimeoutMs,
      x264Preset,
      x264Crf,
    });
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kimibuilt-podcast-video-'));
    const audioExtension = String(audioMimeType || '').toLowerCase().includes('mpeg') ? 'mp3' : 'wav';
    const audioPath = path.join(tempDir, `podcast-audio.${audioExtension}`);
    const concatPath = path.join(tempDir, 'segments.txt');
    const outputPath = path.join(tempDir, `${slugify(title)}.mp4`);

    try {
      await fs.writeFile(audioPath, audioBuffer);
      const imageAssets = await this.prepareSceneImages(normalizedScenes, {
        tempDir,
        width: dimensions.width,
        height: dimensions.height,
        orientation: dimensions.orientation,
        imageMode,
        generateImages,
        imageModel,
        toolManager,
        toolContext,
      });
      const segmentPaths = [];
      for (let index = 0; index < normalizedScenes.length; index += 1) {
        const scene = normalizedScenes[index];
        const asset = imageAssets[index];
        const segmentPath = path.join(tempDir, `segment-${String(index + 1).padStart(3, '0')}.mp4`);
        segmentPaths.push(segmentPath);
        const fadeOutStart = Math.max(0, scene.duration - 0.35);
        const panDirection = index % 2 === 0
          ? "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
          : "x='iw/2-(iw/zoom/2)+(iw-iw/zoom)*0.06':y='ih/2-(ih/zoom/2)'";
        await this.runFfmpeg([
          '-y',
          '-loop', '1',
          '-framerate', String(DEFAULT_FPS),
          '-t', String(Math.max(MIN_SCENE_SECONDS, scene.duration).toFixed(3)),
          '-i', asset.path,
          '-vf', [
            `scale=${dimensions.width}:${dimensions.height}:force_original_aspect_ratio=increase`,
            `crop=${dimensions.width}:${dimensions.height}`,
            `zoompan=z='min(zoom+0.0009,1.08)':${panDirection}:d=1:s=${dimensions.width}x${dimensions.height}:fps=${DEFAULT_FPS}`,
            'fade=t=in:st=0:d=0.25',
            `fade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.35`,
            'format=yuv420p',
          ].join(','),
          '-r', String(DEFAULT_FPS),
          '-an',
          '-c:v', 'libx264',
          '-preset', runtime.x264Preset,
          '-crf', String(runtime.x264Crf),
          '-pix_fmt', 'yuv420p',
          segmentPath,
        ], {
          timeoutMs: resolveAdaptiveFfmpegTimeoutMs(runtime.segmentTimeoutMs, scene.duration, {
            fixedMs: 60000,
            perSecondMs: 2000,
            maxTimeoutMs: runtime.maxFfmpegTimeoutMs,
          }),
          stage: `scene ${index + 1}/${normalizedScenes.length}`,
        });
      }

      await fs.writeFile(
        concatPath,
        segmentPaths.map((segmentPath) => `file '${escapeConcatPath(segmentPath)}'`).join('\n'),
        'utf8',
      );
      await this.runFfmpeg([
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concatPath,
        '-i', audioPath,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-shortest',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        outputPath,
      ], {
        timeoutMs: resolveAdaptiveFfmpegTimeoutMs(
          runtime.muxTimeoutMs,
          normalizedScenes.reduce((sum, scene) => sum + Math.max(MIN_SCENE_SECONDS, Number(scene.duration) || 0), 0),
          {
            fixedMs: 120000,
            perSecondMs: 1000,
            maxTimeoutMs: runtime.maxFfmpegTimeoutMs,
          },
        ),
        stage: 'final mux',
      });

      return {
        buffer: await fs.readFile(outputPath),
        scenes: normalizedScenes.map((scene, index) => ({
          ...scene,
          image: {
            source: imageAssets[index]?.source || 'fallback',
            url: imageAssets[index]?.url || null,
            attribution: imageAssets[index]?.attribution || null,
            revisedPrompt: imageAssets[index]?.revisedPrompt || null,
          },
        })),
        dimensions,
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  async persistVideo({
    sessionId,
    title = 'Podcast video',
    videoBuffer,
    transcript = '',
    storyboard = null,
    metadata = {},
  } = {}) {
    if (!sessionId) {
      throw createServiceError(400, 'A sessionId is required to save podcast video.', 'session_required');
    }
    if (!Buffer.isBuffer(videoBuffer) || videoBuffer.length === 0) {
      throw createServiceError(500, 'Podcast video render returned no bytes.', 'video_render_empty');
    }

    const filename = `${slugify(title)}.mp4`;
    let artifact = null;
    try {
      const stored = await this.artifactService.createStoredArtifact({
        sessionId,
        direction: 'generated',
        sourceMode: 'podcast-video',
        filename,
        extension: 'mp4',
        mimeType: 'video/mp4',
        buffer: videoBuffer,
        extractedText: transcript,
        previewHtml: '',
        metadata: {
          generatedBy: 'podcast-video',
          title,
          storyboard,
          ...metadata,
        },
        vectorize: Boolean(transcript),
      });
      artifact = this.artifactService.serializeArtifact(stored);
    } catch (error) {
      console.warn('[PodcastVideo] Artifact storage unavailable; saving generated video locally:', error.message);
      artifact = await persistGeneratedVideoLocally({
        sessionId,
        sourceMode: 'podcast-video',
        title,
        filename,
        videoBuffer,
        extractedText: transcript,
        metadata: {
          storyboard,
          ...metadata,
        },
      });
    }

    await updateGeneratedVideoSessionState(sessionId, [artifact]);
    const normalizedVideo = normalizeGeneratedVideoRecord(artifact);
    return {
      artifact,
      video: normalizedVideo || {
        artifactId: artifact.id,
        filename: artifact.filename,
        mimeType: artifact.mimeType,
        format: artifact.format,
        downloadUrl: buildArtifactDownloadPath(artifact.id),
        inlinePath: buildArtifactInlinePath(artifact.id),
        absoluteUrl: toAbsoluteInternalUrl(buildArtifactDownloadPath(artifact.id)),
        absoluteInlineUrl: toAbsoluteInternalUrl(buildArtifactInlinePath(artifact.id)),
      },
    };
  }

  async createVideo({
    sessionId,
    title = '',
    transcript = '',
    turns = [],
    audioBuffer,
    audioMimeType = 'audio/wav',
    options = {},
  } = {}) {
    const resolvedTranscript = sanitizeText(transcript)
      || (Array.isArray(turns) ? turns.map((turn) => `${sanitizeText(turn?.speaker)}: ${sanitizeText(turn?.text)}`).join('\n') : '');
    if (!resolvedTranscript) {
      throw createServiceError(400, 'A transcript or script turns are required to create a podcast video.', 'podcast_video_transcript_required');
    }

    const durationSeconds = Number(options.durationSeconds)
      || await this.getAudioDurationSeconds(audioBuffer, audioMimeType)
      || 0;
    const storyboard = Array.isArray(options.scenes) && options.scenes.length > 0
      ? {
        title: sanitizeText(title) || 'Podcast video',
        durationSeconds,
        scenes: options.scenes.map((scene, index) => normalizeScene(scene, index)),
        planning: { provider: 'provided', model: null },
      }
      : await this.planStoryboard({
        title,
        transcript: resolvedTranscript,
        turns,
        durationSeconds,
        sceneCount: options.sceneCount,
        visualStyle: options.visualStyle,
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        useModel: options.useModel,
        planTimeoutMs: options.planTimeoutMs,
      });
    const rendered = await this.renderMp4({
      audioBuffer,
      audioMimeType,
      scenes: storyboard.scenes,
      title: storyboard.title || title,
      aspectRatio: options.aspectRatio || '16:9',
      imageMode: options.imageMode || 'mixed',
      generateImages: options.generateImages === true,
      imageModel: options.imageModel || null,
      ffmpegTimeoutMs: options.ffmpegTimeoutMs || options.videoFfmpegTimeoutMs || options.timeoutMs || null,
      segmentTimeoutMs: options.segmentTimeoutMs || options.videoSegmentTimeoutMs || null,
      muxTimeoutMs: options.muxTimeoutMs || options.videoMuxTimeoutMs || null,
      maxFfmpegTimeoutMs: options.maxFfmpegTimeoutMs || options.videoMaxFfmpegTimeoutMs || null,
      x264Preset: options.x264Preset || options.videoX264Preset || null,
      x264Crf: options.x264Crf || options.videoX264Crf || null,
      toolManager: options.toolManager || null,
      toolContext: options.toolContext || {},
    });
    const persisted = await this.persistVideo({
      sessionId,
      title: storyboard.title || title,
      videoBuffer: rendered.buffer,
      transcript: resolvedTranscript,
      storyboard: {
        ...storyboard,
        scenes: rendered.scenes,
      },
      metadata: {
        topic: sanitizeText(options.topic || title),
        durationSeconds,
        dimensions: rendered.dimensions,
        imageMode: normalizeImageMode(options.imageMode || 'mixed'),
        generatedImagesEnabled: options.generateImages === true,
      },
    });

    return {
      title: storyboard.title || title,
      durationSeconds,
      storyboard: {
        ...storyboard,
        scenes: rendered.scenes,
      },
      artifact: persisted.artifact,
      video: persisted.video,
    };
  }

  async createVideoFromAudioUpload({
    sessionId,
    file,
    fields = {},
  } = {}) {
    if (!file?.buffer?.length) {
      throw createServiceError(400, 'An audio file upload is required.', 'audio_upload_required');
    }

    let transcript = sanitizeText(fields.transcript || '');
    let transcription = null;
    if (!transcript) {
      transcription = await this.transcriptionService.transcribe({
        audioBuffer: file.buffer,
        filename: file.filename || 'podcast-audio.wav',
        mimeType: file.mimeType || 'audio/wav',
        language: fields.language || '',
        prompt: fields.prompt || fields.topic || '',
        model: fields.transcriptionModel || '',
      });
      transcript = sanitizeText(transcription.text || '');
    }

    return this.createVideo({
      sessionId,
      title: fields.title || fields.topic || file.filename || 'Podcast video',
      transcript,
      audioBuffer: file.buffer,
      audioMimeType: file.mimeType || 'audio/wav',
      options: {
        ...fields,
        transcription,
        sceneCount: Number(fields.sceneCount) || undefined,
        generateImages: ['1', 'true', 'yes'].includes(String(fields.generateImages || '').toLowerCase()),
      },
    });
  }

  async createVideoFromAudioArtifact({
    sessionId,
    audioArtifactId,
    title = '',
    transcript = '',
    turns = [],
    options = {},
  } = {}) {
    const audioArtifact = await this.readAudioArtifact(audioArtifactId);
    if (sessionId && audioArtifact.sessionId && String(audioArtifact.sessionId) !== String(sessionId)) {
      throw createServiceError(404, 'Audio artifact not found for this session.', 'audio_artifact_not_found');
    }
    return this.createVideo({
      sessionId,
      title: title || audioArtifact.metadata?.title || audioArtifact.filename || 'Podcast video',
      transcript: transcript || audioArtifact.metadata?.transcript || audioArtifact.extractedText || '',
      turns,
      audioBuffer: audioArtifact.contentBuffer,
      audioMimeType: audioArtifact.mimeType || 'audio/wav',
      options: {
        ...options,
        audioArtifactId,
      },
    });
  }

  async createVideoFromPodcast(podcast = {}, { sessionId, options = {} } = {}) {
    const audioArtifactId = String(podcast?.audio?.artifactId || podcast?.artifact?.id || '').trim();
    if (!audioArtifactId) {
      throw createServiceError(400, 'The podcast result does not include a saved audio artifact.', 'podcast_audio_artifact_required');
    }

    return this.createVideoFromAudioArtifact({
      sessionId,
      audioArtifactId,
      title: podcast.title || podcast.script?.title || 'Podcast video',
      transcript: podcast.script?.transcript || '',
      turns: podcast.script?.turns || [],
      options: {
        topic: podcast.title || '',
        ...options,
      },
    });
  }
}

const podcastVideoService = new PodcastVideoService();

module.exports = {
  PodcastVideoService,
  podcastVideoService,
  buildFallbackStoryboard,
  normalizeScene,
};
