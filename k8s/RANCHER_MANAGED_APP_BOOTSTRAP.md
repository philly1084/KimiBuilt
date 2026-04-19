# Rancher Managed-App Bootstrap

This setup uses two separate clusters:

- External software-factory cluster: Gitea, registry, BuildKit, runner
- KimiBuilt app cluster: KimiBuilt itself plus managed-app deployment RBAC

## 1. External Gitea Cluster

In Rancher, open the external cluster and import:

- [rancher-agent-platform-test-env.yaml](/C:/Users/phill/KimiBuilt/k8s/rancher-agent-platform-test-env.yaml)

This boots:

- `agent-platform` namespace
- Gitea
- BuildKit
- TLS ingress for `gitea.demoserver2.buzz`
- `act_runner` scaled to `0` until you have a real registration token

### After Gitea Is Up

1. Sign in to `https://gitea.demoserver2.buzz` with:
   - user: `admin`
   - password: `TestOnly-Gitea-Admin-2026!`
2. Create a personal access token for the test admin user.
   - In a test environment, give it broad repo/org/packages access.
3. Generate a real runner registration token in Gitea.
   - Use an instance-level or organization-level runner token.
4. In Rancher, edit secret `gitea-actions` in namespace `agent-platform`.
   - Replace `runner-registration-token` with the real token.
5. In Rancher, scale deployment `act-runner` from `0` to `1`.

### Verify

Check:

- `gitea` pod is `Running`
- `buildkitd` pod is `Running`
- `act-runner` pod is `Running` after the token update
- `https://gitea.demoserver2.buzz` loads

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
GITEA_REGISTRY_USERNAME=test-builder
GITEA_REGISTRY_PASSWORD=TestOnly-Registry-Password-2026!
MANAGED_APPS_BASE_DOMAIN=demoserver2.buzz
MANAGED_APPS_NAMESPACE_PREFIX=app-
MANAGED_APPS_PLATFORM_NAMESPACE=agent-platform
MANAGED_APPS_DEFAULT_BRANCH=main
MANAGED_APPS_REGISTRY_PULL_SECRET=gitea-registry-credentials
MANAGED_APPS_BUILD_EVENTS_PATH=/api/integrations/gitea/build-events
KUBERNETES_IN_CLUSTER_ENABLED=true
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
