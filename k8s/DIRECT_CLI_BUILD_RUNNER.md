# Direct CLI Build Runner

This path bypasses Gitea and ACT. KimiBuilt agents use `remote-command` to talk to a remote runner pod, the runner uses BuildKit to build and push images, then the runner uses in-cluster `kubectl` to deploy to k3s.

## Components

- `kimibuilt-direct-runner`: WebSocket runner that connects back to the KimiBuilt backend.
- `kimibuilt-buildkitd`: private in-cluster BuildKit daemon for container image builds.
- `kimibuilt-direct-runner-workspace`: persistent workspace for cloned/generated app code.
- `kimibuilt-direct-registry-auth`: Docker config used by `buildctl` when pushing images.
- `kimibuilt-direct-runner` service account/RBAC: can inspect the cluster and create/update/patch workloads, services, configmaps, jobs, and ingresses. It cannot create/update/delete Kubernetes Secrets.

## Backend Settings

On the KimiBuilt backend side, enable runner-first remote commands:

```bash
KIMIBUILT_REMOTE_RUNNER_ENABLED=true
KIMIBUILT_REMOTE_RUNNER_PREFERRED=true
KIMIBUILT_REMOTE_RUNNER_TOKEN=<same-token-used-by-runner>
MANAGED_APPS_DEPLOY_TARGET=runner
OPENCODE_ENABLED=false
```

## Install

Edit `k8s/direct-cli-build-runner.yaml`:

- Set `KIMIBUILT_BACKEND_URL` to the public URL of the KimiBuilt backend.
- Set `KIMIBUILT_REMOTE_RUNNER_TOKEN` to the backend runner token.
- Set `kimibuilt-direct-registry-auth` to a registry account that can push images.
- Set `DIRECT_CLI_IMAGE_PREFIX` to the image prefix agents should push to, for example `ghcr.io/philly1084`.

Apply it to the remote k3s cluster:

```bash
kubectl apply -f k8s/direct-cli-build-runner.yaml
kubectl get pods -n agent-platform -o wide
kubectl logs -n agent-platform deployment/kimibuilt-direct-runner --tail=100
kubectl logs -n agent-platform deployment/kimibuilt-buildkitd --tail=100
```

## Smoke Test

From KimiBuilt, use `/remote status`, then:

```bash
/remote run command -v buildctl && command -v kubectl && buildctl --addr "$BUILDKIT_HOST" debug workers
/remote run export KUBECONFIG=/etc/rancher/k3s/k3s.yaml; kubectl get nodes -o wide
```

## TLS

The runner connects outbound to `KIMIBUILT_BACKEND_URL` over WebSocket. If the backend ingress uses a self-signed certificate, the runner logs `WebSocket error: self-signed certificate` and will not register.

Preferred fix: issue a publicly trusted certificate for the backend host with cert-manager/Let's Encrypt, then keep `KIMIBUILT_RUNNER_TLS_INSECURE=false`.

Temporary workaround for a private/self-signed backend certificate:

```bash
kubectl -n agent-platform set env deployment/kimibuilt-direct-runner KIMIBUILT_RUNNER_TLS_INSECURE=true NODE_TLS_REJECT_UNAUTHORIZED=0
kubectl -n agent-platform rollout restart deployment/kimibuilt-direct-runner
```

For rebuilt runner images, `KIMIBUILT_RUNNER_TLS_INSECURE=true` is the scoped runner option. `NODE_TLS_REJECT_UNAUTHORIZED=0` is included for compatibility with already-deployed runner images that do not yet include the scoped option.

After a trusted backend certificate is installed:

```bash
kubectl -n agent-platform set env deployment/kimibuilt-direct-runner KIMIBUILT_RUNNER_TLS_INSECURE=false NODE_TLS_REJECT_UNAUTHORIZED-
kubectl -n agent-platform rollout restart deployment/kimibuilt-direct-runner
```

## Build and Deploy Flow

Agents should work in `/workspace`:

```bash
cd /workspace
git clone https://github.com/example/app.git app
cd app
npm install
npm test
npm run build
```

Build and push an image:

```bash
cd /workspace/app
image="${DIRECT_CLI_IMAGE_PREFIX}/app:$(date +%Y%m%d%H%M%S)"
buildctl --addr "$BUILDKIT_HOST" build \
  --frontend dockerfile.v0 \
  --local context=. \
  --local dockerfile=. \
  --output type=image,name="$image",push=true
```

Deploy or update the workload:

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
image="ghcr.io/philly1084/app:replace-with-built-tag"
kubectl create namespace app --dry-run=client -o yaml | kubectl apply -f -
kubectl create deployment app --image="$image" -n app --dry-run=client -o yaml | kubectl apply -f -
kubectl expose deployment app --name app --port 80 --target-port 3000 -n app --dry-run=client -o yaml | kubectl apply -f -
kubectl rollout status deployment/app -n app --timeout=180s
```

For a private registry, pre-create the pull secret in each application namespace. The runner policy intentionally does not grant Secret mutation.

## Policy

Routine planned actions can continue automatically: inspect, search, edit planned files, build, test, image build, deploy, rollout, and verify.

Stop for the user on privilege or strategy changes: package installs, `sudo`, Kubernetes Secret mutation, destructive deletes, force pushes, missing registry credentials, unknown hosts, or repeated unexplained failures.
