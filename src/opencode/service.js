'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const { spawn } = require('child_process');

const { config } = require('../config');
const { listModels } = require('../openai-client');
const settingsController = require('../routes/admin/settings.controller');
const { broadcastToAdmins, broadcastToSession } = require('../realtime-hub');
const { OpenCodeLocalClient, OpenCodeRemoteClient, extractMessageText } = require('./client');
const {
    assertRemoteGatewayBaseURLReachable,
    resolveOpenCodeGatewayApiKey,
    resolveOpenCodeGatewayBaseURL,
} = require('./gateway');
const { opencodeStore, RUN_STATUS } = require('./store');

const DEFAULT_INSTANCE_HEALTH_TIMEOUT_MS = 30000;

class OpenCodeService {
    constructor({
        sessionStore,
        store = opencodeStore,
    }) {
        this.sessionStore = sessionStore;
        this.store = store;
        this.instances = new Map();
        this.activeRunTasks = new Map();
        this.runEventBus = new EventEmitter();
        this.runSessionMap = new Map();
        this.instanceRunMap = new Map();
    }

    isAvailable() {
        return this.store.isAvailable();
    }

    getEffectiveConfig() {
        if (typeof settingsController.getEffectiveOpencodeConfig === 'function') {
            return settingsController.getEffectiveOpencodeConfig();
        }

        return config.opencode || {};
    }

    getRuntimeSummary() {
        const effective = this.getEffectiveConfig();
        const ssh = typeof settingsController.getEffectiveSshConfig === 'function'
            ? settingsController.getEffectiveSshConfig()
            : {};

        return {
            enabled: effective.enabled !== false,
            binaryPath: effective.binaryPath || 'opencode',
            defaultAgent: effective.defaultAgent || 'build',
            defaultModel: effective.defaultModel || '',
            gatewayBaseURL: resolveOpenCodeGatewayBaseURL({ target: 'remote-default' }),
            localGatewayBaseURL: resolveOpenCodeGatewayBaseURL({ target: 'local' }),
            allowedWorkspaceRoots: effective.allowedWorkspaceRoots || [],
            remoteDefaultWorkspace: effective.remoteDefaultWorkspace || '',
            providerEnvAllowlist: effective.providerEnvAllowlist || [],
            remoteAutoInstall: effective.remoteAutoInstall === true,
            sshConfigured: Boolean(ssh.enabled && ssh.host && ssh.username && (ssh.password || ssh.privateKeyPath)),
            activeInstances: this.instances.size,
        };
    }

    async ensureAvailable() {
        if (!this.isAvailable()) {
            const error = new Error('OpenCode runs require Postgres persistence');
            error.statusCode = 503;
            throw error;
        }
    }

    normalizeRunRequest(input = {}, context = {}) {
        const effective = this.getEffectiveConfig();
        if (effective.enabled === false) {
            const error = new Error('OpenCode integration is disabled');
            error.statusCode = 503;
            throw error;
        }

        const prompt = String(input.prompt || input.message || '').trim();
        if (!prompt) {
            const error = new Error('prompt is required');
            error.statusCode = 400;
            throw error;
        }

        const target = String(input.target || '').trim().toLowerCase() || 'local';
        if (!['local', 'remote-default'].includes(target)) {
            const error = new Error('target must be "local" or "remote-default"');
            error.statusCode = 400;
            throw error;
        }

        const workspacePath = this.resolveWorkspacePath({
            requestedPath: input.workspacePath || input.workspace_path || '',
            target,
            effectiveConfig: effective,
        });
        const agent = String(input.agent || effective.defaultAgent || 'build').trim().toLowerCase() || 'build';
        const model = String(input.model || effective.defaultModel || '').trim() || null;
        const approvalMode = String(input.approvalMode || input.approval_mode || 'manual').trim().toLowerCase() || 'manual';
        if (!['manual', 'auto'].includes(approvalMode)) {
            const error = new Error('approvalMode must be "manual" or "auto"');
            error.statusCode = 400;
            throw error;
        }

        return {
            prompt,
            target,
            workspacePath,
            sessionId: normalizeOptionalString(input.sessionId || context.sessionId),
            opencodeSessionId: normalizeOptionalString(input.opencodeSessionId || input.opencode_session_id),
            agent,
            model,
            async: input.async === true,
            approvalMode,
            metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
                ? { ...input.metadata }
                : {},
        };
    }

