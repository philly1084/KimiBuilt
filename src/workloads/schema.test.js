'use strict';

const {
    deriveRunIdempotencyKey,
    validateWorkloadPayload,
} = require('./schema');

describe('workload schema', () => {
    test('normalizes a valid workload payload with defaults', () => {
        const workload = validateWorkloadPayload({
            sessionId: 'session-1',
            title: 'Daily brief',
            prompt: 'Summarize the latest blockers.',
            trigger: {
                type: 'manual',
            },
        }, {
            ownerId: 'phill',
            sessionId: 'session-1',
        });

        expect(workload).toMatchObject({
            ownerId: 'phill',
            sessionId: 'session-1',
            title: 'Daily brief',
            mode: 'chat',
            enabled: true,
            callableSlug: null,
            trigger: { type: 'manual' },
            policy: {
                executionProfile: 'default',
                toolIds: [],
                maxRounds: 3,
                maxToolCalls: 10,
                maxDurationMs: 120000,
                allowSideEffects: false,
            },
            stages: [],
        });
    });

    test('rejects invalid callable slugs', () => {
        expect(() => validateWorkloadPayload({
            sessionId: 'session-1',
            title: 'Bad slug',
            prompt: 'Hello',
            callableSlug: 'Bad Slug',
        }, {
            ownerId: 'phill',
            sessionId: 'session-1',
        })).toThrow('callableSlug');
    });

    test('rejects blocked side-effect tools unless explicitly approved', () => {
        expect(() => validateWorkloadPayload({
            sessionId: 'session-1',
            title: 'Remote fixer',
            prompt: 'Fix the server issue.',
            policy: {
                executionProfile: 'remote-build',
                toolIds: ['remote-command'],
            },
        }, {
            ownerId: 'phill',
            sessionId: 'session-1',
        })).toThrow('requires allowSideEffects=true');
    });

    test('rejects invalid follow-up stage conditions', () => {
        expect(() => validateWorkloadPayload({
            sessionId: 'session-1',
            title: 'Bad stages',
            prompt: 'Hello',
            stages: [{ when: 'sometimes' }],
        }, {
            ownerId: 'phill',
            sessionId: 'session-1',
        })).toThrow('stages[0].when');
    });

    test('normalizes structured remote execution payloads', () => {
        const workload = validateWorkloadPayload({
            sessionId: 'session-1',
            title: 'Check remote time',
            prompt: 'Run `date` on the server.',
            trigger: {
                type: 'once',
                runAt: '2026-04-02T09:00:00.000Z',
            },
            execution: {
                tool: 'remote-command',
                params: {
                    host: '10.0.0.5',
                    username: 'ubuntu',
                    port: 22,
                    command: 'date',
                },
            },
        }, {
            ownerId: 'phill',
            sessionId: 'session-1',
        });

        expect(workload.execution).toEqual({
            tool: 'remote-command',
            params: {
                host: '10.0.0.5',
                username: 'ubuntu',
                port: 22,
                command: 'date',
            },
        });
    });

    test('normalizes structured managed-app execution payloads', () => {
        const workload = validateWorkloadPayload({
            sessionId: 'session-1',
            title: 'Fix the repo',
            prompt: 'Fix the failing build in this repo.',
            trigger: {
                type: 'manual',
            },
            execution: {
                tool: 'managed-app',
                params: {
                    action: 'update',
                    appRef: 'kimibuilt',
                    deployTarget: 'ssh',
                },
            },
            policy: {
                executionProfile: 'remote-build',
                allowSideEffects: true,
            },
        }, {
            ownerId: 'phill',
            sessionId: 'session-1',
        });

        expect(workload.execution).toEqual({
            tool: 'managed-app',
            params: {
                action: 'update',
                prompt: 'Fix the failing build in this repo.',
                sourcePrompt: 'Fix the failing build in this repo.',
                appRef: 'kimibuilt',
                deployTarget: 'ssh',
            },
        });
    });

    test('preserves structured execution on follow-up stages', () => {
        const workload = validateWorkloadPayload({
            sessionId: 'session-1',
            title: 'Check remote time later',
            prompt: 'Run `date` on the server.',
            stages: [{
                when: 'on_success',
                delayMs: 0,
                prompt: 'Run `uptime` on the server.',
                execution: {
                    tool: 'remote-command',
                    params: {
                        host: '10.0.0.5',
                        username: 'ubuntu',
                        command: 'uptime',
                    },
                },
            }],
        }, {
            ownerId: 'phill',
            sessionId: 'session-1',
        });

        expect(workload.stages).toEqual([expect.objectContaining({
            when: 'on_success',
            delayMs: 0,
            prompt: 'Run `uptime` on the server.',
            execution: {
                tool: 'remote-command',
                params: {
                    host: '10.0.0.5',
                    username: 'ubuntu',
                    command: 'uptime',
                },
            },
            metadata: {},
        })]);
    });

    test('normalizes stage handoff fields for chained routines', () => {
        const workload = validateWorkloadPayload({
            sessionId: 'session-1',
            title: 'Morning routine',
            prompt: 'Gather cluster facts.',
            policy: {
                executionProfile: 'default',
                toolIds: ['web-search'],
            },
            stages: [{
                when: 'on_success',
                delayMs: 0,
                prompt: 'Turn the facts into a review plan.',
                toolIds: ['file-write'],
                outputKey: 'plan.v1',
            }, {
                when: 'on_success',
                delayMs: 0,
                inputFrom: ['plan.v1'],
                outputFormat: 'pdf',
            }],
        }, {
            ownerId: 'phill',
            sessionId: 'session-1',
        });

        expect(workload.stages).toEqual([
            expect.objectContaining({
                toolIds: ['file-write'],
                inputFrom: [],
                outputKey: 'plan.v1',
                outputFormat: null,
            }),
            expect.objectContaining({
                toolIds: [],
                inputFrom: ['plan.v1'],
                outputKey: null,
                outputFormat: 'pdf',
            }),
        ]);
    });

    test('derives stable idempotency keys', () => {
        const key = deriveRunIdempotencyKey({
            workloadId: 'workload-1',
            scheduledFor: '2026-04-01T09:00:00.000Z',
            stageIndex: -1,
            reason: 'cron',
        });

        expect(key).toBe('workload-1:cron:2026-04-01T09:00:00.000Z:stage--1');
    });

    test('normalizes project workloads into locked milestone plans', () => {
        const workload = validateWorkloadPayload({
            sessionId: 'session-1',
            title: 'Long project',
            mode: 'project',
            prompt: 'Build and deploy the long-running project.',
            metadata: {
                project: {
                    milestones: [{
                        title: 'Approve the rollout plan',
                        acceptanceCriteria: ['Stakeholder review completed'],
                    }],
                },
            },
        }, {
            ownerId: 'phill',
            sessionId: 'session-1',
        });

        expect(workload.metadata).toEqual(expect.objectContaining({
            projectMode: true,
            project: expect.objectContaining({
                activeMilestoneId: 'approve-the-rollout-plan',
                governance: expect.objectContaining({
                    modificationPolicy: 'technical_requirements_only',
                }),
            }),
        }));
    });
});
