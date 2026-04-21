const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { sessionStore } = require('../session-store');
const { buildScopedSessionMetadata, resolveClientSurface } = require('../session-scope');
const { ensureRuntimeToolManager } = require('../runtime-tool-manager');
const { ttsService } = require('../tts/tts-service');
const { audioProcessingService } = require('../audio/audio-processing-service');
const { podcastService } = require('../podcast/podcast-service');

const router = Router();

const generateSchema = {
  topic: { required: true, type: 'string' },
  prompt: { required: false, type: 'string' },
  subject: { required: false, type: 'string' },
  sessionId: { required: false, type: 'string' },
  durationMinutes: { required: false, type: 'number' },
  audience: { required: false, type: 'string' },
  tone: { required: false, type: 'string' },
  hostAName: { required: false, type: 'string' },
  hostARole: { required: false, type: 'string' },
  hostAPersona: { required: false, type: 'string' },
  hostBName: { required: false, type: 'string' },
  hostBRole: { required: false, type: 'string' },
  hostBPersona: { required: false, type: 'string' },
  hostAVoiceId: { required: false, type: 'string' },
  hostAVoiceIds: { required: false, type: 'array', items: { type: 'string' } },
  hostBVoiceId: { required: false, type: 'string' },
  hostBVoiceIds: { required: false, type: 'array', items: { type: 'string' } },
  cycleHostVoices: { required: false, type: 'boolean' },
  allowVoiceFallback: { required: false, type: 'boolean' },
  sourceUrls: { required: false, type: 'array', items: { type: 'string' } },
  searchDomains: { required: false, type: 'array', items: { type: 'string' } },
  maxSources: { required: false, type: 'number' },
  pauseMs: { required: false, type: 'number' },
  includeIntro: { required: false, type: 'boolean' },
  includeOutro: { required: false, type: 'boolean' },
  includeMusicBed: { required: false, type: 'boolean' },
  enhanceSpeech: { required: false, type: 'boolean' },
  introPath: { required: false, type: 'string' },
  outroPath: { required: false, type: 'string' },
  musicBedPath: { required: false, type: 'string' },
  speechVolume: { required: false, type: 'number' },
  musicVolume: { required: false, type: 'number' },
  introVolume: { required: false, type: 'number' },
  outroVolume: { required: false, type: 'number' },
  exportMp3: { required: false, type: 'boolean' },
  outputFormat: { required: false, type: 'string' },
  mp3BitrateKbps: { required: false, type: 'number' },
  model: { required: false, type: 'string' },
  reasoningEffort: { required: false, type: 'string' },
  scriptTimeoutMs: { required: false, type: 'number' },
  ttsTimeoutMs: { required: false, type: 'number' },
  ttsChunkMaxChars: { required: false, type: 'number' },
  ttsConcurrency: { required: false, type: 'number' },
  researchConcurrency: { required: false, type: 'number' },
};

function normalizePodcastGenerateRequest(req, _res, next) {
  if (!req.body || typeof req.body !== 'object') {
    return next();
  }

  if (typeof req.body.topic !== 'string' || !req.body.topic.trim()) {
    const fallbackTopic = String(req.body.prompt || req.body.subject || '').trim();
    if (fallbackTopic) {
      req.body.topic = fallbackTopic;
    }
  }

  return next();
}

function getRequestOwnerId(req) {
  return String(req.user?.username || req.user?.id || '').trim() || null;
}

async function resolvePodcastSessionId(req, requestedSessionId = null) {
  const ownerId = getRequestOwnerId(req);
  const normalized = typeof requestedSessionId === 'string' ? requestedSessionId.trim() : '';
  const body = req.body || {};
  const sessionMetadata = buildScopedSessionMetadata({
    mode: 'podcast',
    taskType: 'podcast',
    clientSurface: resolveClientSurface(body, null, 'podcast'),
    memoryScope: body.memoryScope || body.memory_scope || '',
  });

  if (ownerId) {
    const session = await sessionStore.resolveOwnedSession(
      normalized && !normalized.startsWith('local_') ? normalized : null,
      sessionMetadata,
      ownerId,
    );
    return session?.id || null;
  }

  if (normalized && !normalized.startsWith('local_')) {
    const session = await sessionStore.getOrCreate(normalized, sessionMetadata);
    return session?.id || normalized;
  }

  const session = await sessionStore.create(sessionMetadata);
  return session.id;
}

function buildPodcastContext(req, toolManager, sessionId) {
  const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
  const timezone = String(metadata.timezone || metadata.timeZone || req.get('x-timezone') || '').trim() || null;
  return {
    sessionId,
    userId: req.user?.id || req.user?.username || null,
    timestamp: new Date().toISOString(),
    route: req.originalUrl || req.path || '/api/podcast/generate',
    transport: 'http',
    executionProfile: 'podcast',
    timezone,
    clientSurface: 'podcast',
    taskType: 'podcast',
    toolManager,
    podcastService: req.app.locals?.podcastService || podcastService,
  };
}

router.get('/runtime', (_req, res) => {
  res.json({
    tts: ttsService.getPublicConfig(),
    audioProcessing: audioProcessingService.getPublicConfig(),
  });
});

router.post('/generate', normalizePodcastGenerateRequest, validate(generateSchema), async (req, res, next) => {
  try {
    const toolManager = await ensureRuntimeToolManager(req.app);
    const sessionId = await resolvePodcastSessionId(req, req.body.sessionId);
    const data = await (req.app.locals?.podcastService || podcastService).createPodcast(
      req.body || {},
      buildPodcastContext(req, toolManager, sessionId),
    );

    res.json({
      sessionId,
      ...data,
    });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({
        error: {
          type: error.code || 'podcast_error',
          message: error.message,
        },
      });
    }

    return next(error);
  }
});

module.exports = router;
