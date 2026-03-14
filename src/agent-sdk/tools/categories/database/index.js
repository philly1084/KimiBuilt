/**
 * Database Tools Category
 * Tools for database schema design and management
 */

const { SchemaTool } = require('./SchemaTool');
const { MigrationTool } = require('./MigrationTool');
const { getUnifiedRegistry } = require('../../../registry/UnifiedRegistry');

function registerDatabaseTools() {
  const registry = getUnifiedRegistry();
  
  const tools = [
    new SchemaTool(),
    new MigrationTool()
  ];
  
  tools.forEach(tool => {
    const definition = {
      ...tool.toDefinition(),
      skill: {
        triggerPatterns: getTriggerPatterns(tool.id),
        autoApply: false,
        requiresConfirmation: true // Database operations are sensitive
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
  
  console.log(`[DatabaseTools] Registered ${tools.length} database tools`);
  
  return tools;
}

function getTriggerPatterns(toolId) {
  const patterns = {
    'schema-generate': ['create schema', 'design database', 'generate ddl', 'database schema'],
    'migration-create': ['create migration', 'generate migration', 'schema migration', 'database change']
  };
  return patterns[toolId] || [toolId];
}

function getIcon(toolId) {
  const icons = {
    'schema-generate': 'database',
    'migration-create': 'git-commit'
  };
  return icons[toolId] || 'database';
}

function getUIComponent(toolId) {
  const components = {
    'schema-generate': 'SchemaDesigner',
    'migration-create': 'MigrationCreator'
  };
  return components[toolId] || null;
}

module.exports = { registerDatabaseTools };
