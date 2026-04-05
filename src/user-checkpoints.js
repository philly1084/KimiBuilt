const { getSessionControlState } = require('./runtime-control-state');

const DEFAULT_MAX_USER_CHECKPOINTS = 2;
const USER_CHECKPOINT_TOOL_ID = 'user-checkpoint';
const USER_CHECKPOINT_SURFACE = 'web-chat';
const USER_CHECKPOINT_FENCE_LANGUAGE = 'survey';
const USER_CHECKPOINT_RESPONSE_PREFIX = 'Survey response';
const DEFAULT_USER_CHECKPOINT_FREE_TEXT_LABEL = 'Add your own input (optional)';

function trimText(value = '') {
    return String(value || '').trim();
}

function normalizeSurface(value = '') {
    return trimText(value).toLowerCase();
}

function slugifyOptionId(value = '', fallback = 'option') {
    const normalized = trimText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || fallback;
}

function clampInteger(value, minimum, maximum, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}

function resolveAllowFreeText(value = {}) {
    if (!value || typeof value !== 'object') {
        return true;
    }

    if (value.allowFreeText === false || value.allowText === false) {
        return false;
    }

    if (value.allowFreeText === true || value.allowText === true) {
        return true;
    }

    return true;
}

function isUserCheckpointSurface(clientSurface = '') {
    return normalizeSurface(clientSurface) === USER_CHECKPOINT_SURFACE;
}

function normalizeCheckpointOption(option = {}, index = 0) {
    if (!option || typeof option !== 'object') {
        return null;
    }

    const label = trimText(option.label || option.title || option.text || `Option ${index + 1}`);
    if (!label) {
        return null;
    }

    const description = trimText(option.description || option.details || option.hint || '');
    const id = slugifyOptionId(option.id || label, `option-${index + 1}`);

    return {
        id,
        label,
        ...(description ? { description } : {}),
    };
}

function normalizeCheckpointOptions(options = []) {
    const normalized = (Array.isArray(options) ? options : [])
        .map((option, index) => normalizeCheckpointOption(option, index))
        .filter(Boolean);

    const seen = new Set();
    return normalized
        .filter((option) => {
            if (seen.has(option.id)) {
                return false;
            }
            seen.add(option.id);
            return true;
        })
        .slice(0, 5);
}

function normalizePendingCheckpoint(value = null) {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const question = trimText(value.question || value.prompt || '');
    const options = normalizeCheckpointOptions(value.options || value.choices || []);
    if (!question || options.length < 2) {
        return null;
    }

    const allowMultiple = value.allowMultiple === true;
    const maxSelections = allowMultiple
        ? clampInteger(value.maxSelections, 1, options.length, Math.min(2, options.length))
        : 1;
    const title = trimText(value.title || 'Choose a direction');
    const whyThisMatters = trimText(value.whyThisMatters || value.context || value.rationale || '');
    const preamble = trimText(value.preamble || value.message || '');
    const allowFreeText = resolveAllowFreeText(value);
    const freeTextLabel = allowFreeText
        ? trimText(value.freeTextLabel || value.freeTextPrompt || DEFAULT_USER_CHECKPOINT_FREE_TEXT_LABEL)
        : '';

    return {
        id: trimText(value.id || `checkpoint-${Date.now().toString(36)}`),
        title,
        question,
        ...(whyThisMatters ? { whyThisMatters } : {}),
        ...(preamble ? { preamble } : {}),
        allowMultiple,
        maxSelections,
        allowFreeText,
        ...(allowFreeText ? { freeTextLabel } : {}),
        options,
    };
}

function getUserCheckpointState(session = null) {
    const controlState = getSessionControlState(session);
    const rawState = controlState?.userCheckpoint && typeof controlState.userCheckpoint === 'object'
        ? controlState.userCheckpoint
        : {};

    const maxQuestions = clampInteger(
        rawState.maxQuestions,
        1,
        4,
        DEFAULT_MAX_USER_CHECKPOINTS,
    );
    const askedCount = clampInteger(rawState.askedCount, 0, maxQuestions, 0);

    return {
        maxQuestions,
        askedCount,
        pending: normalizePendingCheckpoint(rawState.pending),
        lastResponse: rawState.lastResponse && typeof rawState.lastResponse === 'object'
            ? {
                checkpointId: trimText(rawState.lastResponse.checkpointId || ''),
                summary: trimText(rawState.lastResponse.summary || ''),
                answeredAt: trimText(rawState.lastResponse.answeredAt || ''),
            }
            : null,
    };
}

