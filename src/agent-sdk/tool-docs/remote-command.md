# remote-command

Purpose: run non-interactive commands on the configured remote host through the KimiBuilt remote runner when available, falling back to SSH.

Aliases: `remote CLI`, `direct CLI`, `remote command`, and `remote runner` all refer to this `remote-command` tool. These phrases should not be routed to the local execution sandbox.

Remote CLI agent pipeline:
- Treat this tool as the default programming lane for remote inspect, edit, build, test, deploy verification, and cluster troubleshooting.
- Route remote server, SSH, host, k3s, Kubernetes, and kubectl work through this `remote-command` remote CLI lane when it is available. Legacy raw SSH tools should be a compatibility fallback, not the planner's first choice.
- Prefer the remote runner whenever a healthy runner exists. Use SSH only when no healthy runner exists or an explicit host override is required.
- When the runner reports a default workspace, treat that path as the remote desktop/workbench. The direct CLI runner defaults to `/workspace`.
- Build and creation work should happen inside the persistent workspace unless the user names another target.
- When web-chat, WebSocket, Canvas, Notation, or the CLI selected session artifacts, pass their IDs through `artifactIds` on `remote-command`. The runner stages them as files before the command starts and exposes `KIMIBUILT_CONTEXT_DIR` plus `KIMIBUILT_CONTEXT_MANIFEST`.
- When reusable source material was saved in the shared research bucket, pass selected files through `researchBucketPaths` or safe globs through `researchBucketGlobs`. The backend stages matching bucket files into the same remote context directory and preserves file extensions for images, audio, video, code, docs, and data.
- For search/fetch results that are not persisted artifacts, pass compact inline files through `contextFiles` such as `research.json`, `source.html`, or `image-references.json`. Keep large binaries as artifacts instead of inline strings.
- Continue automatically while the action remains on the approved plan: inspect, search, edit planned files, build, test, deploy, rollout, and verify.
- Stop and report when the work falls off plan: repeated failures, missing credentials, sudo/package install, Kubernetes Secret mutation, destructive delete, force push, unknown host, or recovery that needs a new strategy.
- Keep batches small and purposeful: baseline -> inspect -> fix -> verify.

Project defaults:
- The common remote target is Ubuntu Linux on ARM64 (`aarch64`) running k3s.
- Prefer Bash or POSIX shell syntax.
- Prefer short inspect -> fix -> verify command batches over giant scripts.
- Prefer verified command output over assumptions.
- The saved deploy defaults may provide a public domain, namespace, deployment name, ingress class, and TLS `ClusterIssuer`.
- If no public domain is configured in Admin Settings, the backend falls back to `demoserver2.buzz`.
- Project playbook: `k8s/K3S_RANCHER_PLAYBOOK.md`

Use `remote-command` when:
- inspecting host or cluster state
- inspecting or editing a remote repo workspace
- running remote build and test commands
- reading logs or events
- checking services, ingress, DNS, TLS, or networking
- installing packages or making one-off host fixes
- verifying a deployment after `k3s-deploy`
- deploying directly from a remote workspace on the same host

Use `k3s-deploy` instead when:
- syncing the GitHub repo on the server
- applying manifests from the repo
- setting a deployment image
- checking rollout status as part of a standard deploy flow

## Baseline

Reconnect or confirm the target host:

```bash
hostname && whoami && uname -m && (test -f /etc/os-release && sed -n '1,6p' /etc/os-release || true) && uptime
```

Quick host health:

```bash
hostname && uptime && (df -h / || true) && (free -m || true)
```

## K3s and kubectl access

K3s ships an embedded `kubectl`. If upstream `kubectl` context is uncertain, prefer:

```bash
command -v kubectl || true
command -v k3s || true
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get nodes -o wide || k3s kubectl get nodes -o wide
```

## Command catalog

These catalog entries are exposed through `/api/tools/available` so agents can select known-good remote CLI work patterns instead of inventing shell flows.

| ID | Profile | Purpose |
|----|---------|---------|
| `baseline` | `inspect` | Confirm host identity, user, CPU architecture, OS, and uptime. |
| `repo-inspect` | `inspect` | Inspect current workspace, nearby files, package scripts, and git status. |
| `file-search` | `inspect` | Search remote files using `find` and `grep -R`; do not assume `rg` exists. |
| `build` | `build` | Run the project build command discovered from the repo. |
| `test` | `build` | Run the focused or project test command discovered from the repo. |
| `docker-buildkit` | `inspect` | Check Docker/BuildKit availability and builder state. |
| `direct-image-build` | `build` | Build and push an image from the remote workspace through the direct BuildKit runner. |
| `kubectl-inspect` | `inspect` | Inspect k3s nodes, workloads, services, ingress, and pods. |
| `logs` | `inspect` | Read Kubernetes logs and recent events for the target workload. |
| `rollout` | `deploy` | Check rollout and available conditions for a deployment. |
| `https-verify` | `inspect` | Verify DNS and public HTTPS for the deployed domain. |

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

