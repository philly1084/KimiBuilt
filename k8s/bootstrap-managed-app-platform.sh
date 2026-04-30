#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_NAMESPACE="${PLATFORM_NAMESPACE:-agent-platform}"
PLATFORM_PROFILE="${PLATFORM_PROFILE:-test}"
MANIFEST_PATH="${MANIFEST_PATH:-}"
SKIP_WAIT="${SKIP_WAIT:-0}"
FRESH_INSTALL="${FRESH_INSTALL:-0}"
SKIP_IF_HEALTHY="${SKIP_IF_HEALTHY:-1}"
FORCE_SETUP="${FORCE_SETUP:-0}"
ROTATE_SECRETS="${ROTATE_SECRETS:-0}"

usage() {
  cat <<'EOF'
Bootstrap the external GitLab managed-app build platform without rebuilding KimiBuilt.

Environment variables:
  PLATFORM_PROFILE            test or prod. Default: test
  MANIFEST_PATH               Override the manifest path directly
  PLATFORM_NAMESPACE          Default: agent-platform
  SKIP_WAIT                   Set to 1 to skip rollout waits
  FRESH_INSTALL               Set to 1 to delete the platform namespace first
  SKIP_IF_HEALTHY             Set to 0 to re-apply even when healthy. Default: 1
  FORCE_SETUP                 Set to 1 to bypass the healthy-platform short circuit
  ROTATE_SECRETS              Set to 1 to regenerate bootstrap passwords/secrets

If these are provided, the script also updates the runner and registry state:
  GITLAB_ROOT_USERNAME
  GITLAB_ROOT_PASSWORD
  GITLAB_ROOT_EMAIL
  GITLAB_REGISTRY_HOST
  GITLAB_REGISTRY_USERNAME
  GITLAB_REGISTRY_PASSWORD
  GITLAB_RUNNER_TOKEN
  GITLAB_BASE_URL
  GITLAB_RUNNER_TAG_LIST
  KIMIBUILT_BUILD_EVENTS_INSECURE
  KIMIBUILT_BUILD_EVENTS_URL
  KIMIBUILT_BUILD_EVENTS_SECRET

Legacy GITEA_REGISTRY_* variables are accepted only as migration fallbacks.

Examples:
  ./k8s/bootstrap-managed-app-platform.sh

  export FRESH_INSTALL=1
  ./k8s/bootstrap-managed-app-platform.sh

  export PLATFORM_PROFILE=prod
  export GITLAB_REGISTRY_USERNAME=root
  export GITLAB_REGISTRY_PASSWORD=<gitlab-token>
  export GITLAB_RUNNER_TOKEN=<glrt-token>
  ./k8s/bootstrap-managed-app-platform.sh
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

is_enabled() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
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

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 36 | tr -d '\r\n'
    return
  fi
  head -c 48 /dev/urandom | base64 | tr -d '\r\n'
}

choose_secret_value() {
  local env_name="$1"
  local current_value="$2"
  local fallback_value="${3:-}"
  local env_value="${!env_name:-}"

  if [[ -n "$env_value" ]]; then
    printf '%s' "$env_value"
    return
  fi

  if ! is_enabled "$ROTATE_SECRETS" && ! is_placeholder "$current_value"; then
    printf '%s' "$current_value"
    return
  fi

  if [[ -n "$fallback_value" ]]; then
    printf '%s' "$fallback_value"
    return
  fi

  random_secret
}

secret_usable() {
  local secret_name="$1"
  local key="$2"
  local value
  value="$(secret_value "$secret_name" "$key")"
  ! is_placeholder "$value"
}

deployment_ready() {
  local name="$1"
  local desired ready
  desired="$(kubectl_cmd get deployment "$name" -n "$PLATFORM_NAMESPACE" -o 'jsonpath={.spec.replicas}' 2>/dev/null || true)"
  ready="$(kubectl_cmd get deployment "$name" -n "$PLATFORM_NAMESPACE" -o 'jsonpath={.status.readyReplicas}' 2>/dev/null || true)"
  desired="${desired:-0}"
  ready="${ready:-0}"
  [[ "$desired" -ge 1 && "$ready" -ge "$desired" ]]
}

