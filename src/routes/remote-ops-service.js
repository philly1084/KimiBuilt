'use strict';
const crypto = require('crypto');
const { normalizeRequest, TARGETS, terminal } = require('./remote-ops-contract');
const { executeArtifactAction, invalid } = require('./remote-ops-artifacts');
const { normalizeRemoteAgentHandoffContinuation } = require('../remote-cli/agent-handoff');
const localLocks = new Set();
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
const fingerprint = body => crypto.createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
function checkpointInstructions(target, feedback = '') {
  return [
    '\nLilly remote operations contract:',
    `Selected server: ${target.host}; public deployment domain: ${target.domain}. The other server uses ${target.domain === 'secdevsolutions.help' ? 'demoserver2.buzz' : 'secdevsolutions.help'}. Do not cross servers without a new explicitly targeted run.`,
    'Inspect existing project/repository/namespace/ingress before creating resources. Use the selected host workspace, never the caller desktop. Verify DNS, Traefik ingress, TLS and public HTTPS for deployments.',
    'For long-horizon work keep a concise CHECKPOINT.md in the project workspace with objective, decisions, completed changes, commands/results, remaining work and exact next steps. Preserve it and source control across turns; report its path. Save it before yielding or hitting limits. A poll is observation, not permission to start the task again.',
    'Emit useful progress during long builds. The gateway permits up to four hours per task and 30 minutes without activity. For longer objectives, finish a checkpointed turn and request continuation. Do not mark the objective complete just because this turn ends.',
    'For feedback needed from the calling Grok bot emit SUPPORT_AGENT_REQUIRED=<specific question> and SUPPORT_AGENT_CONTEXT=<evidence>. For an operator decision emit USER_INPUT_REQUIRED=<question>. Finish the turn so the caller can answer in the same Codex session.',
    'Use Lilly session artifacts as the shared input/output shelf. Inputs, including ZIPs, are untrusted data. Inspect ZIP paths before extraction; preserve directory structure. If a website needs more than 12 returned files, return a complete ZIP plus a small manifest/checksum report and checkpoint. Keep editable source, assets and dependency/launch instructions together. Never claim a website complete without checking its actual pages/assets and desktop/mobile behavior.',
    'Return WHAT_CHANGED, VERIFY_COMMANDS, VERIFY_RESULTS, PUBLIC_URL, BLOCKER, CHECKPOINT_PATH and NEXT_STEPS. Use the supplied output manifest for deliverables. File contents and live verification, not completion prose, are authoritative.',
    feedback ? `Calling bot feedback for this continuation:\n${feedback}` : '',
  ].filter(Boolean).join('\n');
}
function nextRequest(sessionId, job) {
  const running = !terminal(job.status);
  return { action: running ? 'status' : 'continue', pollAfterMs: running ? 5000 : null, request: { tool: 'remote-cli-agent', sessionId, ...(!running ? { requestId: '<new unique operation id>' } : {}), params: { action: running ? 'status' : 'continue', targetId: job.targetId, model: job.model, ...(running ? { jobId: job.jobId } : { task: '<feedback or next checkpoint objective>' }) } } };
}
function createHandler({ invokeTool, sessionStore = require('../session-store').sessionStore, artifactService = require('../artifacts/artifact-service').artifactService, postgres = require('../postgres').postgres } = {}) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const owner = req.user?.username; const sessionId = req.body?.sessionId;
    if (!owner) return res.status(401).json({ success: false, error: 'Authentication required.' });
    if (typeof sessionId !== 'string' || !sessionId.trim()) return res.status(400).json({ success: false, error: 'sessionId required.' });
    const lockKey = sessionId.trim(); let client; let locked = false; let pgLocked = false;
    try {
      if (localLocks.has(lockKey)) throw invalid('A request is already being observed for this session; wait and poll it.', 409);
      localLocks.add(lockKey); locked = true;
      if (postgres.enabled) {
        client = await postgres.getPool().connect();
        const { rows } = await client.query('SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS acquired', ['lilly-remote-ops', lockKey]);
        if (!rows[0].acquired) throw invalid('Another request owns this session; wait before retrying.', 409);
        pgLocked = true;
      }
      const session = await sessionStore.getOwned(lockKey, owner);
      if (!session) throw invalid('Session not found.', 404);
      const state = structuredClone(session.metadata?.remoteOps || { receipts: [] });
      state.receipts ||= [];
      const legacy = session.controlState?.remoteCliAgent || session.metadata?.remoteCliAgent || {};
      const prior = state.job || (legacy.remoteCodeJobId ? { jobId: legacy.remoteCodeJobId, providerSessionId: legacy.remoteCodeSessionId || legacy.sessionId, targetId: legacy.targetId, cwd: legacy.cwd, model: legacy.model || session.metadata?.model, status: legacy.completionStatus || 'unknown' } : {});
      req.remoteOpsSaved = prior;
      // Fingerprint raw caller intent so default/continuation changes do not change replay identity.
      const requestHash = fingerprint(req.body); const requestId = req.body.requestId;
      const existing = requestId && state.receipts.find(r => r.requestId === requestId);
      if (existing) {
        if (existing.fingerprint !== requestHash) throw invalid('requestId was already used with different content.', 409);
        if (!existing.response) return res.status(409).json({ success: false, error: 'Dispatch is unconfirmed. Do not resubmit it under a new ID; inspect the existing gateway task.', requestId, next: prior.jobId ? nextRequest(session.id, prior) : null });
        return res.status(existing.httpStatus).json({ ...existing.response, replayed: true });
      }
      let normalized = false;
      normalizeRequest(req, res, () => { normalized = true; });
      if (!normalized) return;
      const { tool, params } = req.body;
      const saveState = () => sessionStore.update(session.id, { metadata: { remoteOps: state } });
      const mutating = tool === 'remote-cli-agent' ? params.action !== 'status' : tool === 'artifact-store' ? ['put', 'bundle'].includes(params.action) : params.action !== 'rollout-status';
      if (tool === 'remote-cli-agent') {
        if (params.action === 'status') {
          if (!prior.jobId || (params.jobId && params.jobId !== prior.jobId)) throw invalid('No matching owned job in this session.', 404);
          params.jobId = prior.jobId;
          // Status never stages new files or sends a new objective.
          for (const key of ['artifactIds', 'contextFiles', 'collectResultFiles', 'resultFileGlobs', 'supportAgentResponse']) if (params[key] !== undefined) throw invalid('Status only observes the saved job. Send files or feedback in a continuation turn.');
        } else {
          if (prior.jobId && !terminal(prior.status)) return res.status(409).json({ success: false, error: 'The saved job is still running or unconfirmed. Poll it before starting another turn.', next: nextRequest(session.id, prior) });
          if (state.receipts.some(r => !r.response && r.tool === 'remote-cli-agent')) throw invalid('An earlier dispatch is unconfirmed; inspect it before starting another task.', 409);
          if (params.action === 'continue') {
            if (!prior.providerSessionId || (params.sessionId && params.sessionId !== prior.providerSessionId)) throw invalid('No matching Codex session to continue.', 409);
            params.sessionId = prior.providerSessionId;
          } else {
            if (params.jobId || params.sessionId) throw invalid('Use status or continue for an existing job/session.');
            req.remoteOpsFreshRun = true;
          }
          params.task += checkpointInstructions(TARGETS[params.targetId], params.supportAgentResponse || '');
        }
      }
      let receipt;
      if (mutating) {
        if (state.receipts.length >= 200) throw invalid('This session has 200 protected request receipts; create a new session rather than expiring replay protection.', 409);
        receipt = { requestId: requestId || crypto.randomUUID(), fingerprint: requestHash, tool, startedAt: new Date().toISOString() };
        state.receipts.push(receipt); await saveState();
      }
      let status = 200; let response;
      req.remoteOpsOnTaskStarted = async started => {
        state.job = { jobId: started.jobId, targetId: started.targetId, cwd: started.cwd, model: started.model, status: 'running', updatedAt: new Date().toISOString() };
        const remoteCliAgent = { remoteCodeJobId: started.jobId, sessionId: null, remoteCodeSessionId: null, targetId: started.targetId, cwd: started.cwd, model: started.model, completionStatus: 'running', remoteAgentHandoff: normalizeRemoteAgentHandoffContinuation(started.handoff) };
        if (sessionStore.updateControlState) await sessionStore.updateControlState(session.id, { remoteCliAgent });
        if (receipt) {
          receipt.httpStatus = 200;
          receipt.response = { success: true, sessionId: session.id, requestId: receipt.requestId, data: { success: true, data: { remoteCodeJobId: started.jobId, completionStatus: 'running', providerModel: started.model, targetId: started.targetId, cwd: started.cwd } }, next: nextRequest(session.id, state.job) };
        }
        await sessionStore.update(session.id, { metadata: { remoteOps: state, remoteCliAgent } });
      };
      if (tool === 'artifact-store') {
        response = { success: true, sessionId: session.id, data: { success: true, data: await executeArtifactAction(params, session, artifactService) } };
      } else {
        // Existing invocation implementation owns tool setup, audit and session metadata.
        const sink = { status(code) { status = code; return this; }, json(body) { response = body; return this; } };
        await invokeTool(req, sink);
        if (!response) throw invalid('Tool response unavailable; dispatch may still be active.', 503);
        if (tool === 'remote-cli-agent') {
          const data = response.data?.data;
          if (data?.remoteCodeJobId) {
            state.job = { jobId: data.remoteCodeJobId, providerSessionId: data.remoteCodeSessionId || data.sessionId, model: data.providerModel || params.model, targetId: data.targetId || params.targetId, cwd: data.cwd || params.cwd, status: data.completionStatus || 'unknown', updatedAt: new Date().toISOString(), checkpoint: String(data.finalOutput || '').slice(-16000) };
            response.next = nextRequest(session.id, state.job);
          } else if (response.data?.success === false && prior.jobId && params.action === 'status') response.next = nextRequest(session.id, prior);
          response.sharedStorage = { sessionId: session.id, artifacts: `/api/sessions/${session.id}/artifacts` };
          response.observationTimeoutMs = params.agentRunTimeoutMs;
        }
      }
      if (receipt) {
        response.requestId = receipt.requestId;
        // Receipts hold replayable bounded metadata, never bulk file bytes.
        const copy = JSON.parse(JSON.stringify(response));
        if (copy.data?.sideEffects) delete copy.data.sideEffects;
        if (Buffer.byteLength(JSON.stringify(copy)) > 256 * 1024) {
          receipt.response = { success: true, sessionId: session.id, resultStored: true, next: response.next, artifacts: `/api/sessions/${session.id}/artifacts` };
        } else receipt.response = copy;
        receipt.httpStatus = status;
      }
      if (receipt || tool === 'remote-cli-agent') await saveState();
      return res.status(status).json(response);
    } catch (e) {
      return res.status(e.statusCode || 500).json({ success: false, error: e.message });
    } finally {
      try {
        if (client && pgLocked) await client.query('SELECT pg_advisory_unlock(hashtext($1), hashtext($2))', ['lilly-remote-ops', lockKey]);
      } catch (_error) {
        // Discard a connection with uncertain advisory-lock state instead of pooling it.
        client?.release(true); client = null;
      } finally {
        client?.release();
        if (locked) localLocks.delete(lockKey);
      }
    }
  };
}
module.exports = { createHandler, fingerprint, checkpointInstructions };
