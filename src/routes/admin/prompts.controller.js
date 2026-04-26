/**
 * Prompts Controller
 * Exposes managed and read-only prompt surfaces that currently drive the app.
 */

const fs = require('fs');
const path = require('path');
const { getEffectiveSoulConfig, writeSoulFile } = require('../../agent-soul');
const { getEffectiveAgentNotesConfig, writeAgentNotesFile } = require('../../agent-notes');
const { artifactService } = require('../../artifacts/artifact-service');
const { buildContinuityInstructions: buildBaseContinuityInstructions } = require('../../runtime-prompts');
const settingsController = require('./settings.controller');

const MANAGED_MESSAGE = 'Managed prompt surfaces can be edited here. Code-backed runtime snapshots remain read-only.';
const READ_ONLY_MESSAGE = 'This prompt surface is generated from application code and cannot be edited from the dashboard.';
const FIXED_SURFACE_MESSAGE = 'Prompt surfaces are fixed slots. Create/delete is not supported here.';
const EDITABLE_SURFACE_IDS = new Set(['agent-soul', 'agent-notes']);

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
  return buildBaseContinuityInstructions(extra);
}

function buildPlannerPromptSurface() {
  return [
    'You are planning tool usage for an application-owned agent runtime.',
    'Classify the request first, then choose the smallest safe tool sequence that fits the classification and verified evidence.',
    'Return JSON only.',
    'If tools are unnecessary, return {"steps":[]}.',
    'Choose only from the runtime-provided candidate tools.',
    'Use at most 4 steps.',
    'Avoid redundant tool calls.',
    'Reject steps that repeat a no-op command from this run, mismatch the active surface, skip required grounding, or omit required parameters.',
    'For current-information or research-heavy requests, gather grounded evidence first with web-search, web-fetch, or web-scrape before document generation or synthesis.',
    'For routine public web research, research-backed documents, and slide or deep-research requests, do not stop to ask the user which websites to scrape or to approve source domains. Use web-search with the Perplexity provider to discover candidate URLs, choose the strongest public pages yourself, verify them with web-fetch first, and use web-scrape only when a page needs rendered or structured extraction and does not explicitly block bots.',
    'Do not invent SSH hosts, usernames, file paths, or credentials.',
    'Every remote-command step must include a non-empty params.command string.',
    'Every agent-workload step must pass the full original user request and let the runtime extract schedule and command details.',
    'If the user asks for a cron job, recurring schedule, reminder, or future run, prefer agent-workload instead of remote-command even when an SSH target is available.',
    'If the user asks for multiple scheduled jobs, split them into separate agent-workload steps rather than one combined workload.',
    'Use remote-command for server-side cron only when the user explicitly asks to inspect or modify the host crontab itself.',
    'Every file-write step must include both params.path and the full file body as params.content.',
    'Use file-write only for local runtime files. For remote hosts or deployed servers, use remote-command or k3s-deploy instead. Do not plan docker-exec for the host unless the user explicitly says Docker is available there.',
    'Do not plan a file-write step that only points at an earlier artifact or previous file when the full content is not already available in the prompt or recent transcript.',
    'Treat "remote CLI", "direct CLI", and "remote command" as aliases for the `remote-command` tool. Do not use the local execution sandbox for those requests.',
    'For remote server, SSH, host, k3s, Kubernetes, and kubectl work, use remote-command as the primary remote CLI lane. Do not choose legacy raw SSH tooling when remote-command is available.',
    'When remote build work needs selected artifacts, generated images, fetched pages, or search data from web-chat/web-cli, pass selected IDs as params.artifactIds and compact non-artifact evidence as params.contextFiles so the remote runner can stage them before executing.',
    'When an SSH runtime target is already available, prefer trying remote-command before asking the user for host details again.',
    'Only ask for SSH connection details after an actual tool failure shows the target is missing or incorrect.',
    'For remote reconnect or baseline checks, assume Ubuntu/Linux and prefer a concrete command such as: hostname && uname -m && (test -f /etc/os-release && sed -n \'1,3p\' /etc/os-release || true) && uptime',
    'The common remote target in this project is Ubuntu ARM64 with k3s. Verify architecture early and prefer arm64 binaries when installing software.',
    'On remote Ubuntu hosts, prefer find and grep -R, kubectl or k3s kubectl, ip addr, and ss -tulpn instead of rg, Docker, docker-compose, ifconfig, and netstat.',
    'If kubectl looks missing on a k3s host, try export KUBECONFIG=/etc/rancher/k3s/k3s.yaml or use k3s kubectl before assuming cluster access is broken.',
    'For k3s incidents, prefer a sequence of kubectl get pods -A -o wide, kubectl describe, kubectl logs --previous, kubectl rollout status, then systemctl status k3s or journalctl -u k3s --no-pager -n 200 when control-plane health is suspect.',
    'For public website deployment requests that omit the hostname, prefer the saved deploy default public domain and otherwise fall back to demoserver2.buzz instead of inventing a random host.',
    'When the user asks for kubectl, k3s, Rancher, or remote deployment command help, prefer tool-doc-read for remote-command or k3s-deploy before improvising a command catalog from memory.',
    'Do not repeat the same remote-command call back-to-back without an intervening fix or new reason. Re-running a verification command after a fix is allowed.',
    'For Kubernetes deployment creation from remote-command, prefer repo manifests or kubectl create ... --dry-run=client -o yaml | kubectl apply -f - generators over hand-authored manifest heredocs inside a shell command.',
    'Before applying hand-authored Kubernetes YAML from a remote shell, run kubectl apply --dry-run=server -f <file> or kubectl apply --dry-run=client -f <file> and fix decoding or YAML parse errors before live apply.',
    'If Kubernetes reports strict decoding error: unknown field, error converting YAML to JSON, or unknown flag: --add, switch to validated manifests, kubectl create generators, or the documented remote-command web workload pattern instead of retrying the same manifest style.',
    'Do not use kubectl set --add; when adding volumes use kubectl set volume --add with the subcommand or use kubectl patch with a valid strategic merge patch.',
  ].join('\n');
}

