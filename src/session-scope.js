const DEFAULT_SESSION_SCOPE = 'global';

function normalizeScopeValue(value = '') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || null;
}

function firstNormalizedValue(candidates = []) {
  for (const candidate of candidates) {
    const normalized = normalizeScopeValue(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function getPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function hasSessionScopeHints(value = {}) {
  const source = getPlainObject(value);
  const nested = getPlainObject(source.metadata);

  return [
    source.memoryScope,
    source.memory_scope,
    source.projectScope,
    source.project_scope,
    source.projectId,
    source.project_id,
    source.projectKey,
    source.project_key,
    source.workspaceId,
    source.workspace_id,
    source.workspaceKey,
    source.workspace_key,
    source.namespace,
    source.clientSurface,
    source.client_surface,
    source.taskType,
    source.task_type,
    source.mode,
    nested.memoryScope,
    nested.memory_scope,
    nested.projectScope,
    nested.project_scope,
    nested.projectId,
    nested.project_id,
    nested.projectKey,
    nested.project_key,
    nested.workspaceId,
    nested.workspace_id,
    nested.workspaceKey,
    nested.workspace_key,
    nested.namespace,
    nested.clientSurface,
    nested.client_surface,
    nested.taskType,
    nested.task_type,
    nested.mode,
  ].some((candidate) => Boolean(normalizeScopeValue(candidate)));
}

function resolveClientSurface(value = {}, session = null, fallback = '') {
  const source = getPlainObject(value);
  const nested = getPlainObject(source.metadata);
  const sessionMetadata = getPlainObject(session?.metadata);

  return firstNormalizedValue([
    source.clientSurface,
    source.client_surface,
    nested.clientSurface,
    nested.client_surface,
    sessionMetadata.clientSurface,
    sessionMetadata.client_surface,
    fallback,
  ]) || '';
}

function resolveSessionScope(value = {}, session = null) {
  const source = getPlainObject(value);
  const nested = getPlainObject(source.metadata);
  const sessionMetadata = getPlainObject(session?.metadata);

  return firstNormalizedValue([
    source.memoryScope,
    source.memory_scope,
    source.projectScope,
    source.project_scope,
    source.projectId,
    source.project_id,
    source.projectKey,
    source.project_key,
    source.workspaceId,
    source.workspace_id,
    source.workspaceKey,
    source.workspace_key,
    source.namespace,
    nested.memoryScope,
    nested.memory_scope,
    nested.projectScope,
    nested.project_scope,
    nested.projectId,
    nested.project_id,
    nested.projectKey,
    nested.project_key,
    nested.workspaceId,
    nested.workspace_id,
    nested.workspaceKey,
    nested.workspace_key,
    nested.namespace,
    sessionMetadata.memoryScope,
    sessionMetadata.memory_scope,
    sessionMetadata.projectScope,
    sessionMetadata.project_scope,
    sessionMetadata.projectId,
    sessionMetadata.project_id,
    sessionMetadata.projectKey,
    sessionMetadata.project_key,
    sessionMetadata.workspaceId,
    sessionMetadata.workspace_id,
    sessionMetadata.workspaceKey,
    sessionMetadata.workspace_key,
    sessionMetadata.namespace,
    resolveClientSurface(source, session),
    source.taskType,
    source.task_type,
    nested.taskType,
    nested.task_type,
    sessionMetadata.taskType,
    sessionMetadata.task_type,
    source.mode,
    nested.mode,
    sessionMetadata.mode,
  ]) || DEFAULT_SESSION_SCOPE;
}

function buildScopedSessionMetadata(metadata = {}, session = null) {
  const source = getPlainObject(metadata);
  const clientSurface = resolveClientSurface(source, session);
  const memoryScope = resolveSessionScope(source, session);

  return {
    ...source,
    ...(clientSurface ? { clientSurface } : {}),
    memoryScope,
  };
}

function normalizeSessionScopeKey(scopeKey = '') {
  return normalizeScopeValue(scopeKey) || DEFAULT_SESSION_SCOPE;
}

function sessionMatchesScope(session = null, scopeKey = DEFAULT_SESSION_SCOPE) {
  if (!session) {
    return false;
  }

  return resolveSessionScope(session?.metadata || {}, session) === normalizeSessionScopeKey(scopeKey);
}

module.exports = {
  DEFAULT_SESSION_SCOPE,
  buildScopedSessionMetadata,
  hasSessionScopeHints,
  normalizeSessionScopeKey,
  resolveClientSurface,
  resolveSessionScope,
  sessionMatchesScope,
};
