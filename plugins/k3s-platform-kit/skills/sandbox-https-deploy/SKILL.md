---
name: sandbox-https-deploy
description: Deploy a namespace-isolated HTTPS sandbox to the AI harness with dry-run-first gates.
---

Use this skill when the task matches the description.

## Workflow

Active context must be `harness` or `local`, never `prod`. Include quota, cleanup labels, network policy, service, ingress, and TLS settings. Run preflight and security gates. Apply only with `SAFE_APPLY=1`. Verify with `observe-codex snapshot --namespace <ns>`.

## Output

Provide clear evidence, safe next commands, and any missing information.
