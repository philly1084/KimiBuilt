'use strict';

const crypto = require('crypto');

const CAPABILITY_PROFILES = Object.freeze(['inspect', 'deploy', 'build', 'admin']);
const JOB_STATUSES = Object.freeze(['queued', 'sent', 'running', 'completed', 'failed', 'timeout']);
const MAX_CONTEXT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_CONTEXT_FILES = 16;
const MAX_CONTEXT_TOTAL_BYTES = 24 * 1024 * 1024;

function normalizeText(value = '') {
  return String(value || '').trim();
}

function uniqueStrings(values = []) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizeText(value))
      .filter(Boolean),
  ));
}

function normalizeCliToolInventory(value = []) {
  const entries = Array.isArray(value) ? value : [];
  const seen = new Set();
  return entries
    .map((entry) => {
      if (typeof entry === 'string') {
        return {
          name: normalizeText(entry),
          available: true,
          path: '',
        };
      }

      if (!entry || typeof entry !== 'object') {
        return null;
      }

      return {
        name: normalizeText(entry.name || entry.id || entry.command),
        available: entry.available !== false,
        path: normalizeText(entry.path || entry.bin || entry.executable),
      };
    })
    .filter((entry) => {
      if (!entry?.name) {
        return false;
      }
      const key = entry.name.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function normalizeRunnerMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }

  const cliTools = normalizeCliToolInventory(metadata.cliTools || metadata.cli_tools || []);
  const availableCliTools = uniqueStrings([
    ...uniqueStrings(metadata.availableCliTools || metadata.available_cli_tools),
    ...cliTools.filter((tool) => tool.available).map((tool) => tool.name),
  ]);

  return {
    ...metadata,
    ...(cliTools.length > 0 ? { cliTools } : {}),
    ...(availableCliTools.length > 0 ? { availableCliTools } : {}),
  };
}

function createId(prefix = 'id') {
  return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}`;
}

function truncateText(value = '', maxLength = 120000) {
  const text = String(value || '');
  const limit = Math.max(1000, Number(maxLength) || 120000);
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} chars]`;
}

function sanitizeContextFilename(value = '', fallback = 'context.txt') {
  const raw = normalizeText(value)
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop() || '';
  const normalized = raw
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .slice(0, 160)
    .trim();
  return normalized || fallback;
}

function sanitizeContextDirectorySegment(value = '') {
  const normalized = normalizeText(value);
  if (!normalized || normalized === '.' || normalized === '..') {
    return '';
  }
  return normalized
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 160)
    .trim();
}

function normalizeContextDirectory(value = '', fallback = '.kimibuilt/context') {
  const normalized = normalizeText(value || fallback)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => sanitizeContextDirectorySegment(segment))
    .filter(Boolean)
    .join('/');
  return normalized || fallback;
}

function normalizeContextFiles(value = []) {
  const files = Array.isArray(value) ? value : [];
  const normalized = [];
  let totalBytes = 0;

  for (let index = 0; index < files.length && normalized.length < MAX_CONTEXT_FILES; index += 1) {
    const entry = files[index];
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const filename = sanitizeContextFilename(
      entry.filename || entry.name || entry.path,
      `context-${index + 1}.txt`,
    );
    const contentBase64 = normalizeText(entry.contentBase64 || entry.base64 || entry.dataBase64);
    const content = Object.prototype.hasOwnProperty.call(entry, 'content')
      ? String(entry.content ?? '')
      : '';
    const buffer = contentBase64
      ? Buffer.from(contentBase64, 'base64')
      : Buffer.from(content, 'utf8');

    if (buffer.length <= 0 || buffer.length > MAX_CONTEXT_FILE_BYTES) {
      continue;
    }

    if (totalBytes + buffer.length > MAX_CONTEXT_TOTAL_BYTES) {
      break;
    }

    totalBytes += buffer.length;
    normalized.push({
      filename,
      mimeType: normalizeText(entry.mimeType || entry.contentType) || 'application/octet-stream',
      sizeBytes: buffer.length,
      contentBase64: buffer.toString('base64'),
      source: normalizeText(entry.source),
      sourceUrl: normalizeText(entry.sourceUrl || entry.url),
      artifactId: normalizeText(entry.artifactId),
      sha256: normalizeText(entry.sha256),
      description: normalizeText(entry.description || entry.label),
    });
  }

  return normalized;
}

