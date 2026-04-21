#!/usr/bin/env bash
set -euo pipefail

PLATFORM_NAMESPACE="${PLATFORM_NAMESPACE:-agent-platform}"
RUNTIME_SECRET_NAME="${RUNTIME_SECRET_NAME:-agent-platform-runtime}"
RUNNER_SECRET_NAME="${RUNNER_SECRET_NAME:-gitea-actions}"
RUNNER_DEPLOYMENT_NAME="${RUNNER_DEPLOYMENT_NAME:-act-runner}"
DEFAULT_REGISTRY_HOST="${DEFAULT_REGISTRY_HOST:-gitea.demoserver2.buzz}"
DEFAULT_BUILDKIT_HOST="${DEFAULT_BUILDKIT_HOST:-tcp://buildkitd.agent-platform.svc.cluster.local:1234}"
DEFAULT_BUILD_EVENTS_INSECURE="${DEFAULT_BUILD_EVENTS_INSECURE:-0}"
DEFAULT_RUNNER_REPLICAS="${DEFAULT_RUNNER_REPLICAS:-1}"
DEFAULT_GITEA_ORG="${DEFAULT_GITEA_ORG:-agent-apps}"
DEFAULT_GITEA_RUNNER_SCOPE="${DEFAULT_GITEA_RUNNER_SCOPE:-org}"

usage() {
  cat <<'EOF'
Update the managed-app runner secrets on the build cluster without rebuilding KimiBuilt.

Required environment variables:
  GITEA_REGISTRY_USERNAME   Real Gitea username that can push packages
  GITEA_REGISTRY_PASSWORD   PAT or password for that user

Optional environment variables:
  GITEA_REGISTRY_HOST            Default: gitea.demoserver2.buzz
  GITEA_ORG                      Default: agent-apps
  GITEA_RUNNER_SCOPE             Default: org
  KIMIBUILT_BUILD_EVENTS_URL     Existing secret value is reused when unset
  KIMIBUILT_BUILD_EVENTS_SECRET  Existing secret value is reused when unset
  KIMIBUILT_BUILD_EVENTS_INSECURE
                                 Default: existing secret value or 0
  BUILDKIT_HOST                  Default: existing secret value or buildkit service
  RUNNER_REGISTRATION_TOKEN      Optional legacy override for gitea-actions
  RUNNER_REPLICAS                Default: current replicas or 1
  PLATFORM_NAMESPACE             Default: agent-platform
  RUNTIME_SECRET_NAME            Default: agent-platform-runtime
  RUNNER_SECRET_NAME             Default: gitea-actions
  RUNNER_DEPLOYMENT_NAME         Default: act-runner

Examples:
  export GITEA_REGISTRY_USERNAME=admin
  export GITEA_REGISTRY_PASSWORD=<gitea-pat>
  ./k8s/update-managed-app-runner.sh

  export KIMIBUILT_BUILD_EVENTS_INSECURE=1
  ./k8s/update-managed-app-runner.sh
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

kubectl_cmd() {
  if command -v kubectl >/dev/null 2>&1; then
    kubectl "$@"
    return
  fi
  if command -v k3s >/dev/null 2>&1; then
    k3s kubectl "$@"
    return
  fi
  echo "kubectl or k3s is required" >&2
  exit 1
}

decode_or_empty() {
  local value="$1"
  if [[ -z "$value" ]]; then
    printf ''
    return
  fi
  printf '%s' "$value" | base64 -d 2>/dev/null || printf ''
}

secret_value() {
  local secret_name="$1"
  local key="$2"
  local raw=""
  raw="$(kubectl_cmd get secret "$secret_name" -n "$PLATFORM_NAMESPACE" -o "jsonpath={.data.${key}}" 2>/dev/null || true)"
  decode_or_empty "$raw"
}

deployment_replicas() {
  kubectl_cmd get deployment "$RUNNER_DEPLOYMENT_NAME" -n "$PLATFORM_NAMESPACE" -o 'jsonpath={.spec.replicas}' 2>/dev/null || true
}

require_value() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "Missing required value: $name" >&2
    exit 1
  fi
}

registry_host="${GITEA_REGISTRY_HOST:-$(secret_value "$RUNTIME_SECRET_NAME" gitea-registry-host)}"
gitea_org="${GITEA_ORG:-$(secret_value "$RUNTIME_SECRET_NAME" gitea-org)}"
gitea_runner_scope="${GITEA_RUNNER_SCOPE:-$(secret_value "$RUNTIME_SECRET_NAME" gitea-runner-scope)}"
registry_username="${GITEA_REGISTRY_USERNAME:-$(secret_value "$RUNTIME_SECRET_NAME" gitea-registry-username)}"
registry_password="${GITEA_REGISTRY_PASSWORD:-$(secret_value "$RUNTIME_SECRET_NAME" gitea-registry-password)}"
build_events_url="${KIMIBUILT_BUILD_EVENTS_URL:-$(secret_value "$RUNTIME_SECRET_NAME" kimibuilt-build-events-url)}"
build_events_secret="${KIMIBUILT_BUILD_EVENTS_SECRET:-$(secret_value "$RUNTIME_SECRET_NAME" kimibuilt-build-events-secret)}"
build_events_insecure="${KIMIBUILT_BUILD_EVENTS_INSECURE:-$(secret_value "$RUNTIME_SECRET_NAME" kimibuilt-build-events-insecure)}"
buildkit_host="${BUILDKIT_HOST:-$(secret_value "$RUNTIME_SECRET_NAME" buildkit-host)}"

