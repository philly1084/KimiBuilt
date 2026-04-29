const path = require('path');
const { ToolBase } = require('../../ToolBase');
const { config } = require('../../../../config');
const settingsController = require('../../../../routes/admin/settings.controller');
const {
  buildGitCredentialEnvironment,
  normalizeGitHubRepositoryUrlForToken,
} = require('../../../../git-credentials');
const { SSHExecuteTool } = require('./SSHExecuteTool');
const { executeWithRunnerPreference } = require('../../../../remote-runner/transport');

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
        properties: {
          action: {
            type: 'string',
            enum: Array.from(ALLOWED_ACTIONS),
            description: 'Restricted remote k3s action to run over SSH. If omitted, the tool infers a safe default from the other parameters.',
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
    const action = this.inferAction(params);
    if (!ALLOWED_ACTIONS.has(action)) {
      throw new Error(`Unsupported k3s-deploy action '${action}'`);
    }

    const command = this.buildCommand(action, params);
    tracker.recordExecution(`k3s-deploy ${action}`, {
      command,
    });

    const commandParams = {
      host: params.host,
      port: params.port,
      username: params.username,
      command,
      environment: this.buildRemoteEnvironment(params),
      timeout: Math.max(1000, Number(params.timeoutSeconds || 180) * 1000),
      profile: 'deploy',
    };
    const result = await executeWithRunnerPreference({
      params: commandParams,
      context: {
        ...context,
        toolId: 'k3s-deploy',
      },
      tracker,
      fallback: () => this.sshTool.handler(commandParams, {
        ...context,
        skipRunner: true,
      }, tracker),
    });

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

  inferAction(params = {}) {
    const explicit = String(params.action || '').trim();
    if (explicit) {
      return explicit;
    }

    if (String(params.image || '').trim()) {
      return 'set-image';
    }

    if (String(params.repositoryUrl || '').trim() || String(params.ref || '').trim() || String(params.targetDirectory || '').trim()) {
      return 'sync-and-apply';
    }

    if (String(params.manifestsPath || '').trim()) {
      return 'apply-manifests';
    }

    if (String(params.deployment || '').trim() || String(params.namespace || '').trim()) {
      return 'rollout-status';
    }

    return 'sync-and-apply';
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
          this.buildRolloutStatusCommand(params),
        ].filter(Boolean).join('\n');
      default:
        throw new Error(`Unsupported k3s-deploy action '${action}'`);
    }
  }

  getDeployDefaults() {
    return typeof settingsController.getEffectiveDeployConfig === 'function'
      ? settingsController.getEffectiveDeployConfig()
      : {
        repositoryUrl: config.deploy.defaultRepositoryUrl || '',
        targetDirectory: config.deploy.defaultTargetDirectory || '',
        manifestsPath: config.deploy.defaultManifestsPath || 'k8s',
        namespace: config.deploy.defaultNamespace || 'kimibuilt',
        deployment: config.deploy.defaultDeployment || 'backend',
        container: config.deploy.defaultContainer || 'backend',
        branch: config.deploy.defaultBranch || 'master',
      };
  }

  buildSyncRepoCommand(params = {}) {
    const deployDefaults = this.getDeployDefaults();
    const repositoryUrl = this.normalizeRepositoryUrlForCredential(
      this.sanitizeRepositoryUrl(params.repositoryUrl || deployDefaults.repositoryUrl),
    );
    const ref = this.sanitizeRef(params.ref || deployDefaults.branch);
    const targetDirectory = this.sanitizeRemotePath(params.targetDirectory || deployDefaults.targetDirectory, 'targetDirectory');
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

  getGiteaDefaults() {
    return typeof settingsController.getEffectiveGiteaConfig === 'function'
      ? settingsController.getEffectiveGiteaConfig()
      : {};
  }

  buildRemoteEnvironment(params = {}) {
    const deployDefaults = this.getDeployDefaults();
    const repositoryUrl = String(params.repositoryUrl || deployDefaults.repositoryUrl || '').trim();
    const gitea = this.getGiteaDefaults();
    if (this.isConfiguredGiteaRepositoryUrl(repositoryUrl) && String(gitea.token || '').trim()) {
      return buildGitCredentialEnvironment(process.env, {
        GITEA_TOKEN: String(gitea.token || '').trim(),
        KIMIBUILT_GIT_USERNAME: String(gitea.username || gitea.registryUsername || process.env.GITEA_USERNAME || 'git').trim() || 'git',
        KIMIBUILT_GIT_PASSWORD: String(gitea.token || '').trim(),
      });
    }

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
      '      ingress-https.yaml)',
      '        if [ -f "$manifest_dir/ingress.yaml" ]; then continue; fi',
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
    const deployDefaults = this.getDeployDefaults();
    const namespace = this.sanitizeKubernetesName(params.namespace || deployDefaults.namespace, 'namespace');
    const deployment = this.sanitizeKubernetesName(params.deployment || deployDefaults.deployment, 'deployment');
    const container = this.sanitizeKubernetesName(params.container || deployDefaults.container, 'container');
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
    const deployDefaults = this.getDeployDefaults();
    const deployment = params.deployment || (options.allowDefaultDeployment ? deployDefaults.deployment : '');
    if (!deployment) {
      return '';
    }

    const namespace = this.sanitizeKubernetesName(params.namespace || deployDefaults.namespace, 'namespace');
    const sanitizedDeployment = this.sanitizeKubernetesName(deployment, 'deployment');
    const timeoutSeconds = this.normalizeTimeoutSeconds(params.timeoutSeconds);

    return [
      'set -e',
      'if ! command -v kubectl >/dev/null 2>&1; then echo "kubectl is required on the remote host" >&2; exit 1; fi',
      `kubectl rollout status deployment/${sanitizedDeployment} -n ${this.quoteShellArg(namespace)} --timeout=${timeoutSeconds}s`,
    ].join('\n');
  }

  resolveManifestsPath(params = {}) {
    const deployDefaults = this.getDeployDefaults();
    const manifestsPath = String(params.manifestsPath || deployDefaults.manifestsPath || '').trim();
    if (!manifestsPath) {
      throw new Error('k3s-deploy apply-manifests requires manifestsPath or KIMIBUILT_DEPLOY_MANIFESTS_PATH.');
    }

    if (path.posix.isAbsolute(manifestsPath)) {
      return this.sanitizeRemotePath(manifestsPath, 'manifestsPath');
    }

    const baseDirectory = String(params.targetDirectory || deployDefaults.targetDirectory || '').trim();
    if (!baseDirectory) {
      return this.sanitizeRemotePath(manifestsPath, 'manifestsPath');
    }

    return this.sanitizeRemotePath(path.posix.join(baseDirectory, manifestsPath), 'manifestsPath');
  }

  sanitizeRepositoryUrl(repositoryUrl = '') {
    const normalized = String(repositoryUrl || '').trim();
    if (!normalized) {
      throw new Error('k3s-deploy sync-repo requires a Git repository URL.');
    }

    if (!this.isAllowedRepositoryUrl(normalized)) {
      throw new Error(`Unsupported repository URL '${normalized}'. Only GitHub clone URLs or the configured Gitea host are allowed.`);
    }

    return normalized;
  }

  isAllowedRepositoryUrl(repositoryUrl = '') {
    return this.isGitHubRepositoryUrl(repositoryUrl)
      || this.isConfiguredGiteaRepositoryUrl(repositoryUrl);
  }

  isGitHubRepositoryUrl(repositoryUrl = '') {
    const normalized = String(repositoryUrl || '').trim();
    return /^(https:\/\/github\.com\/[^/\s]+\/[^/\s]+(?:\.git)?|git@github\.com:[^/\s]+\/[^/\s]+(?:\.git)?)$/i.test(normalized);
  }

  getConfiguredGiteaHost() {
    const gitea = this.getGiteaDefaults();
    const baseURL = String(gitea.baseURL || '').trim();
    if (!baseURL) {
      return '';
    }

    try {
      return new URL(baseURL).host.toLowerCase();
    } catch (_error) {
      return '';
    }
  }

  isConfiguredGiteaRepositoryUrl(repositoryUrl = '') {
    const normalized = String(repositoryUrl || '').trim();
    const giteaHost = this.getConfiguredGiteaHost();
    if (!normalized || !giteaHost) {
      return false;
    }

    try {
      const parsed = new URL(normalized);
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      return ['http:', 'https:', 'ssh:'].includes(parsed.protocol)
        && parsed.host.toLowerCase() === giteaHost
        && pathParts.length === 2
        && /^[^/\s]+(?:\.git)?$/i.test(pathParts[1]);
    } catch (_error) {
      const scpLike = normalized.match(/^git@([^:\s]+):([^/\s]+\/[^/\s]+(?:\.git)?)$/i);
      return Boolean(scpLike && scpLike[1].toLowerCase() === giteaHost);
    }
  }

  normalizeRepositoryUrlForCredential(repositoryUrl = '') {
    const normalized = String(repositoryUrl || '').trim();
    if (this.isGitHubRepositoryUrl(normalized)) {
      return normalizeGitHubRepositoryUrlForToken(normalized, process.env);
    }

    if (!this.isConfiguredGiteaRepositoryUrl(normalized)) {
      return normalized;
    }

    const gitea = this.getGiteaDefaults();
    if (!String(gitea.token || '').trim()) {
      return normalized;
    }

    const httpsBase = String(gitea.baseURL || '').trim().replace(/\/+$/, '');
    const repoPath = this.extractConfiguredGiteaRepoPath(normalized);
    return httpsBase && repoPath ? `${httpsBase}/${repoPath}` : normalized;
  }

  extractConfiguredGiteaRepoPath(repositoryUrl = '') {
    const normalized = String(repositoryUrl || '').trim();
    try {
      const parsed = new URL(normalized);
      return parsed.pathname.replace(/^\/+/, '');
    } catch (_error) {
      const scpLike = normalized.match(/^git@[^:\s]+:([^/\s]+\/[^/\s]+(?:\.git)?)$/i);
      return scpLike?.[1] || '';
    }
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
