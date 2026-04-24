'use strict';

const crypto = require('crypto');

const CAPABILITY_PROFILES = Object.freeze(['inspect', 'deploy', 'build', 'admin']);
const JOB_STATUSES = Object.freeze(['queued', 'sent', 'running', 'completed', 'failed', 'timeout']);

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
    metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {},
  };
}

function normalizeCommandJob(input = {}) {
  const command = normalizeText(input.command);
  if (!command) {
    throw new Error('job.command is required');
  }

  return {
    id: normalizeText(input.id) || createId('job'),
    type: 'command',
    command,
    cwd: normalizeText(input.cwd || input.workingDirectory),
    environment: input.environment && typeof input.environment === 'object' ? { ...input.environment } : {},
    timeout: Math.max(1000, Number(input.timeout) || 120000),
    profile: CAPABILITY_PROFILES.includes(normalizeText(input.profile)) ? normalizeText(input.profile) : 'inspect',
    approval: input.approval && typeof input.approval === 'object' ? { ...input.approval } : {},
    metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {},
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
  normalizeJobResult,
  normalizeRunnerRegistration,
  normalizeText,
  truncateText,
  uniqueStrings,
};
