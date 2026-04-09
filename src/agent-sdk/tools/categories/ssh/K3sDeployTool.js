const path = require('path');
const { ToolBase } = require('../../ToolBase');
const { config } = require('../../../../config');
const {
  buildGitCredentialEnvironment,
  normalizeGitHubRepositoryUrlForToken,
} = require('../../../../git-credentials');
const { SSHExecuteTool } = require('./SSHExecuteTool');

const ALLOWED_ACTIONS = new Set([
  'sync-repo',
  'apply-manifests',
  'set-image',
  'rollout-status',
  'sync-and-apply',
]);

class K3sDeployTool extends ToolBase {
  constructor() {
    super({
      id: 'k3s-deploy',
      name: 'K3s Deploy',
      description: 'Restricted k3s deployment actions over SSH for syncing a GitHub repo, applying manifests, and checking rollouts',
      category: 'ssh',
      version: '1.0.0',
      backend: {
        sideEffects: ['network', 'execute'],
        sandbox: { network: true },
        timeout: 120000,
      },
      inputSchema: {
        type: 'object',
        required: ['action'],
        properties: {
          action: {
            type: 'string',
            enum: Array.from(ALLOWED_ACTIONS),
            description: 'Restricted remote k3s action to run over SSH',
          },
          repositoryUrl: {
            type: 'string',
            description: 'GitHub repository URL for sync-repo or sync-and-apply.',
          },
          ref: {
            type: 'string',
            description: 'Branch, tag, or revision to deploy. Defaults to KIMIBUILT_DEPLOY_BRANCH or master.',
          },
          targetDirectory: {
            type: 'string',
            description: 'Remote checkout directory for sync actions.',
          },
          manifestsPath: {
            type: 'string',
            description: 'Remote manifests path or relative path inside targetDirectory. Defaults to k8s.',
          },
          namespace: {
            type: 'string',
            description: 'Kubernetes namespace. Defaults to kimibuilt.',
          },
          deployment: {
            type: 'string',
            description: 'Deployment name for set-image or rollout-status.',
          },
          container: {
            type: 'string',
            description: 'Container name for set-image.',
          },
          image: {
            type: 'string',
            description: 'Container image for set-image.',
          },
          timeoutSeconds: {
            type: 'integer',
            default: 180,
            description: 'Rollout timeout in seconds.',
          },
          host: {
            type: 'string',
            description: 'Override SSH host. Defaults to configured SSH target.',
          },
          port: {
            type: 'integer',
            description: 'Override SSH port. Defaults to configured SSH target.',
          },
          username: {
            type: 'string',
            description: 'Override SSH username. Defaults to configured SSH target.',
          },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          command: { type: 'string' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          exitCode: { type: 'integer' },
          host: { type: 'string' },
          duration: { type: 'integer' },
        },
      },
    });

    this.sshTool = new SSHExecuteTool({
      id: 'ssh-execute-internal',
      name: 'SSH Internal',
      description: 'Internal SSH helper for k3s deploy operations',
    });
  }

  async handler(params, context, tracker) {
    const action = String(params.action || '').trim();
    if (!ALLOWED_ACTIONS.has(action)) {
      throw new Error(`Unsupported k3s-deploy action '${action}'`);
    }

    const command = this.buildCommand(action, params);
    tracker.recordExecution(`k3s-deploy ${action}`, {
      command,
    });

    const result = await this.sshTool.handler({
      host: params.host,
      port: params.port,
      username: params.username,
      command,
      environment: this.buildRemoteEnvironment(),
      timeout: Math.max(1000, Number(params.timeoutSeconds || 180) * 1000),
    }, context, tracker);

    return {
      action,
      command,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      host: result.host,
      duration: result.duration,
    };
  }

  buildCommand(action, params = {}) {
    switch (action) {
      case 'sync-repo':
        return this.buildSyncRepoCommand(params);
      case 'apply-manifests':
        return this.buildApplyManifestsCommand(params);
      case 'set-image':
        return this.buildSetImageCommand(params);
      case 'rollout-status':
        return this.buildRolloutStatusCommand(params);
      case 'sync-and-apply':
        return [
          this.buildSyncRepoCommand(params),
          this.buildApplyManifestsCommand(params),
          this.buildRolloutStatusCommand(params, { allowDefaultDeployment: true }),
        ].filter(Boolean).join('\n');
      default:
        throw new Error(`Unsupported k3s-deploy action '${action}'`);
    }
  }

  buildSyncRepoCommand(params = {}) {
    const repositoryUrl = normalizeGitHubRepositoryUrlForToken(
      this.sanitizeRepositoryUrl(params.repositoryUrl || config.deploy.defaultRepositoryUrl),
      process.env,
    );
    const ref = this.sanitizeRef(params.ref || config.deploy.defaultBranch);
    const targetDirectory = this.sanitizeRemotePath(params.targetDirectory || config.deploy.defaultTargetDirectory, 'targetDirectory');
    const parentDirectory = path.posix.dirname(targetDirectory);

    return [
      'set -e',
      'if ! command -v git >/dev/null 2>&1; then echo "git is required on the remote host" >&2; exit 1; fi',
      ...this.buildRemoteGitCredentialSetup(),
      `mkdir -p ${this.quoteShellArg(parentDirectory)}`,
      `if [ ! -d ${this.quoteShellArg(`${targetDirectory}/.git`)} ]; then`,
      `  git clone --branch ${this.quoteShellArg(ref)} --single-branch ${this.quoteShellArg(repositoryUrl)} ${this.quoteShellArg(targetDirectory)}`,
      'fi',
      `cd -- ${this.quoteShellArg(targetDirectory)}`,
      `git remote set-url origin ${this.quoteShellArg(repositoryUrl)}`,
      'git fetch --prune origin',
      `if git show-ref --verify --quiet refs/remotes/origin/${this.sanitizeGitRefForShell(ref)}; then`,
      `  git checkout -B ${this.quoteShellArg(ref)} ${this.quoteShellArg(`origin/${ref}`)}`,
      'else',
      `  git checkout ${this.quoteShellArg(ref)}`,
      'fi',
      'git status --short --branch',
    ].join('\n');
  }

  buildRemoteEnvironment() {
    return buildGitCredentialEnvironment(process.env);
  }

  buildRemoteGitCredentialSetup() {
    return [
      'if [ -n "${KIMIBUILT_GIT_PASSWORD:-${GH_TOKEN:-${GITHUB_TOKEN:-}}}" ]; then',
      '  git_askpass_dir=$(mktemp -d)',
      '  git_askpass_script="$git_askpass_dir/askpass.sh"',
      '  cat > "$git_askpass_script" <<\'EOF\'',
      '#!/bin/sh',
      'case "$1" in',
      '  *Username*|*username*)',
      '    printf "%s" "${KIMIBUILT_GIT_USERNAME:-x-access-token}"',
      '    ;;',
      '  *)',
      '    printf "%s" "${KIMIBUILT_GIT_PASSWORD:-${GH_TOKEN:-${GITHUB_TOKEN:-}}}"',
      '    ;;',
      'esac',
      'EOF',
      '  chmod 700 "$git_askpass_script"',
      '  export GIT_ASKPASS="$git_askpass_script"',
      '  export GIT_TERMINAL_PROMPT=0',
      '  export GCM_INTERACTIVE=Never',
      '  trap \'rm -rf "$git_askpass_dir"\' EXIT',
      'fi',
    ];
  }

  buildApplyManifestsCommand(params = {}) {
    const manifestsPath = this.resolveManifestsPath(params);

    return [
      'set -e',
      'if ! command -v kubectl >/dev/null 2>&1; then echo "kubectl is required on the remote host" >&2; exit 1; fi',
      `manifest_target=${this.quoteShellArg(manifestsPath)}`,
      'if [ -d "$manifest_target" ]; then',
      '  manifest_dir="$manifest_target"',
      '  if [ -f "$manifest_dir/namespace.yaml" ]; then kubectl apply -f "$manifest_dir/namespace.yaml"; fi',
      '  if [ -f "$manifest_dir/cluster-issuer.yaml" ]; then kubectl apply -f "$manifest_dir/cluster-issuer.yaml"; fi',
      '  for manifest_file in $(find "$manifest_dir" -maxdepth 1 -type f \\( -name "*.yaml" -o -name "*.yml" \\) | sort); do',
      '    manifest_name=$(basename "$manifest_file")',
      '    case "$manifest_name" in',
      '      namespace.yaml|cluster-issuer.yaml|secret.yaml|rancher-simple.yaml|rancher-stack-update.yaml)',
      '        continue',
      '        ;;',
      '    esac',
      '    kubectl apply -f "$manifest_file"',
      '  done',
      'else',
      '  kubectl apply -f "$manifest_target"',
      'fi',
    ].join('\n');
  }

  buildSetImageCommand(params = {}) {
    const namespace = this.sanitizeKubernetesName(params.namespace || config.deploy.defaultNamespace, 'namespace');
    const deployment = this.sanitizeKubernetesName(params.deployment || config.deploy.defaultDeployment, 'deployment');
    const container = this.sanitizeKubernetesName(params.container || config.deploy.defaultContainer, 'container');
    const image = this.sanitizeImage(params.image);
    const timeoutSeconds = this.normalizeTimeoutSeconds(params.timeoutSeconds);

    return [
      'set -e',
      'if ! command -v kubectl >/dev/null 2>&1; then echo "kubectl is required on the remote host" >&2; exit 1; fi',
      `kubectl set image deployment/${deployment} ${container}=${this.quoteShellArg(image)} -n ${this.quoteShellArg(namespace)}`,
      `kubectl rollout status deployment/${deployment} -n ${this.quoteShellArg(namespace)} --timeout=${timeoutSeconds}s`,
    ].join('\n');
  }

  buildRolloutStatusCommand(params = {}, options = {}) {
    const deployment = params.deployment || (options.allowDefaultDeployment ? config.deploy.defaultDeployment : '');
    if (!deployment) {
      return '';
    }

    const namespace = this.sanitizeKubernetesName(params.namespace || config.deploy.defaultNamespace, 'namespace');
    const sanitizedDeployment = this.sanitizeKubernetesName(deployment, 'deployment');
    const timeoutSeconds = this.normalizeTimeoutSeconds(params.timeoutSeconds);

    return [
      'set -e',
      'if ! command -v kubectl >/dev/null 2>&1; then echo "kubectl is required on the remote host" >&2; exit 1; fi',
      `kubectl rollout status deployment/${sanitizedDeployment} -n ${this.quoteShellArg(namespace)} --timeout=${timeoutSeconds}s`,
    ].join('\n');
  }

  resolveManifestsPath(params = {}) {
    const manifestsPath = String(params.manifestsPath || config.deploy.defaultManifestsPath || '').trim();
    if (!manifestsPath) {
      throw new Error('k3s-deploy apply-manifests requires manifestsPath or KIMIBUILT_DEPLOY_MANIFESTS_PATH.');
    }

    if (path.posix.isAbsolute(manifestsPath)) {
      return this.sanitizeRemotePath(manifestsPath, 'manifestsPath');
    }

    const baseDirectory = String(params.targetDirectory || config.deploy.defaultTargetDirectory || '').trim();
    if (!baseDirectory) {
      return this.sanitizeRemotePath(manifestsPath, 'manifestsPath');
    }

    return this.sanitizeRemotePath(path.posix.join(baseDirectory, manifestsPath), 'manifestsPath');
  }

  sanitizeRepositoryUrl(repositoryUrl = '') {
    const normalized = String(repositoryUrl || '').trim();
    if (!normalized) {
      throw new Error('k3s-deploy sync-repo requires a GitHub repository URL.');
    }

    const githubPattern = /^(https:\/\/github\.com\/[^/\s]+\/[^/\s]+(?:\.git)?|git@github\.com:[^/\s]+\/[^/\s]+(?:\.git)?)$/i;
    if (!githubPattern.test(normalized)) {
      throw new Error(`Unsupported repository URL '${normalized}'. Only GitHub clone URLs are allowed.`);
    }

    return normalized;
  }

  sanitizeRef(ref = '') {
    const normalized = String(ref || '').trim();
    if (!normalized) {
      throw new Error('k3s-deploy requires a non-empty ref or branch.');
    }
    if (!/^[A-Za-z0-9._/-]+$/.test(normalized)) {
      throw new Error(`Invalid git ref '${normalized}'.`);
    }
    return normalized;
  }

  sanitizeGitRefForShell(ref = '') {
    return String(ref || '').replace(/[^A-Za-z0-9._/-]/g, '');
  }

  sanitizeRemotePath(value = '', fieldName = 'path') {
    const normalized = String(value || '').trim();
    if (!normalized) {
      throw new Error(`k3s-deploy requires ${fieldName}.`);
    }
    if (/[`\r\n]/.test(normalized)) {
      throw new Error(`Invalid ${fieldName} '${normalized}'.`);
    }
    return normalized.replace(/\\/g, '/');
  }

  sanitizeKubernetesName(value = '', fieldName = 'name') {
    const normalized = String(value || '').trim();
    if (!normalized) {
      throw new Error(`k3s-deploy requires ${fieldName}.`);
    }
    if (!/^[a-z0-9]([-.a-z0-9]*[a-z0-9])?$/i.test(normalized)) {
      throw new Error(`Invalid ${fieldName} '${normalized}'.`);
    }
    return normalized;
  }

  sanitizeImage(image = '') {
    const normalized = String(image || '').trim();
    if (!normalized) {
      throw new Error('k3s-deploy set-image requires an image value.');
    }
    if (/[`\r\n]/.test(normalized)) {
      throw new Error(`Invalid image '${normalized}'.`);
    }
    return normalized;
  }

  normalizeTimeoutSeconds(timeoutSeconds) {
    return Math.max(30, Math.min(Number(timeoutSeconds) || 180, 1800));
  }

  quoteShellArg(value) {
    return `'${String(value || '').replace(/'/g, `'"'"'`)}'`;
  }
}

module.exports = { K3sDeployTool };
