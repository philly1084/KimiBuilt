# Grok bot access to Lilly remote operations

Base URL: `https://lilly.secdevsolutions.help`. The URLs and bearer authentication remain unchanged:

- Discover: `GET /api/tools/remote-ops` (revision 2 describes the new contract).
- Invoke: `POST /api/tools/invoke/remote-ops`.
- Create a project session: `POST /api/sessions` with `{"mode":"chat"}`; save the returned `id`.
- Download: `GET /api/artifacts/{artifactId}/download` with the same authorization.

Send `Authorization: Bearer $LILLY_API_TOKEN`. Keep the previously issued token in the bot's secret store; its recorded expiry is authoritative. Bots using the same credential share the existing operator identity and permissions. Never put tokens in prompts or artifacts.

## Astra and long-running work

```json
{
  "tool": "remote-cli-agent",
  "sessionId": "LILLY_SESSION_ID",
  "requestId": "project-build-001",
  "params": {
    "action": "run",
    "model": "gpt-6-astra",
    "reasoningEffort": "high",
    "targetId": "k3s-primary",
    "task": "Inspect the existing project, implement the agreed changes, verify them, and return the complete source bundle and CHECKPOINT.md.",
    "adminMode": true,
    "collectResultFiles": true,
    "observationTimeoutMs": 45000
  }
}
```

Select `gpt-6-astra` or `gpt-5.6-luna`. Top-level `model` also works; if both fields are supplied they must agree. A new run without a model defaults to Luna for compatibility. Status and continuation inherit the selected model. A running job cannot change model; the next continuation turn can explicitly choose another model.

`observationTimeoutMs` controls only this HTTP observation (1,000–240,000 ms; default 45,000). `agentRunTimeoutMs` is its compatible alias. Allow at least 60 additional seconds in the HTTP client for setup and artifact collection. An HTTP timeout is not a job timeout or proof of failure.

The live gateway configuration inspected on 2026-09-09 permits four hours per task and 30 minutes without activity. These are execution limits, separate from observation. Keep meaningful progress flowing during builds and save a real `CHECKPOINT.md` with objective, decisions, changed files, verification, blockers, and exact next steps. Objectives exceeding a task lifetime must span checkpointed continuation turns. This API does not promise an unlimited process or automatically schedule the next turn.

The gateway job handle is persisted as soon as dispatch is acknowledged, before output streaming. Every mutation should carry a unique `requestId`. If the connection drops, retry the identical JSON with the **same** ID. Its saved receipt is replayed; different content with the same ID gets 409. Never assign a fresh ID merely to retry uncertain dispatch. If acknowledgment itself was lost, the API reports unconfirmed dispatch and requires inspection instead of risking a duplicate job. Receipts protect up to 200 mutations per Lilly session; create a new session before that limit.

## Poll, give feedback, and continue

Responses include `next.request`. While running, send that request to the same invocation endpoint, or:

```json
{"tool":"remote-cli-agent","sessionId":"LILLY_SESSION_ID","params":{"action":"status","observationTimeoutMs":45000}}
```

Status observes the saved owned job and restores its handoff state. It never launches a replacement. One request may observe a session at a time; a concurrent request receives 409 and can wait before polling. Keep the outer Lilly session ID distinct from the inner provider/Codex session ID; the adapter saves the latter for you.

After the current turn becomes terminal, continue:

```json
{
  "tool":"remote-cli-agent",
  "sessionId":"LILLY_SESSION_ID",
  "requestId":"project-revision-002",
  "params":{
    "action":"continue",
    "task":"Continue from CHECKPOINT.md and apply the review feedback.",
    "supportAgentResponse":"Use the supplied logo and fix the mobile navigation overlap.",
    "artifactIds":["NEW_FEEDBACK_ARTIFACT_ID"],
    "collectResultFiles":true,
    "adminMode":true
  }
}
```

