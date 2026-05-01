const { renderPromptTemplate } = require('./prompt-renderer');
const { remoteCliAgentsSdkRunner } = require('../remote-cli/agents-sdk-runner');

function normalizeText(value = '') {
  return String(value || '').trim();
}

function buildRemoteCliTask({
  issue = {},
  attempt = null,
  prompt = '',
} = {}) {
  return [
    prompt,
    '',
    'Issue context:',
    `- Identifier: ${issue.identifier || issue.id || 'unknown'}`,
    `- Title: ${issue.title || 'Untitled'}`,
    issue.url ? `- URL: ${issue.url}` : '',
    issue.description ? `- Description:\n${issue.description}` : '',
    attempt != null ? `- Symphony retry attempt: ${attempt}` : '',
  ].filter(Boolean).join('\n');
}

function mapRemoteCliConfig(serviceConfig = {}) {
  const config = serviceConfig.remote_cli_agent || {};
  return {
    targetId: config.target_id || undefined,
    cwd: config.cwd || undefined,
    model: config.model || undefined,
    maxTurns: config.max_turns || undefined,
    waitMs: config.wait_ms || undefined,
    adminMode: config.admin_mode === true,
    instructions: config.instructions || undefined,
  };
}

class RemoteCliAgentRunner {
  constructor({
    runner = remoteCliAgentsSdkRunner,
  } = {}) {
    this.runner = runner;
  }

  async run({
    issue,
    attempt = null,
    workflow = {},
    serviceConfig = {},
    onEvent = () => {},
  } = {}) {
    const prompt = renderPromptTemplate(workflow.prompt_template, { issue, attempt });
    const config = mapRemoteCliConfig(serviceConfig);
    const task = buildRemoteCliTask({
      issue,
      attempt,
      prompt,
    });
    onEvent({
      event: 'remote_cli_agent_started',
      timestamp: new Date().toISOString(),
      message: `Dispatching ${issue?.identifier || issue?.id || 'issue'} through remote-cli-agent`,
      payload: {
        issue_id: issue?.id || null,
        issue_identifier: issue?.identifier || null,
        targetId: config.targetId || null,
        cwd: config.cwd || null,
        adminMode: config.adminMode,
      },
    });

    const result = await this.runner.run({
      ...config,
      task,
    });

    onEvent({
      event: 'turn_completed',
      timestamp: new Date().toISOString(),
      message: normalizeText(result.finalOutput).slice(0, 500) || 'remote-cli-agent completed',
      payload: {
        result,
      },
    });

    return {
      ok: true,
      runner: 'remote-cli-agent',
      result,
    };
  }
}

function createRemoteCliAgentRunner(options = {}) {
  const runner = new RemoteCliAgentRunner(options);
  return (params) => runner.run(params);
}

module.exports = {
  RemoteCliAgentRunner,
  buildRemoteCliTask,
  createRemoteCliAgentRunner,
  mapRemoteCliConfig,
};
