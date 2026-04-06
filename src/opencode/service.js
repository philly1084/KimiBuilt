'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const { spawn } = require('child_process');

const { config } = require('../config');
const settingsController = require('../routes/admin/settings.controller');
const { broadcastToAdmins, broadcastToSession } = require('../realtime-hub');
const { OpenCodeLocalClient, OpenCodeRemoteClient, extractMessageText } = require('./client');
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

        const instance = await this.ensureInstance(run.target, run.workspacePath, run.approvalMode);
        const opencodeSessionId = await this.resolveOpencodeSessionId(run, instance);
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
    }
}
