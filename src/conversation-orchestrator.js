const EventEmitter = require('events');
const { createResponse } = require('./openai-client');
const { config } = require('./config');
const { extractResponseText } = require('./artifacts/artifact-service');
const settingsController = require('./routes/admin/settings.controller');
const {
    resolveSshRequestContext,
    extractSshSessionMetadataFromToolEvents,
} = require('./ai-route-utils');
const {
    buildProjectMemoryUpdate,
    mergeProjectMemory,
} = require('./project-memory');

const DEFAULT_EXECUTION_PROFILE = 'default';
const NOTES_EXECUTION_PROFILE = 'notes';
const REMOTE_BUILD_EXECUTION_PROFILE = 'remote-build';
const SYNTHETIC_STREAM_CHUNK_SIZE = 120;
const MAX_PLAN_STEPS = 4;
const MAX_TOOL_RESULT_CHARS = 12000;
const RECENT_TRANSCRIPT_LIMIT = 12;

const PROFILE_TOOL_ALLOWLISTS = {
    [DEFAULT_EXECUTION_PROFILE]: [
        'web-search',
        'web-fetch',
        'web-scrape',
        'image-generate',
        'image-search-unsplash',
        'image-from-url',
        'file-read',
        'file-write',
        'file-search',
        'file-mkdir',
        'tool-doc-read',
    ],
    [NOTES_EXECUTION_PROFILE]: [
        'ssh-execute',
        'remote-command',
        'docker-exec',
        'web-search',
        'web-fetch',
        'web-scrape',
        'image-generate',
        'image-search-unsplash',
        'image-from-url',
        'file-read',
        'file-write',
        'file-search',
        'file-mkdir',
        'tool-doc-read',
    ],
    [REMOTE_BUILD_EXECUTION_PROFILE]: [
        'ssh-execute',
        'remote-command',
        'docker-exec',
        'web-search',
        'web-fetch',
        'web-scrape',
        'image-generate',
        'image-search-unsplash',
        'image-from-url',
        'file-read',
        'file-write',
        'file-search',
        'file-mkdir',
        'code-sandbox',
        'tool-doc-read',
    ],
};

function normalizeExecutionProfile(value = '') {
    const normalized = String(value || '').trim().toLowerCase();

    if ([
        'notes',
        'notes-app',
        'notes_app',
        'notes-editor',
        'notes_editor',
    ].includes(normalized)) {
        return NOTES_EXECUTION_PROFILE;
    }

    if ([
        'remote-build',
        'remote_builder',
        'remote-builder',
        'server-build',
        'server-builder',
        'software-builder',
    ].includes(normalized)) {
        return REMOTE_BUILD_EXECUTION_PROFILE;
    }

    return DEFAULT_EXECUTION_PROFILE;
}

function normalizeMessageText(content = '') {
    if (typeof content === 'string') {
        return content;
    }

    if (Array.isArray(content)) {
        return content
            .map((item) => {
                if (typeof item === 'string') {
                    return item;
                }

                if (item?.type === 'text' || item?.type === 'input_text' || item?.type === 'output_text') {
                    return item.text || '';
                }

                return '';
            })
            .filter(Boolean)
            .join('\n');
    }

    return '';
}

function hasExplicitWebResearchIntentText(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(web research|research|look up|search for|search the web|browse the web|search online|browse online)\b/.test(normalized);
}

function extractExplicitWebResearchQuery(text = '') {
    const prompt = String(text || '').trim();
    if (!prompt) {
        return null;
    }

    const patterns = [
        /\b(?:do|perform|run)\s+research\s+(?:on|about|into)?\s+(.+?)(?:[.?!]\s|[\r\n]|$)/i,
        /\bweb research\s+(.+?)(?:[.?!]\s|[\r\n]|$)/i,
        /\bresearch\s+(?:on|about|into)?\s+(.+?)(?:[.?!]\s|[\r\n]|$)/i,
        /\blook up\s+(.+?)(?:[.?!]\s|[\r\n]|$)/i,
        /\bsearch for\s+(.+?)(?:[.?!]\s|[\r\n]|$)/i,
        /\bsearch the web for\s+(.+?)(?:[.?!]\s|[\r\n]|$)/i,
    ];

    for (const pattern of patterns) {
        const match = prompt.match(pattern);
        if (match?.[1]) {
            return match[1].trim();
        }
    }

    if (!hasExplicitWebResearchIntentText(prompt)) {
        return null;
    }

    return prompt
        .replace(/^(please|can you|could you|would you|help me|i need you to)\s+/i, '')
        .replace(/[.?!]+$/g, '')
        .trim();
}

function extractObjective(input = null, fallback = '') {
    if (typeof fallback === 'string' && fallback.trim()) {
        return fallback.trim();
    }

    if (typeof input === 'string') {
        return input.trim();
    }

    if (!Array.isArray(input)) {
        return '';
    }

    const lastUserMessage = input.filter((message) => message?.role === 'user').pop();
    return normalizeMessageText(lastUserMessage?.content || '').trim();
}

function unwrapCodeFence(text = '') {
    const trimmed = String(text || '').trim();
    const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return match ? match[1].trim() : trimmed;
}

function safeJsonParse(text = '') {
    const source = unwrapCodeFence(text);
    if (!source) {
        return null;
    }

    try {
        return JSON.parse(source);
    } catch (_error) {
        const start = source.indexOf('{');
        const end = source.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(source.slice(start, end + 1));
            } catch (_innerError) {
                return null;
            }
        }
        return null;
    }
}

function truncateText(value = '', limit = MAX_TOOL_RESULT_CHARS) {
    const text = String(value || '');
    if (text.length <= limit) {
        return text;
    }

    return `${text.slice(0, limit)}\n[truncated ${text.length - limit} chars]`;
}

function hasUsableSshDefaults() {
    const sshConfig = settingsController.getEffectiveSshConfig();

    return Boolean(
        sshConfig.enabled
        && sshConfig.host
        && sshConfig.username
        && (sshConfig.password || sshConfig.privateKeyPath)
    );
}

function formatSshRuntimeTarget(target = null) {
    if (!target?.host) {
        return null;
    }

    const username = target.username ? `${target.username}@` : '';
    const port = target.port && Number(target.port) !== 22 ? `:${target.port}` : '';
    return `${username}${target.host}${port}`;
}

function hasAutonomousRemoteApproval(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return [
        /\b(do what you need|take it from here|handle it|run with it|finish it|finish setup|finish the setup|complete the setup)\b/,
        /\b(keep going|continue|proceed|go ahead|next steps|do the next steps|obvious next steps)\b/,
        /\b(start the build|continue the build|continue on the server|keep working on the server)\b/,
    ].some((pattern) => pattern.test(normalized));
}

