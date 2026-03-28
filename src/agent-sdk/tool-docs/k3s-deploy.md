# k3s-deploy

Purpose: run restricted k3s deployment actions over SSH against the configured server.

Allowed actions:
- `sync-repo`
- `apply-manifests`
- `set-image`
- `rollout-status`
- `sync-and-apply`

Notes:
- This tool uses the configured SSH target from Admin Settings or cluster secrets unless host overrides are provided.
- `sync-repo` only allows GitHub repository URLs.
- `sync-and-apply` is the main GitOps-style path: sync the repo on the server, apply manifests, then optionally check rollout status.
- Use `set-image` when GitHub Actions has already published a new image tag and you only need the cluster rollout step.
- For arbitrary remote software installation or debugging outside these actions, use `remote-command`.
