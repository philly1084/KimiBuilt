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

function hasExplicitArtifactGenerationIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(export|download|save|convert|turn\b[\s\S]{0,20}\binto|turn\b[\s\S]{0,20}\bas|format\b[\s\S]{0,20}\bas)\b/i.test(normalized)
        || /\b(create|make|generate|build|produce|render|prepare|draft)\b[\s\S]{0,60}\b(file|artifact|document|page|report|brief|pdf|html|docx|xml|spreadsheet|excel|workbook|mermaid|diagram|flowchart|sequence diagram|erd|class diagram|state diagram)\b/i.test(normalized)
        || /\b(as|into|in)\s+(?:an?\s+)?(?:pdf|html|docx|xml|spreadsheet|excel workbook|workbook|mermaid|mmd)\b/i.test(normalized)
        || /\b(pdf|html|docx|xml|spreadsheet|excel|workbook)\s+(?:file|document|artifact|export)\b/i.test(normalized);
}

function hasExplicitMermaidArtifactIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    if (/\b(mermaid|\.mmd\b)\b/i.test(normalized)) {
        return hasExplicitArtifactGenerationIntent(normalized)
            || /\b(mermaid|mmd)\s+(?:file|artifact|diagram|chart|export)\b/i.test(normalized);
    }

    return /\b(create|make|generate|build|produce|render|export|draw)\b[\s\S]{0,60}\b(diagram|flowchart|sequence diagram|erd|entity relationship|class diagram|state diagram)\b/i.test(normalized)
        || /\b(diagram|flowchart|sequence diagram|erd|entity relationship|class diagram|state diagram)\s+(?:file|artifact|export)\b/i.test(normalized);
}

function inferRequestedOutputFormat(text = '') {
    const normalized = String(text || '').toLowerCase();
    if (!normalized) {
        return null;
    }

    const hasArtifactIntent = hasExplicitArtifactGenerationIntent(normalized);

    if ((/\b(power\s*query|\.(pq|m)\b)/.test(normalized) && hasArtifactIntent)
        || /\b(power\s*query)\s+(?:file|script|artifact|export)\b/.test(normalized)) {
        return 'power-query';
    }

    if ((/\b(xlsx|spreadsheet|excel|workbook)\b/.test(normalized) && hasArtifactIntent)
        || /\b(excel|spreadsheet|workbook)\s+(?:file|artifact|export)\b/.test(normalized)) {
        return 'xlsx';
    }

    if (/\bpdf\b/.test(normalized) && hasArtifactIntent) {
        return 'pdf';
    }

    if (/\b(docx|word document)\b/.test(normalized) && hasArtifactIntent) {
        return 'docx';
    }

    if (/\bxml\b/.test(normalized) && hasArtifactIntent) {
        return 'xml';
    }

    if (hasExplicitMermaidArtifactIntent(normalized)) {
        return 'mermaid';
    }

    if (/\bhtml\b/.test(normalized) && hasArtifactIntent) {
        return 'html';
    }

    return null;
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

function promptHasExplicitSshIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\bssh\b/.test(normalized)
        || /\b(remote host|remote server|remote machine)\b/.test(normalized)
        || /\b(login to|log into|ssh into|ssh to|connect to)\b/.test(normalized);
}

function extractExplicitSshTarget(text = '') {
    const normalized = String(text || '').trim();
    if (!normalized) {
        return null;
    }

    const match = normalized.match(/\b(?:(?<username>[a-zA-Z0-9._-]+)@)?(?<host>(?:\d{1,3}\.){3}\d{1,3}|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?::(?<port>\d{2,5}))?\b/);
    if (!match?.groups?.host) {
        return null;
    }

    return {
        host: match.groups.host,
        username: match.groups.username || null,
        port: match.groups.port ? Number(match.groups.port) : null,
    };
}

