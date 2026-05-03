---
name: secret-sweep
description: Scan a repository for likely secrets while masking values in reports.
---

Use this skill when the task matches the description.

## Workflow

Run `secure-codex secret-scan <path>`. Treat findings as blockers until reviewed. Do not print secret values. Suggest high-level remediation and rotation when needed.

## Output

Provide clear evidence, safe next commands, and any missing information.
