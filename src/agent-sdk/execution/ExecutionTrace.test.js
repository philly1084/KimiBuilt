const { ExecutionTrace, ExecutionStep } = require('./ExecutionTrace');

describe('ExecutionTrace nested step aggregation', () => {
  test('includes nested tool and llm steps in metrics and filters', () => {
    const trace = new ExecutionTrace('task-nested-trace');
    const parent = new ExecutionStep({
      type: 'plan',
      description: 'Coordinate the agent run',
    });
    const toolStep = new ExecutionStep({
      type: 'tool-call',
      description: 'Fetch source material',
      metadata: {
        retries: 1,
      },
    });
    const llmStep = new ExecutionStep({
      type: 'llm-call',
      description: 'Summarize the fetched source',
      error: 'model timeout',
    });

    toolStep.setTokens(12, 8);
    llmStep.setTokens(50, 20);
    parent.addSubstep(toolStep).addSubstep(llmStep);
    trace.addStep(parent);

    expect(trace.metrics).toEqual(expect.objectContaining({
      totalSteps: 3,
      toolCalls: 1,
      llmCalls: 1,
      errors: 1,
      retries: 1,
    }));
    expect(trace.metrics.totalTokens).toEqual({
      input: 62,
      output: 28,
    });
    expect(trace.getToolCalls()).toEqual([toolStep]);
    expect(trace.getLLMCalls()).toEqual([llmStep]);
    expect(trace.getErrors()).toEqual([llmStep]);
    expect(trace.summarize()).toEqual(expect.objectContaining({
      stepCount: 3,
      toolCalls: 1,
      llmCalls: 1,
      errors: 1,
      retries: 1,
    }));
  });
});
