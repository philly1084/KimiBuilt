function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeControlState(base = {}, patch = {}) {
    const source = isPlainObject(base) ? base : {};
    const update = isPlainObject(patch) ? patch : {};
    const merged = {
        ...source,
    };

    for (const [key, value] of Object.entries(update)) {
        if (value === undefined) {
            continue;
        }

        if (isPlainObject(value) && isPlainObject(source[key])) {
            merged[key] = mergeControlState(source[key], value);
            continue;
        }

        merged[key] = value;
    }

    return merged;
}

function normalizeRemoteTarget(target = null) {
    if (!isPlainObject(target)) {
        return null;
    }

    const host = String(target.host || '').trim();
    if (!host) {
        return null;
    }

    const username = String(target.username || '').trim();
    const portNumber = Number(target.port);

    return {
        host,
        ...(username ? { username } : {}),
        ...(Number.isFinite(portNumber) && portNumber > 0 ? { port: portNumber } : {}),
    };
}

function normalizeRuntimeControlState(state = {}) {
    if (!isPlainObject(state)) {
        return {};
    }

    const normalized = {
        ...state,
    };

    if ('lastToolIntent' in normalized) {
        const lastToolIntent = String(normalized.lastToolIntent || '').trim();
        normalized.lastToolIntent = lastToolIntent || null;
    }

    if ('lastRemoteObjective' in normalized) {
        const lastRemoteObjective = String(normalized.lastRemoteObjective || '').trim();
        normalized.lastRemoteObjective = lastRemoteObjective || null;
    }

    if ('lastSshTarget' in normalized) {
        normalized.lastSshTarget = normalizeRemoteTarget(normalized.lastSshTarget);
    }

    if ('remoteWorkingState' in normalized && !isPlainObject(normalized.remoteWorkingState)) {
        normalized.remoteWorkingState = null;
    }

    if ('workflow' in normalized && !isPlainObject(normalized.workflow)) {
        normalized.workflow = null;
    }

    if ('projectPlan' in normalized && !isPlainObject(normalized.projectPlan)) {
        normalized.projectPlan = null;
    }

    if ('foregroundContinuationGate' in normalized && !isPlainObject(normalized.foregroundContinuationGate)) {
        normalized.foregroundContinuationGate = null;
    }

    if ('activeTaskFrame' in normalized && !isPlainObject(normalized.activeTaskFrame)) {
        normalized.activeTaskFrame = null;
    }

    if ('harness' in normalized && !isPlainObject(normalized.harness)) {
        normalized.harness = null;
    }

    if ('autonomyApproved' in normalized) {
        normalized.autonomyApproved = Boolean(normalized.autonomyApproved);
    }

    return normalized;
}

function getSessionControlState(session = null) {
    if (!session || typeof session !== 'object') {
        return {};
    }

    const legacyMetadataState = {
        ...(session?.metadata?.lastToolIntent ? { lastToolIntent: session.metadata.lastToolIntent } : {}),
        ...(session?.metadata?.lastSshTarget ? { lastSshTarget: session.metadata.lastSshTarget } : {}),
        ...(session?.metadata?.remoteWorkingState ? { remoteWorkingState: session.metadata.remoteWorkingState } : {}),
        ...(typeof session?.metadata?.remoteBuildAutonomyApproved === 'boolean'
            ? { autonomyApproved: session.metadata.remoteBuildAutonomyApproved }
            : {}),
    };

    return normalizeRuntimeControlState(mergeControlState(
        legacyMetadataState,
        mergeControlState(session?.metadata?.controlState, session?.controlState),
    ));
}

function buildLegacyControlMetadata(controlState = {}) {
    const normalized = normalizeRuntimeControlState(controlState);
    const legacyMetadata = {};

    if (normalized.lastToolIntent) {
        legacyMetadata.lastToolIntent = normalized.lastToolIntent;
    }

    if (normalized.lastSshTarget) {
        legacyMetadata.lastSshTarget = normalized.lastSshTarget;
    }

    if (normalized.remoteWorkingState) {
        legacyMetadata.remoteWorkingState = normalized.remoteWorkingState;
    }

    if (Object.keys(normalized).length > 0) {
        legacyMetadata.controlState = normalized;
    }

    return legacyMetadata;
}

module.exports = {
    buildLegacyControlMetadata,
    getSessionControlState,
    mergeControlState,
    normalizeRuntimeControlState,
};
