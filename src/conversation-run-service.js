'use strict';

const { ensureRuntimeToolManager } = require('./runtime-tool-manager');
const { executeConversationRuntime } = require('./runtime-execution');
const {
    buildInstructionsWithArtifacts,
    buildArtifactCompletionMessage,
    canonicalizeRemoteToolId,
    extractSshSessionMetadataFromToolEvents,
    formatSshToolResult,
    inferRequestedOutputFormat,
    maybeGenerateOutputArtifact,
    maybePrepareImagesForArtifactPrompt,
    resolveArtifactContextIds,
} = require('./ai-route-utils');
const { extractResponseText } = require('./artifacts/artifact-service');
const { buildProjectMemoryUpdate, mergeProjectMemory } = require('./project-memory');
const { buildContinuityInstructions } = require('./runtime-prompts');
const { resolveSessionScope } = require('./session-scope');

class ConversationRunService {
    constructor({
        app,
        sessionStore,
        memoryService,
    }) {
        this.app = app;
        this.sessionStore = sessionStore;
        this.memoryService = memoryService;
    }

    buildMemoryMetadata(ownerId = null, metadata = {}, session = null) {
        const memoryScope = resolveSessionScope({
            mode: metadata?.taskType || metadata?.mode || 'chat',
            taskType: metadata?.taskType || metadata?.mode || 'chat',
            clientSurface: metadata?.clientSurface || metadata?.client_surface || '',
            memoryScope: metadata?.memoryScope || metadata?.memory_scope || '',
            metadata,
        }, session || null);

        return {
            ...(ownerId ? { ownerId } : {}),
            ...(memoryScope ? { memoryScope } : {}),
            ...(metadata?.memoryKeywords ? { memoryKeywords: metadata.memoryKeywords } : {}),
            ...(metadata?.clientSurface ? { sourceSurface: metadata.clientSurface } : {}),
        };
    }

    async runChatTurn({
        sessionId,
        ownerId = null,
        message,
        session = null,
        model = null,
        reasoningEffort = null,
        executionProfile = null,
        metadata = {},
        requestedToolIds = [],
        policy = null,
    }) {
        const resolvedSession = session || (ownerId
            ? await this.sessionStore.getOwned(sessionId, ownerId)
            : await this.sessionStore.get(sessionId));

        if (!resolvedSession) {
            const error = new Error('Session not found');
            error.statusCode = 404;
            throw error;
        }

        const runtimeToolManager = await ensureRuntimeToolManager(this.app);
        const instructions = await buildInstructionsWithArtifacts(
            resolvedSession,
            buildContinuityInstructions(),
            [],
        );

        const execution = await executeConversationRuntime(this.app, {
            input: message,
            session: resolvedSession,
            sessionId,
            memoryInput: message,
            previousResponseId: resolvedSession.previousResponseId,
            instructions,
            stream: false,
            model,
            reasoningEffort,
            toolManager: runtimeToolManager,
            toolContext: {
                sessionId,
                route: '/api/workloads',
                transport: 'worker',
                memoryService: this.memoryService,
                ownerId,
                workloadService: this.app?.locals?.agentWorkloadService,
                opencodeService: this.app?.locals?.opencodeService || null,
                subAgentDepth: Number(metadata?.subAgentDepth || 0),
                subAgentOrchestrationId: metadata?.subAgentOrchestrationId || null,
            },
            executionProfile,
            enableAutomaticToolCalls: true,
            enableConversationExecutor: true,
            taskType: metadata.taskType || 'chat',
            metadata,
            ownerId,
            requestedToolIds,
            toolBudget: policy ? {
                maxRounds: policy.maxRounds,
                maxToolCalls: policy.maxToolCalls,
                maxDurationMs: policy.maxDurationMs,
            } : null,
        });

        const response = execution.response;
        const outputText = extractResponseText(response);
        const toolEvents = response?.metadata?.toolEvents || [];
        const memoryMetadata = this.buildMemoryMetadata(ownerId, metadata, resolvedSession);

        if (!execution.handledPersistence) {
            await this.sessionStore.recordResponse(
                sessionId,
                response.id,
                response?.metadata?.promptState ? { promptState: response.metadata.promptState } : null,
            );
            if (outputText) {
                this.memoryService.rememberResponse(sessionId, outputText, memoryMetadata);
            }
            await this.sessionStore.appendMessages(sessionId, [
                { role: 'user', content: message },
                { role: 'assistant', content: outputText },
            ]);
        }

        const sshMetadata = extractSshSessionMetadataFromToolEvents(toolEvents);
        if (sshMetadata) {
            await this.sessionStore.update(sessionId, { metadata: sshMetadata });
        }

        const deferredArtifact = await this.maybeGenerateDeferredArtifact({
            runtimeToolManager,
            sessionId,
            ownerId,
            session: resolvedSession,
            message,
            mode: metadata.taskType || 'chat',
            responseId: response?.id || null,
            outputText,
            model,
            reasoningEffort,
            metadata,
        });

        await this.updateProjectMemory(sessionId, ownerId, {
            userText: message,
            assistantText: outputText,
            toolEvents,
            artifacts: deferredArtifact.artifacts,
        });

        return {
            execution,
            response,
            outputText,
            toolEvents,
            artifacts: deferredArtifact.artifacts,
            artifactMessage: deferredArtifact.artifactMessage,
        };
    }

