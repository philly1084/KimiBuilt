const { ConversationOrchestrator } = require('../conversation-orchestrator');
const {
  AGENCY_MODES,
  buildAgencyProfile,
  inferTaskIntent,
} = require('./intent-classifier');
const {
  applyRewritePolicyOverlay,
  removeUnsupportedAutonomousTools,
  selectCandidatesForAgencyMode,
} = require('./tool-policy');
const { validatePlan, validatePlanStep } = require('./plan-validator');

function withRewriteFlag(value, fn) {
  const previous = process.env.ORCHESTRATION_REWRITE_ENABLED;
  process.env.ORCHESTRATION_REWRITE_ENABLED = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.ORCHESTRATION_REWRITE_ENABLED;
    } else {
      process.env.ORCHESTRATION_REWRITE_ENABLED = previous;
    }
  }
}

function buildToolManager(toolIds = []) {
  const tools = new Map(toolIds.map((toolId) => [toolId, {
    id: toolId,
    name: toolId,
    description: `${toolId} test tool`,
    inputSchema: toolId === 'agent-workload'
      ? {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['create_from_scenario', 'list'] },
          request: { type: 'string' },
          timezone: { type: 'string' },
        },
        additionalProperties: false,
      }
      : {
        type: 'object',
        properties: {},
      },
    backend: {
      sideEffects: toolId.startsWith('agent-') ? ['write'] : [],
    },
  }]));
  return {
    getTool: jest.fn((toolId) => tools.get(toolId) || null),
  };
}

describe('orchestration rewrite policy', () => {
  test('classifies agency modes for respond, schedule, multi-schedule, and delegation', () => {
    expect(inferTaskIntent({ objective: 'What is dependency injection?' }).mode).toBe(AGENCY_MODES.RESPOND);
    expect(inferTaskIntent({ objective: 'Remind me tomorrow to check the logs.' }).mode).toBe(AGENCY_MODES.SCHEDULE);
    expect(inferTaskIntent({ objective: 'Create two cron jobs: daily backup and weekly cleanup.' }).mode).toBe(AGENCY_MODES.SCHEDULE_MULTIPLE);
    expect(inferTaskIntent({ objective: 'Spawn three sub-agents to investigate these areas in parallel.' }).mode).toBe(AGENCY_MODES.DELEGATE);
  });

  test('removes managed-app from autonomous allowlists and candidates', () => {
    expect(removeUnsupportedAutonomousTools(['managed-app', 'remote-command', 'agent-workload'])).toEqual([
      'remote-command',
      'agent-workload',
    ]);
  });

  test('narrows candidates by agency mode when rewrite flag is enabled', () => withRewriteFlag('true', () => {
    const toolManager = buildToolManager(['managed-app', 'agent-workload', 'agent-delegate', 'remote-command']);
    const intent = inferTaskIntent({ objective: 'Schedule this every weekday at 9 AM.' });
    const policy = applyRewritePolicyOverlay({
      legacyPolicy: {
        allowedToolIds: ['managed-app', 'agent-workload', 'agent-delegate', 'remote-command'],
        candidateToolIds: ['managed-app', 'agent-workload', 'remote-command'],
      },
      objective: 'Schedule this every weekday at 9 AM.',
      agencyProfile: buildAgencyProfile({ intent }),
      toolManager,
    });

    expect(policy.allowedToolIds).not.toContain('managed-app');
    expect(policy.candidateToolIds).toEqual(['agent-workload']);
    expect(policy.toolContracts['agent-workload']).toMatchObject({
      supportsSchedule: true,
      backgroundEligible: true,
    });
  }));

  test('validates planned steps before execution and returns structured rejection reasons', () => {
    const toolManager = buildToolManager(['agent-workload']);
    const invalid = validatePlanStep({
      tool: 'agent-workload',
      params: {
        action: 'create_from_scenario',
        request: 'check later',
        command: 'date',
      },
    }, {
      candidateToolIds: ['agent-workload'],
      toolManager,
    });

    expect(invalid.ok).toBe(false);
    expect(invalid.rejections.map((rejection) => rejection.code)).toContain('unknown_params');

    const managedApp = validatePlan([{ tool: 'managed-app', params: { action: 'inspect' } }], {
      candidateToolIds: ['managed-app'],
      toolManager: buildToolManager(['managed-app']),
    });
    expect(managedApp.ok).toBe(false);
    expect(managedApp.rejected[0].rejections.map((rejection) => rejection.code)).toContain('unsupported_tool');
  });

  test('orchestrator policy exposes typed rewrite metadata without changing public APIs', () => withRewriteFlag('true', () => {
    const orchestrator = new ConversationOrchestrator({});
    const toolManager = buildToolManager(['managed-app', 'agent-workload', 'agent-delegate', 'remote-command']);
    const policy = orchestrator.buildToolPolicy({
      objective: 'Set up a cron job to check disk usage daily.',
      executionProfile: 'default',
      toolManager,
    });

    expect(policy.type).toBe('ToolPolicy');
    expect(policy.orchestrationRewrite.intent.type).toBe('TaskIntent');
    expect(policy.orchestrationRewrite.agencyProfile.type).toBe('AgencyProfile');
    expect(policy.allowedToolIds).not.toContain('managed-app');
    expect(policy.candidateToolIds).toEqual(['agent-workload']);
  }));

  test('candidate narrowing helper keeps direct tools for multi-step work', () => {
    const candidates = selectCandidatesForAgencyMode({
      candidateToolIds: ['agent-workload', 'agent-delegate', 'remote-command'],
      agencyProfile: { mode: AGENCY_MODES.MULTI_STEP },
    });
    expect(candidates).toEqual(['agent-workload', 'agent-delegate', 'remote-command']);
  });
});
