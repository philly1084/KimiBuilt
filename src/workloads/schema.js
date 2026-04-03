'use strict';

const { normalizeTimezone, parseCronExpression } = require('./cron-utils');
const {
    DEFAULT_EXECUTION_PROFILE,
    PROFILE_TOOL_ALLOWLISTS,
} = require('../tool-execution-profiles');

const VALID_TRIGGER_TYPES = new Set(['manual', 'once', 'cron']);
const VALID_STAGE_CONDITIONS = new Set(['always', 'on_success', 'on_failure']);
const BLOCKED_AUTONOMOUS_TOOL_IDS = new Set([
    'remote-command',
    'k3s-deploy',
    'docker-exec',
]);
const VALID_EXECUTION_TOOLS = new Set(['remote-command', 'ssh-execute']);

function sanitizeText(value = '') {
    return String(value || '').trim();
}

function validateWorkloadPayload(payload = {}, options = {}) {
    const errors = [];
    const ownerId = sanitizeText(options.ownerId);
    const sessionId = sanitizeText(payload.sessionId || options.sessionId);
    const title = sanitizeText(payload.title);
    const mode = sanitizeText(payload.mode || 'chat') || 'chat';
    const prompt = sanitizeText(payload.prompt || payload.objective || payload.promptTemplate);
    const callableSlug = sanitizeSlug(payload.callableSlug || payload.callable_slug || '');

    if (!ownerId) {
        errors.push('ownerId is required');
    }
    if (!sessionId) {
        errors.push('sessionId is required');
    }
    if (!title) {
        errors.push('title is required');
    }
    if (!prompt) {
        errors.push('prompt is required');
    }

    let trigger;
    try {
        trigger = normalizeTrigger(payload.trigger || { type: 'manual' });
    } catch (error) {
        errors.push(error.message);
    }

    let policy;
    try {
        policy = normalizePolicy(payload.policy || {});
    } catch (error) {
        errors.push(error.message);
    }

    let stages;
    try {
        stages = normalizeStages(payload.stages || []);
    } catch (error) {
        errors.push(error.message);
    }

    let execution;
    try {
        execution = normalizeExecution(payload.execution || payload.action || null);
    } catch (error) {
        errors.push(error.message);
    }

    if (errors.length > 0) {
        const error = new Error(errors.join('; '));
        error.type = 'validation';
        error.fields = errors;
        throw error;
    }

    return {
        ownerId,
        sessionId,
        title,
        mode,
        prompt,
        enabled: payload.enabled !== false,
        callableSlug: callableSlug || null,
        trigger,
        execution,
        policy,
        stages,
        metadata: normalizeMetadata(payload.metadata || {}),
    };
}

function normalizeTrigger(trigger = {}) {
    const type = sanitizeText(trigger.type || 'manual').toLowerCase();
    if (!VALID_TRIGGER_TYPES.has(type)) {
        throw new Error(`trigger.type must be one of: ${Array.from(VALID_TRIGGER_TYPES).join(', ')}`);
    }

    if (type === 'manual') {
        return { type: 'manual' };
    }

    if (type === 'once') {
        const runAt = new Date(trigger.runAt || trigger.run_at || '');
        if (Number.isNaN(runAt.getTime())) {
            throw new Error('trigger.runAt must be a valid ISO timestamp');
        }

        return {
            type: 'once',
            runAt: runAt.toISOString(),
        };
    }

    const expression = sanitizeText(trigger.expression || '');
    if (!expression) {
        throw new Error('trigger.expression is required for cron workloads');
    }
    parseCronExpression(expression);

    return {
        type: 'cron',
        expression,
        timezone: normalizeTimezone(trigger.timezone || 'UTC'),
    };
}

function normalizePolicy(policy = {}) {
    const executionProfile = sanitizeText(policy.executionProfile || DEFAULT_EXECUTION_PROFILE) || DEFAULT_EXECUTION_PROFILE;
    const allowedForProfile = new Set(PROFILE_TOOL_ALLOWLISTS[executionProfile] || PROFILE_TOOL_ALLOWLISTS[DEFAULT_EXECUTION_PROFILE] || []);
    const toolIds = Array.isArray(policy.toolIds)
        ? Array.from(new Set(policy.toolIds.map((toolId) => sanitizeText(toolId)).filter(Boolean)))
        : [];

    for (const toolId of toolIds) {
        if (!allowedForProfile.has(toolId)) {
            throw new Error(`tool '${toolId}' is not allowed for execution profile '${executionProfile}'`);
        }
        if (BLOCKED_AUTONOMOUS_TOOL_IDS.has(toolId) && policy.allowSideEffects !== true) {
            throw new Error(`tool '${toolId}' requires allowSideEffects=true`);
        }
    }

    return {
        executionProfile,
        toolIds,
        maxRounds: normalizePositiveInteger(policy.maxRounds, 3, 'policy.maxRounds'),
        maxToolCalls: normalizePositiveInteger(policy.maxToolCalls, 10, 'policy.maxToolCalls'),
        maxDurationMs: normalizePositiveInteger(policy.maxDurationMs, 120000, 'policy.maxDurationMs'),
        allowSideEffects: policy.allowSideEffects === true,
    };
}

