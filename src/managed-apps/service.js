'use strict';

const { createHash } = require('crypto');
const { config } = require('../config');
const settingsController = require('../routes/admin/settings.controller');
const { clusterStateRegistry } = require('../cluster-state-registry');
const { broadcastToAdmins, broadcastToSession } = require('../realtime-hub');
const { createResponse } = require('../openai-client');
const { extractResponseText } = require('../artifacts/artifact-service');
const { parseLenientJson } = require('../utils/lenient-json');
const { buildProjectMemoryUpdate, mergeProjectMemory } = require('../project-memory');
const { sessionStore } = require('../session-store');
const { managedAppStore } = require('./store');
const { GiteaClient } = require('./gitea-client');
const { KubernetesClient } = require('./kubernetes-client');
const {
    buildDefaultScaffoldFiles,
    buildManagedAppAuthoringPrompt,
    normalizeGeneratedManagedAppSourceFiles,
} = require('./scaffold');

function normalizeText(value = '') {
    return String(value || '').trim();
}

function normalizeManagedAppWebhookBaseUrl(value = '') {
    const normalized = normalizeText(value).replace(/\/+$/, '');
    if (!normalized) {
        return '';
    }

    try {
        const parsed = new URL(normalized);
        const pathnameSegments = String(parsed.pathname || '')
            .split('/')
            .filter(Boolean);

        while (pathnameSegments.length > 0) {
            const tail = String(pathnameSegments[pathnameSegments.length - 1] || '').trim().toLowerCase();
            if (tail === 'v1' || tail === 'api') {
                pathnameSegments.pop();
                continue;
            }
            break;
        }

        parsed.pathname = pathnameSegments.length > 0
            ? `/${pathnameSegments.join('/')}`
            : '';
        parsed.search = '';
        parsed.hash = '';

        return parsed.toString().replace(/\/+$/, '');
    } catch (_error) {
        return normalized;
    }
}

const MAX_MANAGED_APP_SLUG_LENGTH = 63;
const MAX_KUBERNETES_NAME_LENGTH = 63;
const DEFAULT_GITEA_RUNNER_LABELS = 'ubuntu-latest:host';
const DEFAULT_MANAGED_APP_SLUG_PREFIX = 'managed-app';
const PROMPT_NAME_STOPWORDS = new Set([
    'a', 'an', 'and', 'app', 'application', 'build', 'built', 'called', 'can', 'could', 'create', 'deploy',
    'deployment', 'for', 'from', 'generate', 'help', 'host', 'hosting', 'i', 'in', 'into', 'it', 'just',
    'like', 'make', 'managed', 'me', 'my', 'named', 'need', 'on', 'our', 'ours', 'page', 'please', 'project',
    'put', 'really', 'remote', 'repo', 'repository', 'server', 'servers', 'service', 'should', 'simple',
    'site', 'something', 'stuff', 'that', 'the', 'this', 'to', 'tool', 'too', 'use', 'using', 'us', 'want',
    'we', 'website', 'will', 'with', 'would', 'you', 'your',
]);

function baseSlugify(value = '') {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');
}

function truncateSlug(value = '', maxLength = 0) {
    const normalized = baseSlugify(value);
    if (!normalized || !Number.isFinite(Number(maxLength)) || Number(maxLength) <= 0 || normalized.length <= Number(maxLength)) {
        return normalized;
    }

    const limit = Number(maxLength);
    if (limit <= 8) {
        return normalized.slice(0, limit).replace(/-+$/g, '');
    }

    const suffix = createHash('sha1').update(normalized).digest('hex').slice(0, 6);
    const prefixLimit = Math.max(1, limit - suffix.length - 1);
    const prefix = normalized.slice(0, prefixLimit).replace(/-+$/g, '') || normalized.slice(0, prefixLimit);
    return `${prefix}-${suffix}`.replace(/^-+|-+$/g, '');
}

function slugify(value = '', options = {}) {
    const maxLength = Number(options.maxLength) || 0;
    return maxLength > 0
        ? truncateSlug(value, maxLength)
        : baseSlugify(value);
}

