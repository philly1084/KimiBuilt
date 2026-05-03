---
name: event-timeline
description: Turn Kubernetes events and rollout history into a time-ordered incident timeline.
---

Use this skill when the task matches the description.

## Workflow

Use `observe-codex events --namespace <ns>`. Group by object/reason, identify first bad event and repeats, then produce a table of time, object, signal, interpretation, confidence.

## Output

Provide clear evidence, safe next commands, and any missing information.