function buildUserCheckpointPolicy({ session = null, clientSurface = '' } = {}) {
    const state = getUserCheckpointState(session);
    const enabled = isUserCheckpointSurface(clientSurface);

    return {
        enabled,
        maxQuestions: state.maxQuestions,
        askedCount: state.askedCount,
        remaining: enabled
            ? Math.max(0, state.maxQuestions - state.askedCount)
            : 0,
        pending: enabled ? state.pending : null,
        lastResponse: state.lastResponse,
    };
}

function normalizeCheckpointRequest(params = {}) {
    const question = trimText(
        params.question
        || params.prompt
        || params.request
        || params.ask
        || '',
    );
    if (!question) {
        throw new Error('user-checkpoint requires a non-empty `question`.');
    }

    const options = normalizeCheckpointOptions(params.options || params.choices || []);
    if (options.length < 2) {
        throw new Error('user-checkpoint requires 2 to 5 answer options.');
    }

    const allowMultiple = params.allowMultiple === true;
    const maxSelections = allowMultiple
        ? clampInteger(params.maxSelections, 1, options.length, Math.min(2, options.length))
        : 1;
    const allowFreeText = resolveAllowFreeText(params);

    return {
        id: trimText(params.id || `checkpoint-${Date.now().toString(36)}`),
        title: trimText(params.title || 'Choose a direction'),
        question,
        ...(trimText(params.whyThisMatters || params.context || params.rationale || '')
            ? { whyThisMatters: trimText(params.whyThisMatters || params.context || params.rationale || '') }
            : {}),
        ...(trimText(params.preamble || params.message || 'I need one decision before I continue with the main work.')
            ? { preamble: trimText(params.preamble || params.message || 'I need one decision before I continue with the main work.') }
            : {}),
        allowMultiple,
        maxSelections,
        allowFreeText,
        ...(allowFreeText
            ? { freeTextLabel: trimText(params.freeTextLabel || params.freeTextPrompt || DEFAULT_USER_CHECKPOINT_FREE_TEXT_LABEL) || DEFAULT_USER_CHECKPOINT_FREE_TEXT_LABEL }
            : {}),
        options,
    };
}

function buildUserCheckpointFence(checkpoint) {
    return `\`\`\`${USER_CHECKPOINT_FENCE_LANGUAGE}\n${JSON.stringify(checkpoint, null, 2)}\n\`\`\``;
}

function buildUserCheckpointMessage(checkpoint = null) {
    const normalized = normalizePendingCheckpoint(checkpoint);
    if (!normalized) {
        return 'I need one decision before I continue.';
    }

    return [
        normalized.preamble || 'I need one decision before I continue with the main work.',
        normalized.whyThisMatters || '',
        buildUserCheckpointFence(normalized),
        'Choose an option below and I will continue from there.',
    ].filter(Boolean).join('\n\n');
}

function extractPendingUserCheckpoint(toolEvents = []) {
    const events = Array.isArray(toolEvents) ? toolEvents : [];
    const checkpointEvent = [...events].reverse().find((event) => (
        (event?.toolCall?.function?.name || event?.result?.toolId || '') === USER_CHECKPOINT_TOOL_ID
        && event?.result?.success !== false
    ));

    if (!checkpointEvent) {
        return null;
    }

    return normalizePendingCheckpoint(
        checkpointEvent?.result?.data?.checkpoint
        || checkpointEvent?.result?.data
        || null,
    );
}

function buildUserCheckpointAskedPatch(session = null, checkpoint = null) {
    const state = getUserCheckpointState(session);
    const normalized = normalizePendingCheckpoint(checkpoint);
    if (!normalized) {
        return {};
    }

    return {
        userCheckpoint: {
            maxQuestions: state.maxQuestions,
            askedCount: Math.min(state.maxQuestions, state.askedCount + 1),
            pending: normalized,
            lastAskedAt: new Date().toISOString(),
        },
    };
}

