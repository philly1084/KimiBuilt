'use strict';

const { extractStructuredExecution } = require('./execution-extractor');
const {
    deriveWorkloadTitle,
    inferWorkloadPolicy,
    parseWorkloadScenario,
} = require('./natural-language');

function sanitizeText(value = '') {
    return String(value || '').trim();
}

function normalizeMessageText(value) {
    if (typeof value === 'string') {
        return value.trim();
    }

    if (Array.isArray(value)) {
        return value
            .map((entry) => {
                if (typeof entry === 'string') {
                    return entry.trim();
                }

                if (entry && typeof entry === 'object') {
                    return sanitizeText(entry.text || entry.content || '');
                }

                return '';
            })
            .filter(Boolean)
            .join(' ')
            .trim();
    }

    if (value && typeof value === 'object') {
        return sanitizeText(value.text || value.content || '');
    }

    return '';
}

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function hasRemoteExecutionShape(params = {}) {
    const combinedText = [
        params.action,
        params.tool,
        params.command,
        params.title,
        params.prompt,
        params.request,
        params.scenario,
        params.description,
        params.schedule,
        params.metadata?.scenarioRequest,
    ]
        .map((value) => sanitizeText(value))
        .filter(Boolean)
        .join('\n');
    const toolId = sanitizeText(params.tool || params.execution?.tool || params.execution?.name || params.action).toLowerCase();

    return Boolean(
        sanitizeText(params.host || params.execution?.host || params.execution?.params?.host)
        || sanitizeText(params.username || params.execution?.username || params.execution?.params?.username)
        || Number(params.port || params.execution?.port || params.execution?.params?.port) > 0
        || toolId === 'remote-command'
        || toolId === 'ssh-execute'
        || /\b(remote|server|ssh|host|machine)\b/i.test(combinedText),
    );
}

function buildLooseScenarioSource(params = {}) {
    const prompt = sanitizeText(params.prompt);
    const title = sanitizeText(params.title);
    const command = sanitizeText(
        params.command
        || params.execution?.command
        || params.execution?.params?.command,
    );
    const schedule = sanitizeText(
        params.schedule
        || params.when
        || params.recurrence
        || params.repeat
        || params.timing,
    );
    const baseTask = prompt
        || (command
            ? `Run \`${command}\`${hasRemoteExecutionShape(params) ? ' on the server' : ''}`
            : title);

    if (baseTask && schedule) {
        return `${baseTask} ${schedule}`.trim();
    }

    if (prompt) {
        return title && title.toLowerCase() !== prompt.toLowerCase()
            ? `${title}. ${prompt}`.trim()
            : prompt;
    }

    if (command) {
        return `Run \`${command}\`${hasRemoteExecutionShape(params) ? ' on the server' : ''}`.trim();
    }

    return title;
}

function extractWorkloadScenarioSource(params = {}) {
    const direct = [
        params.request,
        params.scenario,
        params.description,
        params.metadata?.scenarioRequest,
        params.metadata?.originalRequest,
    ]
        .map((value) => sanitizeText(value))
        .find(Boolean);

    if (direct) {
        return direct;
    }

    return buildLooseScenarioSource(params);
}

function collectRecentUserMessages(recentMessages = [], limit = 6) {
    if (!Array.isArray(recentMessages) || recentMessages.length === 0) {
        return [];
    }

    return recentMessages
        .filter((message) => message?.role === 'user')
        .map((message) => normalizeMessageText(message?.content))
        .filter(Boolean)
        .slice(-Math.max(0, limit));
}

