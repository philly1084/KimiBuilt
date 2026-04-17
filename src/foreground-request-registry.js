'use strict';

const requestsBySessionId = new Map();
const requestsByRequestId = new Map();

function normalizeString(value = '') {
    return String(value || '').trim();
}

function clearIndexes(entry = null) {
    if (!entry) {
        return;
    }

    if (entry.sessionId) {
        const currentBySession = requestsBySessionId.get(entry.sessionId);
        if (currentBySession === entry) {
            requestsBySessionId.delete(entry.sessionId);
        }
    }

    if (entry.requestId) {
        const currentByRequest = requestsByRequestId.get(entry.requestId);
        if (currentByRequest === entry) {
            requestsByRequestId.delete(entry.requestId);
        }
    }
}

function createAbortError(reason = 'Foreground request cancelled.') {
    const message = normalizeString(reason) || 'Foreground request cancelled.';
    const error = new Error(message);
    error.name = 'AbortError';
    error.code = 'foreground_request_aborted';
    return error;
}

function getForegroundRequest({ sessionId = null, requestId = null } = {}) {
    const normalizedRequestId = normalizeString(requestId);
    if (normalizedRequestId) {
        return requestsByRequestId.get(normalizedRequestId) || null;
    }

    const normalizedSessionId = normalizeString(sessionId);
    if (!normalizedSessionId) {
        return null;
    }

    return requestsBySessionId.get(normalizedSessionId) || null;
}

function registerForegroundRequest({
    sessionId,
    requestId,
    ownerId = null,
    clientSurface = '',
    taskType = 'chat',
    assistantMessageId = '',
    userMessageId = '',
} = {}) {
    const normalizedSessionId = normalizeString(sessionId);
    const normalizedRequestId = normalizeString(requestId);
    if (!normalizedSessionId || !normalizedRequestId) {
        return null;
    }

    const existing = requestsBySessionId.get(normalizedSessionId);
    if (existing && existing.requestId !== normalizedRequestId) {
        clearIndexes(existing);
    }

    const controller = new AbortController();
    const entry = {
        sessionId: normalizedSessionId,
        requestId: normalizedRequestId,
        ownerId: normalizeString(ownerId) || null,
        clientSurface: normalizeString(clientSurface),
        taskType: normalizeString(taskType) || 'chat',
        assistantMessageId: normalizeString(assistantMessageId),
        userMessageId: normalizeString(userMessageId),
        startedAt: new Date().toISOString(),
        controller,
        signal: controller.signal,
        cancelReason: null,
        cancelledAt: null,
        abort(reason = 'Foreground request cancelled.') {
            const normalizedReason = normalizeString(reason) || 'Foreground request cancelled.';
            if (!controller.signal.aborted) {
                entry.cancelReason = normalizedReason;
                entry.cancelledAt = new Date().toISOString();
                controller.abort(createAbortError(normalizedReason));
                return true;
            }

            if (!entry.cancelReason) {
                entry.cancelReason = normalizedReason;
            }
            if (!entry.cancelledAt) {
                entry.cancelledAt = new Date().toISOString();
            }

            return false;
        },
        dispose() {
            clearIndexes(entry);
        },
    };

    requestsBySessionId.set(normalizedSessionId, entry);
    requestsByRequestId.set(normalizedRequestId, entry);
    return entry;
}

function abortForegroundRequest({
    sessionId = null,
    requestId = null,
    ownerId = null,
    reason = 'Foreground request cancelled.',
} = {}) {
    const entry = getForegroundRequest({ sessionId, requestId });
    if (!entry) {
        return {
            cancelled: false,
            active: false,
            reason: 'not_found',
            sessionId: normalizeString(sessionId) || null,
            requestId: normalizeString(requestId) || null,
        };
    }

    const normalizedOwnerId = normalizeString(ownerId) || null;
    if (normalizedOwnerId && entry.ownerId && entry.ownerId !== normalizedOwnerId) {
        return {
            cancelled: false,
            active: true,
            reason: 'owner_mismatch',
            sessionId: entry.sessionId,
            requestId: entry.requestId,
        };
    }

    const abortedNow = entry.abort(reason);
    return {
        cancelled: true,
        active: abortedNow,
        alreadyAborted: !abortedNow,
        reason: entry.cancelReason || normalizeString(reason) || 'Foreground request cancelled.',
        sessionId: entry.sessionId,
        requestId: entry.requestId,
    };
}

function clearForegroundRequest({ sessionId = null, requestId = null } = {}) {
    const entry = getForegroundRequest({ sessionId, requestId });
    if (!entry) {
        return false;
    }

    clearIndexes(entry);
    return true;
}

module.exports = {
    abortForegroundRequest,
    clearForegroundRequest,
    getForegroundRequest,
    registerForegroundRequest,
};