function normalizeRunnerRegistration(input = {}) {
  const runnerId = normalizeText(input.runnerId || input.id);
  if (!runnerId) {
    throw new Error('runnerId is required');
  }

  const capabilities = uniqueStrings(input.capabilities || input.capabilityProfiles)
    .filter((capability) => CAPABILITY_PROFILES.includes(capability));

  return {
    runnerId,
    displayName: normalizeText(input.displayName || input.name) || runnerId,
    hostIdentity: input.hostIdentity && typeof input.hostIdentity === 'object'
      ? { ...input.hostIdentity }
      : {},
    capabilities: capabilities.length > 0 ? capabilities : ['inspect'],
    allowedRoots: uniqueStrings(input.allowedRoots),
    metadata: normalizeRunnerMetadata(input.metadata),
  };
}

function normalizeCommandJob(input = {}) {
  const command = normalizeText(input.command);
  if (!command) {
    throw new Error('job.command is required');
  }

  const metadata = input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {};
  const contextFiles = normalizeContextFiles(input.contextFiles || metadata.contextFiles || metadata.context_files || []);
  const contextDirectory = normalizeContextDirectory(input.contextDirectory || metadata.contextDirectory || metadata.context_directory);

  return {
    id: normalizeText(input.id) || createId('job'),
    type: 'command',
    command,
    cwd: normalizeText(input.cwd || input.workingDirectory),
    environment: input.environment && typeof input.environment === 'object' ? { ...input.environment } : {},
    timeout: Math.max(1000, Number(input.timeout) || 120000),
    profile: CAPABILITY_PROFILES.includes(normalizeText(input.profile)) ? normalizeText(input.profile) : 'inspect',
    approval: input.approval && typeof input.approval === 'object' ? { ...input.approval } : {},
    metadata: {
      ...metadata,
      ...(contextFiles.length > 0 ? { contextFiles, contextDirectory } : {}),
    },
  };
}

function normalizeJobResult(input = {}, options = {}) {
  return {
    jobId: normalizeText(input.jobId || input.id),
    stdout: truncateText(input.stdout || '', options.maxOutputChars),
    stderr: truncateText(input.stderr || '', options.maxOutputChars),
    exitCode: Number.isFinite(Number(input.exitCode)) ? Number(input.exitCode) : 0,
    duration: Math.max(0, Number(input.duration) || 0),
    host: normalizeText(input.host),
    startedAt: normalizeText(input.startedAt),
    finishedAt: normalizeText(input.finishedAt) || new Date().toISOString(),
    error: normalizeText(input.error),
    metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {},
  };
}

function isDangerousCommand(command = '') {
  const normalized = String(command || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return [
    /\bsudo\b/,
    /\b(?:apt|apt-get|dnf|yum|apk|pacman)\s+(?:install|remove|upgrade|dist-upgrade)\b/,
    /\brm\s+-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)\b/,
    /\bsystemctl\s+(?:start|stop|restart|reload|enable|disable|mask|unmask)\b/,
    /\bkubectl\s+(?:delete|patch|replace)\s+secret\b/,
    /\bkubectl\s+create\s+secret\b/,
    /\bkubectl\s+apply\b[\s\S]*\bkind:\s*Secret\b/i,
  ].some((pattern) => pattern.test(normalized));
}

function isApproved(job = {}) {
  return job?.approval?.approved === true || job?.metadata?.approved === true;
}

module.exports = {
  CAPABILITY_PROFILES,
  JOB_STATUSES,
  createId,
  isApproved,
  isDangerousCommand,
  normalizeCommandJob,
  normalizeCliToolInventory,
  normalizeJobResult,
  normalizeRunnerRegistration,
  normalizeRunnerMetadata,
  normalizeContextDirectory,
  normalizeContextFiles,
  normalizeText,
  sanitizeContextFilename,
  truncateText,
  uniqueStrings,
};