function buildScenarioSourceCandidates(baseSource = '', recentMessages = []) {
    const directSource = sanitizeText(baseSource);
    const candidates = [];
    const seen = new Set();
    const addCandidate = (value) => {
        const normalized = sanitizeText(value);
        if (!normalized) {
            return;
        }
        const key = normalized.toLowerCase();
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        candidates.push(normalized);
    };

    addCandidate(directSource);

    const recentUserMessages = collectRecentUserMessages(recentMessages);
    if (recentUserMessages.length === 0) {
        return candidates;
    }

    const stripReferentialScheduleWrapper = (value = '') => sanitizeText(value)
        .replace(/^(?:can|could|would)\s+you\s+/i, '')
        .replace(/^(?:please\s+)?(?:run|do|schedule|set up|make|create)\s+(?:it|that|this|them|those)\s+/i, '')
        .replace(/^(?:please\s+)?(?:run|do)\s+the commands(?:\s+you\s+listed(?:\s+there)?)?\s+/i, '')
        .trim();
    let merged = directSource;
    for (let index = recentUserMessages.length - 1; index >= 0; index -= 1) {
        const prior = recentUserMessages[index];
        if (!prior || prior.toLowerCase() === directSource.toLowerCase()) {
            continue;
        }

        merged = merged ? `${prior}. ${merged}` : prior;
        addCandidate(merged);
        if (directSource) {
            const directFragment = stripReferentialScheduleWrapper(directSource);
            const priorFragment = stripReferentialScheduleWrapper(prior);
            if (directFragment && directFragment.toLowerCase() !== directSource.toLowerCase()) {
                addCandidate(`${prior} ${directFragment}`);
            }
            if (priorFragment && priorFragment.toLowerCase() !== prior.toLowerCase()) {
                addCandidate(`${priorFragment} ${directSource}`);
                addCandidate(`${directSource} ${priorFragment}`);
            }
        }
    }

    return candidates;
}

function isReferentialWorkloadPrompt(prompt = '') {
    const normalized = sanitizeText(prompt).toLowerCase();
    if (!normalized) {
        return true;
    }

    return [
        /^(?:it|that|this|them|those)\b/,
        /^(?:run|do|schedule|set up|make|create)\s+(?:it|that|this|them|those)\b/,
        /\b(?:the commands|what you listed|what i asked|same thing|same task)\b/,
        /^(?:do|run)\s+the commands\b/,
    ].some((pattern) => pattern.test(normalized));
}

function scoreCanonicalCandidate(candidate = {}) {
    const payload = candidate?.payload || null;
    if (!payload?.prompt || !payload?.title || !payload?.trigger) {
        return Number.NEGATIVE_INFINITY;
    }

    let score = 0;
    if (payload.trigger.type === 'cron' || payload.trigger.type === 'once') {
        score += 100;
    }
    if (payload.execution) {
        score += 20;
    }
    if (!isReferentialWorkloadPrompt(payload.prompt)) {
        score += 15;
    }
    score += Math.min(payload.prompt.length, 120) / 10;

    return score;
}

function buildFallbackExecution(params = {}, session = null, scenarioSource = '') {
    const source = sanitizeText(scenarioSource);
    const extracted = source
        ? extractStructuredExecution({
            request: source,
            session,
        })
        : null;
    if (extracted) {
        return extracted;
    }

    const command = sanitizeText(
        params.command
        || params.execution?.command
        || params.execution?.params?.command,
    );
    if (!command || !hasRemoteExecutionShape(params)) {
        return null;
    }

    const sessionTarget = session?.metadata?.lastSshTarget
        || session?.metadata?.remoteWorkingState?.target
        || null;
    const host = sanitizeText(params.host || params.execution?.host || params.execution?.params?.host || sessionTarget?.host);
    const username = sanitizeText(params.username || params.execution?.username || params.execution?.params?.username || sessionTarget?.username);
    const port = Number(params.port || params.execution?.port || params.execution?.params?.port || sessionTarget?.port || 0);

    return {
        tool: 'remote-command',
        params: {
            ...(host ? { host } : {}),
            ...(username ? { username } : {}),
            ...(Number.isFinite(port) && port > 0 ? { port } : {}),
            command,
        },
    };
}