registry_host="${registry_host:-$DEFAULT_REGISTRY_HOST}"
gitea_org="${gitea_org:-$DEFAULT_GITEA_ORG}"
gitea_runner_scope="${gitea_runner_scope:-$DEFAULT_GITEA_RUNNER_SCOPE}"
build_events_insecure="${build_events_insecure:-$DEFAULT_BUILD_EVENTS_INSECURE}"
buildkit_host="${buildkit_host:-$DEFAULT_BUILDKIT_HOST}"

runner_shared_secret="$(secret_value "$RUNNER_SECRET_NAME" shared-secret)"
runner_registration_token="${RUNNER_REGISTRATION_TOKEN:-$(secret_value "$RUNNER_SECRET_NAME" runner-registration-token)}"
current_replicas="$(deployment_replicas)"
runner_replicas="${RUNNER_REPLICAS:-${current_replicas:-$DEFAULT_RUNNER_REPLICAS}}"

require_value "GITEA_REGISTRY_USERNAME" "$registry_username"
require_value "GITEA_REGISTRY_PASSWORD" "$registry_password"
require_value "shared-secret in ${RUNNER_SECRET_NAME}" "$runner_shared_secret"

echo "Updating ${RUNTIME_SECRET_NAME} in namespace ${PLATFORM_NAMESPACE}..."
kubectl_cmd create secret generic "$RUNTIME_SECRET_NAME" \
  --namespace "$PLATFORM_NAMESPACE" \
  --from-literal=gitea-registry-host="$registry_host" \
  --from-literal=gitea-org="$gitea_org" \
  --from-literal=gitea-runner-scope="$gitea_runner_scope" \
  --from-literal=gitea-registry-username="$registry_username" \
  --from-literal=gitea-registry-password="$registry_password" \
  --from-literal=kimibuilt-build-events-url="$build_events_url" \
  --from-literal=kimibuilt-build-events-secret="$build_events_secret" \
  --from-literal=kimibuilt-build-events-insecure="$build_events_insecure" \
  --from-literal=buildkit-host="$buildkit_host" \
  --dry-run=client -o yaml | kubectl_cmd apply -f -

if [[ -n "$runner_registration_token" ]]; then
  echo "Updating ${RUNNER_SECRET_NAME} in namespace ${PLATFORM_NAMESPACE}..."
  kubectl_cmd create secret generic "$RUNNER_SECRET_NAME" \
    --namespace "$PLATFORM_NAMESPACE" \
    --from-literal=shared-secret="$runner_shared_secret" \
    --from-literal=runner-registration-token="$runner_registration_token" \
    --dry-run=client -o yaml | kubectl_cmd apply -f -
else
  echo "Leaving ${RUNNER_SECRET_NAME} runner-registration-token unchanged."
fi

if command -v curl >/dev/null 2>&1; then
  curl_flags=(-fsS)
  if [[ "$build_events_insecure" == "1" || "$build_events_insecure" == "true" ]]; then
    curl_flags+=(-k)
  fi
  echo "Checking registry auth against https://${registry_host}/v2/ ..."
  if curl "${curl_flags[@]}" -u "${registry_username}:${registry_password}" "https://${registry_host}/v2/" >/dev/null; then
    echo "Registry auth check passed."
  else
    echo "Registry auth check failed. The runner will still be restarted, but the credentials likely need correction." >&2
  fi
fi

echo "Scaling ${RUNNER_DEPLOYMENT_NAME} to ${runner_replicas} and restarting it..."
kubectl_cmd scale deployment "$RUNNER_DEPLOYMENT_NAME" -n "$PLATFORM_NAMESPACE" --replicas="$runner_replicas"
kubectl_cmd rollout restart "deployment/${RUNNER_DEPLOYMENT_NAME}" -n "$PLATFORM_NAMESPACE"
kubectl_cmd rollout status "deployment/${RUNNER_DEPLOYMENT_NAME}" -n "$PLATFORM_NAMESPACE" --timeout=180s

echo
echo "Managed-app runner update complete."
echo "Namespace: ${PLATFORM_NAMESPACE}"
echo "Registry host: ${registry_host}"
echo "Registry username: ${registry_username}"
echo "Webhook insecure flag: ${build_events_insecure}"