    async createArtifactFromContent({
        sessionId,
        ownerId = null,
        session = null,
        content = '',
        outputFormat = '',
        message = '',
        mode = 'chat',
        model = null,
        reasoningEffort = null,
        metadata = {},
    }) {
        const resolvedSession = session || (ownerId
            ? await this.sessionStore.getOwned(sessionId, ownerId)
            : await this.sessionStore.get(sessionId));

        if (!resolvedSession) {
            const error = new Error('Session not found');
            error.statusCode = 404;
            throw error;
        }

        const outputText = String(content || '').trim();
        if (!outputText) {
            const error = new Error('Artifact stages need source content from a prior stage.');
            error.statusCode = 400;
            throw error;
        }

        const runtimeToolManager = await ensureRuntimeToolManager(this.app);
        const deferredArtifact = await this.maybeGenerateDeferredArtifact({
            runtimeToolManager,
            sessionId,
            ownerId,
            session: resolvedSession,
            message: message || `Create a ${outputFormat || 'document'} artifact from the prior stage output.`,
            mode,
            responseId: null,
            outputText,
            model,
            reasoningEffort,
            metadata: {
                ...metadata,
                workloadRun: true,
                outputFormat,
            },
        });

        return {
            outputText,
            toolEvents: [],
            artifacts: deferredArtifact.artifacts,
            artifactMessage: deferredArtifact.artifactMessage,
        };
    }

    async runStructuredExecution({
        sessionId,
        ownerId = null,
        execution,
        session = null,
        metadata = {},
    }) {
        const resolvedSession = session || (ownerId
            ? await this.sessionStore.getOwned(sessionId, ownerId)
            : await this.sessionStore.get(sessionId));

        if (!resolvedSession) {
            const error = new Error('Session not found');
            error.statusCode = 404;
            throw error;
        }

        const toolId = canonicalizeRemoteToolId(execution?.tool || '');
        if (!toolId) {
            throw new Error('Structured workload execution is missing a tool id');
        }

        const params = execution?.params && typeof execution.params === 'object'
            ? { ...execution.params }
            : {};
        if (toolId === 'opencode-run' && !String(params.model || '').trim() && String(metadata?.requestedModel || '').trim()) {
            params.model = String(metadata.requestedModel).trim();
        }
        const runtimeToolManager = await ensureRuntimeToolManager(this.app);
        const result = await runtimeToolManager.executeTool(toolId, params, {
            sessionId,
            route: '/api/workloads',
            transport: 'worker',
            memoryService: this.memoryService,
            ownerId,
            workloadService: this.app?.locals?.agentWorkloadService,
            opencodeService: this.app?.locals?.opencodeService || null,
            executionProfile: metadata.executionProfile || null,
            subAgentDepth: Number(metadata?.subAgentDepth || 0),
        });

        if (result?.success === false) {
            throw new Error(result.error || `Structured execution via ${toolId} failed`);
        }

        const toolEvents = [{
            toolCall: {
                function: {
                    name: toolId,
                    arguments: JSON.stringify(params),
                },
            },
            result,
        }];
        const sshMetadata = extractSshSessionMetadataFromToolEvents(toolEvents);
        if (sshMetadata) {
            await this.sessionStore.update(sessionId, { metadata: sshMetadata });
        }

        const outputText = toolId === 'remote-command' || toolId === 'ssh-execute'
            ? formatSshToolResult(result, {
                host: params.host || '',
                username: params.username || null,
                port: params.port || null,
            })
            : toolId === 'opencode-run'
                ? formatOpenCodeToolResult(result.data || {})
                : JSON.stringify(result.data || {}, null, 2);
        const memoryMetadata = this.buildMemoryMetadata(ownerId, metadata, resolvedSession);

        if (outputText) {
            if (this.memoryService?.rememberResponse) {
                this.memoryService.rememberResponse(sessionId, outputText, memoryMetadata);
            }
            await this.sessionStore.appendMessages(sessionId, [
                { role: 'assistant', content: outputText },
            ]);
        }

        await this.updateProjectMemory(sessionId, ownerId, {
            userText: metadata.prompt || `Deferred execution via ${toolId}`,
            assistantText: outputText,
            toolEvents,
        });

        return {
            result,
            outputText,
            toolEvents,
        };
    }

    async appendSyntheticMessage(sessionId, role, content) {
        if (!sessionId || !content) {
            return;
        }

        await this.sessionStore.appendMessages(sessionId, [
            { role, content },
        ]);
    }