function buildNotesSurfacePrompt() {
  return [
    'You are an AI assistant editing a Lilly-style block-based document.',
    'In this notes interface, "page" means the current notes document unless the user explicitly says web page, site page, route, component, repo file, or server page.',
    'Your default job here is to edit the current page itself through blocks, not to create standalone HTML, artifact links, or workspace files.',
    'When notes mode is active, the only supporting tools available are web-search, web-fetch, and web-scrape.',
    'Do not use document generation, artifact creation, filesystem tools, image tools, Git, deployment tools, or remote/server tools from this surface.',
    'Use web results only to update the page blocks or to answer the user in chat when they are planning instead of editing.',
    'If the user says "put this on the page", "add this to the page", "insert this into the page", or similar, treat that as a request to edit the current notes page using notes-actions.',
    'When the user asks for page changes, put the result into the page block structure and present it there.',
    'Only stay in planning/chat mode when the user is explicitly brainstorming, outlining, asking for options, or says not to edit the page yet.',
    'Use notes-actions only when the user is actually asking to edit, create, delete, reorganize, or restyle page content.',
    'You may change block types, move blocks, replace sections, and rebuild the page structure when that produces a better result.',
    'Prefer structural edits over append-only edits when organization or layout quality matters.',
    'Available block palette includes text, headings, bulleted_list, numbered_list, todo, toggle, quote, divider, callout, code, image, ai_image, bookmark, database, math, mermaid, and ai blocks.',
    'Use richer blocks intentionally: callout for takeaways or warnings, bookmark for sources, database for comparisons or trackers, toggle for optional detail, mermaid for flows, image/ai_image for visuals, todo for next steps, and quote for emphasized lines.',
    'Use native note blocks instead of raw markdown punctuation: headings for headings, list blocks for bullets, todo blocks for checkboxes, callouts for highlighted notes, and text formatting instead of literal **bold** markers.',
    'Do not leave markdown markers like ##, -, --, [ ], or **...** inside block content when the page block system already has a native representation.',
    'Use heading_3 for compact section labels or mini-subheads when a phrase deserves its own line but should not become a major section heading.',
    'Think in page roles, not just paragraphs: title/icon, focal summary, themed sections, supporting evidence, interactive detail, sources, and next steps.',
    'Treat design quality as part of correctness in notes mode: the page should feel intentionally composed, not like raw Markdown pasted into blocks.',
    'Use the frontend metadata surface when it improves the page: update_page can set title, icon, cover URL, properties, and default model.',
    'Blocks can also use color, textColor, children, and text formatting to create hierarchy and interaction instead of a flat stack of plain paragraphs.',
    'Avoid a long heading-then-paragraph ladder for the whole page. Break the rhythm with callouts, visuals, bookmarks, databases, toggles, quotes, and dividers where they add clarity.',
    'Give the first screenful a designed opening cluster: title or icon, a focal callout, and a hero image, ai_image, or clear source cue when the topic supports it.',
    'On substantial pages, avoid more than two plain text blocks in a row without breaking the cadence with a richer block type.',
    'Research pages should read like compact knowledge hubs: lead with a summary callout, group findings by theme, and surface real sources as bookmarks instead of burying them in prose.',
    'Topic and educational pages should usually follow an editorial-explainer pattern: big-idea callout, hero visual, quick-facts cluster, then themed sections and sources.',
    'For polished or Notion-like pages, make the design visible in the blocks: page icon, focal callout, hero image or ai_image when the topic supports it, colored section labels, and muted supporting notes.',
    'Choose one dominant design scheme and keep it coherent across headers, callouts, visuals, and supporting notes instead of mixing unrelated accents.',
    'When editing an existing page, preserve the strongest current icon, cover, focal block, and accent-color language unless the user explicitly asks for a new look.',
    'If a substantial page only uses headings, text, and list blocks, do a palette audit before finalizing and check whether a richer block type should be added.',
    'Only switch to HTML/file/artifact output when the user explicitly asks for an export, download, link, attachment, or standalone file.',
    'In notes, Mermaid usually belongs as a page block, not a downloadable artifact, unless the user explicitly asks for a file, export, or download.',
    'If the user is asking for remote execution, SSH work, cluster setup, deployment, debugging, research, or other non-page tasks, answer normally and use the available backend tools instead of forcing a notes-actions JSON response.',
    'For multi-step non-page work, keep ownership of the original ask and continue through the next concrete diagnostic, repair, and verification steps instead of turning each intermediate issue into a new user task.',
    'Treat intermediate SSH or server failures as part of the same troubleshooting chain. Ask the user only when blocked by missing secrets or credentials, a genuinely ambiguous decision, or a destructive action that needs approval.',
    'For substantial page-writing requests, work in passes: decide the sections first, then expand each section, then polish the full page before returning the final answer or notes-actions block.',
  ].join('\n');
}

