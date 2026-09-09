const express = require('express');
const request = require('supertest');
const crypto = require('crypto');
const { createHandler } = require('./remote-ops-service');
const { readZipEntries } = require('../utils/zip');
function fixture() {
  let time = 100000; let autoAdvance = true; const now = () => time; const cancelTask = jest.fn(async () => ({ status: 'terminated', artifactsPreserved: true }));
  const session = { id: crypto.randomUUID(), metadata: { ownerId: 'owner' } };
  const store = new Map();
  const sessionStore = { getOwned: jest.fn(async (id, owner) => id === session.id && owner === 'owner' ? structuredClone(session) : null), update: jest.fn(async (_id, patch) => { Object.assign(session.metadata, patch.metadata); return structuredClone(session); }) };
  const artifactService = {
    createStoredArtifact: jest.fn(async input => { const a = { ...input, id: crypto.randomUUID(), contentBuffer: input.buffer, sizeBytes: input.buffer.length, sha256: crypto.createHash('sha256').update(input.buffer).digest('hex') }; store.set(a.id, a); return a; }),
    getArtifact: jest.fn(async id => store.get(id)),
    listSessionArtifacts: jest.fn(async id => [...store.values()].filter(a => a.sessionId === id)),
    deleteArtifact: jest.fn(async id => store.delete(id)),
  };
  let completion = 'running'; let rejectDispatch = false;
  const invokeTool = jest.fn(async (req, res) => {
    if (rejectDispatch) throw new Error('connection lost after dispatch');
    res.json({ success: true, data: { success: true, data: { remoteCodeJobId: 'job-1', remoteCodeSessionId: 'provider-1', providerModel: req.body.params.model, targetId: req.body.params.targetId, cwd: req.body.params.cwd, completionStatus: completion } }, sessionId: session.id });
  });
  const app = () => {
    const a = express(); a.use(express.json({ limit: '10mb' })); a.use((req, _res, next) => { req.user = { username: req.get('x-owner') || 'owner' }; next(); });
    a.post('/', createHandler({ invokeTool, sessionStore, artifactService, postgres: { enabled: false }, now, admission: () => 0, cancelTask })); return a;
  };
  const call = (params, extra = {}) => { if (autoAdvance) time += 30001; return request(app()).post('/').send({ tool: 'remote-cli-agent', sessionId: session.id, params, ...extra }); };
  const shelf = (params, extra = {}) => call(params, { tool: 'artifact-store', ...extra });
  return { freeze: () => { autoAdvance = false; }, advance: ms => { time += ms; }, cancelTask, app, session, store, call, shelf, invokeTool, artifactService, sessionStore, complete: () => { completion = 'complete'; }, reject: () => { rejectDispatch = true; } };
}
test('Astra survives bounded observation, same-job polling and a checkpointed continuation', async () => {
  const f = fixture();
  const first = await f.call({ task: 'Build app.demoserver2.buzz', model: 'gpt-6-astra', observationTimeoutMs: 1000 }, { requestId: 'build-1' });
  expect(first.status).toBe(200); expect(first.body.next.request.params.jobId).toBe('job-1');
  expect(f.invokeTool.mock.calls[0][0].body.params).toMatchObject({ targetId: 'k3s-secondary', model: 'gpt-6-astra', agentRunTimeoutMs: 1000 });
  expect(f.invokeTool.mock.calls[0][0].body.params.task).toContain('CHECKPOINT.md');
  expect((await f.call({ task: 'Start another build' })).status).toBe(409);
  const status = await f.call({ action: 'status' });
  expect(status.body.data.data.providerModel).toBe('gpt-6-astra');
  expect(f.invokeTool.mock.calls[1][0].body.params).toMatchObject({ jobId: 'job-1', targetId: 'k3s-secondary', cwd: '/opt/kimibuilt' });
  f.complete(); await f.call({ action: 'status' });
  const follow = await f.call({ action: 'continue', task: 'Revise the header', supportAgentResponse: 'Use accessible contrast' }, { requestId: 'revision-1' });
  expect(follow.status).toBe(200);
  const p = f.invokeTool.mock.calls.at(-1)[0].body.params;
  expect(p.sessionId).toBe('provider-1'); expect(p.model).toBe('gpt-6-astra'); expect(p.task).toContain('Use accessible contrast');
});
test('replays original receipt after handler recreation and rejects conflicting intent', async () => {
  const f = fixture(); const params = { task: 'Build', model: 'gpt-6-astra' };
  await f.call(params, { requestId: 'same-id' });
  const replay = await f.call(params, { requestId: 'same-id' });
  expect(replay.body.replayed).toBe(true); expect(f.invokeTool).toHaveBeenCalledTimes(1);
  expect((await f.call({ task: 'Delete' }, { requestId: 'same-id' })).status).toBe(409);
});
test('uncertain dispatch cannot be repeated after the observer failed', async () => {
  const f = fixture(); f.reject();
  expect((await f.call({ task: 'Build' }, { requestId: 'uncertain' })).status).toBe(500);
  expect((await f.call({ task: 'Build' }, { requestId: 'uncertain' })).status).toBe(409);
  expect((await f.call({ task: 'Build' }, { requestId: 'new-id' })).status).toBe(409);
  expect(f.invokeTool).toHaveBeenCalledTimes(1);
});
test('acknowledged job handle survives an observer crash before its HTTP response', async () => {
  const f = fixture();
  f.invokeTool.mockImplementationOnce(async req => {
    await req.remoteOpsOnTaskStarted({ jobId: 'job-1', targetId: 'k3s-primary', cwd: '/opt/lilly-agent-workbench', model: 'gpt-6-astra' });
    throw new Error('observer stopped');
  });
  await f.call({ task: 'Long build', model: 'gpt-6-astra' }, { requestId: 'long-1' });
  const replay = await f.call({ task: 'Long build', model: 'gpt-6-astra' }, { requestId: 'long-1' });
  expect(replay.body.next.request.params.jobId).toBe('job-1');
  expect(f.invokeTool).toHaveBeenCalledTimes(1);
  expect((await f.call({ action: 'status' })).body.data.data.providerModel).toBe('gpt-6-astra');
});
test('rejects foreign ownership, job IDs and server/workspace changes on follow-up', async () => {
  const f = fixture();
  const foreign = await request(f.app()).post('/').set('x-owner', 'other').send({ tool: 'remote-cli-agent', sessionId: f.session.id, params: { task: 'Build' } });
  expect(foreign.status).toBe(404);
  await f.call({ task: 'Build', model: 'gpt-6-astra' });
  expect((await f.call({ action: 'status', jobId: 'someone-elses-job' })).status).toBe(404);
  expect((await f.call({ action: 'status', targetId: 'k3s-secondary' })).status).toBe(409);
  expect((await f.call({ action: 'status', cwd: '/opt/other' })).status).toBe(409);
  expect((await f.call({ action: 'status', model: 'gpt-5.6-luna' })).status).toBe(409);
  expect((await f.call({ action: 'status', contextFiles: [] })).status).toBe(400);
});
test('bulk stores arbitrary text/binary formats and bundles directory paths', async () => {
  const f = fixture();
  const files = Array.from({ length: 20 }, (_, i) => ({ filename: `src/part-${i}.js`, content: `export default ${i};` }));
  files.push({ filename: 'assets/image.png', contentBase64: Buffer.from([0, 255, 42]).toString('base64'), mimeType: 'image/png' });
  const put = await f.shelf({ action: 'put', files }, { requestId: 'files-1' });
  expect(put.status).toBe(200); expect(put.body.data.data.files).toHaveLength(21);
  const ids = put.body.data.data.files.map(a => a.id);
  const got = await f.shelf({ action: 'get', artifactIds: ids });
  expect(Buffer.from(got.body.data.data.files[20].contentBase64, 'base64')).toEqual(Buffer.from([0, 255, 42]));
  const bundle = await f.shelf({ action: 'bundle', artifactIds: ids });
  expect(bundle.status).toBe(200);
  const zip = f.store.get(bundle.body.data.data.artifact.id).contentBuffer;
  expect(readZipEntries(zip).size).toBe(21);
  expect(readZipEntries(zip).get('src/part-19.js').toString()).toBe('export default 19;');
  const list = await f.shelf({ action: 'list', limit: 5 });
  expect(list.body.data.data.total).toBe(22); expect(list.body.data.data.nextOffset).toBe(5);
  await f.shelf({ action: 'put', files }, { requestId: 'files-1' });
  expect(f.store.size).toBe(22);
});
test.each(['../secret', '/etc/passwd', 'site/../escape', 'bad\nname', 'C:\\secret'])('rejects unsafe bulk path %s before any write', async filename => {
  const f = fixture(); const r = await f.shelf({ action: 'put', files: [{ filename, content: 'x' }] });
  expect(r.status).toBe(400); expect(f.store.size).toBe(0);
});
test('rejects a checksum mismatch and cross-session bulk reads', async () => {
  const f = fixture();
  expect((await f.shelf({ action: 'put', files: [{ filename: 'x.txt', content: 'x', sha256: 'bad' }] })).status).toBe(400);
  f.store.set('other', { id: 'other', sessionId: 'other-session', contentBuffer: Buffer.from('private') });
  expect((await f.shelf({ action: 'get', artifactIds: ['other'] })).status).toBe(404);
});
test('concurrent calls cannot dispatch two jobs in the same session', async () => {
  const f = fixture(); let release; let started;
  const entered = new Promise(r => { started = r; });
  f.invokeTool.mockImplementationOnce(async (_req, res) => { started(); await new Promise(r => { release = r; }); res.json({ success: true, data: { success: true, data: { remoteCodeJobId: 'job-1', completionStatus: 'running' } } }); });
  const first = f.call({ task: 'Build' }).then(r => r);
  await entered;
  expect((await f.call({ task: 'Build again' })).status).toBe(409);
  release(); await first;
  expect(f.invokeTool).toHaveBeenCalledTimes(1);
});

