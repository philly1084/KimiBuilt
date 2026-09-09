'use strict';
const TARGETS = {
  'k3s-primary': { host: '168.119.176.121', domain: 'secdevsolutions.help', cwd: '/opt/lilly-agent-workbench' },
  'k3s-secondary': { host: '162.55.163.199', domain: 'demoserver2.buzz', cwd: '/opt/kimibuilt' },
};
const ACTIONS = ['sync-repo', 'apply-manifests', 'set-image', 'rollout-status', 'sync-and-apply'];
const DEFAULT_MODEL = 'gpt-5.6-luna';
const terminal = status => ['complete', 'completed', 'failed', 'blocked', 'cancelled', 'canceled', 'terminated', 'timed_out'].includes(status);
function inferredTarget(text) {
  const matches = Object.entries(TARGETS).filter(([, t]) => new RegExp(`(?:^|[^a-z0-9-])(?:[a-z0-9-]+\\.)*${t.domain.replace(/\./g, '\\.')}\\b`, 'i').test(text));
  return matches.length === 1 ? matches[0][0] : matches.length > 1 ? 'ambiguous' : '';
}
function contract(_req, res) {
  res.set('Cache-Control', 'no-store').json({
    schema: 'LillyRemoteOps/v1', revision: 3, invoke: '/api/tools/invoke/remote-ops',
    authentication: 'Authorization: Bearer <existing Lilly API key or login token>',
    privilege: 'Existing Lilly operator permissions; bots sharing a credential share ownership.',
    targets: TARGETS, defaultTargetId: 'k3s-primary',
    targeting: 'Explicit targetId wins for new runs; otherwise infer from deploymentHost or task domain. Status and continue preserve saved target and workspace. New target means a new run.',
    tools: ['remote-cli-agent', 'k3s-deploy', 'artifact-store'], deploymentActions: ACTIONS,
    modelSelection: { parameter: 'params.model', alternative: 'model', default: DEFAULT_MODEL, models: [{ id: 'gpt-6-astra', label: 'Astra' }, { id: DEFAULT_MODEL, label: 'Luna' }], catalog: '/api/models', instructions: 'Use gpt-6-astra for long-horizon work. Follow-ups inherit the model; a running job retains its original model.' },
    remoteActions: ['run', 'status', 'continue', 'cancel'], polling: { minIntervalMs: 30000, maxGatewayChecksPerJob: 600, ownerRequestsPerMinute: 60, cancelRequestsPerMinute: 6, maxConcurrentRequestsPerReplica: 4, instructions: 'Honor HTTP 429 Retry-After. Stop on stopPolling:true. Terminal status is cached. Cancel requires the exact owned jobId, uses a reserved budget and does not delete shared artifacts or project files.' },
    timeouts: { defaultObservationMs: 45000, maxObservationMs: 240000, gatewayMaxLifetimeMs: 14400000, gatewayIdleTimeoutMs: 1800000, instructions: 'observationTimeoutMs (or agentRunTimeoutMs) controls this HTTP wait only. Poll the same running or unobserved job. Gateway lifetime/idle limits are separate. Emit progress during builds and save checkpoints before limits; extend work with a continuation turn.' },
    retries: 'Supply a unique requestId for each run/continue. Replay returns its receipt; changed content with the same ID is rejected. Uncertain dispatch is never automatically repeated. Status needs no requestId.',
    sessions: '/api/sessions', upload: '/api/artifacts/upload', artifacts: '/api/sessions/{sessionId}/artifacts', download: '/api/artifacts/{artifactId}/download',
    sharedStorage: { tool: 'artifact-store', actions: ['put', 'list', 'get', 'bundle'], maxBatchFiles: 64, maxFileBytes: 4194304, maxBatchBytes: 6291456, instructions: 'One Lilly session is the shared shelf for both bots and servers. Put files with filename and content or contentBase64. Immutable artifact IDs identify versions. Get returns bytes. Bundle selected artifactIds into a ZIP preserving paths, then give that ZIP to Codex. Use multiple batches for larger projects. Codex outputs appear in the same shelf.' },
    toolDocs: '/api/tools/docs/{tool}', limits: { maxFiles: 12, maxFileBytes: 4194304, maxTotalFileBytes: 6291456 },
    continuation: 'action=status polls the saved job. action=continue after a terminal turn sends feedback/supportAgentResponse and new artifacts to the same Codex session. next contains the follow-up request. Do not replace a running job to send feedback.',
    completion: 'Inspect data.success, completionStatus, blocker, resultFilesError and next. Download artifacts; HTTP 200 and model prose alone are not completion proof.',
    example: { tool: 'remote-cli-agent', sessionId: '<Lilly session id>', requestId: '<unique operation id>', params: { action: 'run', model: 'gpt-6-astra', reasoningEffort: 'high', targetId: 'k3s-primary', task: 'Build the requested site, save source and QA evidence, and return a complete website bundle.', observationTimeoutMs: 45000, collectResultFiles: true } },
  });
}
function normalizeRequest(req, res, next) {
  res.set('Cache-Control', 'no-store');
  const fail = (error, status = 400) => res.status(status).json({ success: false, error });
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('A JSON object is required.');
  if (!['remote-cli-agent', 'k3s-deploy', 'artifact-store'].includes(body.tool)) return fail('Use remote-cli-agent, k3s-deploy or artifact-store.');
  if (typeof body.sessionId !== 'string' || !body.sessionId.trim()) return fail('Create a Lilly session first and provide sessionId.');
  if (!body.params || typeof body.params !== 'object' || Array.isArray(body.params)) return fail('params must be an object.');
  if (body.requestId !== undefined && (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(body.requestId))) return fail('Invalid requestId; use 1-100 letters, digits, dots, dashes, colons or underscores.');
  const params = { ...body.params }; const saved = req.remoteOpsSaved || {};
  if (body.tool === 'artifact-store') {
    if (!['put', 'list', 'get', 'bundle'].includes(params.action)) return fail('Use artifact-store action put, list, get or bundle.');
  } else {
    const action = body.tool === 'remote-cli-agent' ? params.action || (params.jobId ? 'status' : params.sessionId ? 'continue' : 'run') : params.action;
    if (body.tool === 'remote-cli-agent' && !['run', 'status', 'continue'].includes(action)) return fail('Use run, status or continue.');
    const followup = body.tool === 'remote-cli-agent' && action !== 'run';
    const inferred = inferredTarget(`${params.deploymentHost || ''}\n${params.task || ''}`);
    if (followup && !params.targetId && saved.targetId && inferred && inferred !== saved.targetId) return fail('The follow-up names another server domain. Start a new targeted run, or explicitly retain the current target for discussion.', 409);
    if (!params.targetId && !followup && inferred === 'ambiguous') return fail('Both server domains are mentioned; provide targetId.');
    let targetId = params.targetId || (followup ? saved.targetId : '') || (inferred !== 'ambiguous' ? inferred : '') || 'k3s-primary';
    if (['primary', 'prod', 'k3s-prod'].includes(targetId)) targetId = 'k3s-primary';
    if (targetId === 'secondary') targetId = 'k3s-secondary';
    const target = TARGETS[targetId];
    if (!target) return fail('Use targetId k3s-primary or k3s-secondary.');
    if (followup && saved.targetId && saved.targetId !== targetId) return fail('A continuation cannot switch servers.', 409);
    if (body.tool === 'remote-cli-agent') {
      if (params.transport && params.transport !== 'provider-agent') return fail('Artifact sharing requires provider-agent transport.');
      if (['command', 'args', 'shell', 'executable'].some(key => key in params)) return fail('Use a task description, not raw shell fields.');
      if (action !== 'status' && (typeof params.task !== 'string' || !params.task.trim())) return fail('params.task is required.');
      for (const model of [body.model, params.model]) if (model !== undefined && (typeof model !== 'string' || !/^gpt-[a-z0-9.-]+$/.test(model))) return fail('Select a Codex GPT model ID, such as gpt-6-astra.');
      if (body.model && params.model && body.model !== params.model) return fail('model and params.model must agree.');
      const requestedModel = params.model || body.model;
      if (action === 'status' && requestedModel && saved.model && requestedModel !== saved.model) return fail('Change the model on the next turn, not on a running job.', 409);
      const wait = params.observationTimeoutMs ?? params.agentRunTimeoutMs ?? 45000;
      if (!Number.isInteger(wait) || wait < 1000 || wait > 240000) return fail('observationTimeoutMs must be an integer from 1000 to 240000.');
      if (followup && saved.cwd && (params.cwd || params.workspacePath) && (params.cwd || params.workspacePath) !== saved.cwd) return fail('A continuation cannot switch workspaces.', 409);
      Object.assign(params, { action, targetId, transport: 'provider-agent', model: requestedModel || (followup && saved.model) || DEFAULT_MODEL, cwd: params.cwd || params.workspacePath || (followup && saved.cwd) || target.cwd, agentRunTimeoutMs: wait });
      delete params.observationTimeoutMs;
      if (action === 'status') params.task = 'Check status';
    } else {
      if (!ACTIONS.includes(params.action)) return fail('An explicit supported deployment action is required.');
      if (!params.namespace || !params.deployment) return fail('Explicit namespace and deployment are required.');
      if (params.host && params.host !== target.host) return fail('host does not match targetId.');
      if ((params.username && params.username !== 'root') || (params.port && params.port !== 22)) return fail('Use the configured SSH identity.');
      if (targetId === 'k3s-primary') {
        const privateKeyPath = process.env.LILLY_REMOTE_OPS_SSH_KEY_PATH;
        if (!privateKeyPath) return fail('Dedicated primary deployment credential is not configured. Use the authorized Codex deployment lane.', 503);
        req.remoteOpsSshCredentials = { [target.host]: { host: target.host, username: 'root', port: 22, privateKeyPath } };
      }
      Object.assign(params, { host: target.host, username: 'root', port: 22, targetId });
    }
  }
  req.body = { tool: body.tool, sessionId: body.sessionId.trim(), params, ...(body.requestId ? { requestId: body.requestId } : {}), ...(body.tool === 'remote-cli-agent' ? { model: params.model } : {}), executionProfile: 'remote-build' };
  next();
}
module.exports = { contract, normalizeRequest, TARGETS, terminal };
