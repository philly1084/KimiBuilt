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
    session = null,
    mode,
    outputFormat,
    content,
    prompt = '',
    title,
    responseId,
    artifactIds = [],
    existingContent = '',
    model = null,
}) {
    if (!outputFormat) {
        return [];
    }

    try {
        if (prompt) {
            const result = await artifactService.generateArtifact({
                session,
                sessionId,
                mode,
                prompt,
                format: outputFormat,
                artifactIds,
                existingContent,
                model,
            });
            return [result.artifact];
        }
    } catch (error) {
        console.error('[Artifacts] Prompt-based generation failed:', error.message);
        if (!content) {
            throw error;
        }
    }

    if (!content) {
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