Current logs:

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl logs deployment/backend -n kimibuilt --all-containers=true --tail=200
```

Specific pod or container:

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl logs <pod-name> -n kimibuilt -c <container-name> --tail=200
```

Previous logs after a crash or restart:

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl logs <pod-name> -n kimibuilt -c <container-name> --previous --tail=200
```

Rule of thumb:
- If `kubectl describe` shows `CrashLoopBackOff`, an init-container failure, or a non-zero exit code, follow with `kubectl logs` for the failing container or init container.

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

### 6. Deploy a simple web workload with kubectl

Use this only for ad hoc or diagnostic deployments. For repo-managed manifests, prefer `k3s-deploy`.

Prefer generators for ad hoc resources instead of hand-authoring large YAML heredocs in a remote shell. If you do write a manifest file, validate it with `kubectl apply --dry-run=server -f <file>` or `kubectl apply --dry-run=client -f <file>` before live `kubectl apply`. A `strict decoding error: unknown field` or `error converting YAML to JSON` means the manifest shape or indentation is wrong; switch to a validated manifest or generator pipeline instead of retrying similar YAML.

```bash
set -e
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
ns=web
app=hello-web
host=hello.demoserver2.buzz
issuer=letsencrypt-prod
class=traefik

kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f -
kubectl create deployment "$app" --image=nginx:1.27 --replicas=2 -n "$ns" --dry-run=client -o yaml | kubectl apply -f -
kubectl expose deployment "$app" --name "$app" --port=80 --target-port=80 -n "$ns" --dry-run=client -o yaml | kubectl apply -f -
kubectl create ingress "$app" --class="$class" --rule="$host/*=$app:80,tls=$app-tls" --annotation=cert-manager.io/cluster-issuer="$issuer" -n "$ns" --dry-run=client -o yaml | kubectl apply -f -
kubectl rollout status deployment/"$app" -n "$ns" --timeout=180s
kubectl get svc,ingress -n "$ns"
```

For static HTML served from nginx, create the ConfigMap from a real file and mount it with `kubectl patch` or the full `kubectl set volume --add` subcommand. Do not use `kubectl set --add`; that flag only belongs to subcommands such as `kubectl set volume`.

### 7. Direct CLI image build with BuildKit

This is the preferred path when Gitea/ACT is not part of the build lane. The remote runner executes the commands in `/workspace`, talks to the private BuildKit service through `BUILDKIT_HOST`, pushes with the mounted Docker config, then deploys with in-cluster `kubectl`.

Check the runner has the required tools:

```bash
command -v buildctl
command -v kubectl
test -n "$BUILDKIT_HOST" && buildctl --addr "$BUILDKIT_HOST" debug workers
```

Build and push from a repo workspace:

```bash
set -e
cd /workspace/app
image="${DIRECT_CLI_IMAGE_PREFIX:-ghcr.io/philly1084}/app:$(date +%Y%m%d%H%M%S)"
buildctl --addr "$BUILDKIT_HOST" build \
  --frontend dockerfile.v0 \
  --local context=. \
  --local dockerfile=. \
  --output type=image,name="$image",push=true
printf 'IMAGE=%s\n' "$image"
```

Deploy the pushed image:

```bash
set -e
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
ns=app
app=app
image="ghcr.io/philly1084/app:replace-with-built-tag"
kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f -
kubectl create deployment "$app" --image="$image" -n "$ns" --dry-run=client -o yaml | kubectl apply -f -
kubectl set image deployment/"$app" "$app=$image" -n "$ns"
kubectl rollout status deployment/"$app" -n "$ns" --timeout=180s
```

Notes:
- Do not mutate Kubernetes Secrets from the runner. Ask the user to create registry pull secrets or app secrets explicitly when needed.
- Keep image names explicit in the final verification output so the next agent can continue from the last verified state.

### 8. TLS, cert-manager, and DNS checks

Ingress and TLS objects:

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get ingress -A
kubectl get certificate -A || true
kubectl get challenge -A || true
kubectl describe ingress/<ingress-name> -n <namespace>
kubectl describe certificate/<certificate-name> -n <namespace> || true
```

