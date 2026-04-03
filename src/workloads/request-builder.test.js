'use strict';

const {
    buildCanonicalWorkloadAction,
    buildCanonicalWorkloadPayload,
} = require('./request-builder');

describe('workload request builder', () => {
    test('builds a structured scheduled remote workload from a natural-language request', () => {
        const canonical = buildCanonicalWorkloadAction({
            request: 'Run `date` on the server in 5 minutes.',
        }, {
            now: '2026-04-02T09:00:00.000Z',
            timezone: 'UTC',
            session: {
                metadata: {
                    lastSshTarget: {
                        host: '10.0.0.5',
                        username: 'ubuntu',
                        port: 22,
                    },
                },
            },
        });

        expect(canonical).toEqual(expect.objectContaining({
            action: 'create',
            title: 'Run Date On The Server',
            prompt: 'Run `date` on the server.',
            trigger: {
                type: 'once',
                runAt: '2026-04-02T09:05:00.000Z',
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
        }));
    });

    test('reconstructs malformed workload params into a canonical scheduled payload', () => {
        const canonical = buildCanonicalWorkloadPayload({
            title: 'Check remote time',
            command: 'date',
            schedule: 'in 5 minutes',
            tool: 'remote-command',
        }, {
            now: '2026-04-02T09:00:00.000Z',
            timezone: 'UTC',
            session: {
                metadata: {
                    lastSshTarget: {
                        host: '10.0.0.5',
                        username: 'ubuntu',
                        port: 22,
                    },
                },
            },
        });

        expect(canonical).toEqual(expect.objectContaining({
            scenarioSource: 'Run `date` on the server in 5 minutes',
            payload: expect.objectContaining({
                title: 'Check remote time',
                trigger: {
                    type: 'once',
                    runAt: '2026-04-02T09:05:00.000Z',
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
            }),
        }));
    });
});