    resolveWorkspacePath({ requestedPath = '', target = 'local', effectiveConfig = {} }) {
        const configuredRoots = Array.isArray(effectiveConfig.allowedWorkspaceRoots)
            ? effectiveConfig.allowedWorkspaceRoots.filter(Boolean)
            : [];
        const remoteDefaultWorkspace = String(effectiveConfig.remoteDefaultWorkspace || '').trim();

        if (target === 'remote-default') {
            const remotePath = String(requestedPath || remoteDefaultWorkspace || '').trim();
            if (!remotePath) {
                const error = new Error('workspacePath is required for remote-default OpenCode runs');
                error.statusCode = 400;
                throw error;
            }
            if (remoteDefaultWorkspace && !remotePath.startsWith(remoteDefaultWorkspace)) {
                const error = new Error(`Remote workspacePath must be inside ${remoteDefaultWorkspace}`);
                error.statusCode = 400;
                throw error;
            }
            return remotePath;
        }

        const candidate = path.resolve(String(requestedPath || configuredRoots[0] || config.deploy.defaultRepositoryPath || process.cwd()));
        if (configuredRoots.length > 0 && !configuredRoots.some((root) => isPathInside(candidate, path.resolve(root)))) {
            const error = new Error(`workspacePath must be inside one of: ${configuredRoots.join(', ')}`);
            error.statusCode = 400;
            throw error;
        }

        return candidate;
    }

    async runTool(params = {}, context = {}) {
        const normalized = this.normalizeRunRequest(params, context);
        const ownerId = normalizeOptionalString(context.ownerId || context.userId) || 'anonymous';
        const run = await this.createRun(normalized, ownerId, {
            requirePersistence: true,
        });

        if (normalized.async) {
            return {
                async: true,
                runId: run.id,
                status: run.status,
                sessionId: run.sessionId,
                target: run.target,
                workspacePath: run.workspacePath,
                message: `Queued OpenCode ${run.agent} run ${run.id}.`,
            };
        }

        return {
            async: false,
            runId: run.id,
            status: run.status,
            sessionId: run.sessionId,
            opencodeSessionId: run.opencodeSessionId,
            target: run.target,
            workspacePath: run.workspacePath,
            agent: run.agent,
            model: run.model,
            summary: run.summary,
            diff: run.diff,
            metadata: run.metadata,
        };
    }

    async createRun(input = {}, ownerId = null, { requirePersistence = true } = {}) {
        const normalized = this.normalizeRunRequest(input);
        if (requirePersistence) {
            await this.ensureAvailable();
        }

        const run = await this.store.createRun({
            ownerId,
            sessionId: normalized.sessionId,
            opencodeSessionId: normalized.opencodeSessionId,
            target: normalized.target,
            workspacePath: normalized.workspacePath,
            prompt: normalized.prompt,
            agent: normalized.agent,
            model: normalized.model,
            approvalMode: normalized.approvalMode,
            async: normalized.async,
            status: RUN_STATUS.QUEUED,
            metadata: normalized.metadata,
        });
        await this.recordRunEvent(run.id, 'queued', {
            target: run.target,
            workspacePath: run.workspacePath,
            agent: run.agent,
            async: run.async,
        }, { run });
        await this.maybeMirrorRunStatus(run, 'queued');

        if (normalized.async) {
            setImmediate(() => {
                this.executePersistentRun(run.id).catch((error) => {
                    console.error(`[OpenCode] Async run ${run.id} failed:`, error.message);
                });
            });
            return run;
        }

        return this.executePersistentRun(run.id);
    }

    async executePersistentRun(runId) {
        if (this.activeRunTasks.has(runId)) {
            return this.activeRunTasks.get(runId);
        }

        const task = this.executePersistentRunInternal(runId)
            .finally(() => {
                this.activeRunTasks.delete(runId);
            });
        this.activeRunTasks.set(runId, task);
        return task;
    }

