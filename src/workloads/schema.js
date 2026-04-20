'use strict';

const { normalizeTimezone, parseCronExpression } = require('./cron-utils');
const { normalizeProjectPlan } = require('./project-plans');
const {
    DEFAULT_EXECUTION_PROFILE,
    PROFILE_TOOL_ALLOWLISTS,
} = require('../tool-execution-profiles');

const VALID_TRIGGER_TYPES = new Set(['manual', 'once', 'cron']);
const VALID_STAGE_CONDITIONS = new Set(['always', 'on_success', 'on_failure']);
const BLOCKED_AUTONOMOUS_TOOL_IDS = new Set([
    'remote-command',
    'managed-app',
    'k3s-deploy',
    'docker-exec',
]);
const VALID_EXECUTION_TOOLS = new Set(['remote-command', 'ssh-execute', 'managed-app']);

function sanitizeText(value = '') {
    return String(value || '').trim();
}

function normalizeManagedAppAction(value = '') {
    const normalized = sanitizeText(value).toLowerCase();
    if (!normalized) {
        return '';
    }

    if (['diagnose', 'diagnostic', 'diagnostics'].includes(normalized)) {
        return 'doctor';
    }

    if (['repair', 'repair-runner', 'repair-runners'].includes(normalized)) {
        return 'reconcile';
    }

    return normalized;
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
        stages = normalizeStages(payload.stages || [], {
            executionProfile: policy?.executionProfile,
            allowSideEffects: policy?.allowSideEffects === true,
        });
    } catch (error) {
        errors.push(error.message);
    }

    let execution;
    try {
        execution = normalizeExecution(payload.execution || payload.action || null, {
            defaultPrompt: prompt,
        });
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
        metadata: normalizeMetadata(payload.metadata || {}, {
            mode,
            title,
            prompt,
        }),
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

function normalizeExecution(execution = null, options = {}) {
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

    if (normalizedTool === 'managed-app') {
        const action = normalizeManagedAppAction(rawParams.action || execution.action || '');
        const validManagedAppActions = new Set(['create', 'update', 'deploy', 'inspect', 'doctor', 'reconcile', 'list']);
        if (!validManagedAppActions.has(action)) {
            throw new Error(`execution.params.action must be one of: ${Array.from(validManagedAppActions).join(', ')}`);
        }

        const prompt = sanitizeText(rawParams.prompt || execution.prompt || options.defaultPrompt || '');
        if ((action === 'create' || action === 'update') && !prompt) {
            throw new Error('execution.params.prompt is required for managed-app create/update structured workload execution');
        }

        const appRef = sanitizeText(
            rawParams.appRef
            || rawParams.app
            || rawParams.id
            || rawParams.slug
            || execution.appRef
            || execution.app
            || execution.id
            || execution.slug
            || '',
        );
        if (['update', 'deploy', 'inspect'].includes(action) && !appRef) {
            throw new Error(`execution.params.appRef is required for managed-app ${action} structured workload execution`);
        }

        const deployTarget = sanitizeText(
            rawParams.deployTarget
            || rawParams.deploymentTarget
            || rawParams.target
            || execution.deployTarget
            || execution.deploymentTarget
            || execution.target
            || '',
        ).toLowerCase();
        if (deployTarget && !['ssh', 'remote', 'remote-ssh', 'remote_ssh'].includes(deployTarget)) {
            throw new Error('execution.params.deployTarget must resolve to "ssh" for managed-app');
        }

        const params = {
            action,
        };
        const model = sanitizeText(rawParams.model || execution.model || '');
        const requestedAction = sanitizeText(rawParams.requestedAction || execution.requestedAction || '');
        const sourcePrompt = sanitizeText(rawParams.sourcePrompt || execution.sourcePrompt || prompt || '');
        const limit = Number(rawParams.limit || execution.limit || 0);

        if (appRef) {
            params.appRef = appRef;
        }
        if (prompt) {
            params.prompt = prompt;
            params.sourcePrompt = sourcePrompt;
        }
        if (requestedAction) {
            params.requestedAction = requestedAction;
        }
        if (deployTarget) {
            params.deployTarget = 'ssh';
        }
        if (model) {
            params.model = model;
        }
        if (Number.isFinite(limit) && limit > 0) {
            params.limit = Math.trunc(limit);
        }

        return {
            tool: normalizedTool,
            params,
        };
    }

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

function normalizeWorkflowKey(value = '', label = 'key') {
    const normalized = sanitizeText(value);
    if (!normalized) {
        return '';
    }

    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(normalized)) {
        throw new Error(`${label} must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens`);
    }

    return normalized;
}

function normalizeStageInputFrom(inputFrom = [], label = 'inputFrom') {
    const values = Array.isArray(inputFrom) ? inputFrom : [inputFrom];
    return Array.from(new Set(values
        .map((value, index) => normalizeWorkflowKey(value, `${label}[${index}]`))
        .filter(Boolean)));
}

function normalizeStageToolIds(toolIds = [], options = {}, label = 'toolIds') {
    if (!Array.isArray(toolIds)) {
        throw new Error(`${label} must be an array`);
    }

    const executionProfile = sanitizeText(options.executionProfile || DEFAULT_EXECUTION_PROFILE) || DEFAULT_EXECUTION_PROFILE;
    const allowedForProfile = new Set(
        PROFILE_TOOL_ALLOWLISTS[executionProfile]
        || PROFILE_TOOL_ALLOWLISTS[DEFAULT_EXECUTION_PROFILE]
        || [],
    );
    const normalizedToolIds = Array.from(new Set(toolIds
        .map((toolId) => sanitizeText(toolId))
        .filter(Boolean)));

    for (const toolId of normalizedToolIds) {
        if (!allowedForProfile.has(toolId)) {
            throw new Error(`${label} tool '${toolId}' is not allowed for execution profile '${executionProfile}'`);
        }
        if (BLOCKED_AUTONOMOUS_TOOL_IDS.has(toolId) && options.allowSideEffects !== true) {
            throw new Error(`${label} tool '${toolId}' requires allowSideEffects=true`);
        }
    }

    return normalizedToolIds;
}

function normalizeStages(stages = [], options = {}) {
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
            execution = normalizeExecution(stage.execution || stage.action || null, {
                defaultPrompt: stage.prompt || '',
            });
        } catch (error) {
            throw new Error(`stages[${index}].${error.message}`);
        }

        let toolIds = [];
        try {
            toolIds = normalizeStageToolIds(stage.toolIds || stage.tool_ids || [], options, `stages[${index}].toolIds`);
        } catch (error) {
            throw new Error(error.message);
        }

        let inputFrom = [];
        try {
            inputFrom = normalizeStageInputFrom(stage.inputFrom || stage.input_from || stage.inputs || [], `stages[${index}].inputFrom`);
        } catch (error) {
            throw new Error(error.message);
        }

        let outputKey = '';
        try {
            outputKey = normalizeWorkflowKey(stage.outputKey || stage.output_key || '', `stages[${index}].outputKey`);
        } catch (error) {
            throw new Error(error.message);
        }

        return {
            when,
            delayMs: normalizeNonNegativeInteger(stage.delayMs, 0, `stages[${index}].delayMs`),
            prompt: sanitizeText(stage.prompt || ''),
            execution,
            toolIds,
            inputFrom,
            outputKey: outputKey || null,
            outputFormat: sanitizeText(stage.outputFormat || stage.output_format || '').toLowerCase() || null,
            metadata: normalizeMetadata(stage.metadata || {}),
        };
    });
}

function normalizeMetadata(metadata = {}, options = {}) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return {};
    }

    const normalized = {
        ...metadata,
    };

    if (metadata.project || options.mode === 'project') {
        normalized.projectMode = true;
        normalized.project = normalizeProjectPlan(metadata.project || {}, {
            title: options.title,
            prompt: options.prompt,
        });
    }

    return normalized;
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
    normalizeWorkflowKey,
    sanitizeSlug,
    validateWorkloadPayload,
};
