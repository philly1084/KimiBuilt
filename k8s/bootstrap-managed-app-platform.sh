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
Bootstrap the external managed-app build platform without rebuilding KimiBuilt.

Environment variables:
  PLATFORM_PROFILE            test or prod. Default: test
  MANIFEST_PATH               Override the manifest path directly
  PLATFORM_NAMESPACE          Default: agent-platform
  SKIP_WAIT                   Set to 1 to skip rollout waits
  FRESH_INSTALL               Set to 1 to delete the platform namespace first
  SKIP_IF_HEALTHY             Set to 0 to re-apply even when healthy. Default: 1
  FORCE_SETUP                 Set to 1 to bypass the healthy-platform short circuit
  ROTATE_SECRETS              Set to 1 to regenerate bootstrap passwords/secrets

If these are provided, the script will also update the runner secret state:
  GITEA_ADMIN_USERNAME
  GITEA_ADMIN_PASSWORD
  GITEA_ADMIN_EMAIL
  GITEA_REGISTRY_USERNAME
  GITEA_REGISTRY_PASSWORD
  KIMIBUILT_BUILD_EVENTS_INSECURE
  KIMIBUILT_BUILD_EVENTS_URL
  KIMIBUILT_BUILD_EVENTS_SECRET
  GITEA_ORG
  GITEA_RUNNER_SCOPE

Examples:
  ./k8s/bootstrap-managed-app-platform.sh

  export FRESH_INSTALL=1
  ./k8s/bootstrap-managed-app-platform.sh

  export PLATFORM_PROFILE=prod
  export GITEA_REGISTRY_USERNAME=admin
  export GITEA_REGISTRY_PASSWORD=<gitea-pat>
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
    ""|change-me|replace-me|replace-after-gitea-boot)
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
  host="$(secret_value agent-platform-runtime gitea-registry-host)"
  username="$(secret_value agent-platform-runtime gitea-registry-username)"
  password="$(secret_value agent-platform-runtime gitea-registry-password)"

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
    && deployment_ready gitea \
    && deployment_ready buildkitd \
    && deployment_ready act-runner \
    && secret_usable gitea-admin password \
    && secret_usable gitea-actions shared-secret \
    && secret_usable gitea-actions runner-registration-token \
    && secret_usable agent-platform-runtime gitea-registry-password \
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
  local admin_username admin_password admin_email
  local shared_secret runner_registration_token
  local registry_host registry_username registry_password
  local build_events_url build_events_secret build_events_insecure buildkit_host

  admin_username="$(choose_secret_value GITEA_ADMIN_USERNAME "$(secret_value gitea-admin username)" "admin")"
  admin_password="$(choose_secret_value GITEA_ADMIN_PASSWORD "$(secret_value gitea-admin password)")"
  admin_email="$(choose_secret_value GITEA_ADMIN_EMAIL "$(secret_value gitea-admin email)" "admin@demoserver2.buzz")"

  shared_secret="$(choose_secret_value GITEA_ACTIONS_SHARED_SECRET "$(secret_value gitea-actions shared-secret)")"
  runner_registration_token="$(secret_value gitea-actions runner-registration-token)"
  if is_enabled "$ROTATE_SECRETS" || is_placeholder "$runner_registration_token"; then
    runner_registration_token="replace-after-gitea-boot"
  fi

  registry_host="$(choose_secret_value GITEA_REGISTRY_HOST "$(secret_value agent-platform-runtime gitea-registry-host)" "gitea.demoserver2.buzz")"
  registry_username="$(choose_secret_value GITEA_REGISTRY_USERNAME "$(secret_value agent-platform-runtime gitea-registry-username)" "$admin_username")"
  registry_password="$(choose_secret_value GITEA_REGISTRY_PASSWORD "$(secret_value agent-platform-runtime gitea-registry-password)" "$admin_password")"
  build_events_url="$(choose_secret_value KIMIBUILT_BUILD_EVENTS_URL "$(secret_value agent-platform-runtime kimibuilt-build-events-url)" "https://kimibuilt.demoserver2.buzz/api/integrations/gitea/build-events")"
  build_events_secret="$(choose_secret_value KIMIBUILT_BUILD_EVENTS_SECRET "$(secret_value agent-platform-runtime kimibuilt-build-events-secret)")"
  build_events_insecure="${KIMIBUILT_BUILD_EVENTS_INSECURE:-$(secret_value agent-platform-runtime kimibuilt-build-events-insecure)}"
  build_events_insecure="${build_events_insecure:-0}"
  buildkit_host="${BUILDKIT_HOST:-$(secret_value agent-platform-runtime buildkit-host)}"
  buildkit_host="${buildkit_host:-tcp://buildkitd.agent-platform.svc.cluster.local:1234}"

  echo "Ensuring generated platform secrets in ${PLATFORM_NAMESPACE}..."
  apply_secret gitea-admin \
    --namespace "$PLATFORM_NAMESPACE" \
    --from-literal=username="$admin_username" \
    --from-literal=password="$admin_password" \
    --from-literal=email="$admin_email"

  apply_secret gitea-actions \
    --namespace "$PLATFORM_NAMESPACE" \
    --from-literal=shared-secret="$shared_secret" \
    --from-literal=runner-registration-token="$runner_registration_token"

  apply_secret agent-platform-runtime \
    --namespace "$PLATFORM_NAMESPACE" \
    --from-literal=gitea-registry-host="$registry_host" \
    --from-literal=gitea-registry-username="$registry_username" \
    --from-literal=gitea-registry-password="$registry_password" \
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

