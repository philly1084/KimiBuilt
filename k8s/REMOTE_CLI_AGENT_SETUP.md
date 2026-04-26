# Remote CLI Agent Setup

The backend reads Remote CLI Agent settings from:

- ConfigMap: `kimibuilt-config`
- Secret: `kimibuilt-secrets`
- Namespace: normally `kimibuilt`

`REMOTE_CLI_MCP_URL` belongs in the ConfigMap. The bearer credential belongs in
the Secret as either `REMOTE_CLI_MCP_BEARER_TOKEN` or `N8N_API_KEY`.

## One-command setup

From this repository:

```powershell
npm run k8s:setup-remote-cli-agent
```

The script:

- detects the KimiBuilt namespace from the active kube context
- creates or patches `kimibuilt-config`
- creates or patches `kimibuilt-secrets`
- restarts `deployment/backend`
- waits for rollout unless `-NoRestart` is passed

It reads values from the current process environment first, then `.env`.

Useful overrides:

```powershell
powershell -ExecutionPolicy Bypass -File k8s/setup-remote-cli-agent.ps1 `
  -Namespace kimibuilt `
  -RemoteCliMcpUrl "http://n8n-openai-cli-gateway.n8n-openai-gateway.svc.cluster.local/mcp" `
  -N8nApiKey $env:N8N_API_KEY
```

If no KimiBuilt namespace is found, the script stops instead of creating
resources in the wrong cluster. Pass `-CreateNamespace` only after confirming the
current kube context is the target cluster.
