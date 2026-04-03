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

    test('reconstructs a schedule-only follow-up using recent user messages', () => {
        const canonical = buildCanonicalWorkloadAction({
            request: 'run it five minutes from now',
        }, {
            now: '2026-04-02T09:00:00.000Z',
            timezone: 'UTC',
            recentMessages: [
                { role: 'user', content: 'gather information on the k3s cluster on the server' },
            ],
        });

        expect(canonical).toEqual(expect.objectContaining({
            action: 'create',
            title: 'Gather Information On The K3s',
            prompt: expect.stringContaining('gather information on the k3s cluster on the server'),
            trigger: {
                type: 'once',
                runAt: '2026-04-02T09:05:00.000Z',
            },
            metadata: expect.objectContaining({
                createdFromScenario: true,
                scenarioRequest: expect.stringContaining('gather information on the k3s cluster on the server'),
            }),
        }));
    });

    test('reconstructs a task-only follow-up using recent user schedule context', () => {
        const canonical = buildCanonicalWorkloadAction({
            request: 'gather information on the k3s cluster on the server',
        }, {
            now: '2026-04-02T09:00:00.000Z',
            timezone: 'UTC',
            recentMessages: [
                { role: 'user', content: 'run it five minutes from now' },
            ],
        });

        expect(canonical).toEqual(expect.objectContaining({
            action: 'create',
            prompt: expect.stringContaining('gather information on the k3s cluster on the server'),
            trigger: {
                type: 'once',
                runAt: '2026-04-02T09:05:00.000Z',
            },
            metadata: expect.objectContaining({
                createdFromScenario: true,
                scenarioRequest: expect.stringContaining('gather information on the k3s cluster on the server'),
            }),
        }));
    });

    test('splits scheduled research-to-pdf requests into content and export stages', () => {
        const canonical = buildCanonicalWorkloadAction({
            request: 'In 5 minutes can you do some research on ADHD and make a PDF document on it I can review, make it designed to questions on diagnosis and why its ADHD traits.',
        }, {
            now: '2026-04-02T09:00:00.000Z',
            timezone: 'UTC',
        });

        expect(canonical).toEqual(expect.objectContaining({
            action: 'create',
            trigger: {
                type: 'once',
                runAt: '2026-04-02T09:05:00.000Z',
            },
            metadata: expect.objectContaining({
                requestedOutputFormat: 'pdf',
            }),
            stages: [expect.objectContaining({
                when: 'on_success',
                outputFormat: 'pdf',
            })],
        }));
        expect(canonical.prompt).toContain('This scheduled run is split into content generation followed by PDF export.');
        expect(canonical.prompt).toContain('produce only the final document/report content');
        expect(canonical.prompt).toContain('do some research on ADHD and write the document on it I can review');
    });

    test('infers a conservative default schedule for security update cron requests without explicit timing', () => {
        const canonical = buildCanonicalWorkloadAction({
            request: 'Set up a cron job to reach out to the server and do security updates.',
        }, {
            timezone: 'America/Halifax',
        });

        expect(canonical).toEqual(expect.objectContaining({
            action: 'create',
            trigger: {
                type: 'cron',
                expression: '0 2 * * 1',
                timezone: 'America/Halifax',
            },
        }));
    });

    test('infers a conservative default schedule for security check cron requests without explicit timing', () => {
        const canonical = buildCanonicalWorkloadAction({
            request: 'Set up a cron job to reach out to the server and do security checks.',
        }, {
            timezone: 'America/Halifax',
        });

        expect(canonical).toEqual(expect.objectContaining({
            action: 'create',
            trigger: {
                type: 'cron',
                expression: '0 9 * * *',
                timezone: 'America/Halifax',
            },
        }));
    });
});
