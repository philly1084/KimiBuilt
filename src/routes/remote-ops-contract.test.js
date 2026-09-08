const express = require('express');
const request = require('supertest');
const { contract, normalizeRequest } = require('./remote-ops-contract');

const app = express();
app.use(express.json());
app.get('/', contract);
app.post('/', normalizeRequest, (req, res) => res.json(req.body));
const call = (params = {}, tool = 'remote-cli-agent') => request(app).post('/').send({ tool, sessionId: 'owned-session', params });

test('pins Codex, bounds wait, and preserves artifact and continuation fields', async () => {
  const r = await call({ task: 'Check status', jobId: 'job', sessionId: 'provider-session', artifactIds: ['file'], collectResultFiles: true, agentRunTimeoutMs: 999999 });
  expect(r.status).toBe(200);
  expect(r.body.params).toMatchObject({ targetId: 'k3s-primary', transport: 'provider-agent', model: 'gpt-5.6-luna', jobId: 'job', sessionId: 'provider-session', artifactIds: ['file'], collectResultFiles: true, agentRunTimeoutMs: 45000 });
});
test.each([{ targetId: 'k3s-secondary' }, { transport: 'mcp' }, { command: 'ls' }, { model: 'grok' }])('rejects incompatible remote overrides %j', async params => {
  expect((await call({ task: 'Inspect', ...params })).status).toBe(400);
});
test('does not inherit secondary deployment defaults', async () => {
  const old = process.env.LILLY_REMOTE_OPS_SSH_KEY_PATH;
  process.env.LILLY_REMOTE_OPS_SSH_KEY_PATH = '/run/lilly-remote-ops/id_ed25519';
  const r = await call({ action: 'rollout-status', namespace: 'kimibuilt', deployment: 'backend' }, 'k3s-deploy');
  if (old === undefined) delete process.env.LILLY_REMOTE_OPS_SSH_KEY_PATH;
  else process.env.LILLY_REMOTE_OPS_SSH_KEY_PATH = old;
  expect(r.body.params).toMatchObject({ host: '168.119.176.121', username: 'root', port: 22 });
});
test('fails closed without a dedicated primary credential', async () => {
  const old = process.env.LILLY_REMOTE_OPS_SSH_KEY_PATH;
  delete process.env.LILLY_REMOTE_OPS_SSH_KEY_PATH;
  const r = await call({ action: 'rollout-status', namespace: 'kimibuilt', deployment: 'backend' }, 'k3s-deploy');
  if (old !== undefined) process.env.LILLY_REMOTE_OPS_SSH_KEY_PATH = old;
  expect(r.status).toBe(503);
});
test.each([{ namespace: 'x', deployment: 'x' }, { action: 'rollout-status' }, { action: 'rollout-status', namespace: 'x', deployment: 'x', host: '162.55.163.199' }])('rejects ambiguous deployment %j', async params => {
  expect((await call(params, 'k3s-deploy')).status).toBe(400);
});
test('requires a session and allowlisted tool', async () => {
  expect((await request(app).post('/').send({ tool: 'remote-cli-agent', params: { task: 'Inspect' } })).status).toBe(400);
  expect((await call({}, 'ssh-execute')).status).toBe(400);
});
test('publishes file limits and existing privilege scope without caching', async () => {
  const r = await request(app).get('/');
  expect(r.headers['cache-control']).toBe('no-store');
  expect(r.body.schema).toBe('LillyRemoteOps/v1');
  expect(r.body.limits.maxFiles).toBe(12);
  expect(r.body.modelSelection.models.map(model => model.id)).toContain('gpt-6-astra');
});

test.each(['nested', 'top-level'])('passes Astra from %s through params and execution context', async location => {
  const body = { tool: 'remote-cli-agent', sessionId: 'owned-session', params: { task: 'Inspect' } };
  if (location === 'nested') body.params.model = 'gpt-6-astra';
  else body.model = 'gpt-6-astra';
  const r = await request(app).post('/').send(body);
  expect(r.status).toBe(200);
  expect(r.body.model).toBe('gpt-6-astra');
  expect(r.body.params.model).toBe('gpt-6-astra');
});
test('rejects conflicting model choices instead of silently using Luna', async () => {
  const r = await request(app).post('/').send({ tool: 'remote-cli-agent', sessionId: 'owned', model: 'gpt-6-astra', params: { task: 'Inspect', model: 'gpt-5.6-luna' } });
  expect(r.status).toBe(400);
});
test.each([{}, 1, '', 'gpt-6-astra --flag'])('rejects malformed model %j', async model => {
  expect((await call({ task: 'Inspect', model })).status).toBe(400);
});
