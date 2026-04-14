jest.mock('../openai-client', () => ({
  createResponse: jest.fn(),
}));

jest.mock('../tts/piper-tts-service', () => ({
  piperTtsService: {
    getPublicConfig: jest.fn(() => ({
      configured: true,
      provider: 'piper',
      maxTextChars: 2400,
      timeoutMs: 45000,
      podcastTimeoutMs: 180000,
      podcastChunkChars: 900,
      defaultVoiceId: 'hfc-female-rich',
      voices: [
        { id: 'hfc-female-rich', label: 'HFC Rich', provider: 'piper' },
        { id: 'amy-expressive', label: 'Amy Expressive', provider: 'piper' },
      ],
    })),
    synthesize: jest.fn(),
  },
  normalizeTextForSpeech: jest.fn((text) => text),
}));

jest.mock('../generated-audio-artifacts', () => ({
  persistGeneratedAudio: jest.fn(),
  updateGeneratedAudioSessionState: jest.fn(),
}));

jest.mock('../audio/audio-processing-service', () => ({
  audioProcessingService: {
    getPublicConfig: jest.fn(() => ({
      configured: true,
      provider: 'ffmpeg',
      supportsMp3: true,
      supportsMixing: true,
      defaults: {
        masteringEnabled: true,
        mp3BitrateKbps: 192,
      },
      diagnostics: {
        status: 'ready',
      },
    })),
    composePodcastAudio: jest.fn(async ({ speechWavBuffer }) => speechWavBuffer),
    transcodeWavToMp3: jest.fn(async () => Buffer.from('mp3-bytes')),
  },
}));

const { createResponse } = require('../openai-client');
const { piperTtsService } = require('../tts/piper-tts-service');
const { persistGeneratedAudio, updateGeneratedAudioSessionState } = require('../generated-audio-artifacts');
const { audioProcessingService } = require('../audio/audio-processing-service');
const { writeWavBuffer } = require('../audio/wav-utils');
const { PodcastService } = require('./podcast-service');

function createTestWav(bytes) {
  return writeWavBuffer({
    sampleRate: 22050,
    bitsPerSample: 16,
    numChannels: 1,
    data: Buffer.from(bytes),
  });
}