Public DNS and HTTPS:

```bash
host=hello.demoserver2.buzz
getent ahosts "$host" || true
curl -fsSIL --max-time 20 "https://$host"
curl -fsS --max-time 20 "https://$host" | sed -n '1,20p'
```

### 9. k3s service health

Server nodes usually use `k3s`; agent-only nodes use `k3s-agent`.

```bash
sudo systemctl status k3s --no-pager
sudo journalctl -u k3s --no-pager -n 200
sudo systemctl status k3s-agent --no-pager
sudo journalctl -u k3s-agent --no-pager -n 200
```

### 10. Packaged manifests and add-ons

K3s automatically applies manifests from `/var/lib/rancher/k3s/server/manifests`.

```bash
ls -la /var/lib/rancher/k3s/server/manifests
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get addon -n kube-system
kubectl describe addon <addon-name> -n kube-system
```

### 11. Host files, repo, and search

Do not assume `rg` is installed on Ubuntu servers.

```bash
pwd && ls -la
find /path/to/check -maxdepth 2 -type f | sort | head -n 200
grep -R --line-number "needle" /path/to/check
```

### 12. Networking and ports

Prefer modern Ubuntu tooling.

```bash
ip addr
ip route
ss -tulpn
curl -I https://example.com
```

### 13. Package install on Ubuntu

Avoid interactive prompts:

```bash
sudo DEBIAN_FRONTEND=noninteractive apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y jq curl ca-certificates dnsutils
```

## Rancher mapping

Useful Rancher UI locations:
- Cluster Management -> Explore -> Workloads
- Cluster Management -> Explore -> Service Discovery -> Services
- Cluster Management -> Explore -> Service Discovery -> Ingresses
- Cluster Management -> Explore -> Storage -> Secrets

Rancher is a control plane and UI, not a different Kubernetes API. The same `kubectl` commands remain the source of truth for troubleshooting and automation.

## Preferred structure for a remote-command call

One goal per call: inspect, fix, or verify.

Transport preference:
- Prefer the remote runner when it is online and the command does not specify an explicit SSH host.
- Use SSH as the fallback or when an explicit host/username override is provided.

```bash
set -e
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get pods -n kimibuilt -o wide
kubectl describe deployment/backend -n kimibuilt
kubectl logs deployment/backend -n kimibuilt --all-containers=true --tail=200
```

For build tasks that depend on generated images, uploaded files, scraped pages, or selected research, use staged context files:

```json
{
  "command": "set -e\nls -la \"$KIMIBUILT_CONTEXT_DIR\"\ncat \"$KIMIBUILT_CONTEXT_MANIFEST\"\n# use staged images/research while building",
  "workingDirectory": "/workspace/app",
  "artifactIds": ["selected-artifact-id"],
  "researchBucketPaths": ["images/hero.png", "audio/intro.wav", "videos/demo.mp4"],
  "researchBucketGlobs": ["docs/**/*.md"],
  "contextFiles": [
    {
      "filename": "research.json",
      "mimeType": "application/json",
      "content": "{\"source\":\"web-fetch\",\"notes\":\"verified data for the build\"}"
    }
  ]
}
```

Good habits:
- Use explicit namespaces.
- Re-run a verification command only after a change or a new hypothesis.
- If you need root-only service inspection, use non-interactive sudo.
- If the user wants a new app live on a domain, verify deployment, service, ingress, TLS secret, and public HTTPS before claiming success.

Avoid:
- interactive editors (`vim`, `nano`)
- watch-style loops (`watch`, endless `tail -f`) unless the user explicitly wants a live stream
- assuming a repo path or web root without checking with `pwd`, `ls`, or `find`
- assuming x86_64 binaries on this host
- assuming old net tools exist

## Official document locations

- K3s cluster access: https://docs.k3s.io/cluster-access
- K3s packaged components: https://docs.k3s.io/installation/packaged-components
- K3s networking services: https://docs.k3s.io/networking/networking-services
- Rancher ingresses: https://ranchermanager.docs.rancher.com/how-to-guides/new-user-guides/kubernetes-resources-setup/load-balancer-and-ingress-controller/add-ingresses
- cert-manager ingress TLS: https://cert-manager.io/docs/usage/ingress/
- kubectl create deployment: https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/kubectl_create_deployment/
- kubectl expose: https://kubernetes.io/docs/reference/kubectl/generated/kubectl_expose/
- kubectl create ingress: https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/kubectl_create_ingress/
- kubectl create secret tls: https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/kubectl_create_secret_tls/
