function getBusinessAgentProfile(overrides = {}) {
    return {
        id: overrides.id || 'business-agent',
        name: overrides.name || 'Business Agent',
        instructions: overrides.instructions || 'You are Lilly\'s Business Agent. Focus on business documents, spreadsheets, reports, process diagrams, data transforms, and file-based deliverables. Prefer structured outputs that can be turned into artifacts for downstream business workflows.',
        tools: Array.isArray(overrides.tools) && overrides.tools.length > 0
            ? overrides.tools
            : ['artifact-upload', 'artifact-generate', 'artifact-search', 'session-memory'],
    };
}

function isDefaultBusinessAgentProfile(agent = {}) {
    const defaults = getBusinessAgentProfile();

    return agent?.id === defaults.id
        && agent?.name === defaults.name
        && String(agent?.instructions || '').trim() === defaults.instructions
        && JSON.stringify(Array.isArray(agent?.tools) ? agent.tools : []) === JSON.stringify(defaults.tools);
}

module.exports = {
    getBusinessAgentProfile,
    isDefaultBusinessAgentProfile,
};
