/**
 * Agent SDK Tools - Main Entry Point
 * Loads and registers all tool categories
 */

const { getUnifiedRegistry } = require('../registry/UnifiedRegistry');
const { getAgentBus } = require('../agents/AgentBus');
const { readToolDoc, getToolDocMetadata } = require('../tool-docs');
const { generateImage } = require('../../openai-client');
const { searchImages, isConfigured: isUnsplashConfigured } = require('../../unsplash-client');
const { persistGeneratedImages } = require('../../generated-image-artifacts');
const {
  hasSchedulingCue,
  summarizeTrigger,
} = require('../../workloads/natural-language');
const {
  buildCanonicalWorkloadPayload,
  extractWorkloadScenarioSource,
} = require('../../workloads/request-builder');

// Tool categories
const { registerWebTools } = require('./categories/web');
const { registerDesignTools } = require('./categories/design');
const { registerDatabaseTools } = require('./categories/database');
const { registerSandboxTools } = require('./categories/sandbox');
// SSH tools
const { SSHExecuteTool } = require('./categories/ssh/SSHExecuteTool');
const { DockerExecTool } = require('./categories/ssh/DockerExecTool');
const { K3sDeployTool } = require('./categories/ssh/K3sDeployTool');
const { GitLocalTool } = require('./categories/system/GitLocalTool');

function normalizeCandidateUrl(value = '') {
  let candidate = String(value || '').trim();
  if (!candidate) {
    throw new Error('Image URL is required.');
  }

  const markdownMatch = candidate.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)|\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i);
  if (markdownMatch) {
    candidate = markdownMatch[1] || markdownMatch[2] || candidate;
  }

  const bracketMatch = candidate.match(/<(https?:\/\/[^>\s]+)>/i);
  if (bracketMatch?.[1]) {
    candidate = bracketMatch[1];
  }

  const plainUrlMatch = candidate.match(/https?:\/\/\S+/i);
  if (plainUrlMatch?.[0]) {
    candidate = plainUrlMatch[0];
  }

  while (/[),.;!?'"`\]]$/.test(candidate)) {
    const next = candidate.slice(0, -1);
    if (!next) break;
    candidate = next;
  }

  return candidate;
}

function deriveImageAltText(urlString = '', fallback = 'image') {
  try {
    const parsed = new URL(urlString);
    const fileName = parsed.pathname.split('/').pop() || '';
    const normalized = fileName
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[-_]+/g, ' ')
      .trim();

    return normalized || fallback;
  } catch (_error) {
    return fallback;
  }
}

function normalizeInlineFileContent(value) {
  if (value == null) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value) || typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch (_error) {
      return String(value);
    }
  }

  return String(value);
}

function normalizeFileWriteParams(params = {}) {
  const normalized = params && typeof params === 'object'
    ? { ...params }
    : {};
  const pathCandidates = [
    normalized.path,
    normalized.filePath,
    normalized.filepath,
    normalized.filename,
    normalized.targetPath,
    normalized.destination,
  ];
  const resolvedPath = pathCandidates.find((value) => typeof value === 'string' && value.trim());
  if (resolvedPath) {
    normalized.path = resolvedPath.trim();
  }

  if (!Object.prototype.hasOwnProperty.call(normalized, 'content')) {
    const contentCandidates = [
      normalized.contents,
      normalized.text,
      normalized.body,
      normalized.data,
      normalized.html,
      normalized.source,
      normalized.code,
      normalized.markdown,
      normalized.fileContent,
    ];
    const resolvedContent = contentCandidates
      .map((value) => normalizeInlineFileContent(value))
      .find((value) => typeof value === 'string');

    if (typeof resolvedContent === 'string') {
      normalized.content = resolvedContent;
    }
  } else {
    normalized.content = normalizeInlineFileContent(normalized.content);
  }

  return normalized;
}

function normalizeWorkloadAction(value = '') {
  return String(value || '').trim().toLowerCase() || 'create_from_scenario';
}