function extractRequestedSshCommand(text = '') {
    const prompt = String(text || '').trim();
    if (!prompt) {
        return null;
    }

    const quotedPatterns = [
        /\b(?:run|execute)\s+`([^`]+)`/i,
        /\b(?:run|execute)\s+"([^"]+)"/i,
        /\b(?:run|execute)\s+'([^']+)'/i,
    ];

    for (const pattern of quotedPatterns) {
        const match = prompt.match(pattern);
        if (match?.[1]) {
            return match[1].trim();
        }
    }

    if (/\b(?:check|inspect|verify|look at)\b[\s\S]{0,40}\b(?:health|status)\b/i.test(prompt)
        || /\bhealth check\b/i.test(prompt)) {
        return 'hostname && uptime && (df -h / || true) && (free -m || true)';
    }

    if (/\b(?:namespace|namespaces)\b/i.test(prompt) && /\b(kubernetes|k8s|cluster|kubectl)\b/i.test(prompt)) {
        return 'kubectl get namespaces';
    }

    if (/\b(?:pod|pods)\b/i.test(prompt) && /\b(kubernetes|k8s|cluster|kubectl)\b/i.test(prompt)) {
        return 'kubectl get pods -A';
    }

    return null;
}

function isSshContinuationPrompt(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /^(continue|finish|refine|update|configure|set up|setup|install|apply|use|lets|let's|now|then|next|okay|ok|go ahead)\b/.test(normalized)
        || /\b(traefik|tls|ssl|acme|let'?s encrypt|certificate|cert|ingress|kubectl|namespace|pod|deployment|service|container|docker|restart|logs?|tunnel)\b/.test(normalized);
}

function formatSshTarget(target = {}) {
    if (!target?.host) {
        return '';
    }

    const username = target.username ? `${target.username}@` : '';
    const port = target.port && Number(target.port) !== 22 ? `:${target.port}` : '';
    return `${username}${target.host}${port}`;
}

function resolveSshRequestContext(text = '', session = null) {
    const prompt = String(text || '').trim();
    const explicitIntent = promptHasExplicitSshIntent(prompt);
    const explicitTarget = extractExplicitSshTarget(prompt);
    const sessionTarget = session?.metadata?.lastSshTarget || null;
    const target = explicitTarget || sessionTarget;
    const stickySsh = session?.metadata?.lastToolIntent === 'ssh-execute'
        || session?.metadata?.lastToolIntent === 'remote-command';
    const continuation = !explicitIntent && stickySsh && target?.host && isSshContinuationPrompt(prompt);
    const effectivePrompt = continuation
        ? `SSH into ${formatSshTarget(target)} and ${prompt}`
        : prompt;
    const command = extractRequestedSshCommand(effectivePrompt);

    return {
        explicitIntent,
        continuation,
        shouldTreatAsSsh: explicitIntent || continuation,
        effectivePrompt,
        target,
        command,
        directParams: target?.host && command
            ? {
                host: target.host,
                ...(target.username ? { username: target.username } : {}),
                ...(target.port ? { port: target.port } : {}),
                command,
            }
            : null,
    };
}

function formatSshToolResult(result = {}, fallbackTarget = null) {
    if (!result?.success) {
        return `SSH request failed: ${result?.error || 'Unknown SSH error'}`;
    }

    const host = result?.data?.host || formatSshTarget(fallbackTarget) || 'remote host';
    const stdout = String(result?.data?.stdout || '').trim();
    const stderr = String(result?.data?.stderr || '').trim();
    const sections = [`SSH command completed on ${host}.`];

    if (stdout) {
        sections.push(`STDOUT:\n${stdout}`);
    }

    if (stderr) {
        sections.push(`STDERR:\n${stderr}`);
    }

    return sections.join('\n\n');
}

function extractSshSessionMetadataFromToolEvents(toolEvents = []) {
    const events = Array.isArray(toolEvents) ? toolEvents : [];

    for (const event of events) {
        const toolName = event?.toolCall?.function?.name;
        if (toolName !== 'ssh-execute' && toolName !== 'remote-command') {
            continue;
        }

        let args = {};
        try {
            args = JSON.parse(event?.toolCall?.function?.arguments || '{}');
        } catch (_error) {
            args = {};
        }

        const hostField = String(event?.result?.data?.host || '').trim();
        const hostMatch = hostField.match(/^(?<host>[^:]+)(?::(?<port>\d+))?$/);
        const host = args.host || hostMatch?.groups?.host || null;
        const port = args.port || (hostMatch?.groups?.port ? Number(hostMatch.groups.port) : null);
        const username = args.username || null;

        if (!host) {
            return {
                lastToolIntent: 'ssh-execute',
            };
        }

        return {
            lastToolIntent: 'ssh-execute',
            lastSshTarget: {
                host,
                username,
                port: port || 22,
            },
        };
    }

    return null;
}

function inferOutputFormatFromSession(text = '', session = null) {
    const lastOutputFormat = normalizeFormat(session?.metadata?.lastOutputFormat || '');
    const lastGeneratedArtifactId = session?.metadata?.lastGeneratedArtifactId || '';
    if (!lastOutputFormat || !lastGeneratedArtifactId) {
        return null;
    }

    if (lastOutputFormat === 'mermaid') {
        const normalized = String(text || '').trim().toLowerCase();
        if (!normalized) {
            return null;
        }

        const mermaidContinuation = /\b(mermaid|diagram|flowchart|sequence diagram|erd|entity relationship|class diagram|state diagram|artifact|file|export)\b/i.test(normalized);
        return (isArtifactContinuationPrompt(normalized) && mermaidContinuation) ? lastOutputFormat : null;
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
    inferRequestedOutputFormat,
    isArtifactContinuationPrompt,
    resolveSshRequestContext,
    formatSshToolResult,
    extractSshSessionMetadataFromToolEvents,
    inferOutputFormatFromSession,
    resolveArtifactContextIds,
};

