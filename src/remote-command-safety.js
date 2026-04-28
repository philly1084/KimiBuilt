'use strict';

function normalizeText(value = '') {
  return String(value || '').trim();
}

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function hasKubectlSetAddBeforeSubcommand(command = '') {
  const text = normalizeText(command);
  if (!text) {
    return false;
  }

  return text
    .split(/\r?\n/)
    .some((line) => /\bkubectl\s+set\s+(?:--?[^\s]+\s+)*--add\b/i.test(line));
}

function collectK3sCommandHints({
  command = '',
  stderr = '',
  stdout = '',
  message = '',
} = {}) {
  const rawCommand = normalizeText(command);
  const combined = [
    stderr,
    stdout,
    message,
    rawCommand,
  ].map((value) => String(value || '')).join('\n').toLowerCase();
  const hints = [];

  if (hasKubectlSetAddBeforeSubcommand(rawCommand)
    || (/unknown flag:\s*--add/.test(combined) && /\bkubectl\s+set\b/.test(combined))) {
    hints.push('`kubectl set --add` is invalid. Use `kubectl set volume <resource> --add ...` or a validated `kubectl patch` for ConfigMap volume mounts.');
  }

  if (/strict decoding error|unknown field|error converting yaml to json|did not find expected key|mapping values are not allowed/.test(combined)) {
    hints.push('Kubernetes rejected the manifest shape or YAML. Validate with `kubectl apply --dry-run=server -f <file>` or use `kubectl create ... --dry-run=client -o yaml | kubectl apply -f -` generators before live apply.');
  }

  if (/kubectl: command not found|\bkubectl\b.*not found/.test(combined)) {
    hints.push('On k3s hosts, `kubectl` may only be available through `k3s kubectl`. Try `export KUBECONFIG=/etc/rancher/k3s/k3s.yaml` and then `kubectl ...`, or use `k3s kubectl ...`.');
  }

  if (/connection to the server .* was refused|couldn.t get current server api group list|localhost:\d+.*connection refused|127\.0\.0\.1:\d+.*connection refused/.test(combined)) {
    hints.push('Kubectl is pointed at a dead or local context. On the k3s server, set `KUBECONFIG=/etc/rancher/k3s/k3s.yaml` or use `k3s kubectl` before inspecting the cluster.');
  }

  if (/namespaces? "[^"]+" not found/.test(combined)) {
    hints.push('Create the namespace idempotently before namespaced resources: `kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f -`.');
  }

  if (/\bkubectl\s+set\s+image\b/.test(rawCommand.toLowerCase())
    && /all resources must be specified before image changes|invalid image name|must have the form/.test(combined)) {
    hints.push('For image updates, use `kubectl set image deployment/<name> <container>=<image> -n <namespace>` and verify the actual container name first.');
  }

  if (/no matches for kind "ingress"|extensions\/v1beta1|no matches for kind/.test(combined)) {
    hints.push('The manifest may target an API version this k3s cluster does not serve. Prefer `kubectl create ingress ... --dry-run=client -o yaml` or `networking.k8s.io/v1` Ingress manifests.');
  }

  if (/timed out waiting for the condition|progress deadline exceeded/.test(combined)) {
    hints.push('A rollout timed out. Follow with `kubectl describe deployment`, `kubectl get events --sort-by=.lastTimestamp`, and current/previous pod logs in the same namespace.');
  }

  if (/imagepullbackoff|errimagepull|exec format error/.test(combined)) {
    hints.push('Check the image tag, registry pull secret, and CPU architecture. This deployment target is commonly ARM64/aarch64.');
  }

  return unique(hints);
}

function getRemoteCommandPreflight(command = '') {
  const blockers = [];

  if (hasKubectlSetAddBeforeSubcommand(command)) {
    blockers.push('Invalid Kubernetes command: `kubectl set --add` is not valid syntax. Put the `volume` subcommand before `--add`, for example `kubectl set volume deployment/<name> --add ...`, or use `kubectl patch`.');
  }

  return {
    ok: blockers.length === 0,
    blockers,
    hints: collectK3sCommandHints({ command }),
  };
}

function assertRemoteCommandPreflight(command = '') {
  const preflight = getRemoteCommandPreflight(command);
  if (preflight.ok) {
    return preflight;
  }

  const error = new Error([
    preflight.blockers.join(' '),
    '',
    'Hints:',
    ...preflight.hints.map((hint) => `- ${hint}`),
  ].join('\n'));
  error.name = 'RemoteCommandPreflightError';
  error.code = 'REMOTE_COMMAND_PREFLIGHT_FAILED';
  error.remoteCommandPreflightFailed = true;
  error.hints = preflight.hints;
  error.preflight = preflight;
  throw error;
}

function enrichRemoteExecutionError(error, {
  command = '',
  host = '',
  extraHints = [],
} = {}) {
  const hints = unique([
    ...(Array.isArray(error?.hints) ? error.hints : []),
    ...extraHints,
    ...collectK3sCommandHints({
      command,
      stderr: error?.stderr || '',
      stdout: error?.stdout || '',
      message: error?.message || '',
    }),
  ]);

  if (hints.length === 0) {
    return error;
  }

  const enrichedError = error;
  enrichedError.hints = hints;
  const baseMessage = String(error?.message || `Remote command failed${host ? ` on ${host}` : ''}`)
    .split(/\n\nHints:\n/)[0]
    .trim();
  enrichedError.message = [
    baseMessage,
    '',
    'Hints:',
    ...hints.map((hint) => `- ${hint}`),
  ].join('\n');
  return enrichedError;
}

module.exports = {
  assertRemoteCommandPreflight,
  collectK3sCommandHints,
  enrichRemoteExecutionError,
  getRemoteCommandPreflight,
  hasKubectlSetAddBeforeSubcommand,
};