describe('PodcastService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createResponse.mockResolvedValue({
      output_text: JSON.stringify({
        title: 'The Battery Breakdown',
        summary: 'A practical conversation about how battery storage works.',
        turns: [
          { speaker: 'Maya', text: 'Welcome in. Today we are unpacking grid batteries and why they matter.' },
          { speaker: 'June', text: 'The core idea is simple: they store energy when supply is abundant and release it when demand rises.' },
          { speaker: 'Maya', text: 'That flexibility helps balance solar and wind output instead of wasting it.' },
          { speaker: 'June', text: 'It also supports the grid during short spikes, which is where response speed matters.' },
          { speaker: 'Maya', text: 'Different chemistries have different strengths, and lithium-ion is only one piece of the picture.' },
          { speaker: 'June', text: 'Exactly, and project economics depend on cycle life, safety, and the duration the system needs to cover.' },
          { speaker: 'Maya', text: 'So the interesting question is less whether batteries matter and more where they fit best.' },
          { speaker: 'June', text: 'And that is where careful system design and policy choices start to shape outcomes.' },
        ],
      }),
    });
    piperTtsService.synthesize.mockResolvedValue({
      audioBuffer: createTestWav([1, 2, 3, 4]),
      voice: { provider: 'piper' },
      contentType: 'audio/wav',
      text: 'segment',
    });
    persistGeneratedAudio.mockResolvedValue({
      artifact: { id: 'artifact-podcast-1', filename: 'battery-breakdown.wav' },
      artifactIds: ['artifact-podcast-1'],
      audio: { artifactId: 'artifact-podcast-1', downloadUrl: '/api/artifacts/artifact-podcast-1/download' },
    });
    updateGeneratedAudioSessionState.mockResolvedValue({});
  });

  test('creates a researched two-host podcast and persists the final audio', async () => {
    const service = new PodcastService();
    const executeTool = jest.fn(async (toolId) => {
      if (toolId === 'web-search') {
        return {
          success: true,
          data: {
            results: [
              { title: 'Grid battery guide', url: 'https://example.com/batteries', snippet: 'Battery storage helps balance power systems.' },
              { title: 'Storage economics', url: 'https://example.com/economics', snippet: 'Costs vary by chemistry and duration.' },
            ],
          },
        };
      }

      if (toolId === 'web-fetch') {
        return {
          success: true,
          data: {
            headers: { 'content-type': 'text/html' },
            body: '<article><h1>Battery storage</h1><p>Battery systems absorb excess power and discharge it later.</p></article>',
          },
        };
      }

      throw new Error(`Unexpected tool: ${toolId}`);
    });

    const result = await service.createPodcast({
      topic: 'How grid batteries work',
      durationMinutes: 10,
    }, {
      sessionId: 'session-1',
      clientSurface: 'chat',
      toolManager: { executeTool },
    });

    expect(executeTool).toHaveBeenCalledWith('web-search', expect.objectContaining({
      query: expect.stringContaining('How grid batteries work'),
    }), expect.any(Object));
    expect(createResponse).toHaveBeenCalled();
    expect(piperTtsService.synthesize).toHaveBeenCalled();
    expect(audioProcessingService.composePodcastAudio).toHaveBeenCalledWith(expect.objectContaining({
      enhanceSpeech: true,
    }));
    expect(persistGeneratedAudio).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      mimeType: 'audio/wav',
      metadata: expect.objectContaining({
        generatedBy: 'podcast',
        topic: 'How grid batteries work',
      }),
    }));
    expect(result.audio).toEqual(expect.objectContaining({
      artifactId: 'artifact-podcast-1',
    }));
    expect(result.script.turns).toHaveLength(8);
    expect(result.hosts).toHaveLength(2);
    expect(result.hosts[0].voiceId).not.toBe(result.hosts[1].voiceId);
  });

  test('exports mp3 and applies optional audio mixing when requested', async () => {
    persistGeneratedAudio
      .mockResolvedValueOnce({
        artifact: { id: 'artifact-podcast-wav', filename: 'battery-breakdown.wav' },
        artifactIds: ['artifact-podcast-wav'],
        audio: { artifactId: 'artifact-podcast-wav', downloadUrl: '/api/artifacts/artifact-podcast-wav/download' },
      })
      .mockResolvedValueOnce({
        artifact: { id: 'artifact-podcast-mp3', filename: 'battery-breakdown.mp3' },
        artifactIds: ['artifact-podcast-mp3'],
        audio: { artifactId: 'artifact-podcast-mp3', downloadUrl: '/api/artifacts/artifact-podcast-mp3/download' },
      });

    const service = new PodcastService();
    const executeTool = jest.fn(async (toolId) => {
      if (toolId === 'web-search') {
        return { success: true, data: { results: [{ title: 'A', url: 'https://example.com/a', snippet: 'A' }] } };
      }
      if (toolId === 'web-fetch') {
        return { success: true, data: { headers: { 'content-type': 'text/html' }, body: '<p>Battery systems store energy.</p>' } };
      }
      throw new Error(`Unexpected tool: ${toolId}`);
    });

    const result = await service.createPodcast({
      topic: 'How grid batteries work',
      exportMp3: true,
      includeIntro: true,
      includeMusicBed: true,
      musicBedPath: 'C:\\audio\\bed.wav',
    }, {
      sessionId: 'session-1',
      clientSurface: 'chat',
      toolManager: { executeTool },
    });

    expect(audioProcessingService.composePodcastAudio).toHaveBeenCalledWith(expect.objectContaining({
      includeIntro: true,
      includeMusicBed: true,
      enhanceSpeech: true,
      musicBedPath: 'C:\\audio\\bed.wav',
    }));
    expect(audioProcessingService.transcodeWavToMp3).toHaveBeenCalled();
    expect(updateGeneratedAudioSessionState).toHaveBeenCalledWith('session-1', [
      expect.objectContaining({ id: 'artifact-podcast-wav' }),
      expect.objectContaining({ id: 'artifact-podcast-mp3' }),
    ]);
    expect(result.audio).toEqual(expect.objectContaining({
      artifactId: 'artifact-podcast-mp3',
    }));
    expect(result.audioVariants).toHaveLength(2);
    expect(result.processing.mp3Exported).toBe(true);
    expect(result.processing.mixed).toBe(true);
    expect(result.processing.enhanced).toBe(true);
  });

  test('passes podcast-specific Piper timeout settings into synthesis and retries timed out chunks with smaller splits', async () => {
    const timeoutError = new Error('Piper TTS timed out before audio generation completed.');
    timeoutError.statusCode = 504;
    timeoutError.code = 'tts_timeout';

    piperTtsService.synthesize
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValue({
        audioBuffer: createTestWav([1, 2, 3, 4]),
        voice: { provider: 'piper' },
        contentType: 'audio/wav',
        text: 'segment',
      });

    const service = new PodcastService();
    const longTurn = 'Battery storage helps the grid absorb extra power. '.repeat(30).trim();
    const result = await service.synthesizeTurns(
      [{ speaker: 'Maya', text: longTurn }],
      [{ name: 'Maya', voiceId: 'hfc-female-rich' }],
      {
        silenceMs: 250,
        chunkMaxChars: 1600,
        ttsTimeoutMs: 180000,
      },
    );

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(piperTtsService.synthesize).toHaveBeenCalledTimes(3);
    expect(piperTtsService.synthesize).toHaveBeenNthCalledWith(1, expect.objectContaining({
      text: longTurn,
      voiceId: 'hfc-female-rich',
      timeoutMs: 180000,
    }));
    expect(piperTtsService.synthesize).toHaveBeenNthCalledWith(2, expect.objectContaining({
      voiceId: 'hfc-female-rich',
      timeoutMs: 180000,
    }));
    expect(piperTtsService.synthesize).toHaveBeenNthCalledWith(3, expect.objectContaining({
      voiceId: 'hfc-female-rich',
      timeoutMs: 180000,
    }));
    expect(piperTtsService.synthesize.mock.calls[1][0].text.length).toBeLessThan(longTurn.length);
    expect(piperTtsService.synthesize.mock.calls[2][0].text.length).toBeLessThan(longTurn.length);
  });

  test('retries transient script-generation connection failures before succeeding', async () => {
    const transientError = new Error('Connection terminated unexpectedly.');
    createResponse
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({
        output_text: JSON.stringify({
          title: 'Pets at Home',
          summary: 'A calmer take on pets clashing indoors.',
          turns: [
            { speaker: 'Maya', text: 'Today we are talking about what is really happening when cats and dogs clash in the house.' },
            { speaker: 'June', text: 'A lot of the time it is not pure aggression. It is stress, guarding, confusion, or over-arousal.' },
            { speaker: 'Maya', text: 'That matters because the fix depends on the trigger, not just the noise level of the conflict.' },
            { speaker: 'June', text: 'Owners often miss the early warning signs, like staring, blocking, stalking, or crowding around food and rest spots.' },
            { speaker: 'Maya', text: 'Management usually starts with creating distance and predictable routines so neither animal feels trapped.' },
            { speaker: 'June', text: 'Then you work on controlled exposure, reward calm behavior, and reduce the situations that keep setting them off.' },
            { speaker: 'Maya', text: 'The main takeaway is that coexistence gets better when the environment gets clearer and safer.' },
            { speaker: 'June', text: 'And if the fights are intense or escalating, that is the point to bring in a qualified behavior professional.' },
          ],
        }),
      });

    const service = new PodcastService();
    const executeTool = jest.fn(async (toolId) => {
      if (toolId === 'web-search') {
        return {
          success: true,
          data: {
            results: [
              { title: 'Pet behavior guide', url: 'https://example.com/pets', snippet: 'Behavior conflicts often come from stress and guarding.' },
            ],
          },
        };
      }

      if (toolId === 'web-fetch') {
        return {
          success: true,
          data: {
            headers: { 'content-type': 'text/html' },
            body: '<article><p>Stress, resource guarding, and poor introductions can trigger conflict between household pets.</p></article>',
          },
        };
      }

      throw new Error(`Unexpected tool: ${toolId}`);
    });

    const result = await service.createPodcast({
      topic: 'cats and dogs fighting in the house',
    }, {
      sessionId: 'session-1',
      clientSurface: 'chat',
      toolManager: { executeTool },
    });

    expect(createResponse).toHaveBeenCalledTimes(2);
    expect(result.script.turns).toHaveLength(8);
  });

  test('sanitizes malformed unicode from topics and fetched source text before script generation', async () => {
    const service = new PodcastService();
    const executeTool = jest.fn(async (toolId) => {
      if (toolId === 'web-search') {
        return {
          success: true,
          data: {
            results: [
              {
                title: `Pet conflicts \uD800 at home`,
                url: 'https://example.com/pets',
                snippet: `Stress signals can spike \uD800 before a fight.`,
              },
            ],
          },
        };
      }

      if (toolId === 'web-fetch') {
        return {
          success: true,
          data: {
            headers: { 'content-type': 'text/html' },
            body: `<article><p>Watch for crowding\uD800, blocking, and guarding around food.</p></article>`,
          },
        };
      }

      throw new Error(`Unexpected tool: ${toolId}`);
    });

    await service.createPodcast({
      topic: `cats and dogs fighting \uD800 in the house`,
    }, {
      sessionId: 'session-1',
      clientSurface: 'chat',
      toolManager: { executeTool },
    });

    const requestInput = createResponse.mock.calls[0][0].input;
    expect(requestInput).toContain('cats and dogs fighting in the house');
    expect(requestInput).not.toContain('\uD800');
  });
});
