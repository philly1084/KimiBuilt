/**
 * Web Tools Category
 * Tools for web scraping, fetching, and searching
 */

const { WebFetchTool } = require('./WebFetchTool');
const { WebScrapeTool } = require('./WebScrapeTool');
const { WebSearchTool } = require('./WebSearchTool');
const { getUnifiedRegistry } = require('../../../registry/UnifiedRegistry');

function registerWebTools() {
  const registry = getUnifiedRegistry();
  
  const tools = [
    new WebFetchTool(),
    new WebScrapeTool(),
    new WebSearchTool()
  ];
  
  tools.forEach(tool => {
    const definition = {
      ...tool.toDefinition(),
      // Skill-specific configuration
      skill: {
        triggerPatterns: getTriggerPatterns(tool.id),
        autoApply: false,
        requiresConfirmation: tool.id !== 'web-fetch'
      },
      // Frontend configuration
      frontend: {
        exposeToFrontend: true,
        icon: getIcon(tool.id),
        uiComponent: getUIComponent(tool.id),
        parameters: tool.toDefinition().inputSchema?.properties || {}
      }
    };
    
    registry.register(definition);
  });
  
  console.log(`[WebTools] Registered ${tools.length} web tools`);
  
  return tools;
}

function getTriggerPatterns(toolId) {
  const patterns = {
    'web-fetch': ['fetch', 'download', 'get url', 'load page'],
    'web-scrape': ['scrape', 'extract from', 'crawl', 'parse website', 'get data from'],
    'web-search': ['search', 'look up', 'find on web', 'google', 'search for']
  };
  return patterns[toolId] || [toolId];
}

function getIcon(toolId) {
  const icons = {
    'web-fetch': 'download-cloud',
    'web-scrape': 'globe',
    'web-search': 'search'
  };
  return icons[toolId] || 'tool';
}

function getUIComponent(toolId) {
  const components = {
    'web-fetch': 'WebFetchPanel',
    'web-scrape': 'WebScraperPanel',
    'web-search': 'WebSearchPanel'
  };
  return components[toolId] || null;
}

module.exports = { registerWebTools };
