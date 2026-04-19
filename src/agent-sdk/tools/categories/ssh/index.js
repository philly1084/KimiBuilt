/**
 * SSH Tools Category
 * Tools for remote system access and container management
 */

const { SSHExecuteTool } = require('./SSHExecuteTool');
const { DockerExecTool } = require('./DockerExecTool');
const { getUnifiedRegistry } = require('../../../registry/UnifiedRegistry');

function registerSSHTools() {
  const registry = getUnifiedRegistry();
  
  const tools = [
    new SSHExecuteTool(),
    new DockerExecTool()
  ];
  
  tools.forEach(tool => {
    const definition = {
      ...tool.toDefinition(),
      skill: {
        triggerPatterns: getTriggerPatterns(tool.id),
        autoApply: false,
        requiresConfirmation: true
      },
      frontend: {
        exposeToFrontend: true,
        icon: getIcon(tool.id),
        uiComponent: getUIComponent(tool.id),
        requiresSetup: true,
        parameters: Object.entries(tool.toDefinition().inputSchema?.properties || {})
          .map(([name, schema]) => ({
            name,
            type: schema.type || 'string',
            required: tool.toDefinition().inputSchema?.required?.includes(name),
            description: schema.description
          }))
      }
    };
    
    registry.register(definition);
  });
  
  console.log(`[SSHTools] Registered ${tools.length} SSH tools`);
  
  return tools;
}

function getTriggerPatterns(toolId) {
  const patterns = {
    'ssh-execute': ['ssh', 'bash', 'shell', 'remote command', 'execute on server', 'run on host', 'run bash remotely'],
    'docker-exec': ['docker', 'container', 'run in container', 'docker exec']
  };
  return patterns[toolId] || [toolId];
}

function getIcon(toolId) {
  const icons = {
    'ssh-execute': 'terminal',
    'docker-exec': 'box'
  };
  return icons[toolId] || 'server';
}

function getUIComponent(toolId) {
  const components = {
    'ssh-execute': 'SSHExecutor',
    'docker-exec': 'DockerExecutor'
  };
  return components[toolId] || null;
}

module.exports = { registerSSHTools };