function hasAutonomyRevocation(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(ask me first|wait for me|hold on|stop here|pause here|don'?t continue|do not continue)\b/.test(normalized);
}

function extractFirstUrl(text = '') {
    const match = String(text || '').match(/https?:\/\/\S+/i);
    return match ? match[0].replace(/[),.;!?]+$/g, '') : null;
}

function inferFallbackUnsplashQuery(text = '') {
    return String(text || '')
        .replace(/\b(please|can you|could you|would you|find|search|look up|browse|show|get|use|an|a|the|for|with|from|on|about|into|unsplash|image|images|photo|photos|hero|background|cover|visual|visuals)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
}

function inferFallbackSshCommand(text = '', executionProfile = DEFAULT_EXECUTION_PROFILE) {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return null;
    }

    if (/\b(health|status|healthy|uptime)\b/.test(normalized)) {
        return 'hostname && uptime && (df -h / || true) && (free -m || true)';
    }

    if (/\b(k3s|k8s|kubernetes|cluster|kubectl|nodes?)\b/.test(normalized)) {
        return 'kubectl get nodes -o wide && kubectl get pods -A';
    }

    if (/\b(pods?)\b/.test(normalized)) {
        return 'kubectl get pods -A';
    }

    if (/\b(namespaces?)\b/.test(normalized)) {
        return 'kubectl get namespaces';
    }

    if (/\b(docker|containers?)\b/.test(normalized)) {
        return 'docker ps';
    }

    if (executionProfile === REMOTE_BUILD_EXECUTION_PROFILE) {
        return 'hostname && uname -m && uptime';
    }

    return null;
}

function isInvalidRuntimeResponseText(text = '') {
    const normalized = String(text || '').trim().toLowerCase().replace(/[â€™]/g, '\'');
    if (!normalized) {
        return false;
    }

    return [
        'cli_help sub-agent',
        'generalist agent',
        'provided file-system tools',
        'current environment\'s available toolset',
        'current workspace in /app',
        'i do not have access to an ssh-execute tool',
        'i do not have a usable remote-build or ssh execution tool',
        'i can\'t access the remote server from this environment',
        'i cannot access the remote server from this environment',
        'this session is restricted from network/ssh access',
        'this session is restricted from network access',
        'no ssh/network path to the remote server',
        'no ssh path to the remote server',
        'i can\'t run remote-build',
        'i cannot run remote-build',
        'i can\'t connect via ssh',
        'i cannot connect via ssh',
        'i can\'t execute ssh from this session',
        'i cannot execute ssh from this session',
        'bwrap: no permissions to create a new namespace',
        'bwrap: no permissions to create a new na',
        'bwrap: no permissions',
        'basic local commands fail before any ssh attempt',
        'testing command execution first',
        'fails before any remote connection starts',
        'fails before any network connection starts',
        'workspace can execute anything locally',
        'launch a remote check from /app',
        'can\'t inspect config or launch a remote check from /app',
    ].some((pattern) => normalized.includes(pattern));
}

function hasExplicitLocalSandboxIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(run|execute|test)\b[\s\S]{0,40}\b(code|script|snippet)\b/.test(normalized)
        || /\b(code sandbox|sandbox|locally|local code)\b/.test(normalized);
}

function canRecoverFromInvalidRuntimeResponse({ output = '', toolEvents = [], toolPolicy = {} } = {}) {
    if (!isInvalidRuntimeResponseText(output) || !Array.isArray(toolPolicy?.candidateToolIds) || toolPolicy.candidateToolIds.length === 0) {
        return false;
    }

    if (!Array.isArray(toolEvents) || toolEvents.length === 0) {
        return true;
    }

    return !toolEvents.some((event) => {
        const toolName = String(event?.toolCall?.function?.name || '').trim().toLowerCase();
        const succeeded = event?.result?.success !== false;
        return succeeded && toolName !== 'code-sandbox';
    });
}

function normalizeStepSignature(step = {}) {
    return JSON.stringify({
        tool: String(step?.tool || '').trim(),
        params: step?.params && typeof step.params === 'object' ? step.params : {},
    });
}

function summarizeToolEventsForPlanner(toolEvents = []) {
    return (Array.isArray(toolEvents) ? toolEvents : [])
        .slice(-6)
        .map((event) => ({
            tool: event?.toolCall?.function?.name || '',
            reason: event?.reason || '',
            success: event?.result?.success !== false,
            error: event?.result?.error || '',
            data: event?.result?.data || null,
        }));
}

function createExecutionTraceEntry({
    type = 'info',
    name = 'Runtime step',
    status = 'completed',
    details = {},
    startedAt = null,
    endedAt = null,
} = {}) {
    const startTime = startedAt || new Date().toISOString();
    const endTime = endedAt || startTime;

    return {
        type,
        name,
        status,
        startTime,
        endTime,
        duration: Math.max(0, new Date(endTime).getTime() - new Date(startTime).getTime()),
        details,
    };
}

function getRemoteBuildAutonomyBudget() {
    return {
        maxRounds: Math.max(1, Number(config.runtime?.remoteBuildMaxAutonomousRounds) || 8),
        maxToolCalls: Math.max(1, Number(config.runtime?.remoteBuildMaxAutonomousToolCalls) || 24),
        maxDurationMs: Math.max(1000, Number(config.runtime?.remoteBuildMaxAutonomousMs) || 120000),
    };
}

function getPreferredRemoteToolId(toolPolicy = {}) {
    const availableToolIds = Array.isArray(toolPolicy?.candidateToolIds) && toolPolicy.candidateToolIds.length > 0
        ? toolPolicy.candidateToolIds
        : Array.isArray(toolPolicy?.allowedToolIds)
            ? toolPolicy.allowedToolIds
            : [];

    if (availableToolIds.includes('remote-command')) {
        return 'remote-command';
    }

    if (availableToolIds.includes('ssh-execute')) {
        return 'ssh-execute';
    }

    return null;
}

function sanitizeValue(value, depth = 0) {
    if (value == null) {
        return value;
    }

    if (typeof value === 'string') {
        return truncateText(value, 3000);
    }

    if (typeof value !== 'object') {
        return value;
    }

    if (depth >= 4) {
        return '[truncated]';
    }

    if (Array.isArray(value)) {
        return value.slice(0, 20).map((entry) => sanitizeValue(entry, depth + 1));
    }

    return Object.fromEntries(
        Object.entries(value)
            .slice(0, 30)
            .map(([key, entry]) => [key, sanitizeValue(entry, depth + 1)]),
    );
}

