const fs = require('fs/promises');
const path = require('path');

const TOOL_DOCS_DIR = path.join(__dirname);

const TOOL_SUPPORT = {
  'web-fetch': { status: 'stable', notes: ['Static HTTP/HTTPS fetch with retries and caching.'] },
  'web-search': { status: 'stable', notes: ['Perplexity-backed search is implemented.', 'Requires PERPLEXITY_API_KEY in the backend environment.'] },
  'web-scrape': { status: 'stable', notes: ['Supports static fetch and backend Chromium rendering for dynamic pages.'] },
  'security-scan': { status: 'stable', notes: ['Pattern-based source scanning for secrets and common issues.'] },
  'schema-generate': { status: 'stable', notes: ['Generates DDL, ORM schemas, and ER diagrams from entity specs.'] },
  'migration-create': { status: 'stable', notes: ['Builds SQL and framework migration output from schema diffs.'] },
  'architecture-design': { status: 'stable', notes: ['Design/planning output generator.'] },
  'uml-generate': { status: 'stable', notes: ['Mermaid/PlantUML output generator.'] },
  'api-design': { status: 'stable', notes: ['API contract/design output generator.'] },
  'ssh-execute': { status: 'requires_setup', notes: ['Requires SSH target credentials or cluster secret configuration.'] },
  'docker-exec': { status: 'requires_setup', notes: ['Requires Docker CLI/socket access in the backend runtime.'] },
  'code-sandbox': { status: 'requires_setup', notes: ['Requires Docker image pull/run capability in the backend runtime.'] },
  'tool-doc-read': { status: 'stable', notes: ['Reads detailed tool documentation from the backend docs directory on demand.'] },
};

function getToolDocPath(toolId) {
  return path.join(TOOL_DOCS_DIR, `${toolId}.md`);
}

async function hasToolDoc(toolId) {
  try {
    await fs.access(getToolDocPath(toolId));
    return true;
  } catch {
    return false;
  }
}

async function readToolDoc(toolId) {
  const docPath = getToolDocPath(toolId);
  const content = await fs.readFile(docPath, 'utf8');
  return {
    toolId,
    path: docPath,
    content,
  };
}

async function getToolDocMetadata(toolId) {
  const support = TOOL_SUPPORT[toolId] || { status: 'unknown', notes: [] };
  const docAvailable = await hasToolDoc(toolId);
  return {
    toolId,
    docAvailable,
    support,
  };
}

module.exports = {
  TOOL_SUPPORT,
  getToolDocPath,
  hasToolDoc,
  readToolDoc,
  getToolDocMetadata,
};
