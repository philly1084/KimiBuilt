'use strict';

const { ensureRuntimeToolManager } = require('./runtime-tool-manager');
const { executeConversationRuntime } = require('./runtime-execution');
const {
    buildInstructionsWithArtifacts,
    extractSshSessionMetadataFromToolEvents,
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

        await this.updateProjectMemory(sessionId, ownerId, {
            userText: message,
            assistantText: outputText,
            toolEvents,
        });

        return {
            execution,
            response,
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
}

module.exports = {
    ConversationRunService,
};
