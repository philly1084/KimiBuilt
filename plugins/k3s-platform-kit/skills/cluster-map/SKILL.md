---
name: cluster-map
description: Map kube contexts, namespaces, workloads, and trust zones before k3s work.
---

Use this skill when the task matches the description.

## Workflow

Run `k3s-codex context` first. If cluster state matters, run `k3s-codex inventory --summary`. Unknown contexts are read-only. Harness work uses sandbox namespaces and `SAFE_APPLY=1` only after preflight. Production work becomes PR/GitOps with validation evidence and rollback notes.

## Output

Provide clear evidence, safe next commands, and any missing information.
