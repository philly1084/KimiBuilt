/**
 * Tools API - For Frontend Tool Discovery
 * Allows frontends to query and invoke available tools
 */

const express = require('express');
const router = express.Router();
const { getUnifiedRegistry } = require('../agent-sdk/registry/UnifiedRegistry');
const { getToolManager } = require('../agent-sdk/tools');
const { readToolDoc, getToolDocMetadata } = require('../agent-sdk/tool-docs');
const settingsController = require('./admin/settings.controller');
const { config } = require('../config');
const { sessionStore } = require('../session-store');
const { inferExecutionProfile } = require('../runtime-execution');
const { canonicalizeRemoteToolId, isRemoteCommandToolId, isSuspiciousSshTargetHost } = require('../ai-route-utils');
const {
  DEFAULT_EXECUTION_PROFILE,
  NOTES_EXECUTION_PROFILE,
  REMOTE_BUILD_EXECUTION_PROFILE,
  HIDDEN_FRONTEND_TOOL_IDS,
  getAllowedToolIdsForProfile,
} = require('../tool-execution-profiles');

const registry = getUnifiedRegistry();

function getRequestOwnerId(req) {
  return String(req.user?.username || '').trim() || null;
}

async function ensureToolManagerInitialized() {
  const toolManager = getToolManager();
  await toolManager.initialize();
  return toolManager;
}

function isInternalClusterBaseURL(baseURL = '') {
  const normalized = String(baseURL || '').trim();
  if (!normalized) {
    return false;
  }

  try {
    const parsed = new URL(normalized);
    return parsed.hostname.includes('.svc.cluster.local')
      || parsed.hostname === 'ollama'
      || parsed.hostname === 'qdrant'
      || parsed.hostname === 'postgres';
  } catch (_error) {
    return normalized.includes('.svc.cluster.local');
  }
}

function buildRuntimeSummary(toolManager) {
  const ssh = settingsController.getEffectiveSshConfig();

  return {
    source: 'backend',
    toolManagerInitialized: Boolean(toolManager?.initialized),
    totalRegisteredTools: toolManager?.registry?.getAllTools?.().length || 0,
    modelGateway: {
      baseURL: config.openai.baseURL,
      internalCluster: isInternalClusterBaseURL(config.openai.baseURL),
    },
    sshDefaults: {
      enabled: Boolean(ssh.enabled),
      configured: Boolean(ssh.enabled && ssh.host && ssh.username && (ssh.password || ssh.privateKeyPath)),
      source: ssh.source || 'dashboard',
      host: ssh.host || '',
      port: ssh.port || 22,
      username: ssh.username || '',
      hasPassword: Boolean(ssh.password),
      hasPrivateKey: Boolean(ssh.privateKeyPath),
    },
  };
}

