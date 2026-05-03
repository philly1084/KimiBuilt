const fs = require('fs/promises');
const path = require('path');
const { getStateDirectory } = require('../../runtime-state-paths');

const CATEGORIES = {
  generatedArtifacts: {
    label: 'Generated artifacts',
    directory: 'generated-artifacts',
    contentPathKey: 'contentPath',
  },
  generatedAudio: {
    label: 'Generated audio',
    directory: 'generated-audio',
    contentPathKey: 'audioPath',
  },
  generatedVideo: {
    label: 'Generated video',
    directory: 'generated-video',
    contentPathKey: 'videoPath',
  },
};

function getDataDirectory() {
  const configured = String(process.env.KIMIBUILT_DATA_DIR || '').trim();
  return configured ? path.resolve(configured) : getStateDirectory();
}

function formatCategory(category = '') {
  const normalized = String(category || '').trim();
  return CATEGORIES[normalized] ? normalized : '';
}

function safeNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizeDate(value, fallback = null) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function statSize(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return {
      bytes: stat.size,
      mtimeMs: stat.mtimeMs,
      mtime: stat.mtime.toISOString(),
    };
  } catch (_error) {
    return {
      bytes: 0,
      mtimeMs: 0,
      mtime: null,
    };
  }
}

async function readDirectoryEntries(directory) {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function resolveRecordPath(directory, recordPath = '') {
  const resolvedDirectory = path.resolve(directory);
  const resolvedPath = path.resolve(String(recordPath || ''));
  return isInside(resolvedDirectory, resolvedPath) ? resolvedPath : '';
}

async function findContentPath(directory, id, entries) {
  const prefix = `${id}.`;
  const match = entries.find((entry) => (
    entry.isFile()
    && entry.name.startsWith(prefix)
    && entry.name !== `${id}.json`
  ));
  return match ? path.join(directory, match.name) : '';
}

async function scanCategory(category) {
  const definition = CATEGORIES[category];
  const directory = path.join(getDataDirectory(), definition.directory);
  const entries = await readDirectoryEntries(directory);
  const records = [];
  const claimedPaths = new Set();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const metadataPath = path.join(directory, entry.name);
    let record = null;
    try {
      record = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    } catch (_error) {
      record = {};
    }

    const id = String(record.id || path.basename(entry.name, '.json')).trim();
    if (!id) {
      continue;
    }

    const metadataStats = await statSize(metadataPath);
    const explicitContentPath = resolveRecordPath(directory, record[definition.contentPathKey]);
    const contentPath = explicitContentPath || await findContentPath(directory, id, entries);
    const contentStats = contentPath ? await statSize(contentPath) : { bytes: 0, mtimeMs: 0, mtime: null };
    claimedPaths.add(path.resolve(metadataPath));
    if (contentPath) {
      claimedPaths.add(path.resolve(contentPath));
    }

    const updatedAt = normalizeDate(record.updatedAt, contentStats.mtime || metadataStats.mtime);
    records.push({
      id,
      category,
      label: definition.label,
      filename: String(record.filename || path.basename(contentPath || metadataPath)).trim(),
      sessionId: String(record.sessionId || '').trim() || null,
      mimeType: String(record.mimeType || '').trim() || null,
      createdAt: normalizeDate(record.createdAt, updatedAt),
      updatedAt,
      sizeBytes: safeNumber(record.sizeBytes, contentStats.bytes),
      diskBytes: contentStats.bytes + metadataStats.bytes,
      contentBytes: contentStats.bytes,
      metadataBytes: metadataStats.bytes,
      files: [contentPath, metadataPath].filter(Boolean),
      storage: record.metadata?.storage || 'local',
    });
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const orphanPath = path.resolve(directory, entry.name);
    if (claimedPaths.has(orphanPath)) {
      continue;
    }

    const stats = await statSize(orphanPath);
    records.push({
      id: entry.name,
      category,
      label: definition.label,
      filename: entry.name,
      sessionId: null,
      mimeType: null,
      createdAt: stats.mtime,
      updatedAt: stats.mtime,
      sizeBytes: stats.bytes,
      diskBytes: stats.bytes,
      contentBytes: stats.bytes,
      metadataBytes: 0,
      files: [orphanPath],
      storage: 'orphan',
    });
  }

  records.sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''));
  const totalBytes = records.reduce((sum, record) => sum + record.diskBytes, 0);

  return {
    category,
    label: definition.label,
    directory,
    count: records.length,
    totalBytes,
    records,
  };
}

function serializeCategory(result, { includeRecords = true, limit = 100 } = {}) {
  return {
    category: result.category,
    label: result.label,
    directory: result.directory,
    count: result.count,
    totalBytes: result.totalBytes,
    records: includeRecords
      ? result.records.slice(0, limit).map(({ files, ...record }) => ({
        ...record,
        fileCount: files.length,
      }))
      : undefined,
  };
}

async function list(req, res, next) {
  try {
    const limit = Math.max(1, Math.min(500, safeNumber(req.query.limit, 100)));
    const results = await Promise.all(Object.keys(CATEGORIES).map((category) => scanCategory(category)));
    res.json({
      success: true,
      data: {
        dataDirectory: getDataDirectory(),
        totalBytes: results.reduce((sum, result) => sum + result.totalBytes, 0),
        totalCount: results.reduce((sum, result) => sum + result.count, 0),
        categories: results.map((result) => serializeCategory(result, { limit })),
      },
    });
  } catch (error) {
    next(error);
  }
}

async function remove(req, res, next) {
  try {
    const category = formatCategory(req.params.category);
    if (!category) {
      return res.status(400).json({ success: false, error: 'Unknown storage category.' });
    }

    const id = String(req.params.id || '').trim();
    const result = await scanCategory(category);
    const record = result.records.find((item) => item.id === id);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Stored file not found.' });
    }

    for (const filePath of record.files) {
      await fs.rm(filePath, { force: true });
    }

    res.json({
      success: true,
      data: {
        deleted: 1,
        deletedBytes: record.diskBytes,
        record: {
          id: record.id,
          category: record.category,
          filename: record.filename,
          diskBytes: record.diskBytes,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

async function cleanup(req, res, next) {
  try {
    const category = formatCategory(req.body?.category || req.query.category || '');
    const categories = category ? [category] : Object.keys(CATEGORIES);
    const olderThanDays = Math.max(1, Math.min(3650, safeNumber(req.body?.olderThanDays, 30)));
    const dryRun = req.body?.dryRun !== false;
    const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    const deleted = [];

    for (const currentCategory of categories) {
      const result = await scanCategory(currentCategory);
      const expired = result.records.filter((record) => {
        const timestamp = Date.parse(record.updatedAt || record.createdAt || '');
        return Number.isFinite(timestamp) && timestamp < cutoff;
      });

      for (const record of expired) {
        if (!dryRun) {
          for (const filePath of record.files) {
            await fs.rm(filePath, { force: true });
          }
        }

        deleted.push({
          id: record.id,
          category: record.category,
          filename: record.filename,
          diskBytes: record.diskBytes,
          updatedAt: record.updatedAt,
        });
      }
    }

    res.json({
      success: true,
      data: {
        dryRun,
        olderThanDays,
        deletedCount: dryRun ? 0 : deleted.length,
        matchedCount: deleted.length,
        matchedBytes: deleted.reduce((sum, record) => sum + record.diskBytes, 0),
        records: deleted,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  cleanup,
  list,
  remove,
  _private: {
    scanCategory,
  },
};
