# managed-app

Creates, updates, and deploys agent-owned applications through the external Gitea control plane and the remote runner or SSH/k3s deployment lane.

Managed-app deployment should use the configured remote runner when it is online, with SSH retained as a break-glass fallback. It should deploy through the configured remote host and remote k3s cluster, not through the backend pod's local Kubernetes service account.

Use this tool as the single control-plane entry point when the remote Gitea instance, BuildKit runner, and deploy cluster all live on the same remote server or k3s environment.

## Actions

- `create`: registers or provisions a managed app, creates the external Gitea repository when configured, generates the initial app source, seeds the repo, and records a build run when a commit is created.
- `update`: updates an existing managed app by slug or id, applies software changes into the managed repo, and can queue a new remote build/deploy cycle.
- `deploy`: deploys an existing managed app into the configured remote k3s app cluster over SSH.
- `inspect`: returns the app record plus recent build runs.
- `doctor`: SSHes to the remote deploy host and inspects the managed-app platform namespace so the agent can check Gitea, BuildKit, `act-runner`, runner labels, and runner token state in one call. `diagnose`, `diagnostic`, and `diagnostics` are accepted as aliases.
- `reconcile`: uses the configured Gitea API plus remote SSH/k3s access to fetch or rotate the runner registration token, update the `gitea-actions` secret on the remote cluster, and restart or scale `act-runner`. `repair` and `repair-runner` are accepted as aliases.
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
- The KimiBuilt runtime must have either a connected remote runner or SSH access to the configured remote k3s host.

## Notes

- Build runs are tracked authoritatively in Postgres.
- Cluster verification state and remote server baseline context are also recorded in the file-backed cluster registry so later turns can reuse rollout, ingress, TLS, HTTPS, host, k3s, and ingress-controller context.
- The external Gitea workflow is expected to POST build events to `/api/integrations/gitea/build-events` with `X-KimiBuilt-Webhook-Secret`.
- `deploy` now refuses to continue when the latest build is still queued/running or failed, unless an explicit image tag is provided. It should deploy a known-good image, not guess.
- `deploy` refreshes remote k3s platform context before manifest apply so later agents inherit a simple baseline for the deploy host and cluster.
- `deploy` creates the app namespace image pull secret from the remote `agent-platform-runtime` Secret when Gitea and k3s live on the same remote platform. Admin Settings registry credentials are only a fallback, which avoids stale local passwords causing image-pull `401 Unauthorized` errors.
- The `doctor` action is the preferred first check when Gitea Actions are queued or waiting. It inspects the same remote cluster the managed-app deploy lane uses.
- The `reconcile` action is the preferred repair path when the platform exists but Gitea runners are missing, tokened incorrectly, or stuck waiting. It is designed for the case where the Gitea instance and deploy cluster live on the same remote server or k3s environment.
- For remote app authoring requests, prefer `managed-app create` or `managed-app update` over ad hoc repo-runner tools. This control plane is the intended path for code changes, Gitea builds, and remote k3s deployment on the same server.
