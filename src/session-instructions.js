const { isDefaultBusinessAgentProfile } = require('./business-agent');
const { buildProjectMemoryInstructions } = require('./project-memory');
const { getSessionControlState } = require('./runtime-control-state');

function formatRemoteTarget(target = {}) {
    if (!target?.host) {
        return '';
    }

    const username = target.username ? `${target.username}@` : '';
    const port = target.port && Number(target.port) !== 22 ? `:${target.port}` : '';
    return `${username}${target.host}${port}`;
}

function oneLinePreview(value = '', limit = 180) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) {
        return '';
    }

    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function buildRemoteWorkingStateInstructions(session = null) {
    const controlState = getSessionControlState(session);
    const remote = controlState.remoteWorkingState;
    if (!remote || typeof remote !== 'object') {
        return '';
    }

    const lines = [
        '[Remote working state]',
        'Reuse these verified remote facts for follow-up SSH or server work.',
    ];

    const targetLabel = formatRemoteTarget(remote.target || controlState.lastSshTarget || {});
    if (targetLabel) {
        lines.push(`- Target: ${targetLabel}`);
    }

    if (remote.lastCommand) {
        lines.push(`- Last command: ${oneLinePreview(remote.lastCommand, 200)}`);
    }

    if (typeof remote.lastCommandSucceeded === 'boolean') {
        const status = remote.lastCommandSucceeded ? 'succeeded' : 'failed';
        const details = remote.lastError ? ` (${oneLinePreview(remote.lastError, 140)})` : '';
        lines.push(`- Last result: ${status}${details}`);
    }

    if (remote.detectedArchitecture) {
        lines.push(`- Architecture: ${remote.detectedArchitecture}`);
    }

    if (remote.detectedOs) {
        lines.push(`- OS: ${oneLinePreview(remote.detectedOs, 120)}`);
    }

    if (remote.lastStdoutPreview) {
        lines.push(`- Recent stdout: ${oneLinePreview(remote.lastStdoutPreview, 180)}`);
    } else if (remote.lastStderrPreview) {
        lines.push(`- Recent stderr: ${oneLinePreview(remote.lastStderrPreview, 180)}`);
    }

    return lines.join('\n');
}

function buildSessionInstructions(session, baseInstructions = '') {
    const parts = [];

    if (baseInstructions) {
        parts.push(baseInstructions.trim());
    }

    const agent = session?.metadata?.agent;
    if (agent?.instructions && !isDefaultBusinessAgentProfile(agent)) {
        parts.push(`Saved agent profile: ${agent.instructions.trim()}`);
    }

    if (agent?.name && !isDefaultBusinessAgentProfile(agent)) {
        parts.push(`Agent name: ${agent.name}`);
    }

    if (!isDefaultBusinessAgentProfile(agent) && Array.isArray(agent?.tools) && agent.tools.length > 0) {
        parts.push(`Preferred workflow tools: ${agent.tools.join(', ')}. You may also use any runtime-provided tools available in this session when they are relevant.`);
    }

    const projectMemory = buildProjectMemoryInstructions(session);
    if (projectMemory) {
        parts.push(projectMemory);
    }

    const remoteWorkingState = buildRemoteWorkingStateInstructions(session);
    if (remoteWorkingState) {
        parts.push(remoteWorkingState);
    }

    return parts.filter(Boolean).join('\n\n');
}

module.exports = { buildSessionInstructions };
