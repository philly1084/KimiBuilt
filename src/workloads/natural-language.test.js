'use strict';

const {
    hasWorkloadIntent,
    inferWorkloadPolicy,
    parseWorkloadScenario,
    translateCronExpression,
} = require('./natural-language');

describe('workload natural language parsing', () => {
    test('parses a daily scenario into a cron workload', () => {
        const result = parseWorkloadScenario(
            'Every day at 11:05 PM summarize blockers from this conversation.',
            {
                timezone: 'America/Halifax',
                now: new Date('2026-04-01T10:00:00.000Z'),
            },
        );

        expect(result).toMatchObject({
            title: 'Summarize Blockers From This Conversation',
            prompt: 'summarize blockers from this conversation.',
            trigger: {
                type: 'cron',
                expression: '5 23 * * *',
                timezone: 'America/Halifax',
            },
            scheduleDetected: true,
        });
    });

    test('accepts everyday phrasing for daily workloads', () => {
        const result = parseWorkloadScenario('Everyday 11:05pm summarize blockers.', {
            timezone: 'America/Halifax',
            now: new Date('2026-04-01T10:00:00.000Z'),
        });

        expect(result.trigger).toEqual({
            type: 'cron',
            expression: '5 23 * * *',
            timezone: 'America/Halifax',
        });
    });

    test('parses a one-time scenario for tomorrow morning', () => {
        const result = parseWorkloadScenario(
            'Tomorrow at 9 AM review the latest repo activity and summarize blockers.',
            {
                timezone: 'UTC',
                now: new Date('2026-04-01T12:00:00.000Z'),
            },
        );

        expect(result.trigger.type).toBe('once');
        expect(result.trigger.runAt).toBe('2026-04-02T09:00:00.000Z');
        expect(result.prompt).toBe('review the latest repo activity and summarize blockers.');
    });

    test('detects explicit workload setup requests', () => {
        expect(hasWorkloadIntent('Set up a daily agent workload to summarize blockers every day at 11:05 PM.')).toBe(true);
        expect(hasWorkloadIntent('Set this up every day at 11:05 PM to summarize blockers.')).toBe(true);
        expect(hasWorkloadIntent('Explain what a cron expression is.')).toBe(false);
    });

    test('infers remote-build policy for environment-building work', () => {
        const policy = inferWorkloadPolicy('Build out the server environment on the cluster and repair the deployment.');

        expect(policy).toMatchObject({
            executionProfile: 'remote-build',
            allowSideEffects: true,
        });
    });

    test('translates simple cron expressions into readable labels', () => {
        expect(translateCronExpression('5 23 * * *', 'America/Halifax')).toBe('Every day at 11:05 PM');
        expect(translateCronExpression('0 9 * * 1-5', 'America/Halifax')).toBe('Every weekday at 9:00 AM');
    });
});
