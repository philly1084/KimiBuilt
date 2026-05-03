---
name: production-promotion
description: Prepare production PR/GitOps promotions without direct prod apply.
---

Use this skill when the task matches the description.

## Workflow

Default behavior: do not apply. Prepare a PR/GitOps patch with validation evidence, risk summary, rollout plan, and rollback plan. Direct production writes require explicit user instruction plus `ALLOW_PROD_WRITE=yes HUMAN_APPROVED=yes CHANGE_TICKET=<id>`, but PR/GitOps remains preferred.

## Output

Provide clear evidence, safe next commands, and any missing information.
