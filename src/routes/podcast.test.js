const express = require('express');
const request = require('supertest');

jest.mock('../middleware/validate', () => ({
  validate: () => (_req, _res, next) => next(),
}));

jest.mock('../session-store', () => ({
  sessionStore: {
    resolveOwnedSession: jest.fn(),
    getOrCreate: jest.fn(),
    create: jest.fn(),
  },
}));

jest.mock('../tts/tts-service', () => ({
  ttsService: {
    getPublicConfig: jest.fn(() => ({
      configured: true,
      provider: 'piper',
      voices: [{ id: 'hfc-female-rich', label: 'HFC Rich' }],
    })),
  },
}));

jest.mock('../audio/audio-processing-service', () => ({
  audioProcessingService: {
    getPublicConfig: jest.fn(() => ({
      configured: true,
      provider: 'ffmpeg',
      supportsMp3: true,
      supportsMixing: true,
    })),
  },
}));

jest.mock('../podcast/podcast-service', () => ({
  podcastService: {
    createPodcast: jest.fn(),
  },
}));

const { sessionStore } = require('../session-store');
const { podcastService } = require('../podcast/podcast-service');
const podcastRouter = require('./podcast');

describe('/api/podcast', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStore.resolveOwnedSession.mockResolvedValue({ id: 'session-1' });
    sessionStore.create.mockResolvedValue({ id: 'session-created' });
  });

  test('returns podcast runtime capabilities', async () => {
    const app = express();
    app.use('/api/podcast', podcastRouter);

    const response = await request(app).get('/api/podcast/runtime');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      tts: expect.objectContaining({
        provider: 'piper',
      }),
      audioProcessing: expect.objectContaining({
        provider: 'ffmpeg',
        supportsMp3: true,
      }),
    });
  });

  test('generates a podcast with a resolved session', async () => {
    podcastService.createPodcast.mockResolvedValue({
      title: 'Battery Breakdown',
      audio: { artifactId: 'artifact-podcast-1' },
      artifacts: [],
      artifactIds: [],
      script: { turns: [] },
    });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { username: 'phill' };
      next();
    });
    app.locals.toolManager = { executeTool: jest.fn() };
    app.use('/api/podcast', podcastRouter);

    const response = await request(app)
      .post('/api/podcast/generate')
      .send({
        topic: 'How batteries work',
        sessionId: 'session-1',
        exportMp3: true,
      });

    expect(response.status).toBe(200);
    expect(sessionStore.resolveOwnedSession).toHaveBeenCalled();
    expect(podcastService.createPodcast).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'How batteries work',
      exportMp3: true,
    }), expect.objectContaining({
      sessionId: 'session-1',
      clientSurface: 'podcast',
    }));
    expect(response.body).toEqual(expect.objectContaining({
      sessionId: 'session-1',
      title: 'Battery Breakdown',
      audio: { artifactId: 'artifact-podcast-1' },
    }));
  });

  test('maps known podcast errors to JSON responses', async () => {
    const error = new Error('ffmpeg is unavailable.');
    error.statusCode = 503;
    error.code = 'audio_processing_unavailable';
    podcastService.createPodcast.mockRejectedValue(error);

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { username: 'phill' };
      next();
    });
    app.locals.toolManager = { executeTool: jest.fn() };
    app.use('/api/podcast', podcastRouter);

    const response = await request(app)
      .post('/api/podcast/generate')
      .send({
        topic: 'How batteries work',
      });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: {
        type: 'audio_processing_unavailable',
        message: 'ffmpeg is unavailable.',
      },
    });
  });
});
