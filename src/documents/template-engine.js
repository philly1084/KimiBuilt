/**
 * Template Engine - Manages document templates
 */

const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const { glob } = require('glob');

function normalizeFilterList(value = []) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim().toLowerCase())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => String(entry || '').trim().toLowerCase())
      .filter(Boolean);
  }

  return [];
}

function normalizeTemplateFilters(filters = {}) {
  if (typeof filters === 'string') {
    return {
      category: filters,
      useCases: [],
      intent: '',
      intents: [],
      format: '',
      packId: '',
      source: '',
      limit: null,
    };
  }

  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
    return {
      category: '',
      packId: '',
      useCase: '',
      useCases: [],
      intent: '',
      intents: [],
      format: '',
      source: '',
      limit: null,
    };
  }

  return {
    category: String(filters.category || '').trim(),
    packId: String(filters.packId || '').trim(),
    useCase: String(filters.useCase || '').trim(),
    useCases: normalizeFilterList(filters.useCases),
    intent: String(filters.intent || '').trim(),
    intents: normalizeFilterList(filters.intents),
    format: String(filters.format || '').trim(),
    source: String(filters.source || '').trim(),
    limit: filters.limit == null ? null : Math.max(1, Number(filters.limit) || 1),
  };
}

function normalizeTemplateUseCaseMatch(rawUseCases = []) {
  const candidates = normalizeFilterList(rawUseCases);
  if (!candidates.length) {
    return [];
  }

  return candidates;
}

function templateUseCaseMatches(template = {}, candidates = []) {
  if (!candidates.length) {
    return false;
  }

  const templateUseCases = normalizeTemplateUseCaseMatch(template.useCases || template.useCase);
  return candidates.some((candidate) => templateUseCases.some((entry) => (
    entry === candidate || entry.includes(candidate) || candidate.includes(entry)
  )));
}

function normalizeIntentFilter(value = '') {
  return String(value || '').trim().toLowerCase();
}

function templateIntentMatches(template = {}, candidates = []) {
  if (!candidates.length) {
    return false;
  }

  const templateIntent = normalizeIntentFilter(template.intent || template.outputIntent);
  if (templateIntent && candidates.includes(templateIntent)) {
    return true;
  }

  const templateUseCases = normalizeTemplateUseCaseMatch(template.useCases || template.useCase);
  return candidates.some((candidate) => templateUseCases.some((entry) => (
    entry.includes(candidate) || candidate.includes(entry)
  )));
}

