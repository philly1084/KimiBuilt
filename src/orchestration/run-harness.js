class HarnessState {
  constructor({
    runId = '',
    workflowName = 'KimiBuilt harness run',
    groupId = '',
    mode = 'respond',
    maxRounds = 1,
    maxToolCalls = 4,
    blockers = [],
    evidence = [],
    toolEvents = [],
  } = {}) {
    this.type = 'HarnessState';
    this.runId = runId;
    this.workflowName = workflowName || 'KimiBuilt harness run';
    this.groupId = groupId || runId || '';
    this.mode = mode;
    this.maxRounds = maxRounds;
    this.maxToolCalls = maxToolCalls;
    this.blockers = Array.isArray(blockers) ? blockers : [];
    this.evidence = Array.isArray(evidence)
      ? evidence.map((entry, index) => this.normalizeEvidence(entry, index)).filter(Boolean)
      : [];
    this.toolEvents = Array.isArray(toolEvents) ? toolEvents : [];
  }

  addToolEvent(event = {}) {
    this.toolEvents.push({
      type: 'ToolExecutionEvent',
      ...event,
      timestamp: event.timestamp || new Date().toISOString(),
    });
  }

  addBlocker(blocker = {}) {
    this.blockers.push({
      type: 'Blocker',
      ...blocker,
      timestamp: blocker.timestamp || new Date().toISOString(),
    });
  }

  normalizeEvidence(evidence = {}, index = this.evidence.length) {
    if (!evidence || typeof evidence !== 'object') {
      return null;
    }

    const summary = String(evidence.summary || evidence.description || evidence.name || '').trim();
    if (!summary) {
      return null;
    }

    return {
      type: 'HarnessEvidence',
      id: evidence.id || `evidence-${index + 1}`,
      summary,
      source: evidence.source || evidence.tool || evidence.url || null,
      score: Number.isFinite(Number(evidence.score)) ? Number(evidence.score) : null,
      passed: typeof evidence.passed === 'boolean' ? evidence.passed : null,
      metadata: evidence.metadata && typeof evidence.metadata === 'object' ? evidence.metadata : {},
      timestamp: evidence.timestamp || new Date().toISOString(),
    };
  }

  addEvidence(evidence = {}) {
    const normalized = this.normalizeEvidence(evidence);
    if (!normalized) {
      return null;
    }
    this.evidence.push(normalized);
    return normalized;
  }

  toTraceMetadata() {
    return {
      workflowName: this.workflowName,
      groupId: this.groupId,
      runId: this.runId,
      mode: this.mode,
      evidenceCount: this.evidence.length,
      blockerCount: this.blockers.length,
      toolEventCount: this.toolEvents.length,
    };
  }

  toGradingPayload({
    item = {},
    outputText = '',
    outputTools = [],
    outputJson = null,
    referenceAnswer = '',
    choices = [],
  } = {}) {
    const normalizedItem = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
    const sample = {
      output_text: String(outputText || ''),
      output_tools: Array.isArray(outputTools) ? outputTools : [],
      choices: Array.isArray(choices) ? choices : [],
    };

    if (outputJson && typeof outputJson === 'object' && !Array.isArray(outputJson)) {
      sample.output_json = outputJson;
    }

    return {
      item: {
        ...normalizedItem,
        reference_answer: normalizedItem.reference_answer || referenceAnswer || '',
      },
      sample,
      evidence: this.evidence,
      blockers: this.blockers,
      metadata: this.toTraceMetadata(),
    };
  }

  toJSON() {
    return {
      type: this.type,
      runId: this.runId,
      workflowName: this.workflowName,
      groupId: this.groupId,
      mode: this.mode,
      maxRounds: this.maxRounds,
      maxToolCalls: this.maxToolCalls,
      blockers: this.blockers,
      evidence: this.evidence,
      toolEvents: this.toolEvents,
      traceMetadata: this.toTraceMetadata(),
    };
  }
}

module.exports = {
  HarnessState,
};