function normalizeToolResult(result, fallbackToolId) {
    return {
        success: result?.success !== false,
        toolId: result?.toolId || fallbackToolId,
        duration: result?.duration || 0,
        data: sanitizeValue(result?.data),
        error: result?.error || null,
        timestamp: result?.timestamp || new Date().toISOString(),
    };
}

function extractVerifiedImageEmbeds(toolEvents = []) {
    return toolEvents.flatMap((event) => {
        const data = event?.result?.data || {};
        const embeds = [];

        if (typeof data.markdownImage === 'string' && data.markdownImage.trim()) {
            embeds.push(data.markdownImage.trim());
        }

        if (Array.isArray(data.markdownImages)) {
            embeds.push(...data.markdownImages
                .filter((entry) => typeof entry === 'string' && entry.trim())
                .map((entry) => entry.trim()));
        }

        return embeds;
    });
}

function buildSyntheticResponse({ output, responseId, model, metadata = {} }) {
    return {
        id: responseId || `resp_orch_${Date.now()}`,
        object: 'response',
        created: Math.floor(Date.now() / 1000),
        model: model || null,
        output: [
            {
                type: 'message',
                role: 'assistant',
                content: [
                    {
                        type: 'output_text',
                        text: output || '',
                    },
                ],
            },
        ],
        metadata,
    };
}

async function* createSyntheticStream(response = {}) {
    const text = extractResponseText(response);
    if (text) {
        for (let index = 0; index < text.length; index += SYNTHETIC_STREAM_CHUNK_SIZE) {
            yield {
                type: 'response.output_text.delta',
                delta: text.slice(index, index + SYNTHETIC_STREAM_CHUNK_SIZE),
            };
        }
    }

    yield {
        type: 'response.completed',
        response,
    };
}

class ConversationOrchestrator extends EventEmitter {
    constructor({
        llmClient,
        toolManager = null,
        sessionStore = null,
        memoryService = null,
        embedder = null,
        vectorStore = null,
    } = {}) {
        super();
        this.llmClient = llmClient || {
            createResponse: (params) => createResponse(params),
            complete: async (prompt, options = {}) => {
                const response = await createResponse({
                    input: prompt,
                    stream: false,
                    model: options.model || null,
                });
                return extractResponseText(response);
            },
        };
        this.toolManager = toolManager;
        this.sessionStore = sessionStore;
        this.memoryService = memoryService;
        this.embedder = embedder;
        this.vectorStore = vectorStore;
    }

    async execute(taskConfig = {}) {
        const startedAt = Date.now();
        const sessionId = taskConfig.sessionId || `sdk-${Date.now()}`;
        const result = await this.executeConversation({
            input: taskConfig.input || taskConfig.prompt || '',
            sessionId,
            model: taskConfig.model || null,
            instructions: taskConfig.instructions || null,
            executionProfile: taskConfig.options?.executionProfile || taskConfig.executionProfile || DEFAULT_EXECUTION_PROFILE,
            metadata: taskConfig.options || {},
            stream: false,
        });

        return {
            output: result.output,
            trace: result.trace,
            duration: Date.now() - startedAt,
            sessionId,
            response: result.response,
        };
    }

