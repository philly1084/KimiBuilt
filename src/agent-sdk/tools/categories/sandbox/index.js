/**
 * Sandbox Tools Category
 * Tools for secure code execution and security scanning
 */

const { SandboxTool } = require('./SandboxTool');
const { SecurityScanTool } = require('./SecurityScanTool');
const { getUnifiedRegistry } = require('../../../registry/UnifiedRegistry');

function registerSandboxTools() {
  const registry = getUnifiedRegistry();
  
  const tools = [
    new SandboxTool(),
    new SecurityScanTool()
  ];
  
  tools.forEach(tool => {
    const definition = {
      ...tool.toDefinition(),
      skill: {
        triggerPatterns: getTriggerPatterns(tool.id),
        autoApply: false,
        requiresConfirmation: tool.id === 'code-sandbox' // Sandbox needs confirmation
      },
      frontend: {
        exposeToFrontend: true,
        icon: getIcon(tool.id),
        uiComponent: getUIComponent(tool.id),
        parameters: Object.entries(tool.toDefinition().inputSchema?.properties || {})
          .map(([name, schema]) => ({
            name,
            type: schema.type || 'string',
            required: tool.toDefinition().inputSchema?.required?.includes(name),
            description: schema.description
          })),
        requiresSetup: false
      }
    };
    
    registry.register(definition);
  });
  
  console.log(`[SandboxTools] Registered ${tools.length} sandbox tools`);
  
  return tools;
}

function getTriggerPatterns(toolId) {
  const patterns = {
    'code-sandbox': ['run code', 'execute code', 'sandbox', 'test code', 'run in sandbox'],
    'security-scan': ['scan security', 'security check', 'vulnerability scan', 'audit code']
  };
  return patterns[toolId] || [toolId];
}

function getIcon(toolId) {
  const icons = {
    'code-sandbox': 'shield',
    'security-scan': 'lock'
  };
  return icons[toolId] || 'shield';
}

function getUIComponent(toolId) {
  const components = {
    'code-sandbox': 'CodeSandbox',
    'security-scan': 'SecurityScanner'
  };
  return components[toolId] || null;
}

module.exports = { registerSandboxTools };
