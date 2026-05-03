#!/usr/bin/env bash
set -euo pipefail

KIMIBUILT_NAMESPACE="${KIMIBUILT_NAMESPACE:-kimibuilt}"
KIMIBUILT_SECRET="${KIMIBUILT_SECRET:-kimibuilt-secrets}"
N8N_NAMESPACE="${N8N_NAMESPACE:-n8n-openai-gateway}"
ALIGN_GATEWAY_KEYS="${ALIGN_GATEWAY_KEYS:-0}"
KUBECTL="${KUBECTL:-}"

kubectl_cmd() {
  if [[ -n "$KUBECTL" ]]; then
    # Intentionally allow a command with arguments, such as: sudo k3s kubectl.
    # shellcheck disable=SC2086
    $KUBECTL "$@"
    return
  fi
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

is_enabled() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

is_placeholder() {
  case "${1:-}" in
    ""|change-me|replace-me|replace-after-gitlab-boot|replace-after-gitea-boot|SET_VIA_KUBECTL_CREATE_SECRET|OPTIONAL_SET_VIA_KUBECTL_CREATE_SECRET)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
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
  local namespace="$1"
  local secret_name="$2"
  local key="$3"
  local raw=""
  raw="$(kubectl_cmd get secret "$secret_name" -n "$namespace" -o "jsonpath={.data.${key}}" 2>/dev/null || true)"
  decode_or_empty "$raw"
}

fingerprint() {
  local value="$1"
  if [[ -z "$value" ]]; then
    printf 'missing'
    return
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$value" | sha256sum | awk '{print substr($1,1,12)}'
    return
  fi
  printf '%s' "$value" | shasum -a 256 | awk '{print substr($1,1,12)}'
}

patch_secret_key() {
  local namespace="$1"
  local secret_name="$2"
  local key="$3"
  local value="$4"
  local encoded

  encoded="$(printf '%s' "$value" | base64 | tr -d '\r\n')"
  kubectl_cmd patch secret "$secret_name" \
    -n "$namespace" \
    --type merge \
    -p "{\"data\":{\"${key}\":\"${encoded}\"}}" >/dev/null
}

report_key() {
  local namespace="$1"
  local secret_name="$2"
  local key="$3"
  local value
  value="$(secret_value "$namespace" "$secret_name" "$key")"
  if is_placeholder "$value"; then
    printf '  %-34s missing-or-placeholder\n' "$key"
  else
    printf '  %-34s set sha256:%s len:%s\n' "$key" "$(fingerprint "$value")" "${#value}"
  fi
}

find_gateway_key() {
  local env_value="${N8N_API_KEY:-}"
  local secret_name value

  if ! is_placeholder "$env_value"; then
    printf 'env N8N_API_KEY %s\n' "$env_value"
    return
  fi

  for secret_name in $(kubectl_cmd get secret -n "$N8N_NAMESPACE" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true); do
    value="$(secret_value "$N8N_NAMESPACE" "$secret_name" N8N_API_KEY)"
    if ! is_placeholder "$value"; then
      printf '%s %s %s\n' "$N8N_NAMESPACE" "$secret_name" "$value"
      return
    fi
  done

  return 1
}

compare_to_gateway() {
  local key="$1"
  local gateway_value="$2"
  local value
  value="$(secret_value "$KIMIBUILT_NAMESPACE" "$KIMIBUILT_SECRET" "$key")"
  if is_placeholder "$value"; then
    printf '  %-34s missing in %s/%s\n' "$key" "$KIMIBUILT_NAMESPACE" "$KIMIBUILT_SECRET"
    return
  fi
  if [[ "$value" == "$gateway_value" ]]; then
    printf '  %-34s matches gateway sha256:%s\n' "$key" "$(fingerprint "$value")"
  else
    printf '  %-34s differs from gateway local:%s gateway:%s\n' "$key" "$(fingerprint "$value")" "$(fingerprint "$gateway_value")"
  fi
}

if ! kubectl_cmd get namespace default >/dev/null 2>&1; then
  echo "ERROR: kubectl is not connected to the target k3s cluster." >&2
  echo "Run on the server with KUBECTL=\"sudo k3s kubectl\" if needed." >&2
  exit 1
fi

echo "KimiBuilt secret inventory for ${KIMIBUILT_NAMESPACE}/${KIMIBUILT_SECRET}"
if ! kubectl_cmd get secret "$KIMIBUILT_SECRET" -n "$KIMIBUILT_NAMESPACE" >/dev/null 2>&1; then
  echo "  missing secret"
else
  for key in \
    OPENAI_API_KEY \
    N8N_API_KEY \
    REMOTE_CLI_MCP_BEARER_TOKEN \
    OPENAI_MEDIA_API_KEY \
    PERPLEXITY_API_KEY \
    LILLYBUILT_AUTH_USERNAME \
    LILLYBUILT_AUTH_PASSWORD \
    LILLYBUILT_JWT_SECRET \
    KIMIBUILT_REMOTE_RUNNER_TOKEN \
    POSTGRES_PASSWORD \
    DOCKER_HOST \
    KIMIBUILT_SSH_HOST \
    KIMIBUILT_SSH_USERNAME \
    KIMIBUILT_SSH_PASSWORD; do
    report_key "$KIMIBUILT_NAMESPACE" "$KIMIBUILT_SECRET" "$key"
  done
fi

echo
echo "Gateway key comparison"
gateway_line="$(find_gateway_key || true)"
if [[ -z "$gateway_line" ]]; then
  echo "  no N8N_API_KEY found in env or namespace ${N8N_NAMESPACE}"
  echo "  set N8N_API_KEY in this shell, or confirm the gateway secret name/namespace, then rerun"
  exit 2
fi

gateway_source="$(printf '%s' "$gateway_line" | awk '{print $1 "/" $2}')"
gateway_value="$(printf '%s' "$gateway_line" | cut -d' ' -f3-)"
echo "  source ${gateway_source} sha256:$(fingerprint "$gateway_value") len:${#gateway_value}"
compare_to_gateway OPENAI_API_KEY "$gateway_value"
compare_to_gateway N8N_API_KEY "$gateway_value"
compare_to_gateway REMOTE_CLI_MCP_BEARER_TOKEN "$gateway_value"

if is_enabled "$ALIGN_GATEWAY_KEYS"; then
  echo
  echo "Aligning KimiBuilt gateway keys from ${gateway_source}..."
  if ! kubectl_cmd get secret "$KIMIBUILT_SECRET" -n "$KIMIBUILT_NAMESPACE" >/dev/null 2>&1; then
    kubectl_cmd create secret generic "$KIMIBUILT_SECRET" \
      -n "$KIMIBUILT_NAMESPACE" \
      --from-literal=__bootstrap__=1 >/dev/null
  fi
  patch_secret_key "$KIMIBUILT_NAMESPACE" "$KIMIBUILT_SECRET" OPENAI_API_KEY "$gateway_value"
  patch_secret_key "$KIMIBUILT_NAMESPACE" "$KIMIBUILT_SECRET" N8N_API_KEY "$gateway_value"
  patch_secret_key "$KIMIBUILT_NAMESPACE" "$KIMIBUILT_SECRET" REMOTE_CLI_MCP_BEARER_TOKEN "$gateway_value"
  echo "  aligned OPENAI_API_KEY, N8N_API_KEY, and REMOTE_CLI_MCP_BEARER_TOKEN"
fi
