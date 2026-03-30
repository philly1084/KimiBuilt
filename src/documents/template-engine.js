/**
 * Template Engine - Manages document templates
 */

const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const { glob } = require('glob');

function collectBuiltInTemplateFiles(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      return collectBuiltInTemplateFiles(fullPath);
    }

    return entry.isFile() && entry.name.endsWith('.json')
      ? [fullPath]
      : [];
  });
}

function loadBuiltInTemplates() {
  const templates = [];
  const templatesRoot = path.join(__dirname, 'templates');
  const templateFiles = collectBuiltInTemplateFiles(templatesRoot);
  
  for (const file of templateFiles) {
    try {
      const template = require(file);
      templates.push(template);
    } catch (err) {
      console.warn(`[TemplateEngine] Could not load template: ${file}`);
    }
  }
  
  return templates;
}

const BUILT_IN_TEMPLATES = loadBuiltInTemplates();

class TemplateEngine {
  constructor() {
    this.templates = new Map();
    this.loadBuiltInTemplates();
  }

  /**
   * Load built-in templates
   */
  loadBuiltInTemplates() {
    for (const template of BUILT_IN_TEMPLATES) {
      this.templates.set(template.id, template);
    }
  }

  /**
   * Load custom templates from filesystem
   * @param {string} templatesDir - Directory containing templates
   */
  async loadCustomTemplates(templatesDir = './templates') {
    try {
      const files = await glob('**/*.json', { cwd: templatesDir });
      
      for (const file of files) {
        const filePath = path.join(templatesDir, file);
        const content = await fsPromises.readFile(filePath, 'utf-8');
        const template = JSON.parse(content);
        
        if (this.validateTemplate(template)) {
          this.templates.set(template.id, template);
        }
      }
    } catch (error) {
      console.error('[TemplateEngine] Failed to load custom templates:', error.message);
    }
  }

  /**
   * Get a template by ID
   * @param {string} templateId - Template identifier
   * @returns {Object|null} Template definition
   */
  getTemplate(templateId) {
    return this.templates.get(templateId) || null;
  }

  /**
   * Get all templates, optionally filtered by category
   * @param {string} category - Optional category filter
   * @returns {Array} List of templates
   */
  getTemplates(category = null) {
    const templates = Array.from(this.templates.values());
    
    if (category) {
      return templates.filter(t => t.category === category);
    }
    
    return templates;
  }

  /**
   * Get templates grouped by category
   * @returns {Object} Templates grouped by category
   */
  getTemplatesByCategory() {
    const grouped = {};
    
    for (const template of this.templates.values()) {
      const category = template.category || 'other';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(template);
    }
    
    return grouped;
  }

  /**
   * Get available categories
   * @returns {Array} List of categories
   */
  getCategories() {
    const categories = new Set();
    for (const template of this.templates.values()) {
      categories.add(template.category);
    }
    return Array.from(categories).sort();
  }

  /**
   * Populate a template with variables
   * @param {Object} template - Template definition
   * @param {Object} variables - Variable values
   * @returns {Object} Populated template
   */
  populate(template, variables) {
    // Deep clone template
    const populated = JSON.parse(JSON.stringify(template));

    // Replace variables in template strings
    const replaceVariables = (obj) => {
      if (typeof obj === 'string') {
        return this.replacePlaceholders(obj, variables);
      }
      if (Array.isArray(obj)) {
        return obj.map(replaceVariables);
      }
      if (obj && typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = replaceVariables(value);
        }
        return result;
      }
      return obj;
    };

    return replaceVariables(populated);
  }

  /**
   * Replace placeholders in a string
   * @param {string} str - String with placeholders
   * @param {Object} variables - Variable values
   * @returns {string} String with replacements
   */
  replacePlaceholders(str, variables) {
    // Handle {{variable}} syntax
    let result = str.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return variables[key] !== undefined ? String(variables[key]) : match;
    });

    // Handle {{{variable}}} syntax for unescaped HTML
    result = result.replace(/\{\{\{(\w+)\}\}\}/g, (match, key) => {
      return variables[key] !== undefined ? String(variables[key]) : match;
    });

    // Handle conditional blocks {{#if variable}}...{{/if}}
    result = result.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, key, content) => {
      return variables[key] ? content : '';
    });

    // Handle loops {{#each items}}...{{/each}}
    result = result.replace(/\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (match, key, content) => {
      const items = variables[key];
      if (!Array.isArray(items)) return '';
      
      return items.map(item => {
        if (typeof item === 'object') {
          let itemContent = content;
          for (const [itemKey, itemValue] of Object.entries(item)) {
            itemContent = itemContent.replace(new RegExp(`{{${itemKey}}}`, 'g'), String(itemValue));
          }
          return itemContent;
        }
        return content.replace(/{{\.}}/g, String(item));
      }).join('');
    });

    return result;
  }

  /**
   * Validate a template structure
   * @param {Object} template - Template to validate
   * @returns {boolean} True if valid
   */
  validateTemplate(template) {
    const required = ['id', 'name', 'category', 'variables', 'formats'];
    
    for (const field of required) {
      if (!template[field]) {
        console.error(`[TemplateEngine] Template missing required field: ${field}`);
        return false;
      }
    }

    if (!Array.isArray(template.variables)) {
      console.error('[TemplateEngine] Template variables must be an array');
      return false;
    }

    if (!Array.isArray(template.formats)) {
      console.error('[TemplateEngine] Template formats must be an array');
      return false;
    }

    return true;
  }

  /**
   * Create a new custom template
   * @param {Object} template - Template definition
   * @returns {boolean} True if created successfully
   */
  async createTemplate(template) {
    if (!this.validateTemplate(template)) {
      throw new Error('Invalid template structure');
    }

    if (this.templates.has(template.id)) {
      throw new Error(`Template with ID '${template.id}' already exists`);
    }

    this.templates.set(template.id, template);

    // Optionally save to filesystem
    // await this.saveTemplate(template);

    return true;
  }

  /**
   * Get variable definitions for a template
   * @param {string} templateId - Template identifier
   * @returns {Array} Variable definitions
   */
  getTemplateVariables(templateId) {
    const template = this.getTemplate(templateId);
    return template ? template.variables : [];
  }

  /**
   * Get default values for template variables
   * @param {string} templateId - Template identifier
   * @returns {Object} Default values
   */
  getDefaultVariables(templateId) {
    const variables = this.getTemplateVariables(templateId);
    const defaults = {};

    for (const variable of variables) {
      if (variable.default !== undefined) {
        defaults[variable.id] = variable.default;
      } else if (variable.type === 'date') {
        defaults[variable.id] = new Date().toISOString().split('T')[0];
      } else if (variable.type === 'select' && variable.options?.length > 0) {
        defaults[variable.id] = variable.options[0].value || variable.options[0];
      }
    }

    return defaults;
  }
}

module.exports = { TemplateEngine };
