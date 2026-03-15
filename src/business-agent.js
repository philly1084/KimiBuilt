function getBusinessAgentProfile(overrides = {}) {
    return {
        id: overrides.id || 'business-agent',
        name: overrides.name || 'Business Agent',
        instructions: overrides.instructions || 'You are LillyBuilt\'s Business Agent. Focus on business documents, spreadsheets, reports, process diagrams, data transforms, and file-based deliverables. Prefer structured outputs that can be turned into artifacts for downstream business workflows.',
        tools: Array.isArray(overrides.tools) && overrides.tools.length > 0
            ? overrides.tools
            : ['artifact-upload', 'artifact-generate', 'artifact-search', 'session-memory'],
    };
}

module.exports = { getBusinessAgentProfile };
