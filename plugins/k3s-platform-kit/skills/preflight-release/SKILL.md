---
name: preflight-release
description: Run context, dry-run, and manifest checks before a k3s release.
---

Use this skill when the task matches the description.

## Workflow

Run `k3s-codex context`, `k3s-codex preflight --path <path>`, and `secure-codex release-gate <path>`. Return decision, blockers, warnings, next safe command, and rollback notes.

## Output

Provide clear evidence, safe next commands, and any missing information.
