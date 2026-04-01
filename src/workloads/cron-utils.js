'use strict';

const MINUTE_MS = 60 * 1000;
const FIVE_FIELD_CRON_PARTS = 5;

function normalizeTimezone(timezone = 'UTC') {
    const value = String(timezone || '').trim() || 'UTC';
    try {
        Intl.DateTimeFormat('en-US', {
            timeZone: value,
            year: 'numeric',
        }).format(new Date());
        return value;
    } catch (_error) {
        throw new Error(`Invalid timezone: ${value}`);
    }
}

function normalizeFieldValue(rawValue, min, max, label) {
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new Error(`Invalid ${label} value: ${rawValue}`);
    }
    return value;
}

function expandCronField(field = '*', { min, max, aliasMap = null, label }) {
    const normalizedField = String(field || '*').trim().toLowerCase();
    if (!normalizedField) {
        throw new Error(`Missing ${label} field`);
    }

    if (normalizedField === '*') {
        return null;
    }

    const values = new Set();
    const segments = normalizedField.split(',');

    for (const segment of segments) {
        const part = segment.trim();
        if (!part) {
            continue;
        }

        const [rangeExpression, stepExpression] = part.split('/');
        const step = stepExpression == null
            ? 1
            : normalizeFieldValue(stepExpression, 1, max - min + 1, `${label} step`);

        let rangeStart;
        let rangeEnd;

        if (rangeExpression === '*') {
            rangeStart = min;
            rangeEnd = max;
        } else if (rangeExpression.includes('-')) {
            const [startValue, endValue] = rangeExpression.split('-');
            rangeStart = normalizeCronToken(startValue, min, max, aliasMap, label);
            rangeEnd = normalizeCronToken(endValue, min, max, aliasMap, label);
            if (rangeEnd < rangeStart) {
                throw new Error(`Invalid ${label} range: ${rangeExpression}`);
            }
        } else {
            rangeStart = normalizeCronToken(rangeExpression, min, max, aliasMap, label);
            rangeEnd = rangeStart;
        }

        for (let value = rangeStart; value <= rangeEnd; value += step) {
            values.add(value);
        }
    }

    if (values.size === 0) {
        throw new Error(`Invalid ${label} field: ${field}`);
    }

    return Array.from(values).sort((left, right) => left - right);
}

function normalizeCronToken(token, min, max, aliasMap, label) {
    const raw = String(token || '').trim().toLowerCase();
    if (!raw) {
        throw new Error(`Invalid ${label} value`);
    }

    if (aliasMap && Object.prototype.hasOwnProperty.call(aliasMap, raw)) {
        return aliasMap[raw];
    }

    return normalizeFieldValue(raw, min, max, label);
}

function parseCronExpression(expression = '') {
    const normalizedExpression = String(expression || '').trim();
    const parts = normalizedExpression.split(/\s+/).filter(Boolean);

    if (parts.length !== FIVE_FIELD_CRON_PARTS) {
        throw new Error(`Cron expression must contain ${FIVE_FIELD_CRON_PARTS} fields`);
    }

    return {
        expression: normalizedExpression,
        minutes: expandCronField(parts[0], { min: 0, max: 59, label: 'minute' }),
        hours: expandCronField(parts[1], { min: 0, max: 23, label: 'hour' }),
        daysOfMonth: expandCronField(parts[2], { min: 1, max: 31, label: 'day-of-month' }),
        months: expandCronField(parts[3], { min: 1, max: 12, label: 'month' }),
        daysOfWeek: expandCronField(parts[4], {
            min: 0,
            max: 6,
            aliasMap: {
                sun: 0,
                mon: 1,
                tue: 2,
                wed: 3,
                thu: 4,
                fri: 5,
                sat: 6,
                '7': 0,
            },
            label: 'day-of-week',
        }),
    };
}

function getTimezoneParts(date = new Date(), timezone = 'UTC') {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: normalizeTimezone(timezone),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        weekday: 'short',
    });

    const parts = formatter.formatToParts(date);
    const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const weekdayMap = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
    };

    return {
        year: Number(lookup.year),
        month: Number(lookup.month),
        day: Number(lookup.day),
        hour: Number(lookup.hour),
        minute: Number(lookup.minute),
        second: Number(lookup.second),
        weekday: weekdayMap[lookup.weekday] ?? null,
    };
}

function matchesCronSchedule(schedule, parts) {
    if (!schedule || !parts) {
        return false;
    }

    const monthMatch = !schedule.months || schedule.months.includes(parts.month);
    const hourMatch = !schedule.hours || schedule.hours.includes(parts.hour);
    const minuteMatch = !schedule.minutes || schedule.minutes.includes(parts.minute);
    const dayOfMonthMatch = !schedule.daysOfMonth || schedule.daysOfMonth.includes(parts.day);
    const dayOfWeekMatch = !schedule.daysOfWeek || schedule.daysOfWeek.includes(parts.weekday);

    return monthMatch
        && hourMatch
        && minuteMatch
        && dayOfMonthMatch
        && dayOfWeekMatch;
}

function getNextCronRun(expression, timezone = 'UTC', fromDate = new Date()) {
    const schedule = parseCronExpression(expression);
    const normalizedTimezone = normalizeTimezone(timezone);
    const baseDate = fromDate instanceof Date ? fromDate : new Date(fromDate);
    const start = new Date(baseDate.getTime());
    start.setSeconds(0, 0);

    const cursor = new Date(start.getTime() + MINUTE_MS);
    const maxIterations = 366 * 24 * 60;

    for (let attempt = 0; attempt < maxIterations; attempt += 1) {
        const parts = getTimezoneParts(cursor, normalizedTimezone);
        if (matchesCronSchedule(schedule, parts)) {
            return new Date(cursor.getTime());
        }
        cursor.setTime(cursor.getTime() + MINUTE_MS);
    }

    throw new Error(`Unable to calculate next run for cron expression: ${expression}`);
}

module.exports = {
    getNextCronRun,
    getTimezoneParts,
    matchesCronSchedule,
    normalizeTimezone,
    parseCronExpression,
};
