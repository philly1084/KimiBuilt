const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { parseMultipartRequest } = require('../../utils/multipart');
const { getStateDirectory } = require('../../runtime-state-paths');
const { audioProcessingService } = require('../../audio/audio-processing-service');
const settingsController = require('./settings.controller');

const TRACKS = {
  intro: {
    label: 'Intro',
    configKey: 'podcastIntroPath',
  },
  outro: {
    label: 'Outro',
    configKey: 'podcastOutroPath',
  },
  musicBed: {
    label: 'Music bed',
    configKey: 'podcastMusicBedPath',
  },
};

const ALLOWED_EXTENSIONS = new Set(['.aac', '.aiff', '.flac', '.m4a', '.mp3', '.ogg', '.wav']);
const MAX_AUDIO_UPLOAD_BYTES = 100 * 1024 * 1024;

function getStorageDirectory() {
  return path.join(getStateDirectory(), 'podcast-audio');
}

function normalizeTrack(track = '') {
  const normalized = String(track || '').trim();
  return TRACKS[normalized] ? normalized : '';
}

function sanitizeFilename(filename = '') {
  const parsed = path.parse(String(filename || 'track.wav'));
  const base = parsed.name
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'track';
  const ext = parsed.ext.toLowerCase();
  return `${base}${ALLOWED_EXTENSIONS.has(ext) ? ext : '.wav'}`;
}

function getStoredAssets() {
  return settingsController.settings.audioProcessing?.podcastAssets || {};
}

function getTrackPayload(track) {
  const stored = getStoredAssets()[track] || {};
  const pathValue = stored.path || settingsController.settings.audioProcessing?.[TRACKS[track].configKey] || '';
  return {
    ...stored,
    track,
    label: TRACKS[track].label,
    path: pathValue,
    configured: Boolean(pathValue),
    exists: Boolean(pathValue && fsSync.existsSync(pathValue)),
  };
}

function buildRuntimePatch() {
  const audioSettings = settingsController.settings.audioProcessing || {};
  return Object.values(TRACKS).reduce((patch, track) => {
    patch[track.configKey] = audioSettings[track.configKey] || '';
    return patch;
  }, {});
}

async function persistTrack(track, metadata = null) {
  if (!settingsController.settings.audioProcessing) {
    settingsController.settings.audioProcessing = {};
  }
  if (!settingsController.settings.audioProcessing.podcastAssets) {
    settingsController.settings.audioProcessing.podcastAssets = {};
  }

  const configKey = TRACKS[track].configKey;
  if (metadata) {
    settingsController.settings.audioProcessing.podcastAssets[track] = metadata;
    settingsController.settings.audioProcessing[configKey] = metadata.path;
  } else {
    delete settingsController.settings.audioProcessing.podcastAssets[track];
    settingsController.settings.audioProcessing[configKey] = '';
  }

  audioProcessingService.updateConfig(buildRuntimePatch());
  await settingsController.saveSettings();
}

function list(_req, res) {
  res.json({
    success: true,
    data: buildListPayload(),
  });
}

function buildListPayload() {
  return {
    storageDirectory: getStorageDirectory(),
    tracks: Object.keys(TRACKS).reduce((items, track) => {
      items[track] = getTrackPayload(track);
      return items;
    }, {}),
  };
}

async function upload(req, res) {
  const track = normalizeTrack(req.params.track);
  if (!track) {
    res.status(400).json({ success: false, error: 'Unknown podcast audio track.' });
    return;
  }

  try {
    const { file } = await parseMultipartRequest(req, { maxBytes: MAX_AUDIO_UPLOAD_BYTES });
    if (!file?.buffer?.length) {
      res.status(400).json({ success: false, error: 'Upload an audio file.' });
      return;
    }

    const ext = path.extname(file.filename || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      res.status(400).json({ success: false, error: 'Supported audio formats: WAV, MP3, M4A, AAC, OGG, FLAC, AIFF.' });
      return;
    }

    const storageDirectory = getStorageDirectory();
    await fs.mkdir(storageDirectory, { recursive: true });
    const filename = `${track}-${Date.now()}-${sanitizeFilename(file.filename)}`;
    const targetPath = path.join(storageDirectory, filename);
    await fs.writeFile(targetPath, file.buffer);

    const metadata = {
      track,
      label: TRACKS[track].label,
      filename,
      originalFilename: file.filename || filename,
      mimeType: file.mimeType || 'application/octet-stream',
      size: file.size || file.buffer.length,
      path: targetPath,
      uploadedAt: new Date().toISOString(),
    };

    await persistTrack(track, metadata);

    res.json({
      success: true,
      data: buildListPayload(),
    });
  } catch (error) {
    res.status(error.message === 'Multipart body too large' ? 413 : 500).json({
      success: false,
      error: error.message || 'Podcast audio upload failed.',
    });
  }
}

async function remove(req, res) {
  const track = normalizeTrack(req.params.track);
  if (!track) {
    res.status(400).json({ success: false, error: 'Unknown podcast audio track.' });
    return;
  }

  const current = getTrackPayload(track);
  await persistTrack(track, null);

  const storageDirectory = path.resolve(getStorageDirectory());
  const currentPath = current.path ? path.resolve(current.path) : '';
  if (currentPath && currentPath.startsWith(storageDirectory + path.sep)) {
    await fs.rm(currentPath, { force: true });
  }

  res.json({
    success: true,
    data: buildListPayload(),
  });
}

module.exports = {
  list,
  remove,
  upload,
};
