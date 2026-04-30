'use strict';

const {
  RemoteCliAgentsSdkRunner,
  buildRemoteCliInstructions,
  extractRemoteCliRunMetadata,
  hasRemoteSoftwareDeploymentIntent,
  resolveAgentsApiMode,
  resolveAdminMode,
} = require('./agents-sdk-runner');

describe('RemoteCliAgentsSdkRunner', () => {
  test('builds remote CLI instructions with target defaults and polling guidance', () => {
    const instructions = buildRemoteCliInstructions({
      targetId: 'prod',
      cwd: '/srv/apps/my-app',
      sessionId: 'sess_123',
      waitMs: 30000,
    });

    expect(instructions).toContain('Use remote_code_run for coding tasks.');
    expect(instructions).toContain('Default targetId: prod');
    expect(instructions).toContain('Default cwd: /srv/apps/my-app');
    expect(instructions).toContain('repo-map');
    expect(instructions).toContain('deploy-verify');
    expect(instructions).toContain('git-backed workspace');
    expect(instructions).toContain('git user.name');
    expect(instructions).toContain('Playwright/Chromium screenshots');
    expect(instructions).toContain('kimibuilt-ui-check');
    expect(instructions).toContain('UI_CHECK_REPORT');
    expect(instructions).toContain('GIT_COMMIT');
    expect(instructions).toContain('remote_code_status');
    expect(instructions).toContain('persistent private workbench');
    expect(instructions).toContain('sess_123');
  });

  test('adds admin runner guidance for real remote deployment work', () => {
    const instructions = buildRemoteCliInstructions({
      targetId: 'prod',
      cwd: '/srv/apps/status-dashboard',
      waitMs: 30000,
      adminMode: true,
    });

    expect(instructions).toContain('Admin runner mode is enabled');
    expect(instructions).toContain('do not retry the same blocked command');
    expect(instructions).toContain('USER_INPUT_REQUIRED');
  });

  test('infers admin mode for remote software deployments but not inspections', () => {
    expect(hasRemoteSoftwareDeploymentIntent(
      'Build a new dashboard on the server and deploy it to k3s at status.demoserver2.buzz with ingress and TLS.',
    )).toBe(true);
    expect(resolveAdminMode({}, 'Inspect the k3s deployment logs for the backend service.')).toBe(false);
    expect(resolveAdminMode({ adminMode: false }, 'Build and deploy a site on the server.')).toBe(false);
    expect(resolveAdminMode({ runnerAdmin: true }, 'Inspect cluster status.')).toBe(true);
  });

  test('includes configured Gitea context in remote CLI instructions without exposing tokens', () => {
    const instructions = buildRemoteCliInstructions({
      targetId: 'prod',
      gitea: {
        configured: true,
        baseURL: 'https://gitea.demoserver2.buzz',
        org: 'agent-apps',
        hasToken: true,
      },
    });

    expect(instructions).toContain('Configured Gitea: https://gitea.demoserver2.buzz (org: agent-apps).');
    expect(instructions).toContain('GITEA_TOKEN');
    expect(instructions).not.toContain('hasToken');
  });

  test('extracts remote CLI continuity markers from final output', () => {
    expect(extractRemoteCliRunMetadata([
      'Deployed the site.',
      'REMOTE_CLI_SESSION_ID=rcs_123',
      'WORKSPACE=/srv/apps/weather',
      'GIT_REPO=https://gitea.demoserver2.buzz/agent-apps/weather.git',
      'GIT_COMMIT=abcdef123456',
      'DEPLOYMENT=app-weather/weather',
      'PUBLIC_HOST=weather.demoserver2.buzz',
      'UI_CHECK_REPORT=/srv/apps/weather/ui-checks/ui-check-report.json',
      'UI_SCREENSHOTS=/srv/apps/weather/ui-checks/weather-desktop.png,/srv/apps/weather/ui-checks/weather-mobile.png',
    ].join('\n'))).toEqual({
      sessionId: 'rcs_123',
      workspace: '/srv/apps/weather',
      gitRepo: 'https://gitea.demoserver2.buzz/agent-apps/weather.git',
      gitCommit: 'abcdef123456',
      deployment: 'app-weather/weather',
      publicHost: 'weather.demoserver2.buzz',
      uiCheckReport: '/srv/apps/weather/ui-checks/ui-check-report.json',
      uiScreenshots: [
        '/srv/apps/weather/ui-checks/weather-desktop.png',
        '/srv/apps/weather/ui-checks/weather-mobile.png',
      ],
    });
  });

  test('uses chat mode automatically for custom gateway base URLs', () => {
    expect(resolveAgentsApiMode({
      requestedMode: 'auto',
      baseURL: 'http://n8n-openai-cli-gateway/v1',
    })).toBe('chat');
    expect(resolveAgentsApiMode({
      requestedMode: 'auto',
      baseURL: 'https://api.openai.com/v1',
    })).toBe('responses');
  });

  test('connects Streamable HTTP MCP with bearer auth and closes it after the run', async () => {
    const calls = {
      apiModes: [],
      mcpOptions: null,
      agentConfig: null,
      runnerConfig: null,
      runnerInput: null,
      connected: false,
      closed: false,
    };

    class FakeMCPServerStreamableHttp {
      constructor(options) {
        calls.mcpOptions = options;
        this.sessionId = 'mcp-session-1';
      }

      async connect() {
        calls.connected = true;
      }

      async close() {
        calls.closed = true;
      }
    }

    class FakeAgent {
      constructor(config) {
        calls.agentConfig = config;
      }
    }

    class FakeOpenAIProvider {
      constructor(config) {
        this.config = config;
      }
    }

    class FakeRunner {
      constructor(config) {
        calls.runnerConfig = config;
      }

      async run(_agent, input, options) {
        calls.runnerInput = { input, options };
        return {
          finalOutput: [
            'fixed tests',
            'REMOTE_CLI_SESSION_ID=remote-session-1',
            'WORKSPACE=/srv/apps/my-app',
            'GIT_COMMIT=abcdef123456',
            'UI_CHECK_REPORT=/srv/apps/my-app/ui-checks/ui-check-report.json',
            'UI_SCREENSHOT=/srv/apps/my-app/ui-checks/my-app-desktop.png',
          ].join('\n'),
        };
      }
    }

    const runner = new RemoteCliAgentsSdkRunner({
      config: {
        enabled: true,
        url: 'https://gateway.example.com/mcp',
        name: 'remote-cli',
        apiKey: 'gateway-secret',
        agentApiKey: 'openai-secret',
        agentBaseURL: 'http://gateway.example.com/v1',
        agentApiMode: 'chat',
        agentModel: 'gpt-4o',
        defaultTargetId: 'prod',
        defaultCwd: '/srv/apps/my-app',
        timeoutMs: 60000,
        maxTurns: 20,
      },
      sdkLoader: () => ({
        Agent: FakeAgent,
        MCPServerStreamableHttp: FakeMCPServerStreamableHttp,
        OpenAIProvider: FakeOpenAIProvider,
        Runner: FakeRunner,
        setOpenAIAPI: (mode) => calls.apiModes.push(mode),
      }),
    });

    const result = await runner.run({
      task: 'Fix the failing tests',
      waitMs: 30000,
      adminMode: true,
    });

    expect(calls.mcpOptions).toMatchObject({
      url: 'https://gateway.example.com/mcp',
      name: 'remote-cli',
      cacheToolsList: true,
      timeout: 60000,
    });
    expect(calls.mcpOptions.requestInit.headers.Authorization).toBe('Bearer gateway-secret');
    expect(calls.agentConfig.mcpServers).toHaveLength(1);
    expect(calls.agentConfig.instructions).toContain('Default targetId: prod');
    expect(calls.agentConfig.instructions).toContain('Admin runner mode is enabled');
    expect(calls.runnerConfig.model).toBe('gpt-4o');
    expect(calls.runnerInput.input).toContain('Fix the failing tests');
    expect(calls.runnerInput.options.maxTurns).toBe(20);
    expect(calls.apiModes).toEqual(['chat']);
    expect(calls.connected).toBe(true);
    expect(calls.closed).toBe(true);
    expect(result.finalOutput).toContain('fixed tests');
    expect(result).toMatchObject({
      mcpSessionId: 'mcp-session-1',
      targetId: 'prod',
      cwd: '/srv/apps/my-app',
      sessionId: 'remote-session-1',
      gitCommit: 'abcdef123456',
      uiCheckReport: '/srv/apps/my-app/ui-checks/ui-check-report.json',
      uiScreenshots: ['/srv/apps/my-app/ui-checks/my-app-desktop.png'],
    });
  });
});
