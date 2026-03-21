const { sessionStore } = require('./session-store');
const { memoryService } = require('./memory/memory-service');
const { createResponse } = require('./openai-client');

const RECENT_TRANSCRIPT_LIMIT = 12;
const DEFAULT_EXECUTION_PROFILE = 'default';
const REMOTE_BUILD_EXECUTION_PROFILE = 'remote-build';

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

function normalizeExecutionProfile(value = '') {
    const normalized = String(value || '').trim().toLowerCase();

    if (!normalized) {
        return DEFAULT_EXECUTION_PROFILE;
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

function extractRuntimeText(input = '') {
    if (typeof input === 'string') {
        return input;
    }

    if (!Array.isArray(input)) {
        return '';
    }

    return input
        .map((item) => {
            if (typeof item?.content === 'string') {
                return item.content;
            }

            if (Array.isArray(item?.content)) {
                return item.content
                    .map((part) => part?.text || '')
                    .filter(Boolean)
                    .join('\n');
            }

            return '';
        })
        .filter(Boolean)
        .join('\n');
}

function inferExecutionProfile(payload = {}) {
    const configuredProfile = normalizeExecutionProfile(
        payload?.executionProfile
        || payload?.execution_profile
        || payload?.agentProfile
        || payload?.agent_profile
        || payload?.metadata?.executionProfile
        || payload?.metadata?.execution_profile
        || payload?.metadata?.agentProfile
        || payload?.metadata?.agent_profile,
    );

    if (configuredProfile !== DEFAULT_EXECUTION_PROFILE) {
        return configuredProfile;
    }

    const text = extractRuntimeText(payload?.input || payload?.memoryInput || '');
    const normalized = String(text || '').toLowerCase();
    if (!normalized) {
        return DEFAULT_EXECUTION_PROFILE;
    }

    const remoteBuildIntent = [
        /\bssh\b/,
        /\b(remote host|remote server|remote machine)\b/,
        /\b(log ?in to|ssh into|ssh to|connect to)\b/,
        /\b(deploy|release|rollout|restart)\b[\s\S]{0,40}\b(server|host|container|cluster|pod|deployment)\b/,
        /\b(kubectl|kubernetes|k8s|docker compose|docker-compose|systemctl|journalctl|nginx|pm2)\b/,
        /\b(build|compile|install|run)\b[\s\S]{0,40}\b(on|via)\b[\s\S]{0,20}\b(server|ssh|remote)\b/,
    ].some((pattern) => pattern.test(normalized));

    return remoteBuildIntent ? REMOTE_BUILD_EXECUTION_PROFILE : DEFAULT_EXECUTION_PROFILE;
}

async function executeConversationRuntime(app, params = {}) {
    const executionProfile = inferExecutionProfile(params);
    const shouldUseExecutor = resolveConversationExecutorFlag(params)
        || executionProfile === REMOTE_BUILD_EXECUTION_PROFILE;
    const agentOrchestrator = shouldUseExecutor
        ? app?.locals?.agentOrchestrator
        : null;

    if (agentOrchestrator?.executeConversation) {
        return {
            ...(await agentOrchestrator.executeConversation({
                ...params,
                executionProfile,
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
            executionProfile,
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
    inferExecutionProfile,
    normalizeExecutionProfile,
};