    async executePersistentRunInternal(runId) {
        await this.ensureAvailable();
        let run = await this.store.getRunById(runId);
        if (!run) {
            const error = new Error('OpenCode run not found');
            error.statusCode = 404;
            throw error;
        }

        let instance = null;
        let opencodeSessionId = run.opencodeSessionId || null;

        try {
            run = await this.store.updateRun(run.id, {
                status: RUN_STATUS.STARTING,
                startedAt: run.startedAt || new Date().toISOString(),
            });
            await this.recordRunEvent(run.id, 'starting', {}, { run });
            await this.maybeMirrorRunStatus(run, 'starting');

            instance = await this.ensureInstance(run.target, run.workspacePath, run.approvalMode);
            opencodeSessionId = await this.resolveOpencodeSessionId(run, instance);
            run = await this.store.updateRun(run.id, {
                opencodeSessionId,
                status: RUN_STATUS.RUNNING,
                startedAt: run.startedAt || new Date().toISOString(),
                metadata: {
                    ...(run.metadata || {}),
                    instanceKey: instance.key,
                    serverPort: instance.port,
                },
            });
            this.trackRun(run.id, instance.key, opencodeSessionId);
            await this.recordRunEvent(run.id, 'started', {
                opencodeSessionId,
                instanceKey: instance.key,
            }, { run });
            await this.maybeMirrorRunStatus(run, 'started');
            await this.maybePersistSessionRuntimeMetadata(run);

            const response = await instance.client.sendMessage(opencodeSessionId, {
                agent: run.agent,
                ...(run.model ? { model: run.model } : {}),
                parts: [{
                    type: 'text',
                    text: run.prompt,
                }],
            });
            const summary = extractMessageText(response);
            const diff = await instance.client.getSessionDiff(opencodeSessionId).catch(() => []);
            run = await this.store.updateRun(run.id, {
                status: RUN_STATUS.COMPLETED,
                summary,
                diff,
                error: {},
                finishedAt: new Date().toISOString(),
                metadata: {
                    ...(run.metadata || {}),
                    lastMessage: response?.info || null,
                },
            });
            await this.recordRunEvent(run.id, 'completed', {
                summary,
                diffCount: Array.isArray(diff) ? diff.length : 0,
            }, { run });
            await this.maybeMirrorRunCompletion(run);
            this.untrackRun(run.id, instance.key, opencodeSessionId);
            return run;
        } catch (error) {
            const latestRun = await this.store.getRunById(run.id);
            if (latestRun?.status === RUN_STATUS.CANCELLED) {
                if (instance?.key) {
                    this.untrackRun(latestRun.id, instance.key, opencodeSessionId || latestRun.opencodeSessionId);
                }
                return latestRun;
            }

            const failedRun = await this.store.updateRun(run.id, {
                opencodeSessionId: latestRun?.opencodeSessionId || opencodeSessionId || run.opencodeSessionId || null,
                status: RUN_STATUS.FAILED,
                error: serializeError(error),
                finishedAt: new Date().toISOString(),
                metadata: {
                    ...((latestRun || run).metadata || {}),
                    lastFailureAt: new Date().toISOString(),
                },
            });
            await this.recordRunEvent(failedRun.id, 'failed', {
                error: serializeError(error),
            }, { run: failedRun });
            await this.maybeMirrorRunStatus(failedRun, 'failed', {
                error: error.message,
            });
            if (instance?.key) {
                this.untrackRun(failedRun.id, instance.key, failedRun.opencodeSessionId || opencodeSessionId);
            }
            throw error;
        }
    }

    async getRun(runId, ownerId = null) {
        await this.ensureAvailable();
        return this.store.getRunById(runId, ownerId);
    }

    async listRunEvents(runId, ownerId = null, options = {}) {
        await this.ensureAvailable();
        const run = await this.store.getRunById(runId, ownerId);
        if (!run) {
            const error = new Error('OpenCode run not found');
            error.statusCode = 404;
            throw error;
        }
        return this.store.listRunEvents(runId, options);
    }

    subscribeToRunEvents(runId, listener) {
        const eventName = `run:${runId}`;
        this.runEventBus.on(eventName, listener);
        return () => {
            this.runEventBus.off(eventName, listener);
        };
    }

    async cancelRun(runId, ownerId = null) {
        await this.ensureAvailable();
        const run = await this.store.getRunById(runId, ownerId);
        if (!run) {
            const error = new Error('OpenCode run not found');
            error.statusCode = 404;
            throw error;
        }

        if (!run.opencodeSessionId) {
            return this.store.updateRun(run.id, {
                status: RUN_STATUS.CANCELLED,
                finishedAt: new Date().toISOString(),
            });
        }

        const instance = await this.ensureInstance(run.target, run.workspacePath, run.approvalMode);
        await instance.client.abortSession(run.opencodeSessionId);
        const updated = await this.store.updateRun(run.id, {
            status: RUN_STATUS.CANCELLED,
            finishedAt: new Date().toISOString(),
            metadata: {
                ...(run.metadata || {}),
                cancelledAt: new Date().toISOString(),
            },
        });
        await this.recordRunEvent(updated.id, 'cancelled', {}, { run: updated });
        await this.maybeMirrorRunStatus(updated, 'cancelled');
        this.untrackRun(updated.id, instance.key, run.opencodeSessionId);
        return updated;
    }

    async respondToPermission(runId, permissionId, body = {}, ownerId = null) {
        await this.ensureAvailable();
        const run = await this.store.getRunById(runId, ownerId);
        if (!run) {
            const error = new Error('OpenCode run not found');
            error.statusCode = 404;
            throw error;
        }
        if (!run.opencodeSessionId) {
            const error = new Error('OpenCode session is not ready yet');
            error.statusCode = 409;
            throw error;
        }

        const instance = await this.ensureInstance(run.target, run.workspacePath, run.approvalMode);
        const response = normalizePermissionResponse(body.response || body.decision || body.action || 'once');
        await instance.client.respondToPermission(run.opencodeSessionId, permissionId, {
            response,
            ...(body.remember !== undefined ? { remember: body.remember === true } : {}),
        });
        const updated = await this.store.updateRun(run.id, {
            status: RUN_STATUS.RUNNING,
            metadata: {
                ...(run.metadata || {}),
                lastPermissionResponse: {
                    permissionId,
                    response,
                    respondedAt: new Date().toISOString(),
                },
            },
        });
        await this.recordRunEvent(updated.id, 'permission_responded', {
            permissionId,
            response,
        }, { run: updated });
        await this.maybeMirrorRunStatus(updated, 'permission_responded', {
            permissionId,
            response,
        });
        return updated;
    }

