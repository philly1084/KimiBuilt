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
  sessionId: { required: false, type: 'string' },
  durationMinutes: { required: false, type: 'number' },
  audience: { required: false, type: 'string' },
  tone: { required: false, type: 'string' },
  hostAName: { required: false, type: 'string' },
  hostBName: { required: false, type: 'string' },
  hostAVoiceId: { required: false, type: 'string' },
  hostBVoiceId: { required: false, type: 'string' },
  includeIntro: { required: false, type: 'boolean' },
  includeOutro: { required: false, type: 'boolean' },
  includeMusicBed: { required: false, type: 'boolean' },
  enhanceSpeech: { required: false, type: 'boolean' },
  introPath: { required: false, type: 'string' },
  outroPath: { required: false, type: 'string' },
  musicBedPath: { required: false, type: 'string' },
  exportMp3: { required: false, type: 'boolean' },
  ttsTimeoutMs: { required: false, type: 'number' },
  ttsChunkMaxChars: { required: false, type: 'number' },
};

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

router.post('/generate', validate(generateSchema), async (req, res, next) => {
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