test('database advisory lock prevents a second process from dispatching and releases its connection', async () => {
  const f = fixture();
  const client = { query: jest.fn(async () => ({ rows: [{ acquired: false }] })), release: jest.fn() };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.user = { username: 'owner' }; next(); });
  app.post('/', createHandler({ invokeTool: f.invokeTool, sessionStore: f.sessionStore, artifactService: f.artifactService, postgres: { enabled: true, getPool: () => ({ connect: async () => client }) } }));
  const response = await request(app).post('/').send({ tool: 'remote-cli-agent', sessionId: f.session.id, params: { task: 'Build' } });
  expect(response.status).toBe(409); expect(f.invokeTool).not.toHaveBeenCalled(); expect(client.release).toHaveBeenCalledTimes(1);
});

test('uncertain database unlock discards the connection', async () => {
  const f = fixture();
  const client = { query: jest.fn().mockResolvedValueOnce({ rows: [{ acquired: true }] }).mockRejectedValueOnce(new Error('connection lost')), release: jest.fn() };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.user = { username: 'owner' }; next(); });
  app.post('/', createHandler({ invokeTool: f.invokeTool, sessionStore: f.sessionStore, artifactService: f.artifactService, postgres: { enabled: true, getPool: () => ({ connect: async () => client }) } }));
  await request(app).post('/').send({ tool: 'remote-cli-agent', sessionId: f.session.id, params: { task: 'Build' } });
  expect(client.release).toHaveBeenCalledWith(true); expect(client.release).toHaveBeenCalledTimes(1);
});


