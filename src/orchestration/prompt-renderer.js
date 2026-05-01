const { normalizeIssue } = require('./symphony');

const DEFAULT_PROMPT = 'You are working on an issue from Linear.';
const ALLOWED_FILTERS = new Set(['default', 'json']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolvePath(context = {}, expression = '') {
  const parts = String(expression || '').trim().split('.').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    throwTemplateError('template_render_error', 'Empty template expression.');
  }
  let current = context;
  for (const part of parts) {
    if (!isPlainObject(current) && !Array.isArray(current)) {
      throwTemplateError('template_render_error', `Unknown template variable: ${expression}`);
    }
    if (!Object.prototype.hasOwnProperty.call(current, part)) {
      throwTemplateError('template_render_error', `Unknown template variable: ${expression}`);
    }
    current = current[part];
  }
  return current;
}

function parseFilter(rawFilter = '') {
  const trimmed = String(rawFilter || '').trim();
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)(?::\s*(.*))?$/);
  if (!match) {
    throwTemplateError('template_parse_error', `Invalid template filter: ${rawFilter}`);
  }
  const [, name, rawArg = ''] = match;
  if (!ALLOWED_FILTERS.has(name)) {
    throwTemplateError('template_render_error', `Unknown template filter: ${name}`);
  }
  return {
    name,
    arg: parseFilterArg(rawArg),
  };
}

function parseFilterArg(value = '') {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return undefined;
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'null') {
    return null;
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

function applyFilter(value, filter = {}) {
  if (filter.name === 'default') {
    return value == null || value === '' ? filter.arg : value;
  }
  if (filter.name === 'json') {
    return JSON.stringify(value);
  }
  throwTemplateError('template_render_error', `Unknown template filter: ${filter.name}`);
}

function stringifyTemplateValue(value) {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function throwTemplateError(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function renderPromptTemplate(template = '', {
  issue = {},
  attempt = null,
} = {}) {
  const source = String(template || '').trim() || DEFAULT_PROMPT;
  const context = {
    issue: normalizeIssue(issue),
    attempt,
  };

  return source.replace(/{{\s*([^{}]+?)\s*}}/g, (_match, expression) => {
    const segments = String(expression || '').split('|').map((segment) => segment.trim()).filter(Boolean);
    if (segments.length === 0) {
      throwTemplateError('template_parse_error', 'Empty template expression.');
    }
    let value = resolvePath(context, segments[0]);
    for (const rawFilter of segments.slice(1)) {
      value = applyFilter(value, parseFilter(rawFilter));
    }
    return stringifyTemplateValue(value);
  });
}

module.exports = {
  DEFAULT_PROMPT,
  renderPromptTemplate,
};
