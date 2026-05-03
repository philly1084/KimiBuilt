---
name: release-risk-gate
description: Combine secret, manifest, image, and context checks into a release decision.
---

Use this skill when the task matches the description.

## Workflow

Run `secure-codex release-gate <manifest-path>`. Return pass/warn/block with evidence, blockers, warnings, and next safe command.

## Output

Provide clear evidence, safe next commands, and any missing information.