    async executeConversation({
        input,
        instructions = null,
        contextMessages = [],
        recentMessages = [],
        stream = false,
        model = null,
        toolManager = null,
        toolContext = {},
        loadContextMessages = true,
        loadRecentMessages = true,
        sessionId = 'default',
        taskType = 'chat',
        metadata = {},
        executionProfile = DEFAULT_EXECUTION_PROFILE,
        memoryInput = '',
    } = {}) {
        const startedAt = Date.now();
        const resolvedProfile = normalizeExecutionProfile(executionProfile);
        const objective = extractObjective(input, memoryInput);
        const runtimeToolManager = toolManager || this.toolManager;
        const session = this.sessionStore?.getOrCreate
            ? await this.sessionStore.getOrCreate(sessionId, { mode: taskType })
            : (this.sessionStore?.get ? await this.sessionStore.get(sessionId) : null);
        const resolvedContextMessages = contextMessages.length > 0
            ? contextMessages
            : loadContextMessages !== false && this.memoryService?.process
                ? await this.memoryService.process(sessionId, memoryInput || objective)
                : [];
        const resolvedRecentMessages = recentMessages.length > 0
            ? recentMessages
            : loadRecentMessages !== false && this.sessionStore?.getRecentMessages
                ? await this.sessionStore.getRecentMessages(sessionId, RECENT_TRANSCRIPT_LIMIT)
                : [];

        const toolPolicy = this.buildToolPolicy({
            objective,
            instructions,
            session,
            executionProfile: resolvedProfile,
            toolManager: runtimeToolManager,
        });

        this.emit('task:start', {
            task: { type: taskType, objective },
            sessionId,
            timestamp: Date.now(),
            metadata: {
                ...metadata,
                executionProfile: resolvedProfile,
                tools: toolPolicy.candidateToolIds,
            },
        });

        let finalResponse;
        let output;
        let toolEvents = [];
        let plan = [];
        let runtimeMode = 'plain';
        let executionTrace = [];
        const requestedAutonomyApproval = Boolean(
            metadata?.remoteBuildAutonomyApproved
            || metadata?.remote_build_autonomy_approved
            || metadata?.frontendRemoteBuildAutonomyApproved
            || metadata?.frontend_remote_build_autonomy_approved,
        );
        const autonomyApprovalSource = requestedAutonomyApproval
            ? 'frontend'
            : hasAutonomousRemoteApproval(objective)
                ? 'user'
                : session?.metadata?.remoteBuildAutonomyApproved
                    ? 'session'
                    : null;
        const autonomyApproved = resolvedProfile === REMOTE_BUILD_EXECUTION_PROFILE
            && !hasAutonomyRevocation(objective)
            && (
                requestedAutonomyApproval
                || hasAutonomousRemoteApproval(objective)
                || Boolean(session?.metadata?.remoteBuildAutonomyApproved)
            );
        const autonomyBudget = getRemoteBuildAutonomyBudget();
        const maxAutonomousRounds = autonomyApproved ? autonomyBudget.maxRounds : 1;
        const maxAutonomousToolCalls = autonomyApproved ? autonomyBudget.maxToolCalls : MAX_PLAN_STEPS;
        const autonomyDeadline = autonomyApproved ? startedAt + autonomyBudget.maxDurationMs : startedAt;

        try {
            if (resolvedProfile === REMOTE_BUILD_EXECUTION_PROFILE) {
                executionTrace.push(createExecutionTraceEntry({
                    type: 'approval',
                    name: autonomyApproved
                        ? 'Remote-build autonomy approved'
                        : 'Remote-build autonomy not approved',
                    details: {
                        approved: autonomyApproved,
                        source: autonomyApprovalSource || 'none',
                        maxAutonomousRounds,
                        maxAutonomousToolCalls,
                        maxAutonomousDurationMs: autonomyApproved ? autonomyBudget.maxDurationMs : 0,
                    },
                }));
            }

            const executedStepSignatures = new Set();
            let round = 0;

            while (round < maxAutonomousRounds) {
                if (autonomyApproved && Date.now() >= autonomyDeadline) {
                    executionTrace.push(createExecutionTraceEntry({
                        type: 'budget',
                        name: 'Autonomous execution time budget reached',
                        details: {
                            round,
                            maxRounds: maxAutonomousRounds,
                            toolCalls: toolEvents.length,
                            maxToolCalls: maxAutonomousToolCalls,
                            elapsedMs: Date.now() - startedAt,
                            maxDurationMs: autonomyBudget.maxDurationMs,
                        },
                    }));
                    break;
                }

                if (toolEvents.length >= maxAutonomousToolCalls) {
                    executionTrace.push(createExecutionTraceEntry({
                        type: 'budget',
                        name: 'Autonomous execution tool budget reached',
                        details: {
                            round,
                            maxRounds: maxAutonomousRounds,
                            toolCalls: toolEvents.length,
                            maxToolCalls: maxAutonomousToolCalls,
                            elapsedMs: Date.now() - startedAt,
                            maxDurationMs: autonomyApproved ? autonomyBudget.maxDurationMs : 0,
                        },
                    }));
                    break;
                }

                round += 1;
                let nextPlan = [];
                const planningStartedAt = new Date().toISOString();

                if (round === 1) {
                    const directAction = this.buildDirectAction({
                        objective,
                        session,
                        toolPolicy,
                    });

                    if (directAction) {
                        runtimeMode = 'direct-tool';
                        nextPlan = [directAction];
                    }
                }

                if (nextPlan.length === 0 && toolPolicy.candidateToolIds.length > 0) {
                    nextPlan = await this.planToolUse({
                        objective,
                        instructions,
                        contextMessages: resolvedContextMessages,
                        recentMessages: resolvedRecentMessages,
                        session,
                        executionProfile: resolvedProfile,
                        toolPolicy,
                        model,
                        taskType,
                        toolEvents,
                        autonomyApproved,
                    });
                    if (nextPlan.length > 0 && runtimeMode === 'plain') {
                        runtimeMode = 'planned-tools';
                    }
                }

                nextPlan = nextPlan.filter((step) => {
                    const signature = normalizeStepSignature(step);
                    if (executedStepSignatures.has(signature)) {
                        return false;
                    }
                    executedStepSignatures.add(signature);
                    return true;
                });

                if (autonomyApproved && nextPlan.length > 0) {
                    const remainingToolBudget = Math.max(0, maxAutonomousToolCalls - toolEvents.length);
                    nextPlan = nextPlan.slice(0, remainingToolBudget);
                }

                executionTrace.push(createExecutionTraceEntry({
                    type: 'planning',
                    name: `Plan round ${round}`,
                    startedAt: planningStartedAt,
                    endedAt: new Date().toISOString(),
                    details: {
                        round,
                        autonomyApproved,
                        stepCount: nextPlan.length,
                        steps: nextPlan.map((step) => ({
                            tool: step.tool,
                            reason: step.reason,
                        })),
                    },
                }));

                if (nextPlan.length === 0) {
                    break;
                }

                plan.push(...nextPlan);
                const executionStartedAt = new Date().toISOString();

                const roundToolEvents = await this.executePlan({
                    plan: nextPlan,
                    toolManager: runtimeToolManager,
                    sessionId,
                    executionProfile: resolvedProfile,
                    toolContext,
                });

                toolEvents.push(...roundToolEvents);

                const roundFailed = roundToolEvents.some((event) => event?.result?.success === false);
                executionTrace.push(createExecutionTraceEntry({
                    type: 'execution',
                    name: `Execution round ${round}`,
                    startedAt: executionStartedAt,
                    endedAt: new Date().toISOString(),
                    status: roundFailed ? 'error' : 'completed',
                    details: {
                        round,
                        toolCalls: roundToolEvents.length,
                        failed: roundFailed,
                        tools: roundToolEvents.map((event) => ({
                            tool: event?.toolCall?.function?.name || '',
                            success: event?.result?.success !== false,
                            reason: event?.reason || '',
                            error: event?.result?.error || null,
                        })),
                    },
                }));
                if (!autonomyApproved || roundFailed || roundToolEvents.length === 0) {
                    break;
                }
            }

            finalResponse = await this.buildFinalResponse({
                input,
                objective,
                instructions,
                contextMessages: resolvedContextMessages,
                recentMessages: resolvedRecentMessages,
                model,
                taskType,
                executionProfile: resolvedProfile,
                toolPolicy,
                toolEvents,
                runtimeMode,
                autonomyApproved,
                executionTrace,
            });

            output = extractResponseText(finalResponse);
            if (canRecoverFromInvalidRuntimeResponse({ output, toolEvents, toolPolicy })) {
                const recoveryPlan = this.buildFallbackPlan({
                    objective,
                    session,
                    executionProfile: resolvedProfile,
                    toolPolicy,
                    model,
                }).filter((step) => !executedStepSignatures.has(normalizeStepSignature(step)));

                if (recoveryPlan.length > 0) {
                    runtimeMode = 'recovered-tools';
                    const recoveryPlanningStartedAt = new Date().toISOString();
                    recoveryPlan.forEach((step) => executedStepSignatures.add(normalizeStepSignature(step)));
                    executionTrace.push(createExecutionTraceEntry({
                        type: 'planning',
                        name: 'Recovery plan',
                        startedAt: recoveryPlanningStartedAt,
                        endedAt: new Date().toISOString(),
                        details: {
                            invalidModelResponse: true,
                            stepCount: recoveryPlan.length,
                            steps: recoveryPlan.map((step) => ({
                                tool: step.tool,
                                reason: step.reason,
                            })),
                        },
                    }));

                    const recoveryExecutionStartedAt = new Date().toISOString();
                    const recoveryToolEvents = await this.executePlan({
                        plan: recoveryPlan,
                        toolManager: runtimeToolManager,
                        sessionId,
                        executionProfile: resolvedProfile,
                        toolContext,
                    });
                    toolEvents.push(...recoveryToolEvents);
                    executionTrace.push(createExecutionTraceEntry({
                        type: 'execution',
                        name: 'Recovery execution',
                        startedAt: recoveryExecutionStartedAt,
                        endedAt: new Date().toISOString(),
                        status: recoveryToolEvents.some((event) => event?.result?.success === false) ? 'error' : 'completed',
                        details: {
                            toolCalls: recoveryToolEvents.length,
                            tools: recoveryToolEvents.map((event) => ({
                                tool: event?.toolCall?.function?.name || '',
                                success: event?.result?.success !== false,
                                error: event?.result?.error || null,
                            })),
                        },
                    }));

                    finalResponse = await this.buildFinalResponse({
                        input,
                        objective,
                        instructions,
                        contextMessages: resolvedContextMessages,
                        recentMessages: resolvedRecentMessages,
                        model,
                        taskType,
                        executionProfile: resolvedProfile,
                        toolPolicy,
                        toolEvents,
                        runtimeMode,
                        autonomyApproved,
                        executionTrace,
                    });
                    output = extractResponseText(finalResponse);
                }
            }
            await this.persistConversationState({
                sessionId,
                userText: objective,
                assistantText: output,
                responseId: finalResponse.id,
                toolEvents,
                executionProfile: resolvedProfile,
                autonomyApproved,
            });

            const trace = {
                sessionId,
                taskType,
                executionProfile: resolvedProfile,
                runtimeMode,
                toolCount: toolEvents.length,
                tools: toolPolicy.candidateToolIds,
                duration: Date.now() - startedAt,
                timestamp: new Date().toISOString(),
                autonomyApproved,
                executionTrace,
            };

            this.emit('task:complete', {
                task: { type: taskType, objective },
                sessionId,
                timestamp: Date.now(),
                result: {
                    success: true,
                    output,
                    responseId: finalResponse.id,
                    trace,
                    duration: trace.duration,
                },
            });

            if (stream) {
                return {
                    success: true,
                    sessionId,
                    response: createSyntheticStream(finalResponse),
                    output,
                    trace,
                };
            }

            return {
                success: true,
                sessionId,
                output,
                response: finalResponse,
                trace,
            };
        } catch (error) {
            this.emit('task:error', {
                task: { type: taskType, objective },
                sessionId,
                timestamp: Date.now(),
                error: error.message,
                stack: error.stack,
                metadata: {
                    ...metadata,
                    executionProfile: resolvedProfile,
                },
            });
            throw error;
        }
    }