generate_runner_token() {
  local gitea_pod
  gitea_pod="$(kubectl_cmd get pod -n "$PLATFORM_NAMESPACE" -l app=gitea -o "jsonpath={.items[0].metadata.name}")"
  if [[ -z "$gitea_pod" ]]; then
    echo "Could not find a running gitea pod in $PLATFORM_NAMESPACE" >&2
    exit 1
  fi
  kubectl_cmd exec -n "$PLATFORM_NAMESPACE" "$gitea_pod" -- sh -lc \
    'gitea --config /data/gitea/conf/app.ini actions generate-runner-token | tail -n 1' \
    | tr -d '\r\n'
}

sync_gitea_admin_password() {
  local gitea_pod admin_username admin_password
  gitea_pod="$(kubectl_cmd get pod -n "$PLATFORM_NAMESPACE" -l app=gitea -o "jsonpath={.items[0].metadata.name}" 2>/dev/null || true)"
  admin_username="$(secret_value gitea-admin username)"
  admin_password="$(secret_value gitea-admin password)"
  if [[ -z "$gitea_pod" || -z "$admin_username" || -z "$admin_password" ]]; then
    return 1
  fi

  kubectl_cmd exec -n "$PLATFORM_NAMESPACE" "$gitea_pod" -- env \
    KIMIBUILT_GITEA_ADMIN_USERNAME="$admin_username" \
    KIMIBUILT_GITEA_ADMIN_PASSWORD="$admin_password" \
    sh -lc '
      set -eu
      gitea --config /data/gitea/conf/app.ini admin user change-password \
        --username "$KIMIBUILT_GITEA_ADMIN_USERNAME" \
        --password "$KIMIBUILT_GITEA_ADMIN_PASSWORD" \
        --must-change-password=false
    ' >/dev/null
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
  echo "Managed-app platform is already healthy in ${PLATFORM_NAMESPACE}; skipping setup."
  kubectl_cmd get pods -n "$PLATFORM_NAMESPACE"
  exit 0
fi

echo "Ensuring ${PLATFORM_NAMESPACE} namespace and generated secrets..."
ensure_namespace
ensure_bootstrap_secrets

echo "Applying non-secret resources from ${MANIFEST_PATH}..."
apply_manifest_without_secrets

if [[ "$SKIP_WAIT" != "1" ]]; then
  echo "Waiting for Gitea and BuildKit deployments..."
  kubectl_cmd rollout status deployment/gitea -n "$PLATFORM_NAMESPACE" --timeout=300s
  kubectl_cmd rollout status deployment/buildkitd -n "$PLATFORM_NAMESPACE" --timeout=300s
fi

echo "Synchronizing the saved Gitea admin password when the account already exists..."
if sync_gitea_admin_password; then
  echo "Gitea admin password is synchronized with the saved secret."
else
  echo "Gitea admin password sync was skipped or unsupported; continuing with runner bootstrap."
fi

echo "Generating a fresh runner registration token from the Gitea pod..."
RUNNER_REGISTRATION_TOKEN="$(generate_runner_token)"
if [[ -z "$RUNNER_REGISTRATION_TOKEN" ]]; then
  echo "Failed to generate a runner registration token" >&2
  exit 1
fi

if [[ -z "${GITEA_REGISTRY_USERNAME:-}" ]]; then
  GITEA_REGISTRY_USERNAME="$(secret_value gitea-admin username)"
  export GITEA_REGISTRY_USERNAME
fi

if [[ -z "${GITEA_REGISTRY_PASSWORD:-}" ]]; then
  GITEA_REGISTRY_PASSWORD="$(secret_value agent-platform-runtime gitea-registry-password)"
  if [[ -z "$GITEA_REGISTRY_PASSWORD" || "$GITEA_REGISTRY_PASSWORD" == "change-me" ]]; then
    GITEA_REGISTRY_PASSWORD="$(secret_value gitea-admin password)"
  fi
  export GITEA_REGISTRY_PASSWORD
fi

echo "Updating runtime settings and scaling the runner..."
export RUNNER_REGISTRATION_TOKEN
export RUNNER_REPLICAS="${RUNNER_REPLICAS:-1}"
"$SCRIPT_DIR/update-managed-app-runner.sh"

if [[ "$SKIP_WAIT" != "1" ]]; then
  echo "Current platform pods:"
  kubectl_cmd get pods -n "$PLATFORM_NAMESPACE"
fi
