const fsSync = require('fs');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { config } = require('../config');
const { parseWavBuffer } = require('./wav-utils');
let ffmpegStaticPath = '';
try {
  ffmpegStaticPath = require('ffmpeg-static') || '';
} catch (_error) {
  ffmpegStaticPath = '';
}

function createServiceError(statusCode, message, code = 'audio_processing_error') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function isExplicitPath(value = '') {
  const normalized = String(value || '').trim();
  return Boolean(normalized)
    && (path.isAbsolute(normalized)
      || normalized.includes('/')
      || normalized.includes('\\')
      || /\.[a-z0-9]+$/i.test(normalized));
}

function escapeFilterValue(value = '') {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,');
}

function channelLayoutFor(numChannels = 1) {
  return Number(numChannels) === 2 ? 'stereo' : 'mono';
}

class AudioProcessingService {
  constructor(audioProcessingConfig = config.audioProcessing || {}, dependencies = {}) {
    this.audioProcessingConfig = {
      ...audioProcessingConfig,
    };
    this.spawn = dependencies.spawn || spawn;
    this.spawnSync = dependencies.spawnSync || spawnSync;
  }

  getEffectiveBinaryPath() {
    const configured = String(this.audioProcessingConfig.ffmpegBinaryPath || '').trim();
    if (configured && configured !== 'ffmpeg') {
      return configured;
    }

    if (ffmpegStaticPath) {
      return ffmpegStaticPath;
    }

    return configured || 'ffmpeg';
  }

  pathExists(targetPath = '') {
    const normalized = String(targetPath || '').trim();
    if (!normalized) {
      return false;
    }

    if (!isExplicitPath(normalized)) {
      return true;
    }

    try {
      return fsSync.existsSync(normalized);
    } catch (_error) {
      return false;
    }
  }

