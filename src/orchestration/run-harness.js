class HarnessState {
  constructor({
    runId = '',
    mode = 'respond',
    maxRounds = 1,
    maxToolCalls = 4,
    blockers = [],
    evidence = [],
    toolEvents = [],
  } = {}) {
    this.type = 'HarnessState';
    this.runId = runId;
    this.mode = mode;
    this.maxRounds = maxRounds;
    this.maxToolCalls = maxToolCalls;
    this.blockers = Array.isArray(blockers) ? blockers : [];
    this.evidence = Array.isArray(evidence) ? evidence : [];
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

  toJSON() {
    return {
      type: this.type,
      runId: this.runId,
      mode: this.mode,
      maxRounds: this.maxRounds,
      maxToolCalls: this.maxToolCalls,
      blockers: this.blockers,
      evidence: this.evidence,
      toolEvents: this.toolEvents,
    };
  }
}

module.exports = {
  HarnessState,
};
