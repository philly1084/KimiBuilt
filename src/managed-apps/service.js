'use strict';

const { createHash } = require('crypto');
const { config } = require('../config');
const settingsController = require('../routes/admin/settings.controller');
const { clusterStateRegistry } = require('../cluster-state-registry');
const { broadcastToAdmins, broadcastToSession } = require('../realtime-hub');
const { createResponse } = require('../openai-client');
const { extractResponseText } = require('../artifacts/artifact-service');
const { parseLenientJson } = require('../utils/lenient-json');
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

class ManagedAppService {
    constructor(options = {}) {
        this.store = options.store || managedAppStore;
        this.giteaClient = options.giteaClient || new GiteaClient();
        this.kubernetesClient = options.kubernetesClient || new KubernetesClient();
        this.llmClient = options.llmClient || createManagedAppLlmClient();
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
        return normalizeText(settingsController.settings?.api?.baseURL || process.env.API_BASE_URL || '').replace(/\/+$/, '');
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

    async resolveApp(ref = '', ownerId = null) {
        const reference = normalizeText(ref);
        if (!reference) {
            return null;
        }

        const repoReference = parseManagedAppRepoReference(reference);
        if (repoReference) {
            const byRepo = await this.store.getAppByRepo(repoReference.repoOwner, repoReference.repoName);
            if (byRepo) {
                return byRepo;
            }
        }

        const byId = await this.store.getAppById(reference, ownerId);
        if (byId) {
            return byId;
        }

        const bySlug = await this.store.getAppBySlug(reference, ownerId);
        if (bySlug) {
            return bySlug;
        }

        return repoReference
            ? this.store.getAppBySlug(repoReference.repoName, ownerId)
            : null;
    }

    async listApps(ownerId, limit = 50) {
        await this.store.ensureAvailable();
        return this.store.listApps(ownerId, limit);
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
            message: buildPlatformDoctorMessage(platform, healthy),
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
            message: `Managed app platform reconciliation on ${normalizeText(platform.executionHost || reconciliation.executionHost || 'remote ssh target')}: ${reconciliation.actions.join(', ') || 'no changes reported'}; ${healthy ? 'platform healthy' : 'platform still needs attention'}.`,
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

        return {
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
            metadata: {
                ...(input.metadata || {}),
                managedBy: 'kimibuilt',
                requestedContainerPort: Number(input.containerPort || managedAppsConfig.defaultContainerPort || 80),
                deploymentTarget,
            },
        };
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
        const existing = await this.store.getAppBySlug(blueprint.slug, ownerId);

        const app = existing
            ? await this.store.updateApp(existing.id, ownerId, {
                appName: blueprint.appName,
                repoOwner: blueprint.repoOwner,
                repoName: blueprint.repoName,
                repoUrl: blueprint.repoUrl,
                repoCloneUrl: blueprint.repoCloneUrl,
                repoSshUrl: blueprint.repoSshUrl,
                defaultBranch: blueprint.defaultBranch,
                imageRepo: blueprint.imageRepo,
                namespace: blueprint.namespace,
                publicHost: blueprint.publicHost,
                sourcePrompt: blueprint.sourcePrompt || existing.sourcePrompt,
                metadata: {
                    ...(existing.metadata || {}),
                    ...(blueprint.metadata || {}),
                },
                status: 'provisioning',
                sessionId,
            })
            : await this.store.createApp({
                ...blueprint,
                status: 'provisioning',
            });
        const persistedApp = await this.ensurePersistedApp(app, {
            ...blueprint,
            status: 'provisioning',
        }, ownerId);

        let repository = {
            html_url: persistedApp.repoUrl,
            clone_url: persistedApp.repoCloneUrl,
            ssh_url: persistedApp.repoSshUrl,
        };
        let commitSha = '';
        let committedPaths = [];
        const effectiveRepoOwner = normalizeText(persistedApp.repoOwner || blueprint.repoOwner);
        const effectiveRepoName = normalizeText(persistedApp.repoName || blueprint.repoName);

        if (this.giteaClient.isConfigured()) {
            await this.giteaClient.ensureOrganization({
                name: effectiveRepoOwner,
                fullName: 'KimiBuilt Managed Apps',
                description: 'Application repositories provisioned by KimiBuilt.',
            });
            const ensuredRepo = await this.giteaClient.ensureRepository({
                owner: effectiveRepoOwner,
                name: effectiveRepoName,
                description: `Managed app for ${persistedApp.appName}`,
                defaultBranch: persistedApp.defaultBranch,
            });
            repository = ensuredRepo.repository || repository;

            const seedResult = await this.giteaClient.upsertFiles({
                owner: effectiveRepoOwner,
                repo: effectiveRepoName,
                branch: persistedApp.defaultBranch,
                files: await this.buildRepositoryFiles(persistedApp, input, context),
                commitMessagePrefix: existing ? 'Update managed app' : 'Seed managed app',
            });
            commitSha = seedResult.commitSha;
            committedPaths = seedResult.committedPaths;
        }

        const updatedApp = await this.store.updateApp(persistedApp.id, ownerId, {
            repoOwner: effectiveRepoOwner,
            repoName: effectiveRepoName,
            repoUrl: normalizeText(repository.clone_url || repository.html_url || persistedApp.repoUrl),
            repoCloneUrl: normalizeText(repository.clone_url || persistedApp.repoCloneUrl),
            repoSshUrl: normalizeText(repository.ssh_url || persistedApp.repoSshUrl),
            status: commitSha ? 'building' : 'repo_ready',
            metadata: {
                ...(persistedApp.metadata || {}),
                deploymentTarget: blueprint.metadata?.deploymentTarget
                    || persistedApp.metadata?.deploymentTarget
                    || 'ssh',
                lastSeededPaths: committedPaths,
            },
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
                    trigger: existing ? 'update' : 'create',
                    committedPaths,
                },
            })
            : null;

        const finalApp = finalPersistedApp || updatedApp || persistedApp;
        this.broadcastLifecycleEvent(finalApp, buildRun, existing ? 'updated' : 'created');

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
            message: commitSha
                ? `${finalApp.appName} is queued for image build from ${finalApp.repoOwner}/${finalApp.repoName}.`
                : `${finalApp.appName} was registered without repository changes.`,
        };
    }

    async updateApp(appRef = '', input = {}, ownerId = null, context = {}) {
        const app = await this.resolveApp(appRef, ownerId);
        if (!app) {
            return null;
        }

        return this.createApp({
            ...input,
            slug: app.slug,
            appName: input.appName || app.appName,
            sourcePrompt: input.sourcePrompt || input.prompt || app.sourcePrompt,
        }, ownerId, {
            ...context,
            sessionId: context.sessionId || app.sessionId,
        });
    }

    async deployApp(appRef = '', input = {}, ownerId = null, context = {}) {
        const app = await this.resolveApp(appRef, ownerId);
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
        const normalizedNamespace = normalizeManagedAppNamespace(
            input.namespace || app.namespace,
            {
                slug: app.slug,
                namespacePrefix: managedAppsConfig.namespacePrefix || 'app-',
            },
        );
        let deployableApp = app;

        if (normalizedNamespace !== normalizeText(app.namespace)) {
            deployableApp = await this.store.updateApp(app.id, app.ownerId, {
                namespace: normalizedNamespace,
                metadata: {
                    ...(app.metadata || {}),
                    deploymentTarget,
                },
            }) || {
                ...app,
                namespace: normalizedNamespace,
                metadata: {
                    ...(app.metadata || {}),
                    deploymentTarget,
                },
            };
        }

        const resolvedImageRepo = resolveManagedAppImageRepo(deployableApp, giteaConfig);
        if (!resolvedImageRepo) {
            const error = new Error('Managed app deployment requires a valid image repository from the configured Gitea registry host.');
            error.statusCode = 503;
            throw error;
        }

        if (resolvedImageRepo !== normalizeText(deployableApp.imageRepo)) {
            deployableApp = await this.store.updateApp(app.id, app.ownerId, {
                imageRepo: resolvedImageRepo,
                metadata: {
                    ...(deployableApp.metadata || {}),
                    deploymentTarget,
                },
            }) || {
                ...deployableApp,
                imageRepo: resolvedImageRepo,
                metadata: {
                    ...(deployableApp.metadata || {}),
                    deploymentTarget,
                },
            };
        }

        const image = `${resolvedImageRepo}:${imageTag}`;

        const deployResult = await this.kubernetesClient.deployManagedApp({
            slug: deployableApp.slug,
            namespace: deployableApp.namespace,
            publicHost: deployableApp.publicHost,
            image,
            containerPort: Number(input.containerPort || deployableApp.metadata?.requestedContainerPort || managedAppsConfig.defaultContainerPort || 80),
            registryPullSecretName: managedAppsConfig.registryPullSecretName,
            registryHost: giteaConfig.registryHost,
            registryUsername: giteaConfig.registryUsername,
            registryPassword: giteaConfig.registryPassword,
            deploymentTarget,
        });

        const verificationStatus = deployResult.verification.https
            ? 'live'
            : (deployResult.verification.tls ? 'tls_ready' : 'pending_https');
        const appStatus = deployResult.verification.https
            ? 'live'
            : (deployResult.verification.rollout ? 'deployed' : 'deploy_failed');

        const updatedApp = await this.store.updateApp(app.id, app.ownerId, {
            namespace: normalizedNamespace,
            status: appStatus,
            metadata: {
                ...(deployableApp.metadata || {}),
                deploymentTarget,
                lastImage: image,
                lastDeployResult: deployResult,
            },
        });

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
        this.broadcastLifecycleEvent(updatedApp, buildRun, 'deployed');

        return {
            app: updatedApp,
            buildRun,
            deployment: deployResult,
            message: `${updatedApp.appName} deployed to ${updatedApp.publicHost} via ${deploymentTarget}.`,
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
        const app = repoOwner && repoName
            ? await this.store.getAppByRepo(repoOwner, repoName)
            : await this.store.getAppBySlug(slug);
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
            const updatedApp = await this.store.updateApp(app.id, app.ownerId, {
                status: 'build_failed',
                metadata: {
                    ...(app.metadata || {}),
                    lastFailedBuild: buildRun,
                },
            });
            this.broadcastLifecycleEvent(updatedApp, buildRun, 'build_failed');
            return {
                app: updatedApp,
                buildRun,
                deployed: false,
            };
        }

        const updatedApp = await this.store.updateApp(app.id, app.ownerId, {
            ...(imageRepo ? { imageRepo } : {}),
            status: buildRun.deployRequested ? 'deploying' : 'built',
            metadata: {
                ...(app.metadata || {}),
                lastSuccessfulBuild: {
                    commitSha,
                    imageTag,
                    ...(imageRepo ? { imageRepo } : {}),
                    ...(normalizeText(payload.platforms) ? { platforms: normalizeText(payload.platforms) } : {}),
                },
            },
        });

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

        this.broadcastLifecycleEvent(updatedApp, buildRun, 'built');
        return {
            app: updatedApp,
            buildRun,
            deployed: false,
        };
    }

    recordClusterDeployment(app = {}, details = {}) {
        const state = clusterStateRegistry.getState();
        const deployConfig = this.getEffectiveDeployConfig();
        const entry = clusterStateRegistry.ensureDeploymentEntry(state, {
            namespace: app.namespace,
            deployment: app.slug,
            publicDomain: app.publicHost,
            repositoryUrl: app.repoUrl,
            ref: app.defaultBranch,
            ingressClassName: deployConfig.ingressClassName,
            tlsClusterIssuer: deployConfig.tlsClusterIssuer,
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
        entry.lastObjective = normalizeText(app.sourcePrompt || `Managed app ${app.slug}`);
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
            namespace: app.namespace,
            deployment: app.slug,
            publicDomain: app.publicHost,
            summary: `managed-app deploy ${entry.lastStatus} for ${app.namespace}/${app.slug}${app.publicHost ? ` on ${app.publicHost}` : ''}.`,
            error: entry.lastError,
        });
        clusterStateRegistry.saveState();
    }

    broadcastLifecycleEvent(app = null, buildRun = null, phase = '') {
        const payload = {
            type: 'managed-app',
            phase,
            app,
            buildRun,
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
                if (!Array.isArray(apps) || apps.length === 0) {
                    return 'Managed app catalog: no managed apps exist yet for this user. If they ask to create, build, or deploy a new managed app, create the first one directly instead of asking them to choose an existing app.';
                }
                apps.slice(0, Math.max(1, maxApps)).forEach((app) => {
                    lines.push(`Managed app ${app.slug}: status ${app.status}, target ${normalizeDeployTarget(app.metadata?.deploymentTarget) || 'unspecified'}, repo ${app.repoOwner}/${app.repoName}, host ${app.publicHost}, namespace ${app.namespace}.`);
                });
                return lines.join('\n');
            })
            .catch(() => '');
    }

    async getRuntimeSummary(ownerId = null) {
        const giteaConfig = this.getEffectiveGiteaConfig();
        const managedAppsConfig = this.getEffectiveManagedAppsConfig();
        const apps = ownerId && this.isAvailable()
            ? await this.store.listApps(ownerId, 10)
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
