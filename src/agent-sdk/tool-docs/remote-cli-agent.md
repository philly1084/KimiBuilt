# remote-cli-agent

Purpose: run a server-side OpenAI Agents SDK coding agent with the remote-cli Streamable HTTP MCP gateway attached.

Use this tool when the user asks for backend CLI agents behind the router to work on a remote server, especially coding/build/deploy tasks that should go through the gateway's `remote_code_run` and `remote_code_status` tool schema.

For most remote software deployments, prefer `remote-cli-agent` over one-shot `remote-command`: if an app, website, service, dashboard, frontend, or game needs to be created or changed and put live, let the remote CLI agent own the author -> build/test -> deploy -> verify loop.

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

Admin runner mode:

- Pass `adminMode: true` when the task is a real remote software change/deploy request and the user has asked to make it live.
- Admin mode means the agent may use the configured admin-capable CLI runner or target for scoped repo edits, builds, image pushes, Kubernetes apply/rollout, ingress/TLS, and verification required by the task.
- It is not a blanket root shell. The agent must stay inside the owning workspace, namespace, domain, and deployment path.
- Do not mutate Kubernetes Secrets, wipe data, force-push, perform broad package upgrades, or change unrelated host services unless the user explicitly approved that exact action.
- If a runner/sudo policy blocks a command, do not retry the same blocked command. Switch to a non-privileged supported path or stop and report the exact approval, runner capability, credential, or sudoers change needed.

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
- Track repeated failures. After the same command shape or root error fails twice without a materially different fix, stop that loop, summarize the blocker, and name the next distinct recovery option.
- If the remote CLI agent needs a user choice to finish, emit `USER_INPUT_REQUIRED=<question/options>` and stop. The KimiBuilt-side agent should forward the request to the user and continue the same remote CLI session after the answer.
- For website/dashboard/frontend work, run Playwright/Chromium visual QA when a local preview or public URL exists. Prefer `node /app/bin/kimibuilt-ui-check.js <url> --out ui-checks` when the helper is present.
- The final output should include continuity markers when known: `REMOTE_CLI_SESSION_ID=...`, `WORKSPACE=...`, `GIT_REPO=...`, `GIT_COMMIT=...`, `DEPLOYMENT=...`, `PUBLIC_HOST=...`, `UI_CHECK_REPORT=...`, and `UI_SCREENSHOTS=...`.
- Prefer `waitMs: 30000` for long coding tasks.
- Pass `sessionId` when continuing a previous remote coding session.
- Pass `mcpSessionId` when continuing a previous Streamable HTTP MCP session.
- Frontends expose `/remote agent <task>` for handing a full coding, build, deploy, and verification loop to this tool.

Use `remote-command` instead for quick non-interactive host inspection, one-off repairs, or small kubectl/log checks. Use `remote-cli-agent` when the remote code agent should own the coding and deployment loop.