function buildToolRuntime(toolId) {
  if (isRemoteCommandToolId(toolId)) {
    const ssh = settingsController.getEffectiveSshConfig();
    return {
      configured: Boolean(ssh.enabled && ssh.host && ssh.username && (ssh.password || ssh.privateKeyPath)),
      source: ssh.source || 'dashboard',
      defaultTarget: ssh.host ? `${ssh.username || 'unknown'}@${ssh.host}:${ssh.port || 22}` : null,
      auth: ssh.privateKeyPath ? 'private-key' : (ssh.password ? 'password' : 'unset'),
    };
  }

  if (toolId === 'k3s-deploy') {
    const ssh = settingsController.getEffectiveSshConfig();
    return {
      configured: Boolean(ssh.enabled && ssh.host && ssh.username && (ssh.password || ssh.privateKeyPath)),
      source: ssh.source || 'dashboard',
      defaultTarget: ssh.host ? `${ssh.username || 'unknown'}@${ssh.host}:${ssh.port || 22}` : null,
      defaultRepositoryUrl: config.deploy.defaultRepositoryUrl || '',
      defaultTargetDirectory: config.deploy.defaultTargetDirectory || '',
      defaultNamespace: config.deploy.defaultNamespace || '',
      defaultDeployment: config.deploy.defaultDeployment || '',
    };
  }

  if (toolId === 'git-safe') {
    return {
      configured: true,
      provider: 'local',
      defaultRepositoryPath: config.deploy.defaultRepositoryPath || '',
    };
  }

  if (toolId === 'docker-exec') {
    return {
      configured: Boolean(process.env.DOCKER_HOST),
      dockerHost: process.env.DOCKER_HOST || '',
    };
  }

  if (toolId === 'code-sandbox') {
    return {
      configured: Boolean(process.env.DOCKER_HOST),
      provider: 'docker',
      dockerHost: process.env.DOCKER_HOST || '',
    };
  }

  if (toolId === 'web-search') {
    return {
      configured: Boolean(process.env.PERPLEXITY_API_KEY),
      provider: process.env.PERPLEXITY_API_KEY ? 'perplexity' : 'unconfigured',
    };
  }

  if (toolId === 'image-generate') {
    return {
      configured: Boolean(config.media.apiKey || config.openai.apiKey),
      provider: config.media.apiKey ? 'official-openai' : (config.openai.baseURL ? 'gateway' : 'openai'),
      model: config.media.imageModel || config.openai.imageModel || '',
    };
  }

  if (toolId === 'image-search-unsplash') {
    return {
      configured: Boolean(process.env.UNSPLASH_ACCESS_KEY),
      provider: process.env.UNSPLASH_ACCESS_KEY ? 'unsplash' : 'unconfigured',
    };
  }

  if (toolId === 'image-from-url') {
    return {
      configured: true,
      provider: 'direct-url',
    };
  }

  if ([
    'web-fetch',
    'web-scrape',
    'file-read',
    'file-write',
    'file-search',
    'file-mkdir',
    'git-safe',
    'tool-doc-read',
    'security-scan',
    'architecture-design',
    'uml-generate',
    'api-design',
    'schema-generate',
    'migration-create',
  ].includes(toolId)) {
    return {
      configured: true,
      provider: 'local',
    };
  }

  return null;
}

function isToolVisibleByRuntime(toolId, runtime = null, support = null) {
  if (HIDDEN_FRONTEND_TOOL_IDS.includes(toolId)) {
    return false;
  }

  if (['docker-exec', 'code-sandbox'].includes(toolId)) {
    return Boolean(support?.runtime?.ready || runtime?.configured);
  }

  if (toolId === 'k3s-deploy') {
    return Boolean(support?.runtime?.ready || runtime?.configured);
  }

  if (['web-search', 'image-generate', 'image-search-unsplash'].includes(toolId)) {
    return Boolean(runtime?.configured);
  }

  return true;
}

async function buildFrontendToolCatalog({ req, category = null, sessionId = null, includeAllTools = false }) {
  const toolManager = await ensureToolManagerInitialized();
  const { executionProfile } = await resolveToolExecutionProfile(req, sessionId);
  const allowedToolIds = getAllowedToolIdsForProfile(executionProfile);

  const manifestTools = registry.getFrontendTools()
    .filter((tool) => !HIDDEN_FRONTEND_TOOL_IDS.includes(tool.id))
    .filter((tool) => tool.id !== 'ssh-execute');

  const enrichedTools = await Promise.all(manifestTools.map(async (tool) => {
    const runtime = buildToolRuntime(tool.id);
    const docMetadata = await getToolDocMetadata(tool.id);
    const availableInExecutionProfile = allowedToolIds.includes(tool.id);
    const runtimeVisible = isToolVisibleByRuntime(tool.id, runtime, docMetadata.support);

    return {
      ...tool,
      runtime,
      availableInExecutionProfile,
      runtimeVisible,
      ...docMetadata,
    };
  }));

  const filteredTools = enrichedTools.filter((tool) => {
    if (category && category !== 'all' && tool.category !== category) {
      return false;
    }

    if (includeAllTools) {
      return true;
    }

    return tool.availableInExecutionProfile && tool.runtimeVisible;
  });

  return {
    toolManager,
    executionProfile,
    includeAllTools,
    tools: filteredTools,
  };
}

function buildToolExecutionContext(toolManager, req, sessionId = null) {
  const body = req.body || {};
  return {
    sessionId,
    userId: req.user?.id || req.user?.username,
    timestamp: new Date().toISOString(),
    route: req.originalUrl || req.path || '/api/tools/invoke',
    transport: 'http',
    executionProfile: body.executionProfile || body.execution_profile || body.clientSurface || body.client_surface || 'tool-invoke',
    toolManager,
    tools: {
      get: (toolId) => toolManager.getTool(toolId),
    },
  };
}

