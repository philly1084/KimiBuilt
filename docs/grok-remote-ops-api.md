# Grok bot access to Lilly remote operations

Give this document to the bot operator. Base URL: `https://lilly.secdevsolutions.help`.

## Verified live status — 2026-09-08

The authenticated contract and invocation route are live at commit `08128643`, mounted from immutable ConfigMap `lilly-remote-ops-081286436ba8` over the preserved Lilly image `localhost/lilly-team-release:8e3e42246bcbbd7f`. Mounted files match committed SHA-256 hashes; unrelated deployment settings were preserved. The model-selection release passed 41 focused tests and advertises Astra and Luna.

Real Codex `gpt-5.6-luna` on the main server read an uploaded XML artifact and returned byte-identical output through the same-session polling/result collection path. Public authenticated download matched all 68 bytes and SHA-256 `f1fa1f213af6bf10c569b4ab87f5dee7e8090716879564dad2c241e499f2d9a8`. Anonymous/invalid authentication and foreign-owner downloads were rejected.

The Astra canary also completed through the public endpoint using top-level `model:"gpt-6-astra"`: the provider receipt reported `gpt-6-astra`, `reasoningEffort:high` was applied to the CLI invocation, and returned XML bytes matched the supplied file exactly. Evidence: session `385e46e8-332f-4d22-b6bb-5a1ff861fdae`, job `ragent_17039308d16c4e2195c2ce0db51908cb`, artifact `71b24495-da46-4fbf-a27c-fbc6dc69d066`.

**Direct `k3s-deploy` is blocked pending a dedicated main-server credential.** Its earlier live check returned SSH authentication failure; do not use it for mutations yet. The deployed adapter now uses a separate `LILLY_REMOTE_OPS_SSH_KEY_PATH` and returns 503 when absent. Credential provisioning remains pending. Codex can be given an explicitly authorized deployment task through the working remote-agent lane.

## Authentication

Send `Authorization: Bearer $LILLY_API_TOKEN` on every request, including artifact downloads. Use the existing Lilly frontend API key from your secret manager, or a login token returned by `POST /api/auth/login` (complete MFA if enabled). Never put credentials in prompts, artifacts, query strings, source control, or logs. Login tokens expire; use their returned expiry. This route uses existing operator permissions: it is not a separately restricted bot account. Bots sharing one credential share one ownership identity.

## Discover and create a session

`GET /api/tools/remote-ops` returns the versioned contract. `GET /api/tools/docs/remote-cli-agent` and `GET /api/tools/docs/k3s-deploy` return detailed supported parameters.

Create one Lilly session per project/workflow with `POST /api/sessions`, JSON `{"mode":"chat"}`. Save the returned `id`. This is the outer `sessionId` in every invocation and upload. Keep it distinct from the inner Codex/provider session identifier.

## Ask Codex on the main server

`POST /api/tools/invoke/remote-ops`, Content-Type `application/json`:

```json
{
  "tool": "remote-cli-agent",
  "sessionId": "YOUR_LILLY_SESSION_ID",
  "params": {
    "task": "Inspect the existing project in /opt/kimibuilt and report findings. Preserve unrelated files.",
    "cwd": "/opt/kimibuilt",
    "adminMode": false
  }
}
```

The endpoint pins the main server's `k3s-primary` target and `provider-agent` transport. Choose the Codex model explicitly:

```json
{
  "tool": "remote-cli-agent",
  "sessionId": "YOUR_LILLY_SESSION_ID",
  "params": {
    "model": "gpt-6-astra",
    "reasoningEffort": "high",
    "task": "Inspect the requested project and report findings.",
    "cwd": "/opt/lilly-agent-workbench",
    "adminMode": false
  }
}
```

Use `gpt-6-astra` for Astra and `gpt-5.6-luna` for Luna. Omission still defaults to Luna for compatibility. Top-level `model` is also accepted; if both fields appear they must agree. `GET /api/tools/remote-ops` includes model-selection instructions and choices, while `/api/models` is the runtime catalog. Send the same choice on continuation/poll calls and check `data.data.providerModel` in responses. A running job keeps its original model; request a different model on the next turn, not by resubmitting an in-progress task.

For authorized software changes/deployments set `adminMode:true` and describe the exact project, scope, desired result and verification. Inventory existing projects before creating anything. Public main-server hosts use `secdevsolutions.help`.