registry_auth_healthy() {
  local host username password
  host="$(secret_value agent-platform-runtime gitlab-registry-host)"
  username="$(secret_value agent-platform-runtime gitlab-registry-username)"
  password="$(secret_value agent-platform-runtime gitlab-registry-password)"

  if is_placeholder "$host" || is_placeholder "$username" || is_placeholder "$password"; then
    return 1
  fi

  if ! command -v curl >/dev/null 2>&1; then
    return 0
  fi

  curl -fsS -u "${username}:${password}" "https://${host}/v2/" >/dev/null 2>&1
}

platform_healthy() {
  kubectl_cmd get namespace "$PLATFORM_NAMESPACE" >/dev/null 2>&1 \
    && deployment_ready gitlab \
    && deployment_ready buildkitd \
    && deployment_ready gitlab-runner \
    && secret_usable gitlab-root password \
    && secret_usable gitlab-runner runner-token \
    && secret_usable agent-platform-runtime gitlab-registry-password \
    && secret_usable agent-platform-runtime kimibuilt-build-events-secret \
    && registry_auth_healthy
}

apply_secret() {
  kubectl_cmd create secret generic "$@" --dry-run=client -o yaml | kubectl_cmd apply -f -
}

ensure_namespace() {
  kubectl_cmd create namespace "$PLATFORM_NAMESPACE" --dry-run=client -o yaml | kubectl_cmd apply -f -
}

ensure_bootstrap_secrets() {
  local root_username root_password root_email
  local runner_token
  local registry_host registry_username registry_password
  local build_events_url build_events_secret build_events_insecure buildkit_host

  root_username="$(choose_secret_value GITLAB_ROOT_USERNAME "$(secret_value gitlab-root username)" "root")"
  root_password="$(choose_secret_value GITLAB_ROOT_PASSWORD "$(secret_value gitlab-root password)")"
  root_email="$(choose_secret_value GITLAB_ROOT_EMAIL "$(secret_value gitlab-root email)" "admin@demoserver2.buzz")"

  runner_token="$(choose_secret_value GITLAB_RUNNER_TOKEN "$(secret_value gitlab-runner runner-token)" "replace-after-gitlab-boot")"

  registry_host="$(choose_secret_value GITLAB_REGISTRY_HOST "$(secret_value agent-platform-runtime gitlab-registry-host)" "registry.gitlab.demoserver2.buzz")"
  registry_username="$(choose_secret_value GITLAB_REGISTRY_USERNAME "$(secret_value agent-platform-runtime gitlab-registry-username)" "${GITEA_REGISTRY_USERNAME:-$root_username}")"
  registry_password="$(choose_secret_value GITLAB_REGISTRY_PASSWORD "$(secret_value agent-platform-runtime gitlab-registry-password)" "${GITEA_REGISTRY_PASSWORD:-$root_password}")"
  build_events_url="$(choose_secret_value KIMIBUILT_BUILD_EVENTS_URL "$(secret_value agent-platform-runtime kimibuilt-build-events-url)" "https://kimibuilt.demoserver2.buzz/api/integrations/gitlab/build-events")"
  build_events_secret="$(choose_secret_value KIMIBUILT_BUILD_EVENTS_SECRET "$(secret_value agent-platform-runtime kimibuilt-build-events-secret)")"
  build_events_insecure="${KIMIBUILT_BUILD_EVENTS_INSECURE:-$(secret_value agent-platform-runtime kimibuilt-build-events-insecure)}"
  build_events_insecure="${build_events_insecure:-0}"
  buildkit_host="${BUILDKIT_HOST:-$(secret_value agent-platform-runtime buildkit-host)}"
  buildkit_host="${buildkit_host:-tcp://buildkitd.agent-platform.svc.cluster.local:1234}"

  echo "Ensuring generated GitLab platform secrets in ${PLATFORM_NAMESPACE}..."
  apply_secret gitlab-root \
    --namespace "$PLATFORM_NAMESPACE" \
    --from-literal=username="$root_username" \
    --from-literal=password="$root_password" \
    --from-literal=email="$root_email"

  apply_secret gitlab-runner \
    --namespace "$PLATFORM_NAMESPACE" \
    --from-literal=runner-token="$runner_token"

  apply_secret agent-platform-runtime \
    --namespace "$PLATFORM_NAMESPACE" \
    --from-literal=gitlab-registry-host="$registry_host" \
    --from-literal=gitlab-registry-username="$registry_username" \
    --from-literal=gitlab-registry-password="$registry_password" \
    --from-literal=kimibuilt-build-events-url="$build_events_url" \
    --from-literal=kimibuilt-build-events-secret="$build_events_secret" \
    --from-literal=kimibuilt-build-events-insecure="$build_events_insecure" \
    --from-literal=buildkit-host="$buildkit_host"
}