    async resolveOpencodeSessionId(run, instance) {
        if (run.opencodeSessionId) {
            return run.opencodeSessionId;
        }

        let binding = null;
        if (run.sessionId) {
            binding = await this.store.getSessionBinding({
                ownerId: run.ownerId,
                sessionId: run.sessionId,
                target: run.target,
                workspacePath: run.workspacePath,
            });
        }

        if (binding?.opencodeSessionId) {
            return binding.opencodeSessionId;
        }

        const created = await instance.client.createSession({
            title: buildOpenCodeSessionTitle(run),
        });
        const opencodeSessionId = String(created?.id || created?.info?.id || created?.sessionID || created?.sessionId || '').trim();
        if (!opencodeSessionId) {
            throw new Error('OpenCode did not return a session id');
        }

        if (run.sessionId) {
            await this.store.upsertSessionBinding({
                ownerId: run.ownerId,
                sessionId: run.sessionId,
                target: run.target,
                workspacePath: run.workspacePath,
                opencodeSessionId,
                metadata: {
                    agent: run.agent,
                },
            });
        }

        return opencodeSessionId;
    }

    async ensureInstance(target, workspacePath, approvalMode = 'manual') {
        const key = buildInstanceKey(target, workspacePath);
        const existing = this.instances.get(key);
        if (existing?.readyPromise) {
            return existing.readyPromise;
        }
        if (existing?.client) {
            return existing;
        }

        const readyPromise = (target === 'remote-default'
            ? this.startRemoteInstance(key, workspacePath, approvalMode)
            : this.startLocalInstance(key, workspacePath, approvalMode))
            .then((instance) => {
                this.instances.set(key, instance);
                return instance;
            })
            .catch((error) => {
                this.instances.delete(key);
                throw error;
            });

        this.instances.set(key, { key, readyPromise });
        return readyPromise;
    }

    async buildManagedConfig({ target = 'local', approvalMode = 'manual', workspacePath = '' } = {}) {
        const effective = this.getEffectiveConfig();
        const models = await this.getGatewayModels();
        const providerModels = buildOpenCodeGatewayModels(models, effective.defaultModel || config.openai.model);
        const defaultModelId = resolveDefaultOpenCodeModelId(providerModels, effective.defaultModel || config.openai.model);
        const smallModelId = resolvePreferredSmallModelId(providerModels, defaultModelId);

        return {
            $schema: 'https://opencode.ai/config.json',
            provider: {
                kimibuilt: {
                    npm: '@ai-sdk/openai-compatible',
                    name: 'KimiBuilt Gateway',
                    options: {
                        baseURL: resolveOpenCodeGatewayBaseURL({ target }),
                        apiKey: resolveOpenCodeGatewayApiKey(),
                    },
                    models: providerModels,
                },
            },
            model: defaultModelId ? `kimibuilt/${defaultModelId}` : undefined,
            small_model: smallModelId ? `kimibuilt/${smallModelId}` : undefined,
            ...buildOpenCodePermissionConfig({
                approvalMode,
                workspacePath,
            }),
        };
    }

    async getGatewayModels() {
        const configuredModel = String(this.getEffectiveConfig().defaultModel || config.openai.model || '').trim();
        const discovered = filterGatewayChatModels(await listModels().catch(() => []));

        if (discovered.length > 0) {
            return discovered;
        }

        if (!configuredModel) {
            return [];
        }

        return [{
            id: configuredModel,
        }];
    }

    async startLocalInstance(key, workspacePath, approvalMode = 'manual') {
        await fs.access(workspacePath);
        const effective = this.getEffectiveConfig();
        const port = derivePort(key, 4100);
        const authPassword = randomToken();
        const authUsername = 'opencode';
        const instanceDir = await this.ensureLocalInstanceDir(key);
        const configPath = path.join(instanceDir, 'opencode.json');
        const managedConfig = await this.buildManagedConfig({
            target: 'local',
            approvalMode,
            workspacePath,
        });
        await fs.writeFile(configPath, JSON.stringify(managedConfig, null, 2));

        const child = spawn(
            effective.binaryPath || 'opencode',
            ['serve', '--hostname', '127.0.0.1', '--port', String(port)],
            {
                cwd: workspacePath,
                env: {
                    ...process.env,
                    ...pickAllowedEnv(process.env, effective.providerEnvAllowlist || []),
                    OPENCODE_CONFIG: configPath,
                    OPENCODE_SERVER_USERNAME: authUsername,
                    OPENCODE_SERVER_PASSWORD: authPassword,
                },
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            },
        );

        const stderr = [];
        child.stderr?.on('data', (chunk) => {
            if (stderr.length >= 20) {
                stderr.shift();
            }
            stderr.push(chunk.toString());
        });

        const client = new OpenCodeLocalClient({
            baseURL: `http://127.0.0.1:${port}`,
            username: authUsername,
            password: authPassword,
        });

        await waitFor(async () => {
            if (child.exitCode != null) {
                const error = new Error(`OpenCode server exited before becoming healthy. ${stderr.join('').trim()}`);
                error.exitCode = child.exitCode;
                throw error;
            }
            await client.waitForHealth();
            return true;
        }, DEFAULT_INSTANCE_HEALTH_TIMEOUT_MS);

        const instance = {
            key,
            target: 'local',
            workspacePath,
            port,
            authUsername,
            authPassword,
            client,
            process: child,
            eventAbortController: new AbortController(),
        };
        this.startInstanceEventWatcher(instance);
        return instance;
    }

