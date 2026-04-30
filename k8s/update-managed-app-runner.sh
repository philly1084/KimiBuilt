#!/usr/bin/env bash
set -euo pipefail

PLATFORM_NAMESPACE="${PLATFORM_NAMESPACE:-agent-platform}"
RUNTIME_SECRET_NAME="${RUNTIME_SECRET_NAME:-agent-platform-runtime}"
RUNNER_SECRET_NAME="${RUNNER_SECRET_NAME:-gitlab-runner}"
RUNNER_DEPLOYMENT_NAME="${RUNNER_DEPLOYMENT_NAME:-gitlab-runner}"
DEFAULT_REGISTRY_HOST="${DEFAULT_REGISTRY_HOST:-registry.gitlab.demoserver2.buzz}"
DEFAULT_BUILDKIT_HOST="${DEFAULT_BUILDKIT_HOST:-tcp://buildkitd.agent-platform.svc.cluster.local:1234}"
DEFAULT_BUILD_EVENTS_INSECURE="${DEFAULT_BUILD_EVENTS_INSECURE:-0}"
DEFAULT_RUNNER_REPLICAS="${DEFAULT_RUNNER_REPLICAS:-1}"
DEFAULT_CI_SERVER_URL="${DEFAULT_CI_SERVER_URL:-https://gitlab.demoserver2.buzz}"
DEFAULT_RUNNER_TAG_LIST="${DEFAULT_RUNNER_TAG_LIST:-kimibuilt,buildkit}"

