# K3s Rancher Playbook

This playbook is the repo-local reference for remote build, kubectl, ingress, TLS, DNS, and Rancher-supported deployment work.

## Default assumptions

Unless Admin Settings override them, the backend assumes:
- public domain: `demoserver2.buzz`
- ingress class: `traefik`
- TLS `ClusterIssuer`: `letsencrypt-prod`
- namespace: `kimibuilt`
- deployment: `backend`
- container: `backend`

Treat these as fallbacks, not proof that the live cluster already matches them.

## Official document locations

Use these as the primary source list when the agent needs current guidance:

| Topic | URL | Why it matters |
|---|---|---|
| K3s cluster access | https://docs.k3s.io/cluster-access | Canonical `KUBECONFIG` and embedded `kubectl` behavior |
| K3s packaged components | https://docs.k3s.io/installation/packaged-components | AddOn manifests, `/var/lib/rancher/k3s/server/manifests`, Traefik packaging |
| K3s networking services | https://docs.k3s.io/networking/networking-services | Built-in Traefik and ServiceLB behavior |
| Rancher ingresses | https://ranchermanager.docs.rancher.com/how-to-guides/new-user-guides/kubernetes-resources-setup/load-balancer-and-ingress-controller/add-ingresses | Rancher UI mapping for ingress and host routing |
| cert-manager ingress | https://cert-manager.io/docs/usage/ingress/ | `cert-manager.io/cluster-issuer` and `tls.secretName` behavior |
| kubectl create deployment | https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/kubectl_create_deployment/ | Fast deployment bootstrap commands |
| kubectl expose | https://kubernetes.io/docs/reference/kubectl/generated/kubectl_expose/ | Service creation from deployments |
| kubectl create ingress | https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/kubectl_create_ingress/ | CLI ingress creation patterns |
| kubectl create secret tls | https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/kubectl_create_secret_tls/ | Manual TLS secret creation |

## Baseline remote commands

Confirm the server and cluster context:

```bash
hostname && whoami && uname -m && (test -f /etc/os-release && sed -n '1,6p' /etc/os-release || true) && uptime
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get nodes -o wide
kubectl get pods -A -o wide
kubectl get svc,ingress -A -o wide
```

## Standard deployment lanes

### Lane 1: repo-managed manifests with k3s-deploy

Best when the repo already has Docker and Kubernetes assets.

1. Update the app and manifests.
2. Push code or image changes.
3. Run `k3s-deploy sync-and-apply`.
4. Verify with `remote-command`.

### Lane 2: direct kubectl bootstrap for a simple web workload

Best for smoke tests or fast proof-of-concept deployments.

```bash
set -e
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
ns=web
app=hello-web
host=hello.demoserver2.buzz
class=traefik
issuer=letsencrypt-prod

kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f -
kubectl create deployment "$app" --image=nginx:1.27 --replicas=2 -n "$ns" --dry-run=client -o yaml | kubectl apply -f -
kubectl expose deployment "$app" --name "$app" --port=80 --target-port=80 -n "$ns" --dry-run=client -o yaml | kubectl apply -f -
kubectl create ingress "$app" --class="$class" --rule="$host/*=$app:80,tls=$app-tls" --annotation=cert-manager.io/cluster-issuer="$issuer" -n "$ns" --dry-run=client -o yaml | kubectl apply -f -
kubectl rollout status deployment/"$app" -n "$ns" --timeout=180s
kubectl get svc,ingress -n "$ns"
```

### Lane 3: remote workspace build on the same server

Best when the canonical code path lives on the remote host and the user explicitly wants server-local authoring.

1. Update the remote workspace.
2. Build the app in place.
3. Apply manifests from the workspace.
4. Verify rollout, ingress, TLS, and HTTPS.

Use this sparingly. Prefer immutable repo and image delivery when possible.

## Common kubectl checks

### Rollout

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl rollout status deployment/backend -n kimibuilt --timeout=180s
kubectl get deployment/backend -n kimibuilt -o wide
kubectl get pods -n kimibuilt -o wide
```

### Pod triage

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl describe pod/<pod-name> -n <namespace>
kubectl logs <pod-name> -n <namespace> -c <container-name> --tail=200
kubectl logs <pod-name> -n <namespace> -c <container-name> --previous --tail=200
kubectl get events -n <namespace> --sort-by=.lastTimestamp | tail -n 50
```

### Service and ingress

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get svc,ingress -n <namespace> -o wide
kubectl describe service/<service-name> -n <namespace>
kubectl describe ingress/<ingress-name> -n <namespace>
```

### cert-manager

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get certificate -A || true
kubectl get challenge -A || true
kubectl describe certificate/<certificate-name> -n <namespace> || true
kubectl describe challenge/<challenge-name> -n <namespace> || true
```

### Traefik

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get pods -n kube-system -l app.kubernetes.io/name=traefik -o wide
kubectl logs -n kube-system deployment/traefik --tail=200
```

## DNS and HTTPS verification

Use public verification before claiming the site is live:

```bash
host=hello.demoserver2.buzz
getent ahosts "$host" || true
curl -fsSIL --max-time 20 "https://$host"
curl -fsS --max-time 20 "https://$host" | sed -n '1,20p'
```

If DNS is missing or stale, stop short of claiming completion.

## Rancher UI map

Use the Rancher UI as an explorer, but keep `kubectl` as the source of truth:
- Cluster Management -> Explore -> Workloads
- Cluster Management -> Explore -> Service Discovery -> Services
- Cluster Management -> Explore -> Service Discovery -> Ingresses
- Cluster Management -> Explore -> Storage -> Secrets

## Containerization rule

If an app is not already deployable:
1. create or repair the Dockerfile
2. create the Deployment, Service, and Ingress manifests
3. make the image path and service port explicit
4. only then push and deploy

Do not hand-wave "containering" as done if the repo still lacks a Dockerfile, image reference, or Kubernetes manifests.
