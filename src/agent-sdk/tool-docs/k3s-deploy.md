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
- `sync-repo` and `sync-and-apply` will use `GH_TOKEN` or `GITHUB_TOKEN` for HTTPS clone/fetch when the runtime provides one.
- `sync-and-apply` is the main GitOps-style path: sync the repo on the server, apply manifests, then optionally check rollout status.
- Use `set-image` when GitHub Actions has already published a new image tag and you only need the cluster rollout step.
- For arbitrary remote software installation or debugging outside these actions, use `remote-command`.
- The expected remote environment in this project is Ubuntu Linux on ARM64 with k3s.
- After a failed deploy, switch to `remote-command` for `kubectl describe`, `kubectl logs`, `systemctl status k3s`, or `journalctl -u k3s --no-pager -n 200`.
- If `kubectl` context looks wrong on the host, try `export KUBECONFIG=/etc/rancher/k3s/k3s.yaml` or `k3s kubectl`.
