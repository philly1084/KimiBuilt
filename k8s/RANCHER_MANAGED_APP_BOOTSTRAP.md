# Managed App GitLab Bootstrap

KimiBuilt now expects the managed-app control plane to be GitLab based:

- GitLab CE for repositories, CI, and the container registry
- GitLab Runner for CI job execution
- BuildKit for image builds
- Traefik/cert-manager ingress for `gitlab.demoserver2.buzz` and `registry.gitlab.demoserver2.buzz`

## 1. Bootstrap The Platform

Generate the required Kubernetes secrets first. This keeps new installs from
copying placeholder passwords into Rancher or YAML:

```bash
./k8s/ensure-generated-secrets.sh
```

To print decoded values after they are stored in Kubernetes:

```bash
SHOW_SECRET_VALUES=1 ./k8s/ensure-generated-secrets.sh
```

To rotate generated values:

```bash
ROTATE_SECRETS=1 SHOW_SECRET_VALUES=1 ./k8s/ensure-generated-secrets.sh
```

Then bootstrap the platform resources:

```bash
./k8s/bootstrap-managed-app-platform.sh
```

For a fresh install:

```bash
export FRESH_INSTALL=1
./k8s/bootstrap-managed-app-platform.sh
```

For production defaults:

```bash
export PLATFORM_PROFILE=prod
./k8s/bootstrap-managed-app-platform.sh
```

The bootstrap creates `agent-platform`, GitLab PVCs, the GitLab deployment,
BuildKit, the GitLab runner deployment, and runtime secrets. The runner stays
scaled to `0` until a real GitLab runner authentication token is supplied.

## 2. Configure GitLab

After GitLab is ready, browse to:

```text
https://gitlab.demoserver2.buzz
```

The root password is stored in:

```bash
kubectl get secret gitlab-root -n agent-platform -o jsonpath='{.data.password}' | base64 -d
```

Create:

- a group named `agent-apps`
- a PAT/service account/group deploy token for `GITLAB_TOKEN`
- registry credentials with read/write access
- a runner authentication token for the instance or `agent-apps` group

Then enable the runner:

```bash
export GITLAB_REGISTRY_USERNAME=<gitlab-registry-user>
export GITLAB_REGISTRY_PASSWORD=<gitlab-registry-token>
export GITLAB_RUNNER_TOKEN=<glrt-token>
./k8s/update-managed-app-runner.sh
```

## 3. Backend Environment

Set these in the backend environment or admin settings:

```bash
GITLAB_ENABLED=true
GITLAB_BASE_URL=https://gitlab.demoserver2.buzz
GITLAB_TOKEN=<gitlab-api-token>
GITLAB_WEBHOOK_SECRET=<shared-build-events-secret>
GITLAB_GROUP=agent-apps
GITLAB_REGISTRY_HOST=registry.gitlab.demoserver2.buzz
GITLAB_REGISTRY_USERNAME=<gitlab-registry-user>
GITLAB_REGISTRY_PASSWORD=<gitlab-registry-token>
GITLAB_RUNNER_TOKEN=<glrt-token>

MANAGED_APPS_REGISTRY_PULL_SECRET=gitlab-registry-credentials
MANAGED_APPS_BUILD_EVENTS_PATH=/api/integrations/gitlab/build-events
```

`/api/integrations/gitea/build-events` remains as a legacy alias, but new
scaffolds and runtime settings use `/api/integrations/gitlab/build-events`.

## 4. Verify

```bash
kubectl get pods -n agent-platform
kubectl rollout status deployment/gitlab -n agent-platform --timeout=900s
kubectl rollout status deployment/buildkitd -n agent-platform --timeout=300s
kubectl rollout status deployment/gitlab-runner -n agent-platform --timeout=180s
```

Expected:

- `gitlab` pod is ready
- `buildkitd` pod is ready
- `gitlab-runner` pod is ready after `GITLAB_RUNNER_TOKEN` is supplied
- `https://gitlab.demoserver2.buzz` loads
- `https://registry.gitlab.demoserver2.buzz/v2/` responds with registry auth

## Rancher Locations

```text
Workloads > agent-platform > gitlab
Workloads > agent-platform > buildkitd
Workloads > agent-platform > gitlab-runner
Service Discovery > Ingresses > agent-platform > gitlab
Service Discovery > Ingresses > agent-platform > gitlab-registry
Storage > PersistentVolumeClaims > agent-platform > gitlab-data
```
