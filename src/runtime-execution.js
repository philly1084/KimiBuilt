const { sessionStore } = require('./session-store');
const { memoryService } = require('./memory/memory-service');
const { createResponse } = require('./openai-client');

const RECENT_TRANSCRIPT_LIMIT = 12;
const DEFAULT_EXECUTION_PROFILE = 'default';
const NOTES_EXECUTION_PROFILE = 'notes';
const REMOTE_BUILD_EXECUTION_PROFILE = 'remote-build';

function inferRecallProfile(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return 'default';
    }

    return /\b(web research|research|look up|search for|search the web|browse the web|search online|browse online|latest|current|today|news)\b/.test(normalized)
        ? 'research'
        : 'default';
}

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

    if ([
        'notes',
        'notes-app',
        'notes_app',
        'notes-editor',
        'notes_editor',
    ].includes(normalized)) {
        return NOTES_EXECUTION_PROFILE;
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
    const taskType = String(
        payload?.taskType
        || payload?.task_type
        || payload?.clientSurface
        || payload?.client_surface
        || payload?.metadata?.taskType
        || payload?.metadata?.task_type
        || payload?.metadata?.clientSurface
        || payload?.metadata?.client_surface
        || '',
    ).trim().toLowerCase();
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
    const requestedNotesProfile = configuredProfile === NOTES_EXECUTION_PROFILE
        || ['notes', 'notes-app', 'notes_app', 'notes-editor', 'notes_editor'].includes(taskType);

    if (configuredProfile === REMOTE_BUILD_EXECUTION_PROFILE) {
        return REMOTE_BUILD_EXECUTION_PROFILE;
    }

    const text = extractRuntimeText(payload?.input || payload?.memoryInput || '');
    const normalized = String(text || '').toLowerCase();
    const stickyRemoteIntent = ['ssh-execute', 'remote-command'].includes(
        String(
            payload?.session?.metadata?.lastToolIntent
            || payload?.metadata?.lastToolIntent
            || '',
        ).trim().toLowerCase(),
    );
    const pageEditIntent = normalized
        ? [
            /\b(put|add|insert|place|append|prepend|move|drop|apply|write|turn|convert|use|set)\b[\s\S]{0,40}\b(on|into|to|in)\b[\s\S]{0,20}\b(page|note|document|doc)\b/,
            /\b(edit|update|rewrite|reformat|reorganize|restyle|clean up|fix)\b[\s\S]{0,40}\b(page|note|document|doc)\b/,
            /\b(current page|this page|the page|this note|the note)\b/,
        ].some((pattern) => pattern.test(normalized))
        : false;

    if (!normalized) {
        return requestedNotesProfile ? NOTES_EXECUTION_PROFILE : DEFAULT_EXECUTION_PROFILE;
    }

    const remoteBuildIntent = [
        /\bssh\b/,
        /\bremote-build\b/,
        /\bremote build\b/,
        /\b(remote host|remote server|remote machine)\b/,
        /\b(remote command|run remotely|execute remotely)\b/,
        /\b(reach|check|access|inspect)\b[\s\S]{0,30}\bremote build\b/,
        /\b(log ?in to|ssh into|ssh to|connect to)\b/,
        /\b(deploy|release|rollout|restart)\b[\s\S]{0,40}\b(server|host|container|cluster|pod|deployment)\b/,
        /\b(kubectl|kubernetes|k8s|docker compose|docker-compose|systemctl|journalctl|nginx|pm2)\b/,
        /\b(build|compile|install|run)\b[\s\S]{0,40}\b(on|via)\b[\s\S]{0,20}\b(server|ssh|remote)\b/,
    ].some((pattern) => pattern.test(normalized));
    const remoteContinuationIntent = stickyRemoteIntent && [
        /^(continue|proceed|next|go ahead|do it|do that|finish|use remote-build|use the remote build)\b/,
        /\b(next step|next steps|keep going|from this page|from there|on the server|against the server)\b/,
    ].some((pattern) => pattern.test(normalized));

    if (requestedNotesProfile) {
        if (pageEditIntent) {
            return NOTES_EXECUTION_PROFILE;
        }

        return (remoteBuildIntent || remoteContinuationIntent) ? REMOTE_BUILD_EXECUTION_PROFILE : NOTES_EXECUTION_PROFILE;
    }

    return remoteBuildIntent ? REMOTE_BUILD_EXECUTION_PROFILE : DEFAULT_EXECUTION_PROFILE;
}

async function executeConversationRuntime(app, params = {}) {
    const executionProfile = inferExecutionProfile(params);
    const orchestrator = app?.locals?.conversationOrchestrator
        || app?.locals?.agentOrchestrator
        || null;

    if (orchestrator?.executeConversation) {
        return {
            ...(await orchestrator.executeConversation({
                ...params,
                executionProfile,
            })),
            handledPersistence: true,
            runtimeMode: 'orchestrated',
        };
    }

    const recallInput = params.memoryInput || extractRuntimeText(params.input || '');
    const contextMessages = params.contextMessages || (
        params.loadContextMessages === false
            ? []
            : await memoryService.process(params.sessionId, recallInput, {
                profile: inferRecallProfile(recallInput),
            })
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
