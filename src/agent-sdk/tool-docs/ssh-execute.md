# ssh-execute

Purpose: run commands on a configured remote host over SSH.

Requirements:
- SSH host
- username
- password or private key

Preferred setup:
- cluster secret values `KIMIBUILT_SSH_*`
- or admin dashboard SSH defaults

Use when:
- the user explicitly wants remote command execution

Notes:
- This is a high-risk tool and should require explicit user intent.
- The frontend-visible alias in this project is `remote-command`.
- The common target in this repo is an Ubuntu Linux ARM64 host running k3s.
- Start remote troubleshooting with a concrete baseline such as:

```bash
hostname && whoami && uname -m && (test -f /etc/os-release && sed -n '1,6p' /etc/os-release || true) && uptime
```

- For standard deploy flows, prefer `k3s-deploy`.
- For the command catalog and k3s/Ubuntu operating guidance, read the `remote-command` tool doc.
