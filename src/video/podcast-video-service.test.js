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