function normalizeTemplateFormatList(value = []) {
  return Array.isArray(value) ? value.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean) : [];
}

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
      if (!template || typeof template !== 'object' || Array.isArray(template)) {
        console.warn(`[TemplateEngine] Ignoring invalid built-in template payload: ${file}`);
        continue;
      }

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
      if (!template || typeof template !== 'object' || Array.isArray(template) || !template.id) {
        continue;
      }

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
    const filterOptions = normalizeTemplateFilters(category);
    const templates = Array.from(this.templates.values());
    let filtered = templates;

    if (filterOptions.category) {
      filtered = filtered.filter((t) => t.category === filterOptions.category);
    }

    if (filterOptions.packId) {
      filtered = filtered.filter((t) => (
        String(t.packId || '').trim().toLowerCase() === filterOptions.packId.toLowerCase()
      ));
    }

    if (filterOptions.useCase) {
      const normalizedUseCase = filterOptions.useCase.toLowerCase();
      filterOptions.useCases = Array.from(new Set([...filterOptions.useCases, normalizedUseCase]));
    }

    const normalizedUseCases = normalizeTemplateUseCaseMatch(filterOptions.useCases);
    if (normalizedUseCases.length > 0) {
      filtered = filtered.filter((t) => (
        templateUseCaseMatches(t, normalizedUseCases)
      ));
    }

    if (filterOptions.intent) {
      const normalizedIntent = normalizeIntentFilter(filterOptions.intent);
      filterOptions.intents = Array.from(new Set([...filterOptions.intents, normalizedIntent]));
    }

    const normalizedIntents = filterOptions.intents
      .map((entry) => normalizeIntentFilter(entry))
      .filter(Boolean);
    if (normalizedIntents.length > 0) {
      filtered = filtered.filter((t) => (
        templateIntentMatches(t, normalizedIntents)
      ));
    }

    if (filterOptions.source) {
      const normalizedSource = filterOptions.source.toLowerCase();
      filtered = filtered.filter((template) => String(template.source || 'built-in').toLowerCase() === normalizedSource);
    }

    if (filterOptions.format) {
      const normalizedFormat = filterOptions.format.toLowerCase();
      filtered = filtered.filter((template) => (
        normalizeTemplateFormatList(template.formats).includes(normalizedFormat)
        || normalizeTemplateFormatList(template.recommendedFormats).includes(normalizedFormat)
      ));
    }

    if (filterOptions.limit != null) {
      return filtered.slice(0, filterOptions.limit);
    }

    return filtered;
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

    if (!Array.isArray(template.variables) && (!template.variables || typeof template.variables !== 'object')) {
      console.error('[TemplateEngine] Template variables must be an array or an object map');
      return false;
    }

    if (!Array.isArray(template.formats)) {
      console.error('[TemplateEngine] Template formats must be an array');
      return false;
    }

    if (template.requiredVariables) {
      const requiredVariableContract = this.validateRequiredVariableContract(template, template.requiredVariables);
      if (!requiredVariableContract.valid) {
        console.error(`[TemplateEngine] Template requiredVariables invalid: ${requiredVariableContract.reason}`);
        return false;
      }
    }

    return true;
  }

  validateRequiredVariableContract(template = {}, requiredVariables = []) {
    const normalizedTemplate = template || {};
    const normalizedIds = Array.isArray(requiredVariables)
      ? requiredVariables
          .map((entry) => {
            if (typeof entry === 'string') {
              return String(entry || '').trim();
            }

            if (entry && typeof entry === 'object') {
              return String(entry.id || entry.name || '').trim();
            }

            return '';
          })
          .filter(Boolean)
      : [];

    if (normalizedIds.length === 0) {
      return { valid: true };
    }

    const availableVariables = this.getTemplateVariables(normalizedTemplate.id || normalizedTemplate)
      .map((entry) => String(entry?.id || '').trim())
      .filter(Boolean);
    const availableSet = new Set(availableVariables);
    const missing = normalizedIds.filter((variableId) => !availableSet.has(variableId));

    if (missing.length > 0) {
      return {
        valid: false,
        reason: `Template ${String(normalizedTemplate.id || '').trim() || '[unknown]'} requires missing variables: ${missing.join(', ')}`,
      };
    }

    return { valid: true };
  }

  getRequiredVariableDefinitions(template = {}) {
    const variables = this.getTemplateVariables(template.id || template);
    if (!Array.isArray(variables) || variables.length === 0) {
      return [];
    }

    return variables
      .filter((entry) => entry && entry.required === true && String(entry.id || '').trim())
      .map((entry) => String(entry.id).trim())
      .filter(Boolean);
  }

  validateTemplateVariableRequirements(template = {}, values = {}) {
    const requiredVariables = Array.isArray(template.requiredVariables)
      ? template.requiredVariables.map((entry) => String(entry || '').trim()).filter(Boolean)
      : this.getRequiredVariableDefinitions(template);

    const available = (typeof values === 'object' && values !== null) ? values : {};
    const missing = requiredVariables.filter((id) => {
      const value = available[id];
      if (value === undefined || value === null) {
        return true;
      }

      if (Array.isArray(value)) {
        return value.length === 0;
      }

      if (typeof value === 'string') {
        return String(value).trim() === '';
      }

      return false;
    });

    return {
      valid: missing.length === 0,
      missing,
    };
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
    const rawVariables = template ? template.variables : [];

    if (Array.isArray(rawVariables)) {
      return rawVariables;
    }

    if (rawVariables && typeof rawVariables === 'object') {
      return Object.entries(rawVariables).map(([id, variable]) => ({
        id,
        ...(variable || {}),
      }));
    }

    return [];
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