function extractExplicitAppName(value = '') {
    const normalized = normalizeText(value);
    if (!normalized) {
        return '';
    }

    const patterns = [
        /\b(?:managed\s+app|application|app|site|website|project|game|repo(?:sitory)?)\s+(?:called|named)\s+["'`]?([^"'`\n.,!?;:]+)["'`]?/i,
        /\b(?:called|named)\s+["'`]?([^"'`\n.,!?;:]+)["'`]?/i,
    ];

    for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (!match?.[1]) {
            continue;
        }

        const candidate = normalizeText(match[1])
            .replace(/\s+(?:that|which|with|for)\b.*$/i, '')
            .replace(/["'`]+$/g, '');
        if (candidate) {
            return candidate;
        }
    }

    return '';
}

function summarizePromptName(value = '') {
    const normalized = normalizeText(value);
    if (!normalized) {
        return '';
    }

    const tokens = normalized
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
    if (tokens.length === 0) {
        return '';
    }

    const meaningful = tokens.filter((token) => !PROMPT_NAME_STOPWORDS.has(token));
    if (meaningful.length === 0) {
        return '';
    }

    const selected = meaningful.slice(0, 6);
    return selected.join(' ');
}

function deriveRequestedAppName(input = {}) {
    return normalizeText(
        input.appName
        || input.name
        || input.title
        || input.slug
        || input.repoName
        || extractExplicitAppName(input.prompt || input.sourcePrompt || '')
        || summarizePromptName(input.prompt || input.sourcePrompt || ''),
    );
}

function buildFallbackRequestedAppName() {
    return `${DEFAULT_MANAGED_APP_SLUG_PREFIX}-${Date.now()}`;
}

function titleizeSlug(value = '') {
    return normalizeText(value)
        .split('-')
        .filter(Boolean)
        .map((entry) => entry.charAt(0).toUpperCase() + entry.slice(1))
        .join(' ');
}

function normalizeAppStatus(value = '') {
    const normalized = normalizeText(value).toLowerCase();
    return normalized || 'draft';
}

function normalizeBuildStatus(value = '') {
    const normalized = normalizeText(value).toLowerCase();
    return normalized || 'queued';
}

function normalizeRequestedAction(value = '') {
    const normalized = normalizeText(value).toLowerCase();
    return normalized || 'build';
}

function inferDeployRequested(value = '', fallback = false) {
    const normalized = normalizeRequestedAction(value);
    if (!normalized) {
        return fallback;
    }

    return ['deploy', 'publish', 'live', 'launch', 'release'].includes(normalized);
}

function normalizeFilesInput(files = []) {
    return (Array.isArray(files) ? files : [])
        .filter((entry) => entry && typeof entry === 'object' && normalizeText(entry.path))
        .map((entry) => ({
            path: normalizeText(entry.path),
            content: String(entry.content || ''),
        }));
}

function createManagedAppLlmClient() {
    return {
        complete: async (prompt, options = {}) => {
            const response = await createResponse({
                input: prompt,
                stream: false,
                model: options.model || null,
                reasoningEffort: options.reasoningEffort || null,
            });
            return extractResponseText(response);
        },
    };
}

function mergeRepositoryFiles(baseFiles = [], overrideFiles = []) {
    const merged = new Map();

    (Array.isArray(baseFiles) ? baseFiles : []).forEach((entry) => {
        if (!entry || typeof entry !== 'object' || !normalizeText(entry.path)) {
            return;
        }
        merged.set(normalizeText(entry.path), {
            path: normalizeText(entry.path),
            content: String(entry.content || ''),
        });
    });

    (Array.isArray(overrideFiles) ? overrideFiles : []).forEach((entry) => {
        if (!entry || typeof entry !== 'object' || !normalizeText(entry.path)) {
            return;
        }
        merged.set(normalizeText(entry.path), {
            path: normalizeText(entry.path),
            content: String(entry.content || ''),
        });
    });

    return Array.from(merged.values()).sort((left, right) => left.path.localeCompare(right.path));
}

function buildImageTagFromCommit(commitSha = '') {
    const normalized = normalizeText(commitSha);
    return normalized ? `sha-${normalized.slice(0, 12)}` : '';
}

function extractHostFromUrl(value = '') {
    const normalized = normalizeText(value);
    if (!normalized) {
        return '';
    }

    try {
        return normalizeText(new URL(normalized).host);
    } catch (_error) {
        return '';
    }
}

function normalizeImageRepo(value = '') {
    return normalizeText(value)
        .replace(/^https?:\/\//i, '')
        .replace(/\/+$/, '');
}

function isUsableImageRepo(value = '') {
    const normalized = normalizeImageRepo(value);
    if (!normalized) {
        return false;
    }

    const segments = normalized.split('/').filter(Boolean);
    if (segments.length < 3) {
        return false;
    }

    return segments.every((segment) => normalizeText(segment).toLowerCase() !== 'undefined');
}

function resolveManagedAppRegistryHost(giteaConfig = {}, app = {}) {
    return normalizeText(giteaConfig.registryHost)
        || extractHostFromUrl(giteaConfig.baseURL)
        || extractHostFromUrl(app.repoUrl)
        || extractHostFromUrl(app.repoCloneUrl)
        || '';
}

function resolveManagedAppImageRepo(input = {}, giteaConfig = {}) {
    const explicit = normalizeImageRepo(input.imageRepo);
    if (isUsableImageRepo(explicit)) {
        return explicit;
    }

    const repoOwner = normalizeText(input.repoOwner || giteaConfig.org);
    const repoName = normalizeText(input.repoName || input.slug);
    const registryHost = resolveManagedAppRegistryHost(giteaConfig, input);
    if (!registryHost || !repoOwner || !repoName) {
        return '';
    }

    const derived = normalizeImageRepo(`${registryHost}/${repoOwner}/${repoName}`);
    return isUsableImageRepo(derived) ? derived : '';
}

function hasPersistedAppId(app = null) {
    return Boolean(normalizeText(app?.id));
}

function parseManagedAppRepoReference(value = '') {
    const normalized = normalizeText(value);
    if (!normalized || !normalized.includes('/')) {
        return null;
    }

    const [repoOwner, repoName, ...rest] = normalized.split('/').map((entry) => normalizeText(entry));
    if (rest.length > 0 || !repoOwner || !repoName) {
        return null;
    }

    return {
        repoOwner,
        repoName,
    };
}

function normalizeDeployTarget(value = '') {
    const normalized = normalizeText(value).toLowerCase();
    if (['ssh', 'remote', 'remote-ssh', 'remote_ssh'].includes(normalized)) {
        return 'ssh';
    }
    if (['in-cluster', 'in_cluster', 'cluster', 'local-cluster', 'local_cluster'].includes(normalized)) {
        return 'ssh';
    }
    return '';
}

function normalizeNamespacePrefix(value = 'app-') {
    const stem = baseSlugify(String(value || '').replace(/-+$/g, ''));
    return stem ? `${stem}-` : 'app-';
}

function normalizeManagedAppNamespace(value = '', { slug = '', namespacePrefix = 'app-' } = {}) {
    const prefix = normalizeNamespacePrefix(namespacePrefix);
    const normalizedValue = slugify(value || '', {
        maxLength: MAX_KUBERNETES_NAME_LENGTH,
    });
    if (normalizedValue && normalizedValue.startsWith(prefix)) {
        return normalizedValue;
    }

    const normalizedSlug = slugify(slug || '', {
        maxLength: Math.max(1, MAX_KUBERNETES_NAME_LENGTH - prefix.length),
    });
    const shouldUseSlug = normalizedSlug && (
        !normalizedValue
        || normalizedValue === 'managed-app'
        || normalizedValue === 'managed-apps'
        || normalizedValue === 'default'
    );
    const base = shouldUseSlug
        ? normalizedSlug
        : (normalizedValue || normalizedSlug || 'managed-app');
    return slugify(`${prefix}${base}`, {
        maxLength: MAX_KUBERNETES_NAME_LENGTH,
    });
}

function getDeploymentStatus(report = {}, name = '') {
    const deployment = report?.deployments?.[name];
    if (deployment && typeof deployment === 'object') {
        return deployment;
    }

    return {
        name,
        present: false,
        desiredReplicas: 0,
        readyReplicas: 0,
        availableReplicas: 0,
        updatedReplicas: 0,
        ready: false,
    };
}

function isDeploymentReady(deployment = {}) {
    return Boolean(
        deployment.present
        && Number(deployment.readyReplicas || 0) >= Math.max(1, Number(deployment.desiredReplicas || 0)),
    );
}

function formatDeploymentSummary(deployment = {}, fallbackName = '') {
    const name = normalizeText(deployment.name || fallbackName || 'deployment');
    if (!deployment.present) {
        return `${name} missing`;
    }

    return `${name} ${Number(deployment.readyReplicas || 0)}/${Number(deployment.desiredReplicas || 0)} ready`;
}

function buildPlatformDoctorSuggestions(report = {}) {
    const suggestions = [];
    const platformNamespace = normalizeText(report.platformNamespace || 'agent-platform');
    const gitea = getDeploymentStatus(report, 'gitea');
    const buildkitd = getDeploymentStatus(report, 'buildkitd');
    const actRunner = getDeploymentStatus(report, 'act-runner');
    const runnerTokenState = normalizeText(report.runnerTokenState || 'unknown').toLowerCase();
    const runnerLabels = normalizeText(report.runnerLabels);
    const runnerLogText = (Array.isArray(report.runnerLogExcerpt) ? report.runnerLogExcerpt : []).join('\n').toLowerCase();

    if (!report.namespaceExists) {
        suggestions.push(`Remote platform namespace \`${platformNamespace}\` is missing on the SSH target. Apply the agent-platform manifest there or correct the managed-app platform namespace setting.`);
        return suggestions;
    }

    if (!isDeploymentReady(gitea)) {
        suggestions.push(`Gitea is not ready in \`${platformNamespace}\` (${formatDeploymentSummary(gitea, 'gitea')}).`);
    }

    if (!isDeploymentReady(buildkitd)) {
        suggestions.push(`BuildKit is not ready in \`${platformNamespace}\` (${formatDeploymentSummary(buildkitd, 'buildkitd')}).`);
    }

    if (!actRunner.present) {
        suggestions.push(`The \`act-runner\` deployment is missing from \`${platformNamespace}\`. The remote Gitea runner stack is incomplete, so Actions will stay waiting.`);
    } else if (Number(actRunner.desiredReplicas || 0) === 0) {
        suggestions.push('`act-runner` is scaled to `0`. Replace the real runner registration token in `gitea-actions`, then scale `act-runner` to `1`.');
    } else if (!isDeploymentReady(actRunner)) {
        suggestions.push(`\`act-runner\` exists but is not ready (${formatDeploymentSummary(actRunner, 'act-runner')}). Check the runner pod logs on the remote cluster.`);
    }

    if (runnerTokenState === 'missing-secret') {
        suggestions.push(`Secret \`gitea-actions\` is missing from \`${platformNamespace}\`. The runner cannot register without \`runner-registration-token\`.`);
    } else if (runnerTokenState === 'missing') {
        suggestions.push('Secret `gitea-actions` exists, but `runner-registration-token` is empty or unreadable.');
    } else if (runnerTokenState === 'placeholder') {
        suggestions.push('`runner-registration-token` still has a placeholder value. Replace it with a real runner registration token from this Gitea instance.');
    }

    if (actRunner.present && isDeploymentReady(actRunner) && runnerLabels) {
        suggestions.push(`If workflows are still waiting, confirm the runner is attached in Gitea and advertises the label \`${runnerLabels}\`.`);
    }

    if (/\bunauthorized\b|\bforbidden\b|\binvalid\b|\btoken\b/.test(runnerLogText)) {
        suggestions.push('The runner log excerpt points at a registration or token problem. Reissue the runner registration token from Gitea and update `gitea-actions`.');
    }

    if (/\bcannot find:\s*node in path\b/.test(runnerLogText)) {
        suggestions.push('This runner does not have Node in host mode. Managed-app workflows should avoid JavaScript-based actions like `actions/checkout`, or the runner image must be extended to include Node.');
    }

    if (runnerLabels && !/\bubuntu-latest\b/i.test(runnerLabels)) {
        suggestions.push(`The runner labels are currently \`${runnerLabels}\`. The managed-app workflow expects an \`ubuntu-latest\` compatible label.`);
    }

    return Array.from(new Set(suggestions.filter(Boolean)));
}

function buildPlatformDoctorMessage(report = {}, healthy = false) {
    const host = normalizeText(report.executionHost || 'remote ssh target');
    const platformNamespace = normalizeText(report.platformNamespace || 'agent-platform');
    const gitea = getDeploymentStatus(report, 'gitea');
    const buildkitd = getDeploymentStatus(report, 'buildkitd');
    const actRunner = getDeploymentStatus(report, 'act-runner');
    const runnerTokenState = normalizeText(report.runnerTokenState || 'unknown');
    const labels = normalizeText(report.runnerLabels);

    return [
        `Managed app platform on ${host}:`,
        `namespace ${platformNamespace} ${report.namespaceExists ? 'present' : 'missing'}`,
        formatDeploymentSummary(gitea, 'gitea'),
        formatDeploymentSummary(buildkitd, 'buildkitd'),
        formatDeploymentSummary(actRunner, 'act-runner'),
        `runner token ${runnerTokenState || 'unknown'}`,
        labels ? `runner labels ${labels}` : '',
        healthy ? 'platform healthy' : 'platform needs attention',
    ].filter(Boolean).join('; ');
}

function isPlatformHealthy(report = {}) {
    return Boolean(
        report.namespaceExists
        && isDeploymentReady(getDeploymentStatus(report, 'gitea'))
        && isDeploymentReady(getDeploymentStatus(report, 'buildkitd'))
        && isDeploymentReady(getDeploymentStatus(report, 'act-runner'))
        && normalizeText(report.runnerTokenState).toLowerCase() === 'present',
    );
}

function normalizeRunnerRecords(payload = {}) {
    const runners = Array.isArray(payload?.runners) ? payload.runners : [];
    return runners.map((runner) => ({
        id: runner?.id,
        name: normalizeText(runner?.name),
        status: normalizeText(runner?.status).toLowerCase(),
        disabled: runner?.disabled === true,
        busy: runner?.busy === true,
        labels: (Array.isArray(runner?.labels) ? runner.labels : [])
            .map((label) => normalizeText(label?.name || label))
            .filter(Boolean),
    }));
}

function buildLifecycleMessageKey(app = null, buildRun = null, phase = '') {
    const appId = normalizeText(app?.id || app?.slug || 'managed-app');
    const buildRunId = normalizeText(buildRun?.id);
    const normalizedPhase = normalizeText(phase).toLowerCase();

    if (['created', 'updated'].includes(normalizedPhase)) {
        return `managed-app:${appId}:provisioning`;
    }

    return `managed-app:${appId}:${buildRunId || 'lifecycle'}`;
}

function buildManagedAppStatusSummary(app = null, buildRun = null, phase = '', deployment = null) {
    const appName = normalizeText(app?.appName || app?.slug || 'Managed app');
    const publicUrl = normalizeText(app?.publicHost) ? `https://${normalizeText(app.publicHost)}` : '';
    const repoRef = normalizeText(app?.repoOwner) && normalizeText(app?.repoName)
        ? `${normalizeText(app.repoOwner)}/${normalizeText(app.repoName)}`
        : '';
    const imageRef = normalizeText(app?.metadata?.liveDeploy?.lastImage || app?.metadata?.lastImage || deployment?.image || '');
    const buildError = normalizeText(
        buildRun?.error?.message
        || buildRun?.metadata?.payload?.error
        || buildRun?.metadata?.payload?.message
        || app?.metadata?.liveDeploy?.lastError
        || deployment?.rollout?.error
        || deployment?.https?.error,
    );

    switch (normalizeText(phase).toLowerCase()) {
        case 'created':
            return `${appName} was created${repoRef ? ` in ${repoRef}` : ''}. Build and deploy are queued.`;
        case 'updated':
            return `${appName} was updated${repoRef ? ` in ${repoRef}` : ''}. Build and deploy are queued.`;
        case 'built':
            return `${appName} finished building${imageRef ? ` as \`${imageRef}\`` : ''}.`;
        case 'build_failed':
            return `${appName} build failed${buildError ? `: ${buildError}` : '.'}`;
        case 'deploying':
            return `${appName} is deploying${publicUrl ? ` to ${publicUrl}` : ''}. Waiting for rollout and TLS.`;
        case 'live':
            return `${appName} is live${publicUrl ? ` at ${publicUrl}` : ''}. HTTPS is responding.`;
        case 'tls_ready':
            return `${appName} is deployed${publicUrl ? ` at ${publicUrl}` : ''}. TLS is ready; waiting for public HTTPS to respond.`;
        case 'pending_https':
            return `${appName} rollout succeeded${publicUrl ? ` at ${publicUrl}` : ''}, but public HTTPS is not ready yet.`;
        case 'deploy_failed':
            return `${appName} deployment failed${buildError ? `: ${buildError}` : '.'}`;
        case 'deployed':
            return `${appName} was deployed${publicUrl ? ` to ${publicUrl}` : ''}.`;
        default:
            return `${appName} status changed to ${normalizeText(phase) || 'updated'}.`;
    }
}

function hasOwnInput(input = {}, key = '') {
    return Boolean(input && Object.prototype.hasOwnProperty.call(input, key));
}

function hasAnyOwnInput(input = {}, keys = []) {
    return (Array.isArray(keys) ? keys : []).some((key) => hasOwnInput(input, key));
}

function normalizeStringArray(values = [], limit = 8) {
    const seen = new Set();
    return (Array.isArray(values) ? values : [])
        .map((value) => normalizeText(typeof value === 'string' ? value : value?.summary || value?.value || value?.text || ''))
        .filter((value) => {
            if (!value || seen.has(value.toLowerCase())) {
                return false;
            }
            seen.add(value.toLowerCase());
            return true;
        })
        .slice(0, Math.max(1, Number(limit) || 8));
}

function normalizeComparableName(value = '') {
    return baseSlugify(value || '').replace(/-/g, '');
}

function valuesLooselyMatch(left = '', right = '') {
    const normalizedLeft = normalizeComparableName(left);
    const normalizedRight = normalizeComparableName(right);
    if (!normalizedLeft || !normalizedRight) {
        return false;
    }
    return normalizedLeft === normalizedRight
        || normalizedLeft.includes(normalizedRight)
        || normalizedRight.includes(normalizedLeft);
}

function mergeMetadataSection(base = {}, updates = {}) {
    return {
        ...(base && typeof base === 'object' ? base : {}),
        ...(updates && typeof updates === 'object' ? updates : {}),
    };
}

function normalizeManagedAppMetadata(metadata = {}, app = {}, options = {}) {
    const source = metadata && typeof metadata === 'object' ? metadata : {};
    const deployConfig = options.deployConfig && typeof options.deployConfig === 'object'
        ? options.deployConfig
        : {};
    const managedAppsConfig = options.managedAppsConfig && typeof options.managedAppsConfig === 'object'
        ? options.managedAppsConfig
        : {};
    const project = source.project && typeof source.project === 'object' ? source.project : {};
    const repoState = source.repoState && typeof source.repoState === 'object' ? source.repoState : {};
    const desiredDeploy = source.desiredDeploy && typeof source.desiredDeploy === 'object' ? source.desiredDeploy : {};
    const liveDeploy = source.liveDeploy && typeof source.liveDeploy === 'object' ? source.liveDeploy : {};
    const containerPort = Number(
        desiredDeploy.containerPort
        || source.requestedContainerPort
        || managedAppsConfig.defaultContainerPort
        || 80
    );
    const normalizedContainerPort = Number.isFinite(containerPort) && containerPort > 0 ? containerPort : 80;

    return {
        ...source,
        project: {
            summary: normalizeText(project.summary),
            currentObjective: normalizeText(project.currentObjective || app?.sourcePrompt),
            nextStep: normalizeText(project.nextStep),
            openItems: normalizeStringArray(project.openItems, 8),
            decisions: normalizeStringArray(project.decisions, 8),
            lastUserIntent: normalizeText(project.lastUserIntent || app?.sourcePrompt),
            lastActivityAt: normalizeText(project.lastActivityAt || app?.updatedAt || app?.createdAt),
        },
        repoState: {
            initialized: repoState.initialized === true
                || Boolean(normalizeText(app?.repoUrl || app?.repoCloneUrl || app?.repoSshUrl || ''))
                || normalizeStringArray(repoState.lastSeededPaths || source.lastSeededPaths, 24).length > 0,
            lastSeededPaths: normalizeStringArray(repoState.lastSeededPaths || source.lastSeededPaths, 24),
            lastCommitSha: normalizeText(repoState.lastCommitSha),
            lastCommitAt: normalizeText(repoState.lastCommitAt),
            lastBuildRunId: normalizeText(repoState.lastBuildRunId),
        },
        desiredDeploy: {
            deploymentTarget: 'ssh',
            namespace: normalizeText(desiredDeploy.namespace || app?.namespace),
            publicHost: normalizeText(desiredDeploy.publicHost || app?.publicHost),
            imageRepo: normalizeText(desiredDeploy.imageRepo || app?.imageRepo),
            defaultBranch: normalizeText(desiredDeploy.defaultBranch || app?.defaultBranch || managedAppsConfig.defaultBranch || 'main'),
            containerPort: normalizedContainerPort,
            ingressClassName: normalizeText(desiredDeploy.ingressClassName || deployConfig.ingressClassName),
            tlsClusterIssuer: normalizeText(desiredDeploy.tlsClusterIssuer || deployConfig.tlsClusterIssuer),
            registryPullSecretName: normalizeText(desiredDeploy.registryPullSecretName || managedAppsConfig.registryPullSecretName),
        },
        liveDeploy: {
            lastImage: normalizeText(liveDeploy.lastImage || source.lastImage),
            rollout: liveDeploy.rollout === true,
            ingress: liveDeploy.ingress === true,
            tls: liveDeploy.tls === true,
            https: liveDeploy.https === true,
            lastVerifiedAt: normalizeText(liveDeploy.lastVerifiedAt),
            lastError: normalizeText(liveDeploy.lastError),
            lastDeployResult: liveDeploy.lastDeployResult || source.lastDeployResult || null,
        },
        deploymentTarget: 'ssh',
        requestedContainerPort: normalizedContainerPort,
        lastSeededPaths: normalizeStringArray(repoState.lastSeededPaths || source.lastSeededPaths, 24),
        lastImage: normalizeText(liveDeploy.lastImage || source.lastImage),
        lastDeployResult: liveDeploy.lastDeployResult || source.lastDeployResult || null,
    };
}

function buildManagedAppMetadata(existingMetadata = {}, app = {}, options = {}) {
    const normalized = normalizeManagedAppMetadata(existingMetadata, app, options);
    const projectPatch = options.project && typeof options.project === 'object' ? options.project : {};
    const repoStatePatch = options.repoState && typeof options.repoState === 'object' ? options.repoState : {};
    const desiredDeployPatch = options.desiredDeploy && typeof options.desiredDeploy === 'object' ? options.desiredDeploy : {};
    const liveDeployPatch = options.liveDeploy && typeof options.liveDeploy === 'object' ? options.liveDeploy : {};

    const merged = {
        ...normalized,
        project: {
            ...normalized.project,
            ...projectPatch,
            openItems: normalizeStringArray(
                hasOwnInput(projectPatch, 'openItems') ? projectPatch.openItems : normalized.project.openItems,
                8,
            ),
            decisions: normalizeStringArray(
                hasOwnInput(projectPatch, 'decisions') ? projectPatch.decisions : normalized.project.decisions,
                8,
            ),
        },
        repoState: {
            ...normalized.repoState,
            ...repoStatePatch,
            initialized: repoStatePatch.initialized === true || normalized.repoState.initialized === true,
            lastSeededPaths: normalizeStringArray(
                hasOwnInput(repoStatePatch, 'lastSeededPaths') ? repoStatePatch.lastSeededPaths : normalized.repoState.lastSeededPaths,
                24,
            ),
        },
        desiredDeploy: {
            ...normalized.desiredDeploy,
            ...desiredDeployPatch,
            deploymentTarget: 'ssh',
        },
        liveDeploy: {
            ...normalized.liveDeploy,
            ...liveDeployPatch,
        },
    };

    merged.project.summary = normalizeText(merged.project.summary);
    merged.project.currentObjective = normalizeText(merged.project.currentObjective);
    merged.project.nextStep = normalizeText(merged.project.nextStep);
    merged.project.lastUserIntent = normalizeText(merged.project.lastUserIntent);
    merged.project.lastActivityAt = normalizeText(merged.project.lastActivityAt);
    merged.repoState.lastCommitSha = normalizeText(merged.repoState.lastCommitSha);
    merged.repoState.lastCommitAt = normalizeText(merged.repoState.lastCommitAt);
    merged.repoState.lastBuildRunId = normalizeText(merged.repoState.lastBuildRunId);
    merged.desiredDeploy.namespace = normalizeText(merged.desiredDeploy.namespace);
    merged.desiredDeploy.publicHost = normalizeText(merged.desiredDeploy.publicHost);
    merged.desiredDeploy.imageRepo = normalizeText(merged.desiredDeploy.imageRepo);
    merged.desiredDeploy.defaultBranch = normalizeText(merged.desiredDeploy.defaultBranch || 'main') || 'main';
    merged.desiredDeploy.ingressClassName = normalizeText(merged.desiredDeploy.ingressClassName);
    merged.desiredDeploy.tlsClusterIssuer = normalizeText(merged.desiredDeploy.tlsClusterIssuer);
    merged.desiredDeploy.registryPullSecretName = normalizeText(merged.desiredDeploy.registryPullSecretName);
    merged.liveDeploy.lastImage = normalizeText(merged.liveDeploy.lastImage);
    merged.liveDeploy.lastVerifiedAt = normalizeText(merged.liveDeploy.lastVerifiedAt);
    merged.liveDeploy.lastError = normalizeText(merged.liveDeploy.lastError);

    merged.deploymentTarget = 'ssh';
    merged.requestedContainerPort = Number(merged.desiredDeploy.containerPort || merged.requestedContainerPort || 80) || 80;
    merged.lastSeededPaths = [...merged.repoState.lastSeededPaths];
    merged.lastImage = merged.liveDeploy.lastImage;
    merged.lastDeployResult = merged.liveDeploy.lastDeployResult || null;

    return merged;
}

function deriveNextStepForLifecycle(phase = '', { deployRequested = false, healthy = null } = {}) {
    switch (normalizeText(phase).toLowerCase()) {
        case 'created':
        case 'updated':
            return deployRequested
                ? 'Wait for the remote Gitea build to finish, then continue deployment through the managed-app control plane.'
                : 'Wait for the remote Gitea build to finish, then inspect or deploy the managed app.';
        case 'built':
            return 'Deploy the latest built image when you are ready to publish the changes.';
        case 'build_failed':
            return 'Investigate the failed build in Gitea, fix the repository state, and queue another build.';
        case 'deploying':
            return 'Wait for rollout, ingress, TLS, and HTTPS verification to finish on the remote cluster.';
        case 'tls_ready':
        case 'pending_https':
            return 'Monitor public HTTPS until the ingress responds successfully.';
        case 'deploy_failed':
            return 'Investigate the remote deployment failure and retry the managed-app deploy once the cluster issue is fixed.';
        case 'live':
            return '';
        case 'doctor':
        case 'reconcile':
            return healthy === true
                ? ''
                : 'Review the managed app platform diagnostics and repair the remote runner or cluster state before queueing more builds.';
        default:
            return '';
    }
}

function deriveOpenItemsForLifecycle(phase = '', { deployRequested = false, summary = '', error = '', healthy = null } = {}) {
    const normalizedPhase = normalizeText(phase).toLowerCase();
    if (normalizedPhase === 'build_failed' || normalizedPhase === 'deploy_failed') {
        return normalizeStringArray([error || summary], 4);
    }
    if (normalizedPhase === 'tls_ready' || normalizedPhase === 'pending_https') {
        return ['Public HTTPS is not responding yet.'];
    }
    if (normalizedPhase === 'created' || normalizedPhase === 'updated') {
        return deployRequested
            ? ['Remote build is queued.', 'Deployment will continue after the build webhook succeeds.']
            : ['Remote build is queued.'];
    }
    if ((normalizedPhase === 'doctor' || normalizedPhase === 'reconcile') && healthy === false) {
        return normalizeStringArray([summary], 4);
    }
    return [];
}

class ManagedAppService {
    constructor(options = {}) {
        this.store = options.store || managedAppStore;
        this.giteaClient = options.giteaClient || new GiteaClient();
        this.kubernetesClient = options.kubernetesClient || new KubernetesClient();
        this.llmClient = options.llmClient || createManagedAppLlmClient();
        this.sessionStore = options.sessionStore || sessionStore;
    }

    isAvailable() {
        return this.store.isAvailable();
    }

    getEffectiveGiteaConfig() {
        return typeof settingsController.getEffectiveGiteaConfig === 'function'
            ? settingsController.getEffectiveGiteaConfig()
            : {};
    }

    getEffectiveManagedAppsConfig() {
        return typeof settingsController.getEffectiveManagedAppsConfig === 'function'
            ? settingsController.getEffectiveManagedAppsConfig()
            : {};
    }

    getEffectiveDeployConfig() {
        return typeof settingsController.getEffectiveDeployConfig === 'function'
            ? settingsController.getEffectiveDeployConfig()
            : {};
    }

    resolveDeploymentTarget(input = {}, context = {}, app = null) {
        const explicit = normalizeDeployTarget(input.deployTarget || input.deploymentTarget || input.target);
        if (explicit) {
            return 'ssh';
        }

        if (normalizeText(context.executionProfile) === 'remote-build') {
            return 'ssh';
        }

        return 'ssh';
    }

    getPublicApiBaseUrl() {
        return normalizeManagedAppWebhookBaseUrl(settingsController.settings?.api?.baseURL || process.env.API_BASE_URL || '');
    }

    buildBuildEventsUrl() {
        const baseUrl = this.getPublicApiBaseUrl();
        const managedAppsConfig = this.getEffectiveManagedAppsConfig();
        if (!baseUrl) {
            return '';
        }
        const endpointPath = normalizeText(managedAppsConfig.webhookEndpointPath || config.managedApps.webhookEndpointPath || '/api/integrations/gitea/build-events');
        return `${baseUrl}${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`;
    }

    normalizeAppRecord(app = null) {
        if (!app || typeof app !== 'object') {
            return app;
        }

        return {
            ...app,
            metadata: normalizeManagedAppMetadata(app.metadata || {}, app, {
                deployConfig: this.getEffectiveDeployConfig(),
                managedAppsConfig: this.getEffectiveManagedAppsConfig(),
            }),
        };
    }

    normalizeAppList(apps = []) {
        return (Array.isArray(apps) ? apps : []).map((app) => this.normalizeAppRecord(app));
    }

    async listOwnerApps(ownerId = null, limit = 50) {
        if (!ownerId || !this.store?.listApps) {
            return [];
        }

        try {
            return this.normalizeAppList(await this.store.listApps(ownerId, limit));
        } catch (_error) {
            return [];
        }
    }

    findAppByPublicHost(apps = [], publicHost = '') {
        const targetHost = normalizeText(publicHost).toLowerCase();
        if (!targetHost) {
            return null;
        }
        return (Array.isArray(apps) ? apps : []).find((app) => normalizeText(app?.publicHost).toLowerCase() === targetHost) || null;
    }

    findAppByExactName(apps = [], appName = '') {
        const targetName = normalizeText(appName).toLowerCase();
        if (!targetName) {
            return null;
        }
        return (Array.isArray(apps) ? apps : []).find((app) => normalizeText(app?.appName).toLowerCase() === targetName) || null;
    }

    findAppByFuzzyMatch(apps = [], blueprint = {}) {
        const targetSlug = normalizeText(blueprint.slug);
        const targetName = normalizeText(blueprint.appName);
        const targetHost = normalizeText(blueprint.publicHost);
        if (!targetSlug && !targetName && !targetHost) {
            return null;
        }

        return (Array.isArray(apps) ? apps : []).find((app) => (
            valuesLooselyMatch(app?.slug, targetSlug)
            || valuesLooselyMatch(app?.repoName, targetSlug)
            || valuesLooselyMatch(app?.appName, targetName)
            || valuesLooselyMatch(app?.publicHost, targetHost)
        )) || null;
    }

    async resolveAppForMutation(input = {}, blueprint = {}, ownerId = null) {
        const explicitRef = normalizeText(input.appRef || input.app || input.id || input.ref || '');
        if (explicitRef) {
            const resolved = await this.resolveApp(explicitRef, ownerId);
            if (resolved) {
                return {
                    app: resolved,
                    reason: 'explicit-ref',
                };
            }
        }

        const explicitSlug = normalizeText(input.slug);
        if (explicitSlug) {
            const resolved = await this.resolveApp(explicitSlug, ownerId);
            if (resolved) {
                return {
                    app: resolved,
                    reason: 'explicit-slug',
                };
            }
        }

        const explicitRepoOwner = normalizeText(input.repoOwner);
        const explicitRepoName = normalizeText(input.repoName);
        if (explicitRepoOwner && explicitRepoName && this.store?.getAppByRepo) {
            const byRepo = this.normalizeAppRecord(await this.store.getAppByRepo(explicitRepoOwner, explicitRepoName));
            if (byRepo) {
                return {
                    app: byRepo,
                    reason: 'explicit-repo',
                };
            }
        }

        if (blueprint?.slug && this.store?.getAppBySlug) {
            const byBlueprintSlug = this.normalizeAppRecord(await this.store.getAppBySlug(blueprint.slug, ownerId));
            if (byBlueprintSlug) {
                return {
                    app: byBlueprintSlug,
                    reason: 'derived-slug',
                };
            }
        }

        const ownerApps = await this.listOwnerApps(ownerId, 50);
        const byHost = this.findAppByPublicHost(ownerApps, input.publicHost || blueprint.publicHost);
        if (byHost) {
            return {
                app: byHost,
                reason: 'public-host',
            };
        }

        const byExactName = this.findAppByExactName(ownerApps, input.appName || input.name || input.title || blueprint.appName);
        if (byExactName) {
            return {
                app: byExactName,
                reason: 'app-name',
            };
        }

        const byFuzzyMatch = this.findAppByFuzzyMatch(ownerApps, blueprint);
        if (byFuzzyMatch) {
            return {
                app: byFuzzyMatch,
                reason: 'fuzzy',
            };
        }

        return {
            app: null,
            reason: 'new',
        };
    }

    mergeBlueprintWithExisting(existing = {}, blueprint = {}, input = {}, sessionId = null) {
        const normalizedExisting = this.normalizeAppRecord(existing);
        const mergedMetadata = mergeMetadataSection(normalizedExisting?.metadata || {}, blueprint.metadata || {});
        const derivedRepoOwner = normalizeText(normalizedExisting?.repoOwner || blueprint.repoOwner);
        const derivedRepoName = normalizeText(normalizedExisting?.repoName || blueprint.repoName || normalizedExisting?.slug || blueprint.slug);
        const defaultRepoBase = normalizeText(this.getEffectiveGiteaConfig().baseURL).replace(/\/+$/, '');

        return {
            sessionId: sessionId || normalizedExisting?.sessionId || blueprint.sessionId || null,
            appName: hasAnyOwnInput(input, ['appName', 'name', 'title'])
                ? blueprint.appName
                : normalizeText(normalizedExisting?.appName || blueprint.appName),
            repoOwner: hasOwnInput(input, 'repoOwner')
                ? blueprint.repoOwner
                : derivedRepoOwner,
            repoName: hasAnyOwnInput(input, ['repoName', 'slug'])
                ? blueprint.repoName
                : derivedRepoName,
            repoUrl: hasOwnInput(input, 'repoUrl')
                ? blueprint.repoUrl
                : normalizeText(
                    normalizedExisting?.repoUrl
                    || (defaultRepoBase && derivedRepoOwner && derivedRepoName
                        ? `${defaultRepoBase}/${derivedRepoOwner}/${derivedRepoName}.git`
                        : blueprint.repoUrl),
                ),
            repoCloneUrl: hasOwnInput(input, 'repoCloneUrl')
                ? blueprint.repoCloneUrl
                : normalizeText(
                    normalizedExisting?.repoCloneUrl
                    || (defaultRepoBase && derivedRepoOwner && derivedRepoName
                        ? `${defaultRepoBase}/${derivedRepoOwner}/${derivedRepoName}.git`
                        : blueprint.repoCloneUrl),
                ),
            repoSshUrl: hasOwnInput(input, 'repoSshUrl')
                ? blueprint.repoSshUrl
                : normalizeText(normalizedExisting?.repoSshUrl || blueprint.repoSshUrl),
            defaultBranch: hasOwnInput(input, 'defaultBranch')
                ? blueprint.defaultBranch
                : normalizeText(normalizedExisting?.defaultBranch || blueprint.defaultBranch || 'main'),
            imageRepo: hasOwnInput(input, 'imageRepo')
                ? blueprint.imageRepo
                : normalizeText(normalizedExisting?.imageRepo || blueprint.imageRepo),
            namespace: hasOwnInput(input, 'namespace')
                ? blueprint.namespace
                : normalizeText(normalizedExisting?.namespace || blueprint.namespace),
            publicHost: hasOwnInput(input, 'publicHost')
                ? blueprint.publicHost
                : normalizeText(normalizedExisting?.publicHost || blueprint.publicHost),
            sourcePrompt: normalizeText(blueprint.sourcePrompt || normalizedExisting?.sourcePrompt),
            metadata: mergedMetadata,
        };
    }

    shouldSeedRepository(existing = null, input = {}, mergedApp = {}) {
        const explicitFiles = normalizeFilesInput(input.files);
        if (explicitFiles.length > 0) {
            return true;
        }

        if (!existing) {
            return true;
        }

        const nextPrompt = normalizeText(input.sourcePrompt || input.prompt || '');
        const previousPrompt = normalizeText(existing.sourcePrompt || mergedApp.sourcePrompt || '');
        return Boolean(nextPrompt && nextPrompt !== previousPrompt);
    }

    buildLifecycleMetadata(existingApp = null, {
        input = {},
        buildRun = null,
        phase = '',
        summary = '',
        desiredDeploy = {},
        liveDeploy = {},
        repoState = {},
        project = {},
        deployRequested = false,
        healthy = null,
    } = {}) {
        const app = this.normalizeAppRecord(existingApp || {});
        const computedSummary = normalizeText(summary || buildManagedAppStatusSummary(app, buildRun, phase, liveDeploy.lastDeployResult || null));
        const buildError = normalizeText(
            buildRun?.error?.message
            || liveDeploy?.lastError
            || app?.metadata?.liveDeploy?.lastError
            || '',
        );

        return buildManagedAppMetadata(app.metadata || {}, app, {
            deployConfig: this.getEffectiveDeployConfig(),
            managedAppsConfig: this.getEffectiveManagedAppsConfig(),
            project: {
                ...project,
                summary: computedSummary,
                currentObjective: normalizeText(project.currentObjective || input.sourcePrompt || input.prompt || app.sourcePrompt || app.metadata?.project?.currentObjective),
                nextStep: normalizeText(project.nextStep || deriveNextStepForLifecycle(phase, { deployRequested, healthy })),
                openItems: hasOwnInput(project, 'openItems')
                    ? project.openItems
                    : deriveOpenItemsForLifecycle(phase, {
                        deployRequested,
                        summary: computedSummary,
                        error: buildError,
                        healthy,
                    }),
                lastUserIntent: normalizeText(project.lastUserIntent || input.sourcePrompt || input.prompt || input.requestedAction || input.action || app.sourcePrompt || ''),
                lastActivityAt: new Date().toISOString(),
            },
            repoState,
            desiredDeploy,
            liveDeploy,
        });
    }

    async resolveApp(ref = '', ownerId = null) {
        const reference = normalizeText(ref);
        if (!reference) {
            return null;
        }

        const repoReference = parseManagedAppRepoReference(reference);
        if (repoReference && this.store?.getAppByRepo) {
            const byRepo = await this.store.getAppByRepo(repoReference.repoOwner, repoReference.repoName);
            if (byRepo) {
                return this.normalizeAppRecord(byRepo);
            }
        }

        const byId = this.store?.getAppById
            ? await this.store.getAppById(reference, ownerId)
            : null;
        if (byId) {
            return this.normalizeAppRecord(byId);
        }

        const bySlug = this.store?.getAppBySlug
            ? await this.store.getAppBySlug(reference, ownerId)
            : null;
        if (bySlug) {
            return this.normalizeAppRecord(bySlug);
        }

        if (repoReference && this.store?.getAppBySlug) {
            return this.normalizeAppRecord(await this.store.getAppBySlug(repoReference.repoName, ownerId));
        }

        return null;
    }

    async listApps(ownerId, limit = 50) {
        await this.store.ensureAvailable();
        return this.normalizeAppList(await this.store.listApps(ownerId, limit));
    }

    async listBuildRuns(appRef = '', ownerId = null, limit = 20) {
        const app = await this.resolveApp(appRef, ownerId);
        if (!app) {
            return [];
        }
        return this.store.listBuildRunsForApp(app.id, ownerId, limit);
    }

    async inspectApp(appRef = '', ownerId = null) {
        const app = await this.resolveApp(appRef, ownerId);
        if (!app) {
            return null;
        }

        const buildRuns = await this.store.listBuildRunsForApp(app.id, ownerId, 10);
        return {
            app,
            buildRuns,
            summary: normalizeText(app.metadata?.project?.summary || buildManagedAppStatusSummary(app, buildRuns[0] || null, app.status || 'updated')),
        };
    }

    async doctorPlatform(input = {}, ownerId = null, context = {}) {
        const deploymentTarget = this.resolveDeploymentTarget(input, context, null);
        if (!this.kubernetesClient.isConfigured(deploymentTarget)) {
            const error = new Error('Managed app platform inspection requires configured SSH access to the remote deploy host.');
            error.statusCode = 503;
            throw error;
        }

        const giteaConfig = this.getEffectiveGiteaConfig();
        const managedAppsConfig = this.getEffectiveManagedAppsConfig();
        const platform = await this.kubernetesClient.inspectManagedAppPlatform({
            platformNamespace: input.platformNamespace || managedAppsConfig.platformNamespace,
            deploymentTarget,
        });
        const healthy = platform.namespaceExists
            && isDeploymentReady(getDeploymentStatus(platform, 'gitea'))
            && isDeploymentReady(getDeploymentStatus(platform, 'buildkitd'))
            && isDeploymentReady(getDeploymentStatus(platform, 'act-runner'))
            && normalizeText(platform.runnerTokenState).toLowerCase() === 'present';
        const suggestions = buildPlatformDoctorSuggestions(platform);
        const message = buildPlatformDoctorMessage(platform, healthy);
        const app = normalizeText(input.appRef || input.app || input.id || input.slug)
            ? await this.resolveApp(normalizeText(input.appRef || input.app || input.id || input.slug), ownerId)
            : null;

        if (app) {
            await this.store.updateApp(app.id, app.ownerId, {
                metadata: this.buildLifecycleMetadata(app, {
                    input,
                    phase: 'doctor',
                    summary: message,
                    healthy,
                    project: {
                        openItems: suggestions,
                    },
                }),
            });
        }

        return {
            platform: {
                ...platform,
                expected: {
                    deploymentTarget,
                    platformNamespace: managedAppsConfig.platformNamespace,
                    giteaBaseURL: giteaConfig.baseURL,
                    registryHost: giteaConfig.registryHost,
                },
            },
            healthy,
            suggestions,
            message,
        };
    }

    async reconcilePlatform(input = {}, ownerId = null, context = {}) {
        const deploymentTarget = this.resolveDeploymentTarget(input, context, null);
        if (!this.giteaClient.isConfigured()) {
            const error = new Error('Managed app platform reconciliation requires a configured external Gitea control plane.');
            error.statusCode = 503;
            throw error;
        }
        if (!this.kubernetesClient.isConfigured(deploymentTarget)) {
            const error = new Error('Managed app platform reconciliation requires configured SSH access to the remote deploy host.');
            error.statusCode = 503;
            throw error;
        }

        const giteaConfig = this.getEffectiveGiteaConfig();
        const managedAppsConfig = this.getEffectiveManagedAppsConfig();
        const platformNamespace = normalizeText(input.platformNamespace || managedAppsConfig.platformNamespace || 'agent-platform');
        const before = await this.kubernetesClient.inspectManagedAppPlatform({
            platformNamespace,
            deploymentTarget,
        });
        const runnerScope = normalizeText(input.runnerScope || 'org').toLowerCase() || 'org';
        const shouldRotateRunnerToken = input.rotateRunnerToken === true
            || ['missing', 'missing-secret', 'placeholder'].includes(normalizeText(before.runnerTokenState).toLowerCase())
            || (Array.isArray(before.runnerLogExcerpt)
                && before.runnerLogExcerpt.some((line) => /\bunauthorized\b|\bforbidden\b|\binvalid\b|\btoken\b/i.test(String(line || ''))));
        const runnerToken = await this.giteaClient.getRunnerRegistrationToken({
            scope: runnerScope,
            org: giteaConfig.org,
            owner: input.repoOwner,
            repo: input.repoName,
            rotate: shouldRotateRunnerToken,
        });
        const desiredRunnerReplicas = Number.isFinite(Number(input.runnerReplicas))
            ? Math.max(0, Number(input.runnerReplicas))
            : 1;
        const runnerLabels = normalizeText(input.runnerLabels || before.runnerLabels || DEFAULT_GITEA_RUNNER_LABELS);
        const giteaInstanceUrl = normalizeText(input.giteaInstanceUrl || giteaConfig.baseURL || before.giteaInstanceUrl);
        const reconciliation = await this.kubernetesClient.reconcileManagedAppPlatform({
            platformNamespace,
            deploymentTarget,
            desiredRunnerReplicas,
            runnerRegistrationToken: runnerToken.token,
            runnerLabels,
            giteaInstanceUrl,
        });
        const platform = await this.kubernetesClient.inspectManagedAppPlatform({
            platformNamespace,
            deploymentTarget,
        });

        let runnerCatalog = {
            scope: runnerScope,
            runners: [],
            totalCount: 0,
            error: '',
        };
        try {
            const listed = await this.giteaClient.listActionsRunners({
                scope: runnerScope,
                org: giteaConfig.org,
                owner: input.repoOwner,
                repo: input.repoName,
            });
            runnerCatalog = {
                ...listed,
                error: '',
            };
        } catch (error) {
            runnerCatalog.error = error.message;
        }

        const runners = normalizeRunnerRecords(runnerCatalog);
        const onlineRunnerCount = runners.filter((runner) => !runner.disabled && runner.status && runner.status !== 'offline').length;
        const healthy = isPlatformHealthy(platform) && onlineRunnerCount > 0;
        const suggestions = buildPlatformDoctorSuggestions(platform);
        if (!runnerCatalog.error && onlineRunnerCount === 0) {
            suggestions.push(`Gitea reports no online ${runnerScope}-level runners yet. The runner may still be registering, or the deployment labels may not match the workflow.`);
        }
        if (runnerCatalog.error) {
            suggestions.push(`Runner verification through the Gitea API failed after reconciliation: ${runnerCatalog.error}`);
        }
        const message = `Managed app platform reconciliation on ${normalizeText(platform.executionHost || reconciliation.executionHost || 'remote ssh target')}: ${reconciliation.actions.join(', ') || 'no changes reported'}; ${healthy ? 'platform healthy' : 'platform still needs attention'}.`;
        const app = normalizeText(input.appRef || input.app || input.id || input.slug)
            ? await this.resolveApp(normalizeText(input.appRef || input.app || input.id || input.slug), ownerId)
            : null;

        if (app) {
            await this.store.updateApp(app.id, app.ownerId, {
                metadata: this.buildLifecycleMetadata(app, {
                    input,
                    phase: 'reconcile',
                    summary: message,
                    healthy,
                    project: {
                        openItems: suggestions,
                    },
                }),
            });
        }

        return {
            before: {
                ...before,
                expected: {
                    deploymentTarget,
                    platformNamespace,
                    giteaBaseURL: giteaConfig.baseURL,
                    registryHost: giteaConfig.registryHost,
                },
            },
            platform: {
                ...platform,
                expected: {
                    deploymentTarget,
                    platformNamespace,
                    giteaBaseURL: giteaConfig.baseURL,
                    registryHost: giteaConfig.registryHost,
                    runnerLabels,
                    runnerReplicas: desiredRunnerReplicas,
                },
            },
            reconciliation,
            runnerToken: {
                scope: runnerToken.scope,
                rotated: runnerToken.rotated,
                source: 'gitea-api',
            },
            giteaRunners: {
                scope: runnerCatalog.scope,
                totalCount: Number(runnerCatalog.totalCount || runners.length || 0),
                onlineCount: onlineRunnerCount,
                runners,
                ...(runnerCatalog.error ? { error: runnerCatalog.error } : {}),
            },
            healthy,
            suggestions: Array.from(new Set(suggestions.filter(Boolean))),
            message,
        };
    }

    buildAppBlueprint(input = {}, ownerId = null, sessionId = null, context = {}) {
        const giteaConfig = this.getEffectiveGiteaConfig();
        const managedAppsConfig = this.getEffectiveManagedAppsConfig();
        const explicitPromptName = extractExplicitAppName(input.prompt || input.sourcePrompt || '');
        const rawName = deriveRequestedAppName(input) || buildFallbackRequestedAppName();
        const deploymentTarget = this.resolveDeploymentTarget(input, context, null);
        const slug = slugify(input.slug || rawName || buildFallbackRequestedAppName(), {
            maxLength: MAX_MANAGED_APP_SLUG_LENGTH,
        });
        const appName = normalizeText(
            input.appName
            || input.name
            || input.title
            || (explicitPromptName ? titleizeSlug(slugify(explicitPromptName)) : '')
            || titleizeSlug(slug),
        );
        const repoOwner = normalizeText(input.repoOwner || giteaConfig.org || 'agent-apps');
        const repoName = slug;
        const imageRepo = resolveManagedAppImageRepo({
            ...input,
            slug,
            repoOwner,
            repoName,
        }, giteaConfig);
        if (!imageRepo) {
            const error = new Error('Managed app image publishing requires a configured Gitea registry host or a derivable Gitea base URL host.');
            error.statusCode = 503;
            throw error;
        }
        const namespace = normalizeManagedAppNamespace(
            input.namespace,
            {
                slug,
                namespacePrefix: managedAppsConfig.namespacePrefix || 'app-',
            },
        );
        const publicHost = normalizeText(input.publicHost || `${slug}.${managedAppsConfig.appBaseDomain || 'demoserver2.buzz'}`);
        const defaultBranch = normalizeText(input.defaultBranch || managedAppsConfig.defaultBranch || 'main');
        const deployConfig = this.getEffectiveDeployConfig();
        const requestedContainerPort = Number(input.containerPort || managedAppsConfig.defaultContainerPort || 80);

        const blueprint = {
            ownerId,
            sessionId,
            slug,
            appName,
            repoOwner,
            repoName,
            repoUrl: normalizeText(input.repoUrl || `${normalizeText(giteaConfig.baseURL).replace(/\/+$/, '')}/${repoOwner}/${repoName}.git`),
            repoCloneUrl: normalizeText(input.repoCloneUrl || `${normalizeText(giteaConfig.baseURL).replace(/\/+$/, '')}/${repoOwner}/${repoName}.git`),
            repoSshUrl: normalizeText(input.repoSshUrl || ''),
            defaultBranch,
            imageRepo,
            namespace,
            publicHost,
            sourcePrompt: normalizeText(input.sourcePrompt || input.prompt || ''),
            status: normalizeAppStatus(input.status || 'draft'),
        };

        blueprint.metadata = buildManagedAppMetadata(input.metadata || {}, blueprint, {
            deployConfig,
            managedAppsConfig,
            desiredDeploy: {
                deploymentTarget,
                namespace,
                publicHost,
                imageRepo,
                defaultBranch,
                containerPort: Number.isFinite(requestedContainerPort) && requestedContainerPort > 0 ? requestedContainerPort : 80,
                ingressClassName: deployConfig.ingressClassName,
                tlsClusterIssuer: deployConfig.tlsClusterIssuer,
                registryPullSecretName: managedAppsConfig.registryPullSecretName,
            },
            project: {
                currentObjective: normalizeText(input.sourcePrompt || input.prompt || ''),
                lastUserIntent: normalizeText(input.sourcePrompt || input.prompt || ''),
            },
        });

        return blueprint;
    }

    async buildRepositoryFiles(app = {}, input = {}, context = {}) {
        const baseFiles = buildDefaultScaffoldFiles({
            appName: app.appName,
            slug: app.slug,
            publicHost: app.publicHost,
            namespace: app.namespace,
            sourcePrompt: app.sourcePrompt,
            giteaOrg: app.repoOwner,
            imageRepo: app.imageRepo,
            registryHost: this.getEffectiveGiteaConfig().registryHost,
            buildEventsUrl: this.buildBuildEventsUrl(),
        });
        const explicitFiles = normalizeFilesInput(input.files);
        if (explicitFiles.length > 0) {
            return mergeRepositoryFiles(baseFiles, explicitFiles);
        }

        const sourcePrompt = normalizeText(input.sourcePrompt || input.prompt || app.sourcePrompt);
        if (!sourcePrompt || !this.llmClient || typeof this.llmClient.complete !== 'function') {
            return baseFiles;
        }

        try {
            const completion = await this.llmClient.complete(
                buildManagedAppAuthoringPrompt({
                    appName: app.appName,
                    slug: app.slug,
                    publicHost: app.publicHost,
                    namespace: app.namespace,
                    sourcePrompt,
                }),
                {
                    model: context.model || '',
                    reasoningEffort: 'medium',
                },
            );
            const parsed = parseLenientJson(String(completion || '').trim());
            const generatedFiles = normalizeGeneratedManagedAppSourceFiles(parsed?.files || parsed);
            if (generatedFiles.length === 0) {
                return baseFiles;
            }

            return mergeRepositoryFiles(baseFiles, generatedFiles);
        } catch (error) {
            console.warn(`[ManagedApp] Falling back to the default scaffold for ${app.slug || 'managed-app'}: ${error.message}`);
            return baseFiles;
        }
    }

    async ensurePersistedApp(app = null, blueprint = {}, ownerId = null) {
        if (hasPersistedAppId(app)) {
            return app;
        }

        let persisted = await this.store.getAppBySlug(blueprint.slug, ownerId)
            || await this.store.getAppByRepo(blueprint.repoOwner, blueprint.repoName);
        if (hasPersistedAppId(persisted)) {
            return persisted;
        }

        try {
            persisted = await this.store.createApp({
                ...blueprint,
                status: blueprint.status || 'provisioning',
            });
        } catch (error) {
            const recovered = await this.store.getAppBySlug(blueprint.slug, ownerId)
                || await this.store.getAppByRepo(blueprint.repoOwner, blueprint.repoName);
            if (hasPersistedAppId(recovered)) {
                return recovered;
            }
            throw error;
        }

        return persisted;
    }

    async createApp(input = {}, ownerId = null, context = {}) {
        await this.store.ensureAvailable();
        if (!this.giteaClient.isConfigured()) {
            const error = new Error('Managed app creation requires integrations.gitea to be configured.');
            error.statusCode = 503;
            throw error;
        }
        const sessionId = normalizeText(context.sessionId || input.sessionId || '') || null;
        const requestedAction = normalizeRequestedAction(input.requestedAction || input.action || 'build');
        const deployRequested = inferDeployRequested(requestedAction, input.deployRequested === true);
        const blueprint = this.buildAppBlueprint(input, ownerId, sessionId, context);
        const resolved = await this.resolveAppForMutation(input, blueprint, ownerId);
        const existing = resolved.app ? this.normalizeAppRecord(resolved.app) : null;
        const mergedState = existing
            ? this.mergeBlueprintWithExisting(existing, blueprint, input, sessionId)
            : {
                ...blueprint,
                sessionId,
            };
        const provisioningMetadata = this.buildLifecycleMetadata(existing || {
            ...blueprint,
            ...mergedState,
        }, {
            input,
            phase: existing ? 'updated' : 'created',
            deployRequested,
            desiredDeploy: {
                namespace: mergedState.namespace,
                publicHost: mergedState.publicHost,
                imageRepo: mergedState.imageRepo,
                defaultBranch: mergedState.defaultBranch,
                containerPort: Number(mergedState.metadata?.requestedContainerPort || blueprint.metadata?.requestedContainerPort || 80) || 80,
            },
            project: {
                currentObjective: normalizeText(input.sourcePrompt || input.prompt || blueprint.sourcePrompt),
                lastUserIntent: normalizeText(input.sourcePrompt || input.prompt || blueprint.sourcePrompt),
            },
        });

        const app = existing
            ? await this.store.updateApp(existing.id, ownerId, {
                ...mergedState,
                metadata: provisioningMetadata,
                status: 'provisioning',
                sessionId,
            })
            : await this.store.createApp({
                ...blueprint,
                ...mergedState,
                metadata: provisioningMetadata,
                status: 'provisioning',
            });
        const persistedApp = await this.ensurePersistedApp(app, {
            ...blueprint,
            ...mergedState,
            metadata: provisioningMetadata,
            status: 'provisioning',
        }, ownerId);
        const normalizedPersistedApp = this.normalizeAppRecord(persistedApp);

        let repository = {
            html_url: normalizedPersistedApp.repoUrl,
            clone_url: normalizedPersistedApp.repoCloneUrl,
            ssh_url: normalizedPersistedApp.repoSshUrl,
        };
        let commitSha = '';
        let committedPaths = [];
        const effectiveRepoOwner = normalizeText(normalizedPersistedApp.repoOwner || blueprint.repoOwner);
        const effectiveRepoName = normalizeText(normalizedPersistedApp.repoName || blueprint.repoName);
        const shouldSeedRepository = this.shouldSeedRepository(existing, input, normalizedPersistedApp);

        if (this.giteaClient.isConfigured()) {
            await this.giteaClient.ensureOrganization({
                name: effectiveRepoOwner,
                fullName: 'KimiBuilt Managed Apps',
                description: 'Application repositories provisioned by KimiBuilt.',
            });
            const ensuredRepo = await this.giteaClient.ensureRepository({
                owner: effectiveRepoOwner,
                name: effectiveRepoName,
                description: `Managed app for ${normalizedPersistedApp.appName}`,
                defaultBranch: normalizedPersistedApp.defaultBranch,
            });
            repository = ensuredRepo.repository || repository;

            if (shouldSeedRepository) {
                const seedResult = await this.giteaClient.upsertFiles({
                    owner: effectiveRepoOwner,
                    repo: effectiveRepoName,
                    branch: normalizedPersistedApp.defaultBranch,
                    files: await this.buildRepositoryFiles(normalizedPersistedApp, input, context),
                    commitMessagePrefix: existing ? 'Update managed app' : 'Seed managed app',
                });
                commitSha = seedResult.commitSha;
                committedPaths = seedResult.committedPaths;
            }
        }

        const nextStatus = commitSha
            ? 'building'
            : (existing
                ? ((normalizeText(existing.status) === 'draft' || normalizeText(existing.status) === 'provisioning') ? 'repo_ready' : existing.status)
                : 'repo_ready');
        const updatedApp = await this.store.updateApp(persistedApp.id, ownerId, {
            repoOwner: effectiveRepoOwner,
            repoName: effectiveRepoName,
            repoUrl: normalizeText(repository.clone_url || repository.html_url || normalizedPersistedApp.repoUrl),
            repoCloneUrl: normalizeText(repository.clone_url || normalizedPersistedApp.repoCloneUrl),
            repoSshUrl: normalizeText(repository.ssh_url || normalizedPersistedApp.repoSshUrl),
            status: nextStatus,
            metadata: this.buildLifecycleMetadata({
                ...normalizedPersistedApp,
                repoOwner: effectiveRepoOwner,
                repoName: effectiveRepoName,
                repoUrl: normalizeText(repository.clone_url || repository.html_url || normalizedPersistedApp.repoUrl),
                repoCloneUrl: normalizeText(repository.clone_url || normalizedPersistedApp.repoCloneUrl),
                repoSshUrl: normalizeText(repository.ssh_url || normalizedPersistedApp.repoSshUrl),
                status: nextStatus,
            }, {
                input,
                phase: existing ? 'updated' : 'created',
                deployRequested,
                summary: existing
                    ? (commitSha
                        ? `${normalizedPersistedApp.appName} was resumed and updated in ${effectiveRepoOwner}/${effectiveRepoName}. Build and deploy are queued.`
                        : `${normalizedPersistedApp.appName} was resumed without repository changes.`)
                    : (commitSha
                        ? `${normalizedPersistedApp.appName} was created in ${effectiveRepoOwner}/${effectiveRepoName}. Build and deploy are queued.`
                        : `${normalizedPersistedApp.appName} was created without repository changes.`),
                repoState: {
                    initialized: true,
                    lastSeededPaths: committedPaths.length > 0
                        ? committedPaths
                        : normalizedPersistedApp.metadata?.repoState?.lastSeededPaths,
                    lastCommitSha: commitSha || normalizedPersistedApp.metadata?.repoState?.lastCommitSha,
                    lastCommitAt: commitSha ? new Date().toISOString() : normalizedPersistedApp.metadata?.repoState?.lastCommitAt,
                },
                desiredDeploy: {
                    namespace: mergedState.namespace,
                    publicHost: mergedState.publicHost,
                    imageRepo: normalizeText(normalizedPersistedApp.imageRepo || blueprint.imageRepo),
                    defaultBranch: mergedState.defaultBranch,
                },
                project: {
                    nextStep: commitSha
                        ? deriveNextStepForLifecycle(existing ? 'updated' : 'created', { deployRequested })
                        : '',
                },
            }),
        });
        const finalPersistedApp = (hasPersistedAppId(updatedApp) ? updatedApp : null)
            || (hasPersistedAppId(persistedApp) ? persistedApp : null)
            || await this.store.getAppByRepo(effectiveRepoOwner, effectiveRepoName)
            || await this.store.getAppBySlug(blueprint.slug, ownerId);
        const persistedAppId = normalizeText(finalPersistedApp?.id);
        if (commitSha && !persistedAppId) {
            const error = new Error(`Managed app build run creation requires a persisted app id for ${effectiveRepoOwner}/${effectiveRepoName || blueprint.slug}.`);
            error.statusCode = 500;
            throw error;
        }

        const buildRun = commitSha
            ? await this.store.createBuildRun({
                appId: persistedAppId,
                ownerId: finalPersistedApp?.ownerId || updatedApp?.ownerId || persistedApp.ownerId || ownerId,
                sessionId: finalPersistedApp?.sessionId || updatedApp?.sessionId || persistedApp.sessionId || sessionId,
                source: 'managed-app-service',
                requestedAction,
                commitSha,
                imageTag: buildImageTagFromCommit(commitSha),
                buildStatus: 'queued',
                deployRequested,
                deployStatus: deployRequested ? 'pending' : 'not_requested',
                verificationStatus: 'pending',
                metadata: {
                    trigger: existing ? 'resume' : 'create',
                    committedPaths,
                },
            })
            : null;

        let finalApp = this.normalizeAppRecord(finalPersistedApp || updatedApp || persistedApp);
        if (buildRun) {
            const lifecycleUpdatedApp = await this.store.updateApp(finalApp.id, ownerId, {
                metadata: this.buildLifecycleMetadata(finalApp, {
                    input,
                    buildRun,
                    phase: existing ? 'updated' : 'created',
                    deployRequested,
                    repoState: {
                        lastBuildRunId: buildRun.id,
                    },
                }),
            });
            finalApp = this.normalizeAppRecord(lifecycleUpdatedApp
                ? {
                    ...finalApp,
                    ...lifecycleUpdatedApp,
                    metadata: lifecycleUpdatedApp.metadata || finalApp.metadata,
                }
                : finalApp);
        }
        await this.broadcastLifecycleEvent(finalApp, buildRun, existing ? 'updated' : 'created');

        return {
            app: finalApp,
            buildRun,
            repository: {
                owner: finalApp.repoOwner,
                name: finalApp.repoName,
                url: finalApp.repoUrl,
                cloneUrl: finalApp.repoCloneUrl,
                sshUrl: finalApp.repoSshUrl,
            },
            committedPaths,
            reusedExistingApp: Boolean(existing),
            message: existing
                ? (commitSha
                    ? `Resumed ${finalApp.appName} and queued an image build from ${finalApp.repoOwner}/${finalApp.repoName}.`
                    : `Resumed ${finalApp.appName} without repository changes.`)
                : (commitSha
                    ? `Created ${finalApp.appName} and queued an image build from ${finalApp.repoOwner}/${finalApp.repoName}.`
                    : `Created ${finalApp.appName} without repository changes.`),
        };
    }

    async updateApp(appRef = '', input = {}, ownerId = null, context = {}) {
        const app = await this.resolveApp(appRef, ownerId);
        if (!app) {
            return null;
        }

        return this.createApp({
            ...input,
            appRef: app.id,
            slug: app.slug,
            appName: input.appName || app.appName,
            sourcePrompt: input.sourcePrompt || input.prompt || app.sourcePrompt,
        }, ownerId, {
            ...context,
            sessionId: context.sessionId || app.sessionId,
        });
    }

    async deployApp(appRef = '', input = {}, ownerId = null, context = {}) {
        const app = this.normalizeAppRecord(await this.resolveApp(appRef, ownerId));
        if (!app) {
            return null;
        }
        const deploymentTarget = this.resolveDeploymentTarget(input, context, app);
        if (!this.kubernetesClient.isConfigured(deploymentTarget)) {
            const error = new Error('Managed app deployment requires configured SSH access to the remote deploy host.');
            error.statusCode = 503;
            throw error;
        }

        const latestBuildRun = (await this.store.listBuildRunsForApp(app.id, ownerId, 1))[0] || null;
        const imageTag = normalizeText(input.imageTag || latestBuildRun?.imageTag || 'latest');
        const giteaConfig = this.getEffectiveGiteaConfig();
        const managedAppsConfig = this.getEffectiveManagedAppsConfig();
        const deployConfig = this.getEffectiveDeployConfig();
        const normalizedNamespace = normalizeManagedAppNamespace(
            input.namespace || app.metadata?.desiredDeploy?.namespace || app.namespace,
            {
                slug: app.slug,
                namespacePrefix: managedAppsConfig.namespacePrefix || 'app-',
            },
        );
        let deployableApp = app;

        if (normalizedNamespace !== normalizeText(app.namespace)) {
            deployableApp = this.normalizeAppRecord(await this.store.updateApp(app.id, app.ownerId, {
                namespace: normalizedNamespace,
                metadata: this.buildLifecycleMetadata(app, {
                    input,
                    phase: 'deploying',
                    desiredDeploy: {
                        namespace: normalizedNamespace,
                    },
                }),
            }) || {
                ...app,
                namespace: normalizedNamespace,
                metadata: this.buildLifecycleMetadata(app, {
                    input,
                    phase: 'deploying',
                    desiredDeploy: {
                        namespace: normalizedNamespace,
                    },
                }),
            });
        }

        const resolvedImageRepo = resolveManagedAppImageRepo(deployableApp, giteaConfig);
        if (!resolvedImageRepo) {
            const error = new Error('Managed app deployment requires a valid image repository from the configured Gitea registry host.');
            error.statusCode = 503;
            throw error;
        }

        if (resolvedImageRepo !== normalizeText(deployableApp.imageRepo)) {
            deployableApp = this.normalizeAppRecord(await this.store.updateApp(app.id, app.ownerId, {
                imageRepo: resolvedImageRepo,
                metadata: this.buildLifecycleMetadata(deployableApp, {
                    input,
                    phase: 'deploying',
                    desiredDeploy: {
                        imageRepo: resolvedImageRepo,
                    },
                }),
            }) || {
                ...deployableApp,
                imageRepo: resolvedImageRepo,
                metadata: this.buildLifecycleMetadata(deployableApp, {
                    input,
                    phase: 'deploying',
                    desiredDeploy: {
                        imageRepo: resolvedImageRepo,
                    },
                }),
            });
        }

        const image = `${resolvedImageRepo}:${imageTag}`;
        await this.broadcastLifecycleEvent(deployableApp, latestBuildRun, 'deploying', {
            summary: buildManagedAppStatusSummary(deployableApp, latestBuildRun, 'deploying'),
            deployment: {
                image,
            },
        });

        const deployResult = await this.kubernetesClient.deployManagedApp({
            slug: deployableApp.slug,
            namespace: deployableApp.namespace,
            publicHost: deployableApp.metadata?.desiredDeploy?.publicHost || deployableApp.publicHost,
            image,
            containerPort: Number(input.containerPort || deployableApp.metadata?.desiredDeploy?.containerPort || deployableApp.metadata?.requestedContainerPort || managedAppsConfig.defaultContainerPort || 80),
            registryPullSecretName: deployableApp.metadata?.desiredDeploy?.registryPullSecretName || managedAppsConfig.registryPullSecretName,
            registryHost: giteaConfig.registryHost,
            registryUsername: giteaConfig.registryUsername,
            registryPassword: giteaConfig.registryPassword,
            deploymentTarget,
        });

        const verificationStatus = deployResult.verification.https
            ? 'live'
            : (deployResult.verification.tls ? 'tls_ready' : 'pending_https');
        const lifecyclePhase = deployResult.verification.https
            ? 'live'
            : (deployResult.verification.tls ? 'tls_ready' : (deployResult.rollout.ok ? 'pending_https' : 'deploy_failed'));
        const appStatus = deployResult.verification.https
            ? 'live'
            : (deployResult.verification.rollout ? 'deployed' : 'deploy_failed');

        const updatedApp = this.normalizeAppRecord(await this.store.updateApp(app.id, app.ownerId, {
            namespace: normalizedNamespace,
            status: appStatus,
            metadata: this.buildLifecycleMetadata(deployableApp, {
                input,
                buildRun: latestBuildRun,
                phase: lifecyclePhase,
                desiredDeploy: {
                    deploymentTarget,
                    namespace: normalizedNamespace,
                    publicHost: deployableApp.publicHost,
                    imageRepo: resolvedImageRepo,
                    defaultBranch: deployableApp.defaultBranch,
                    containerPort: Number(input.containerPort || deployableApp.metadata?.desiredDeploy?.containerPort || managedAppsConfig.defaultContainerPort || 80),
                    ingressClassName: deployConfig.ingressClassName,
                    tlsClusterIssuer: deployConfig.tlsClusterIssuer,
                    registryPullSecretName: managedAppsConfig.registryPullSecretName,
                },
                liveDeploy: {
                    lastImage: image,
                    rollout: deployResult.verification?.rollout === true,
                    ingress: deployResult.verification?.ingress === true,
                    tls: deployResult.verification?.tls === true,
                    https: deployResult.verification?.https === true,
                    lastVerifiedAt: new Date().toISOString(),
                    lastError: normalizeText(deployResult.rollout?.error || deployResult.https?.error || ''),
                    lastDeployResult: deployResult,
                },
                project: {
                    nextStep: lifecyclePhase === 'live'
                        ? ''
                        : deriveNextStepForLifecycle(lifecyclePhase, { deployRequested: true }),
                },
            }),
        }));

        let buildRun = latestBuildRun;
        if (buildRun) {
            buildRun = await this.store.updateBuildRun(buildRun.id, {
                buildStatus: buildRun.buildStatus || 'success',
                deployRequested: true,
                deployStatus: deployResult.rollout.ok ? 'succeeded' : 'failed',
                verificationStatus,
                metadata: {
                    ...(buildRun.metadata || {}),
                    deployment: deployResult,
                },
                error: deployResult.rollout.ok ? {} : { message: deployResult.rollout.error || 'Deployment failed.' },
                finishedAt: new Date().toISOString(),
            });
        }

        this.recordClusterDeployment(updatedApp, {
            image,
            deployStatus: buildRun?.deployStatus || 'succeeded',
            verificationStatus,
            deployment: deployResult,
        });
        await this.broadcastLifecycleEvent(updatedApp, buildRun, lifecyclePhase, {
            deployment: {
                ...deployResult,
                image,
            },
            summary: buildManagedAppStatusSummary(updatedApp, buildRun, lifecyclePhase, {
                ...deployResult,
                image,
            }),
        });

        return {
            app: updatedApp,
            buildRun,
            deployment: deployResult,
            desiredDeploy: updatedApp.metadata?.desiredDeploy || null,
            liveDeploy: updatedApp.metadata?.liveDeploy || null,
            message: buildManagedAppStatusSummary(updatedApp, buildRun, lifecyclePhase, {
                ...deployResult,
                image,
            }),
        };
    }

    async handleBuildEvent(payload = {}) {
        await this.store.ensureAvailable();
        const repoOwner = normalizeText(payload.repoOwner || payload.owner || this.getEffectiveGiteaConfig().org);
        const repoName = normalizeText(payload.repoName || payload.repository || payload.slug);
        const slug = normalizeText(payload.slug || repoName);
        const commitSha = normalizeText(payload.commitSha || payload.sha);
        const imageTag = normalizeText(payload.imageTag || buildImageTagFromCommit(commitSha));
        const buildStatus = normalizeBuildStatus(payload.buildStatus || payload.status);
        const giteaConfig = this.getEffectiveGiteaConfig();
        const app = this.normalizeAppRecord(repoOwner && repoName
            ? await this.store.getAppByRepo(repoOwner, repoName)
            : await this.store.getAppBySlug(slug));
        if (!app) {
            const error = new Error(`Managed app not found for ${repoOwner || '(unknown-owner)'}/${repoName || slug}.`);
            error.statusCode = 404;
            throw error;
        }
        const imageRepo = resolveManagedAppImageRepo({
            ...app,
            imageRepo: payload.imageRepo || app.imageRepo,
            repoOwner: repoOwner || app.repoOwner,
            repoName: repoName || app.repoName,
            slug: slug || app.slug,
        }, giteaConfig);

        let buildRun = normalizeText(payload.runId)
            ? await this.store.getBuildRunByExternalRunId(normalizeText(payload.runId))
            : null;
        if (!buildRun && commitSha) {
            buildRun = await this.store.getBuildRunByCommitSha(app.id, commitSha);
        }
        if (!buildRun) {
            buildRun = await this.store.createBuildRun({
                appId: app.id,
                ownerId: app.ownerId,
                sessionId: app.sessionId,
                source: 'gitea-webhook',
                requestedAction: inferDeployRequested(payload.requestedAction || payload.action) ? 'deploy' : 'build',
                commitSha,
                imageTag,
                buildStatus,
                deployRequested: payload.deployRequested === true,
                deployStatus: payload.deployRequested === true ? 'pending' : 'not_requested',
                verificationStatus: 'pending',
                externalRunId: normalizeText(payload.runId) || null,
                externalRunUrl: normalizeText(payload.runUrl || ''),
                startedAt: payload.startedAt || null,
                finishedAt: payload.finishedAt || new Date().toISOString(),
                metadata: {
                    payload,
                },
            });
        } else {
            buildRun = await this.store.updateBuildRun(buildRun.id, {
                buildStatus,
                imageTag: imageTag || buildRun.imageTag,
                externalRunId: normalizeText(payload.runId) || buildRun.externalRunId,
                externalRunUrl: normalizeText(payload.runUrl || buildRun.externalRunUrl),
                metadata: {
                    ...(buildRun.metadata || {}),
                    payload,
                },
                finishedAt: payload.finishedAt || new Date().toISOString(),
                error: buildStatus === 'success' ? {} : { message: normalizeText(payload.error || payload.message || 'Build failed.') },
            });
        }

        if (buildStatus !== 'success') {
            const updatedApp = this.normalizeAppRecord(await this.store.updateApp(app.id, app.ownerId, {
                status: 'build_failed',
                metadata: {
                    ...this.buildLifecycleMetadata(app, {
                        input: payload,
                        buildRun,
                        phase: 'build_failed',
                        repoState: {
                            lastCommitSha: commitSha || app.metadata?.repoState?.lastCommitSha,
                            lastBuildRunId: buildRun.id,
                        },
                        liveDeploy: {
                            lastError: normalizeText(payload.error || payload.message || buildRun.error?.message || 'Build failed.'),
                        },
                    }),
                    lastFailedBuild: buildRun,
                },
            }));
            await this.broadcastLifecycleEvent(updatedApp, buildRun, 'build_failed');
            return {
                app: updatedApp,
                buildRun,
                deployed: false,
            };
        }

        const updatedApp = this.normalizeAppRecord(await this.store.updateApp(app.id, app.ownerId, {
            ...(imageRepo ? { imageRepo } : {}),
            status: buildRun.deployRequested ? 'deploying' : 'built',
            metadata: {
                ...this.buildLifecycleMetadata(app, {
                    input: payload,
                    buildRun,
                    phase: 'built',
                    repoState: {
                        initialized: true,
                        lastCommitSha: commitSha || app.metadata?.repoState?.lastCommitSha,
                        lastCommitAt: new Date().toISOString(),
                        lastBuildRunId: buildRun.id,
                    },
                    desiredDeploy: {
                        imageRepo: imageRepo || app.metadata?.desiredDeploy?.imageRepo,
                    },
                    liveDeploy: {
                        lastError: '',
                    },
                    project: {
                        nextStep: buildRun.deployRequested
                            ? 'Wait for deployment rollout and HTTPS verification to finish.'
                            : deriveNextStepForLifecycle('built'),
                    },
                }),
                lastSuccessfulBuild: {
                    commitSha,
                    imageTag,
                    ...(imageRepo ? { imageRepo } : {}),
                    ...(normalizeText(payload.platforms) ? { platforms: normalizeText(payload.platforms) } : {}),
                },
            },
        }));

        if (buildRun.deployRequested) {
            const deployed = await this.deployApp(updatedApp.id, {
                imageTag,
            }, updatedApp.ownerId, {
                sessionId: updatedApp.sessionId,
            });
            return {
                app: deployed.app,
                buildRun: deployed.buildRun,
                deployed: true,
                deployment: deployed.deployment,
            };
        }

        await this.broadcastLifecycleEvent(updatedApp, buildRun, 'built');
        return {
            app: updatedApp,
            buildRun,
            deployed: false,
        };
    }

    recordClusterDeployment(app = {}, details = {}) {
        const normalizedApp = this.normalizeAppRecord(app);
        const state = clusterStateRegistry.getState();
        const desiredDeploy = normalizedApp?.metadata?.desiredDeploy || {};
        const entry = clusterStateRegistry.ensureDeploymentEntry(state, {
            namespace: normalizedApp.namespace,
            deployment: normalizedApp.slug,
            publicDomain: normalizedApp.publicHost,
            repositoryUrl: normalizedApp.repoUrl,
            ref: normalizedApp.defaultBranch,
            ingressClassName: desiredDeploy.ingressClassName,
            tlsClusterIssuer: desiredDeploy.tlsClusterIssuer,
        });

        if (!entry) {
            return;
        }

        entry.lastTool = 'managed-app';
        entry.lastAction = 'deploy';
        entry.lastActionAt = new Date().toISOString();
        entry.lastStatus = normalizeText(details.deployStatus || 'succeeded').toLowerCase();
        entry.lastSuccessAt = new Date().toISOString();
        entry.lastError = normalizeText(details.error?.message || '');
        entry.lastStdout = normalizeText(details.image || '');
        entry.lastObjective = normalizeText(normalizedApp.metadata?.project?.currentObjective || normalizedApp.sourcePrompt || `Managed app ${normalizedApp.slug}`);
        entry.verification.rollout = details.deployment?.verification?.rollout === true;
        entry.verification.ingress = details.deployment?.verification?.ingress === true;
        entry.verification.tls = details.deployment?.verification?.tls === true;
        entry.verification.https = details.deployment?.verification?.https === true;
        entry.verification.lastVerifiedAt = new Date().toISOString();
        if (entry.verification.rollout) {
            entry.verification.lastRolloutAt = new Date().toISOString();
        }

        clusterStateRegistry.recordActivity(state, {
            toolId: 'managed-app',
            action: 'deploy',
            status: entry.lastStatus,
            namespace: normalizedApp.namespace,
            deployment: normalizedApp.slug,
            publicDomain: normalizedApp.publicHost,
            summary: `managed-app deploy ${entry.lastStatus} for ${normalizedApp.namespace}/${normalizedApp.slug}${normalizedApp.publicHost ? ` on ${normalizedApp.publicHost}` : ''}.`,
            error: entry.lastError,
        });
        clusterStateRegistry.saveState();
    }

    async persistLifecycleProjectMemory(app = null, buildRun = null, phase = '', details = {}) {
        if (!app?.sessionId || !this.sessionStore?.update || (!this.sessionStore?.get && !this.sessionStore?.getOwned)) {
            return null;
        }

        const normalizedApp = this.normalizeAppRecord(app);
        const summary = normalizeText(details.summary || buildManagedAppStatusSummary(normalizedApp, buildRun, phase, details.deployment || null));
        if (!summary) {
            return null;
        }

        try {
            const session = normalizedApp.ownerId && this.sessionStore.getOwned
                ? await this.sessionStore.getOwned(normalizedApp.sessionId, normalizedApp.ownerId)
                : await this.sessionStore.get(normalizedApp.sessionId);
            if (!session) {
                return null;
            }

            const assistantText = [
                summary,
                normalizeText(normalizedApp.repoUrl),
                normalizedApp.publicHost ? `https://${normalizedApp.publicHost}` : '',
                normalizeText(buildRun?.externalRunUrl || ''),
            ].filter(Boolean).join('\n');
            const projectMemory = mergeProjectMemory(
                session?.metadata?.projectMemory || {},
                buildProjectMemoryUpdate({
                    userText: normalizeText(normalizedApp.metadata?.project?.lastUserIntent || normalizedApp.sourcePrompt || ''),
                    assistantText,
                    toolEvents: [],
                    artifacts: [],
                }),
            );

            return this.sessionStore.update(normalizedApp.sessionId, {
                metadata: {
                    projectMemory,
                },
            });
        } catch (error) {
            console.warn(`[ManagedApp] Failed to persist lifecycle project memory for ${normalizedApp.slug || normalizedApp.id || 'managed-app'}: ${error.message}`);
            return null;
        }
    }

    async persistLifecycleMessage(app = null, buildRun = null, phase = '', details = {}) {
        if (!app?.sessionId || !this.sessionStore?.upsertMessage) {
            return null;
        }

        const summary = normalizeText(details.summary || buildManagedAppStatusSummary(app, buildRun, phase, details.deployment || null));
        if (!summary) {
            return null;
        }

        try {
            return await this.sessionStore.upsertMessage(app.sessionId, {
                id: buildLifecycleMessageKey(app, buildRun, phase),
                role: 'assistant',
                content: summary,
                timestamp: new Date().toISOString(),
                metadata: {
                    managedAppLifecycle: true,
                    managedAppPhase: normalizeText(phase).toLowerCase() || 'updated',
                    managedAppId: normalizeText(app?.id),
                    managedAppSlug: normalizeText(app?.slug),
                    buildRunId: normalizeText(buildRun?.id),
                    publicHost: normalizeText(app?.publicHost),
                    ...(details.deployment ? { deployment: details.deployment } : {}),
                },
            });
        } catch (error) {
            console.warn(`[ManagedApp] Failed to persist lifecycle message for ${app.slug || app.id || 'managed-app'}: ${error.message}`);
            return null;
        }
    }

    async broadcastLifecycleEvent(app = null, buildRun = null, phase = '', details = {}) {
        const summary = normalizeText(details.summary || buildManagedAppStatusSummary(app, buildRun, phase, details.deployment || null));
        await this.persistLifecycleMessage(app, buildRun, phase, {
            ...details,
            summary,
        });
        await this.persistLifecycleProjectMemory(app, buildRun, phase, {
            ...details,
            summary,
        });
        const payload = {
            type: 'managed-app',
            phase,
            app,
            buildRun,
            summary,
            ...(details.deployment ? { deployment: details.deployment } : {}),
        };
        broadcastToAdmins(payload);
        if (app?.sessionId) {
            broadcastToSession(app.sessionId, payload);
        }
    }

    buildPromptSummary({ ownerId = null, maxApps = 4 } = {}) {
        if (!this.isAvailable() || !ownerId) {
            return '';
        }

        const lines = [];
        return Promise.resolve(this.store.listApps(ownerId, maxApps))
            .then((apps) => {
                const normalizedApps = this.normalizeAppList(apps);
                if (!Array.isArray(normalizedApps) || normalizedApps.length === 0) {
                    return 'Managed app catalog: no managed apps exist yet for this user. If they ask to create, build, or deploy a new managed app, create the first one directly instead of asking them to choose an existing app.';
                }
                normalizedApps.slice(0, Math.max(1, maxApps)).forEach((app) => {
                    const summary = normalizeText(app.metadata?.project?.summary);
                    const nextStep = normalizeText(app.metadata?.project?.nextStep);
                    lines.push(`Managed app ${app.slug}: status ${app.status}, target ${normalizeDeployTarget(app.metadata?.desiredDeploy?.deploymentTarget) || 'ssh'}, repo ${app.repoOwner}/${app.repoName}, host ${app.publicHost}, namespace ${app.namespace}.${summary ? ` Summary: ${summary}` : ''}${nextStep ? ` Next: ${nextStep}` : ''}`);
                });
                return lines.join('\n');
            })
            .catch(() => '');
    }

    async getRuntimeSummary(ownerId = null) {
        const giteaConfig = this.getEffectiveGiteaConfig();
        const managedAppsConfig = this.getEffectiveManagedAppsConfig();
        const apps = ownerId && this.isAvailable()
            ? this.normalizeAppList(await this.store.listApps(ownerId, 10))
            : [];
        return {
            configured: this.giteaClient.isConfigured(),
            persistenceAvailable: this.isAvailable(),
            kubernetesConfigured: this.kubernetesClient.isConfigured(),
            gitea: {
                baseURL: giteaConfig.baseURL,
                org: giteaConfig.org,
                registryHost: giteaConfig.registryHost,
            },
            defaults: {
                appBaseDomain: managedAppsConfig.appBaseDomain,
                namespacePrefix: managedAppsConfig.namespacePrefix,
                platformNamespace: managedAppsConfig.platformNamespace,
                defaultBranch: managedAppsConfig.defaultBranch,
            },
            appCount: apps.length,
            apps,
        };
    }
}

module.exports = {
    ManagedAppService,
};
