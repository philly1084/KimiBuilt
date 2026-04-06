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

const NUMBER_WORD_VALUES = Object.freeze({
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
});

const TENS_WORD_VALUES = Object.freeze({
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
});

const ONES_NUMBER_WORD_FRAGMENT = 'one|two|three|four|five|six|seven|eight|nine';
const SIMPLE_NUMBER_WORD_FRAGMENT = 'a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen';
const TENS_NUMBER_WORD_FRAGMENT = 'twenty|thirty|forty|fifty|sixty';
const RELATIVE_DELAY_AMOUNT_FRAGMENT = `(?:\\d+|${SIMPLE_NUMBER_WORD_FRAGMENT}|${TENS_NUMBER_WORD_FRAGMENT}(?:[-\\s](?:${ONES_NUMBER_WORD_FRAGMENT}))?)`;
const TODAY_SCHEDULE_FRAGMENT = 'today\\b(?![\'’]s)';

function getDefaultTimezone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function buildRelativeDelayPattern(flags = 'i') {
    return new RegExp(
        `\\b(?:(?:in|after)\\s+(${RELATIVE_DELAY_AMOUNT_FRAGMENT})\\s*(minute|minutes|min|mins|hour|hours|hr|hrs)\\b(?:\\s+from\\s+now)?|(${RELATIVE_DELAY_AMOUNT_FRAGMENT})\\s*(minute|minutes|min|mins|hour|hours|hr|hrs)\\b\\s+from\\s+now)`,
        flags,
    );
}

function parseRelativeAmountToken(value = '') {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ');
    if (!normalized) {
        return null;
    }

    if (/^\d+$/.test(normalized)) {
        const amount = Number(normalized);
        return Number.isFinite(amount) ? amount : null;
    }

    if (Object.prototype.hasOwnProperty.call(NUMBER_WORD_VALUES, normalized)) {
        return NUMBER_WORD_VALUES[normalized];
    }

    if (Object.prototype.hasOwnProperty.call(TENS_WORD_VALUES, normalized)) {
        return TENS_WORD_VALUES[normalized];
    }

    const parts = normalized.split(' ');
    if (parts.length === 2
        && Object.prototype.hasOwnProperty.call(TENS_WORD_VALUES, parts[0])
        && Object.prototype.hasOwnProperty.call(NUMBER_WORD_VALUES, parts[1])
        && NUMBER_WORD_VALUES[parts[1]] < 10) {
        return TENS_WORD_VALUES[parts[0]] + NUMBER_WORD_VALUES[parts[1]];
    }

    return null;
}

