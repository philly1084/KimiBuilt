'use strict';

const { createHash } = require('crypto');
const { config } = require('../config');
const settingsController = require('../routes/admin/settings.controller');
const { clusterStateRegistry } = require('../cluster-state-registry');
const { broadcastToAdmins, broadcastToSession } = require('../realtime-hub');
const { managedAppStore } = require('./store');
const { GiteaClient } = require('./gitea-client');
const { KubernetesClient } = require('./kubernetes-client');
const { buildDefaultScaffoldFiles } = require('./scaffold');

function normalizeText(value = '') {
    return String(value || '').trim();
}

const MAX_MANAGED_APP_SLUG_LENGTH = 63;
const MAX_KUBERNETES_NAME_LENGTH = 63;

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

    const stopwords = new Set([
        'a', 'an', 'and', 'app', 'application', 'build', 'called', 'create', 'deploy', 'for', 'generate',
        'it', 'make', 'managed', 'named', 'page', 'please', 'simple', 'site', 'the', 'this', 'to', 'website',
    ]);
    const meaningful = tokens.filter((token) => !stopwords.has(token));
    const selected = (meaningful.length > 0 ? meaningful : tokens).slice(0, 6);
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

function buildImageTagFromCommit(commitSha = '') {
    const normalized = normalizeText(commitSha);
    return normalized ? `sha-${normalized.slice(0, 12)}` : '';
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

class ManagedAppService {
    constructor(options = {}) {
        this.store = options.store || managedAppStore;
        this.giteaClient = options.giteaClient || new GiteaClient();
        this.kubernetesClient = options.kubernetesClient || new KubernetesClient();
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

    buildAppBlueprint(input = {}, ownerId = null, sessionId = null) {
        const giteaConfig = this.getEffectiveGiteaConfig();
        const managedAppsConfig = this.getEffectiveManagedAppsConfig();
        const explicitPromptName = extractExplicitAppName(input.prompt || input.sourcePrompt || '');
        const rawName = deriveRequestedAppName(input) || `app-${Date.now()}`;
        const slug = slugify(input.slug || rawName || `app-${Date.now()}`, {
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
        const imageRepo = normalizeText(input.imageRepo || `${giteaConfig.registryHost}/${repoOwner}/${repoName}`);
        const namespace = slugify(input.namespace || `${managedAppsConfig.namespacePrefix || 'app-'}${slug}`, {
            maxLength: MAX_KUBERNETES_NAME_LENGTH,
        });
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
            },
        };
    }

    buildRepositoryFiles(app = {}, input = {}) {
        const files = normalizeFilesInput(input.files);
        if (files.length > 0) {
            return files;
        }

        return buildDefaultScaffoldFiles({
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
        const blueprint = this.buildAppBlueprint(input, ownerId, sessionId);
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
                files: this.buildRepositoryFiles(persistedApp, input),
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
        if (!this.kubernetesClient.isConfigured()) {
            const error = new Error('Managed app deployment requires in-cluster Kubernetes API access.');
            error.statusCode = 503;
            throw error;
        }
        const app = await this.resolveApp(appRef, ownerId);
        if (!app) {
            return null;
        }

        const latestBuildRun = (await this.store.listBuildRunsForApp(app.id, ownerId, 1))[0] || null;
        const imageTag = normalizeText(input.imageTag || latestBuildRun?.imageTag || 'latest');
        const image = `${app.imageRepo}:${imageTag}`;
        const giteaConfig = this.getEffectiveGiteaConfig();
        const managedAppsConfig = this.getEffectiveManagedAppsConfig();

        const deployResult = await this.kubernetesClient.deployManagedApp({
            slug: app.slug,
            namespace: app.namespace,
            publicHost: app.publicHost,
            image,
            containerPort: Number(input.containerPort || app.metadata?.requestedContainerPort || managedAppsConfig.defaultContainerPort || 80),
            registryPullSecretName: managedAppsConfig.registryPullSecretName,
            registryHost: giteaConfig.registryHost,
            registryUsername: giteaConfig.registryUsername,
            registryPassword: giteaConfig.registryPassword,
        });

        const verificationStatus = deployResult.verification.https
            ? 'live'
            : (deployResult.verification.tls ? 'tls_ready' : 'pending_https');
        const appStatus = deployResult.verification.https
            ? 'live'
            : (deployResult.verification.rollout ? 'deployed' : 'deploy_failed');

        const updatedApp = await this.store.updateApp(app.id, app.ownerId, {
            status: appStatus,
            metadata: {
                ...(app.metadata || {}),
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
            message: `${updatedApp.appName} deployed to ${updatedApp.publicHost}.`,
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
        const app = repoOwner && repoName
            ? await this.store.getAppByRepo(repoOwner, repoName)
            : await this.store.getAppBySlug(slug);
        if (!app) {
            const error = new Error(`Managed app not found for ${repoOwner || '(unknown-owner)'}/${repoName || slug}.`);
            error.statusCode = 404;
            throw error;
        }

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
            status: buildRun.deployRequested ? 'deploying' : 'built',
            metadata: {
                ...(app.metadata || {}),
                lastSuccessfulBuild: {
                    commitSha,
                    imageTag,
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
                    lines.push(`Managed app ${app.slug}: status ${app.status}, repo ${app.repoOwner}/${app.repoName}, host ${app.publicHost}, namespace ${app.namespace}.`);
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