    buildToolPolicy({ objective = '', instructions = '', session = null, executionProfile = DEFAULT_EXECUTION_PROFILE, toolManager = null }) {
        const allowedToolIds = (PROFILE_TOOL_ALLOWLISTS[executionProfile] || PROFILE_TOOL_ALLOWLISTS[DEFAULT_EXECUTION_PROFILE])
            .filter((toolId) => toolManager?.getTool?.(toolId));
        const prompt = `${objective || ''}\n${instructions || ''}`.toLowerCase();
        const candidates = new Set();
        const hasUrl = /https?:\/\//i.test(prompt);
        const hasExplicitWebResearchIntent = hasExplicitWebResearchIntentText(prompt);
        const hasExplicitScrapeIntent = /\b(scrape|extract|selector|structured|parse)\b/.test(prompt);
        const hasImageIntent = /\b(image|images|visual|visuals|illustration|illustrations|photo|photos|hero image|background image|cover image)\b/.test(prompt);
        const hasUnsplashIntent = /\bunsplash\b/.test(prompt);
        const hasImageUrlIntent = hasImageIntent && /\b(url|link)\b/.test(prompt);
        const hasDirectImageUrl = /https?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg)(?:\?\S*)?/i.test(prompt);
        const sshContext = resolveSshRequestContext(objective, session);
        const hasSshDefaults = hasUsableSshDefaults();
        const hasReachableSshTarget = Boolean(hasSshDefaults || sshContext.target?.host);

        if (executionProfile === REMOTE_BUILD_EXECUTION_PROFILE) {
            [
                'web-search',
                'web-fetch',
                'file-read',
                'file-search',
                'tool-doc-read',
            ].forEach((toolId) => allowedToolIds.includes(toolId) && candidates.add(toolId));

            if (allowedToolIds.includes('ssh-execute') && (sshContext.shouldTreatAsSsh || executionProfile === REMOTE_BUILD_EXECUTION_PROFILE)) {
                candidates.add('ssh-execute');
            }
            if (allowedToolIds.includes('remote-command') && (sshContext.shouldTreatAsSsh || executionProfile === REMOTE_BUILD_EXECUTION_PROFILE)) {
                candidates.add('remote-command');
            }
            if (allowedToolIds.includes('docker-exec')) {
                candidates.add('docker-exec');
            }
            if (allowedToolIds.includes('code-sandbox') && hasExplicitLocalSandboxIntent(prompt)) {
                candidates.add('code-sandbox');
            }
            if (hasImageIntent && allowedToolIds.includes('image-generate')) {
                candidates.add('image-generate');
            }
            if (hasUnsplashIntent && allowedToolIds.includes('image-search-unsplash')) {
                candidates.add('image-search-unsplash');
            }
            if ((hasImageUrlIntent || hasDirectImageUrl) && allowedToolIds.includes('image-from-url')) {
                candidates.add('image-from-url');
            }
            if (allowedToolIds.includes('file-write') && /\b(write|create|update|edit|save|patch|fix)\b/.test(prompt)) {
                candidates.add('file-write');
            }
            if (allowedToolIds.includes('file-mkdir') && /\b(create|make|mkdir)\b/.test(prompt)) {
                candidates.add('file-mkdir');
            }
        } else {
            if (allowedToolIds.includes('ssh-execute') && (sshContext.shouldTreatAsSsh || /\b(remote server|remote host|remote machine)\b/.test(prompt))) {
                candidates.add('ssh-execute');
            }
            if (allowedToolIds.includes('remote-command') && (sshContext.shouldTreatAsSsh || /\b(remote server|remote host|remote machine)\b/.test(prompt))) {
                candidates.add('remote-command');
            }
            if ((hasExplicitWebResearchIntent || /\b(latest|current|today|news|research|look up|search|browse)\b/.test(prompt)) && allowedToolIds.includes('web-search')) {
                candidates.add('web-search');
            }
            if (hasExplicitScrapeIntent) {
                if (allowedToolIds.includes('web-search')) {
                    candidates.add('web-search');
                }
                if (allowedToolIds.includes('web-scrape')) {
                    candidates.add('web-scrape');
                }
            }
            if (hasExplicitWebResearchIntent && hasUrl && allowedToolIds.includes('web-fetch')) {
                candidates.add('web-fetch');
            }
            if (hasUrl && allowedToolIds.includes('web-fetch')) {
                candidates.add(hasExplicitScrapeIntent && allowedToolIds.includes('web-scrape')
                    ? 'web-scrape'
                    : 'web-fetch');
            }
            if (hasImageIntent && /\b(generate|create|make|design)\b/.test(prompt) && allowedToolIds.includes('image-generate')) {
                candidates.add('image-generate');
            }
            if ((hasUnsplashIntent || (hasImageIntent && /\b(search|find|browse|reference|stock)\b/.test(prompt))) && allowedToolIds.includes('image-search-unsplash')) {
                candidates.add('image-search-unsplash');
            }
            if ((hasImageUrlIntent || hasDirectImageUrl) && allowedToolIds.includes('image-from-url')) {
                candidates.add('image-from-url');
            }
            if (/\b(read|open|show|print|cat)\b[\s\S]{0,40}\bfile\b/.test(prompt) && allowedToolIds.includes('file-read')) {
                candidates.add('file-read');
            }
            if (/\b(find|search|locate|list)\b[\s\S]{0,40}\bfiles?\b/.test(prompt) && allowedToolIds.includes('file-search')) {
                candidates.add('file-search');
            }
            if (/\b(write|save|create|update|edit)\b[\s\S]{0,40}\bfile\b/.test(prompt) && allowedToolIds.includes('file-write')) {
                candidates.add('file-write');
            }
            if (/\b(create|make|mkdir)\b[\s\S]{0,40}\b(folder|directory)\b/.test(prompt) && allowedToolIds.includes('file-mkdir')) {
                candidates.add('file-mkdir');
            }
            if (/\btool\b[\s\S]{0,40}\b(help|doc|docs|documentation|how)\b/.test(prompt) && allowedToolIds.includes('tool-doc-read')) {
                candidates.add('tool-doc-read');
            }
        }