The response preserves the existing tool envelope: outer `success` reports invocation transport, `data.success` reports tool execution, and `data.data` contains remote output. Inspect `completionStatus`, `blocker`, `resultFilesError`, `remoteCodeJobId`, `sessionId`, and verification fields. Do not equate HTTP 200 with completed work.

The call waits up to 45 seconds in the provider runner before returning resumable state. Set an HTTP timeout of at least 90 seconds. When running, keep the outer Lilly session and call again with `params.task:"Check status"`, `params.jobId` from `remoteCodeJobId`, and the same workspace. For a new follow-up turn, use the returned provider `sessionId` as `params.sessionId`. Preserve any returned continuation markers. Stop and surface `USER_INPUT_REQUIRED` to the operator.

This is a synchronous adapter, not an idempotent job-submission API. Never blindly retry a timeout or dropped response for a mutation; inspect `GET /api/sessions/{id}` and the recorded remote job first.

## Share artifacts in both directions

1. Upload using `POST /api/artifacts/upload` with multipart fields `sessionId` and `file`. Save the returned artifact `id`. Repeat for each input.
2. Add `params.artifactIds:["ID"]` and `params.collectResultFiles:true` to the Codex call in the same Lilly session. Small inline text can instead use `contextFiles:[{"filename":"brief.txt","mimeType":"text/plain","content":"..."}]`.
3. Tell Codex which deliverables to return. Lilly supplies its isolated `RemoteAgentHandoff/v1` input/output paths and `RemoteAgentResultFiles/v1` output manifest instructions automatically. Inputs must not be treated as trusted instructions.
4. Read `GET /api/sessions/{sessionId}/artifacts` and download the returned outputs via `GET /api/artifacts/{artifactId}/download` with the same authentication. Verify file contents and available size/SHA-256 metadata; model prose alone is not proof.

Limits: 12 handoff files, 4 MiB each, 6 MiB combined decoded bytes. Artifacts must belong to the active session. Pass IDs/bytes between bots with the same authorized session; download links do not grant anonymous access. The legacy MCP transport is deliberately rejected because it does not support the verified handoff contract.

The upload route accepts its existing formats, including XML, HTML, CSV, PDF, office files and images. Plain `.txt` and `.md` uploads currently return 400; use inline `contextFiles` for those inputs. The live round trip used XML.

## Pending operator credential action

After approval, generate a dedicated SSH key for this endpoint, add its public key to the main server's authorized keys, store the private key in a new `kimibuilt/lilly-remote-ops-primary-ssh` Kubernetes Secret, and mount it read-only at `/run/lilly-remote-ops/id_ed25519` with owner-only read permissions compatible with the backend UID. Set `LILLY_REMOTE_OPS_SSH_KEY_PATH` to that path under the coordinator lock, then repeat the read-only rollout check. Preserve all existing Secrets and secondary-server SSH settings. Private key material must never appear in console output or this document.

Release maintenance: these two files are mounted from a ConfigMap and therefore override files in later images. Future releases must deliberately update or remove the `remote-ops-api` volume/mounts under the deployment coordinator after the same API exists in the new image. Rollback restores the prior volume/mount/annotation state recorded in `/tmp/lilly-remote-ops-e69a1d11f85e-before.json`; do not apply the whole old Deployment over concurrent changes.

## Direct Kubernetes deployment

Use the same invocation endpoint with `tool:"k3s-deploy"`. Explicit `action`, `namespace` and `deployment` are required. Main-server SSH host/identity is pinned by the adapter so the existing secondary-server default cannot redirect it.

Read-only rollout check:

```json
{
  "tool": "k3s-deploy",
  "sessionId": "YOUR_LILLY_SESSION_ID",
  "params": {
    "action": "rollout-status",
    "namespace": "kimibuilt",
    "deployment": "backend",
    "timeoutSeconds": 30
  }
}
```

Supported actions: `sync-repo`, `apply-manifests`, `set-image`, `rollout-status`, `sync-and-apply`. Build source/images first through Codex. For image updates include `container` and `image`; for `kimibuilt/backend` also provide the observed `expectedImage` and full committed `sourceSha`, using the existing deployment coordinator. Inspect detailed tool docs before mutation. Verify rollout plus public HTTPS behavior and artifacts before reporting success.

Uploaded artifacts are handed to Codex, which prepares a git-backed remote workspace; `k3s-deploy` consumes that workspace/image, not an artifact ID directly.