function buildCanonicalWorkloadPayloadForSource(params = {}, options = {}, scenarioSource = '') {
    const session = options.session || null;
    const timezone = sanitizeText(options.timezone || params.timezone);
    const now = options.now || params.now || null;
    const metadata = isRecord(params.metadata) ? { ...params.metadata } : {};
    const explicitPrompt = sanitizeText(params.prompt);
    const explicitTitle = sanitizeText(params.title);
    const explicitTrigger = isRecord(params.trigger) ? params.trigger : null;
    const explicitPolicy = isRecord(params.policy) ? params.policy : null;
    const explicitExecution = isRecord(params.execution) ? params.execution : null;
    const explicitStages = Array.isArray(params.stages) ? params.stages : undefined;

    let scenario = null;
    if (scenarioSource && (
        !explicitPrompt
        || !explicitTitle
        || !explicitTrigger
        || !explicitPolicy
        || (!explicitExecution && hasRemoteExecutionShape(params))
    )) {
        scenario = parseWorkloadScenario(scenarioSource, {
            ...(timezone ? { timezone } : {}),
            ...(now ? { now } : {}),
        });
    }

    const prompt = explicitPrompt || scenario?.prompt || '';
    const title = explicitTitle || scenario?.title || (prompt ? deriveWorkloadTitle(prompt) : '');
    const trigger = explicitTrigger || scenario?.trigger || null;
    const execution = explicitExecution || buildFallbackExecution(params, session, scenarioSource || prompt);
    const policy = explicitPolicy || scenario?.policy || (prompt ? inferWorkloadPolicy(prompt) : undefined);
    const scenarioRequest = sanitizeText(metadata.scenarioRequest || scenarioSource);

    if (!prompt || !title || !trigger) {
        return null;
    }

    return {
        payload: {
            title,
            prompt,
            ...(hasOwn(params, 'callableSlug') ? { callableSlug: params.callableSlug } : {}),
            ...(hasOwn(params, 'mode') ? { mode: params.mode } : {}),
            ...(hasOwn(params, 'enabled') ? { enabled: params.enabled } : {}),
            trigger,
            ...(execution ? { execution } : {}),
            ...(policy ? { policy } : {}),
            ...(explicitStages ? { stages: explicitStages } : {}),
            metadata: {
                ...metadata,
                ...(scenarioRequest
                    ? {
                        createdFromScenario: true,
                        scenarioRequest,
                    }
                    : {}),
            },
        },
        scenario,
        scenarioSource,
    };
}

function buildCanonicalWorkloadPayload(params = {}, options = {}) {
    const scenarioSource = extractWorkloadScenarioSource(params);
    const explicitPrompt = sanitizeText(params.prompt);
    const explicitTitle = sanitizeText(params.title);
    const explicitTrigger = isRecord(params.trigger) ? params.trigger : null;
    const explicitPolicy = isRecord(params.policy) ? params.policy : null;
    const explicitExecution = isRecord(params.execution) ? params.execution : null;
    const shouldInferFromScenario = Boolean(
        scenarioSource
        && (
            !explicitPrompt
            || !explicitTitle
            || !explicitTrigger
            || !explicitPolicy
            || (!explicitExecution && hasRemoteExecutionShape(params))
        ),
    );

    const candidateSources = shouldInferFromScenario
        ? buildScenarioSourceCandidates(scenarioSource, options.recentMessages)
        : [scenarioSource];

    let bestCandidate = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    candidateSources.forEach((candidateSource) => {
        const candidate = buildCanonicalWorkloadPayloadForSource(params, options, candidateSource);
        const score = scoreCanonicalCandidate(candidate);
        if (score > bestScore) {
            bestCandidate = candidate;
            bestScore = score;
        }
    });

    return bestCandidate;
}

function buildCanonicalWorkloadAction(params = {}, options = {}) {
    const canonical = buildCanonicalWorkloadPayload(params, options);
    if (!canonical) {
        return null;
    }

    return {
        action: 'create',
        ...canonical.payload,
    };
}

module.exports = {
    buildCanonicalWorkloadAction,
    buildCanonicalWorkloadPayload,
    extractWorkloadScenarioSource,
    hasRemoteExecutionShape,
};
