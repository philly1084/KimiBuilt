const { AGENCY_MODES } = require('./intent-classifier');

function buildDeterministicRoute({
  objective = '',
  agencyProfile = null,
  toolPolicy = {},
  timezone = '',
} = {}) {
  const mode = agencyProfile?.mode || AGENCY_MODES.RESPOND;
  const candidates = new Set(toolPolicy?.candidateToolIds || []);

  if ((mode === AGENCY_MODES.SCHEDULE || mode === AGENCY_MODES.SCHEDULE_MULTIPLE) && candidates.has('agent-workload')) {
    return {
      type: 'PlanStep',
      source: 'orchestration-rewrite',
      tool: 'agent-workload',
      reason: mode === AGENCY_MODES.SCHEDULE_MULTIPLE
        ? 'Create persisted workloads for the requested scheduled jobs.'
        : 'Create a persisted workload for the requested schedule.',
      params: {
        action: 'create_from_scenario',
        request: objective,
        ...(timezone ? { timezone } : {}),
      },
    };
  }

  if (mode === AGENCY_MODES.DELEGATE && candidates.has('agent-delegate')) {
    return {
      type: 'PlanStep',
      source: 'orchestration-rewrite',
      tool: 'agent-delegate',
      reason: 'Spawn bounded sub-agents for explicit delegated work.',
      params: {
        action: 'spawn',
        tasks: [{
          title: 'Delegated task',
          prompt: objective,
        }],
      },
    };
  }

  return null;
}

module.exports = {
  buildDeterministicRoute,
};