        return {
            executionProfile,
            allowedToolIds,
            candidateToolIds: allowedToolIds.filter((toolId) => candidates.has(toolId)),
            hasSshDefaults,
            hasReachableSshTarget,
            sshRuntimeTarget: formatSshRuntimeTarget(sshContext.target),
            toolDescriptions: Object.fromEntries(
                allowedToolIds.map((toolId) => [
                    toolId,
                    toolManager?.getTool?.(toolId)?.description
                        || toolManager?.getTool?.(toolId)?.name
                        || toolId,
                ]),
            ),
        };
    }

    buildDirectAction({ objective = '', session = null, toolPolicy = {} }) {
        const researchQuery = extractExplicitWebResearchQuery(objective);
        const remoteToolId = getPreferredRemoteToolId(toolPolicy);
        if (toolPolicy.executionProfile !== REMOTE_BUILD_EXECUTION_PROFILE
            && toolPolicy.candidateToolIds.includes('web-search')
            && researchQuery) {
            return {
                tool: 'web-search',
                reason: 'Explicit research request should start with Perplexity-backed web search.',
                params: {
                    query: researchQuery,
                    engine: 'perplexity',
                    limit: 5,
                    region: 'us-en',
                    timeRange: 'all',
                    includeSnippets: true,
                    includeUrls: true,
                },
            };
        }

        if (!remoteToolId) {
            return null;
        }

        const sshContext = resolveSshRequestContext(objective, session);
        if (!sshContext.directParams) {
            return null;
        }

        return {
            tool: remoteToolId,
            reason: 'Direct SSH command inferred from the user request.',
            params: sshContext.directParams,
        };
    }

    buildFallbackPlan({ objective = '', session = null, executionProfile = DEFAULT_EXECUTION_PROFILE, toolPolicy = {} }) {
        if (!toolPolicy?.candidateToolIds?.length) {
            return [];
        }

        const prompt = String(objective || '').trim();
        const firstUrl = extractFirstUrl(prompt);
        const remoteToolId = getPreferredRemoteToolId(toolPolicy);
        const directAction = this.buildDirectAction({
            objective,
            session,
            toolPolicy,
        });

        if (directAction) {
            return [directAction];
        }

        if (toolPolicy.candidateToolIds.includes('web-search') && hasExplicitWebResearchIntentText(prompt)) {
            const query = extractExplicitWebResearchQuery(prompt) || prompt;
            return [{
                tool: 'web-search',
                reason: 'Fallback for explicit research intent.',
                params: {
                    query,
                    engine: 'perplexity',
                    limit: 5,
                    region: 'us-en',
                    timeRange: 'all',
                    includeSnippets: true,
                    includeUrls: true,
                },
            }];
        }

        if (firstUrl && /\b(scrape|extract|selector|structured|parse)\b/i.test(prompt) && toolPolicy.candidateToolIds.includes('web-scrape')) {
            return [{
                tool: 'web-scrape',
                reason: 'Deterministic fallback for explicit scrape intent.',
                params: {
                    url: firstUrl,
                    browser: true,
                },
            }];
        }

        if (firstUrl && toolPolicy.candidateToolIds.includes('web-fetch')) {
            return [{
                tool: 'web-fetch',
                reason: 'Deterministic fallback for explicit URL retrieval.',
                params: {
                    url: firstUrl,
                },
            }];
        }

        if (toolPolicy.candidateToolIds.includes('image-from-url') && firstUrl && /\.(png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(firstUrl)) {
            return [{
                tool: 'image-from-url',
                reason: 'Deterministic fallback for explicit image URL usage.',
                params: {
                    url: firstUrl,
                },
            }];
        }

        if (toolPolicy.candidateToolIds.includes('image-search-unsplash') && /\bunsplash\b/i.test(prompt)) {
            const query = inferFallbackUnsplashQuery(prompt);
            if (query) {
                return [{
                    tool: 'image-search-unsplash',
                    reason: 'Deterministic fallback for explicit Unsplash request.',
                    params: {
                        query,
                        perPage: 6,
                    },
                }];
            }
        }

        if (remoteToolId
            && (executionProfile === REMOTE_BUILD_EXECUTION_PROFILE
                || toolPolicy.hasReachableSshTarget
                || /\b(ssh|server|host|cluster|k3s|k8s|kubernetes|kubectl|deploy|deployment|docker)\b/i.test(prompt))) {
            const sshContext = resolveSshRequestContext(objective, session);
            const command = sshContext.directParams?.command || inferFallbackSshCommand(prompt, executionProfile);

            if (command) {
                return [{
                    tool: remoteToolId,
                    reason: 'Fallback for explicit server or remote-build intent.',
                    params: sshContext.target?.host
                        ? {
                            host: sshContext.target.host,
                            ...(sshContext.target.username ? { username: sshContext.target.username } : {}),
                            ...(sshContext.target.port ? { port: sshContext.target.port } : {}),
                            command,
                        }
                        : {
                            command,
                        },
                }];
            }
        }

        return [];
    }

    async planToolUse({
        objective = '',
        instructions = '',
        contextMessages = [],
        recentMessages = [],
        session = null,
        executionProfile = DEFAULT_EXECUTION_PROFILE,
        toolPolicy = {},
        model = null,
        taskType = 'chat',
        toolEvents = [],
        autonomyApproved = false,
    }) {
        if (!toolPolicy.candidateToolIds.length) {
            return [];
        }

        const remoteToolId = getPreferredRemoteToolId(toolPolicy);
        const toolCatalog = toolPolicy.candidateToolIds
            .map((toolId) => `- ${toolId}: ${toolPolicy.toolDescriptions?.[toolId] || toolId}`)
            .join('\n');
        const planningPrompt = String(objective || '');
        const prompt = [
            'You are planning tool usage for an application-owned agent runtime.',
            'Return JSON only.',
            'If tools are unnecessary, return {"steps":[]}.',
            `Execution profile: ${executionProfile}`,
            `Task type: ${taskType}`,
            'Candidate tools:',
            toolCatalog,
            '',
            'User request:',
            objective || '(empty)',
            '',
            'Runtime instructions:',
            instructions || '(none)',
            '',
            'Supplemental recalled context:',
            Array.isArray(contextMessages) && contextMessages.length > 0 ? contextMessages.join('\n') : '(none)',
            '',
            'Recent transcript:',
            Array.isArray(recentMessages) && recentMessages.length > 0
                ? recentMessages.map((message) => `${message.role}: ${normalizeMessageText(message.content || '')}`).join('\n')
                : '(none)',
            '',
            'Verified tool results from this run so far:',
            toolEvents.length > 0
                ? JSON.stringify(summarizeToolEventsForPlanner(toolEvents), null, 2)
                : '(none)',
            '',
            'Return exactly this shape:',
            '{"steps":[{"tool":"tool-id","reason":"why","params":{}}]}',
            `Use at most ${MAX_PLAN_STEPS} steps.`,
            'Only use tools listed above.',
            'Do not invent SSH hosts, usernames, file paths, or credentials.',
            ...(autonomyApproved && executionProfile === REMOTE_BUILD_EXECUTION_PROFILE
                ? [
                    'The user has already approved continuing through obvious next remote-build steps.',
                    'Do not stop after a single inspection if the next server action is routine and clearly implied by the verified results.',
                    'Keep moving through setup, inspection, verification, and routine fixes without asking for confirmation between each step.',
                    'Keep going until the goal is reached, a real blocker appears, or the autonomous runtime budget is exhausted.',
                    'Stop only when blocked by missing secrets, DNS/domain values, ambiguous product decisions, destructive resets/wipes, repeated tool failures, or an exhausted autonomy budget.',
                ]
                : []),
            ...(remoteToolId && toolPolicy.hasReachableSshTarget
                ? [
                    `For ${remoteToolId}, host, username, and port may be omitted when the runtime already has a configured default target or sticky session target.`,
                    `For server work, prefer trying ${remoteToolId} before asking the user for host details again.`,
                    'Assume a Linux server and prefer Ubuntu-friendly commands unless tool results prove otherwise.',
                    'For remote-build work, verify architecture with uname -m before installing binaries and prefer arm64/aarch64 assets when applicable.',
                    'Prefer common built-ins and standard utilities. If a nonstandard tool may be missing, use a fallback such as find/grep instead of rg, ss instead of netstat, ip addr instead of ifconfig, and docker compose instead of docker-compose.',
                ]
                : remoteToolId
                    ? [
                        `${remoteToolId} is still available for this request even if the runtime target is not yet verified in this prompt.`,
                        `Do not claim ${remoteToolId} is unavailable; call it when SSH or remote-build work is requested and let the tool return the actual missing-target or credential error if configuration is incomplete.`,
                        'When planning server commands, prefer Ubuntu-friendly standard utilities and avoid assuming rg, ifconfig, netstat, or docker-compose are installed.',
                      ]
                    : []),
        ].join('\n');

        const plannerOutput = await this.completeText(prompt, { model });
        const parsed = safeJsonParse(plannerOutput);
        const requestedSteps = (Array.isArray(parsed?.steps) ? parsed.steps : [])
            .slice(0, MAX_PLAN_STEPS)
            .map((step) => ({
                tool: typeof step?.tool === 'string' ? step.tool.trim() : '',
                reason: typeof step?.reason === 'string' ? step.reason.trim() : '',
                params: step?.params && typeof step.params === 'object' ? step.params : {},
            }))
            .filter((step) => step.tool && toolPolicy.candidateToolIds.includes(step.tool));

        if (requestedSteps.length > 0) {
            return requestedSteps;
        }

        return this.buildFallbackPlan({
            objective,
            session,
            executionProfile,
            toolPolicy,
        }).slice(0, MAX_PLAN_STEPS);
    }

    async executePlan({ plan = [], toolManager = null, sessionId = 'default', executionProfile = DEFAULT_EXECUTION_PROFILE, toolContext = {} }) {
        const toolEvents = [];
        if (!toolManager) {
            return toolEvents;
        }

        for (let index = 0; index < plan.length; index += 1) {
            const step = plan[index];
            const toolCall = {
                id: `tool_call_${index + 1}`,
                type: 'function',
                function: {
                    name: step.tool,
                    arguments: JSON.stringify(step.params || {}),
                },
            };

            try {
                const result = await toolManager.executeTool(step.tool, step.params || {}, {
                    sessionId,
                    executionProfile,
                    toolManager,
                    tools: {
                        get: (toolId) => toolManager.getTool(toolId),
                    },
                    timestamp: new Date().toISOString(),
                    ...toolContext,
                });

                toolEvents.push({
                    toolCall,
                    result: normalizeToolResult(result, step.tool),
                    reason: step.reason,
                });

                if (result?.success === false) {
                    break;
                }
            } catch (error) {
                toolEvents.push({
                    toolCall,
                    result: normalizeToolResult({
                        success: false,
                        toolId: step.tool,
                        error: error.message,
                    }, step.tool),
                    reason: step.reason,
                });
                break;
            }
        }

        return toolEvents;
    }

    async buildFinalResponse({
        input,
        objective = '',
        instructions = '',
        contextMessages = [],
        recentMessages = [],
        model = null,
        taskType = 'chat',
        executionProfile = DEFAULT_EXECUTION_PROFILE,
        toolPolicy = {},
        toolEvents = [],
        runtimeMode = 'plain',
        autonomyApproved = false,
        executionTrace = [],
    }) {
        const runtimeInstructions = this.buildRuntimeInstructions({
            baseInstructions: instructions,
            executionProfile,
            allowedToolIds: toolPolicy.allowedToolIds,
            toolEvents,
            toolPolicy,
        });

        if (toolEvents.length === 0) {
            const response = await this.llmClient.createResponse({
                input,
                instructions: runtimeInstructions,
                contextMessages,
                recentMessages,
                stream: false,
                model,
                enableAutomaticToolCalls: false,
            });

            return this.withResponseMetadata(response, {
                executionProfile,
                runtimeMode,
                toolEvents: [],
                toolPolicy,
                autonomyApproved,
                executionTrace,
            });
        }

        const synthesisPrompt = [
            'Use the verified tool results below to answer the user.',
            'If a tool failed, state the exact failure plainly.',
            'Do not generate SVG placeholders, HTML overlays, or fake image mockups when verified image URLs are available.',
            ...(autonomyApproved && executionProfile === REMOTE_BUILD_EXECUTION_PROFILE
                ? [
                    'The user has already approved continuing through obvious remote-build steps.',
                    'Summarize the work completed in this run and only ask for input if you hit a real blocker or need an external decision.',
                ]
                : []),
            `Task type: ${taskType}`,
            '',
            'User request:',
            objective || '(empty)',
            '',
            ...(extractVerifiedImageEmbeds(toolEvents).length > 0
                ? [
                    'Verified embeddable images:',
                    ...extractVerifiedImageEmbeds(toolEvents),
                    '',
                    'Reuse those image embeds directly when they satisfy the request.',
                    '',
                ]
                : []),
            'Verified tool results:',
            JSON.stringify(toolEvents.map((event) => ({
                tool: event.toolCall?.function?.name,
                reason: event.reason || '',
                result: event.result,
            })), null, 2),
        ].join('\n');

        const response = await this.llmClient.createResponse({
            input: synthesisPrompt,
            instructions: runtimeInstructions,
            contextMessages,
            recentMessages,
            stream: false,
            model,
            enableAutomaticToolCalls: false,
        });

        return this.withResponseMetadata(response, {
            executionProfile,
            runtimeMode,
            toolEvents,
            toolPolicy,
            autonomyApproved,
            executionTrace,
        });
    }

    buildRuntimeInstructions({ baseInstructions = '', executionProfile = DEFAULT_EXECUTION_PROFILE, allowedToolIds = [], toolEvents = [], toolPolicy = {} }) {
        const remoteToolId = getPreferredRemoteToolId(toolPolicy);
        const parts = [
            String(baseInstructions || '').trim(),
            `Execution profile: ${executionProfile}.`,
        ];

        if (allowedToolIds.length > 0) {
            parts.push(`Runtime-available tools for this request: ${allowedToolIds.join(', ')}.`);
            parts.push('Do not claim tools are unavailable if they are listed as runtime-available tools.');
        }

        if (toolEvents.length > 0) {
            parts.push('Use the verified tool results as the source of truth over guesses.');
            parts.push('When a verified tool result includes image URLs or markdown image snippets, you may embed them with standard markdown image syntax.');
            parts.push('Do not fabricate SVG overlays, inline HTML image placeholders, or other visual stand-ins when verified image URLs are available.');
        }

        if (remoteToolId && toolPolicy.hasReachableSshTarget) {
            parts.push(`SSH runtime target is already available${toolPolicy.sshRuntimeTarget ? ` (${toolPolicy.sshRuntimeTarget})` : ''}.`);
            parts.push(`For server work, try ${remoteToolId} against the configured default or sticky session target before asking for host details again.`);
            parts.push('Only ask for SSH connection details after an actual tool failure shows the target is missing or incorrect.');
            parts.push('Prefer Ubuntu/Linux standard commands and verify architecture with `uname -m` before installing binaries or choosing downloads.');
            parts.push('Use fallbacks when common extras are missing: `find`/`grep -R` for `rg`, `ss -tulpn` for `netstat`, `ip addr` for `ifconfig`, and `docker compose` for `docker-compose`.');
        } else if (remoteToolId) {
            parts.push(`${remoteToolId} is available for this request even if the target is not currently verified in the prompt context.`);
            parts.push(`Do not claim the SSH tool is unavailable. Try ${remoteToolId} for explicit SSH or remote-build work and report the concrete tool error if the runtime lacks a configured target.`);
            parts.push('When constructing remote commands, assume Ubuntu/Linux defaults first and avoid depending on nonstandard utilities unless you have verified they exist.');
        }

        return parts.filter(Boolean).join('\n\n');
    }

    withResponseMetadata(response = {}, metadata = {}) {
        const existing = response?.metadata && typeof response.metadata === 'object'
            ? response.metadata
            : {};

        return {
            ...response,
            metadata: {
                ...existing,
                ...metadata,
            },
        };
    }

    async persistConversationState({
        sessionId,
        userText,
        assistantText,
        responseId,
        toolEvents = [],
        executionProfile = DEFAULT_EXECUTION_PROFILE,
        autonomyApproved = false,
    }) {
        if (this.sessionStore?.recordResponse) {
            await this.sessionStore.recordResponse(sessionId, responseId);
        }

        if (this.memoryService?.rememberResponse) {
            this.memoryService.rememberResponse(sessionId, assistantText);
        }

        if (this.sessionStore?.appendMessages) {
            await this.sessionStore.appendMessages(sessionId, [
                { role: 'user', content: userText },
                { role: 'assistant', content: assistantText },
            ]);
        }

        const sshMetadata = extractSshSessionMetadataFromToolEvents(toolEvents);
        if (this.sessionStore?.update) {
            const currentSession = this.sessionStore?.get
                ? await this.sessionStore.get(sessionId)
                : null;
            const projectMemory = mergeProjectMemory(
                currentSession?.metadata?.projectMemory || {},
                buildProjectMemoryUpdate({
                    userText,
                    assistantText,
                    toolEvents,
                }),
            );

            await this.sessionStore.update(sessionId, {
                metadata: {
                    ...(sshMetadata || {}),
                    ...(executionProfile === REMOTE_BUILD_EXECUTION_PROFILE
                        ? { remoteBuildAutonomyApproved: autonomyApproved }
                        : {}),
                    projectMemory,
                },
            });
        }
    }

    async completeText(prompt, options = {}) {
        if (typeof this.llmClient?.complete === 'function') {
            return this.llmClient.complete(prompt, options);
        }

        const response = await this.llmClient.createResponse({
            input: prompt,
            stream: false,
            model: options.model || null,
            enableAutomaticToolCalls: false,
        });

        return extractResponseText(response);
    }
}

module.exports = {
    ConversationOrchestrator,
    normalizeExecutionProfile,
    DEFAULT_EXECUTION_PROFILE,
    REMOTE_BUILD_EXECUTION_PROFILE,
};
