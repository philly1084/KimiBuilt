---
name: manifest-policy-check
description: Check Kubernetes manifests for risky defaults such as latest tags, missing limits, and privileged pods.
---

Use this skill when the task matches the description.

## Workflow

Run `secure-codex manifest-scan <path>`. Check latest tags, privileged containers, host networking, missing probes, and missing resource requests/limits. Suggest manifest patches.

## Output

Provide clear evidence, safe next commands, and any missing information.
