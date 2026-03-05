# Deploying KimiBuilt via Rancher / k3s

The `k8s/` directory in this repository is fully compatible with Rancher and k3s out of the box. It uses standard Kubernetes resources, Persistent Volumes, and a Traefik Ingress configuration matching the k3s default.

## Prerequisites
1. A running k3s cluster managed via Rancher (or pure `kubectl`).
2. Your OpenAI API key from the `n8n-openai-cli-gateway`.
3. The multiarch Docker image should be fully built by GitHub Actions and available on `ghcr.io/philly1084/kimibuilt:latest` (Note: the GitHub Actions runs on pushes to `master`, you can check its progress in the Actions tab of your repo).

## 1. Authentication for GHCR (Optional if Repo is Public)
By default, the GitHub repository is public, meaning k3s can pull `ghcr.io/philly1084/kimibuilt:latest` anonymously. If you make it private later, you will need to add an `imagePullSecret`.

## 2. Deploy the Namespace and Configs
Run the following from a terminal connected to your cluster:

```bash
# Apply namespace, configmap, and ingress first
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/ingress.yaml
```

## 3. Configure the Secret
Before applying the Deployments, you **MUST** create the secret manually to prevent checking your API key into git.

```bash
kubectl create secret generic kimibuilt-secrets \
    --from-literal=OPENAI_API_KEY='YOUR_API_KEY_HERE' \
    -n kimibuilt
```

*(Alternatively, use the Rancher UI: Cluster -> Secrets -> Create -> Opaque. Name: `kimibuilt-secrets`, Namespace: `kimibuilt`, Key: `OPENAI_API_KEY`, Value: your key).*

## 4. Deploy the Services (backend, ollama, qdrant)
Now apply the rest of the manifests to start the backend, the vector database, and the embedding model:

```bash
kubectl apply -f k8s/qdrant-deployment.yaml
kubectl apply -f k8s/ollama-deployment.yaml
kubectl apply -f k8s/backend-deployment.yaml
```

*(Note: The `backend` pod waits for `ollama` and `qdrant` to be healthy, so it may take a minute or two to start fully).*

## 5. View in Rancher
Log into your Rancher UI.
- Select your Cluster.
- Filter by the `kimibuilt` namespace.
- You will see the Deployments spinning up in the **Workloads** section.
- Under **Service Discovery -> Ingress**, you should see `kimibuilt-ingress` routing traffic to `kimibuilt.local`.

To access the app locally, ensure `kimibuilt.local` is in your `hosts` file and mapped to your cluster IP.