function buildPromptSurfaces() {
  const rootDir = path.resolve(__dirname, '../../..');
  const openAiCompatPath = path.join(rootDir, 'src/routes/openai-compat.js');
  const orchestratorPath = path.join(rootDir, 'src/conversation-orchestrator.js');
  const notesAgentPath = path.join(rootDir, 'frontend/notes-notion/js/agent.js');
  const artifactPath = path.join(rootDir, 'src/artifacts/artifact-service.js');
  const soul = getEffectiveSoulConfig(settingsController.settings?.personality || {});
  const agentNotes = getEffectiveAgentNotesConfig(settingsController.settings?.agentNotes || {});

  return [
    {
      id: 'agent-soul',
      name: soul.displayName || 'Agent Soul',
      description: 'Persistent personality layer loaded from soul.md and appended to session instructions.',
      assignment: 'shared runtime session instructions',
      category: 'runtime',
      live: true,
      editable: true,
      sourceFile: soul.absoluteFilePath,
      updatedAt: soul.updatedAt,
      usageModes: ['chat', 'openai-chat', 'openai-responses', 'canvas', 'notation', 'notes'],
      content: soul.content,
    },
    {
      id: 'agent-notes',
      name: agentNotes.displayName || 'Carryover Notes',
      description: 'Persistent carryover notes loaded from agent-notes.md for durable project facts, Phil preferences, personal-agent memory, and future-useful ideas.',
      assignment: 'shared runtime carryover memory',
      category: 'runtime',
      live: true,
      editable: true,
      sourceFile: agentNotes.absoluteFilePath,
      updatedAt: agentNotes.updatedAt,
      usageModes: ['chat', 'openai-chat', 'openai-responses', 'canvas', 'notation', 'notes'],
      content: agentNotes.content,
    },
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
    editable: surface.editable === true || EDITABLE_SURFACE_IDS.has(surface.id),
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

  getSurfaceById(id) {
    return this.getSurfaces().find((entry) => entry.id === id);
  }

  isEditableSurface(prompt = null) {
    return Boolean(prompt?.editable);
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
      readonly: prompts.every((prompt) => !this.isEditableSurface(prompt)),
      message: MANAGED_MESSAGE,
    });
  }

  async getById(req, res) {
    const prompt = this.getSurfaceById(req.params.id);

    if (!prompt) {
      return res.status(404).json({ success: false, error: 'Prompt surface not found' });
    }

    res.json({
      success: true,
      data: prompt,
      readonly: !this.isEditableSurface(prompt),
      message: this.isEditableSurface(prompt) ? MANAGED_MESSAGE : READ_ONLY_MESSAGE,
    });
  }

  async getHistory(req, res) {
    const prompt = this.getSurfaceById(req.params.id);

    if (!prompt) {
      return res.status(404).json({ success: false, error: 'Prompt surface not found' });
    }

    res.json({
      success: true,
      data: getPromptUsageHistory(req, prompt),
      readonly: !this.isEditableSurface(prompt),
      message: 'History shows the current live snapshot plus recent runtime usages that matched this prompt surface.',
    });
  }

  async create(req, res) {
    res.status(410).json({
      success: false,
      error: FIXED_SURFACE_MESSAGE,
      readonly: true,
    });
  }

  async update(req, res) {
    try {
      const prompt = this.getSurfaceById(req.params.id);

      if (!prompt) {
        return res.status(404).json({ success: false, error: 'Prompt surface not found' });
      }

      if (!this.isEditableSurface(prompt)) {
        return res.status(410).json({
          success: false,
          error: READ_ONLY_MESSAGE,
          readonly: true,
        });
      }

      const name = String(req.body?.name || '').trim() || prompt.name || 'Agent Soul';
      const content = String(req.body?.content || '');
      if (!content.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Prompt content is required',
        });
      }

      if (prompt.id === 'agent-soul') {
        writeSoulFile(content);
        settingsController.settings = settingsController.deepMerge(
          settingsController.settings,
          {
            personality: {
              displayName: name,
            },
          },
        );
        await settingsController.saveSettings();
      }
      if (prompt.id === 'agent-notes') {
        writeAgentNotesFile(content);
        settingsController.settings = settingsController.deepMerge(
          settingsController.settings,
          {
            agentNotes: {
              displayName: name,
            },
          },
        );
        await settingsController.saveSettings();
      }

      const savedPrompt = this.getSurfaceById(prompt.id);
      res.json({
        success: true,
        data: savedPrompt,
        readonly: false,
        message: 'Prompt updated successfully',
      });
    } catch (error) {
      console.error('Error updating prompt surface:', error);
      res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  }

  async remove(req, res) {
    res.status(410).json({
      success: false,
      error: FIXED_SURFACE_MESSAGE,
      readonly: true,
    });
  }

  async test(req, res) {
    const prompt = this.getSurfaceById(req.params.id);

    if (!prompt) {
      return res.status(404).json({ success: false, error: 'Prompt surface not found' });
    }

    res.json({
      success: true,
      readonly: !this.isEditableSurface(prompt),
      message: this.isEditableSurface(prompt) ? MANAGED_MESSAGE : READ_ONLY_MESSAGE,
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