    async startRemoteInstance(key, workspacePath, approvalMode = 'manual') {
        const effective = this.getEffectiveConfig();
        const ssh = settingsController.getEffectiveSshConfig();
        if (!ssh.enabled || !ssh.host || !ssh.username || (!ssh.password && !ssh.privateKeyPath)) {
            const error = new Error('Remote OpenCode runs require configured SSH defaults');
            error.statusCode = 503;
            throw error;
        }

        const port = derivePort(key, 5100);
        const authPassword = randomToken();
        const authUsername = 'opencode';
        const configDir = `/tmp/kimibuilt-opencode/${safeInstanceSlug(key)}`;
        const configPath = `${configDir}/opencode.json`;
        const logPath = `${configDir}/server.log`;
        assertRemoteGatewayBaseURLReachable();
        const managedConfig = await this.buildManagedConfig({
            target: 'remote-default',
            approvalMode,
            workspacePath,
        });
        const configB64 = Buffer.from(JSON.stringify(managedConfig, null, 2), 'utf8').toString('base64');
        const envAssignments = buildShellEnvAssignments({
            OPENCODE_CONFIG: configPath,
            OPENCODE_SERVER_USERNAME: authUsername,
            OPENCODE_SERVER_PASSWORD: authPassword,
            ...pickAllowedEnv(process.env, effective.providerEnvAllowlist || []),
        });
        const remoteClient = new OpenCodeRemoteClient({
            port,
            username: authUsername,
            password: authPassword,
            sshConfig: ssh,
        });

        const connection = await remoteClient.resolveConnection();
        const shell = remoteClient.sshTool;
        const bootstrapScript = [
            'set -eu',
            `mkdir -p -- ${shell.quoteShellArg(configDir)}`,
            `printf '%s' ${shell.quoteShellArg(configB64)} | base64 -d > ${shell.quoteShellArg(configPath)}`,
            `if ! command -v ${shell.quoteShellArg(effective.binaryPath || 'opencode')} >/dev/null 2>&1; then`,
            '  echo "__KIMIBUILT_OPENCODE_MISSING__"',
            '  exit 127',
            'fi',
            `if ! curl -sS -u ${shell.quoteShellArg(`${authUsername}:${authPassword}`)} http://127.0.0.1:${port}/global/health >/dev/null 2>&1; then`,
            `  cd -- ${shell.quoteShellArg(workspacePath)}`,
            `  nohup env ${envAssignments} ${shell.quoteShellArg(effective.binaryPath || 'opencode')} serve --hostname 127.0.0.1 --port ${port} > ${shell.quoteShellArg(logPath)} 2>&1 < /dev/null &`,
            'fi',
            '',
        ].join('\n');

        try {
            await remoteClient.sshTool.executeSSH(connection, bootstrapScript, 60000, {
                originalCommand: 'bootstrap remote opencode server',
            });
        } catch (error) {
            const combined = `${error.stdout || ''}\n${error.stderr || ''}`;
            if (combined.includes('__KIMIBUILT_OPENCODE_MISSING__')) {
                const missing = new Error('Remote host does not have the opencode binary installed');
                missing.statusCode = 503;
                throw missing;
            }
            throw error;
        }

        await waitFor(async () => {
            await remoteClient.waitForHealth();
            return true;
        }, DEFAULT_INSTANCE_HEALTH_TIMEOUT_MS);

        const instance = {
            key,
            target: 'remote-default',
            workspacePath,
            port,
            authUsername,
            authPassword,
            sshConfig: ssh,
            client: remoteClient,
            eventAbortController: new AbortController(),
        };
        this.startInstanceEventWatcher(instance);
        return instance;
    }

    startInstanceEventWatcher(instance) {
        instance.client.openGlobalEventStream((event) => {
            this.handleInstanceEvent(instance, event).catch((error) => {
                console.warn(`[OpenCode] Failed to process global event for ${instance.key}:`, error.message);
            });
        }, {
            signal: instance.eventAbortController.signal,
        }).catch((error) => {
            if (!instance.eventAbortController.signal.aborted) {
                console.warn(`[OpenCode] Global event watcher for ${instance.key} stopped:`, error.message);
            }
        });
    }

