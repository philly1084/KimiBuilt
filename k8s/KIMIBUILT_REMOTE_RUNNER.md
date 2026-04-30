# KimiBuilt Remote Runner

The remote runner is a resident agent-side control service for the deployment server. It connects outbound to the KimiBuilt backend and lets backend tools run audited remote jobs without opening a public shell endpoint.

## Backend Configuration

Set a shared runner token on the KimiBuilt backend:

```bash
KIMIBUILT_REMOTE_RUNNER_TOKEN=<long-random-token>
KIMIBUILT_REMOTE_RUNNER_ENABLED=true
KIMIBUILT_REMOTE_RUNNER_PREFERRED=true
MANAGED_APPS_DEPLOY_TARGET=runner
```

Restart the backend after adding these values.

## Deploy Server Installation

On the Ubuntu ARM64 deployment server, use the same repository checkout or install the package files containing `bin/kimibuilt-runner.js`.

Create an environment file:

```bash
sudo install -d -m 0750 /etc/kimibuilt
sudo tee /etc/kimibuilt/runner.env >/dev/null <<'EOF'
KIMIBUILT_BACKEND_URL=https://kimibuilt.demoserver2.buzz
KIMIBUILT_REMOTE_RUNNER_TOKEN=<same-long-random-token>
KIMIBUILT_RUNNER_ID=demoserver2-builder
KIMIBUILT_RUNNER_NAME=Demoserver2 Builder
KIMIBUILT_RUNNER_CAPABILITIES=inspect,deploy,build,admin
KIMIBUILT_RUNNER_ALLOWED_ROOTS=/workspace,/opt,/srv,/var/www,/tmp
KIMIBUILT_RUNNER_DEFAULT_CWD=/workspace
KIMIBUILT_RUNNER_SHELL=/bin/bash
KIMIBUILT_RUNNER_CLI_TOOLS=bash,sh,node,npm,npx,playwright-core,git,kubectl,k3s,helm,docker,buildctl,curl,wget,jq,yq,python3,python,tar,gzip,unzip,rsync,ssh,scp,systemctl,journalctl,ss,ip,getent,dig,nslookup,openssl,chromium,chromium-browser,google-chrome,google-chrome-stable
ARTIFACT_BROWSER_PATH=/usr/bin/chromium
PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium
EOF
sudo chmod 0640 /etc/kimibuilt/runner.env
```

Create a dedicated user:

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin kimibuilt-runner || true
sudo usermod -aG docker kimibuilt-runner || true
sudo install -d -o kimibuilt-runner -g kimibuilt-runner -m 0750 /workspace
```

Install a systemd unit. Adjust `WorkingDirectory` to the repo or package location:

```ini
[Unit]
Description=KimiBuilt Remote Runner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=kimibuilt-runner
Group=kimibuilt-runner
WorkingDirectory=/opt/kimibuilt
EnvironmentFile=/etc/kimibuilt/runner.env
ExecStart=/usr/bin/node /opt/kimibuilt/bin/kimibuilt-runner.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kimibuilt-runner
sudo journalctl -u kimibuilt-runner --no-pager -n 100
```

## Verification

From an authenticated KimiBuilt session:

```bash
curl https://kimibuilt.demoserver2.buzz/api/runners
```

Expected: the runner appears as `online`.

To run a direct command job:

```bash
curl -X POST https://kimibuilt.demoserver2.buzz/api/runners/demoserver2-builder/jobs \
  -H 'Content-Type: application/json' \
  -d '{"command":"pwd && hostname && whoami && uname -m","profile":"inspect","timeout":30000}'
```

Expected: `pwd` reports `/workspace` unless the job supplies a narrower `cwd`.

For website UI screenshot checks, verify Playwright/Chromium and the helper:

```bash
curl -X POST https://kimibuilt.demoserver2.buzz/api/runners/demoserver2-builder/jobs \
  -H 'Content-Type: application/json' \
  -d '{"command":"command -v chromium && node -e \"require(\\\"playwright-core\\\"); console.log(\\\"playwright-core ok\\\")\" && node /opt/kimibuilt/bin/kimibuilt-ui-check.js https://example.com --out /tmp/kimibuilt-ui-smoke","profile":"inspect","timeout":60000}'
```

Expected: output includes `UI_CHECK_REPORT=...` and `UI_SCREENSHOT=...` lines.

## Admin Runner Mode

`admin` is an explicit runner capability profile for real deployment work that
needs privileged operations. Enable it only on a runner account that has the
narrow permissions you want agents to use.

Recommended pattern:

- keep the service user non-root
- grant narrow passwordless sudoers entries only for intended deployment
  operations
- require job approval metadata for privileged commands
- keep `KIMIBUILT_RUNNER_ALLOWED_ROOTS` limited to deployment workspaces
- use `remote-cli-agent` with `adminMode: true` for app/site/service
  author -> build -> deploy -> verify loops

The runner still blocks dangerous command shapes unless the job includes
`approval.approved=true` or `metadata.approved=true`. If a command is blocked,
the agent should change strategy or report the missing approval/capability
instead of retrying the same command.

## Policy Notes

The runner blocks privileged commands unless the job includes explicit approval metadata. Blocked examples include `sudo`, package installs/removals, recursive force deletes, systemd state changes, and Kubernetes Secret mutation. Run the service as the least-privileged user that can perform the normal deploy path, and add narrow sudoers rules only for actions you intentionally want agents to perform.

SSH remains supported as the fallback transport when no healthy runner is connected.
