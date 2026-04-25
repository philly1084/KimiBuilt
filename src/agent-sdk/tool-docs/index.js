const fs = require('fs/promises');
const path = require('path');
const { getRuntimeSupport } = require('./runtime-support');

const TOOL_DOCS_DIR = path.join(__dirname);

const REMOTE_CLI_COMMAND_CATALOG = Object.freeze([
  {
    id: 'baseline',
    label: 'Remote baseline',
    profile: 'inspect',
    description: 'Confirm host identity, user, CPU architecture, OS, and uptime.',
    command: 'hostname && whoami && uname -m && (test -f /etc/os-release && sed -n "1,6p" /etc/os-release || true) && uptime',
  },
  {
    id: 'repo-inspect',
    label: 'Repository inspect',
    profile: 'inspect',
    description: 'Inspect the current workspace, nearby files, package scripts, and git status.',
    command: 'pwd && find . -maxdepth 2 -type f | sort | head -n 120 && (test -d .git && git status --short --branch || true)',
  },
  {
    id: 'file-search',
    label: 'File search',
    profile: 'inspect',
    description: 'Search remote files with portable find/grep patterns; do not assume rg exists.',
    command: 'find . -maxdepth 4 -type f | sort | head -n 200',
  },
  {
    id: 'build',
    label: 'Build project',
    profile: 'build',
    description: 'Run the project build command discovered from the repository.',
    command: 'if [ -f package.json ]; then npm install && npm run build; else echo "No package.json build target found"; fi',
  },
  {
    id: 'test',
    label: 'Run tests',
    profile: 'build',
    description: 'Run the focused or project test command discovered from the repository.',
    command: 'if [ -f package.json ]; then npm test; else echo "No package.json test target found"; fi',
  },
  {
    id: 'docker-buildkit',
    label: 'Docker and BuildKit checks',
    profile: 'inspect',
    description: 'Check Docker and BuildKit availability before remote image build work.',
    command: 'docker info 2>/dev/null | sed -n "1,80p" || true; docker buildx ls 2>/dev/null || true',
  },
  {
    id: 'kubectl-inspect',
    label: 'Kubernetes inspect',
    profile: 'inspect',
    description: 'Inspect k3s nodes, workloads, services, ingress, and pods.',
    command: 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml; kubectl get nodes -o wide && kubectl get pods -A -o wide',
  },
  {
    id: 'logs',
    label: 'Deployment logs',
    profile: 'inspect',
    description: 'Read Kubernetes logs for the target workload.',
    command: 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml; kubectl logs deployment/backend -n kimibuilt --all-containers=true --tail=200',
  },
  {
    id: 'rollout',
    label: 'Rollout status',
    profile: 'deploy',
    description: 'Check rollout and availability conditions for a deployment.',
    command: 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml; kubectl rollout status deployment/backend -n kimibuilt --timeout=180s',
  },
  {
    id: 'https-verify',
    label: 'HTTPS verify',
    profile: 'inspect',
    description: 'Verify DNS and public HTTPS for the deployed domain.',
    command: 'host=demoserver2.buzz; getent ahosts "$host" || true; curl -fsSIL --max-time 20 "https://$host"',
  },
]);

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
  'graph-diagram': { status: 'stable', notes: ['Batch graph/diagram utility with native graph JSON, Mermaid, DOT, SVG, HTML, and persisted SVG image artifacts.', 'When GPT-5.5 or newer is the caller model, prefer direct SVG output for custom document visuals.'] },
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
  REMOTE_CLI_COMMAND_CATALOG,
  TOOL_SUPPORT,
  getToolDocPath,
  hasToolDoc,
  readToolDoc,
  getToolDocMetadata,
};
