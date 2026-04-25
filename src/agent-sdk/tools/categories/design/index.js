/**
 * Design Tools Category
 * Tools for software architecture and design
 */

const { ArchitectureTool } = require('./ArchitectureTool');
const { UMLTool } = require('./UMLTool');
const { APIDesignTool } = require('./APIDesignTool');
const { GraphDiagramTool } = require('./GraphDiagramTool');
const { getUnifiedRegistry } = require('../../../registry/UnifiedRegistry');

function registerDesignTools() {
  const registry = getUnifiedRegistry();
  
  const tools = [
    new ArchitectureTool(),
    new UMLTool(),
    new APIDesignTool(),
    new GraphDiagramTool()
  ];
  
  tools.forEach(tool => {
    const definition = {
      ...tool.toDefinition(),
      skill: {
        triggerPatterns: getTriggerPatterns(tool.id),
        autoApply: false,
        requiresConfirmation: false
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
          }))
      }
    };
    
    registry.register(definition);
  });
  
  console.log(`[DesignTools] Registered ${tools.length} design tools`);
  
  return tools;
}

function getTriggerPatterns(toolId) {
  const patterns = {
    'architecture-design': ['design architecture', 'system design', 'create architecture', 'architecture diagram'],
    'uml-generate': ['generate uml', 'class diagram', 'sequence diagram', 'create diagram'],
    'api-design': ['design api', 'create api', 'api spec', 'openapi', 'rest api design'],
    'graph-diagram': [
      'complex graph',
      'graph diagram',
      'diagram image',
      'render diagram',
      'generate svg diagram',
      'multiple graph images',
      'document diagram',
      'flowchart image',
      'network graph',
      'chart image'
    ]
  };
  return patterns[toolId] || [toolId];
}

function getIcon(toolId) {
  const icons = {
    'architecture-design': 'layout',
    'uml-generate': 'git-branch',
    'api-design': 'server',
    'graph-diagram': 'workflow'
  };
  return icons[toolId] || 'pen-tool';
}

function getUIComponent(toolId) {
  const components = {
    'architecture-design': 'ArchitectureDesigner',
    'uml-generate': 'UMLGenerator',
    'api-design': 'APIDesigner',
    'graph-diagram': 'GraphDiagramUtility'
  };
  return components[toolId] || null;
}

module.exports = { registerDesignTools };
