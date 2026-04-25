const fs = require('fs/promises');
const path = require('path');
const { getRuntimeSupport } = require('./runtime-support');

const TOOL_DOCS_DIR = path.join(__dirname);

const TOOL_SUPPORT = {
  'web-fetch': { status: 'stable', notes: ['Static HTTP/HTTPS fetch with retries and caching.'] },
  'web-search': { status: 'stable', notes: ['Perplexity-backed raw search and preset research modes are implemented.', 'Requires PERPLEXITY_API_KEY in the backend environment.'] },
  'web-scrape': { status: 'stable', notes: ['Supports static fetch and backend Chromium rendering for dynamic pages.'] },
  'security-scan': { status: 'stable', notes: ['Pattern-based source scanning for secrets and common issues.'] },
  'schema-generate': { status: 'stable', notes: ['Generates DDL, ORM schemas, and ER diagrams from entity specs.'] },
  'migration-create': { status: 'stable', notes: ['Builds SQL and framework migration output from schema diffs.'] },
  'architecture-design': { status: 'stable', notes: ['Design/planning output generator.'] },
  'uml-generate': { status: 'stable', notes: ['Mermaid/PlantUML output generator.'] },
  'api-design': { status: 'stable', notes: ['API contract/design output generator.'] },
  'ssh-execute': { status: 'requires_setup', notes: ['Requires SSH target credentials or cluster secret configuration.'] },
  'remote-command': { status: 'requires_setup', notes: ['Requires SSH target credentials or cluster secret configuration.', 'Optimized for Ubuntu/Linux host and k3s cluster operations in this project.'] },
  'k3s-deploy': { status: 'requires_setup', notes: ['Requires SSH target credentials and kubectl/git on the remote host.'] },
  'managed-app': { status: 'requires_setup', notes: ['Requires Postgres persistence, external Gitea credentials, and SSH access to the remote k3s host for deployment.'] },
  'docker-exec': { status: 'requires_setup', notes: ['Requires Docker CLI/socket access in the backend runtime.'] },
  'code-sandbox': { status: 'requires_setup', notes: ['Execute mode requires Docker image pull/run capability in the backend runtime.', 'Project mode can persist previewable frontend bundles without Docker.'] },
  'git-safe': { status: 'requires_setup', notes: ['Requires a git repository in the backend-accessible filesystem and working git credentials for push.'] },
  'tool-doc-read': { status: 'stable', notes: ['Reads detailed tool documentation from the backend docs directory on demand.'] },
  'podcast': {
    status: 'stable',
    notes: [
      'Runs researched two-host podcast generation with Piper voice synthesis and WAV stitching.',
      'Supports optional ffmpeg-backed MP3 export plus intro/outro/music-bed mixing when audio processing is configured.',
      'Supports host voice pools (`hostAVoiceIds`, `hostBVoiceIds`) with automatic cycling through each host’s configured voices.',
      'Requires an active chat session plus working OpenAI, Piper, and web research configuration.',
    ],
  },
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
  const staticSupport = TOOL_SUPPORT[toolId] || { status: 'unknown', notes: [] };
  const runtimeSupport = await getRuntimeSupport(toolId);
  const support = runtimeSupport
    ? {
        status: runtimeSupport.status,
        notes: [...new Set([...(staticSupport.notes || []), ...(runtimeSupport.notes || [])])],
        runtime: runtimeSupport.runtime || null,
      }
    : staticSupport;
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
