'use strict';

const PRIMARY_HOST = '168.119.176.121';
const PRIMARY_TARGET = 'k3s-primary';
const ACTIONS = ['sync-repo', 'apply-manifests', 'set-image', 'rollout-status', 'sync-and-apply'];

function contract(_req, res) {
  res.set('Cache-Control', 'no-store').json({
    schema: 'LillyRemoteOps/v1',
    invoke: '/api/tools/invoke/remote-ops',
    authentication: 'Authorization: Bearer <existing Lilly API key or login token>',
    privilege: 'Uses existing Lilly operator permissions; this is not a separately scoped bot credential.',
    target: { host: PRIMARY_HOST, targetId: PRIMARY_TARGET, transport: 'provider-agent' },
    tools: ['remote-cli-agent', 'k3s-deploy'],
    deploymentActions: ACTIONS,
    sessions: '/api/sessions',
    upload: '/api/artifacts/upload',
    artifacts: '/api/sessions/{sessionId}/artifacts',
    download: '/api/artifacts/{artifactId}/download',
    toolDocs: '/api/tools/docs/{tool}',
    limits: { maxFiles: 12, maxFileBytes: 4194304, maxTotalFileBytes: 6291456 },
    continuation: 'Keep the outer Lilly sessionId. For a running result, use its remoteCodeJobId as params.jobId and task="Check status" in that same session. For a new follow-up turn use the returned provider sessionId as params.sessionId.',
    completion: 'HTTP success is transport success only. Inspect data.success and data.data completionStatus/blocker/resultFilesError; independently download and verify returned artifacts.',
    retry: 'Do not automatically retry a timed-out mutation. Inspect the Lilly session and existing remote job first; this synchronous endpoint does not provide idempotency keys.',
    example: { tool: 'remote-cli-agent', sessionId: '<Lilly session id>', params: { task: 'Inspect the requested project and report findings.', cwd: '/opt/kimibuilt', adminMode: false } },
  });
}

function normalizeRequest(req, res, next) {
  res.set('Cache-Control', 'no-store');
  const fail = message => res.status(400).json({ success: false, error: message });
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('A JSON object is required.');
  if (!['remote-cli-agent', 'k3s-deploy'].includes(body.tool)) return fail('Use remote-cli-agent or k3s-deploy.');
  if (typeof body.sessionId !== 'string' || !body.sessionId.trim()) return fail('Create a Lilly session first and provide sessionId.');
  if (!body.params || typeof body.params !== 'object' || Array.isArray(body.params)) return fail('params must be an object.');
  const params = { ...body.params };
  if (body.tool === 'remote-cli-agent') {
    if (typeof params.task !== 'string' || !params.task.trim()) return fail('params.task is required.');
    if (params.targetId && params.targetId !== PRIMARY_TARGET) return fail('This endpoint is pinned to the primary Codex target.');
    if (params.transport && params.transport !== 'provider-agent') return fail('Artifact sharing requires provider-agent transport.');
    if (['command', 'args', 'shell', 'executable'].some(key => key in params)) return fail('Use a task description, not raw shell fields.');
    if (params.model && !/^gpt-/.test(params.model)) return fail('Select a Codex GPT model for this endpoint.');
    Object.assign(params, { targetId: PRIMARY_TARGET, transport: 'provider-agent', model: params.model || 'gpt-5.6-luna' });
    params.agentRunTimeoutMs = Math.min(Math.max(Number(params.agentRunTimeoutMs) || 45000, 1000), 45000);
  } else {
    if (!ACTIONS.includes(params.action)) return fail('An explicit supported deployment action is required.');
    if (!params.namespace || !params.deployment) return fail('Explicit namespace and deployment are required.');
    if (params.host && params.host !== PRIMARY_HOST) return fail('This endpoint is pinned to the main server.');
    if ((params.username && params.username !== 'root') || (params.port && params.port !== 22)) return fail('Use the configured primary SSH identity.');
    const privateKeyPath = process.env.LILLY_REMOTE_OPS_SSH_KEY_PATH;
    if (!privateKeyPath) return res.status(503).json({ success: false, error: 'Dedicated primary deployment credential is not configured.' });
    req.remoteOpsSshCredentials = { [PRIMARY_HOST]: { host: PRIMARY_HOST, username: 'root', port: 22, privateKeyPath } };
    Object.assign(params, { host: PRIMARY_HOST, username: 'root', port: 22 });
  }
  req.body = { tool: body.tool, sessionId: body.sessionId.trim(), params, executionProfile: 'remote-build' };
  next();
}

module.exports = { contract, normalizeRequest };