Astra is instructed to finish a checkpointed turn with `SUPPORT_AGENT_REQUIRED` for bot feedback or `USER_INPUT_REQUIRED` for an operator decision. Surface those questions and answer in a continuation. Do not replace an active job to inject feedback. Check `data.success`, `data.data.completionStatus`, `blocker`, `resultFilesError`, and returned files. HTTP 200 or a completed turn does not prove the whole objective is done.

## Select the deployment server

| Target | Host | Public domain | Default workspace |
|---|---|---|---|
| `k3s-primary` | `168.119.176.121` | `secdevsolutions.help` | `/opt/lilly-agent-workbench` |
| `k3s-secondary` | `162.55.163.199` | `demoserver2.buzz` | `/opt/kimibuilt` |

Explicit `targetId` wins for a new run. Otherwise `deploymentHost` or a domain in the task selects the server; mentioning both domains requires an explicit target. Without either, primary is selected. A status/continuation cannot switch the saved host or workspace. Start an explicit `action:run` after the previous job ends to work on the other server; the API starts a fresh provider session while retaining the shared Lilly artifact shelf.

Use the authorized Codex lane for project creation, changes, and deployments with `adminMode:true`. Inventory existing projects, namespaces, and hostnames first. Verify source, rollout, DNS, Traefik ingress, TLS, public pages/assets, and desktop/mobile behavior before claiming success.

Direct `tool:"k3s-deploy"` also uses this endpoint. Supply `targetId`, `action`, `namespace`, and `deployment`. Supported actions: `sync-repo`, `apply-manifests`, `set-image`, `rollout-status`, `sync-and-apply`. Secondary uses its existing SSH credential. **Direct primary deployment remains disabled (503) until the dedicated primary SSH credential is provisioned.** Authorized Codex deployments use the working provider lane. Do not change or copy secrets to bypass that gate.

```json
{"tool":"k3s-deploy","sessionId":"LILLY_SESSION_ID","params":{"targetId":"k3s-secondary","action":"rollout-status","namespace":"YOUR_NAMESPACE","deployment":"YOUR_DEPLOYMENT","timeoutSeconds":30}}
```

Inspect `GET /api/tools/docs/k3s-deploy` before mutations. Backend image updates retain the deployment coordinator and expected image/source guards.

## Share mixed files and complete websites

The existing invocation endpoint accepts `tool:"artifact-store"`. One owned Lilly session is shared storage for both bots and both server targets. Artifact IDs are immutable versions; another upload of the same path creates a new ID. Use authenticated download URLs or `get`; URLs do not grant anonymous access.

```json
{
  "tool":"artifact-store",
  "sessionId":"LILLY_SESSION_ID",
  "requestId":"source-batch-001",
  "params":{
    "action":"put",
    "files":[
      {"filename":"site/index.html","mimeType":"text/html","content":"<!doctype html><title>Project</title>"},
      {"filename":"site/src/app.js","mimeType":"text/javascript","content":"console.log('ready');"},
      {"filename":"site/CHECKPOINT.md","mimeType":"text/markdown","content":"Next: implement the agreed design."}
    ]
  }
}
```

For images and other binary files use `contentBase64` instead of `content`. Optional `sha256` validates the bytes. Safe relative directory paths are preserved. Limits: 64 files per batch, 4 MiB per file, 6 MiB total decoded bytes; use multiple batches. The JSON route also has its existing 10 MB request limit. The shelf supports code, text, images, and arbitrary binary types without the multipart uploader's extension restrictions.

Other actions, with the same tool/session envelope:

```json
{"action":"list","offset":0,"limit":64}
```
```json
{"action":"get","artifactIds":["ARTIFACT_ID"]}
```
```json
{"action":"bundle","filename":"website-source.zip","artifactIds":["HTML_ID","JS_ID","CSS_ID","IMAGE_ID","CHECKPOINT_ID"]}
```