    async handleInstanceEvent(instance, event = {}) {
        const sessionIds = extractIdentifiersByKey(event.data, ['sessionId', 'sessionID', 'session_id']);
        const permissionIds = extractIdentifiersByKey(event.data, ['permissionId', 'permissionID', 'permission_id']);
        const matchedRunIds = new Set();

        for (const sessionId of sessionIds) {
            const runIds = this.runSessionMap.get(sessionId);
            if (runIds) {
                runIds.forEach((runId) => matchedRunIds.add(runId));
            }
        }

        if (matchedRunIds.size === 0) {
            const instanceRuns = this.instanceRunMap.get(instance.key);
            if (instanceRuns?.size === 1) {
                Array.from(instanceRuns).forEach((runId) => matchedRunIds.add(runId));
            }
        }

        if (matchedRunIds.size === 0) {
            return;
        }

        for (const runId of matchedRunIds) {
            const run = await this.store.getRunById(runId);
            if (!run) {
                continue;
            }
            const lowerEvent = `${event.event || ''} ${JSON.stringify(event.data || {})}`.toLowerCase();
            const nextStatus = permissionIds.length > 0 || lowerEvent.includes('permission')
                ? RUN_STATUS.WAITING_PERMISSION
                : lowerEvent.includes('error') || lowerEvent.includes('failed')
                    ? RUN_STATUS.FAILED
                    : RUN_STATUS.RUNNING;
            const updated = nextStatus !== RUN_STATUS.RUNNING
                ? await this.store.updateRun(run.id, {
                    status: nextStatus,
                    metadata: {
                        ...(run.metadata || {}),
                        lastEvent: {
                            event: event.event || 'message',
                            receivedAt: new Date().toISOString(),
                        },
                    },
                })
                : run;
            await this.recordRunEvent(run.id, 'opencode_event', {
                event: event.event || 'message',
                data: event.data,
                permissionIds,
            }, { run: updated });

            if (nextStatus === RUN_STATUS.WAITING_PERMISSION) {
                await this.maybeMirrorRunStatus(updated, 'waiting_permission', {
                    permissionIds,
                });
            }
        }
    }

    trackRun(runId, instanceKey, opencodeSessionId) {
        if (opencodeSessionId) {
            if (!this.runSessionMap.has(opencodeSessionId)) {
                this.runSessionMap.set(opencodeSessionId, new Set());
            }
            this.runSessionMap.get(opencodeSessionId).add(runId);
        }

        if (!this.instanceRunMap.has(instanceKey)) {
            this.instanceRunMap.set(instanceKey, new Set());
        }
        this.instanceRunMap.get(instanceKey).add(runId);
    }

    untrackRun(runId, instanceKey, opencodeSessionId) {
        if (opencodeSessionId && this.runSessionMap.has(opencodeSessionId)) {
            const runIds = this.runSessionMap.get(opencodeSessionId);
            runIds.delete(runId);
            if (runIds.size === 0) {
                this.runSessionMap.delete(opencodeSessionId);
            }
        }

        if (instanceKey && this.instanceRunMap.has(instanceKey)) {
            const runIds = this.instanceRunMap.get(instanceKey);
            runIds.delete(runId);
            if (runIds.size === 0) {
                this.instanceRunMap.delete(instanceKey);
            }
        }
    }

    async recordRunEvent(runId, eventType, payload = {}, { run = null } = {}) {
        const event = await this.store.addRunEvent(runId, eventType, payload);
        this.runEventBus.emit(`run:${runId}`, event);
        const resolvedRun = run || await this.store.getRunById(runId);
        this.broadcastRunUpdate(resolvedRun, event);
        return event;
    }

    broadcastRunUpdate(run, event) {
        if (!run) {
            return;
        }

        const payload = {
            type: 'opencode_run_updated',
            sessionId: run.sessionId,
            data: {
                run,
                event,
            },
            timestamp: new Date().toISOString(),
        };

        try {
            if (run.sessionId) {
                broadcastToSession(run.sessionId, payload);
            }
            broadcastToAdmins(payload);
        } catch (error) {
            console.warn(`[OpenCode] Failed to broadcast run update ${run.id}:`, error.message);
        }
    }

    async maybePersistSessionRuntimeMetadata(run) {
        if (!run?.sessionId || !this.sessionStore?.update) {
            return;
        }

        await this.sessionStore.update(run.sessionId, {
            metadata: {
                lastOpencodeRunId: run.id,
                lastOpencodeWorkspacePath: run.workspacePath,
                lastOpencodeTarget: run.target,
                lastOpencodeSessionId: run.opencodeSessionId,
            },
        });
    }

    async maybeMirrorRunStatus(run, phase, extra = {}) {
        if (!run?.sessionId || !this.sessionStore?.appendMessages) {
            return;
        }

        const message = buildRunStatusMessage(run, phase, extra);
        if (!message) {
            return;
        }

        await this.sessionStore.appendMessages(run.sessionId, [{
            role: 'system',
            content: message,
        }]);
    }

