# remote-command

Purpose: run non-interactive commands on the configured remote host over SSH.

Project assumptions:
- The common remote target for this repo is Ubuntu Linux on ARM64 (`aarch64`) running k3s.
- Prefer Bash/POSIX shell syntax.
- Prefer short, purposeful command batches over giant all-in-one scripts.
- Prefer verified command output over assumptions.

Use `remote-command` when:
- inspecting host or cluster state
- reading logs or events
- checking services, ingress, DNS, TLS, or networking
- installing packages or making one-off host fixes
- verifying a deployment after `k3s-deploy`

Use `k3s-deploy` instead when:
- syncing the GitHub repo on the server
- applying manifests from the repo
- setting a deployment image
- checking rollout status as part of a standard deploy flow

## Baseline

Start here when you need to reconnect or confirm what machine you are on:

```bash
hostname && whoami && uname -m && (test -f /etc/os-release && sed -n '1,6p' /etc/os-release || true) && uptime
```

For a quick host health read:

```bash
hostname && uptime && (df -h / || true) && (free -m || true)
```

## K3s and kubectl access

K3s ships an embedded `kubectl`. Official K3s docs note that `k3s kubectl` uses `/etc/rancher/k3s/k3s.yaml` by default, and the bundled `kubectl` is also configured for that kubeconfig on K3s hosts.

Use this when `kubectl` context is uncertain:

```bash
command -v kubectl || true
command -v k3s || true
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get nodes -o wide || k3s kubectl get nodes -o wide
```

## Command catalog

### 1. Cluster survey

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get ns
kubectl get nodes -o wide
kubectl get deploy,sts,ds -A
kubectl get pods -A -o wide
kubectl get svc,ingress -A -o wide
```

### 2. Workload drill-down

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl describe deployment/backend -n kimibuilt
kubectl describe pod/<pod-name> -n kimibuilt
kubectl get events -n kimibuilt --sort-by=.lastTimestamp | tail -n 50
```

### 3. Logs

Current container logs:

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl logs deployment/backend -n kimibuilt --all-containers=true --tail=200
```

Specific pod or container:

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl logs <pod-name> -n kimibuilt -c <container-name> --tail=200
```

Previous container logs after a crash or restart:

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl logs <pod-name> -n kimibuilt -c <container-name> --previous --tail=200
```

Rule of thumb:
- If `kubectl describe` or pod status shows `CrashLoopBackOff`, an init-container failure, or a non-zero exit code, follow with `kubectl logs` for the failing container or init container.

### 4. Rollout and restart

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl rollout status deployment/backend -n kimibuilt --timeout=180s
kubectl wait --for=condition=available deployment/backend -n kimibuilt --timeout=180s
kubectl rollout restart deployment/backend -n kimibuilt
```

### 5. Service and ingress checks

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get svc,ingress -A -o wide
kubectl describe service/backend -n kimibuilt
kubectl describe ingress/<ingress-name> -n kimibuilt
```

For bundled Traefik on k3s:

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get pods -n kube-system -l app.kubernetes.io/name=traefik -o wide
kubectl logs -n kube-system deployment/traefik --tail=200
```

### 6. k3s service health

Server nodes usually use `k3s`; agent-only nodes use `k3s-agent`.

```bash
sudo systemctl status k3s --no-pager
sudo journalctl -u k3s --no-pager -n 200
sudo systemctl status k3s-agent --no-pager
sudo journalctl -u k3s-agent --no-pager -n 200
```

### 7. k3s packaged manifests and add-ons

K3s automatically applies manifests from `/var/lib/rancher/k3s/server/manifests`.

```bash
ls -la /var/lib/rancher/k3s/server/manifests
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get addon -n kube-system
kubectl describe addon <addon-name> -n kube-system
```

### 8. Host files, repo, and search

Do not assume `rg` is installed on Ubuntu servers.

```bash
pwd && ls -la
find /path/to/check -maxdepth 2 -type f | sort | head -n 200
grep -R --line-number "needle" /path/to/check
```

### 9. Networking and ports

Prefer modern Ubuntu tooling.

```bash
ip addr
ip route
ss -tulpn
curl -I https://example.com
```

### 10. Package install on Ubuntu

Avoid interactive package prompts:

```bash
sudo DEBIAN_FRONTEND=noninteractive apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y jq curl ca-certificates
```

## Preferred structure for a remote-command call

When a task needs more than one command, prefer a compact script like:

```bash
set -e
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get pods -n kimibuilt -o wide
kubectl describe deployment/backend -n kimibuilt
kubectl logs deployment/backend -n kimibuilt --all-containers=true --tail=200
```

Good habits:
- One main goal per call: inspect, fix, or verify.
- Use explicit namespaces.
- Re-run a verification command only after a change or a new hypothesis.
- If you need root-only service inspection, use non-interactive sudo.

Avoid:
- interactive editors (`vim`, `nano`)
- watch-style loops (`watch`, endless `tail -f`) unless the user explicitly wants a live stream
- assuming a repo path or web root without checking with `pwd`, `ls`, or `find`
- assuming x86_64 binaries on this host
- assuming old net tools exist

## References

- K3s CLI Tools: [docs.k3s.io/cli](https://docs.k3s.io/cli)
- K3s Cluster Access: [docs.k3s.io/cluster-access](https://docs.k3s.io/cluster-access)
- K3s Advanced Options / service logs: [docs.k3s.io/advanced](https://docs.k3s.io/advanced)
- Kubernetes `kubectl get`: [kubernetes.io/docs/reference/kubectl/generated/kubectl_get/](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_get/)
- Kubernetes `kubectl logs`: [kubernetes.io/docs/reference/kubectl/generated/kubectl_logs/](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_logs/)
- Kubernetes `kubectl rollout status`: [kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_status/](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_status/)