function looksLikeNotesSurface(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return [
    'notes',
    'notes-app',
    'notes_app',
    'notes-editor',
    'notes_editor',
  ].includes(normalized);
}

function hasStickyRemoteSession(session = null) {
  const metadata = session?.metadata || {};
  return isRemoteCommandToolId(metadata.lastToolIntent)
    || Boolean(metadata.lastSshTarget?.host);
}

async function resolveToolExecutionProfile(req, requestedSessionId = null) {
  const normalizedSessionId = typeof requestedSessionId === 'string' ? requestedSessionId.trim() : '';
  const ownerId = getRequestOwnerId(req);
  const session = normalizedSessionId && !normalizedSessionId.startsWith('local_')
    ? (ownerId ? await sessionStore.getOwned(normalizedSessionId, ownerId) : await sessionStore.get(normalizedSessionId))
    : null;
  const taskType = looksLikeNotesSurface(
    req.query?.taskType
    || req.query?.task_type
    || req.query?.clientSurface
    || req.query?.client_surface
    || req.body?.taskType
    || req.body?.task_type
    || req.body?.clientSurface
    || req.body?.client_surface
    || session?.mode
    || session?.metadata?.taskType
    || session?.metadata?.clientSurface
  ) ? NOTES_EXECUTION_PROFILE : DEFAULT_EXECUTION_PROFILE;

  let executionProfile = inferExecutionProfile({
    executionProfile: req.query?.executionProfile
      || req.query?.execution_profile
      || req.body?.executionProfile
      || req.body?.execution_profile
      || null,
    taskType,
    session,
  });

  if (executionProfile !== REMOTE_BUILD_EXECUTION_PROFILE && hasStickyRemoteSession(session)) {
    executionProfile = REMOTE_BUILD_EXECUTION_PROFILE;
  }

  return {
    session,
    executionProfile,
  };
}

async function resolveToolSessionId(requestedSessionId = null, ownerId = null) {
  const normalized = typeof requestedSessionId === 'string' ? requestedSessionId.trim() : '';

  if (normalized && !normalized.startsWith('local_')) {
    const session = ownerId
      ? await sessionStore.getOrCreateOwned(normalized, { mode: 'chat' }, ownerId)
      : await sessionStore.getOrCreate(normalized, { mode: 'chat' });
    return session?.id || normalized;
  }

  const session = await sessionStore.create(ownerId ? { mode: 'chat', ownerId } : { mode: 'chat' });
  return session.id;
}

async function updateSessionToolMetadata(sessionId, toolId, params = {}) {
  if (!sessionId || !isRemoteCommandToolId(toolId)) {
    return;
  }

  const host = String(params.host || '').trim();
  const safeHost = host && !isSuspiciousSshTargetHost(host) ? host : '';

  await sessionStore.update(sessionId, {
    metadata: {
      lastToolIntent: canonicalizeRemoteToolId(toolId),
      ...(safeHost ? {
        lastSshTarget: {
          host: safeHost,
          username: params.username || '',
          port: params.port || 22,
        },
      } : {}),
    },
  });
}

/**
 * GET /api/tools/available
 * Get all tools available to frontends
 */
