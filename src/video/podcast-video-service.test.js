const fs = require('fs/promises');
const { PodcastVideoService, buildFallbackStoryboard } = require('./podcast-video-service');

describe('PodcastVideoService', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('builds a local timed storyboard from transcript text', () => {
    const scenes = buildFallbackStoryboard({
      title: 'Battery storage',
      transcript: 'Batteries store energy. They release it when demand rises. Grid operators use them for flexibility.',
      durationSeconds: 24,
      sceneCount: 3,
    });

    expect(scenes).toHaveLength(3);
    expect(scenes[0]).toEqual(expect.objectContaining({
      id: 'scene-01',
      start: 0,
      visualPrompt: expect.stringContaining('Battery storage'),
    }));
    expect(scenes[2].end).toBeCloseTo(24);
  });

  test('uses local planning when model planning is disabled', async () => {
    const service = new PodcastVideoService({
      createResponse: jest.fn(),
    });

    const result = await service.planStoryboard({
      title: 'Episode',
      transcript: 'A short transcript for a video plan.',
      durationSeconds: 12,
      sceneCount: 2,
      useModel: false,
    });

    expect(result.planning.provider).toBe('local');
    expect(result.scenes).toHaveLength(2);
  });

  test('uses adaptive ffmpeg timeouts and fast x264 settings when rendering', async () => {
    const service = new PodcastVideoService({
      audioProcessingService: {
        assertConfigured: jest.fn(),
        getEffectiveBinaryPath: () => 'ffmpeg',
      },
      isUnsplashConfigured: () => false,
    });
    const ffmpegCalls = [];
    jest.spyOn(service, 'runFfmpeg').mockImplementation(async (args, options) => {
      ffmpegCalls.push({ args, options });
      await fs.writeFile(args[args.length - 1], Buffer.from('mp4'));
      return { stdout: '', stderr: '' };
    });

    const result = await service.renderMp4({
      audioBuffer: Buffer.from('audio'),
      audioMimeType: 'audio/wav',
      title: 'Longer render',
      imageMode: 'fallback',
      scenes: [{
        start: 0,
        end: 90,
        summary: 'Particle physics update',
        visualPrompt: 'particle detector newsroom still',
      }],
      segmentTimeoutMs: 90000,
      muxTimeoutMs: 100000,
      maxFfmpegTimeoutMs: 300000,
      x264Preset: 'ultrafast',
      x264Crf: 28,
    });

    expect(result.buffer).toEqual(Buffer.from('mp4'));
    expect(ffmpegCalls).toHaveLength(2);
    expect(ffmpegCalls[0].args).toEqual(expect.arrayContaining([
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '28',
    ]));
    expect(ffmpegCalls[0].options).toEqual(expect.objectContaining({
      timeoutMs: 240000,
      stage: 'scene 1/1',
    }));
    expect(ffmpegCalls[1].options).toEqual(expect.objectContaining({
      timeoutMs: 210000,
      stage: 'final mux',
    }));
  });

  test('can harvest an image from a web-search result via web-fetch', async () => {
    const imageBytes = Buffer.from([1, 2, 3, 4]);
    global.fetch = jest.fn(async (url) => {
      if (url === 'https://cdn.example.com/story.jpg') {
        return {
          ok: true,
          headers: {
            get: () => 'image/jpeg',
          },
          arrayBuffer: async () => imageBytes,
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const executeTool = jest.fn(async (toolId) => {
      if (toolId === 'web-search') {
        return {
          data: {
            results: [{ title: 'Story page', url: 'https://example.com/story', source: 'example.com' }],
          },
        };
      }
      if (toolId === 'web-fetch') {
        return {
          data: {
            url: 'https://example.com/story',
            body: '<html><head><meta property="og:image" content="https://cdn.example.com/story.jpg"></head></html>',
          },
        };
      }
      throw new Error(`unexpected tool ${toolId}`);
    });
    const service = new PodcastVideoService({
      isUnsplashConfigured: () => false,
      searchImages: jest.fn(),
      generateImageBatch: jest.fn(),
    });

    const image = await service.resolveSceneImage({
      id: 'scene-01',
      summary: 'Grid batteries',
      visualQuery: 'grid battery storage',
    }, {
      imageMode: 'web',
      toolManager: { executeTool },
      toolContext: { sessionId: 'session-1' },
    });

    expect(executeTool).toHaveBeenCalledWith('web-search', expect.objectContaining({
      query: 'grid battery storage photo image',
    }), expect.any(Object));
    expect(executeTool).toHaveBeenCalledWith('web-fetch', expect.objectContaining({
      url: 'https://example.com/story',
    }), expect.any(Object));
    expect(image).toEqual(expect.objectContaining({
      source: 'web-search',
      url: 'https://cdn.example.com/story.jpg',
      extension: 'jpg',
      buffer: imageBytes,
    }));
  });
});
