const { sessionStore } = require('./session-store');
const { memoryService } = require('./memory/memory-service');
const { createResponse } = require('./openai-client');

const RECENT_TRANSCRIPT_LIMIT = 12;

function resolveConversationExecutorFlag(payload = {}) {
    return [
        payload?.enableConversationExecutor,
        payload?.enable_conversation_executor,
        payload?.useAgentExecutor,
        payload?.use_agent_executor,
        payload?.metadata?.enableConversationExecutor,
        payload?.metadata?.enable_conversation_executor,
        payload?.metadata?.useAgentExecutor,
        payload?.metadata?.use_agent_executor,
    ].some((value) => value === true);
}

async function executeConversationRuntime(app, params = {}) {
    const agentOrchestrator = resolveConversationExecutorFlag(params)
        ? app?.locals?.agentOrchestrator
        : null;

    if (agentOrchestrator?.executeConversation) {
        return {
            ...(await agentOrchestrator.executeConversation({
                ...params,
                useAgentExecutor: true,
            })),
            handledPersistence: true,
            runtimeMode: 'executor',
        };
    }

    const contextMessages = params.contextMessages || (
        params.loadContextMessages === false
            ? []
            : await memoryService.process(params.sessionId, params.memoryInput || '')
    );
    const recentMessages = params.recentMessages || (
        params.loadRecentMessages === false
            ? []
            : await sessionStore.getRecentMessages(params.sessionId, RECENT_TRANSCRIPT_LIMIT)
    );

    return {
        response: await createResponse({
            ...params,
            contextMessages,
            recentMessages,
        }),
        handledPersistence: false,
        runtimeMode: 'direct',
    };
}

module.exports = {
    executeConversationRuntime,
    resolveConversationExecutorFlag,
};