apply_manifest_without_secrets() {
  awk '
    BEGIN { doc = ""; started = 0 }
    /^---[[:space:]]*$/ {
      if (started && doc !~ /\nkind:[[:space:]]*Secret([[:space:]]|\n)/) {
        printf "%s", doc
      }
      doc = $0 "\n"
      started = 1
      next
    }
    {
      if (!started) {
        started = 1
      }
      doc = doc $0 "\n"
    }
    END {
      if (started && doc !~ /\nkind:[[:space:]]*Secret([[:space:]]|\n)/) {
        printf "%s", doc
      }
    }
  ' "$MANIFEST_PATH" | kubectl_cmd apply -f -
}

wait_for_namespace_deletion() {
  local namespace="$1"
  local attempt
  for attempt in $(seq 1 60); do
    if ! kubectl_cmd get namespace "$namespace" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "Timed out waiting for namespace $namespace to delete" >&2
  exit 1
}

if [[ -z "$MANIFEST_PATH" ]]; then
  case "$PLATFORM_PROFILE" in
    test)
      MANIFEST_PATH="$SCRIPT_DIR/rancher-agent-platform-test-env.yaml"
      ;;
    prod)
      MANIFEST_PATH="$SCRIPT_DIR/rancher-agent-platform.yaml"
      ;;
    *)
      echo "Unsupported PLATFORM_PROFILE=$PLATFORM_PROFILE" >&2
      exit 1
      ;;
  esac
fi

if is_enabled "$FRESH_INSTALL"; then
  echo "Deleting namespace ${PLATFORM_NAMESPACE} for a fresh install..."
  kubectl_cmd delete namespace "$PLATFORM_NAMESPACE" --ignore-not-found=true
  wait_for_namespace_deletion "$PLATFORM_NAMESPACE"
fi

if is_enabled "$SKIP_IF_HEALTHY" && ! is_enabled "$FORCE_SETUP" && ! is_enabled "$FRESH_INSTALL" && platform_healthy; then
  echo "Managed-app GitLab platform is already healthy in ${PLATFORM_NAMESPACE}; skipping setup."
  kubectl_cmd get pods -n "$PLATFORM_NAMESPACE"
  exit 0
fi

echo "Ensuring ${PLATFORM_NAMESPACE} namespace and generated secrets..."
ensure_namespace
ensure_bootstrap_secrets

echo "Applying non-secret resources from ${MANIFEST_PATH}..."
apply_manifest_without_secrets

if [[ "$SKIP_WAIT" != "1" ]]; then
  echo "Waiting for GitLab and BuildKit deployments..."
  kubectl_cmd rollout status deployment/gitlab -n "$PLATFORM_NAMESPACE" --timeout=900s
  kubectl_cmd rollout status deployment/buildkitd -n "$PLATFORM_NAMESPACE" --timeout=300s
fi

runner_token="$(secret_value gitlab-runner runner-token)"
if is_placeholder "$runner_token"; then
  echo
  echo "GitLab is deployed, but the runner is not enabled yet."
  echo "Create a GitLab runner authentication token in GitLab, then run:"
  echo "  export GITLAB_RUNNER_TOKEN=<glrt-token>"
  echo "  ./k8s/update-managed-app-runner.sh"
  kubectl_cmd scale deployment gitlab-runner -n "$PLATFORM_NAMESPACE" --replicas=0 >/dev/null 2>&1 || true
else
  echo "Updating runtime settings and scaling the GitLab runner..."
  export GITLAB_RUNNER_TOKEN="$runner_token"
  export RUNNER_REPLICAS="${RUNNER_REPLICAS:-1}"
  export GITLAB_REGISTRY_HOST="${GITLAB_REGISTRY_HOST:-$(secret_value agent-platform-runtime gitlab-registry-host)}"
  export GITLAB_REGISTRY_USERNAME="${GITLAB_REGISTRY_USERNAME:-$(secret_value agent-platform-runtime gitlab-registry-username)}"
  export GITLAB_REGISTRY_PASSWORD="${GITLAB_REGISTRY_PASSWORD:-$(secret_value agent-platform-runtime gitlab-registry-password)}"
  "$SCRIPT_DIR/update-managed-app-runner.sh"
fi

if [[ "$SKIP_WAIT" != "1" ]]; then
  echo "Current platform pods:"
  kubectl_cmd get pods -n "$PLATFORM_NAMESPACE"
fi
