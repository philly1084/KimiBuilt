/**
 * Prompts Controller
 * Exposes the live read-only prompt surfaces that currently drive the app.
 */

const fs = require('fs');
const path = require('path');
const { artifactService } = require('../../artifacts/artifact-service');

const READ_ONLY_MESSAGE = 'Runtime prompt editing is deprecated. The dashboard now shows read-only snapshots of the live prompt/instruction surfaces used by application code.';

function estimateTokens(text = '') {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return 0;
  }

  return Math.max(1, Math.ceil(normalized.length / 4));
}

function getFileTimestamp(filePath) {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch (_error) {
    return null;
  }
}

function truncate(text = '', limit = 180) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  return normalized.length > limit
    ? `${normalized.slice(0, limit - 1)}...`
    : normalized;
}

function buildContinuityInstructions(extra = '') {
  return [
    'You are a helpful AI assistant.',
    'Use the recent session transcript as the primary context for follow-up references like "that", "again", or "same as before".',
    'Use recalled memory only as supplemental context.',
    'Do not claim you lack access to prior conversation if session transcript or recalled context is available in the prompt.',
    'Follow the user\'s current request directly instead of defaulting to document or business-workflow tasks unless they ask for that.',
    'For substantial writing tasks such as reports, briefs, plans, specs, pages, or polished notes, work in passes: identify sections, expand the sections, then polish the full result before replying.',
    'Be concise and informative.',
    extra || '',
  ].filter(Boolean).join('\n');
}

function buildPlannerPromptSurface() {
  return [
    'You are planning tool usage for an application-owned agent runtime.',
    'Return JSON only.',
    'If tools are unnecessary, return {"steps":[]}.',
    'Choose only from the runtime-provided candidate tools.',
    'Use at most 4 steps.',
    'Avoid redundant tool calls.',
    'Do not invent SSH hosts, usernames, file paths, or credentials.',
    'When an SSH runtime target is already available, prefer trying ssh-execute before asking the user for host details again.',
    'Only ask for SSH connection details after an actual tool failure shows the target is missing or incorrect.',
  ].join('\n');
}

function buildNotesSurfacePrompt() {
  return [
    'You are an AI assistant editing a Lilly-style block-based document.',
    'In this notes interface, "page" means the current notes document unless the user explicitly says web page, site page, route, component, repo file, or server page.',
    'If the user says "put this on the page", "add this to the page", "insert this into the page", or similar, treat that as a request to edit the current notes page using notes-actions.',
    'Use notes-actions only when the user is actually asking to edit, create, delete, reorganize, or restyle page content.',
    'If the user is asking for remote execution, SSH work, cluster setup, deployment, debugging, research, or other non-page tasks, answer normally and use the available backend tools instead of forcing a notes-actions JSON response.',
    'For substantial page-writing requests, work in passes: decide the sections first, then expand each section, then polish the full page before returning the final answer or notes-actions block.',
  ].join('\n');
}

function buildPromptSurfaces() {
  const rootDir = path.resolve(__dirname, '../../..');
  const openAiCompatPath = path.join(rootDir, 'src/routes/openai-compat.js');
  const orchestratorPath = path.join(rootDir, 'src/conversation-orchestrator.js');
  const notesAgentPath = path.join(rootDir, 'frontend/notes-notion/js/agent.js');
  const artifactPath = path.join(rootDir, 'src/artifacts/artifact-service.js');

  return [
    {
      id: 'chat-continuity',
      name: 'Chat Continuity Instructions',
      description: 'Base runtime instructions used for chat and OpenAI-compatible request continuity.',
      assignment: '/api/chat and /v1/chat/completions',
      category: 'runtime',
      live: true,
      editable: false,
      sourceFile: openAiCompatPath,
      updatedAt: getFileTimestamp(openAiCompatPath),
      usageModes: ['chat', 'openai-chat', 'openai-responses', 'canvas', 'notation', 'notes'],
      content: buildContinuityInstructions(),
    },
    {
      id: 'conversation-planner',
      name: 'Conversation Tool Planner',
      description: 'Planner prompt for orchestrated tool selection and execution.',
      assignment: 'conversation orchestrator',
      category: 'runtime',
      live: true,
      editable: false,
      sourceFile: orchestratorPath,
      updatedAt: getFileTimestamp(orchestratorPath),
      usageModes: ['chat', 'openai-chat', 'openai-responses', 'canvas', 'notation', 'notes'],
      content: buildPlannerPromptSurface(),
    },
    {
      id: 'notes-page-editor',
      name: 'Notes Page Editor Prompt',
      description: 'Frontend notes-page editing instructions and page-vs-remote routing guidance.',
      assignment: 'notes app',
      category: 'frontend',
      live: true,
      editable: false,
      sourceFile: notesAgentPath,
      updatedAt: getFileTimestamp(notesAgentPath),
      usageModes: ['notes'],
      content: buildNotesSurfacePrompt(),
    },
    {
      id: 'artifact-html-plan',
      name: 'Artifact Plan Pass',
      description: 'First-pass outline planner for multi-pass document generation.',
      assignment: 'artifact pipeline',
      category: 'artifacts',
      live: true,
      editable: false,
      sourceFile: artifactPath,
      updatedAt: getFileTimestamp(artifactPath),
      usageModes: ['chat', 'openai-chat', 'openai-responses', 'notes'],
      content: artifactService.getArtifactPlanInstructions('html'),
    },
    {
      id: 'artifact-html-expand',
      name: 'Artifact Expand Pass',
      description: 'Second-pass section expansion prompt for multi-pass document generation.',
      assignment: 'artifact pipeline',
      category: 'artifacts',
      live: true,
      editable: false,
      sourceFile: artifactPath,
      updatedAt: getFileTimestamp(artifactPath),
      usageModes: ['chat', 'openai-chat', 'openai-responses', 'notes'],
      content: artifactService.getArtifactExpansionInstructions('html'),
    },
    {
      id: 'artifact-html-compose',
      name: 'Artifact Compose Pass',
      description: 'Final composition prompt for multi-pass document generation.',
      assignment: 'artifact pipeline',
      category: 'artifacts',
      live: true,
      editable: false,
      sourceFile: artifactPath,
      updatedAt: getFileTimestamp(artifactPath),
      usageModes: ['chat', 'openai-chat', 'openai-responses', 'notes'],
      content: artifactService.getArtifactCompositionInstructions('html'),
    },
  ].map((surface) => ({
    ...surface,
    variables: [],
    stats: {
      characters: surface.content.length,
      tokens: estimateTokens(surface.content),
      lines: surface.content.split('\n').length,
    },
  }));
}

