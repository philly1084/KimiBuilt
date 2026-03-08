const { artifactService } = require('./artifacts/artifact-service');
const { buildSessionInstructions } = require('./session-instructions');

async function buildInstructionsWithArtifacts(session, baseInstructions = '', artifactIds = []) {
    const artifactContext = artifactIds && artifactIds.length > 0
        ? await artifactService.buildPromptContext(session.id, artifactIds)
        : await artifactService.buildPromptContext(session.id, []);

    return buildSessionInstructions(
        session,
        [baseInstructions, artifactContext].filter(Boolean).join('\n\n'),
    );
}

async function maybeGenerateOutputArtifact({
    sessionId,
    mode,
    outputFormat,
    content,
    title,
    responseId,
    artifactIds = [],
}) {
    if (!outputFormat || !content) {
        return [];
    }

    const artifact = await artifactService.storeGeneratedArtifactFromContent({
        sessionId,
        mode,
        format: outputFormat,
        content,
        title,
        metadata: {
            sourceResponseId: responseId,
            artifactIds,
        },
    });

    return [artifact];
}

module.exports = {
    buildInstructionsWithArtifacts,
    maybeGenerateOutputArtifact,
};
