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

        expect(workload.stages).toEqual([{
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
        }]);
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
});
