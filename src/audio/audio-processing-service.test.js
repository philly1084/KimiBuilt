const fs = require('fs/promises');
const { AudioProcessingService } = require('./audio-processing-service');
const { writeWavBuffer } = require('./wav-utils');

function createTestWav(bytes = [0, 0, 0, 0]) {
  return writeWavBuffer({
    sampleRate: 22050,
    bitsPerSample: 16,
    numChannels: 1,
    data: Buffer.from(bytes),
  });
}

describe('AudioProcessingService', () => {
  test('mixes podcast music bed with a valid amix duration mode', async () => {
    const speechWavBuffer = createTestWav();
    const service = new AudioProcessingService({
      enabled: true,
      ffmpegBinaryPath: 'ffmpeg',
      podcastMasteringEnabled: false,
    });

    const runFfmpeg = jest.spyOn(service, 'runFfmpeg').mockImplementation(async (args) => {
      await fs.writeFile(args[args.length - 1], speechWavBuffer);
    });

    await service.composePodcastAudio({
      speechWavBuffer,
      includeMusicBed: true,
      enhanceSpeech: false,
    });

    const mixArgs = runFfmpeg.mock.calls
      .map(([args]) => args)
      .find((args) => args.includes('-filter_complex') && args.join(' ').includes('[bed][speech]'));
    const filterIndex = mixArgs.indexOf('-filter_complex') + 1;

    expect(mixArgs[filterIndex]).toContain('amix=inputs=2:duration=shortest');
    expect(mixArgs[filterIndex]).toContain('alimiter=limit=0.95');
    expect(mixArgs[filterIndex]).not.toContain('duration=second');
  });
});
