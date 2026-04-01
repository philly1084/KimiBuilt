'use strict';

const {
    getNextCronRun,
    normalizeTimezone,
    parseCronExpression,
} = require('./cron-utils');

describe('workload cron utils', () => {
    test('parses five-field cron expressions with aliases', () => {
        const parsed = parseCronExpression('15 9 * * mon-fri');

        expect(parsed.minutes).toEqual([15]);
        expect(parsed.hours).toEqual([9]);
        expect(parsed.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    });

    test('computes the next matching run in UTC', () => {
        const next = getNextCronRun('15 9 * * *', 'UTC', new Date('2026-04-01T09:10:00.000Z'));

        expect(next.toISOString()).toBe('2026-04-01T09:15:00.000Z');
    });

    test('rejects invalid timezones', () => {
        expect(() => normalizeTimezone('Mars/Olympus')).toThrow('Invalid timezone');
    });
});
