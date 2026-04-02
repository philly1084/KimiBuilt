'use strict';

jest.mock('../realtime-hub', () => ({
    broadcastToAdmins: jest.fn(),
    broadcastToSession: jest.fn(),
}));

const { AgentWorkloadService } = require('./service');

describe('AgentWorkloadService', () => {
    let store;
    let sessionStore;
    let conversationRunService;
    let service;

    beforeEach(() => {
        store = {
            isAvailable: jest.fn(() => true),
            createWorkload: jest.fn(),
            enqueueRun: jest.fn(),
            addRunEvent: jest.fn(),
            getWorkloadById: jest.fn(),
            getWorkloadByCallableSlug: jest.fn(),
            updateWorkload: jest.fn(),
            cancelQueuedRunsForWorkload: jest.fn(),
            completeRun: jest.fn(),
            failRun: jest.fn(),
            listSessionWorkloads: jest.fn(),
            listRunsForWorkload: jest.fn(),
            getRunById: jest.fn(),
        };
        sessionStore = {
            getOwned: jest.fn(async (sessionId, ownerId) => ({ id: sessionId, ownerId, metadata: {} })),
            get: jest.fn(),
            isPersistent: jest.fn(() => true),
        };
        conversationRunService = {
            appendSyntheticMessage: jest.fn(),
            runChatTurn: jest.fn(),
        };

        service = new AgentWorkloadService({
            store,
            sessionStore,
            conversationRunService,
        });
    });

    test('queues the initial scheduled run for once workloads', async () => {
        const workload = {
            id: 'workload-1',
            ownerId: 'phill',
            sessionId: 'session-1',
            title: 'One-time summary',
            prompt: 'Summarize the thread.',
            enabled: true,
            trigger: {
                type: 'once',
                runAt: '2026-04-02T09:00:00.000Z',
            },
            policy: {
                executionProfile: 'default',
                toolIds: [],
                maxRounds: 3,
                maxToolCalls: 10,
                maxDurationMs: 120000,
                allowSideEffects: false,
            },
            stages: [],
        };

        store.createWorkload.mockResolvedValue(workload);
        store.enqueueRun.mockResolvedValue({
            id: 'run-1',
            workloadId: workload.id,
            scheduledFor: workload.trigger.runAt,
            reason: 'schedule',
            stageIndex: -1,
        });

        await service.createWorkload({
            sessionId: 'session-1',
            title: 'One-time summary',
            prompt: 'Summarize the thread.',
            trigger: {
                type: 'once',
                runAt: '2026-04-02T09:00:00.000Z',
            },
        }, 'phill');

        expect(store.enqueueRun).toHaveBeenCalledWith(expect.objectContaining({
            workloadId: 'workload-1',
            reason: 'schedule',
            stageIndex: -1,
        }));
        expect(store.addRunEvent).toHaveBeenCalledWith('run-1', 'queued', expect.any(Object));
        expect(conversationRunService.appendSyntheticMessage).toHaveBeenCalledWith(
            'session-1',
            'system',
            expect.stringContaining('queued'),
        );
    });

    test('reports workloads as unavailable when the session store is not Postgres-backed', () => {
        sessionStore.isPersistent.mockReturnValue(false);

        expect(service.isAvailable()).toBe(false);
    });

    test('creates a workload from a plain-language scheduling request', async () => {
        const workload = {
            id: 'workload-plain-1',
            ownerId: 'phill',
            sessionId: 'session-1',
            title: 'Review Repo Activity And Summarize',
            prompt: 'review repo activity and summarize blockers.',
            enabled: true,
            trigger: {
                type: 'cron',
                expression: '0 9 * * 1-5',
                timezone: 'America/Halifax',
            },
            policy: {
                executionProfile: 'default',
                toolIds: [],
                maxRounds: 3,
                maxToolCalls: 10,
                maxDurationMs: 120000,
                allowSideEffects: false,
            },
            stages: [],
        };

        store.createWorkload.mockResolvedValue(workload);
        store.enqueueRun.mockResolvedValue({
            id: 'run-plain-1',
            workloadId: workload.id,
            scheduledFor: '2026-04-02T12:00:00.000Z',
            reason: 'cron',
            stageIndex: -1,
        });

        const created = await service.createWorkloadFromScenario(
            'session-1',
            'phill',
            'Every weekday at 9 AM review repo activity and summarize blockers.',
            { timezone: 'America/Halifax' },
        );

        expect(store.createWorkload).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session-1',
            title: 'Review Repo Activity And Summarize',
            prompt: 'review repo activity and summarize blockers.',
            trigger: {
                type: 'cron',
                expression: '0 9 * * 1-5',
                timezone: 'America/Halifax',
            },
        }));
        expect(created.workload).toBe(workload);
        expect(created.scenario.scheduleDetected).toBe(true);
    });

    test('enqueues the first follow-up stage after a successful base run', async () => {
        const workload = {
            id: 'workload-1',
            ownerId: 'phill',
            sessionId: 'session-1',
            title: 'Investigate and retry',
            prompt: 'Inspect the current issue.',
            trigger: { type: 'manual' },
            policy: {
                executionProfile: 'default',
                toolIds: [],
                maxRounds: 3,
                maxToolCalls: 10,
                maxDurationMs: 120000,
                allowSideEffects: false,
            },
            stages: [
                {
                    when: 'on_success',
                    delayMs: 0,
                    prompt: 'Post a shorter summary.',
                    metadata: {},
                },
            ],
        };
        const run = {
            id: 'run-1',
            workload,
            stageIndex: -1,
            scheduledFor: '2026-04-01T09:00:00.000Z',
            prompt: workload.prompt,
        };

        conversationRunService.runChatTurn.mockResolvedValue({
            outputText: 'Initial investigation completed.',
            response: { id: 'resp-1' },
            execution: { trace: { steps: 1 } },
        });
        store.completeRun.mockResolvedValue({ id: 'run-1', status: 'completed' });
        store.enqueueRun.mockResolvedValue({
            id: 'run-2',
            workloadId: 'workload-1',
            stageIndex: 0,
            reason: 'followup',
        });

        await service.executeClaimedRun(run, 'worker-1');

        expect(conversationRunService.runChatTurn).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session-1',
            message: 'Inspect the current issue.',
        }));
        expect(store.enqueueRun).toHaveBeenCalledWith(expect.objectContaining({
            workloadId: 'workload-1',
            reason: 'followup',
            stageIndex: 0,
            parentRunId: 'run-1',
            prompt: 'Post a shorter summary.',
        }));
        expect(store.addRunEvent).toHaveBeenCalledWith('run-1', 'followup-enqueued', expect.objectContaining({
            followupRunId: 'run-2',
            stageIndex: 0,
        }));
    });

    test('schedules the next cron slot after a failed run', async () => {
        const workload = {
            id: 'workload-1',
            ownerId: 'phill',
            sessionId: 'session-1',
            title: 'Daily brief',
            prompt: 'Summarize the latest changes.',
            trigger: {
                type: 'cron',
                expression: '0 9 * * *',
                timezone: 'UTC',
            },
            policy: {
                executionProfile: 'default',
                toolIds: [],
                maxRounds: 3,
                maxToolCalls: 10,
                maxDurationMs: 120000,
                allowSideEffects: false,
            },
            stages: [],
        };
        const run = {
            id: 'run-1',
            workload,
            stageIndex: -1,
            scheduledFor: '2026-04-01T09:00:00.000Z',
            prompt: workload.prompt,
        };

        conversationRunService.runChatTurn.mockRejectedValue(new Error('LLM timeout'));
        store.failRun.mockResolvedValue({ id: 'run-1', status: 'failed' });
        store.enqueueRun.mockResolvedValue({
            id: 'run-2',
            workloadId: 'workload-1',
            reason: 'cron',
            stageIndex: -1,
        });

        await service.executeClaimedRun(run, 'worker-1');

        expect(store.failRun).toHaveBeenCalledWith('run-1', 'worker-1', expect.objectContaining({
            error: { message: 'LLM timeout' },
        }));
        expect(store.enqueueRun).toHaveBeenCalledWith(expect.objectContaining({
            workloadId: 'workload-1',
            reason: 'cron',
            stageIndex: -1,
        }));
    });
});
