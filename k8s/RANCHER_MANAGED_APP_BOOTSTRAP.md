# Rancher Managed-App Bootstrap

This setup uses two separate clusters:

- External software-factory cluster: Gitea, registry, BuildKit, runner
- KimiBuilt app cluster: KimiBuilt itself plus managed-app deployment RBAC

## 1. External Gitea Cluster

In Rancher, open the external cluster and import:

- [rancher-agent-platform-test-env.yaml](/C:/Users/phill/KimiBuilt/k8s/rancher-agent-platform-test-env.yaml)

Or bootstrap it directly on the build host with:

```bash
./k8s/bootstrap-managed-app-platform.sh
```

This boots:

- `agent-platform` namespace
- Gitea
- BuildKit
- TLS ingress for `gitea.demoserver2.buzz`
- `act-runner`, initially scaled to `0` until the bootstrap helper generates a fresh runner token and scales it up

### After Gitea Is Up

1. Sign in to `https://gitea.demoserver2.buzz` with:
   - user: `admin`
   - password: `TestOnly-Gitea-Admin-2026!`
2. Create a personal access token for the Gitea user you want the runner to use for container registry pushes.
   - In a test environment, `admin` is fine.
   - Give it repo/org/packages access.
   - Use that same Gitea username plus PAT for container registry auth on the runner and in KimiBuilt.
3. Run the bootstrap helper so it generates a fresh runner registration token from the Gitea pod, stores it in `gitea-actions`, updates runtime secrets, and scales `act-runner` to `1`.

If you want a one-command update on the build cluster instead of clicking through Rancher, run:

```bash
export GITEA_REGISTRY_USERNAME=admin
export GITEA_REGISTRY_PASSWORD=<gitea-pat>
./k8s/bootstrap-managed-app-platform.sh
```

For a true clean rebuild, delete the old namespace and PVC-backed state first:

```bash
export FRESH_INSTALL=1
./k8s/bootstrap-managed-app-platform.sh
```

Optional:

```bash
export KIMIBUILT_BUILD_EVENTS_INSECURE=1
```

Use that only as a temporary workaround when the runner cannot validate the KimiBuilt TLS certificate.

### Verify

Check:

- `gitea` pod is `Running`
- `buildkitd` pod is `Running`
- `act-runner` pod is `Running`
- `https://gitea.demoserver2.buzz` loads

This fresh-install path is only truly fresh when `FRESH_INSTALL=1` is used. Re-applying the manifest without deleting the namespace leaves the `gitea-data` PVC and the existing Gitea database in place.

## 2. KimiBuilt App Cluster

In Rancher, open the KimiBuilt app cluster and import:

- [managed-app-rbac.yaml](/C:/Users/phill/KimiBuilt/k8s/managed-app-rbac.yaml)

Then edit the KimiBuilt workload in Rancher:

- Namespace: usually `kimibuilt`
- Workload/deployment: whatever runs the backend API

Set the service account name to:

- `kimibuilt-managed-apps`

Add these environment variables to the KimiBuilt backend workload:

```text
API_BASE_URL=https://kimibuilt.demoserver2.buzz
GITEA_BASE_URL=https://gitea.demoserver2.buzz
GITEA_TOKEN=<paste the PAT from Gitea>
GITEA_WEBHOOK_SECRET=TestOnly-Webhook-Secret-2026!
GITEA_ORG=agent-apps
GITEA_REGISTRY_HOST=gitea.demoserver2.buzz
GITEA_REGISTRY_USERNAME=admin
GITEA_REGISTRY_PASSWORD=<paste the same PAT or another PAT with package write access>
MANAGED_APPS_BASE_DOMAIN=demoserver2.buzz
MANAGED_APPS_NAMESPACE_PREFIX=app-
MANAGED_APPS_PLATFORM_NAMESPACE=agent-platform
MANAGED_APPS_DEFAULT_BRANCH=main
MANAGED_APPS_REGISTRY_PULL_SECRET=gitea-registry-credentials
MANAGED_APPS_BUILD_EVENTS_PATH=/api/integrations/gitea/build-events
KUBERNETES_IN_CLUSTER_ENABLED=true
```

If the runner log shows a webhook TLS error like `certificate verify failed`, either fix the certificate chain for `kimibuilt.demoserver2.buzz` or temporarily add this on the runner side:

```text
KIMIBUILT_BUILD_EVENTS_INSECURE=1
```

Then redeploy the KimiBuilt backend workload.

## 3. Catch The Remote Server Up

Your remote KimiBuilt server or cluster also needs the code changes that added:

- the `managed-app` tool
- the Gitea webhook route
- the managed app catalog
- the Kubernetes deployment lane

If your Rancher workload builds from an image:

1. Build and push the latest KimiBuilt image from this workspace.
2. Update the Rancher workload to that new image tag.
3. Redeploy the workload.

If your remote server uses a repo checkout:

1. Pull the latest repo changes onto the remote host.
2. Rebuild the KimiBuilt image or restart the backend process.
3. Confirm the workload is running the updated code.

## 4. First End-To-End Test

After both clusters are updated, use web chat with a request like:

```text
Create and deploy a managed app called hello-stack. Make it a simple one-page site that says the managed app pipeline is working.
```

Expected result:

1. KimiBuilt creates the repo in Gitea under `agent-apps/hello-stack`
2. Gitea Actions builds and pushes the image
3. Gitea posts the build event to KimiBuilt
4. KimiBuilt creates namespace `app-hello-stack`
5. KimiBuilt deploys the app and creates ingress

## 5. Useful Rancher Checks

External Gitea cluster:

```text
Workloads > agent-platform > gitea
Workloads > agent-platform > buildkitd
Workloads > agent-platform > act-runner
Service Discovery > Ingresses > agent-platform > gitea
Storage > PersistentVolumeClaims > agent-platform > gitea-data
```

KimiBuilt app cluster:

```text
Workloads > kimibuilt > backend
Service Accounts > kimibuilt > kimibuilt-managed-apps
RBAC > ClusterRoleBindings > kimibuilt-managed-apps
```
