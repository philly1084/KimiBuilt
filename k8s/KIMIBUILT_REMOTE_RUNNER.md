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
KIMIBUILT_RUNNER_CAPABILITIES=inspect,deploy,build
KIMIBUILT_RUNNER_ALLOWED_ROOTS=/opt,/srv,/var/www,/tmp
EOF
sudo chmod 0640 /etc/kimibuilt/runner.env
```

Create a dedicated user:

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin kimibuilt-runner || true
sudo usermod -aG docker kimibuilt-runner || true
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
  -d '{"command":"hostname && whoami && uname -m","profile":"inspect","timeout":30000}'
```

## Policy Notes

The runner blocks privileged commands unless the job includes explicit approval metadata. Blocked examples include `sudo`, package installs/removals, recursive force deletes, systemd state changes, and Kubernetes Secret mutation. Run the service as the least-privileged user that can perform the normal deploy path, and add narrow sudoers rules only for actions you intentionally want agents to perform.

SSH remains supported as the fallback transport when no healthy runner is connected.
