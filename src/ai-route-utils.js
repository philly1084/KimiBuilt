const { artifactService } = require('./artifacts/artifact-service');
const { normalizeFormat } = require('./artifacts/constants');
const { buildSessionInstructions } = require('./session-instructions');
const { config } = require('./config');
const { getSessionControlState } = require('./runtime-control-state');
const { resolveDeferredWorkloadPreflight } = require('./workloads/preflight');
const { isDashboardRequest } = require('./dashboard-template-catalog');
const settingsController = require('./routes/admin/settings.controller');
const { parseLenientJson } = require('./utils/lenient-json');

const REMOTE_CONTINUATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ALLOWED_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);

function normalizeReasoningEffort(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    return ALLOWED_REASONING_EFFORTS.has(normalized) ? normalized : null;
}

function resolveReasoningEffort(payload = {}, fallback = null) {
    const candidate = [
        payload?.reasoningEffort,
        payload?.reasoning_effort,
        payload?.reasoning?.effort,
        payload?.metadata?.reasoningEffort,
        payload?.metadata?.reasoning_effort,
        payload?.metadata?.reasoning?.effort,
        fallback,
        config.openai.reasoningEffort,
    ].find((value) => typeof value === 'string' && value.trim());

    return normalizeReasoningEffort(candidate);
}

async function buildInstructionsWithArtifacts(session, baseInstructions = '', artifactIds = []) {
    let artifactContext = '';
    try {
        artifactContext = artifactIds && artifactIds.length > 0
            ? await artifactService.buildPromptContext(session.id, artifactIds)
            : '';
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
    reasoningEffort = null,
    contextMessages = [],
    recentMessages = [],
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
                reasoningEffort,
                contextMessages,
                recentMessages,
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

function shouldDeferArtifactGenerationToWorkload(text = '', outputFormat = null, options = {}) {
    const normalizedFormat = normalizeFormat(outputFormat);
    if (!normalizedFormat) {
        return false;
    }

    return resolveDeferredWorkloadPreflight({
        text,
        recentMessages: options?.recentMessages || [],
        timezone: options?.timezone || null,
        now: options?.now || null,
    }).shouldSchedule;
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

function hasExplicitMermaidFileIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\.(?:mmd)\b/i.test(normalized)
        || (/\bmermaid\b/i.test(normalized)
            && /\b(file|artifact|export|download|save|share|shareable|link)\b/i.test(normalized))
        || /\b(export|download|save|share|shareable|link)\b[\s\S]{0,60}\b(mermaid|mmd|diagram)\b/i.test(normalized)
        || /\b(mermaid|mmd)\s+(?:file|artifact|export|download)\b/i.test(normalized);
}

function isNotesSurfaceTaskType(taskType = '') {
    const normalized = String(taskType || '').trim().toLowerCase();
    return [
        'notes',
        'notes-app',
        'notes_app',
        'notes-editor',
        'notes_editor',
    ].includes(normalized);
}

function hasExplicitArtifactDeliveryIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(export|download|save|artifact|file|link|share|attachment)\b/i.test(normalized);
}

function hasExplicitStandaloneHtmlIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(standalone html|html file|downloadable html|shareable html|html artifact|html export)\b/i.test(normalized);
}

function hasPlanningConversationIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    const planningPatterns = [
        /\b(help me|let'?s|lets|can we|could we|i want to|we should)\s+(plan|outline|brainstorm|think through|talk through|discuss|ideate|sketch out|map out)\b/,
        /\b(just|only)\s+(plan|outline|brainstorm|discuss)\b/,
        /\b(plan|outline|brainstorm|think through|talk through|discuss|ideate|sketch out|map out)\b[\s\S]{0,40}\b(before|first)\b/,
        /\b(before|first)\b[\s\S]{0,30}\b(edit|update|rewrite|apply|write|change|rebuild)\b/,
        /\b(do not|don't|dont|not)\b[\s\S]{0,20}\b(edit|update|rewrite|apply|write|change|rebuild)\b[\s\S]{0,20}\b(yet|first)\b/,
    ];
    const planningTarget = /\b(page|notes?|document|doc|brief|report|spec|guide|proposal|outline|section|content|html page|web page|landing page|website)\b/.test(normalized);

    return planningTarget && planningPatterns.some((pattern) => pattern.test(normalized));
}

function hasExplicitNotesPageEditIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return [
        /\b(put|add|insert|place|append|prepend|move|drop|apply|write|turn|convert|use|set)\b[\s\S]{0,40}\b(on|into|to|in)\b[\s\S]{0,20}\b(page|note|document|doc)\b/,
        /\b(edit|update|rewrite|reformat|reorganize|restyle|clean up|fix)\b[\s\S]{0,40}\b(page|note|document|doc)\b/,
        /\b(current page|this page|the page|this note|the note)\b/,
    ].some((pattern) => pattern.test(normalized));
}

function hasImplicitNotesPageBuildIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    const pageWritingVerb = /\b(create|make|build|draft|write|expand|fill out|flesh out|continue|finish|polish|rewrite|turn|convert|organize|restructure|rework|improve|work on)\b/.test(normalized);
    const pageTarget = /\b(page|notes|note|document|doc|brief|report|spec|plan|guide|proposal|outline|section|content)\b/.test(normalized);
    const asksForFullerContent = /\b(more detail|more details|fill it out|flesh it out|expand it|make it better|make it fuller|build it out|finish the page|work on the page)\b/.test(normalized);

    return (pageWritingVerb && pageTarget) || asksForFullerContent;
}

function stripInjectedNotesPageEditDirective(text = '') {
    const source = String(text || '');
    if (!source) {
        return '';
    }

    const patterns = [
        /\n+\s*Interpret ["']page["'] as the current notes page shown in this editor\.[\s\S]*$/i,
        /\n+\s*This is a direct page edit request, so return notes-actions[\s\S]*$/i,
    ];

    for (const pattern of patterns) {
        const match = source.match(pattern);
        if (match?.index >= 0) {
            const stripped = source.slice(0, match.index).trimEnd();
            return stripped || source.trim();
        }
    }

    return source;
}

function shouldSuppressNotesSurfaceArtifact({
    taskType = '',
    text = '',
    outputFormat = null,
    outputFormatProvided = false,
} = {}) {
    const normalizedFormat = normalizeFormat(outputFormat);
    const explicitDeliveryIntent = hasExplicitArtifactDeliveryIntent(text);
    if (!normalizedFormat || !isNotesSurfaceTaskType(taskType)) {
        return false;
    }

    if (normalizedFormat === 'mermaid' && !outputFormatProvided) {
        return !hasExplicitMermaidFileIntent(text);
    }

    if (normalizedFormat === 'power-query') {
        return !explicitDeliveryIntent;
    }

    if (normalizedFormat === 'html' && hasExplicitStandaloneHtmlIntent(text)) {
        return false;
    }

    return !explicitDeliveryIntent;
}

function shouldSuppressImplicitMermaidArtifact({
    taskType = '',
    text = '',
    outputFormat = null,
    outputFormatProvided = false,
} = {}) {
    if (normalizeFormat(outputFormat) !== 'mermaid' || outputFormatProvided) {
        return false;
    }

    if (isNotesSurfaceTaskType(taskType)) {
        return !hasExplicitMermaidFileIntent(text);
    }

    return false;
}

function inferRequestedOutputFormat(text = '') {
    const normalized = String(text || '').toLowerCase();
    if (!normalized) {
        return null;
    }

    const hasArtifactIntent = hasExplicitArtifactGenerationIntent(normalized);
    const hasBuildIntent = /\b(create|make|generate|build|produce|render|prepare|draft)\b/.test(normalized);

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

    if ((hasArtifactIntent || hasBuildIntent)
        && (
            /\b(website|web page|webpage|landing page|homepage|microsite|marketing site|frontend demo|front-end demo|site mockup|site prototype)\b/.test(normalized)
            || isDashboardRequest(normalized)
        )) {
        return 'html';
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

function hasImplicitArtifactFollowupReference(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    if (isArtifactContinuationPrompt(normalized)) {
        return true;
    }

    return /\b(last|latest|generated|previous|prior|same|that|this|current)\b[\s\S]{0,40}\b(artifact|file|document|html|page|markup|pdf|docx|spreadsheet|workbook|diagram|mermaid|export|download)\b/i.test(normalized)
        || /\b(artifact|generated html|generated page|generated file|download link|download url|export file|html artifact|pdf artifact|docx artifact|spreadsheet artifact)\b/i.test(normalized);
}

function hasImplicitImageArtifactFollowupReference(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(last|latest|generated|previous|prior|same|those|these|this|earlier|above)\b[\s\S]{0,40}\b(images?|photos?|pictures?|illustrations?|renders?)\b/i.test(normalized)
        || /\b(images?|photos?|pictures?|illustrations?|renders?)\b[\s\S]{0,60}\b(from earlier|from before|from above|you made|you generated|we generated|from the last turn)\b/i.test(normalized)
        || /\b(use|put|place|include|embed|make|turn|convert|compile)\b[\s\S]{0,40}\b(those|these|the generated|the previous|the earlier)\b[\s\S]{0,20}\b(images?|photos?|pictures?)\b/i.test(normalized);
}

function hasExplicitImageGenerationIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    if (hasImplicitImageArtifactFollowupReference(normalized)
        && !/\b(generate|create|make|render|design|draw|illustrate|produce|craft)\b/i.test(normalized)) {
        return false;
    }

    return /\b(generate|create|make|render|design|draw|illustrate|produce|craft)\b[\s\S]{0,50}\b(image|images|photo|photos|picture|pictures|illustration|illustrations|render|renders|artwork|cover image|cover art|poster)\b/i.test(normalized)
        || /\b(text[-\s]?to[-\s]?image|image generation)\b/i.test(normalized)
        || /\b(image|photo|picture|illustration|render|artwork|poster)\b[\s\S]{0,20}\b(of|showing|depicting|featuring)\b/i.test(normalized);
}

function shouldPreGenerateImagesForArtifactRequest({
    text = '',
    outputFormat = null,
} = {}) {
    const normalizedFormat = normalizeFormat(outputFormat);
    if (!['pdf', 'docx', 'html'].includes(normalizedFormat)) {
        return false;
    }

    return hasExplicitImageGenerationIntent(text);
}

function buildImagePromptFromArtifactRequest(text = '') {
    const prompt = String(text || '').trim();
    if (!prompt) {
        return '';
    }

    let cleaned = prompt
        .replace(/\b(?:and then|then|and)?\s*(?:put|place|embed|include|insert|compile|turn|convert)\b[\s\S]*$/i, '')
        .replace(/\b(?:for|into|in|as)\s+(?:an?\s+)?(?:pdf|docx|html|document|page|file|artifact|brochure|booklet|report|brief)\b[\s\S]*$/i, '')
        .replace(/\b(?:make|create|generate|build|produce|prepare)\b[\s\S]{0,20}\b(?:a|an)\s+(?:pdf|docx|html|document|page|file|artifact)\b[\s\S]*$/i, '')
        .trim();

    if (!cleaned || cleaned.length < 12) {
        cleaned = prompt;
    }

    return cleaned;
}

function promptHasExplicitSshIntent(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\bssh\b/.test(normalized)
        || /\b(remote host|remote server|remote machine)\b/.test(normalized)
        || /\b(remote command|run remotely|execute remotely)\b/.test(normalized)
        || /\bremote into\b/.test(normalized)
        || /\b(login to|log into|ssh into|ssh to|connect to)\b/.test(normalized);
}

function hasExplicitSshTargetCue(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return promptHasExplicitSshIntent(normalized)
        || /\b(host|server|machine|node|target)\b/.test(normalized);
}

function isFileLikeSshTargetHost(host = '') {
    const normalized = String(host || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    const blockedExtensions = new Set([
        'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
        'json', 'yaml', 'yml', 'xml', 'txt', 'md', 'pdf',
        'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg',
    ]);

    const lastLabel = normalized.split('.').pop() || '';
    return blockedExtensions.has(lastLabel);
}

function extractExplicitSshTarget(text = '') {
    const normalized = String(text || '').trim();
    if (!normalized) {
        return null;
    }

    if (!hasExplicitSshTargetCue(normalized)) {
        return null;
    }

    const candidates = normalized.matchAll(/\b(?:(?<username>[a-zA-Z0-9._-]+)@)?(?<host>(?:\d{1,3}\.){3}\d{1,3}|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?::(?<port>\d{2,5}))?\b/g);

    for (const match of candidates) {
        const host = match?.groups?.host || '';
        if (!host || isSuspiciousSshTargetHost(host) || isFileLikeSshTargetHost(host)) {
            continue;
        }

        return {
            host,
            username: match.groups.username || null,
            port: match.groups.port ? Number(match.groups.port) : null,
        };
    }

    return null;
}

function extractRequestedSshCommand(text = '') {
    const prompt = String(text || '').trim();
    if (!prompt) {
        return null;
    }
    const normalized = prompt.toLowerCase();
    const hasInspectionIntent = /\b(check|inspect|verify|diagnose|debug|troubleshoot|status|state|health|healthy|look at|show|list|see what'?s wrong)\b/.test(normalized);
    const hasReportIntent = /\b(report|summary|overview)\b/.test(normalized);

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

    if (/\b(?:check|show|get|display|what(?:'s| is))\b[\s\S]{0,24}\b(?:time|clock)\b/i.test(prompt)
        || /\b(?:server|host|remote)\s+time\b/i.test(prompt)) {
        return 'date';
    }

    if (/\b(?:check|inspect|verify|look at)\b[\s\S]{0,40}\b(?:health|status)\b/i.test(prompt)
        || /\bhealth check\b/i.test(prompt)) {
        return 'hostname && uptime && (df -h / || true) && (free -m || true)';
    }

    if ((hasInspectionIntent && hasReportIntent)
        || /\bhealth report\b/i.test(prompt)
        || /\bserver state\b/i.test(prompt)
        || /\bstate report\b/i.test(prompt)
        || /\bhealth summary\b/i.test(prompt)) {
        return 'hostname && uptime && (df -h / || true) && (free -m || true)';
    }

    if (hasInspectionIntent && /\b(?:namespace|namespaces)\b/i.test(prompt) && /\b(kubernetes|k8s|cluster|kubectl)\b/i.test(prompt)) {
        return 'kubectl get namespaces';
    }

    if (hasInspectionIntent && /\b(?:pod|pods)\b/i.test(prompt) && /\b(kubernetes|k8s|cluster|kubectl)\b/i.test(prompt)) {
        return 'kubectl get pods -A';
    }

    return null;
}

function getConfiguredSshTarget() {
    const sshConfig = settingsController.getEffectiveSshConfig();
    if (!sshConfig?.enabled || !sshConfig?.host) {
        return null;
    }

    return {
        host: String(sshConfig.host || '').trim(),
        username: String(sshConfig.username || '').trim() || null,
        port: Number(sshConfig.port) || 22,
    };
}

function isSuspiciousSshTargetHost(host = '') {
    const normalized = String(host || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    if (/[\s{}"'`$\\/]/.test(normalized) || /^https?:\/\//.test(normalized)) {
        return true;
    }

    return /^(?:web-fetch|web-search|web-scrape|file-read|file-search|file-write|remote-command|ssh-execute|docker-exec|tool-doc-read|code-sandbox)(?:\.[a-z0-9_-]+)+$/i.test(normalized)
        || /^(?:result|results|data|response|output|tool)(?:\.[a-z0-9_-]+)+$/i.test(normalized);
}

function isSshHostnameResolutionFailure(error = '') {
    const normalized = String(error || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /could not resolve hostname/i.test(normalized)
        || /name or service not known/i.test(normalized)
        || /temporary failure in name resolution/i.test(normalized);
}

function hasRecentRemoteWorkingState(session = null) {
    const remoteWorkingState = getSessionControlState(session).remoteWorkingState;
    if (!remoteWorkingState || typeof remoteWorkingState !== 'object') {
        return false;
    }

    const lastUpdated = Date.parse(remoteWorkingState.lastUpdated || '');
    if (Number.isFinite(lastUpdated)) {
        return (Date.now() - lastUpdated) <= REMOTE_CONTINUATION_MAX_AGE_MS;
    }

    return Boolean(
        remoteWorkingState?.target?.host
        || remoteWorkingState?.lastCommand
        || remoteWorkingState?.lastError,
    );
}

function isSshContinuationPrompt(text = '', { allowGenericContinuation = false } = {}) {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    const genericContinuation = /^(continue|finish|keep going|go ahead|next|then|retry|rerun|re-run|recheck)\b/.test(normalized)
        || /\b(keep going|go ahead|retry that|rerun that|re-run that|recheck that|keep working on it)\b/.test(normalized);
    const remoteSpecificLanguage = /\b(ssh|server|host|cluster|k3s|k8s|kubernetes|kubectl|node|namespace|pod|deployment|service|container|docker|helm|traefik|ingress|tls|ssl|acme|let'?s encrypt|certificate|cert|journalctl|systemctl|restart|rollout|daemonset|statefulset|logs?|tunnel)\b/.test(normalized);

    return remoteSpecificLanguage || (allowGenericContinuation && genericContinuation);
}

function formatSshTarget(target = {}) {
    if (!target?.host) {
        return '';
    }

    const username = target.username ? `${target.username}@` : '';
    const port = target.port && Number(target.port) !== 22 ? `:${target.port}` : '';
    return `${username}${target.host}${port}`;
}

function isRemoteCommandToolId(toolId = '') {
    const normalized = String(toolId || '').trim().toLowerCase();
    return normalized === 'ssh-execute' || normalized === 'remote-command';
}

function canonicalizeRemoteToolId(toolId = '') {
    return isRemoteCommandToolId(toolId) ? 'remote-command' : String(toolId || '').trim();
}

function previewRemoteText(value = '', limit = 240) {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }

    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function detectRemoteArchitecture(text = '') {
    const normalized = String(text || '').toLowerCase();

    if (/\b(aarch64|arm64)\b/.test(normalized)) {
        return 'arm64';
    }

    if (/\b(x86_64|amd64)\b/.test(normalized)) {
        return 'amd64';
    }

    return null;
}

function detectRemoteOs(text = '') {
    const source = String(text || '');
    const prettyName = source.match(/PRETTY_NAME="?([^"\r\n]+)"?/i);
    if (prettyName?.[1]) {
        return previewRemoteText(prettyName[1], 120);
    }

    const name = source.match(/\bNAME="?([^"\r\n]+)"?/i);
    const version = source.match(/\bVERSION="?([^"\r\n]+)"?/i);
    const parts = [name?.[1], version?.[1]].filter(Boolean);
    return parts.length > 0 ? previewRemoteText(parts.join(' '), 120) : null;
}

function buildRemoteWorkingStateFromEvent(event = {}, parsedArgs = {}, { host = null, username = null, port = null } = {}) {
    const result = event?.result || {};
    const data = result?.data || {};
    const command = String(parsedArgs?.command || '').trim();
    const stdout = previewRemoteText(data?.stdout || '', 320);
    const stderr = previewRemoteText(data?.stderr || '', 240);
    const combinedOutput = [command, data?.stdout || '', data?.stderr || ''].join('\n');
    const detectedArchitecture = detectRemoteArchitecture(combinedOutput);
    const detectedOs = detectRemoteOs(combinedOutput);
    const target = host
        ? {
            host,
            ...(username ? { username } : {}),
            port: port || 22,
        }
        : null;

    return {
        lastUpdated: result?.timestamp || new Date().toISOString(),
        toolId: canonicalizeRemoteToolId(event?.toolCall?.function?.name || result?.toolId || ''),
        ...(target ? { target } : {}),
        ...(command ? { lastCommand: command } : {}),
        lastCommandSucceeded: result?.success !== false,
        ...(Number.isInteger(data?.exitCode) ? { lastExitCode: data.exitCode } : {}),
        ...(result?.success === false && result?.error ? { lastError: previewRemoteText(result.error, 200) } : {}),
        ...(stdout ? { lastStdoutPreview: stdout } : {}),
        ...(stderr ? { lastStderrPreview: stderr } : {}),
        ...(detectedArchitecture ? { detectedArchitecture } : {}),
        ...(detectedOs ? { detectedOs } : {}),
    };
}

function getPreferredRemoteToolId(toolManager = null) {
    if (typeof toolManager?.getTool === 'function') {
        if (toolManager.getTool('remote-command')) {
            return 'remote-command';
        }

        if (toolManager.getTool('ssh-execute')) {
            return 'ssh-execute';
        }
    }

    return 'remote-command';
}

function resolveSshRequestContext(text = '', session = null) {
    const prompt = String(text || '').trim();
    const normalizedPrompt = prompt.toLowerCase();
    const controlState = getSessionControlState(session);
    const explicitIntent = promptHasExplicitSshIntent(prompt);
    const explicitTarget = extractExplicitSshTarget(prompt);
    const configuredTarget = getConfiguredSshTarget();
    const sessionTarget = controlState.lastSshTarget || null;
    const target = explicitTarget
        || (sessionTarget?.host && !isSuspiciousSshTargetHost(sessionTarget.host)
            ? sessionTarget
            : null)
        || configuredTarget
        || sessionTarget;
    const stickySsh = isRemoteCommandToolId(controlState.lastToolIntent);
    const continuation = !explicitIntent
        && stickySsh
        && target?.host
        && isSshContinuationPrompt(prompt, {
            allowGenericContinuation: hasRecentRemoteWorkingState(session),
        });
    const effectivePrompt = continuation
        ? `SSH into ${formatSshTarget(target)} and ${prompt}`
        : prompt;
    const retryLikeContinuation = continuation
        && /\b(try again|retry|rerun|re-run|recheck)\b/.test(normalizedPrompt);
    const previousCommand = String(controlState?.remoteWorkingState?.lastCommand || '').trim();
    const command = extractRequestedSshCommand(effectivePrompt)
        || (retryLikeContinuation && previousCommand ? previousCommand : null);

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
    let fallbackMetadata = null;

    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        const toolName = canonicalizeRemoteToolId(event?.toolCall?.function?.name);
        if (!isRemoteCommandToolId(toolName)) {
            continue;
        }

        const args = parseLenientJson(event?.toolCall?.function?.arguments || '{}') || {};
        const hostField = String(event?.result?.data?.host || '').trim();
        const hostMatch = hostField.match(/^(?<host>[^:]+)(?::(?<port>\d+))?$/);
        const hostFromResult = hostMatch?.groups?.host && !isSuspiciousSshTargetHost(hostMatch.groups.host)
            ? hostMatch.groups.host
            : null;
        const hostFromArgs = args.host && !isSuspiciousSshTargetHost(args.host)
            ? String(args.host).trim()
            : null;
        const resolutionFailure = event?.result?.success === false && isSshHostnameResolutionFailure(event?.result?.error || '');
        const host = hostFromResult || (!resolutionFailure ? hostFromArgs : null);
        const port = args.port || (hostMatch?.groups?.port ? Number(hostMatch.groups.port) : null);
        const username = args.username || null;
        const remoteWorkingState = buildRemoteWorkingStateFromEvent(event, args, {
            host,
            username,
            port,
        });

        if (!host) {
            fallbackMetadata = fallbackMetadata || {
                lastToolIntent: toolName,
                remoteWorkingState,
            };
            continue;
        }

        return {
            lastToolIntent: toolName,
            lastSshTarget: {
                host,
                username,
                port: port || 22,
            },
            remoteWorkingState,
        };
    }

    return fallbackMetadata;
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

function resolveArtifactContextIds(session = null, artifactIds = [], text = '') {
    if (Array.isArray(artifactIds) && artifactIds.length > 0) {
        return artifactIds;
    }

    if (hasExplicitImageGenerationIntent(text)) {
        return [];
    }

    const lastGeneratedImageArtifactIds = Array.isArray(session?.metadata?.lastGeneratedImageArtifactIds)
        ? session.metadata.lastGeneratedImageArtifactIds.filter((entry) => typeof entry === 'string' && entry.trim())
        : [];
    if (lastGeneratedImageArtifactIds.length > 0 && hasImplicitImageArtifactFollowupReference(text)) {
        return lastGeneratedImageArtifactIds;
    }

    const lastGeneratedArtifactId = session?.metadata?.lastGeneratedArtifactId;
    return lastGeneratedArtifactId && hasImplicitArtifactFollowupReference(text)
        ? [lastGeneratedArtifactId]
        : [];
}

async function maybePrepareImagesForArtifactPrompt({
    toolManager = null,
    sessionId = '',
    route = '',
    transport = 'http',
    taskType = 'chat',
    text = '',
    outputFormat = null,
    artifactIds = [],
} = {}) {
    const resolvedArtifactIds = Array.isArray(artifactIds) ? artifactIds.filter(Boolean) : [];
    if (!shouldPreGenerateImagesForArtifactRequest({ text, outputFormat })) {
        return {
            artifactIds: resolvedArtifactIds,
            artifacts: [],
            toolEvents: [],
            imagePrompt: null,
            resetPreviousResponse: false,
        };
    }

    if (!toolManager?.executeTool || !toolManager?.getTool?.('image-generate')) {
        const error = new Error('Image generation is required for this request, but the image-generate tool is not available.');
        error.statusCode = 503;
        throw error;
    }

    const imagePrompt = buildImagePromptFromArtifactRequest(text);
    const toolResult = await toolManager.executeTool(
        'image-generate',
        { prompt: imagePrompt },
        {
            sessionId,
            route,
            transport,
            taskType,
        },
    );

    if (!toolResult?.success) {
        const error = new Error(toolResult?.error || 'Image generation failed before artifact creation.');
        error.statusCode = 502;
        throw error;
    }

    const generatedArtifacts = Array.isArray(toolResult?.data?.artifacts)
        ? toolResult.data.artifacts.filter((artifact) => artifact?.id)
        : [];
    if (generatedArtifacts.length === 0) {
        const error = new Error('Image generation completed, but no image artifacts were persisted for the follow-up document.');
        error.statusCode = 502;
        throw error;
    }

    const mergedArtifactIds = [
        ...resolvedArtifactIds,
        ...generatedArtifacts.map((artifact) => artifact.id),
    ].filter((value, index, array) => array.indexOf(value) === index);

    return {
        artifactIds: mergedArtifactIds,
        artifacts: generatedArtifacts,
        imagePrompt,
        resetPreviousResponse: true,
        toolEvents: [{
            toolCall: {
                function: {
                    name: 'image-generate',
                    arguments: JSON.stringify({ prompt: imagePrompt }),
                },
            },
            result: toolResult,
            reason: `Generate image artifacts before creating the ${normalizeFormat(outputFormat) || 'requested'} artifact.`,
        }],
    };
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
    reasoningEffort = null,
    parentArtifactId = null,
    contextMessages = [],
    recentMessages = [],
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
        reasoningEffort,
        parentArtifactId,
        contextMessages,
        recentMessages,
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
    resolveDeferredWorkloadPreflight,
    shouldDeferArtifactGenerationToWorkload,
    hasExplicitMermaidArtifactIntent,
    hasExplicitMermaidFileIntent,
    hasExplicitStandaloneHtmlIntent,
    hasPlanningConversationIntent,
    hasExplicitNotesPageEditIntent,
    hasImplicitNotesPageBuildIntent,
    stripInjectedNotesPageEditDirective,
    hasExplicitImageGenerationIntent,
    inferRequestedOutputFormat,
    isArtifactContinuationPrompt,
    buildImagePromptFromArtifactRequest,
    hasExplicitArtifactDeliveryIntent,
    shouldPreGenerateImagesForArtifactRequest,
    shouldSuppressNotesSurfaceArtifact,
    shouldSuppressImplicitMermaidArtifact,
    normalizeReasoningEffort,
    resolveReasoningEffort,
    resolveSshRequestContext,
    formatSshToolResult,
    getPreferredRemoteToolId,
    canonicalizeRemoteToolId,
    isRemoteCommandToolId,
    isSuspiciousSshTargetHost,
    extractSshSessionMetadataFromToolEvents,
    inferOutputFormatFromSession,
    resolveArtifactContextIds,
    maybePrepareImagesForArtifactPrompt,
};

