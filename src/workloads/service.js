'use strict';

const { getNextCronRun } = require('./cron-utils');
const {
    applyProjectPlanPatch,
    extractProjectPlan,
    formatProjectExecutionContext,
    recordProjectReview,
} = require('./project-plans');
const { buildCanonicalWorkloadPayload } = require('./request-builder');
const {
    deriveRunIdempotencyKey,
    validateWorkloadPayload,
} = require('./schema');
const { RUN_STATUS, workloadStore } = require('./store');
const { broadcastToAdmins, broadcastToSession } = require('../realtime-hub');

class AgentWorkloadService {
    constructor({
        store = workloadStore,
        sessionStore,
        conversationRunService,
    }) {
        this.store = store;
        this.sessionStore = sessionStore;
        this.conversationRunService = conversationRunService;
    }

    isAvailable() {
        return this.store.isAvailable() && this.sessionStore?.isPersistent?.() === true;
    }

    resolveRequestedModel(payload = {}, session = null) {
        return String(
            payload?.metadata?.requestedModel
            || payload?.model
            || session?.metadata?.model
            || '',
        ).trim() || null;
    }

    async createWorkload(payload = {}, ownerId = null) {
        const normalized = validateWorkloadPayload(payload, {
            ownerId,
            sessionId: payload.sessionId,
        });
        const session = await this.sessionStore.getOwned(normalized.sessionId, ownerId);
        if (!session) {
            const error = new Error('Session not found');
            error.statusCode = 404;
            throw error;
        }
        const requestedModel = this.resolveRequestedModel(payload, session);
        if (requestedModel && normalized.metadata?.requestedModel !== requestedModel) {
            normalized.metadata = {
                ...(normalized.metadata || {}),
                requestedModel,
            };
        }
        const workload = await this.store.createWorkload(normalized);
        try {
            const queuedRun = await this.ensureNextScheduledRun(workload);
            if (workload.trigger?.type !== 'manual' && !queuedRun) {
                throw new Error('Failed to enqueue workload run.');
            }
        } catch (error) {
            try {
                await this.store.deleteWorkload(workload.id, workload.ownerId);
            } catch (cleanupError) {
                console.warn(`[Workloads] Failed to clean up workload ${workload.id} after scheduling failure:`, cleanupError.message);
            }
            throw error;
        }
        await this.emitWorkloadUpdate('workload_updated', workload.sessionId, {
            workload,
        });
        return workload;
    }

    async createWorkloadFromScenario(sessionId, ownerId, request = '', options = {}) {
        const session = options.session || await this.sessionStore.getOwned(sessionId, ownerId);
        const canonical = buildCanonicalWorkloadPayload({
            request,
            title: options.title,
            prompt: options.prompt,
            ...(Object.prototype.hasOwnProperty.call(options, 'callableSlug')
                ? { callableSlug: options.callableSlug }
                : {}),
            ...(options.trigger ? { trigger: options.trigger } : {}),
            ...(options.execution ? { execution: options.execution } : {}),
            ...(options.policy ? { policy: options.policy } : {}),
            ...(options.metadata && typeof options.metadata === 'object' ? { metadata: options.metadata } : {}),
            ...(options.model ? { model: options.model } : {}),
            ...(options.mode ? { mode: options.mode } : {}),
            ...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
            ...(Array.isArray(options.stages) ? { stages: options.stages } : {}),
        }, {
            timezone: options.timezone,
            now: options.now,
            session,
        });
        if (!canonical) {
            throw new Error('Describe the task and when it should run.');
        }
        const scenario = canonical.scenario || {
            title: canonical.payload.title,
            prompt: canonical.payload.prompt,
            trigger: canonical.payload.trigger,
            policy: canonical.payload.policy,
            scheduleDetected: canonical.payload.trigger?.type !== 'manual',
        };
        const payload = {
            sessionId,
            mode: options.mode || 'chat',
            enabled: options.enabled !== false,
            ...(options.model ? { model: options.model } : {}),
            ...canonical.payload,
        };
        const workload = await this.createWorkload(payload, ownerId);

        return {
            workload,
            scenario,
        };
    }

