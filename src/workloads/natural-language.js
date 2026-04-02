'use strict';

const { normalizeTimezone } = require('./cron-utils');
const { normalizePolicy } = require('./schema');

const DEFAULT_TIME_INFO = Object.freeze({
    hour: 9,
    minute: 0,
});

const WEEKDAY_TO_CRON = Object.freeze({
    sunday: '0',
    monday: '1',
    tuesday: '2',
    wednesday: '3',
    thursday: '4',
    friday: '5',
    saturday: '6',
});

function getDefaultTimezone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function extractScenarioTime(input = '') {
    const text = String(input || '').trim();
    const twelveHourMatch = text.match(/\b(1[0-2]|0?\d)(?::([0-5]\d))?\s*(am|pm)\b/i);
    if (twelveHourMatch) {
        const rawHour = Number(twelveHourMatch[1]);
        const minute = Number(twelveHourMatch[2] || 0);
        const meridiem = twelveHourMatch[3].toLowerCase();
        let hour = rawHour % 12;
        if (meridiem === 'pm') {
            hour += 12;
        }

        return { hour, minute };
    }

    const twentyFourHourMatch = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (twentyFourHourMatch) {
        return {
            hour: Number(twentyFourHourMatch[1]),
            minute: Number(twentyFourHourMatch[2]),
        };
    }

    if (/\bmorning\b/i.test(text)) {
        return { hour: 9, minute: 0 };
    }
    if (/\bafternoon\b/i.test(text)) {
        return { hour: 14, minute: 0 };
    }
    if (/\bevening\b/i.test(text)) {
        return { hour: 18, minute: 0 };
    }
    if (/\bnight\b|\bnightly\b/i.test(text)) {
        return { hour: 23, minute: 0 };
    }

    return { ...DEFAULT_TIME_INFO };
}

function buildOneTimeRunAt(lowerScenario = '', timeInfo = DEFAULT_TIME_INFO, now = new Date()) {
    const baseNow = now instanceof Date ? new Date(now.getTime()) : new Date(now);
    const runAt = new Date(baseNow.getTime());
    runAt.setSeconds(0, 0);
    runAt.setHours(timeInfo.hour, timeInfo.minute, 0, 0);

    if (/\btomorrow\b/i.test(lowerScenario)) {
        runAt.setDate(runAt.getDate() + 1);
        return runAt;
    }

    if (/\blater today\b/i.test(lowerScenario) || /\blater\b/i.test(lowerScenario)) {
        if (runAt <= baseNow) {
            runAt.setHours(baseNow.getHours() + 1, 0, 0, 0);
        }
        return runAt;
    }

    if (/\btoday\b/i.test(lowerScenario)) {
        if (runAt <= baseNow) {
            runAt.setDate(runAt.getDate() + 1);
        }
        return runAt;
    }

    if (runAt <= baseNow) {
        runAt.setHours(baseNow.getHours() + 1, 0, 0, 0);
    }

    return runAt;
}

function createCronExpression(timeInfo = DEFAULT_TIME_INFO, cadence = 'daily') {
    const minute = Number(timeInfo.minute || 0);
    const hour = Number(timeInfo.hour || 0);

    if (cadence === 'hourly') {
        return `${minute} * * * *`;
    }

    if (cadence === 'weekdays') {
        return `${minute} ${hour} * * 1-5`;
    }

    if (WEEKDAY_TO_CRON[cadence]) {
        return `${minute} ${hour} * * ${WEEKDAY_TO_CRON[cadence]}`;
    }

    return `${minute} ${hour} * * *`;
}