function parseUserCheckpointResponseMessage(text = '') {
    const normalized = trimText(text);
    if (!normalized) {
        return null;
    }

    const match = normalized.match(/^Survey response \(([^)]+)\):\s*([\s\S]+)$/i);
    if (!match) {
        return null;
    }

    return {
        checkpointId: trimText(match[1]),
        summary: trimText(match[2]),
    };
}

function buildUserCheckpointAnsweredPatch(session = null, response = null) {
    const state = getUserCheckpointState(session);
    if (!response?.checkpointId) {
        return {};
    }

    return {
        userCheckpoint: {
            maxQuestions: state.maxQuestions,
            askedCount: state.askedCount,
            pending: null,
            lastResponse: {
                checkpointId: trimText(response.checkpointId),
                summary: trimText(response.summary || ''),
                answeredAt: new Date().toISOString(),
            },
        },
    };
}

function buildUserCheckpointResponseMessage({ checkpointId = '', selectedOptions = [], notes = '' } = {}) {
    const normalizedCheckpointId = trimText(checkpointId);
    const chosen = (Array.isArray(selectedOptions) ? selectedOptions : [])
        .map((option) => {
            const label = trimText(option?.label || option?.title || option?.id || '');
            const id = trimText(option?.id || '');

            if (!label) {
                return '';
            }

            return id && id !== label
                ? `"${label}" [${id}]`
                : `"${label}"`;
        })
        .filter(Boolean)
        .join(', ');
    const noteText = trimText(notes);
    const summaryParts = [
        chosen ? `chose ${chosen}` : 'answered the checkpoint',
        noteText ? `Notes: ${noteText}` : '',
    ].filter(Boolean);

    return `${USER_CHECKPOINT_RESPONSE_PREFIX} (${normalizedCheckpointId}): ${summaryParts.join('. ')}`;
}

function buildUserCheckpointInstructions(policy = {}) {
    if (policy?.enabled !== true) {
        return '';
    }

    const lines = [
        '[User checkpoint policy]',
        'Before major implementation, refactoring, or long multi-step work, you may pause to ask the user for one high-impact decision.',
        `Maximum checkpoint questions in this session: ${policy.maxQuestions || DEFAULT_MAX_USER_CHECKPOINTS}.`,
        `Remaining checkpoint questions in this session: ${Math.max(0, Number(policy.remaining) || 0)}.`,
        policy.pending
            ? `A checkpoint is already pending (${policy.pending.id}). Do not ask another one until the user answers it.`
            : 'If you truly need that decision, call the `user-checkpoint` tool instead of asking in free-form prose.',
        'On the web-chat surface, do not ask a blocking multiple-choice question as plain assistant text when `user-checkpoint` is available; use the tool so the UI can render inline options.',
        'Use a checkpoint only when the answer would materially change the plan, architecture, implementation scope, or final output.',
        'Do not use a checkpoint for small clarifications or details you can infer reasonably.',
        'Keep the checkpoint concise: one question, 2 to 4 strong options, short descriptions, and keep the free-text field available so the user can add their own input when needed.',
        'If there are no checkpoint questions remaining, proceed with the best reasonable assumption and state that assumption briefly.',
        'When the user sends a message starting with `Survey response (` treat it as the answer to the checkpoint and continue the work.',
    ];

    return lines.join('\n');
}

module.exports = {
    DEFAULT_MAX_USER_CHECKPOINTS,
    USER_CHECKPOINT_FENCE_LANGUAGE,
    USER_CHECKPOINT_RESPONSE_PREFIX,
    USER_CHECKPOINT_SURFACE,
    USER_CHECKPOINT_TOOL_ID,
    DEFAULT_USER_CHECKPOINT_FREE_TEXT_LABEL,
    buildUserCheckpointAnsweredPatch,
    buildUserCheckpointAskedPatch,
    buildUserCheckpointInstructions,
    buildUserCheckpointMessage,
    buildUserCheckpointPolicy,
    buildUserCheckpointResponseMessage,
    extractPendingUserCheckpoint,
    getUserCheckpointState,
    isUserCheckpointSurface,
    normalizeCheckpointRequest,
    normalizePendingCheckpoint,
    parseUserCheckpointResponseMessage,
};