function extractRelativeDelayMs(input = '') {
    const text = String(input || '').trim();
    const match = text.match(buildRelativeDelayPattern());
    if (!match) {
        return null;
    }

    const amount = parseRelativeAmountToken(match[1] || match[3]);
    if (!Number.isFinite(amount) || amount <= 0) {
        return null;
    }

    const unit = String(match[2] || match[4] || '').toLowerCase();
    if (unit.startsWith('h')) {
        return amount * 60 * 60 * 1000;
    }

    return amount * 60 * 1000;
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

function getZonedDateParts(date = new Date(), timezone = 'UTC') {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: normalizeTimezone(timezone || getDefaultTimezone()),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const readPart = (type) => Number(parts.find((entry) => entry.type === type)?.value || 0);

    return {
        year: readPart('year'),
        month: readPart('month'),
        day: readPart('day'),
        hour: readPart('hour'),
        minute: readPart('minute'),
        second: readPart('second'),
    };
}

function buildUtcDateFromZonedParts(parts = {}, timezone = 'UTC') {
    const utcGuess = Date.UTC(
        Number(parts.year) || 0,
        Math.max(0, (Number(parts.month) || 1) - 1),
        Number(parts.day) || 1,
        Number(parts.hour) || 0,
        Number(parts.minute) || 0,
        Number(parts.second) || 0,
        0,
    );
    const guessDate = new Date(utcGuess);
    const guessParts = getZonedDateParts(guessDate, timezone);
    const targetAsUtc = Date.UTC(
        Number(parts.year) || 0,
        Math.max(0, (Number(parts.month) || 1) - 1),
        Number(parts.day) || 1,
        Number(parts.hour) || 0,
        Number(parts.minute) || 0,
        Number(parts.second) || 0,
        0,
    );
    const guessAsUtc = Date.UTC(
        guessParts.year || 0,
        Math.max(0, (guessParts.month || 1) - 1),
        guessParts.day || 1,
        guessParts.hour || 0,
        guessParts.minute || 0,
        guessParts.second || 0,
        0,
    );

    return new Date(utcGuess + (targetAsUtc - guessAsUtc));
}

function addDaysToZonedDateParts(parts = {}, dayCount = 0) {
    const day = new Date(Date.UTC(
        Number(parts.year) || 0,
        Math.max(0, (Number(parts.month) || 1) - 1),
        Number(parts.day) || 1,
        0,
        0,
        0,
        0,
    ));
    day.setUTCDate(day.getUTCDate() + dayCount);

    return {
        year: day.getUTCFullYear(),
        month: day.getUTCMonth() + 1,
        day: day.getUTCDate(),
    };
}

function buildOneTimeRunAt(lowerScenario = '', timeInfo = DEFAULT_TIME_INFO, now = new Date(), timezone = 'UTC') {
    const baseNow = now instanceof Date ? new Date(now.getTime()) : new Date(now);
    const relativeDelayMs = extractRelativeDelayMs(lowerScenario);
    if (relativeDelayMs != null) {
        return new Date(baseNow.getTime() + relativeDelayMs);
    }

    const resolvedTimezone = normalizeTimezone(timezone || getDefaultTimezone());
    const zonedNow = getZonedDateParts(baseNow, resolvedTimezone);
    const buildRunAt = (dateParts, hour, minute) => buildUtcDateFromZonedParts({
        ...dateParts,
        hour,
        minute,
        second: 0,
    }, resolvedTimezone);
    const nextLocalHour = buildRunAt(
        addDaysToZonedDateParts(zonedNow, Math.floor((zonedNow.hour + 1) / 24)),
        (zonedNow.hour + 1) % 24,
        0,
    );
    const sameDay = {
        year: zonedNow.year,
        month: zonedNow.month,
        day: zonedNow.day,
    };
    let runAt = buildRunAt(sameDay, timeInfo.hour, timeInfo.minute);

    if (/\btomorrow\b/i.test(lowerScenario)) {
        return buildRunAt(addDaysToZonedDateParts(zonedNow, 1), timeInfo.hour, timeInfo.minute);
    }

    if (/\blater today\b/i.test(lowerScenario) || /\blater\b/i.test(lowerScenario)) {
        return runAt <= baseNow ? nextLocalHour : runAt;
    }

    if (new RegExp(`\\b${TODAY_SCHEDULE_FRAGMENT}`, 'i').test(lowerScenario)) {
        if (runAt <= baseNow) {
            runAt = buildRunAt(addDaysToZonedDateParts(zonedNow, 1), timeInfo.hour, timeInfo.minute);
        }
        return runAt;
    }

    if (runAt <= baseNow) {
        runAt = nextLocalHour;
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
    const relativeDelayFragment = `(?:(?:in|after)\\s+${RELATIVE_DELAY_AMOUNT_FRAGMENT}\\s*(?:minutes?|mins?|hours?|hrs?)(?:\\s+from\\s+now)?|${RELATIVE_DELAY_AMOUNT_FRAGMENT}\\s*(?:minutes?|mins?|hours?|hrs?)\\s+from\\s+now)`;
    const explicitDayFragment = `(?:tomorrow|later today|later|${TODAY_SCHEDULE_FRAGMENT})`;
    const leadingPatterns = [
        new RegExp(`^(?:every hour|hourly)(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
        new RegExp(`^(?:every|each)\\s+weekdays?(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
        new RegExp(`^(?:every|each)\\s+workdays?(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
        new RegExp(`^(?:daily|nightly)(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
        new RegExp(`^(?:every\\s+day|everyday|each\\s+day)(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
        new RegExp(`^(?:every|each)\\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
        new RegExp(`^(?:${relativeDelayFragment})[\\s,:-]*`, 'i'),
        new RegExp(`^(?:once|one[- ]time)(?:\\s+(?:${explicitDayFragment}))?(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
        new RegExp(`^(?:${explicitDayFragment})(?:\\s+at\\s+${timeFragment})?[\\s,:-]*`, 'i'),
    ];
    const embeddedPatterns = [
        new RegExp(`\\b(?:every hour|hourly)(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
        new RegExp(`\\b(?:every|each)\\s+weekdays?(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
        new RegExp(`\\b(?:every|each)\\s+workdays?(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
        new RegExp(`\\b(?:daily|nightly)(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
        new RegExp(`\\b(?:every\\s+day|everyday|each\\s+day)(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
        new RegExp(`\\b(?:every|each)\\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
        new RegExp(`\\b(?:${relativeDelayFragment})\\b`, 'gi'),
        new RegExp(`\\b(?:once|one[- ]time)(?:\\s+(?:${explicitDayFragment}))?(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
        new RegExp(`\\b(?:${explicitDayFragment})(?:\\s+at\\s+${timeFragment})?\\b`, 'gi'),
    ];

    let taskPrompt = String(scenario || '').trim();
    leadingPatterns.forEach((pattern) => {
        taskPrompt = taskPrompt.replace(pattern, '');
    });
    embeddedPatterns.forEach((pattern) => {
        taskPrompt = taskPrompt.replace(pattern, '');
    });
    taskPrompt = taskPrompt.replace(
        /^(?:please\s+)?(?:set(?:\s+(?:this|it))?\s+up|schedule(?:\s+(?:this|it))?|create|make|add|queue|save)\s+(?:(?:a|an)\s+)?(?:(?:daily|weekly|hourly|nightly|recurring|one[- ]time)\s+)?(?:(?:agent|assistant)\s+)?(?:workload|automation|follow-?up|task|job)\s*(?:to\s+)?/i,
        '',
    );
    taskPrompt = taskPrompt.replace(/^(?:can|could|would)\s+you\s+/i, '');
    taskPrompt = taskPrompt.replace(
        /^(?:please\s+)?(?:run|set(?:\s+(?:this|it))?\s+up|schedule(?:\s+(?:this|it))?|create|make|add|queue|save)\s+(?:(?:a|an)\s+)?cron\s*(?:later\s*)?(?:to\s+)?/i,
        '',
    );
    taskPrompt = taskPrompt.replace(
        /^(?:please\s+)?(?:run|set(?:\s+(?:this|it))?\s+up|schedule(?:\s+(?:this|it))?|create|make|add|queue|save)\s+(?:(?:a|an)\s+)?(?:(?:cron|scheduled?|deferred)\s+)?(?:(?:daily|weekly|hourly|nightly|recurring|one[- ]time)\s+)?(?:(?:agent|assistant)\s+)?(?:workload|automation|follow-?up|task|job|check)\s*(?:later\s*)?(?:to\s+)?/i,
        '',
    );
    taskPrompt = taskPrompt.replace(
        /^(?:please\s+)?(?:run|set(?:\s+(?:this|it))?\s+up|schedule(?:\s+(?:this|it))?|create|make|add|queue|save)\s+(?:(?:a|an)\s+)?to\s+/i,
        '',
    );
    taskPrompt = taskPrompt.replace(/^(?:have|let)\s+(?:the\s+)?(?:agent|assistant)\s+/i, '');
    taskPrompt = taskPrompt.replace(/\bcron\b/gi, ' ');

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
        new RegExp(`\\b${TODAY_SCHEDULE_FRAGMENT}`, 'i'),
        /\blater today\b/,
        buildRelativeDelayPattern(),
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

    const scheduleIntentFragment = `(?:every|daily|hourly|weekdays?|tomorrow|later today|later|once|at\\s+(?:1[0-2]|0?\\d)(?::[0-5]\\d)?\\s*(?:am|pm)|at\\s+(?:[01]?\\d|2[0-3]):[0-5]\\d|(?:(?:in|after)\\s+${RELATIVE_DELAY_AMOUNT_FRAGMENT}\\s*(?:minutes?|mins?|hours?|hrs?)(?:\\s+from\\s+now)?|${RELATIVE_DELAY_AMOUNT_FRAGMENT}\\s*(?:minutes?|mins?|hours?|hrs?)\\s+from\\s+now))`;

    const hasExplicitWorkloadSetup = [
        /\b(set up|setup|schedule|create|make|add|queue|save)\b[\s\S]{0,24}\b(?:an?\s+|the\s+)?(?:automation|workload|follow-?up|reminder|cron(?:\s+job)?|scheduled\s+job|scheduled\s+task|recurring\s+job|recurring\s+task)\b/,
        new RegExp(`\\b(set up|setup|schedule|queue|save)\\b[\\s\\S]{0,60}\\b${scheduleIntentFragment}\\b`),
    ].some((pattern) => pattern.test(normalized));

    const hasTimedTaskRequest = [
        new RegExp(`\\b(run|check|review|summarize|follow up|watch|remind|collect|gather|send|report|monitor|audit|scan)\\b[\\s\\S]{0,40}\\b${scheduleIntentFragment}\\b`),
        new RegExp(`\\b${scheduleIntentFragment}\\b[\\s\\S]{0,60}\\b(run|check|review|summarize|follow up|watch|remind|collect|gather|send|report|monitor|audit|scan)\\b`),
    ].some((pattern) => pattern.test(normalized));

    return hasSchedulingCue(normalized) && (hasExplicitWorkloadSetup || hasTimedTaskRequest);
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

function hasImplicitRecurringJobIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(set up|setup|schedule|create|make|add|queue|save)\b[\s\S]{0,24}\b(?:an?\s+|the\s+)?(?:automation|workload|follow-?up|reminder|cron(?:\s+job)?|scheduled\s+job|scheduled\s+task|recurring\s+job|recurring\s+task)\b/.test(normalized);
}

function inferDefaultRecurringTrigger(scenario = '', timezone = 'UTC') {
    const normalized = String(scenario || '').trim().toLowerCase();
    if (!normalized || !hasImplicitRecurringJobIntent(normalized) || hasSchedulingCue(normalized)) {
        return null;
    }

    if (/\b(update|updates|upgrade|upgrades|patch|patches)\b/.test(normalized)) {
        return {
            type: 'cron',
            expression: '0 2 * * 1',
            timezone,
        };
    }

    if (/\b(check|checks|monitor|monitoring|audit|audits|scan|scans|health|verify|verification|security)\b/.test(normalized)) {
        return {
            type: 'cron',
            expression: '0 9 * * *',
            timezone,
        };
    }

    return {
        type: 'cron',
        expression: '0 9 * * *',
        timezone,
    };
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
    const hasRecurringCadence = /(every hour|hourly|weekday|weekdays|every workday|each workday|daily|every day|everyday|each day|nightly|every night|every evening|every morning)/i.test(lowerScenario)
        || /\b(?:every|each)\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/i.test(lowerScenario);

    let trigger = { type: 'manual' };

    if (!hasRecurringCadence && (
        extractRelativeDelayMs(lowerScenario) != null
        || new RegExp(`\\b(?:tomorrow|later today|later|once|one[- ]time|${TODAY_SCHEDULE_FRAGMENT})\\b`, 'i').test(lowerScenario)
    )) {
        trigger = {
            type: 'once',
            runAt: buildOneTimeRunAt(lowerScenario, timeInfo, now, resolvedTimezone).toISOString(),
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
        } else {
            trigger = inferDefaultRecurringTrigger(normalizedScenario, resolvedTimezone) || trigger;
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
    extractRelativeDelayMs,
    extractScenarioTime,
    extractTaskPromptFromScenario,
    hasSchedulingCue,
    hasWorkloadIntent,
    inferDefaultRecurringTrigger,
    inferWorkloadPolicy,
    parseWorkloadScenario,
    slugifyWorkloadValue,
    summarizeTrigger,
    translateCronExpression,
};