function getPromptUsageHistory(req, prompt) {
  const dashboardController = req.app?.locals?.dashboardController;
  const taskValues = dashboardController?.taskStore
    ? Array.from(dashboardController.taskStore.values())
    : [];

  const relevantTasks = taskValues
    .filter((task) => {
      if (!Array.isArray(prompt.usageModes) || prompt.usageModes.length === 0) {
        return true;
      }

      const mode = String(task.mode || '').trim().toLowerCase();
      const taskType = String(task.metadata?.taskType || task.metadata?.clientSurface || '').trim().toLowerCase();
      return prompt.usageModes.includes(mode) || prompt.usageModes.includes(taskType);
    })
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
    .slice(0, 12);

  const currentSnapshot = {
    version: 'current',
    type: 'snapshot',
    timestamp: prompt.updatedAt || new Date().toISOString(),
    author: 'application-code',
    details: prompt.assignment,
    preview: truncate(prompt.content),
  };

  const usageEntries = relevantTasks.map((task) => ({
    version: task.id ? task.id.slice(0, 8) : 'task',
    type: 'usage',
    timestamp: task.updatedAt || task.createdAt || new Date().toISOString(),
    author: task.model || 'unknown-model',
    details: `${task.mode || 'runtime'}${task.status ? ` | ${task.status}` : ''}`,
    preview: truncate(task.input),
    sessionId: task.sessionId || null,
  }));

  return [currentSnapshot, ...usageEntries];
}

class PromptsController {
  getSurfaces() {
    return buildPromptSurfaces();
  }

  async getAll(req, res) {
    const { category, search } = req.query;
    let prompts = this.getSurfaces();

    if (category && category !== 'all') {
      prompts = prompts.filter((prompt) => prompt.category === category);
    }

    if (search) {
      const searchLower = String(search).toLowerCase();
      prompts = prompts.filter((prompt) =>
        prompt.name.toLowerCase().includes(searchLower) ||
        prompt.description.toLowerCase().includes(searchLower) ||
        prompt.assignment.toLowerCase().includes(searchLower) ||
        prompt.content.toLowerCase().includes(searchLower),
      );
    }

    res.json({
      success: true,
      data: prompts,
      readonly: true,
      message: READ_ONLY_MESSAGE,
    });
  }

  async getById(req, res) {
    const prompt = this.getSurfaces().find((entry) => entry.id === req.params.id);

    if (!prompt) {
      return res.status(404).json({ success: false, error: 'Prompt surface not found' });
    }

    res.json({
      success: true,
      data: prompt,
      readonly: true,
      message: READ_ONLY_MESSAGE,
    });
  }

  async getHistory(req, res) {
    const prompt = this.getSurfaces().find((entry) => entry.id === req.params.id);

    if (!prompt) {
      return res.status(404).json({ success: false, error: 'Prompt surface not found' });
    }

    res.json({
      success: true,
      data: getPromptUsageHistory(req, prompt),
      readonly: true,
      message: 'History shows the current live snapshot plus recent runtime usages that matched this prompt surface.',
    });
  }

  async create(req, res) {
    res.status(410).json({
      success: false,
      error: READ_ONLY_MESSAGE,
      readonly: true,
    });
  }

  async update(req, res) {
    res.status(410).json({
      success: false,
      error: READ_ONLY_MESSAGE,
      readonly: true,
    });
  }

  async remove(req, res) {
    res.status(410).json({
      success: false,
      error: READ_ONLY_MESSAGE,
      readonly: true,
    });
  }

  async test(req, res) {
    const prompt = this.getSurfaces().find((entry) => entry.id === req.params.id);

    if (!prompt) {
      return res.status(404).json({ success: false, error: 'Prompt surface not found' });
    }

    res.json({
      success: true,
      readonly: true,
      message: READ_ONLY_MESSAGE,
      data: {
        original: prompt.content,
        rendered: prompt.content,
        variables: [],
        provided: req.body?.variables || {},
        missing: [],
        assignment: prompt.assignment,
        stats: prompt.stats,
      },
    });
  }
}

module.exports = new PromptsController();