    async updateProjectMemory(sessionId, ownerId, updates = {}) {
        const session = ownerId
            ? await this.sessionStore.getOwned(sessionId, ownerId)
            : await this.sessionStore.get(sessionId);
        if (!session) {
            return null;
        }

        return this.sessionStore.update(sessionId, {
            metadata: {
                projectMemory: mergeProjectMemory(
                    session?.metadata?.projectMemory || {},
                    buildProjectMemoryUpdate(updates),
                ),
            },
        });
    }

    async maybeGenerateDeferredArtifact({
        runtimeToolManager,
        sessionId,
        ownerId = null,
        session = null,
        message = '',
        mode = 'chat',
        responseId = null,
        outputText = '',
        model = null,
        reasoningEffort = null,
        metadata = {},
    }) {
        if (metadata?.workloadRun !== true) {
            return {
                artifacts: [],
                artifactMessage: '',
            };
        }

        const outputFormat = String(metadata?.outputFormat || '').trim().toLowerCase()
            || inferRequestedOutputFormat(message);
        if (!outputFormat || !String(outputText || '').trim()) {
            return {
                artifacts: [],
                artifactMessage: '',
            };
        }

        const latestSession = ownerId
            ? await this.sessionStore.getOwned(sessionId, ownerId)
            : await this.sessionStore.get(sessionId);
        const artifactSession = latestSession || session;
        const artifactIds = resolveArtifactContextIds(artifactSession, [], message);
        const preparedImages = await maybePrepareImagesForArtifactPrompt({
            toolManager: runtimeToolManager,
            sessionId,
            route: '/api/workloads',
            transport: 'worker',
            taskType: mode,
            text: message,
            outputFormat,
            artifactIds,
        });
        const artifactGenerationSession = preparedImages.resetPreviousResponse
            ? { ...(artifactSession || {}), previousResponseId: null }
            : artifactSession;
        const generatedArtifacts = await maybeGenerateOutputArtifact({
            sessionId,
            session: artifactGenerationSession,
            mode,
            outputFormat,
            content: outputText,
            prompt: '',
            title: `deferred-${outputFormat}-output`,
            responseId,
            artifactIds: preparedImages.artifactIds,
            model,
            reasoningEffort,
        });
        const artifacts = [
            ...(preparedImages.artifacts || []),
            ...(generatedArtifacts || []),
        ].filter((artifact, index, array) => {
            const artifactId = artifact?.id || '';
            return artifactId && array.findIndex((entry) => entry?.id === artifactId) === index;
        });

        if (artifacts.length === 0) {
            return {
                artifacts: [],
                artifactMessage: '',
            };
        }

        const primaryArtifact = artifacts[artifacts.length - 1];
        const artifactMessage = buildArtifactCompletionMessage(outputFormat, primaryArtifact);
        await this.sessionStore.update(sessionId, {
            metadata: {
                lastOutputFormat: outputFormat,
                lastGeneratedArtifactId: primaryArtifact.id,
            },
        });
        await this.appendSyntheticMessage(sessionId, 'assistant', artifactMessage);
        if (artifactMessage && this.memoryService?.rememberResponse) {
            this.memoryService.rememberResponse(
                sessionId,
                artifactMessage,
                this.buildMemoryMetadata(ownerId, metadata, artifactSession),
            );
        }
        if (this.memoryService?.rememberArtifactResult) {
            await Promise.all(artifacts.map((artifact) => this.memoryService.rememberArtifactResult(sessionId, {
                artifact,
                summary: artifactMessage,
                sourceText: outputText,
                metadata: {
                    ...this.buildMemoryMetadata(ownerId, metadata, artifactSession),
                    sourcePrompt: message,
                },
            })));
        }
        await this.updateProjectMemory(sessionId, ownerId, {
            userText: message,
            assistantText: artifactMessage,
            artifacts,
        });

        return {
            artifacts,
            artifactMessage,
        };
    }
}

function formatOpenCodeToolResult(data = {}) {
    const lines = [
        `OpenCode ${String(data.status || 'completed').trim() || 'completed'} in ${data.workspacePath || 'workspace'} using the ${data.agent || 'build'} agent.`,
    ];

    if (data.summary) {
        lines.push('', String(data.summary).trim());
    }

    const changedFiles = Array.isArray(data.diff)
        ? data.diff
            .map((entry) => String(entry?.path || entry?.file || entry?.newPath || '').trim())
            .filter(Boolean)
        : [];

    if (changedFiles.length > 0) {
        lines.push('', 'Changed files:', ...changedFiles.map((filePath) => `- ${filePath}`));
    }

    if (!data.summary && changedFiles.length === 0 && data.message) {
        lines.push('', String(data.message).trim());
    }

    return lines.join('\n').trim();
}

module.exports = {
    ConversationRunService,
};