usage() {
  cat <<'EOF'
Update the managed-app GitLab runner and registry secrets on the build cluster.

Required environment variables:
  GITLAB_REGISTRY_USERNAME   GitLab user, deploy token, or service account username
  GITLAB_REGISTRY_PASSWORD   Token/password with container registry read/write access

Optional environment variables:
  GITLAB_REGISTRY_HOST       Default: registry.gitlab.demoserver2.buzz
  GITLAB_RUNNER_TOKEN        GitLab runner authentication token, usually glrt-...
  GITLAB_BASE_URL            Default: https://gitlab.demoserver2.buzz
  GITLAB_RUNNER_TAG_LIST     Default: kimibuilt,buildkit
  KIMIBUILT_BUILD_EVENTS_URL Existing secret value is reused when unset
  KIMIBUILT_BUILD_EVENTS_SECRET
                            Existing secret value is reused when unset
  KIMIBUILT_BUILD_EVENTS_INSECURE
                            Default: existing secret value or 0
  BUILDKIT_HOST              Default: existing secret value or buildkit service
  RUNNER_REPLICAS            Default: current replicas or 1
  PLATFORM_NAMESPACE         Default: agent-platform
  RUNTIME_SECRET_NAME        Default: agent-platform-runtime
  RUNNER_SECRET_NAME         Default: gitlab-runner
  RUNNER_DEPLOYMENT_NAME     Default: gitlab-runner

Legacy GITEA_REGISTRY_* environment variables are accepted only as migration
fallbacks when the GitLab-specific names are unset.

Examples:
  export GITLAB_REGISTRY_USERNAME=root
  export GITLAB_REGISTRY_PASSWORD=<gitlab-token>
  export GITLAB_RUNNER_TOKEN=<glrt-token>
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

is_placeholder() {
  case "${1:-}" in
    ""|change-me|replace-me|replace-after-gitea-boot|replace-after-gitlab-boot)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

require_value() {
  local name="$1"
  local value="$2"
  if is_placeholder "$value"; then
    echo "Missing required value: $name" >&2
    exit 1
  fi
}

registry_host="${GITLAB_REGISTRY_HOST:-$(secret_value "$RUNTIME_SECRET_NAME" gitlab-registry-host)}"
registry_username="${GITLAB_REGISTRY_USERNAME:-$(secret_value "$RUNTIME_SECRET_NAME" gitlab-registry-username)}"
registry_password="${GITLAB_REGISTRY_PASSWORD:-$(secret_value "$RUNTIME_SECRET_NAME" gitlab-registry-password)}"

registry_host="${registry_host:-${GITEA_REGISTRY_HOST:-$(secret_value "$RUNTIME_SECRET_NAME" gitea-registry-host)}}"
registry_username="${registry_username:-${GITEA_REGISTRY_USERNAME:-$(secret_value "$RUNTIME_SECRET_NAME" gitea-registry-username)}}"
registry_password="${registry_password:-${GITEA_REGISTRY_PASSWORD:-$(secret_value "$RUNTIME_SECRET_NAME" gitea-registry-password)}}"

build_events_url="${KIMIBUILT_BUILD_EVENTS_URL:-$(secret_value "$RUNTIME_SECRET_NAME" kimibuilt-build-events-url)}"
build_events_secret="${KIMIBUILT_BUILD_EVENTS_SECRET:-$(secret_value "$RUNTIME_SECRET_NAME" kimibuilt-build-events-secret)}"
build_events_insecure="${KIMIBUILT_BUILD_EVENTS_INSECURE:-$(secret_value "$RUNTIME_SECRET_NAME" kimibuilt-build-events-insecure)}"
buildkit_host="${BUILDKIT_HOST:-$(secret_value "$RUNTIME_SECRET_NAME" buildkit-host)}"
ci_server_url="${GITLAB_BASE_URL:-$DEFAULT_CI_SERVER_URL}"
runner_tag_list="${GITLAB_RUNNER_TAG_LIST:-$DEFAULT_RUNNER_TAG_LIST}"

registry_host="${registry_host:-$DEFAULT_REGISTRY_HOST}"
build_events_insecure="${build_events_insecure:-$DEFAULT_BUILD_EVENTS_INSECURE}"
buildkit_host="${buildkit_host:-$DEFAULT_BUILDKIT_HOST}"

runner_token="${GITLAB_RUNNER_TOKEN:-$(secret_value "$RUNNER_SECRET_NAME" runner-token)}"
current_replicas="$(deployment_replicas)"
runner_replicas="${RUNNER_REPLICAS:-${current_replicas:-$DEFAULT_RUNNER_REPLICAS}}"

require_value "GITLAB_REGISTRY_USERNAME" "$registry_username"
require_value "GITLAB_REGISTRY_PASSWORD" "$registry_password"

echo "Updating ${RUNTIME_SECRET_NAME} in namespace ${PLATFORM_NAMESPACE}..."
kubectl_cmd create secret generic "$RUNTIME_SECRET_NAME" \
  --namespace "$PLATFORM_NAMESPACE" \
  --from-literal=gitlab-registry-host="$registry_host" \
  --from-literal=gitlab-registry-username="$registry_username" \
  --from-literal=gitlab-registry-password="$registry_password" \
  --from-literal=kimibuilt-build-events-url="$build_events_url" \
  --from-literal=kimibuilt-build-events-secret="$build_events_secret" \
  --from-literal=kimibuilt-build-events-insecure="$build_events_insecure" \
  --from-literal=buildkit-host="$buildkit_host" \
  --dry-run=client -o yaml | kubectl_cmd apply -f -

if ! is_placeholder "$runner_token"; then
  echo "Updating ${RUNNER_SECRET_NAME} in namespace ${PLATFORM_NAMESPACE}..."
  kubectl_cmd create secret generic "$RUNNER_SECRET_NAME" \
    --namespace "$PLATFORM_NAMESPACE" \
    --from-literal=runner-token="$runner_token" \
    --dry-run=client -o yaml | kubectl_cmd apply -f -
else
  echo "No GitLab runner token was provided; ${RUNNER_DEPLOYMENT_NAME} will remain scaled to 0."
  runner_replicas=0
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

echo "Updating ${RUNNER_DEPLOYMENT_NAME} environment, scaling to ${runner_replicas}, and restarting it..."
if kubectl_cmd get deployment "$RUNNER_DEPLOYMENT_NAME" -n "$PLATFORM_NAMESPACE" >/dev/null 2>&1; then
  kubectl_cmd set env "deployment/${RUNNER_DEPLOYMENT_NAME}" -n "$PLATFORM_NAMESPACE" \
    CI_SERVER_URL="$ci_server_url" \
    RUNNER_TAG_LIST="$runner_tag_list" >/dev/null
  kubectl_cmd scale deployment "$RUNNER_DEPLOYMENT_NAME" -n "$PLATFORM_NAMESPACE" --replicas="$runner_replicas"
  kubectl_cmd rollout restart "deployment/${RUNNER_DEPLOYMENT_NAME}" -n "$PLATFORM_NAMESPACE"
  if [[ "$runner_replicas" != "0" ]]; then
    kubectl_cmd rollout status "deployment/${RUNNER_DEPLOYMENT_NAME}" -n "$PLATFORM_NAMESPACE" --timeout=180s
  fi
else
  echo "Runner deployment ${RUNNER_DEPLOYMENT_NAME} is missing in namespace ${PLATFORM_NAMESPACE}." >&2
  exit 1
fi

echo
echo "Managed-app GitLab runner update complete."
echo "Namespace: ${PLATFORM_NAMESPACE}"
echo "Registry host: ${registry_host}"
echo "Registry username: ${registry_username}"
echo "GitLab URL: ${ci_server_url}"
echo "Runner tags: ${runner_tag_list}"
echo "Webhook insecure flag: ${build_events_insecure}"