    async listSessionWorkloads(sessionId, ownerId) {
        const session = await this.sessionStore.getOwned(sessionId, ownerId);
        if (!session) {
            return [];
        }
        return this.store.listSessionWorkloads(sessionId, ownerId);
    }

    async getWorkload(id, ownerId) {
        return this.store.getWorkloadById(id, ownerId);
    }

    async updateWorkload(id, ownerId, payload = {}) {
        const current = await this.store.getWorkloadById(id, ownerId);
        if (!current) {
            return null;
        }

        const normalized = validateWorkloadPayload({
            ...current,
            ...payload,
            metadata: {
                ...(current.metadata || {}),
                ...((payload && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)) ? payload.metadata : {}),
            },
            sessionId: current.sessionId,
        }, {
            ownerId,
            sessionId: current.sessionId,
        });
        const requestedModel = this.resolveRequestedModel(payload, current);
        if (requestedModel && normalized.metadata?.requestedModel !== requestedModel) {
            normalized.metadata = {
                ...(normalized.metadata || {}),
                requestedModel,
            };
        }

        const updated = await this.store.updateWorkload(id, ownerId, normalized);
        const schedulingChanged = (
            current.prompt !== updated.prompt
            || JSON.stringify(current.trigger || {}) !== JSON.stringify(updated.trigger || {})
        );
        if (!updated.enabled) {
            await this.store.cancelQueuedRunsForWorkload(updated.id);
        } else {
            if (schedulingChanged) {
                await this.store.cancelPendingQueuedRunsForWorkload(updated.id);
            }
            await this.ensureNextScheduledRun(updated);
        }

