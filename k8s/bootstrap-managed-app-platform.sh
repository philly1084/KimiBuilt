#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_NAMESPACE="${PLATFORM_NAMESPACE:-agent-platform}"
PLATFORM_PROFILE="${PLATFORM_PROFILE:-test}"
MANIFEST_PATH="${MANIFEST_PATH:-}"
SKIP_WAIT="${SKIP_WAIT:-0}"
FRESH_INSTALL="${FRESH_INSTALL:-0}"

usage() {
  cat <<'EOF'
Bootstrap the external managed-app build platform without rebuilding KimiBuilt.

Environment variables:
  PLATFORM_PROFILE            test or prod. Default: test
  MANIFEST_PATH               Override the manifest path directly
  PLATFORM_NAMESPACE          Default: agent-platform
  SKIP_WAIT                   Set to 1 to skip rollout waits
  FRESH_INSTALL               Set to 1 to delete the platform namespace first

If these are provided, the script will also update the runner secret state:
  GITEA_REGISTRY_USERNAME
  GITEA_REGISTRY_PASSWORD
  KIMIBUILT_BUILD_EVENTS_INSECURE
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

if [[ "$FRESH_INSTALL" == "1" || "$FRESH_INSTALL" == "true" ]]; then
  echo "Deleting namespace ${PLATFORM_NAMESPACE} for a fresh install..."
  kubectl_cmd delete namespace "$PLATFORM_NAMESPACE" --ignore-not-found=true
  wait_for_namespace_deletion "$PLATFORM_NAMESPACE"
fi

echo "Applying ${MANIFEST_PATH}..."
kubectl_cmd apply -f "$MANIFEST_PATH"

if [[ "$SKIP_WAIT" != "1" ]]; then
  echo "Waiting for Gitea and BuildKit deployments..."
  kubectl_cmd rollout status deployment/gitea -n "$PLATFORM_NAMESPACE" --timeout=300s
  kubectl_cmd rollout status deployment/buildkitd -n "$PLATFORM_NAMESPACE" --timeout=300s
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
