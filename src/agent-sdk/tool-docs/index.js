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
    id: 'buildkit',
    label: 'BuildKit checks',
    profile: 'inspect',
    description: 'Check buildctl and the configured BuildKit endpoint before remote image build work.',
    command: 'command -v buildctl || true; test -n "$BUILDKIT_HOST" && buildctl --addr "$BUILDKIT_HOST" debug workers || true',
  },
  {
    id: 'direct-image-build',
    label: 'Direct image build',
    profile: 'build',
    description: 'Build and push an image from the remote workspace through the direct BuildKit runner.',
    command: 'image="${DIRECT_CLI_IMAGE_PREFIX:-ghcr.io/philly1084}/app:$(date +%Y%m%d%H%M%S)"; buildctl --addr "$BUILDKIT_HOST" build --frontend dockerfile.v0 --local context=. --local dockerfile=. --output type=image,name="$image",push=true && printf "IMAGE=%s\\n" "$image"',
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
  'design-resource-search': { status: 'stable', notes: ['Curated safe design-resource index for backgrounds, fonts, CSS styling, icons, and website/document creation assets.', 'Returns web-fetch-ready fetch plans and approved source domains.'] },
  'ssh-execute': { status: 'requires_setup', notes: ['Requires SSH target credentials or cluster secret configuration.'] },
  'remote-command': { status: 'requires_setup', notes: ['Requires SSH target credentials or cluster secret configuration.', 'Optimized for Ubuntu/Linux host and k3s cluster operations in this project.'] },
  'remote-cli-agent': { status: 'requires_setup', notes: ['Server-side OpenAI Agents SDK integration for the remote-cli Streamable HTTP MCP gateway.', 'Requires REMOTE_CLI_MCP_URL or GATEWAY_URL plus REMOTE_CLI_MCP_BEARER_TOKEN or N8N_API_KEY in the trusted backend runtime.'] },
  'k3s-deploy': { status: 'requires_setup', notes: ['Requires SSH target credentials and kubectl/git on the remote host.'] },
  'docker-exec': { status: 'requires_setup', notes: ['Requires explicit Docker CLI/socket access in the backend runtime; not part of the default remote host lane.'] },
  'code-sandbox': { status: 'requires_setup', notes: ['Execute mode requires Docker image pull/run capability in the backend runtime.', 'Project mode can persist previewable frontend bundles without Docker.'] },
  'git-safe': { status: 'requires_setup', notes: ['Requires a git repository in the backend-accessible filesystem and working git credentials for push.'] },
  'tool-doc-read': { status: 'stable', notes: ['Reads detailed tool documentation from the backend docs directory on demand.'] },
  'research-bucket-list': { status: 'stable', notes: ['Lists metadata from the shared durable research bucket without loading full file contents.'] },
  'research-bucket-search': { status: 'stable', notes: ['Searches bucket metadata and supported text files with grep-style matching.'] },
  'research-bucket-read': { status: 'stable', notes: ['Reads selected bucket files with byte limits; binary files require explicit base64 mode.'] },
  'research-bucket-write': { status: 'stable', notes: ['Creates or updates guarded files inside the shared research bucket and indexes supported assets.'] },
  'research-bucket-mkdir': { status: 'stable', notes: ['Creates guarded subfolders inside the shared research bucket.'] },
  'public-source-list': { status: 'stable', notes: ['Lists indexed public APIs, dashboards, news feeds, data portals, RSS feeds, downloads, and public web sources.'] },
  'public-source-search': { status: 'stable', notes: ['Searches the durable public source catalog by topic, domain, format, source kind, and notes.'] },
  'public-source-get': { status: 'stable', notes: ['Reads one public source catalog entry with endpoint, auth, freshness, and verification metadata.'] },
  'public-source-add': { status: 'stable', notes: ['Creates or updates public source catalog entries for later agent use.'] },
  'public-source-refresh': { status: 'stable', notes: ['Performs a lightweight URL verification and updates status, HTTP, content type, and inferred format metadata.'] },
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
  const normalizedToolId = String(toolId || '').trim();
  if (normalizedToolId.startsWith('research-bucket-')) {
    return path.join(TOOL_DOCS_DIR, 'research-bucket.md');
  }
  if (normalizedToolId.startsWith('public-source-')) {
    return path.join(TOOL_DOCS_DIR, 'public-source-index.md');
  }
  return path.join(TOOL_DOCS_DIR, `${normalizedToolId}.md`);
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
