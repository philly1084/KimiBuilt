const {
    SURFACE_LOCAL_MEMORY_NAMESPACE,
    USER_GLOBAL_MEMORY_NAMESPACE,
} = require('./session-scope');

function normalizeFixture(fixture = {}) {
    return {
        id: String(fixture?.id || '').trim() || 'scenario',
        prompt: String(fixture?.prompt || fixture?.input || '').trim(),
        projectKey: String(fixture?.projectKey || '').trim() || null,
        surface: String(fixture?.surface || fixture?.clientSurface || '').trim() || null,
        expected: fixture?.expected && typeof fixture.expected === 'object' ? fixture.expected : {},
        session: fixture?.session && typeof fixture.session === 'object' ? fixture.session : null,
        toolResults: Array.isArray(fixture?.toolResults) ? fixture.toolResults : [],
        memoryFixtures: Array.isArray(fixture?.memoryFixtures) ? fixture.memoryFixtures : [],
    };
}

function inferSurfaceFinisher({ taskType = '', clientSurface = '', executionProfile = '' } = {}) {
    const surface = String(clientSurface || taskType || executionProfile || '').trim().toLowerCase();
    if (!surface) {
        return 'chat_reply';
    }
    if (surface.includes('notes')) {
        return 'notes_page';
    }
    if (surface.includes('canvas')) {
        return 'canvas_structured';
    }
    if (surface.includes('notation')) {
        return 'notation_helper';
    }
    return 'chat_reply';
}

function summarizeMemoryReadSet(memoryTrace = null, { projectKey = '', clientSurface = '' } = {}) {
    const selected = Array.isArray(memoryTrace?.selected) ? memoryTrace.selected : [];
    const byNamespace = {};
    const bySurface = {};
    let userGlobalCount = 0;
    const foreignProjectEntries = [];
    const foreignSurfaceEntries = [];

    selected.forEach((entry) => {
        const namespace = String(entry?.memoryNamespace || 'unknown').trim() || 'unknown';
        const surface = String(entry?.sourceSurface || '').trim() || 'unknown';
        byNamespace[namespace] = (byNamespace[namespace] || 0) + 1;
        bySurface[surface] = (bySurface[surface] || 0) + 1;

        if (namespace === USER_GLOBAL_MEMORY_NAMESPACE) {
            userGlobalCount += 1;
        }

        if (projectKey
            && entry?.projectKey
            && entry.projectKey !== projectKey
            && namespace !== USER_GLOBAL_MEMORY_NAMESPACE) {
            foreignProjectEntries.push({
                id: entry.id,
                projectKey: entry.projectKey,
                summary: entry.summary || entry.artifactId || '',
            });
        }

        if (clientSurface
            && entry?.sourceSurface
            && entry.sourceSurface !== clientSurface
            && namespace === SURFACE_LOCAL_MEMORY_NAMESPACE) {
            foreignSurfaceEntries.push({
                id: entry.id,
                sourceSurface: entry.sourceSurface,
                summary: entry.summary || entry.artifactId || '',
            });
        }
    });

    return {
        totalSelected: selected.length,
        byNamespace,
        bySurface,
        userGlobalCount,
        foreignProjectEntries,
        foreignSurfaceEntries,
    };
}

function buildInitiativeReview({ executionTrace = [], toolEvents = [] } = {}) {
    const roundReviews = (Array.isArray(executionTrace) ? executionTrace : [])
        .filter((entry) => /^Round review \d+$/i.test(String(entry?.name || '')));
    const decisions = roundReviews.map((entry) => String(entry?.details?.decision || '').trim()).filter(Boolean);
    const productiveRounds = roundReviews.filter((entry) => entry?.details?.productive !== false).length;
    const toolFailures = (Array.isArray(toolEvents) ? toolEvents : [])
        .filter((event) => event?.result?.success === false).length;
    const failureTags = [];

    if (roundReviews.some((entry) => entry?.details?.productive === false)) {
        failureTags.push('unproductive_round');
    }
    if (decisions.filter((decision) => decision === 'replan').length > 1) {
        failureTags.push('repeated_replan');
    }
    if (toolFailures > 0 && productiveRounds === 0) {
        failureTags.push('stalled_after_failure');
    }

    return {
        totalRounds: roundReviews.length,
        productiveRounds,
        lastDecision: decisions[decisions.length - 1] || null,
        toolFailures,
        failureTags,
    };
}

function clampScore(value = 0) {
    return Math.max(0, Math.min(1, Number(value || 0)));
}

function scorePerceivedIntelligence({
    memoryTrace = null,
    executionTrace = [],
    toolEvents = [],
    projectKey = '',
    clientSurface = '',
} = {}) {
    const memoryReadSetSummary = summarizeMemoryReadSet(memoryTrace, { projectKey, clientSurface });
    const initiativeReview = buildInitiativeReview({ executionTrace, toolEvents });
    const failureTags = [
        ...(memoryReadSetSummary.foreignProjectEntries.length > 0 ? ['cross_project_recall'] : []),
        ...(memoryReadSetSummary.foreignSurfaceEntries.length > 0 ? ['cross_surface_recall'] : []),
        ...initiativeReview.failureTags,
    ];
    const perceivedIntelligenceScores = {
        continuity: clampScore(1 - (initiativeReview.totalRounds > 0 && initiativeReview.productiveRounds === 0 ? 0.35 : 0)),
        initiative: clampScore(1 - (initiativeReview.failureTags.includes('unproductive_round') ? 0.35 : 0) - (initiativeReview.failureTags.includes('repeated_replan') ? 0.2 : 0)),
        groundedness: clampScore(Array.isArray(toolEvents) && toolEvents.length > 0 && toolEvents.some((event) => event?.result?.success === false) ? 0.78 : 0.92),
        isolation: clampScore(1 - (memoryReadSetSummary.foreignProjectEntries.length > 0 ? 0.9 : 0) - (memoryReadSetSummary.foreignSurfaceEntries.length > 0 ? 0.45 : 0)),
        surfaceDiscipline: clampScore(memoryReadSetSummary.foreignSurfaceEntries.length > 0 ? 0.55 : 0.92),
    };

    return {
        crossScopeReuse: {
            foreignProjectCount: memoryReadSetSummary.foreignProjectEntries.length,
            foreignSurfaceCount: memoryReadSetSummary.foreignSurfaceEntries.length,
            userGlobalCount: memoryReadSetSummary.userGlobalCount,
        },
        memoryReadSetSummary,
        initiativeReview,
        perceivedIntelligenceScores,
        failureTags: Array.from(new Set(failureTags)),
    };
}

module.exports = {
    buildInitiativeReview,
    inferSurfaceFinisher,
    normalizeFixture,
    scorePerceivedIntelligence,
    summarizeMemoryReadSet,
};