router.get('/available', async (req, res) => {
  try {
    const { category, sessionId } = req.query;
    const includeAllTools = ['1', 'true', 'yes'].includes(String(req.query?.includeAll || '').trim().toLowerCase());
    const {
      toolManager,
      executionProfile,
      tools,
    } = await buildFrontendToolCatalog({
      req,
      category,
      sessionId,
      includeAllTools,
    });

    res.json({
      success: true,
      data: tools,
      meta: {
        total: tools.length,
        categories: [...new Set(tools.map(t => t.category))],
        executionProfile,
        includeAllTools,
        runtime: buildRuntimeSummary(toolManager),
      }
    });
  } catch (error) {
    console.error('Error getting available tools:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/tools/categories
 * Get tool categories with counts
 */
router.get('/categories', async (req, res) => {
  try {
    const { sessionId } = req.query;
    const includeAllTools = ['1', 'true', 'yes'].includes(String(req.query?.includeAll || '').trim().toLowerCase());
    const { executionProfile, tools } = await buildFrontendToolCatalog({
      req,
      sessionId,
      includeAllTools,
    });
    const categories = [...new Set(tools.map((tool) => tool.category))];

    const result = categories.map(cat => ({
      id: cat,
      name: cat.charAt(0).toUpperCase() + cat.slice(1),
      count: tools.filter(t => t.category === cat).length,
      icon: getCategoryIcon(cat)
    }));
    
    res.json({
      success: true,
      data: result,
      meta: {
        executionProfile,
        includeAllTools,
      },
    });
  } catch (error) {
    console.error('Error getting categories:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/tools/stats
 * Get tool usage statistics
 */
router.get('/stats', async (req, res) => {
  try {
    await ensureToolManagerInitialized();
    const stats = registry.getAllSkills().map(skill => ({
      id: skill.id,
      name: skill.name,
      category: skill.category,
      invocations: skill.stats?.invocations || skill.stats?.usageCount || 0,
      successRate: skill.stats?.successRate || 100,
      avgDuration: skill.stats?.avgDuration || 0,
      lastUsed: skill.stats?.lastUsed,
      recentUsage: skill.stats?.recentUsage || [],
    }));
    
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error getting tool stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/tools/docs/:id
 * Load detailed tool documentation on demand
 */
router.get('/docs/:id', async (req, res) => {
  try {
    await ensureToolManagerInitialized();
    const { id } = req.params;
    const metadata = await getToolDocMetadata(id);

    if (!metadata.docAvailable) {
      return res.status(404).json({ success: false, error: 'Tool documentation not found' });
    }

    const doc = await readToolDoc(id);
    res.json({
      success: true,
      data: {
        toolId: id,
        content: doc.content,
        support: metadata.support,
      },
    });
  } catch (error) {
    console.error('Error getting tool documentation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/tools/:id
 * Get tool details
 */
router.get('/:id', async (req, res) => {
  try {
    const toolManager = await ensureToolManagerInitialized();
    const { id } = req.params;
    
    const tool = registry.getTool(id);
    const manifest = registry.getManifest(id);
    const skill = registry.getSkill(id);
    
    if (!tool) {
      return res.status(404).json({ success: false, error: 'Tool not found' });
    }
    
    const docMetadata = await getToolDocMetadata(id);

    res.json({
      success: true,
      data: {
        id: tool.id,
        name: tool.name,
        description: tool.description,
        category: tool.category,
        version: tool.version,
        manifest,
        runtime: buildToolRuntime(id),
        skill: skill ? {
          enabled: skill.enabled,
          triggerPatterns: skill.triggerPatterns,
          requiresConfirmation: skill.requiresConfirmation,
          stats: skill.stats || null,
        } : null,
        parameters: manifest?.parameters || [],
        ...docMetadata,
      },
      meta: {
        runtime: buildRuntimeSummary(toolManager),
      },
    });
  } catch (error) {
    console.error('Error getting tool:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/tools/invoke
 * Invoke a tool
 */
router.post('/invoke', async (req, res) => {
  try {
    const { tool: toolId, params = {}, sessionId } = req.body;
    
    if (!toolId) {
      return res.status(400).json({ success: false, error: 'Tool ID is required' });
    }
    
    const toolManager = await ensureToolManagerInitialized();
    const resolvedSessionId = await resolveToolSessionId(sessionId, getRequestOwnerId(req));
    
    const result = await toolManager.executeTool(
      toolId,
      params,
      buildToolExecutionContext(toolManager, req, resolvedSessionId),
    );
    await updateSessionToolMetadata(resolvedSessionId, toolId, params);
    
    res.json({ success: true, data: result, sessionId: resolvedSessionId });
  } catch (error) {
    console.error('Error invoking tool:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/tools/invoke/:id
 * Invoke a specific tool
 */
router.post('/invoke/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const params = req.body;
    
    const toolManager = await ensureToolManagerInitialized();
    const resolvedSessionId = await resolveToolSessionId(req.body.sessionId, getRequestOwnerId(req));
    
    const result = await toolManager.executeTool(
      id,
      params,
      buildToolExecutionContext(toolManager, req, resolvedSessionId),
    );
    await updateSessionToolMetadata(resolvedSessionId, id, params);
    
    res.json({ success: true, data: result, sessionId: resolvedSessionId });
  } catch (error) {
    console.error('Error invoking tool:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper functions

function getCategoryIcon(category) {
  const icons = {
    web: 'globe',
    ssh: 'terminal',
    design: 'pen-tool',
    sandbox: 'shield',
    database: 'database',
    system: 'settings'
  };
  return icons[category] || 'tool';
}

module.exports = router;
