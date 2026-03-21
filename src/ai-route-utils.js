const { artifactService } = require('./artifacts/artifact-service');
const { normalizeFormat } = require('./artifacts/constants');
const { buildSessionInstructions } = require('./session-instructions');

async function buildInstructionsWithArtifacts(session, baseInstructions = '', artifactIds = []) {
    let artifactContext = '';
    try {
        artifactContext = artifactIds && artifactIds.length > 0
            ? await artifactService.buildPromptContext(session.id, artifactIds)
            : await artifactService.buildPromptContext(session.id, []);
    } catch (error) {
        console.error('[Artifacts] Failed to build prompt context:', error.message);
    }

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

function buildArtifactCompletionMessage(outputFormat, artifact) {
    const normalizedFormat = normalizeFormat(outputFormat) || 'file';
    const formatLabel = {
        pdf: 'PDF',
        docx: 'Word document',
        html: 'HTML document',
        xml: 'XML file',
        mermaid: 'Mermaid diagram',
        xlsx: 'Excel workbook',
        'power-query': 'Power Query script',
    }[normalizedFormat] || normalizedFormat.toUpperCase();

    const filename = artifact?.filename ? ` (${artifact.filename})` : '';
    return `Created the ${formatLabel} artifact${filename}.`;
}

function isArtifactContinuationPrompt(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    const continuationPatterns = [
        /^(continue|finish|refine|revise|update|improve|polish|expand|edit|redo|rework)\b/,
        /\b(another pass|next pass|keep going|work on it|finish it|continue it|same one|current page content)\b/,
        /\b(the pdf|this pdf|that pdf|the document|this document|that document|the file|this file|that file)\b/,
    ];

    return continuationPatterns.some((pattern) => pattern.test(normalized));
}

function inferOutputFormatFromSession(text = '', session = null) {
    const lastOutputFormat = normalizeFormat(session?.metadata?.lastOutputFormat || '');
    const lastGeneratedArtifactId = session?.metadata?.lastGeneratedArtifactId || '';
    if (!lastOutputFormat || !lastGeneratedArtifactId) {
        return null;
    }

    return isArtifactContinuationPrompt(text) ? lastOutputFormat : null;
}

function resolveArtifactContextIds(session = null, artifactIds = []) {
    if (Array.isArray(artifactIds) && artifactIds.length > 0) {
        return artifactIds;
    }

    const lastGeneratedArtifactId = session?.metadata?.lastGeneratedArtifactId;
    return lastGeneratedArtifactId ? [lastGeneratedArtifactId] : [];
}

async function generateOutputArtifactFromPrompt({
    sessionId,
    session = null,
    mode,
    outputFormat,
    prompt = '',
    artifactIds = [],
    existingContent = '',
    model = null,
    parentArtifactId = null,
}) {
    if (!outputFormat) {
        return null;
    }

    if (!prompt) {
        const error = new Error('A user prompt is required to generate an output artifact');
        error.statusCode = 400;
        throw error;
    }

    const result = await artifactService.generateArtifact({
        session,
        sessionId,
        mode,
        prompt,
        format: outputFormat,
        artifactIds,
        existingContent,
        model,
        parentArtifactId,
    });

    return {
        responseId: result.responseId,
        artifact: result.artifact,
        artifacts: [result.artifact],
        outputText: result.outputText,
        assistantMessage: buildArtifactCompletionMessage(outputFormat, result.artifact),
    };
}

module.exports = {
    buildInstructionsWithArtifacts,
    maybeGenerateOutputArtifact,
    generateOutputArtifactFromPrompt,
    buildArtifactCompletionMessage,
    isArtifactContinuationPrompt,
    inferOutputFormatFromSession,
    resolveArtifactContextIds,
};