test('enforces persisted 30-second polling across handlers and never re-fetches terminal results', async () => {
  const f = fixture(); f.freeze();
  await f.call({task:'Build'});
  await f.call({action:'status'});
  const calls=f.invokeTool.mock.calls.length;
  const early=await f.call({action:'status'});
  expect(early.status).toBe(429); expect(early.headers['retry-after']).toBe('30');
  expect(f.invokeTool).toHaveBeenCalledTimes(calls);
  f.advance(30001); f.complete();
  const done=await f.call({action:'status'}); expect(done.body.stopPolling).toBe(true);
  const doneCalls=f.invokeTool.mock.calls.length;
  for(let i=0;i<10;i++) expect((await f.call({action:'status'})).body.cached).toBe(true);
  expect(f.invokeTool).toHaveBeenCalledTimes(doneCalls);
});

test('exhausted gateway polling budget never dispatches again', async () => {
  const f=fixture(); await f.call({task:'Build'});
  f.session.metadata.remoteOps.poll={jobId:'job-1',count:600,nextAt:0};
  const r=await f.call({action:'status'});expect(r.status).toBe(409);expect(r.body.stopPolling).toBe(true);expect(f.invokeTool).toHaveBeenCalledTimes(1);
});

test('cancel has a separate lane while an observation holds the session and is idempotent', async () => {
  const f=fixture(); f.session.metadata.remoteOps={receipts:[],job:{jobId:'ragent_owned',targetId:'k3s-primary',status:'running'}};
  let enter,release;const entered=new Promise(r=>{enter=r});
  f.invokeTool.mockImplementationOnce(async(_req,res)=>{enter();await new Promise(r=>{release=r});res.json({success:true,data:{success:true,data:{remoteCodeJobId:'ragent_owned',completionStatus:'running'}}});});
  const observing=f.call({action:'status'}).then(r=>r);await entered;
  const cancelled=await f.call({action:'cancel',jobId:'ragent_owned'});expect(cancelled.status).toBe(200);
  expect(cancelled.body.data.artifactsPreserved).toBe(true);
  expect((await f.call({action:'cancel',jobId:'ragent_owned'})).body.replayed).toBe(true);
  expect(f.cancelTask).toHaveBeenCalledTimes(1);expect(f.artifactService.deleteArtifact).not.toHaveBeenCalled();
  release();await observing;
  expect(f.session.metadata.remoteOpsCancel.status).toBe('terminated');
});

test('cancel requires exact owned job and does not accept another target', async()=>{
  const f=fixture();f.session.metadata.remoteOps={receipts:[],job:{jobId:'ragent_owned',targetId:'k3s-primary',status:'running'}};
  expect((await f.call({action:'cancel'})).status).toBe(400);
  expect((await f.call({action:'cancel',jobId:'ragent_other'})).status).toBe(404);
  expect((await f.call({action:'cancel',jobId:'ragent_owned',targetId:'k3s-secondary'})).status).toBe(409);
  expect(f.cancelTask).not.toHaveBeenCalled();
});