`list` returns `total` and `nextOffset`. `get` returns base64 bytes and SHA-256. `bundle` creates a ZIP with relative paths intact; select one version per path. Use a fresh `requestId` for each bundle. Its `data.data.artifactIds` can be supplied to a remote-agent run/continuation. ZIPs are limited to 4 MiB; split larger projects into bundles. Bundle creation retains the existing artifact privacy export checks.

The Codex handoff still accepts 12 files, 4 MiB each, 6 MiB combined. Packaging a multi-file website into ZIP avoids the file-count limit. Tell Codex to inspect archive paths before extracting into its isolated project, preserve editable source/assets and launch instructions, and return a complete ZIP plus manifest, checksum/QA report, and checkpoint using the supplied `RemoteAgentResultFiles/v1` manifest. Set `collectResultFiles:true` when starting each turn; status inherits collection state. Never send new artifacts on a status-only request.

## Verification and release maintenance

The previous model-selection release verified real Astra/high reasoning and Luna artifact round trips on primary. Astra evidence: session `385e46e8-332f-4d22-b6bb-5a1ff861fdae`, job `ragent_17039308d16c4e2195c2ce0db51908cb`, output `71b24495-da46-4fbf-a27c-fbc6dc69d066`. The long-horizon revision is live at runtime commit df79ad0b. See [the live verification record](grok-remote-ops-live-proof-2026-09-09.md) for 242 passing tests, mounted-source hashes, real Astra/high runs on both servers, backend-replacement continuity, and 21-file/feedback ZIP byte checks.

Runtime patches are immutable ConfigMap mounts over the preserved backend image. Future image releases must deliberately update/remove the `remote-ops-api` mounts under the coordinator; image contents alone do not replace mounted code. Rollback restores only this release's mount/config/annotation changes from its saved deployment snapshot, preserving concurrent changes.

Running results may include data.data.progressOutput (the latest 16,000 characters of transcript). Treat it as unverified progress; gateway completionStatus remains authoritative. Explicit status calls never replace a missing job, including jobs without artifact inputs.

## Polling limits and cancellation (revision 3)

The remote-ops endpoint enforces a persisted **30-second minimum between gateway status checks per job**, with at most **600 checks per job**. HTTP 429 includes `Retry-After`; wait that long. On `stopPolling:true`, stop. Exhausting the observation budget does not cancel the remote work or delete its data. Completed responses are cached, so repeated status calls do not re-fetch transcripts, re-import files, or append repeated tool history.

Admission limits are 60 requests/minute per authenticated owner per backend replica and four concurrent remote-ops requests per replica. Cancellation has its own reserved budget of six requests/minute per owner and bypasses the observation lock and normal polling limiter. Bots sharing credentials share these budgets.

Cancel a running gateway job using the **same remote-ops invocation URL**:

```json
{
  "tool":"remote-cli-agent",
  "sessionId":"LILLY_SESSION_ID",
  "params":{"action":"cancel","jobId":"ragent_EXACT_SAVED_JOB_ID"}
}
```

The job ID must match the owned Lilly session. Repeated confirmed cancellation is idempotent. This stops the verified provider process without calling the gateway's handoff-deleting task-cancel operation. Already shared artifacts and project files are retained. Temporary handoff files still follow gateway retention; unfinished output that the agent never published may not be recoverable. Use the returned status request after its delay to collect any published results. A missing job returns 404 with `stopPolling:true`, not a claim that cancellation succeeded.

The older `/admin/remote-agent-tasks/:id` API controls local task IDs, not gateway jobs from remote-ops. It now limits reads to once per URL every 10 seconds, 30 requests/minute per owner, and reserves six cancels/minute. Its transcript accepts `after` and `limit` (maximum 200 entries) and returns `nextCursor`/`hasMore`; advance the cursor rather than repeatedly downloading the entire transcript. Only one stream per owned task is allowed, with 32 streams per replica, a five-minute connection lifetime, and a bounded slow-client buffer. Reconnect using the last event cursor if the job is still active. Terminal streams close automatically; never reconnect in a tight loop.
