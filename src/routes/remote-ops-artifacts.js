'use strict';
const crypto = require('crypto');
const path = require('path').posix;
const { createZip } = require('../utils/zip');
const { resolveArtifactContextFiles } = require('../remote-cli/agent-handoff');
const MAX_FILES = 64; const MAX_FILE = 4 * 1024 * 1024; const MAX_TOTAL = 6 * 1024 * 1024;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function invalid(message, statusCode = 400) { return Object.assign(new Error(message), { statusCode }); }
function filename(value) {
  if (typeof value !== 'string' || value.length > 240 || !/^[a-zA-Z0-9_. /-]+$/.test(value) || value.startsWith('/') || value.split('/').some(s => !s || s === '.' || s === '..')) throw invalid('Use a safe relative filename without traversal or special characters.');
  return value;
}
function decode(file) {
  const name = filename(file.filename);
  if ((typeof file.content === 'string') === (typeof file.contentBase64 === 'string')) throw invalid('Provide exactly one of content or contentBase64.');
  let bytes;
  if (typeof file.content === 'string') bytes = Buffer.from(file.content);
  else {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.contentBase64)) throw invalid('Invalid base64.');
    bytes = Buffer.from(file.contentBase64, 'base64');
  }
  if (bytes.length > MAX_FILE) throw invalid('A file exceeds 4 MiB.', 413);
  if (file.sha256 !== undefined && file.sha256 !== hash(bytes)) throw invalid('File SHA-256 mismatch.');
  return { name, bytes, mimeType: typeof file.mimeType === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(file.mimeType) ? file.mimeType : 'application/octet-stream' };
}
function descriptor(a) {
  return { id: a.id, filename: a.metadata?.sharedPath || a.metadata?.remoteRelativePath || a.filename, mimeType: a.mimeType, sizeBytes: a.sizeBytes, sha256: a.sha256, direction: a.direction, downloadUrl: `/api/artifacts/${a.id}/download` };
}
async function executeArtifactAction(params, session, artifactService) {
  const sessionId = session.id;
  const read = async id => {
    const a = await artifactService.getArtifact(id);
    if (!a || a.sessionId !== sessionId) throw invalid('Artifact not found in this session.', 404);
    if (a.sizeBytes > MAX_FILE) throw invalid('File exceeds the 4 MiB bulk limit; use its download endpoint.', 413);
    const full = await artifactService.getArtifact(id, { includeContent: true });
    if (!full || full.sessionId !== sessionId || !Buffer.isBuffer(full.contentBuffer)) throw invalid('Artifact bytes unavailable.', 503);
    if (full.contentBuffer.length > MAX_FILE) throw invalid('File exceeds the bulk limit.', 413);
    return full;
  };
  const save = async (file, metadata = {}, direction = 'uploaded') => {
    const a = await artifactService.createStoredArtifact({ sessionId, session, ownerId: session.metadata?.ownerId, direction, sourceMode: 'remote-ops', filename: path.basename(file.name), extension: path.extname(file.name).slice(1), mimeType: file.mimeType, buffer: file.bytes, vectorize: false, metadata: { sharedPath: file.name, remoteRelativePath: file.name, ...metadata } });
    const persisted = await read(a.id);
    if (hash(persisted.contentBuffer) !== hash(file.bytes)) throw invalid('Stored artifact checksum mismatch.', 503);
    return descriptor(persisted);
  };
  if (params.action === 'list') {
    const all = await artifactService.listSessionArtifacts(sessionId);
    const offset = params.offset ?? 0; const limit = params.limit ?? 64;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 64) throw invalid('Invalid offset/limit.');
    return { files: all.slice(offset, offset + limit).map(descriptor), total: all.length, nextOffset: offset + limit < all.length ? offset + limit : null };
  }
  if (params.action === 'put') {
    if (!Array.isArray(params.files) || !params.files.length || params.files.length > MAX_FILES) throw invalid('Put accepts 1-64 files per batch.');
    const files = params.files.map(decode);
    if (new Set(files.map(f => f.name.toLowerCase())).size !== files.length) throw invalid('Duplicate filenames in batch.');
    if (files.reduce((n, f) => n + f.bytes.length, 0) > MAX_TOTAL) throw invalid('Batch exceeds 6 MiB.', 413);
    const saved = [];
    try { for (const file of files) saved.push(await save(file)); }
    catch (e) { for (const a of saved) await artifactService.deleteArtifact(a.id).catch(() => {}); throw e; }
    return { files: saved, sharedSessionId: sessionId };
  }
  if (!Array.isArray(params.artifactIds) || !params.artifactIds.length || params.artifactIds.length > MAX_FILES || params.artifactIds.some(id => typeof id !== 'string') || new Set(params.artifactIds).size !== params.artifactIds.length) throw invalid('Select 1-64 distinct artifactIds.');
  const files = []; let size = 0;
  for (const id of params.artifactIds) {
    const a = await read(id); size += a.contentBuffer.length;
    if (size > MAX_TOTAL) throw invalid('Selected bytes exceed 6 MiB; use multiple batches.', 413);
    files.push(a);
  }
  if (params.action === 'get') return { files: files.map(a => ({ ...descriptor(a), sha256: hash(a.contentBuffer), contentBase64: a.contentBuffer.toString('base64') })) };
  // Reuse the handoff's privacy export gate before turning uploaded inputs into a bundle.
  for (const a of files) await resolveArtifactContextFiles([a.id], { sessionId, session }, artifactService);
  const entries = files.map(a => ({ name: filename(descriptor(a).filename), data: a.contentBuffer }));
  if (new Set(entries.map(e => e.name.toLowerCase())).size !== entries.length) throw invalid('Select only one version of each path for a bundle.');
  const bytes = createZip(entries);
  if (bytes.length > MAX_FILE) throw invalid('Bundle exceeds 4 MiB; create smaller bundles.', 413);
  const name = filename(params.filename || 'shared-project.zip');
  if (!name.endsWith('.zip')) throw invalid('Bundle filename must end in .zip.');
  const artifact = await save({ name, bytes, mimeType: 'application/zip' }, { sourceArtifactIds: params.artifactIds, sharedBundle: { files: files.map(descriptor) } }, 'generated');
  return { artifact, artifactIds: [artifact.id], files: files.map(descriptor), instruction: 'Pass this ZIP artifactId to Codex. It contains the selected relative paths; inspect before extracting into the project workspace.' };
}
module.exports = { executeArtifactAction, descriptor, invalid, hash };
