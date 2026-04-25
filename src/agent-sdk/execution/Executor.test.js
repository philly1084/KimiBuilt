const { Executor } = require('./Executor');
const { ExecutionPlan } = require('./Planner');
const { ToolDefinition } = require('../tools/ToolDefinition');
const { ToolRegistry } = require('../tools/ToolRegistry');

function createTask(overrides = {}) {
  return {
    id: 'task-1',
    type: 'chat',
    objective: 'Run the planned tool.',
    completionCriteria: {
      conditions: [],
    },
    transitionStatus(status) {
      this.status = status;
    },
    ...overrides,
  };
}

function createExecutorWithPlan(plan, toolRegistry) {
  return new Executor({
    toolRegistry,
    workingMemory: null,
    retryEngine: null,
    verifier: {
      verify: jest.fn(async () => ({
        valid: true,
        passed: 0,
        total: 0,
        results: [],
      })),
    },
    planner: {
      createPlan: jest.fn(async () => plan),
    },
    llmClient: {
      complete: jest.fn(),
    },
  });
}

describe('Executor tool failure handling', () => {
  test('treats a failed tool execution result as a failed step', async () => {
    const plan = new ExecutionPlan('task-1');
    plan.addStep({
      type: 'tool-call',
      description: 'Call a failing tool',
      tool: 'failing-tool',
    });

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(new ToolDefinition({
      id: 'failing-tool',
      name: 'Failing Tool',
      description: 'Returns an execution failure',
      handler: async () => {
        throw new Error('upstream service unavailable');
      },
    }));

    const executor = createExecutorWithPlan(plan, toolRegistry);
    const result = await executor.execute(createTask());

    expect(result.success).toBe(false);
    expect(result.error).toContain('upstream service unavailable');
    expect(result.trace.metrics.errors).toBe(1);
    expect(result.trace.steps[0]).toEqual(expect.objectContaining({
      type: 'tool-call',
      error: 'upstream service unavailable',
    }));
    expect(result.plan.progress.failed).toBe(1);
  });

  test('skips optional failed tool steps and continues the plan', async () => {
    const plan = new ExecutionPlan('task-1');
    plan.addStep({
      type: 'tool-call',
      description: 'Call an optional failing tool',
      tool: 'optional-tool',
      optional: true,
    });
    plan.addStep({
      type: 'llm-call',
      description: 'Draft the final answer',
      prompt: 'Summarize the result.',
    });

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(new ToolDefinition({
      id: 'optional-tool',
      name: 'Optional Tool',
      description: 'Fails but is optional',
      handler: async () => {
        throw new Error('optional source offline');
      },
    }));

    const executor = createExecutorWithPlan(plan, toolRegistry);
    executor.llmClient.complete.mockResolvedValue('Final answer without optional source.');

    const result = await executor.execute(createTask());

    expect(result.success).toBe(true);
    expect(result.output).toBe('Final answer without optional source.');
    expect(result.plan.progress.completed).toBe(1);
    expect(result.plan.progress.failed).toBe(0);
    expect(result.trace.metrics.errors).toBe(1);
    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        success: false,
        error: 'optional source offline',
      }),
      expect.objectContaining({
        success: true,
        output: 'Final answer without optional source.',
      }),
    ]));
  });
});
