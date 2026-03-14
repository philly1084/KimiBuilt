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
