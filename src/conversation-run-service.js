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

        if (!execution.handledPersistence) {
            await this.sessionStore.recordResponse(sessionId, response.id);
            if (outputText) {
                this.memoryService.rememberResponse(sessionId, outputText, ownerId ? { ownerId } : {});
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
        const runtimeToolManager = await ensureRuntimeToolManager(this.app);
        const result = await runtimeToolManager.executeTool(toolId, params, {
            sessionId,
            route: '/api/workloads',
            transport: 'worker',
            memoryService: this.memoryService,
            ownerId,
            workloadService: this.app?.locals?.agentWorkloadService,
            executionProfile: metadata.executionProfile || null,
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
            : JSON.stringify(result.data || {}, null, 2);

        if (outputText) {
            if (this.memoryService?.rememberResponse) {
                this.memoryService.rememberResponse(sessionId, outputText, ownerId ? { ownerId } : {});
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

        const outputFormat = inferRequestedOutputFormat(message);
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
            this.memoryService.rememberResponse(sessionId, artifactMessage, ownerId ? { ownerId } : {});
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

module.exports = {
    ConversationRunService,
};