        await this.emitWorkloadUpdate('workload_updated', updated.sessionId, {
            workload: updated,
        });
        return updated;
    }

    async getProjectPlan(idOrSlug, ownerId) {
        const workload = await this.resolveWorkload(idOrSlug, ownerId);
        if (!workload) {
            return null;
        }

        return extractProjectPlan(workload, {
            title: workload.title,
            prompt: workload.prompt,
        });
    }

    async updateProjectPlan(idOrSlug, ownerId, projectPatch = {}, options = {}) {
        const workload = await this.resolveWorkload(idOrSlug, ownerId);
        if (!workload) {
            return null;
        }

        const currentProject = extractProjectPlan(workload, {
            title: workload.title,
            prompt: workload.prompt,
        });
        const nextProject = applyProjectPlanPatch(
            currentProject || {},
            projectPatch || {},
            {
                defaults: {
                    title: workload.title,
                    prompt: workload.prompt,
                },
                changeReason: options.changeReason || null,
            },
        );
        const metadata = {
            ...(workload.metadata || {}),
            projectMode: true,
            project: nextProject,
        };
        const updated = await this.store.updateWorkload(workload.id, ownerId, { metadata });
        const resolved = updated || {
            ...workload,
            metadata,
        };

        await this.emitWorkloadUpdate('workload_updated', resolved.sessionId, {
            workload: resolved,
        });

        return {
            workload: resolved,
            project: nextProject,
        };
    }

    async pauseWorkload(id, ownerId) {
        const workload = await this.store.updateWorkload(id, ownerId, { enabled: false });
        if (!workload) {
            return null;
        }
        await this.store.cancelQueuedRunsForWorkload(workload.id);
        await this.emitWorkloadUpdate('workload_updated', workload.sessionId, {
            workload,
        });
        return workload;
    }

    async resumeWorkload(id, ownerId) {
        const workload = await this.store.updateWorkload(id, ownerId, { enabled: true });
        if (!workload) {
            return null;
        }
        await this.ensureNextScheduledRun(workload);
        await this.emitWorkloadUpdate('workload_updated', workload.sessionId, {
            workload,
        });
        return workload;
    }

    async deleteWorkload(id, ownerId) {
        const workload = await this.store.getWorkloadById(id, ownerId);
        if (!workload) {
            return false;
        }

        await this.store.cancelQueuedRunsForWorkload(id);
        const deleted = await this.store.deleteWorkload(id, ownerId);
        if (deleted) {
            await this.emitWorkloadUpdate('workload_updated', workload.sessionId, {
                workloadId: id,
                deleted: true,
            });
        }
        return deleted;
    }

    async runWorkloadNow(idOrSlug, ownerId, options = {}) {
        const workload = await this.resolveWorkload(idOrSlug, ownerId);
        if (!workload) {
            return null;
        }

        const run = await this.store.enqueueRun({
            workloadId: workload.id,
            ownerId: workload.ownerId,
            sessionId: workload.sessionId,
            reason: options.reason || 'manual',
            scheduledFor: new Date(),
            stageIndex: Number.isFinite(Number(options.stageIndex)) ? Number(options.stageIndex) : -1,
            parentRunId: options.parentRunId || null,
            prompt: options.prompt || workload.prompt,
            metadata: options.metadata || {},
            idempotencyKey: options.idempotencyKey || null,
        });

        if (run?.status === RUN_STATUS.QUEUED) {
            await this.onRunQueued(workload, run, options.reason || 'manual');
        }

        return run;
    }

    async listRunsForWorkload(workloadId, ownerId, limit = 50) {
        return this.store.listRunsForWorkload(workloadId, ownerId, limit);
    }

    async getRun(runId, ownerId = null) {
        return this.store.getRunById(runId, ownerId);
    }

    async listAdminWorkloads(limit = 100) {
        return this.store.listAdminWorkloads(limit);
    }

    async listAdminRuns(limit = 100) {
        return this.store.listAdminRuns(limit);
    }

    async claimDueRuns(options = {}) {
        return this.store.claimDueRuns(options);
    }

    async extendRunLease(runId, workerId, leaseMs) {
        return this.store.extendRunLease(runId, workerId, leaseMs);
    }

    async executeClaimedRun(run, workerId) {
        if (!run?.workload) {
            throw new Error('Claimed run is missing workload context');
        }

        const workload = run.workload;
        const stage = Number(run.stageIndex) >= 0 && Array.isArray(workload.stages)
            ? workload.stages[run.stageIndex] || null
            : null;
        const prompt = stage?.prompt || run.prompt || workload.prompt;
        const execution = stage?.execution || workload.execution || null;
        const stageInputs = await this.resolveStageInputs(run, stage);
        const message = this.buildStageMessage(prompt, stageInputs, stage, workload);
        const stageOutputFormat = String(stage?.outputFormat || '').trim().toLowerCase() || null;
        const stageToolIds = Array.isArray(stage?.toolIds) && stage.toolIds.length > 0
            ? stage.toolIds
            : (workload.policy?.toolIds || []);
        const artifactOnlyStage = Boolean(stage && stageOutputFormat && !execution && !String(prompt || '').trim());
        const requestedModel = String(
            stage?.metadata?.requestedModel
            || run?.metadata?.requestedModel
            || workload?.metadata?.requestedModel
            || '',
        ).trim() || null;
        const startedMessage = `Deferred workload "${workload.title}" started${stage ? ` (stage ${run.stageIndex + 1})` : ''}.`;
        await this.appendSyntheticMessageSafe(workload.sessionId, 'system', startedMessage);
        await this.addRunEventSafe(run.id, 'started', { workerId, stageIndex: run.stageIndex });
        await this.emitWorkloadUpdate('workload_started', workload.sessionId, {
            workloadId: workload.id,
            runId: run.id,
            stageIndex: run.stageIndex,
            scheduledFor: run.scheduledFor,
        });

        try {
            const session = await this.sessionStore.getOwned(workload.sessionId, workload.ownerId);
            const result = artifactOnlyStage
                ? await this.conversationRunService.createArtifactFromContent({
                    sessionId: workload.sessionId,
                    ownerId: workload.ownerId,
                    session,
                    content: this.renderStageInputText(stageInputs, stage),
                    outputFormat: stageOutputFormat,
                    message: message || `Create a ${stageOutputFormat} artifact from the prior stage output.`,
                    mode: workload.mode || 'chat',
                    model: requestedModel,
                    metadata: {
                        taskType: workload.mode || 'chat',
                        clientSurface: 'workload',
                        workloadId: workload.id,
                        runId: run.id,
                        workloadRun: true,
                    },
                })
                : execution
                ? await this.conversationRunService.runStructuredExecution({
                    sessionId: workload.sessionId,
                    ownerId: workload.ownerId,
                    session,
                    execution,
                    metadata: {
                        executionProfile: workload.policy?.executionProfile,
                        prompt,
                        workloadId: workload.id,
                        runId: run.id,
                    },
                })
                : await this.conversationRunService.runChatTurn({
                    sessionId: workload.sessionId,
                    ownerId: workload.ownerId,
                    session,
                    message,
                    model: requestedModel,
                    executionProfile: workload.policy?.executionProfile,
                    requestedToolIds: stageToolIds,
                    policy: workload.policy || {},
                    metadata: {
                        taskType: workload.mode || 'chat',
                        clientSurface: 'workload',
                        workloadId: workload.id,
                        runId: run.id,
                        workloadRun: true,
                        outputFormat: stageOutputFormat,
                        remoteBuildAutonomyApproved: workload.policy?.allowSideEffects === true,
                    },
                });
            const completionTrace = result.execution?.trace
                || result.response?.metadata?.executionTrace
                || (execution ? {
                    structuredExecution: true,
                    toolId: execution.tool,
                    params: execution.params || {},
                } : null)
                || (artifactOnlyStage ? {
                    artifactOnly: true,
                    outputFormat: stageOutputFormat,
                } : {});

            const completed = await this.store.completeRun(run.id, workerId, {
                responseId: result.response?.id || null,
                trace: completionTrace,
                metadata: this.buildCompletedRunMetadata(run, stage, result),
            });
            const trackedWorkload = await this.persistProjectReview(workload, run, {
                succeeded: true,
                stage,
                outputText: result.outputText || result.artifactMessage || '',
                artifacts: result.artifacts || [],
            });
            await this.addRunEventSafe(run.id, 'completed', {
                responseId: result.response?.id || null,
                structuredExecution: Boolean(execution),
                artifactOnly: artifactOnlyStage,
            });
            await this.scheduleFollowupStage(trackedWorkload, run, true);
            await this.ensureNextScheduledRun(trackedWorkload, run);

            await this.appendSyntheticMessageSafe(
                trackedWorkload.sessionId,
                'system',
                `Deferred workload "${trackedWorkload.title}" completed${stage ? ` (stage ${run.stageIndex + 1})` : ''}.`,
            );
            await this.emitWorkloadUpdate('workload_completed', trackedWorkload.sessionId, {
                workloadId: trackedWorkload.id,
                runId: run.id,
                output: result.outputText || '',
                responseId: result.response?.id || null,
                artifacts: result.artifacts || [],
            });
            return completed;
        } catch (error) {
            const failed = await this.store.failRun(run.id, workerId, {
                error: {
                    message: error.message,
                },
                metadata: {
                    ...(run.metadata || {}),
                    lastError: {
                        message: error.message,
                        failedAt: new Date().toISOString(),
                    },
                },
            });
            await this.addRunEventSafe(run.id, 'failed', {
                error: error.message,
            });
            const trackedWorkload = await this.persistProjectReview(workload, run, {
                succeeded: false,
                stage,
                outputText: error.message,
                artifacts: [],
            });
            await this.scheduleFollowupStage(trackedWorkload, run, false);
            await this.ensureNextScheduledRun(trackedWorkload, run);
            await this.appendSyntheticMessageSafe(
                trackedWorkload.sessionId,
                'system',
                `Deferred workload "${trackedWorkload.title}" failed${stage ? ` (stage ${run.stageIndex + 1})` : ''}: ${error.message}`,
            );
            await this.emitWorkloadUpdate('workload_failed', trackedWorkload.sessionId, {
                workloadId: trackedWorkload.id,
                runId: run.id,
                error: error.message,
            });
            return failed;
        }
    }

    async ensureNextScheduledRun(workload, completedRun = null) {
        if (!workload?.enabled) {
            return null;
        }

        if (workload.trigger?.type === 'manual') {
            return null;
        }

        if (workload.trigger?.type === 'once') {
            const stageIndex = -1;
            const run = await this.store.enqueueRun({
                workloadId: workload.id,
                ownerId: workload.ownerId,
                sessionId: workload.sessionId,
                reason: 'schedule',
                scheduledFor: workload.trigger.runAt,
                stageIndex,
                prompt: workload.prompt,
                idempotencyKey: deriveRunIdempotencyKey({
                    workloadId: workload.id,
                    scheduledFor: workload.trigger.runAt,
                    stageIndex,
                    reason: 'schedule',
                }),
            });
            if (run?.status === RUN_STATUS.QUEUED) {
                await this.onRunQueued(workload, run, 'scheduled');
            }
            return run;
        }

        if (workload.trigger?.type === 'cron') {
            const basis = completedRun?.scheduledFor || new Date();
            const scheduledFor = getNextCronRun(
                workload.trigger.expression,
                workload.trigger.timezone,
                new Date(basis),
            );
            const run = await this.store.enqueueRun({
                workloadId: workload.id,
                ownerId: workload.ownerId,
                sessionId: workload.sessionId,
                reason: 'cron',
                scheduledFor,
                stageIndex: -1,
                prompt: workload.prompt,
                idempotencyKey: deriveRunIdempotencyKey({
                    workloadId: workload.id,
                    scheduledFor: scheduledFor.toISOString(),
                    stageIndex: -1,
                    reason: 'cron',
                }),
            });
            if (run?.status === RUN_STATUS.QUEUED) {
                await this.onRunQueued(workload, run, 'cron');
            }
            return run;
        }

        return null;
    }

    async scheduleFollowupStage(workload, run, succeeded) {
        const stages = Array.isArray(workload.stages) ? workload.stages : [];
        const nextIndex = Number.isFinite(Number(run.stageIndex)) ? Number(run.stageIndex) + 1 : 0;
        const stage = stages[nextIndex];
        if (!stage) {
            return null;
        }

        const shouldRun = stage.when === 'always'
            || (stage.when === 'on_success' && succeeded)
            || (stage.when === 'on_failure' && !succeeded);
        if (!shouldRun) {
            return null;
        }

        const scheduledFor = new Date(Date.now() + Number(stage.delayMs || 0));
        const followupRun = await this.store.enqueueRun({
            workloadId: workload.id,
            ownerId: workload.ownerId,
            sessionId: workload.sessionId,
            reason: 'followup',
            scheduledFor,
            parentRunId: run.id,
            stageIndex: nextIndex,
            prompt: stage.prompt || '',
            idempotencyKey: deriveRunIdempotencyKey({
                workloadId: workload.id,
                scheduledFor: scheduledFor.toISOString(),
                stageIndex: nextIndex,
                reason: `followup-${run.id}`,
            }),
            metadata: {
                parentRunId: run.id,
            },
        });

        if (followupRun?.status === RUN_STATUS.QUEUED) {
            await this.addRunEventSafe(run.id, 'followup-enqueued', {
                followupRunId: followupRun.id,
                stageIndex: nextIndex,
            });
            await this.appendSyntheticMessageSafe(
                workload.sessionId,
                'system',
                `Deferred workload "${workload.title}" scheduled a follow-up stage ${nextIndex + 1}.`,
            );
            await this.emitWorkloadUpdate('workload_queued', workload.sessionId, {
                workloadId: workload.id,
                runId: followupRun.id,
                stageIndex: nextIndex,
                reason: 'followup',
            });
        }

        return followupRun;
    }

    async resolveStageInputs(run, stage = null) {
        const resolved = {
            parent: null,
            named: {},
        };
        const requestedKeys = Array.isArray(stage?.inputFrom) ? stage.inputFrom : [];
        let currentRunId = run?.parentRunId || run?.metadata?.parentRunId || null;
        let depth = 0;

        while (currentRunId && depth < 20) {
            const parentRun = await this.store.getRunById(currentRunId);
            if (!parentRun) {
                break;
            }

            const output = this.extractRunOutput(parentRun);
            if (!resolved.parent && output) {
                resolved.parent = output;
            }

            const outputKey = String(parentRun?.metadata?.outputKey || '').trim();
            if (outputKey && output && !resolved.named[outputKey]) {
                resolved.named[outputKey] = output;
            }

            currentRunId = parentRun.parentRunId || parentRun.metadata?.parentRunId || null;
            depth += 1;
        }

        if (requestedKeys.length === 0) {
            return resolved;
        }

        return {
            parent: resolved.parent,
            named: Object.fromEntries(
                requestedKeys
                    .filter((key) => resolved.named[key])
                    .map((key) => [key, resolved.named[key]]),
            ),
        };
    }

    extractRunOutput(run = {}) {
        const output = run?.metadata?.output;
        if (!output || typeof output !== 'object') {
            return null;
        }

        const text = String(output.text || output.artifactMessage || '').trim();
        const artifacts = Array.isArray(output.artifacts)
            ? output.artifacts
                .filter((artifact) => artifact?.id || artifact?.filename)
                .map((artifact) => ({
                    id: artifact.id || null,
                    filename: artifact.filename || null,
                    mimeType: artifact.mimeType || null,
                }))
            : [];

        if (!text && artifacts.length === 0) {
            return null;
        }

        return {
            text,
            artifacts,
        };
    }

    renderStageInputText(stageInputs = {}, stage = null) {
        const sections = [];
        const requestedKeys = Array.isArray(stage?.inputFrom) ? stage.inputFrom : [];

        if (requestedKeys.length > 0) {
            requestedKeys.forEach((key) => {
                const entry = stageInputs?.named?.[key];
                if (entry) {
                    sections.push(this.formatStageInputSection(key, entry));
                }
            });
        } else if (stageInputs?.parent) {
            sections.push(this.formatStageInputSection('previous_stage', stageInputs.parent));
        }

        return sections.filter(Boolean).join('\n\n');
    }

    formatStageInputSection(label = 'previous_stage', entry = {}) {
        const parts = [];
        const text = String(entry?.text || '').trim();
        const artifacts = Array.isArray(entry?.artifacts) ? entry.artifacts : [];

        if (text) {
            parts.push(text);
        }
        if (artifacts.length > 0) {
            parts.push(`Artifacts: ${artifacts.map((artifact) => artifact.filename || artifact.id).filter(Boolean).join(', ')}`);
        }

        if (parts.length === 0) {
            return '';
        }

        return `[${label}]\n${parts.join('\n\n')}`;
    }

    buildStageMessage(prompt = '', stageInputs = {}, stage = null, workload = null) {
        const trimmedPrompt = String(prompt || '').trim();
        const inputText = this.renderStageInputText(stageInputs, stage);
        const projectContext = formatProjectExecutionContext(extractProjectPlan(workload, {
            title: workload?.title,
            prompt: workload?.prompt,
        }));

        if (projectContext && trimmedPrompt && inputText) {
            return `${projectContext}\n\nCurrent run objective:\n${trimmedPrompt}\n\nContext from prior stages:\n\n${inputText}`;
        }
        if (projectContext && trimmedPrompt) {
            return `${projectContext}\n\nCurrent run objective:\n${trimmedPrompt}`;
        }
        if (projectContext && inputText) {
            return `${projectContext}\n\nContext from prior stages:\n\n${inputText}`;
        }
        if (trimmedPrompt && inputText) {
            return `${trimmedPrompt}\n\nContext from prior stages:\n\n${inputText}`;
        }
        if (trimmedPrompt) {
            return trimmedPrompt;
        }
        return inputText;
    }

    buildCompletedRunMetadata(run = {}, stage = null, result = {}) {
        const outputKey = String(stage?.outputKey || '').trim() || null;
        const artifacts = Array.isArray(result?.artifacts)
            ? result.artifacts
                .filter((artifact) => artifact?.id || artifact?.filename)
                .map((artifact) => ({
                    id: artifact.id || null,
                    filename: artifact.filename || null,
                    mimeType: artifact.mimeType || null,
                }))
            : [];
        const outputText = this.truncateStoredOutput(
            String(result?.outputText || result?.artifactMessage || '').trim(),
        );
        const artifactMessage = this.truncateStoredOutput(
            String(result?.artifactMessage || '').trim(),
        );

        return {
            ...(run.metadata || {}),
            ...(outputKey ? { outputKey } : {}),
            output: {
                text: outputText,
                artifactMessage,
                artifacts,
            },
        };
    }

    _truncateStoredOutputLegacy(value = '', maxLength = 20000) {
        const normalized = String(value || '');
        if (normalized.length <= maxLength) {
            return normalized;
        }

        return `${normalized.slice(0, maxLength - 1)}…`;
    }

    truncateStoredOutput(value = '', maxLength = 20000) {
        const normalized = String(value || '');
        if (normalized.length <= maxLength) {
            return normalized;
        }

        return `${normalized.slice(0, maxLength - 3)}...`;
    }

    async persistProjectReview(workload, run, review = {}) {
        const project = extractProjectPlan(workload, {
            title: workload?.title,
            prompt: workload?.prompt,
        });
        if (!project || typeof this.store?.updateWorkload !== 'function') {
            return workload;
        }

        const nextProject = recordProjectReview(project, {
            runId: run?.id || '',
            reviewedAt: new Date().toISOString(),
            milestoneId: project.activeMilestoneId,
            status: review.succeeded ? 'completed' : 'failed',
            summary: this.truncateStoredOutput(String(review.outputText || '').trim(), 400),
            stageIndex: run?.stageIndex,
            artifacts: review.artifacts || [],
        });

        try {
            const updated = await this.store.updateWorkload(workload.id, workload.ownerId, {
                metadata: {
                    ...(workload.metadata || {}),
                    projectMode: true,
                    project: nextProject,
                },
            });

            return updated || {
                ...workload,
                metadata: {
                    ...(workload.metadata || {}),
                    projectMode: true,
                    project: nextProject,
                },
            };
        } catch (error) {
            console.warn(`[Workloads] Failed to persist project review for ${workload.id}:`, error.message);
            return workload;
        }
    }

    async getSessionSummaries(sessionIds = [], ownerId = null) {
        if (!this.isAvailable()) {
            return {};
        }
        return this.store.getSessionSummaries(sessionIds, ownerId);
    }

    async resolveWorkload(idOrSlug, ownerId) {
        const byId = await this.store.getWorkloadById(idOrSlug, ownerId);
        if (byId) {
            return byId;
        }

        return this.store.getWorkloadByCallableSlug(idOrSlug, ownerId);
    }

    async onRunQueued(workload, run, source = 'scheduled') {
        await this.addRunEventSafe(run.id, 'queued', {
            source,
            scheduledFor: run.scheduledFor,
        });
        await this.appendSyntheticMessageSafe(
            workload.sessionId,
            'system',
            `Deferred workload "${workload.title}" queued for ${run.scheduledFor}.`,
        );
        await this.emitWorkloadUpdate('workload_queued', workload.sessionId, {
            workloadId: workload.id,
            runId: run.id,
            scheduledFor: run.scheduledFor,
            reason: run.reason,
        });
    }

    async emitWorkloadUpdate(type, sessionId, data = {}) {
        const payload = {
            type,
            sessionId,
            data,
            timestamp: new Date().toISOString(),
        };

        try {
            broadcastToSession(sessionId, payload);
            broadcastToAdmins(payload);
        } catch (error) {
            console.warn(`[Workloads] Failed to broadcast ${type}:`, error.message);
        }
    }

    async addRunEventSafe(runId, eventType, payload = {}) {
        try {
            await this.store.addRunEvent(runId, eventType, payload);
        } catch (error) {
            console.warn(`[Workloads] Failed to record run event '${eventType}' for ${runId}:`, error.message);
        }
    }

    async appendSyntheticMessageSafe(sessionId, role, content) {
        try {
            await this.conversationRunService.appendSyntheticMessage(sessionId, role, content);
        } catch (error) {
            console.warn(`[Workloads] Failed to append synthetic message for session ${sessionId}:`, error.message);
        }
    }
}

module.exports = {
    AgentWorkloadService,
    RUN_STATUS,
};