function resolveSessionWorkloadService(context = {}) {
  const service = context?.workloadService || null;
  if (!service?.isAvailable?.()) {
    throw new Error('Deferred workloads are unavailable. This feature requires an active Postgres-backed session store.');
  }

  const ownerId = String(context?.ownerId || '').trim();
  const sessionId = String(context?.sessionId || '').trim();
  if (!ownerId) {
    throw new Error('Deferred workloads require an authenticated owner context.');
  }
  if (!sessionId) {
    throw new Error('Deferred workloads require an active session context.');
  }

  return {
    service,
    ownerId,
    sessionId,
  };
}

function hasExplicitManualWorkloadIntent(text = '') {
  const normalized = String(text || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return [
    /\bmanual\b/,
    /\bon[- ]demand\b/,
    /\bwhen i (?:run|trigger|start|launch) it\b/,
    /\bi(?:'d| would)? trigger it\b/,
    /\bdo not schedule\b/,
    /\bdon't schedule\b/,
    /\bwithout scheduling\b/,
    /\bnot scheduled\b/,
    /\bunscheduled\b/,
  ].some((pattern) => pattern.test(normalized));
}

function extractScenarioSource(params = {}) {
  return extractWorkloadScenarioSource(params);
}

function assertWorkloadSchedulingIntent(params = {}, context = {}) {
  const scenarioSource = extractScenarioSource(params);
  const triggerType = String(params.trigger?.type || '').trim().toLowerCase();
  const explicitManual = hasExplicitManualWorkloadIntent(scenarioSource);

  if (triggerType === 'cron' || triggerType === 'once') {
    return;
  }

  if (triggerType === 'manual') {
    if (!explicitManual) {
      throw new Error('Manual workload creation needs an explicit manual request. Add a time or recurrence for scheduled work.');
    }
    return;
  }

  if (hasSchedulingCue(scenarioSource)) {
    return;
  }

  if (explicitManual) {
    return;
  }

  throw new Error('Workload creation needs a schedule. Specify when it should run, or explicitly say it should be manual.');
}

function buildNormalizedWorkloadPayload(params = {}, context = {}, session = null) {
  const canonical = buildCanonicalWorkloadPayload(params, {
    session,
    timezone: params.timezone || context?.timezone,
    now: params.now || context?.now,
  });

  return canonical || null;
}

class ToolManager {
  constructor() {
    this.registry = getUnifiedRegistry();
    this.agentBus = getAgentBus();
    this.loadedTools = new Map();
    this.initialized = false;
  }

  /**
   * Initialize all tools
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    console.log('[ToolManager] Initializing tools...');

    // Register web tools
    this.registerWebTools();
    
    // Register SSH tools
    this.registerSSHTools();
    
    // Register design tools
    this.registerDesignTools();
    
    // Register database tools
    this.registerDatabaseTools();
    
    // Register sandbox tools
    this.registerSandboxTools();
    
    // Register system tools
    this.registerSystemTools();

    // Set up event listeners
    this.setupEventListeners();

    this.initialized = true;
    
    console.log(`[ToolManager] Initialized ${this.registry.getAllTools().length} tools`);
    
    return this;
  }

  /**
   * Register web scraping tools
   */
  registerWebTools() {
    try {
      const tools = registerWebTools();
      tools.forEach(tool => {
        this.loadedTools.set(tool.id, tool);
      });
      console.log('[ToolManager] Web tools registered');
    } catch (error) {
      console.error('[ToolManager] Failed to register web tools:', error.message);
    }
  }

  /**
   * Register SSH/remote tools
   */
  registerSSHTools() {
    try {
      const tools = [
        new SSHExecuteTool(),
        new SSHExecuteTool({
          id: 'remote-command',
          name: 'Remote Command',
          description: 'Execute remote server commands over SSH',
        }),
        new DockerExecTool(),
        new K3sDeployTool(),
      ];

      tools.forEach(tool => {
        const definition = this.createToolDefinition(tool, {
          frontend: {
            exposeToFrontend: tool.id !== 'ssh-execute',
            icon: 'terminal',
            requiresSetup: true // SSH needs key configuration
          },
          skill: {
            triggerPatterns: this.getSSHTriggerPatterns(tool.id),
            requiresConfirmation: true
          }
        });
        
        this.registry.register(definition);
        this.loadedTools.set(tool.id, tool);
      });

      console.log('[ToolManager] SSH tools registered');
    } catch (error) {
      console.error('[ToolManager] Failed to register SSH tools:', error.message);
    }
  }

  /**
   * Register design tools
   */
  registerDesignTools() {
    try {
      const tools = registerDesignTools();
      tools.forEach(tool => {
        this.loadedTools.set(tool.id, tool);
      });
      console.log('[ToolManager] Design tools registered');
    } catch (error) {
      console.error('[ToolManager] Failed to register design tools:', error.message);
    }
  }

  /**
   * Register database tools
   */
  registerDatabaseTools() {
    try {
      const tools = registerDatabaseTools();
      tools.forEach(tool => {
        this.loadedTools.set(tool.id, tool);
      });
      console.log('[ToolManager] Database tools registered');
    } catch (error) {
      console.error('[ToolManager] Failed to register database tools:', error.message);
    }
  }

  /**
   * Register sandbox tools
   */
  registerSandboxTools() {
    try {
      const tools = registerSandboxTools();
      tools.forEach(tool => {
        this.loadedTools.set(tool.id, tool);
      });
      console.log('[ToolManager] Sandbox tools registered');
    } catch (error) {
      console.error('[ToolManager] Failed to register sandbox tools:', error.message);
    }
  }

  /**
   * Register system tools
   */
  registerSystemTools() {
    // File system tools
    const fileTools = [
      {
        id: 'file-read',
        name: 'File Reader',
        category: 'system',
        description: 'Read file contents',
        backend: {
          handler: async (params) => {
            const fs = require('fs').promises;
            const content = await fs.readFile(params.path, 'utf8');
            return { content, path: params.path };
          },
          sideEffects: ['read'],
          timeout: 10000
        },
        inputSchema: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string' },
            encoding: { type: 'string', default: 'utf8' }
          }
        }
      },
      {
        id: 'file-write',
        name: 'File Writer',
        category: 'system',
        description: 'Write a full content string to a local runtime file. Requires both path and content in the same call.',
        backend: {
          handler: async (params) => {
            const path = require('path');
            const fs = require('fs').promises;
            const normalized = normalizeFileWriteParams(params);

            if (typeof normalized.path !== 'string' || !normalized.path.trim()) {
              throw new Error('file-write requires a non-empty `path` string.');
            }

            if (!Object.prototype.hasOwnProperty.call(normalized, 'content')) {
              throw new Error('file-write requires a `content` string. Provide the full file body in `content`; a path alone is not enough.');
            }

            if (typeof normalized.content !== 'string') {
              throw new Error('file-write `content` must be a string.');
            }

            const targetPath = path.resolve(normalized.path);
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.writeFile(targetPath, normalized.content, normalized.encoding || 'utf8');
            return {
              path: targetPath,
              bytesWritten: Buffer.byteLength(normalized.content, normalized.encoding || 'utf8'),
            };
          },
          sideEffects: ['write'],
          timeout: 10000
        },
        inputSchema: {
          type: 'object',
          required: ['path', 'content'],
          properties: {
            path: {
              type: 'string',
              description: 'Local file path in this runtime. For remote hosts or container-only paths, use remote-command or docker-exec instead.'
            },
            content: {
              type: 'string',
              description: 'Full file contents to write in this same call.'
            },
            encoding: {
              type: 'string',
              default: 'utf8'
            }
          }
        }
      },
      {
        id: 'file-search',
        name: 'File Search',
        category: 'system',
        description: 'Search for files by pattern',
        backend: {
          handler: async (params) => {
            const { glob } = require('glob');
            const files = await glob(params.pattern, { cwd: params.cwd });
            return { files, pattern: params.pattern };
          },
          sideEffects: ['read'],
          timeout: 30000
        },
        inputSchema: {
          type: 'object',
          required: ['pattern'],
          properties: {
            pattern: { type: 'string' },
            cwd: { type: 'string' }
          }
        }
      },
      {
        id: 'file-mkdir',
        name: 'Directory Creator',
        category: 'system',
        description: 'Create a folder or directory',
        backend: {
          handler: async (params) => {
            const path = require('path');
            const fs = require('fs').promises;
            const targetPath = path.resolve(params.path);
            await fs.mkdir(targetPath, { recursive: params.recursive !== false });
            return { path: targetPath, created: true };
          },
          sideEffects: ['write'],
          timeout: 10000
        },
        inputSchema: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string' },
            recursive: { type: 'boolean', default: true }
          }
        },
        skill: {
          triggerPatterns: ['create folder', 'create directory', 'make folder', 'make directory', 'mkdir'],
          requiresConfirmation: false
        }
      }
    ];

    // Code execution tools
    const codeTools = [
      {
        id: 'code-execute',
        name: 'Code Executor',
        category: 'system',
        description: 'Execute code in sandboxed environment',
        backend: {
          handler: async (params) => {
            // Would use sandboxed execution
            return { 
              note: 'Sandboxed execution not implemented',
              language: params.language,
              code: params.code.substring(0, 100) + '...'
            };
          },
          sideEffects: ['execute'],
          sandbox: { network: false, filesystem: 'readonly' },
          timeout: 30000
        },
        inputSchema: {
          type: 'object',
          required: ['language', 'code'],
          properties: {
            language: { 
              type: 'string',
              enum: ['javascript', 'python', 'bash', 'sql']
            },
            code: { type: 'string' },
            timeout: { type: 'integer', default: 30000 }
          }
        },
        skill: {
          triggerPatterns: ['run code', 'execute', 'run script', 'test code'],
          requiresConfirmation: true
        },
        frontend: {
          exposeToFrontend: false,
          icon: 'code',
          uiComponent: 'CodeExecutorPanel'
        }
      }
    ];

    const docsTools = [
      {
        id: 'tool-doc-read',
        name: 'Tool Doc Reader',
        category: 'system',
        description: 'Load detailed tool documentation only when explicitly requested',
        backend: {
          handler: async (params) => {
            const metadata = await getToolDocMetadata(params.toolId);
            if (!metadata.docAvailable) {
              throw new Error(`No documentation found for tool '${params.toolId}'`);
            }

            const doc = await readToolDoc(params.toolId);
            return {
              toolId: params.toolId,
              support: metadata.support,
              content: doc.content,
            };
          },
          sideEffects: ['read'],
          timeout: 10000
        },
        inputSchema: {
          type: 'object',
          required: ['toolId'],
          properties: {
            toolId: { type: 'string', description: 'Tool ID to load documentation for' }
          }
        },
        skill: {
          triggerPatterns: ['tool help', 'tool documentation', 'how do i use tool', 'what can this tool do'],
          requiresConfirmation: false
        },
        frontend: {
          exposeToFrontend: false,
          icon: 'book-open'
        }
      }
    ];

    const mediaTools = [
      {
        id: 'image-generate',
        name: 'Image Generator',
        category: 'system',
        description: 'Generate one or more images from a prompt and return hosted image URLs',
        backend: {
          handler: async (params, context = {}) => {
            const response = await generateImage({
              prompt: params.prompt,
              model: params.model || null,
              size: params.size || '1536x1024',
              quality: params.quality || 'standard',
              style: params.style || 'vivid',
              n: Math.min(Math.max(params.n || 1, 1), 4),
            });
            const persistedImages = await persistGeneratedImages({
              sessionId: context?.sessionId || '',
              sourceMode: 'chat',
              prompt: params.prompt,
              model: response.model || params.model || null,
              images: response.data || [],
            });

            const images = (persistedImages.images || []).map((image, index) => ({
              url: image.url,
              b64_json: image.b64_json,
              revisedPrompt: image.revised_prompt,
              artifactId: image.artifactId || null,
              downloadUrl: image.downloadUrl || null,
              inlinePath: image.inlinePath || null,
              alt: params.alt || `${params.prompt} ${index + 1}`.trim(),
            }));

            return {
              source: 'generated',
              prompt: params.prompt,
              model: response.model,
              images,
              artifacts: persistedImages.artifacts || [],
              markdownImages: images
                .filter((image) => image.url)
                .map((image) => `![${image.alt}](${image.url})`),
            };
          },
          sideEffects: ['network'],
          timeout: 60000,
        },
        inputSchema: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string' },
            alt: { type: 'string' },
            model: { type: 'string' },
            size: { type: 'string' },
            quality: { type: 'string' },
            style: { type: 'string' },
            n: { type: 'integer', minimum: 1, maximum: 4 },
          },
        },
        skill: {
          triggerPatterns: ['generate image', 'make an image', 'create image', 'hero image', 'illustration'],
          requiresConfirmation: false,
        },
        frontend: {
          exposeToFrontend: true,
          icon: 'image',
        },
      },
      {
        id: 'image-search-unsplash',
        name: 'Unsplash Image Search',
        category: 'system',
        description: 'Search Unsplash for reference or stock images and return image URLs with attribution',
        backend: {
          handler: async (params) => {
            if (!isUnsplashConfigured()) {
              throw new Error('Unsplash integration is not configured. Set UNSPLASH_ACCESS_KEY.');
            }

            const results = await searchImages(params.query, {
              page: params.page || 1,
              perPage: Math.min(Math.max(params.perPage || 6, 1), 12),
              orientation: params.orientation,
            });

            const images = (results.results || []).map((image) => ({
              id: image.id,
              url: image.urls?.regular || image.urls?.full || image.urls?.small,
              thumbUrl: image.urls?.thumb || image.urls?.small,
              alt: image.altDescription || image.description || params.query,
              author: image.author?.name || image.user?.name || '',
              authorLink: image.author?.link || image.user?.links?.html || '',
              unsplashLink: image.links?.html || '',
            }));

            return {
              source: 'unsplash',
              query: params.query,
              total: results.total,
              totalPages: results.totalPages,
              images,
              markdownImages: images
                .filter((image) => image.url)
                .map((image) => `![${image.alt}](${image.url})`),
            };
          },
          sideEffects: ['network'],
          timeout: 30000,
        },
        inputSchema: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string' },
            page: { type: 'integer', minimum: 1 },
            perPage: { type: 'integer', minimum: 1, maximum: 12 },
            orientation: { type: 'string', enum: ['landscape', 'portrait', 'squarish'] },
          },
        },
        skill: {
          triggerPatterns: ['unsplash', 'stock photo', 'reference image', 'image search', 'photo search'],
          requiresConfirmation: false,
        },
        frontend: {
          exposeToFrontend: true,
          icon: 'image-plus',
        },
      },
      {
        id: 'image-from-url',
        name: 'Image URL Reference',
        category: 'system',
        description: 'Validate and normalize a direct image URL so it can be embedded in the final output',
        backend: {
          handler: async (params) => {
            const normalizedUrl = normalizeCandidateUrl(params.url);
            const parsed = new URL(normalizedUrl);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
              throw new Error('Only http and https image URLs are supported.');
            }

            const alt = params.alt || deriveImageAltText(parsed.toString(), 'image');
            return {
              source: 'url',
              image: {
                url: parsed.toString(),
                alt,
                title: params.title || '',
                host: parsed.host,
              },
              normalizedUrl: parsed.toString(),
              markdownImage: `![${alt}](${parsed.toString()})`,
            };
          },
          sideEffects: ['read'],
          timeout: 5000,
        },
        inputSchema: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string' },
            alt: { type: 'string' },
            title: { type: 'string' },
          },
        },
        skill: {
          triggerPatterns: ['image url', 'use this image', 'embed image', 'reference image url'],
          requiresConfirmation: false,
        },
        frontend: {
          exposeToFrontend: true,
          icon: 'link',
        },
      },
    ];

    const workloadTools = [
      {
        id: 'agent-workload',
        name: 'Agent Workload Manager',
        category: 'system',
        description: 'Create and manage deferred agent workloads for later, recurring, and follow-up work tied to the current conversation session. For scheduled requests, pass the full user request and let the runtime extract the schedule and remote command details.',
        backend: {
          handler: async (params = {}, context = {}) => {
            const { service, ownerId, sessionId } = resolveSessionWorkloadService(context);
            const action = normalizeWorkloadAction(params.action);

            if (action === 'list') {
              const workloads = await service.listSessionWorkloads(sessionId, ownerId);
              return {
                action,
                sessionId,
                count: workloads.length,
                workloads,
              };
            }

            if (action === 'create_from_scenario') {
              const request = String(params.request || params.scenario || params.description || '').trim();
              const session = service.sessionStore?.getOwned
                ? await service.sessionStore.getOwned(sessionId, ownerId)
                : null;
              const normalized = buildNormalizedWorkloadPayload({
                ...params,
                ...(request ? { request } : {}),
              }, context, session);
              if (!normalized) {
                throw new Error('agent-workload create_from_scenario requires a `request` string or a structured workload payload.');
              }

              assertWorkloadSchedulingIntent(normalized.payload, context);

              const workload = await service.createWorkload({
                ...normalized.payload,
                sessionId,
              }, ownerId);

              return {
                action,
                sessionId,
                workload,
                scenario: normalized.scenario,
                message: `${workload.title} created. ${summarizeTrigger(workload.trigger || {})}.`,
              };
            }

            if (action === 'create') {
              const session = service.sessionStore?.getOwned
                ? await service.sessionStore.getOwned(sessionId, ownerId)
                : null;
              const normalized = buildNormalizedWorkloadPayload(params, context, session);
              const payload = normalized?.payload || params;
              assertWorkloadSchedulingIntent(payload, context);
              const workload = await service.createWorkload({
                ...payload,
                sessionId,
              }, ownerId);
              return {
                action,
                sessionId,
                workload,
                message: `${workload.title} created. ${summarizeTrigger(workload.trigger || {})}.`,
              };
            }

            if (action === 'run_now') {
              const run = await service.runWorkloadNow(
                params.idOrSlug || params.workloadId || params.callableSlug || '',
                ownerId,
                {
                  reason: 'manual',
                  metadata: params.metadata || {},
                },
              );
              if (!run) {
                throw new Error('Workload not found.');
              }

              return {
                action,
                sessionId,
                run,
                message: `Queued workload run ${run.id} for immediate execution.`,
              };
            }

            if (action === 'pause') {
              const workload = await service.pauseWorkload(
                params.idOrSlug || params.workloadId || params.callableSlug || '',
                ownerId,
              );
              if (!workload) {
                throw new Error('Workload not found.');
              }

              return {
                action,
                sessionId,
                workload,
                message: `${workload.title} paused.`,
              };
            }

            if (action === 'resume') {
              const workload = await service.resumeWorkload(
                params.idOrSlug || params.workloadId || params.callableSlug || '',
                ownerId,
              );
              if (!workload) {
                throw new Error('Workload not found.');
              }

              return {
                action,
                sessionId,
                workload,
                message: `${workload.title} resumed.`,
              };
            }

            if (action === 'delete') {
              const deleted = await service.deleteWorkload(
                params.idOrSlug || params.workloadId || params.callableSlug || '',
                ownerId,
              );
              if (!deleted) {
                throw new Error('Workload not found.');
              }

              return {
                action,
                sessionId,
                deleted: true,
                message: 'Workload deleted.',
              };
            }

            if (action === 'list_runs') {
              const workloadId = params.idOrSlug || params.workloadId || '';
              const runs = await service.listRunsForWorkload(
                workloadId,
                ownerId,
                Number.isFinite(Number(params.limit))
                  ? Math.max(1, Math.min(Number(params.limit), 100))
                  : 20,
              );

              return {
                action,
                sessionId,
                workloadId,
                count: runs.length,
                runs,
              };
            }

            throw new Error(`Unsupported agent-workload action: ${action}`);
          },
          sideEffects: ['write'],
          timeout: 15000,
        },
        inputSchema: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['create_from_scenario', 'create', 'list', 'run_now', 'pause', 'resume', 'delete', 'list_runs'],
            },
            request: { type: 'string' },
            scenario: { type: 'string' },
            description: { type: 'string' },
            title: { type: 'string' },
            prompt: { type: 'string' },
            execution: { type: 'object' },
            callableSlug: { type: 'string' },
            tool: { type: 'string' },
            command: { type: 'string' },
            schedule: { type: 'string' },
            mode: { type: 'string' },
            enabled: { type: 'boolean' },
            timezone: { type: 'string' },
            now: { type: 'string' },
            trigger: { type: 'object' },
            policy: { type: 'object' },
            stages: { type: 'array' },
            metadata: { type: 'object' },
            host: { type: 'string' },
            username: { type: 'string' },
            port: { type: 'integer' },
            idOrSlug: { type: 'string' },
            workloadId: { type: 'string' },
            limit: { type: 'integer' },
          },
          additionalProperties: false,
        },
        skill: {
          triggerPatterns: [
            'schedule this for later',
            'set up a recurring agent',
            'create a daily workload',
            'follow up tomorrow',
            'run every weekday',
          ],
          requiresConfirmation: false,
        },
        frontend: {
          exposeToFrontend: false,
          icon: 'clock',
        },
      },
    ];

    const systemToolInstances = [
      new GitLocalTool(),
    ];

    // Register all system tools
    [...fileTools, ...codeTools, ...docsTools, ...mediaTools, ...workloadTools].forEach(def => {
      this.registry.register({
        ...def,
        version: '1.0.0',
        skill: def.skill || {
          triggerPatterns: [def.name.toLowerCase(), def.id.replace(/-/g, ' ')],
          autoApply: false
        },
        frontend: def.frontend || {
          exposeToFrontend: true,
          icon: 'settings'
        }
      });
    });

    systemToolInstances.forEach((tool) => {
      const definition = this.createToolDefinition(tool, {
        frontend: {
          exposeToFrontend: true,
          icon: tool.id === 'git-safe' ? 'git-branch' : 'settings',
        },
        skill: {
          triggerPatterns: [tool.name.toLowerCase(), tool.id.replace(/-/g, ' ')],
          requiresConfirmation: tool.id !== 'git-safe',
        },
      });

      this.registry.register(definition);
      this.loadedTools.set(tool.id, tool);
    });

    console.log('[ToolManager] System tools registered');
  }

  /**
   * Create tool definition with defaults
   */
  normalizeSkillTriggerPatterns(values = []) {
    return Array.from(new Set(
      (Array.isArray(values) ? values : [values])
        .map((value) => String(value || '')
          .trim()
          .toLowerCase()
          .replace(/[_-]+/g, ' ')
          .replace(/\s+/g, ' '))
        .filter(Boolean),
    ));
  }

  inferToolRequiresConfirmation(tool) {
    const sideEffects = new Set(
      Array.isArray(tool?.sideEffects)
        ? tool.sideEffects.map((effect) => String(effect || '').toLowerCase())
        : [],
    );
    const category = String(tool?.category || '').toLowerCase();

    return sideEffects.has('write')
      || sideEffects.has('execute')
      || category === 'ssh'
      || category === 'database';
  }

  createToolDefinition(tool, overrides = {}) {
    const base = tool.toDefinition();
    const defaultTriggerPatterns = this.normalizeSkillTriggerPatterns([
      tool.name,
      tool.id,
      tool.id ? tool.id.replace(/[-_]+/g, ' ') : '',
    ]);
    
    return {
      ...base,
      skill: {
        triggerPatterns: defaultTriggerPatterns,
        autoApply: false,
        requiresConfirmation: this.inferToolRequiresConfirmation(tool),
        ...overrides.skill
      },
      frontend: {
        exposeToFrontend: true,
        icon: 'tool',
        ...overrides.frontend
      }
    };
  }

  /**
   * Get trigger patterns for SSH tools
   */
  getSSHTriggerPatterns(toolId) {
    const patterns = {
      'ssh-execute': ['ssh', 'remote command', 'execute on server', 'run on host'],
      'remote-command': ['remote command', 'run remotely', 'execute remotely', 'ssh'],
      'docker-exec': ['docker', 'container', 'run in container', 'docker exec'],
      'k3s-deploy': ['k3s deploy', 'deploy to k3s', 'kubectl apply', 'rollout status', 'set image'],
    };
    return patterns[toolId] || [toolId];
  }

  /**
   * Set up event listeners
   */
  setupEventListeners() {
    // Listen for tool invocations
    this.registry.on('tool:registered', ({ id }) => {
      console.log(`[ToolManager] Tool registered: ${id}`);
    });

    // Listen for skill updates
    this.registry.on('skill:updated', ({ id, skill }) => {
      console.log(`[ToolManager] Skill updated: ${id} (enabled: ${skill.enabled})`);
    });
  }

  /**
   * Get a tool instance
   */
  getTool(id) {
    return this.loadedTools.get(id) || this.registry.getTool(id);
  }

  /**
   * Execute a tool
   */
  async executeTool(id, params, context = {}) {
    const tool = this.getTool(id);
    
    if (!tool) {
      throw new Error(`Tool not found: ${id}`);
    }

    // Check if skill is enabled
    const skill = this.registry.getSkill(id);
    if (skill && !skill.enabled) {
      throw new Error(`Tool ${id} is disabled`);
    }

    const normalizedParams = id === 'file-write'
      ? normalizeFileWriteParams(params)
      : params;

    // Execute either a ToolBase instance or a registry definition.
    let result;
    if (typeof tool.execute === 'function') {
      result = await tool.execute(normalizedParams, context);
    } else if (typeof tool.backend?.handler === 'function') {
      const startedAt = Date.now();
      try {
        const data = await tool.backend.handler(normalizedParams, context);
        result = {
          success: true,
          data,
          duration: Date.now() - startedAt,
          toolId: id,
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        result = {
          success: false,
          error: error.message,
          duration: Date.now() - startedAt,
          toolId: id,
          timestamp: new Date().toISOString(),
        };
      }
    } else {
      throw new Error(`Tool ${id} has no executable handler`);
    }
    
    // Record stats
    this.registry.recordInvocation(id, result, {
      ...context,
      params: normalizedParams,
    });
    
    return result;
  }

  /**
   * Get all available tools for frontend
   */
  getFrontendTools() {
    return this.registry.getFrontendTools();
  }

  /**
   * Get all skills for admin
   */
  getAdminSkills() {
    return this.registry.getAllSkills();
  }

  /**
   * Get registry stats
   */
  getStats() {
    return {
      tools: this.registry.getAllTools().length,
      skills: this.registry.getAllSkills().length,
      categories: this.registry.getCategories(),
      byCategory: this.registry.getCategories().map(cat => ({
        name: cat,
        count: this.registry.getToolsByCategory(cat).length
      }))
    };
  }
}

// Singleton
let instance = null;

function getToolManager() {
  if (!instance) {
    instance = new ToolManager();
  }
  return instance;
}

module.exports = { ToolManager, getToolManager };