function normalizeExecution(execution = null) {
    if (!execution || typeof execution !== 'object' || Array.isArray(execution)) {
        return null;
    }

    const tool = sanitizeText(execution.tool || execution.name || '').toLowerCase();
    if (!tool) {
        return null;
    }

    const normalizedTool = tool === 'ssh-execute' ? 'remote-command' : tool;
    if (!VALID_EXECUTION_TOOLS.has(tool) && !VALID_EXECUTION_TOOLS.has(normalizedTool)) {
        throw new Error(`execution.tool must be one of: ${Array.from(VALID_EXECUTION_TOOLS).join(', ')}`);
    }

    const rawParams = execution.params && typeof execution.params === 'object' && !Array.isArray(execution.params)
        ? execution.params
        : {};
    const command = sanitizeText(rawParams.command || execution.command || '');
    if (!command) {
        throw new Error('execution.params.command is required for structured workload execution');
    }

    const params = {
        command,
    };
    const host = sanitizeText(rawParams.host || execution.host || '');
    const username = sanitizeText(rawParams.username || execution.username || '');
    const port = Number(rawParams.port || execution.port || 0);

    if (host) {
        params.host = host;
    }
    if (username) {
        params.username = username;
    }
    if (Number.isFinite(port) && port > 0) {
        params.port = port;
    }

    return {
        tool: normalizedTool,
        params,
    };
}

function normalizeStages(stages = []) {
    if (!Array.isArray(stages)) {
        throw new Error('stages must be an array');
    }

    return stages.map((stage, index) => {
        const when = sanitizeText(stage.when || '').toLowerCase() || 'always';
        if (!VALID_STAGE_CONDITIONS.has(when)) {
            throw new Error(`stages[${index}].when must be one of: ${Array.from(VALID_STAGE_CONDITIONS).join(', ')}`);
        }

        let execution = null;
        try {
            execution = normalizeExecution(stage.execution || stage.action || null);
        } catch (error) {
            throw new Error(`stages[${index}].${error.message}`);
        }

        return {
            when,
            delayMs: normalizeNonNegativeInteger(stage.delayMs, 0, `stages[${index}].delayMs`),
            prompt: sanitizeText(stage.prompt || ''),
            execution,
            metadata: normalizeMetadata(stage.metadata || {}),
        };
    });
}

function normalizeMetadata(metadata = {}) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return {};
    }

    return metadata;
}

function sanitizeSlug(value = '') {
    const normalized = sanitizeText(value).toLowerCase();
    if (!normalized) {
        return '';
    }

    if (!/^[a-z0-9][a-z0-9-_]{1,63}$/.test(normalized)) {
        throw new Error('callableSlug must contain only lowercase letters, numbers, hyphens, or underscores');
    }

    return normalized;
}

function normalizePositiveInteger(value, fallback, label) {
    if (value == null || value === '') {
        return fallback;
    }

    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized <= 0) {
        throw new Error(`${label} must be a positive integer`);
    }
    return normalized;
}

function normalizeNonNegativeInteger(value, fallback, label) {
    if (value == null || value === '') {
        return fallback;
    }

    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized < 0) {
        throw new Error(`${label} must be a non-negative integer`);
    }
    return normalized;
}

function deriveRunIdempotencyKey({
    workloadId,
    scheduledFor = '',
    stageIndex = 0,
    reason = 'manual',
}) {
    return [
        sanitizeText(workloadId),
        sanitizeText(reason || 'manual'),
        sanitizeText(scheduledFor || 'immediate'),
        `stage-${Number(stageIndex || 0)}`,
    ].join(':');
}

module.exports = {
    BLOCKED_AUTONOMOUS_TOOL_IDS,
    VALID_STAGE_CONDITIONS,
    VALID_TRIGGER_TYPES,
    deriveRunIdempotencyKey,
    normalizePolicy,
    normalizeStages,
    normalizeTrigger,
    sanitizeSlug,
    validateWorkloadPayload,
};
