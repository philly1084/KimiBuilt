'use strict';
const { limited } = require('./remote-ops-limits');
const locks = new Set();
async function cancelOwnedJob(req, res, { sessionStore, cancelTask = input => require('../remote-cli/agents-sdk-runner').remoteCliAgentsSdkRunner.cancelRemoteTask(input), now = Date.now }) {
  const sessionId = req.body.sessionId.trim(); const params = req.body.params; const jobId = params.jobId;
  if (typeof jobId !== 'string' || !/^ragent_[a-zA-Z0-9_-]+$/.test(jobId)) return res.status(400).json({ success: false, error: 'Cancellation requires the exact saved gateway jobId (ragent_...).', code: 'job_id_required' });
  const key = `${sessionId}:${jobId}`;
  if (locks.has(key)) return limited(res, 5, 'Cancellation is already being processed.');
  locks.add(key);
  try {
    const session = await sessionStore.getOwned(sessionId, req.user.username);
    const job = session?.metadata?.remoteOps?.job;
    if (!job || job.jobId !== jobId) return res.status(404).json({ success: false, error: 'No matching owned job in this session.', stopPolling: true });
    if (params.targetId && params.targetId !== job.targetId) return res.status(409).json({ success: false, error: 'Cancellation cannot switch target.' });
    if (['complete', 'completed', 'cancelled', 'failed', 'terminated', 'timed_out'].includes(job.status)) return res.json({ success: true, alreadyTerminal: true, stopPolling: true, data: { jobId, status: job.status, artifactsPreserved: true } });
    const previous = session.metadata.remoteOpsCancel;
    if (previous?.jobId === jobId && previous.response) return res.json({ ...previous.response, replayed: true });
    if (previous?.jobId === jobId && previous.nextAttemptAt > now()) return limited(res, Math.ceil((previous.nextAttemptAt - now()) / 1000));
    await sessionStore.update(sessionId, { metadata: { remoteOpsCancel: { jobId, status: 'requested', nextAttemptAt: now() + 10000 } } });
    const result = await cancelTask({ jobId, targetId: job.targetId });
    const response = { success: true, sessionId, data: result, stopPolling: false, next: { action: 'status', pollAfterMs: 30000, request: { tool: 'remote-cli-agent', sessionId, params: { action: 'status', jobId } } }, artifacts: `/api/sessions/${sessionId}/artifacts` };
    await sessionStore.update(sessionId, { metadata: { remoteOpsCancel: { jobId, status: result.status, response } } });
    return res.json(response);
  } catch (error) {
    if (error.statusCode === 404) return res.status(404).json({ success: false, error: error.message, code: 'job_unavailable', stopPolling: true });
    res.set('Retry-After', '10');
    return res.status(error.statusCode || 502).json({ success: false, error: error.message, code: 'cancel_unconfirmed', retryAfterSeconds: 10 });
  } finally { locks.delete(key); }
}
module.exports = { cancelOwnedJob };
