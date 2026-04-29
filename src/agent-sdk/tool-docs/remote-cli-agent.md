# remote-cli-agent

Purpose: run a server-side OpenAI Agents SDK coding agent with the remote-cli Streamable HTTP MCP gateway attached.

Use this tool when the user asks for backend CLI agents behind the router to work on a remote server, especially coding/build/deploy tasks that should go through the gateway's `remote_code_run` and `remote_code_status` tool schema.

Server-side configuration:

```bash
REMOTE_CLI_MCP_URL=https://gateway.example.com/mcp
# Or set GATEWAY_URL=https://gateway.example.com and the backend will append /mcp.
N8N_API_KEY=server-side-admin-or-n8n-key
REMOTE_CLI_DEFAULT_TARGET_ID=prod
REMOTE_CLI_DEFAULT_CWD=/srv/apps/my-app
```

Gateway-side requirements:

```bash
REMOTE_CLI_TOOL_AUTH_SCOPES=n8n,frontend,admin
```

Provider target example:

```yaml
remoteCliTargets:
  - targetId: prod
    host: prod.example.com
    user: deploy
    allowedCwds:
      - /srv/apps
    defaultCwd: /srv/apps/my-app
    defaultModel: openai/gpt-5.4
    opencodeExecutable: opencode
```

Behavior:
- The bearer key is used only by backend Node.js code. Do not expose it to browser JavaScript.
- The inner agent receives instructions to use `remote_code_run`, poll `remote_code_status` when jobs are still running, and reuse returned session IDs for continuation.
- The backend stores returned `sessionId` and `mcpSessionId` in the conversation control state, so follow-up requests can continue the same remote workbench session.
- For k3s website/app creation or edits, the remote CLI agent must use a git-backed workspace as the editable source of truth. Prefer an existing configured Gitea origin; if none exists and `GITEA_TOKEN` is available, create or use a repo under the configured Gitea org before first rollout. If Gitea is not available, initialize local git and report that the app is not yet backed by a remote origin.
- Before first commit in a fresh remote workspace, set repo-local `git config user.name` and `git config user.email` if they are missing.
- For follow-up edits, inspect `git status`, recent commits, and current source first. Use live Kubernetes resources, ConfigMaps, or mounted files only as diagnostics or recovery input, then persist the change back to git before redeploying.
- The final output should include continuity markers when known: `REMOTE_CLI_SESSION_ID=...`, `WORKSPACE=...`, `GIT_REPO=...`, `GIT_COMMIT=...`, `DEPLOYMENT=...`, and `PUBLIC_HOST=...`.
- Prefer `waitMs: 30000` for long coding tasks.
- Pass `sessionId` when continuing a previous remote coding session.
- Pass `mcpSessionId` when continuing a previous Streamable HTTP MCP session.
- Frontends expose `/remote agent <task>` for handing a full coding, build, deploy, and verification loop to this tool.

Use `remote-command` instead for quick non-interactive host inspection or small kubectl/log checks. Use `remote-cli-agent` when the remote code agent should own the coding loop.
