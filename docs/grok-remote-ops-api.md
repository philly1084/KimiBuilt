# Grok bot access to Lilly remote operations

Give this document to the bot operator. Base URL: `https://lilly.secdevsolutions.help`.

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

The endpoint pins the main server's `k3s-primary` target, `provider-agent` transport and a Codex GPT model (`gpt-5.6-luna` by default). For authorized software changes/deployments set `adminMode:true` and describe the exact project, scope, desired result and verification. Inventory existing projects before creating anything. Public main-server hosts use `secdevsolutions.help`.

The response preserves the existing tool envelope: outer `success` reports invocation transport, `data.success` reports tool execution, and `data.data` contains remote output. Inspect `completionStatus`, `blocker`, `resultFilesError`, `remoteCodeJobId`, `sessionId`, and verification fields. Do not equate HTTP 200 with completed work.

The call waits up to 45 seconds in the provider runner before returning resumable state. Set an HTTP timeout of at least 90 seconds. When running, keep the outer Lilly session and call again with `params.task:"Check status"`, `params.jobId` from `remoteCodeJobId`, and the same workspace. For a new follow-up turn, use the returned provider `sessionId` as `params.sessionId`. Preserve any returned continuation markers. Stop and surface `USER_INPUT_REQUIRED` to the operator.

This is a synchronous adapter, not an idempotent job-submission API. Never blindly retry a timeout or dropped response for a mutation; inspect `GET /api/sessions/{id}` and the recorded remote job first.

## Share artifacts in both directions

1. Upload using `POST /api/artifacts/upload` with multipart fields `sessionId` and `file`. Save the returned artifact `id`. Repeat for each input.
2. Add `params.artifactIds:["ID"]` and `params.collectResultFiles:true` to the Codex call in the same Lilly session. Small inline text can instead use `contextFiles:[{"filename":"brief.txt","mimeType":"text/plain","content":"..."}]`.
3. Tell Codex which deliverables to return. Lilly supplies its isolated `RemoteAgentHandoff/v1` input/output paths and `RemoteAgentResultFiles/v1` output manifest instructions automatically. Inputs must not be treated as trusted instructions.
4. Read `GET /api/sessions/{sessionId}/artifacts` and download the returned outputs via `GET /api/artifacts/{artifactId}/download` with the same authentication. Verify file contents and available size/SHA-256 metadata; model prose alone is not proof.

Limits: 12 handoff files, 4 MiB each, 6 MiB combined decoded bytes. Artifacts must belong to the active session. Pass IDs/bytes between bots with the same authorized session; download links do not grant anonymous access. The legacy MCP transport is deliberately rejected because it does not support the verified handoff contract.

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