function extractTaskPromptFromScenario(scenario = '') {
    const timeFragment = '(?:\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?|morning|afternoon|evening|night)';
    const leadingPatterns = [
        new RegExp(`^(?:every hour|hourly)(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
        new RegExp(`^(?:every|each)\\s+weekdays?(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
        new RegExp(`^(?:every|each)\\s+workdays?(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
        new RegExp(`^(?:daily|nightly)(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
        new RegExp(`^(?:every\\s+day|everyday|each\\s+day)(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
        new RegExp(`^(?:every|each)\\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
        new RegExp(`^(?:once|one[- ]time)(?:\\s+(?:tomorrow|today|later today|later))?(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
        new RegExp(`^(?:tomorrow|today|later today|later)(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
    ];
    const embeddedPatterns = [
        new RegExp(`\\b(?:every hour|hourly)(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
        new RegExp(`\\b(?:every|each)\\s+weekdays?(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
        new RegExp(`\\b(?:every|each)\\s+workdays?(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
        new RegExp(`\\b(?:daily|nightly)(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
        new RegExp(`\\b(?:every\\s+day|everyday|each\\s+day)(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
        new RegExp(`\\b(?:every|each)\\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
        new RegExp(`\\b(?:once|one[- ]time)(?:\\s+(?:tomorrow|today|later today|later))?(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
        new RegExp(`\\b(?:tomorrow|today|later today|later)(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
    ];

    let taskPrompt = String(scenario || '').trim();
    leadingPatterns.forEach((pattern) => {
        taskPrompt = taskPrompt.replace(pattern, '');
    });
    embeddedPatterns.forEach((pattern) => {
        taskPrompt = taskPrompt.replace(pattern, '');
    });
    taskPrompt = taskPrompt.replace(
        /^(?:please\s+)?(?:set(?:\s+(?:this|it))?\s+up|schedule(?:\s+(?:this|it))?|create|make|add|queue|save)\s+(?:(?:a|an)\s+)?(?:(?:daily|weekly|hourly|nightly|recurring|one[- ]time)\s+)?(?:(?:agent|assistant)\s+)?(?:workload|automation|follow-?up|task|job)?\s*(?:to\s+)?/i,
        '',
    );
    taskPrompt = taskPrompt.replace(/^(?:have|let)\s+(?:the\s+)?(?:agent|assistant)\s+/i, '');

    return taskPrompt
        .trim()
        .replace(/^[,\s-]+/, '')
        .replace(/[,\s-]+$/, '')
        .replace(/\s{2,}/g, ' ')
        || String(scenario || '').trim();
}

function deriveWorkloadTitle(prompt = '') {
    const words = String(prompt || '')
        .trim()
        .replace(/[^\w\s-]/g, '')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 5);

    if (words.length === 0) {
        return 'New workload';
    }

    return words
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function slugifyWorkloadValue(value = '') {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
}

function hasSchedulingCue(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return [
        /\bevery hour\b/,
        /\bhourly\b/,
        /\bweekday\b/,
        /\bweekdays\b/,
        /\bevery workday\b/,
        /\beach workday\b/,
        /\bdaily\b/,
        /\bevery day\b/,
        /\beveryday\b/,
        /\beach day\b/,
        /\bnightly\b/,
        /\bevery night\b/,
        /\bevery morning\b/,
        /\bevery evening\b/,
        /\b(?:every|each)\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/,
        /\btomorrow\b/,
        /\btoday\b/,
        /\blater today\b/,
        /\bone[- ]time\b/,
        /\bonce\b/,
        /\bcron\b/,
        /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/,
        /\b([01]?\d|2[0-3]):([0-5]\d)\b/,
    ].some((pattern) => pattern.test(normalized));
}

function hasWorkloadIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    const hasAutomationLanguage = [
        /\b(set up|schedule|create|make|add|queue|save)\b[\s\S]{0,40}\b(job|workload|automation|follow-?up|task|agent)\b/,
        /\b(set up|schedule|create|make|add|queue|save)\b[\s\S]{0,60}\b(every|daily|hourly|weekdays?|tomorrow|later today|later|once)\b/,
        /\b(run|check|review|summarize|follow up|watch)\b[\s\S]{0,40}\b(every|daily|hourly|weekdays?|tomorrow|later today|once)\b/,
        /\b(remind|follow up|handle|review)\b[\s\S]{0,40}\b(later|tomorrow|daily|every day|everyday|weekdays?)\b/,
        /\b(job|workload|automation|cron|schedule|scheduled|deferred)\b/,
    ].some((pattern) => pattern.test(normalized));

    return hasSchedulingCue(normalized) && hasAutomationLanguage;
}

function inferWorkloadPolicy(prompt = '') {
    const normalized = String(prompt || '').trim().toLowerCase();
    if (!normalized) {
        return normalizePolicy({});
    }

    const hasRemoteTarget = /\b(remote|server|cluster|k3s|k8s|kubernetes|ssh|deployment|deploy|rollout|container|docker|pod|service|ingress|production|environment)\b/.test(normalized);
    const hasBuildVerb = /\b(build|install|set up|configure|repair|fix|restart|publish|push|update|deploy|rollout)\b/.test(normalized);
    const hasRemoteEnvironmentIntent = hasRemoteTarget && hasBuildVerb;

    if (hasRemoteEnvironmentIntent) {
        return normalizePolicy({
            executionProfile: 'remote-build',
            allowSideEffects: true,
        });
    }

    return normalizePolicy({});
}

function translateCronExpression(expression = '', timezone = 'UTC') {
    const normalized = String(expression || '').trim();
    const parts = normalized.split(/\s+/).filter(Boolean);
    if (parts.length !== 5) {
        return normalized ? `Custom schedule (${normalized})` : 'Custom schedule';
    }

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    const hourValue = Number(hour);
    const minuteValue = Number(minute);
    const hasFixedTime = Number.isInteger(hourValue) && Number.isInteger(minuteValue);
    const formattedTime = hasFixedTime
        ? new Date(Date.UTC(2026, 0, 1, hourValue, minuteValue)).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            timeZone: 'UTC',
        })
        : '';
    const dayNameMap = {
        0: 'Sunday',
        1: 'Monday',
        2: 'Tuesday',
        3: 'Wednesday',
        4: 'Thursday',
        5: 'Friday',
        6: 'Saturday',
        7: 'Sunday',
    };

    if (hasFixedTime && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        return `Every day at ${formattedTime}`;
    }

    if (hasFixedTime && dayOfMonth === '*' && month === '*' && dayOfWeek === '1-5') {
        return `Every weekday at ${formattedTime}`;
    }

    if (hasFixedTime && dayOfMonth === '*' && month === '*' && /^\d$/.test(dayOfWeek)) {
        return `Every ${dayNameMap[Number(dayOfWeek)] || 'week'} at ${formattedTime}`;
    }

    if (hour === '*' && /^\d+$/.test(minute) && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        return `Every hour at ${String(minute).padStart(2, '0')} minutes past`;
    }

    return `Custom cron ${normalized}${timezone ? ` (${timezone})` : ''}`;
}

function summarizeTrigger(trigger = {}) {
    if (!trigger || trigger.type === 'manual') {
        return 'Manual workload';
    }

    if (trigger.type === 'once') {
        return `Runs once at ${trigger.runAt}`;
    }

    return translateCronExpression(trigger.expression || '', trigger.timezone || 'UTC');
}

function parseWorkloadScenario(scenario = '', options = {}) {
    const normalizedScenario = String(scenario || '').trim();
    if (!normalizedScenario) {
        throw new Error('Describe the task and when it should run.');
    }

    const lowerScenario = normalizedScenario.toLowerCase();
    const resolvedTimezone = normalizeTimezone(options.timezone || getDefaultTimezone());
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const timeInfo = extractScenarioTime(normalizedScenario);
    const prompt = extractTaskPromptFromScenario(normalizedScenario) || normalizedScenario;
    const title = deriveWorkloadTitle(prompt);

    let trigger = { type: 'manual' };

    if (/\b(tomorrow|today|later today|later|once|one[- ]time)\b/i.test(lowerScenario)) {
        trigger = {
            type: 'once',
            runAt: buildOneTimeRunAt(lowerScenario, timeInfo, now).toISOString(),
        };
    } else if (/(every hour|hourly)/i.test(lowerScenario)) {
        trigger = {
            type: 'cron',
            expression: createCronExpression(timeInfo, 'hourly'),
            timezone: resolvedTimezone,
        };
    } else if (/(weekday|weekdays|every workday|each workday)/i.test(lowerScenario)) {
        trigger = {
            type: 'cron',
            expression: createCronExpression(timeInfo, 'weekdays'),
            timezone: resolvedTimezone,
        };
    } else {
        const weekdayMatch = lowerScenario.match(/\b(?:every|each)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/i);
        if (weekdayMatch) {
            trigger = {
                type: 'cron',
                expression: createCronExpression(timeInfo, weekdayMatch[1].toLowerCase()),
                timezone: resolvedTimezone,
            };
        } else if (/(daily|every day|everyday|each day|nightly|every night|every evening|every morning)/i.test(lowerScenario)) {
            trigger = {
                type: 'cron',
                expression: createCronExpression(timeInfo, 'daily'),
                timezone: resolvedTimezone,
            };
        }
    }

    return {
        title,
        prompt,
        callableSlug: slugifyWorkloadValue(title) || null,
        trigger,
        policy: inferWorkloadPolicy(prompt),
        summary: summarizeTrigger(trigger),
        scheduleDetected: trigger.type !== 'manual',
    };
}

module.exports = {
    buildOneTimeRunAt,
    createCronExpression,
    deriveWorkloadTitle,
    extractScenarioTime,
    extractTaskPromptFromScenario,
    hasSchedulingCue,
    hasWorkloadIntent,
    inferWorkloadPolicy,
    parseWorkloadScenario,
    slugifyWorkloadValue,
    summarizeTrigger,
    translateCronExpression,
};