  getDiagnostics() {
    const enabled = this.audioProcessingConfig.enabled !== false;
    const binaryPath = this.getEffectiveBinaryPath();
    if (!enabled) {
      return {
        status: 'unavailable',
        binaryReachable: false,
        supportsMp3: false,
        supportsMixing: false,
        message: 'Audio post-processing is disabled.',
      };
    }

    if (!binaryPath) {
      return {
        status: 'misconfigured',
        binaryReachable: false,
        supportsMp3: false,
        supportsMixing: false,
        message: 'No ffmpeg binary path is configured.',
      };
    }

    if (isExplicitPath(binaryPath) && !this.pathExists(binaryPath)) {
      return {
        status: 'misconfigured',
        binaryReachable: false,
        supportsMp3: false,
        supportsMixing: false,
        message: `ffmpeg is missing at "${binaryPath}".`,
      };
    }

    try {
      const result = this.spawnSync(binaryPath, ['-version'], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      });
      if (result?.error) {
        throw result.error;
      }
      if (typeof result?.status === 'number' && result.status !== 0) {
        throw new Error(result.stderr || result.stdout || `ffmpeg exited with code ${result.status}.`);
      }

      return {
        status: 'ready',
        binaryReachable: true,
        supportsMp3: true,
        supportsMixing: true,
        message: 'ffmpeg audio post-processing is ready.',
      };
    } catch (error) {
      return {
        status: 'misconfigured',
        binaryReachable: false,
        supportsMp3: false,
        supportsMixing: false,
        message: error?.message || 'ffmpeg is not reachable.',
      };
    }
  }

  getPublicConfig() {
    const diagnostics = this.getDiagnostics();
    return {
      configured: diagnostics.status === 'ready',
      provider: 'ffmpeg',
      diagnostics,
      supportsMp3: diagnostics.supportsMp3 === true,
      supportsMixing: diagnostics.supportsMixing === true,
      defaults: {
        introPathConfigured: Boolean(this.audioProcessingConfig.podcastIntroPath),
        outroPathConfigured: Boolean(this.audioProcessingConfig.podcastOutroPath),
        musicBedPathConfigured: Boolean(this.audioProcessingConfig.podcastMusicBedPath),
        mp3BitrateKbps: Math.max(64, Number(this.audioProcessingConfig.mp3BitrateKbps) || 128),
      },
    };
  }

  assertConfigured() {
    const diagnostics = this.getDiagnostics();
    if (diagnostics.status === 'ready') {
      return;
    }

    throw createServiceError(
      503,
      diagnostics.message || 'Audio post-processing is unavailable.',
      'audio_processing_unavailable',
    );
  }

  resolveAssetPath(requestedPath = '', configuredPath = '', label = 'audio asset') {
    const candidate = String(requestedPath || configuredPath || '').trim();
    if (!candidate) {
      return '';
    }

    const resolved = path.resolve(candidate);
    if (!fsSync.existsSync(resolved)) {
      throw createServiceError(400, `${label} was not found at "${resolved}".`, 'audio_asset_missing');
    }

    return resolved;
  }

  async runFfmpeg(args = [], errorCode = 'audio_processing_failed', failureMessage = 'ffmpeg failed.') {
    this.assertConfigured();
    const binaryPath = this.getEffectiveBinaryPath();

    return new Promise((resolve, reject) => {
      const stderr = [];
      const stdout = [];
      const child = this.spawn(binaryPath, args, {
        windowsHide: true,
      });

      const timeoutMs = Math.max(1000, Number(this.audioProcessingConfig.timeoutMs) || 90000);
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(createServiceError(504, 'ffmpeg timed out while processing audio.', 'audio_processing_timeout'));
      }, timeoutMs);

      child.stdout?.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
      child.stderr?.on('data', (chunk) => stderr.push(Buffer.from(chunk)));

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(createServiceError(503, error.message || 'ffmpeg could not be started.', 'audio_processing_unavailable'));
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve({
            stdout: Buffer.concat(stdout).toString('utf8'),
            stderr: Buffer.concat(stderr).toString('utf8'),
          });
          return;
        }

        reject(createServiceError(
          502,
          `${failureMessage} ${Buffer.concat(stderr).toString('utf8').trim()}`.trim(),
          errorCode,
        ));
      });
    });
  }

  async transcodeWavToMp3({ wavBuffer, bitrateKbps } = {}) {
    if (!Buffer.isBuffer(wavBuffer) || wavBuffer.length === 0) {
      throw createServiceError(400, 'A WAV buffer is required for MP3 transcoding.', 'audio_processing_invalid_input');
    }

    this.assertConfigured();
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kimibuilt-podcast-mp3-'));
    const inputPath = path.join(tempDir, 'episode.wav');
    const outputPath = path.join(tempDir, 'episode.mp3');
    const bitrate = Math.max(64, Number(bitrateKbps || this.audioProcessingConfig.mp3BitrateKbps) || 128);

    try {
      await fs.writeFile(inputPath, wavBuffer);
      await this.runFfmpeg([
        '-y',
        '-i', inputPath,
        '-codec:a', 'libmp3lame',
        '-b:a', `${bitrate}k`,
        outputPath,
      ], 'audio_mp3_export_failed', 'ffmpeg failed to export MP3.');
      return await fs.readFile(outputPath);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  async composePodcastAudio({
    speechWavBuffer,
    includeIntro = false,
    includeOutro = false,
    includeMusicBed = false,
    introPath = '',
    outroPath = '',
    musicBedPath = '',
    speechVolume,
    musicVolume,
    introVolume,
    outroVolume,
  } = {}) {
    if (!Buffer.isBuffer(speechWavBuffer) || speechWavBuffer.length === 0) {
      throw createServiceError(400, 'A speech WAV buffer is required for podcast composition.', 'audio_processing_invalid_input');
    }

    const needsMix = includeIntro || includeOutro || includeMusicBed || introPath || outroPath || musicBedPath;
    if (!needsMix) {
      return speechWavBuffer;
    }

    this.assertConfigured();
    const format = parseWavBuffer(speechWavBuffer);
    const sampleRate = format.sampleRate;
    const channelLayout = channelLayoutFor(format.numChannels);
    const speechLevel = Number.isFinite(Number(speechVolume))
      ? Number(speechVolume)
      : (Number(this.audioProcessingConfig.podcastSpeechVolume) || 1);
    const introLevel = Number.isFinite(Number(introVolume))
      ? Number(introVolume)
      : (Number(this.audioProcessingConfig.podcastIntroVolume) || 1);
    const outroLevel = Number.isFinite(Number(outroVolume))
      ? Number(outroVolume)
      : (Number(this.audioProcessingConfig.podcastOutroVolume) || 1);
    const bedLevel = Number.isFinite(Number(musicVolume))
      ? Number(musicVolume)
      : (Number(this.audioProcessingConfig.podcastMusicVolume) || 0.22);
    const resolvedIntroPath = (includeIntro || Boolean(String(introPath || '').trim()))
      ? this.resolveAssetPath(introPath, this.audioProcessingConfig.podcastIntroPath, 'Podcast intro audio')
      : '';
    const resolvedOutroPath = (includeOutro || Boolean(String(outroPath || '').trim()))
      ? this.resolveAssetPath(outroPath, this.audioProcessingConfig.podcastOutroPath, 'Podcast outro audio')
      : '';
    const resolvedBedPath = (includeMusicBed || Boolean(String(musicBedPath || '').trim()))
      ? this.resolveAssetPath(musicBedPath, this.audioProcessingConfig.podcastMusicBedPath, 'Podcast music bed audio')
      : '';
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kimibuilt-podcast-compose-'));
    const speechPath = path.join(tempDir, 'speech.wav');
    const mixedSpeechPath = path.join(tempDir, 'speech-mixed.wav');
    const finalPath = path.join(tempDir, 'podcast-final.wav');

    try {
      await fs.writeFile(speechPath, speechWavBuffer);
      let currentPath = speechPath;

      if (resolvedBedPath) {
        const filter = [
          `[0:a]volume=${escapeFilterValue(bedLevel)},aresample=${sampleRate},aformat=sample_fmts=s16:channel_layouts=${channelLayout}[bed]`,
          `[1:a]volume=${escapeFilterValue(speechLevel)},aresample=${sampleRate},aformat=sample_fmts=s16:channel_layouts=${channelLayout}[speech]`,
          '[bed][speech]amix=inputs=2:duration=second:dropout_transition=0:normalize=0[a]',
        ].join(';');

        await this.runFfmpeg([
          '-y',
          '-stream_loop', '-1',
          '-i', resolvedBedPath,
          '-i', speechPath,
          '-filter_complex', filter,
          '-map', '[a]',
          '-c:a', 'pcm_s16le',
          mixedSpeechPath,
        ], 'audio_mix_failed', 'ffmpeg failed to mix the podcast music bed.');
        currentPath = mixedSpeechPath;
      }

      const concatInputs = [];
      const concatLevels = [];
      if (resolvedIntroPath) {
        concatInputs.push(resolvedIntroPath);
        concatLevels.push(introLevel);
      }
      concatInputs.push(currentPath);
      concatLevels.push(speechLevel);
      if (resolvedOutroPath) {
        concatInputs.push(resolvedOutroPath);
        concatLevels.push(outroLevel);
      }

      if (concatInputs.length === 1) {
        return await fs.readFile(currentPath);
      }

      const filterParts = concatInputs.map((_, index) => (
        `[${index}:a]volume=${escapeFilterValue(concatLevels[index])},aresample=${sampleRate},aformat=sample_fmts=s16:channel_layouts=${channelLayout}[a${index}]`
      ));
      const concatRefs = concatInputs.map((_, index) => `[a${index}]`).join('');
      filterParts.push(`${concatRefs}concat=n=${concatInputs.length}:v=0:a=1[a]`);

      const args = ['-y'];
      concatInputs.forEach((inputPath) => {
        args.push('-i', inputPath);
      });
      args.push(
        '-filter_complex', filterParts.join(';'),
        '-map', '[a]',
        '-c:a', 'pcm_s16le',
        finalPath,
      );

      await this.runFfmpeg(args, 'audio_concat_failed', 'ffmpeg failed to assemble the podcast intro/outro.');
      return await fs.readFile(finalPath);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}

const audioProcessingService = new AudioProcessingService();

module.exports = {
  AudioProcessingService,
  audioProcessingService,
  createServiceError,
};
