const EventEmitter = require('events');
const { createResponse } = require('./openai-client');
const { extractResponseText } = require('./artifacts/artifact-service');
const settingsController = require('./routes/admin/settings.controller');
const {
    resolveSshRequestContext,
    extractSshSessionMetadataFromToolEvents,
} = require('./ai-route-utils');

const DEFAULT_EXECUTION_PROFILE = 'default';
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

        try {
            const directAction = this.buildDirectAction({
                objective,
                session,
                toolPolicy,
            });

            if (directAction) {
                runtimeMode = 'direct-tool';
                plan = [directAction];
            } else if (toolPolicy.candidateToolIds.length > 0) {
                plan = await this.planToolUse({
                    objective,
                    instructions,
                    contextMessages: resolvedContextMessages,
                    recentMessages: resolvedRecentMessages,
                    executionProfile: resolvedProfile,
                    toolPolicy,
                    model,
                    taskType,
                });
                if (plan.length > 0) {
                    runtimeMode = 'planned-tools';
                }
            }

            if (plan.length > 0) {
                toolEvents = await this.executePlan({
                    plan,
                    toolManager: runtimeToolManager,
                    sessionId,
                    executionProfile: resolvedProfile,
                    toolContext,
                });
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
            });

            output = extractResponseText(finalResponse);
            await this.persistConversationState({
                sessionId,
                userText: objective,
                assistantText: output,
                responseId: finalResponse.id,
                toolEvents,
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
        const hasExplicitWebResearchIntent = /\b(web research|research|look up|search for|search the web|browse the web|search online|browse online)\b/.test(prompt);
        const hasExplicitScrapeIntent = /\b(scrape|extract|selector|structured|parse)\b/.test(prompt);
        const hasImageIntent = /\b(image|images|visual|visuals|illustration|illustrations|photo|photos|hero image|background image|cover image)\b/.test(prompt);
        const hasUnsplashIntent = /\bunsplash\b/.test(prompt);
        const hasImageUrlIntent = hasImageIntent && /\b(url|link)\b/.test(prompt);
        const hasDirectImageUrl = /https?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg)(?:\?\S*)?/i.test(prompt);
        const sshContext = resolveSshRequestContext(objective, session);
        const hasSshDefaults = hasUsableSshDefaults();

        if (executionProfile === REMOTE_BUILD_EXECUTION_PROFILE) {
            [
                'web-search',
                'web-fetch',
                'file-read',
                'file-search',
                'tool-doc-read',
            ].forEach((toolId) => allowedToolIds.includes(toolId) && candidates.add(toolId));

            if (allowedToolIds.includes('ssh-execute') && hasSshDefaults && (sshContext.shouldTreatAsSsh || executionProfile === REMOTE_BUILD_EXECUTION_PROFILE)) {
                candidates.add('ssh-execute');
            }
            if (allowedToolIds.includes('docker-exec')) {
                candidates.add('docker-exec');
            }
            if (allowedToolIds.includes('code-sandbox')) {
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
        if (!toolPolicy.candidateToolIds.includes('ssh-execute')) {
            return null;
        }

        const sshContext = resolveSshRequestContext(objective, session);
        if (!sshContext.directParams) {
            return null;
        }

        return {
            tool: 'ssh-execute',
            reason: 'Direct SSH command inferred from the user request.',
            params: sshContext.directParams,
        };
    }

    async planToolUse({
        objective = '',
        instructions = '',
        contextMessages = [],
        recentMessages = [],
        executionProfile = DEFAULT_EXECUTION_PROFILE,
        toolPolicy = {},
        model = null,
        taskType = 'chat',
    }) {
        if (!toolPolicy.candidateToolIds.length) {
            return [];
        }

        const toolCatalog = toolPolicy.candidateToolIds
            .map((toolId) => `- ${toolId}: ${toolPolicy.toolDescriptions?.[toolId] || toolId}`)
            .join('\n');
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
            'Return exactly this shape:',
            '{"steps":[{"tool":"tool-id","reason":"why","params":{}}]}',
            `Use at most ${MAX_PLAN_STEPS} steps.`,
            'Only use tools listed above.',
            'Do not invent SSH hosts, usernames, file paths, or credentials.',
        ].join('\n');

        const plannerOutput = await this.completeText(prompt, { model });
        const parsed = safeJsonParse(plannerOutput);
        const requestedSteps = Array.isArray(parsed?.steps) ? parsed.steps : [];

        return requestedSteps
            .slice(0, MAX_PLAN_STEPS)
            .map((step) => ({
                tool: typeof step?.tool === 'string' ? step.tool.trim() : '',
                reason: typeof step?.reason === 'string' ? step.reason.trim() : '',
                params: step?.params && typeof step.params === 'object' ? step.params : {},
            }))
            .filter((step) => step.tool && toolPolicy.candidateToolIds.includes(step.tool));
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
    }) {
        const runtimeInstructions = this.buildRuntimeInstructions({
            baseInstructions: instructions,
            executionProfile,
            allowedToolIds: toolPolicy.allowedToolIds,
            toolEvents,
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
            });
        }

        const synthesisPrompt = [
            'Use the verified tool results below to answer the user.',
            'If a tool failed, state the exact failure plainly.',
            `Task type: ${taskType}`,
            '',
            'User request:',
            objective || '(empty)',
            '',
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
        });
    }

    buildRuntimeInstructions({ baseInstructions = '', executionProfile = DEFAULT_EXECUTION_PROFILE, allowedToolIds = [], toolEvents = [] }) {
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

    async persistConversationState({ sessionId, userText, assistantText, responseId, toolEvents = [] }) {
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
        if (sshMetadata && this.sessionStore?.update) {
            await this.sessionStore.update(sessionId, { metadata: sshMetadata });
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
