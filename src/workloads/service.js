'use strict';

const { getNextCronRun } = require('./cron-utils');
const { extractStructuredExecution } = require('./execution-extractor');
const { parseWorkloadScenario } = require('./natural-language');
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
        const workload = await this.store.createWorkload(normalized);
        await this.ensureNextScheduledRun(workload);
        await this.emitWorkloadUpdate('workload_updated', workload.sessionId, {
            workload,
        });
        return workload;
    }

    async createWorkloadFromScenario(sessionId, ownerId, request = '', options = {}) {
        const scenario = parseWorkloadScenario(request, {
            timezone: options.timezone,
            now: options.now,
        });
        const session = options.session || await this.sessionStore.getOwned(sessionId, ownerId);
        const payload = {
            sessionId,
            mode: options.mode || 'chat',
            title: options.title || scenario.title,
            prompt: options.prompt || scenario.prompt,
            execution: options.execution || extractStructuredExecution({
                request,
                session,
            }),
            enabled: options.enabled !== false,
            callableSlug: Object.prototype.hasOwnProperty.call(options, 'callableSlug')
                ? options.callableSlug
                : null,
            trigger: options.trigger || scenario.trigger,
            policy: options.policy || scenario.policy,
            stages: options.stages || [],
            metadata: {
                createdFromScenario: true,
                scenarioRequest: request,
                ...(options.metadata && typeof options.metadata === 'object' ? options.metadata : {}),
            },
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
            sessionId: current.sessionId,
        }, {
            ownerId,
            sessionId: current.sessionId,
        });

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

        if (run) {
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
            const result = execution
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
                    message: prompt,
                    executionProfile: workload.policy?.executionProfile,
                    requestedToolIds: workload.policy?.toolIds || [],
                    policy: workload.policy || {},
                    metadata: {
                        taskType: workload.mode || 'chat',
                        clientSurface: 'workload',
                        workloadId: workload.id,
                        runId: run.id,
                        workloadRun: true,
                        remoteBuildAutonomyApproved: workload.policy?.allowSideEffects === true,
                    },
                });

            const completed = await this.store.completeRun(run.id, workerId, {
                responseId: result.response?.id || null,
                trace: result.execution?.trace
                    || result.response?.metadata?.executionTrace
                    || (execution ? {
                        structuredExecution: true,
                        toolId: execution.tool,
                        params: execution.params || {},
                    } : {}),
            });
            await this.addRunEventSafe(run.id, 'completed', {
                responseId: result.response?.id || null,
                structuredExecution: Boolean(execution),
            });
            await this.scheduleFollowupStage(workload, run, true);
            await this.ensureNextScheduledRun(workload, run);

            await this.appendSyntheticMessageSafe(
                workload.sessionId,
                'system',
                `Deferred workload "${workload.title}" completed${stage ? ` (stage ${run.stageIndex + 1})` : ''}.`,
            );
            await this.emitWorkloadUpdate('workload_completed', workload.sessionId, {
                workloadId: workload.id,
                runId: run.id,
                output: result.outputText || '',
                responseId: result.response?.id || null,
            });
            return completed;
        } catch (error) {
            const failed = await this.store.failRun(run.id, workerId, {
                error: {
                    message: error.message,
                },
            });
            await this.addRunEventSafe(run.id, 'failed', {
                error: error.message,
            });
            await this.scheduleFollowupStage(workload, run, false);
            await this.ensureNextScheduledRun(workload, run);
            await this.appendSyntheticMessageSafe(
                workload.sessionId,
                'system',
                `Deferred workload "${workload.title}" failed${stage ? ` (stage ${run.stageIndex + 1})` : ''}: ${error.message}`,
            );
            await this.emitWorkloadUpdate('workload_failed', workload.sessionId, {
                workloadId: workload.id,
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
            if (run) {
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
            if (run) {
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
            prompt: stage.prompt || workload.prompt,
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

        if (followupRun) {
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