    async maybeMirrorRunCompletion(run) {
        if (!run?.sessionId || !this.sessionStore?.appendMessages) {
            return;
        }

        await this.sessionStore.appendMessages(run.sessionId, [{
            role: 'assistant',
            content: buildRunCompletionMessage(run),
        }]);
    }

    async ensureLocalInstanceDir(key) {
        const dataDir = config.persistence?.dataDir || path.join(process.cwd(), 'data');
        const instanceDir = path.join(dataDir, 'opencode', safeInstanceSlug(key));
        await fs.mkdir(instanceDir, { recursive: true });
        return instanceDir;
    }
}

function buildOpenCodePermissionConfig({ approvalMode = 'manual', workspacePath = '' } = {}) {
    const bashMode = approvalMode === 'auto' ? 'allow' : 'ask';
    const editMode = approvalMode === 'auto' ? 'allow' : 'ask';

    return {
        $schema: 'https://opencode.ai/config.json',
        permission: {
            read: {
                '*': 'allow',
                '*.env': 'deny',
                '*.env.*': 'deny',
                '*.env.example': 'allow',
            },
            list: { '*': 'allow' },
            glob: { '*': 'allow' },
            grep: { '*': 'allow' },
            edit: { '*': editMode },
            bash: {
                '*': bashMode,
                'git push *': 'deny',
                'shutdown *': 'deny',
                'reboot *': 'deny',
            },
            task: { '*': 'ask' },
            question: { '*': 'allow' },
            skill: { '*': 'allow' },
            webfetch: { '*': 'allow' },
            websearch: { '*': 'allow' },
            codesearch: { '*': 'allow' },
            external_directory: { '*': 'deny' },
            doom_loop: { '*': 'ask' },
        },
        agent: {
            plan: {
                permission: {
                    edit: { '*': 'deny' },
                    bash: { '*': 'deny' },
                },
            },
        },
        kimibuilt: {
            workspacePath,
            approvalMode,
        },
    };
}

function buildOpenCodeSessionTitle(run = {}) {
    return [
        'KimiBuilt',
        run.agent || 'build',
        path.basename(run.workspacePath || 'workspace'),
    ].filter(Boolean).join(' - ');
}

function buildInstanceKey(target = 'local', workspacePath = '') {
    return `${target}::${workspacePath}`;
}

function safeInstanceSlug(value = '') {
    return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 16);
}

function derivePort(value = '', base = 4100) {
    const hash = crypto.createHash('sha1').update(String(value || '')).digest();
    const offset = hash.readUInt16BE(0) % 1000;
    return base + offset;
}

function randomToken() {
    return crypto.randomBytes(18).toString('base64url');
}

function pickAllowedEnv(env = {}, allowlist = []) {
    const keys = Array.isArray(allowlist)
        ? allowlist
        : String(allowlist || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean);
    return Object.fromEntries(keys
        .filter((key) => typeof env[key] === 'string' && env[key])
        .map((key) => [key, env[key]]));
}

function buildShellEnvAssignments(values = {}) {
    return Object.entries(values)
        .filter(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && value != null && value !== '')
        .map(([key, value]) => `${key}=${quoteShellArg(String(value))}`)
        .join(' ');
}

function quoteShellArg(value = '') {
    return `'${String(value || '').replace(/'/g, `'"'"'`)}'`;
}

function normalizeOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function isPathInside(candidate, root) {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function waitFor(check, timeoutMs = DEFAULT_INSTANCE_HEALTH_TIMEOUT_MS) {
    const startedAt = Date.now();
    let lastError = null;

    while (Date.now() - startedAt < timeoutMs) {
        try {
            return await check();
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 750));
        }
    }

    throw lastError || new Error('Timed out waiting for OpenCode instance readiness');
}

function normalizePermissionResponse(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (['always', 'allow_always', 'always_allow'].includes(normalized)) {
        return 'always';
    }
    if (['reject', 'deny', 'no'].includes(normalized)) {
        return 'reject';
    }
    return 'once';
}

function filterGatewayChatModels(models = []) {
    return (Array.isArray(models) ? models : [])
        .filter((model) => {
            const id = String(model?.id || '').trim().toLowerCase();
            if (!id) {
                return false;
            }

            return [
                'gpt',
                'claude',
                'gemini',
                'kimi',
                'llama',
                'mistral',
                'qwen',
                'phi',
                'ollama',
                'deepseek',
                'moonshot',
                'command',
            ].some((token) => id.includes(token));
        })
        .filter((model) => {
            const id = String(model?.id || '').trim().toLowerCase();
            return ![
                'image',
                'embedding',
                'tts',
                'transcribe',
                'audio',
                'realtime',
                'vision-preview',
                'preview-tools',
                '-tools',
            ].some((token) => id.includes(token));
        });
}

