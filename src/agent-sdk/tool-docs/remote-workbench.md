# Remote Workbench

`remote-workbench` is the structured remote CLI lane for agents. It wraps `remote-command`, keeps the same runner or SSH fallback, and exposes action names so the planner does not have to invent shell for routine repo and deployment work.

## Actions

- `baseline`, `repo-inspect`, `repo-map`, `changed-files`, `file-search`, `dependency-check`
- `grep` with `needle` and optional `path`
- `read-file` with `path`, `startLine`, and `lineCount`
- `write-file` with `path` and `content` or `contentBase64`
- `apply-patch` with a unified diff in `patch`
- `build`, `test`, `focused-test`, `buildkit`, `direct-image-build`
- `kubectl-inspect`, `k8s-app-inventory`, `logs`, `pod-debug`, `rollout`, `deploy-verify`

## Profiles

- `inspect`: baseline, repo/file search, read-only Kubernetes inspection, logs
- `build`: file writes, patch application, build and test commands
- `deploy`: rollout and deployment verification

Use `remote-command` for expert one-off shell that does not fit one of these actions. Use `remote-cli-agent` when the remote coding agent should own a longer build/deploy loop.

## Examples

```json
{"action":"repo-map","cwd":"/srv/apps/kimibuilt"}
```

```json
{"action":"grep","cwd":"/srv/apps/kimibuilt","needle":"REMOTE_CLI_MCP_BEARER_TOKEN","path":"src"}
```

```json
{"action":"apply-patch","cwd":"/srv/apps/kimibuilt","patch":"diff --git a/file.js b/file.js\n..."}
```
