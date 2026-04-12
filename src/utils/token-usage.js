function toFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function getNestedValue(source = {}, path = '') {
    return String(path || '')
        .split('.')
        .filter(Boolean)
        .reduce((current, segment) => (
            current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, segment)
                ? current[segment]
                : undefined
        ), source);
}

function firstFiniteValue(source = {}, paths = []) {
    for (const path of paths) {
        const value = toFiniteNumber(getNestedValue(source, path));
        if (value !== null) {
            return value;
        }
    }

    return null;
}

function hasUsagePath(source = {}, paths = []) {
    return paths.some((path) => getNestedValue(source, path) !== undefined);
}

function normalizeUsageMetadata(usage = {}) {
    if (!usage || typeof usage !== 'object') {
        return null;
    }

    const promptPaths = ['promptTokens', 'prompt_tokens', 'inputTokens', 'input_tokens'];
    const completionPaths = ['completionTokens', 'completion_tokens', 'outputTokens', 'output_tokens'];
    const totalPaths = ['totalTokens', 'total_tokens', 'tokensUsed', 'tokens_used'];
    const reasoningPaths = [
        'reasoningTokens',
        'reasoning_tokens',
        'outputTokenDetails.reasoningTokens',
        'output_tokens_details.reasoning_tokens',
        'completion_tokens_details.reasoning_tokens',
    ];
    const cachedPaths = [
        'cachedTokens',
        'cached_tokens',
        'inputTokenDetails.cachedTokens',
        'input_tokens_details.cached_tokens',
        'prompt_tokens_details.cached_tokens',
    ];
    const modelCallPaths = ['modelCalls', 'model_calls'];

    const promptTokens = firstFiniteValue(usage, promptPaths);
    const completionTokens = firstFiniteValue(usage, completionPaths);
    const totalTokens = firstFiniteValue(usage, totalPaths);
    const reasoningTokens = firstFiniteValue(usage, reasoningPaths);
    const cachedTokens = firstFiniteValue(usage, cachedPaths);
    const modelCalls = firstFiniteValue(usage, modelCallPaths);

    const hasExplicitUsage = [
        hasUsagePath(usage, promptPaths),
        hasUsagePath(usage, completionPaths),
        hasUsagePath(usage, totalPaths),
        hasUsagePath(usage, reasoningPaths),
        hasUsagePath(usage, cachedPaths),
        hasUsagePath(usage, modelCallPaths),
    ].some(Boolean);

    if (!hasExplicitUsage) {
        return null;
    }

    const normalized = {};
    if (promptTokens !== null) {
        normalized.promptTokens = promptTokens;
        normalized.inputTokens = promptTokens;
    }
    if (completionTokens !== null) {
        normalized.completionTokens = completionTokens;
        normalized.outputTokens = completionTokens;
    }
    if (totalTokens !== null) {
        normalized.totalTokens = totalTokens;
    } else if (promptTokens !== null || completionTokens !== null) {
        normalized.totalTokens = (promptTokens || 0) + (completionTokens || 0);
    }
    if (reasoningTokens !== null) {
        normalized.reasoningTokens = reasoningTokens;
    }
    if (cachedTokens !== null) {
        normalized.cachedTokens = cachedTokens;
    }
    if (modelCalls !== null) {
        normalized.modelCalls = modelCalls;
    }

    return normalized;
}

function mergeUsageMetadata(...entries) {
    const flattened = entries.flat().filter(Boolean);
    const totals = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedTokens: 0,
        modelCalls: 0,
    };
    let hasUsage = false;
    let hasPrompt = false;
    let hasCompletion = false;
    let hasTotal = false;
    let hasReasoning = false;
    let hasCached = false;
    let hasModelCalls = false;

    for (const entry of flattened) {
        const normalized = normalizeUsageMetadata(entry);
        if (!normalized) {
            continue;
        }

        hasUsage = true;

        if (Object.prototype.hasOwnProperty.call(normalized, 'promptTokens')) {
            totals.promptTokens += normalized.promptTokens;
            totals.inputTokens += normalized.inputTokens;
            hasPrompt = true;
        }
        if (Object.prototype.hasOwnProperty.call(normalized, 'completionTokens')) {
            totals.completionTokens += normalized.completionTokens;
            totals.outputTokens += normalized.outputTokens;
            hasCompletion = true;
        }
        if (Object.prototype.hasOwnProperty.call(normalized, 'totalTokens')) {
            totals.totalTokens += normalized.totalTokens;
            hasTotal = true;
        }
        if (Object.prototype.hasOwnProperty.call(normalized, 'reasoningTokens')) {
            totals.reasoningTokens += normalized.reasoningTokens;
            hasReasoning = true;
        }
        if (Object.prototype.hasOwnProperty.call(normalized, 'cachedTokens')) {
            totals.cachedTokens += normalized.cachedTokens;
            hasCached = true;
        }
        if (Object.prototype.hasOwnProperty.call(normalized, 'modelCalls')) {
            totals.modelCalls += normalized.modelCalls;
            hasModelCalls = true;
        }
    }

    if (!hasUsage) {
        return null;
    }

    const normalizedTotals = {};
    if (hasPrompt) {
        normalizedTotals.promptTokens = totals.promptTokens;
        normalizedTotals.inputTokens = totals.inputTokens;
    }
    if (hasCompletion) {
        normalizedTotals.completionTokens = totals.completionTokens;
        normalizedTotals.outputTokens = totals.outputTokens;
    }
    if (hasTotal) {
        normalizedTotals.totalTokens = totals.totalTokens;
    } else if (hasPrompt || hasCompletion) {
        normalizedTotals.totalTokens = totals.promptTokens + totals.completionTokens;
    }
    if (hasReasoning) {
        normalizedTotals.reasoningTokens = totals.reasoningTokens;
    }
    if (hasCached) {
        normalizedTotals.cachedTokens = totals.cachedTokens;
    }
    if (hasModelCalls) {
        normalizedTotals.modelCalls = totals.modelCalls;
    }

    return normalizedTotals;
}

function withDefaultModelCallCount(usage = {}, defaultModelCalls = 1) {
    const normalized = normalizeUsageMetadata(usage);
    if (!normalized) {
        return null;
    }

    if (Object.prototype.hasOwnProperty.call(normalized, 'modelCalls')) {
        return normalized;
    }

    return {
        ...normalized,
        modelCalls: defaultModelCalls,
    };
}

function extractResponseUsageMetadata(response = {}) {
    const metadataUsage = withDefaultModelCallCount(
        response?.metadata?.usage
        || response?.metadata?.tokenUsage
        || response?._kimibuilt?.usage
        || response?._kimibuilt?.tokenUsage,
        1,
    );
    if (metadataUsage) {
        return metadataUsage;
    }

    return withDefaultModelCallCount(response?.usage || {}, 1);
}

function extractUsageMetadataFromTrace(executionTrace = []) {
    return mergeUsageMetadata(
        (Array.isArray(executionTrace) ? executionTrace : [])
            .filter((entry) => entry?.type === 'model_call')
            .map((entry) => entry?.details?.usage)
            .filter(Boolean),
    );
}

function createZeroUsageMetadata() {
    return normalizeUsageMetadata({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        modelCalls: 0,
    });
}

module.exports = {
    createZeroUsageMetadata,
    extractResponseUsageMetadata,
    extractUsageMetadataFromTrace,
    mergeUsageMetadata,
    normalizeUsageMetadata,
};
