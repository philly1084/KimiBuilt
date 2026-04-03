'use strict';

const { resolveSshRequestContext } = require('../ai-route-utils');

function hasRemoteExecutionCue(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(remote|server|host|ssh|machine)\b/.test(normalized);
}

function extractStructuredExecution({ request = '', session = null } = {}) {
    const source = String(request || '').trim();
    if (!source || !hasRemoteExecutionCue(source)) {
        return null;
    }

    const sshContext = resolveSshRequestContext(source, session);
    const command = String(sshContext?.command || '').trim();
    if (!command) {
        return null;
    }

    return {
        tool: 'remote-command',
        params: {
            ...(sshContext?.target?.host ? { host: sshContext.target.host } : {}),
            ...(sshContext?.target?.username ? { username: sshContext.target.username } : {}),
            ...(sshContext?.target?.port ? { port: sshContext.target.port } : {}),
            command,
        },
    };
}

module.exports = {
    extractStructuredExecution,
};
