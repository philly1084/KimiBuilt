---
name: app-scaffold
description: Create k3s-friendly app manifests with service, deployment, ingress, probes, and resource defaults.
---

Use this skill when the task matches the description.

## Workflow

Start from `templates/app/base`. Use explicit image tags, labels, selectors, probes, requests, and limits. For HTTPS experiments, render from `templates/sandbox`. Run `secure-codex manifest-scan <path>` and `k3s-codex preflight --path <path>`.

## Output

Provide clear evidence, safe next commands, and any missing information.
