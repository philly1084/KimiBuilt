#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_NAMESPACE="${PLATFORM_NAMESPACE:-agent-platform}"
PLATFORM_PROFILE="${PLATFORM_PROFILE:-test}"
MANIFEST_PATH="${MANIFEST_PATH:-}"
SKIP_WAIT="${SKIP_WAIT:-0}"

usage() {
  cat <<'EOF'
Bootstrap the external managed-app build platform without rebuilding KimiBuilt.

Environment variables:
  PLATFORM_PROFILE            test or prod. Default: test
  MANIFEST_PATH               Override the manifest path directly
  PLATFORM_NAMESPACE          Default: agent-platform
  SKIP_WAIT                   Set to 1 to skip rollout waits

If these are provided, the script will also update the runner secret state:
  GITEA_REGISTRY_USERNAME
  GITEA_REGISTRY_PASSWORD
  KIMIBUILT_BUILD_EVENTS_INSECURE
  GITEA_ORG
  GITEA_RUNNER_SCOPE

Examples:
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

echo "Applying ${MANIFEST_PATH}..."
kubectl_cmd apply -f "$MANIFEST_PATH"

if [[ "$SKIP_WAIT" != "1" ]]; then
  echo "Waiting for Gitea and BuildKit deployments..."
  kubectl_cmd rollout status deployment/gitea -n "$PLATFORM_NAMESPACE" --timeout=300s
  kubectl_cmd rollout status deployment/buildkitd -n "$PLATFORM_NAMESPACE" --timeout=300s
fi

if [[ -n "${GITEA_REGISTRY_USERNAME:-}" && -n "${GITEA_REGISTRY_PASSWORD:-}" ]]; then
  echo "Updating runner runtime settings..."
  "$SCRIPT_DIR/update-managed-app-runner.sh"
elif [[ "$SKIP_WAIT" != "1" ]]; then
  echo
  echo "Platform base services are ready."
  echo "Set GITEA_REGISTRY_USERNAME and GITEA_REGISTRY_PASSWORD, then run:"
  echo "  $SCRIPT_DIR/update-managed-app-runner.sh"
fi

if [[ "$SKIP_WAIT" != "1" ]]; then
  echo "Current platform pods:"
  kubectl_cmd get pods -n "$PLATFORM_NAMESPACE"
fi