function buildOpenCodeGatewayModels(models = [], fallbackModel = '') {
    const entries = new Map();
    const normalizedFallback = String(fallbackModel || '').trim();

    (Array.isArray(models) ? models : []).forEach((model) => {
        const id = String(model?.id || '').trim();
        if (!id || entries.has(id)) {
            return;
        }

        const limit = buildModelLimit(model);
        entries.set(id, {
            name: id,
            ...(limit ? { limit } : {}),
        });
    });

    if (entries.size === 0 && normalizedFallback) {
        entries.set(normalizedFallback, { name: normalizedFallback });
    }

    return Object.fromEntries(entries);
}

function buildModelLimit(model = {}) {
    const context = pickPositiveNumber(
        model.context_length,
        model.contextLength,
        model.context_window,
        model.contextWindow,
    );
    const output = pickPositiveNumber(
        model.max_output_tokens,
        model.maxCompletionTokens,
        model.max_completion_tokens,
        model.output_tokens,
        model.outputTokens,
    );

    if (!context && !output) {
        return null;
    }

    return {
        ...(context ? { context } : {}),
        ...(output ? { output } : {}),
    };
}

function pickPositiveNumber(...values) {
    for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) {
            return Math.floor(number);
        }
    }

    return null;
}

function resolveDefaultOpenCodeModelId(models = {}, preferredModel = '') {
    const modelIds = Object.keys(models || {});
    const normalizedPreferred = String(preferredModel || '').trim();

    if (normalizedPreferred && modelIds.includes(normalizedPreferred)) {
        return normalizedPreferred;
    }

    if (modelIds.length === 0) {
        return normalizedPreferred || null;
    }

    return modelIds[0];
}

function resolvePreferredSmallModelId(models = {}, fallbackModelId = null) {
    const modelIds = Object.keys(models || {});
    const preferred = modelIds.find((modelId) => /\b(mini|small|nano|haiku|flash|lite)\b/i.test(modelId));
    return preferred || fallbackModelId || modelIds[0] || null;
}

function serializeError(error) {
    return {
        message: String(error?.message || 'OpenCode run failed'),
        name: String(error?.name || 'Error'),
        ...(error?.statusCode ? { statusCode: error.statusCode } : {}),
        ...(error?.exitCode != null ? { exitCode: error.exitCode } : {}),
    };
}

function buildRunStatusMessage(run, phase, extra = {}) {
    const workspace = run.workspacePath || 'workspace';
    if (phase === 'queued') {
        return `OpenCode run queued for ${workspace} using the ${run.agent} agent.`;
    }
    if (phase === 'starting') {
        return `OpenCode is starting for ${workspace}.`;
    }
    if (phase === 'started') {
        return `OpenCode run started in ${workspace}.`;
    }
    if (phase === 'waiting_permission') {
        const permissionIds = Array.isArray(extra.permissionIds) ? extra.permissionIds.filter(Boolean) : [];
        return permissionIds.length > 0
            ? `OpenCode is waiting for permission in ${workspace}. Permission IDs: ${permissionIds.join(', ')}.`
            : `OpenCode is waiting for permission in ${workspace}.`;
    }
    if (phase === 'permission_responded') {
        return `OpenCode permission response sent (${extra.response || 'once'}) for ${workspace}.`;
    }
    if (phase === 'cancelled') {
        return `OpenCode run cancelled for ${workspace}.`;
    }
    if (phase === 'failed') {
        return extra.error
            ? `OpenCode run failed for ${workspace}: ${extra.error}`
            : `OpenCode run failed for ${workspace}.`;
    }
    return '';
}

function buildRunCompletionMessage(run = {}) {
    const lines = [
        `OpenCode completed in ${run.workspacePath || 'workspace'} using the ${run.agent || 'build'} agent.`,
    ];

    if (run.summary) {
        lines.push('', run.summary);
    }

    const diffLines = Array.isArray(run.diff)
        ? run.diff
            .map((entry) => String(entry?.path || entry?.file || entry?.newPath || '').trim())
            .filter(Boolean)
        : [];
    if (diffLines.length > 0) {
        lines.push('', 'Changed files:', ...diffLines.map((line) => `- ${line}`));
    }

    return lines.join('\n').trim();
}

function extractIdentifiersByKey(value, keys = [], results = new Set(), depth = 0) {
    if (value == null || depth > 8) {
        return Array.from(results);
    }
    if (typeof value === 'string') {
        return Array.from(results);
    }
    if (Array.isArray(value)) {
        value.forEach((entry) => extractIdentifiersByKey(entry, keys, results, depth + 1));
        return Array.from(results);
    }
    if (typeof value !== 'object') {
        return Array.from(results);
    }

    Object.entries(value).forEach(([key, nested]) => {
        if (keys.includes(key) && typeof nested === 'string' && nested.trim()) {
            results.add(nested.trim());
        }
        extractIdentifiersByKey(nested, keys, results, depth + 1);
    });

    return Array.from(results);
}

module.exports = {
    OpenCodeService,
    buildOpenCodePermissionConfig,
    buildRunCompletionMessage,
    buildRunStatusMessage,
    buildOpenCodeGatewayModels,
    filterGatewayChatModels,
    resolveDefaultOpenCodeModelId,
};
