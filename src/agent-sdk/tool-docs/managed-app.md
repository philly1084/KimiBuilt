# managed-app

Creates and manages agent-owned applications through the external Gitea control plane and the remote SSH/k3s deployment lane.

Managed-app deployment is SSH-only. It should deploy through the configured remote host and remote k3s cluster, not through the backend pod's local Kubernetes service account.

## Actions

- `create`: registers or provisions a managed app, creates the external Gitea repository when configured, seeds scaffold files, and records a build run when a commit is created.
- `update`: updates an existing managed app by slug or id and can commit new files into the managed repo.
- `deploy`: deploys an existing managed app into the configured remote k3s app cluster over SSH.
- `inspect`: returns the app record plus recent build runs.
- `list`: lists the current user's managed apps.

## Required setup

- Postgres persistence must be enabled.
- Admin Settings must configure `integrations.gitea` with:
  - `baseURL`
  - `token`
  - `webhookSecret`
  - `org`
  - `registryHost`
- Admin Settings must configure `integrations.managedApps` with:
  - `appBaseDomain`
  - `namespacePrefix`
  - `platformNamespace`
- The KimiBuilt runtime must have SSH access to the configured remote k3s host.

## Notes

- Build runs are tracked authoritatively in Postgres.
- Cluster verification state is also recorded in the file-backed cluster registry so later turns can reuse rollout, ingress, TLS, and HTTPS context.
- The external Gitea workflow is expected to POST build events to `/api/integrations/gitea/build-events` with `X-KimiBuilt-Webhook-Secret`.
