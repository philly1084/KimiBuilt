function buildSessionInstructions(session, baseInstructions = '') {
    const parts = [];

    if (baseInstructions) {
        parts.push(baseInstructions.trim());
    }

    const agent = session?.metadata?.agent;
    if (agent?.instructions) {
        parts.push(`Saved agent profile: ${agent.instructions.trim()}`);
    }

    if (agent?.name) {
        parts.push(`Agent name: ${agent.name}`);
    }

    if (Array.isArray(agent?.tools) && agent.tools.length > 0) {
        parts.push(`Preferred workflow tools: ${agent.tools.join(', ')}. You may also use any runtime-provided tools available in this session when they are relevant.`);
    }

    return parts.filter(Boolean).join('\n\n');
}

module.exports = { buildSessionInstructions };
