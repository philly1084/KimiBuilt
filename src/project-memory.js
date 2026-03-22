const MAX_PROJECT_URLS = 24;
const MAX_PROJECT_TASKS = 16;
const MAX_PROJECT_ARTIFACTS = 16;

function sanitizeText(value = '', limit = 280) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) {
        return '';
    }

    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function normalizeUrl(url = '') {
    const trimmed = String(url || '').trim().replace(/[),.;:!?]+$/g, '');
    if (!trimmed) {
        return null;
    }

    if (trimmed.startsWith('/')) {
        return trimmed;
    }

    try {
        const parsed = new URL(trimmed);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return null;
        }
        return parsed.toString();
    } catch (_error) {
        return null;
    }
}

function extractUrlsFromText(text = '') {
    const source = String(text || '');
    if (!source) {
        return [];
    }

    const matches = source.match(/https?:\/\/[^\s<>"'`]+/gi) || [];
    const unique = new Set();

    return matches
        .map((match) => normalizeUrl(match))
        .filter((url) => {
            if (!url || unique.has(url)) {
                return false;
            }
            unique.add(url);
            return true;
        });
}

function extractUrlsFromValue(value, depth = 0) {
    if (depth > 4 || value == null) {
        return [];
    }

    if (typeof value === 'string') {
        return extractUrlsFromText(value);
    }

    if (Array.isArray(value)) {
        return Array.from(new Set(value.flatMap((entry) => extractUrlsFromValue(entry, depth + 1))));
    }

    if (typeof value === 'object') {
        return Array.from(new Set(
            Object.values(value).flatMap((entry) => extractUrlsFromValue(entry, depth + 1)),
        ));
    }

    return [];
}

function inferUrlKind(url = '', context = '') {
    const combined = `${url} ${context}`.toLowerCase();
    if (/\b(image|photo|unsplash)\b/.test(combined)
        || /\.(png|jpe?g|gif|webp|svg)(?:\?|$)/i.test(url)) {
        return 'image';
    }

    if (/\b(pdf|docx|html|download|artifact|file)\b/.test(combined)) {
        return 'artifact';
    }

    return 'reference';
}

function buildUrlRefs(urls = [], source = 'assistant', extra = {}) {
    return urls.map((url) => ({
        url,
        source,
        kind: inferUrlKind(url, `${extra.title || ''} ${extra.toolId || ''}`),
        title: sanitizeText(extra.title || ''),
        toolId: extra.toolId || null,
        capturedAt: extra.capturedAt || new Date().toISOString(),
    }));
}

function buildArtifactRefs(artifacts = [], capturedAt = new Date().toISOString()) {
    return (Array.isArray(artifacts) ? artifacts : [])
        .map((artifact) => {
            if (!artifact?.id) {
                return null;
            }

            return {
                id: artifact.id,
                filename: artifact.filename || '',
                format: artifact.format || artifact.extension || '',
                downloadUrl: normalizeUrl(artifact.downloadUrl || ''),
                sourcePrompt: sanitizeText(artifact?.metadata?.sourcePrompt || ''),
                capturedAt,
            };
        })
        .filter(Boolean);
}

function buildTaskRef({ userText = '', assistantText = '', toolEvents = [], artifacts = [], recordedAt = new Date().toISOString() }) {
    const normalizedToolEvents = Array.isArray(toolEvents) ? toolEvents : [];
    const toolIds = Array.from(new Set(normalizedToolEvents
        .map((event) => event?.toolCall?.function?.name || event?.result?.toolId || '')
        .filter(Boolean)));
    const failed = normalizedToolEvents.some((event) => event?.result?.success === false);
    const summary = sanitizeText(
        assistantText
        || userText
        || (artifacts[0]?.filename ? `Created ${artifacts[0].filename}` : ''),
        220,
    );

    if (!summary) {
        return null;
    }

    return {
        summary,
        status: failed ? 'partial' : 'completed',
        toolIds,
        artifactIds: buildArtifactRefs(artifacts, recordedAt).map((artifact) => artifact.id),
        recordedAt,
    };
}

function buildProjectMemoryUpdate({ userText = '', assistantText = '', toolEvents = [], artifacts = [] }) {
    const capturedAt = new Date().toISOString();
    const urlRefs = [
        ...buildUrlRefs(extractUrlsFromText(userText), 'user', { capturedAt, title: sanitizeText(userText, 120) }),
        ...buildUrlRefs(extractUrlsFromText(assistantText), 'assistant', { capturedAt, title: sanitizeText(assistantText, 120) }),
    ];

    for (const event of Array.isArray(toolEvents) ? toolEvents : []) {
        const toolId = event?.toolCall?.function?.name || event?.result?.toolId || null;
        const reason = sanitizeText(event?.reason || '', 120);
        urlRefs.push(...buildUrlRefs(
            extractUrlsFromValue(event?.result?.data),
            'tool',
            {
                capturedAt,
                toolId,
                title: reason || sanitizeText(toolId || 'tool result', 80),
            },
        ));
    }

    for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
        const downloadUrl = normalizeUrl(artifact?.downloadUrl || '');
        if (downloadUrl) {
            urlRefs.push(...buildUrlRefs([downloadUrl], 'artifact', {
                capturedAt,
                title: artifact.filename || artifact.format || 'generated artifact',
            }));
        }
    }

    const task = buildTaskRef({ userText, assistantText, toolEvents, artifacts, recordedAt: capturedAt });

    return {
        urls: urlRefs,
        artifacts: buildArtifactRefs(artifacts, capturedAt),
        tasks: task ? [task] : [],
        lastUpdated: capturedAt,
    };
}

function mergeProjectMemory(existing = {}, update = {}) {
    const merged = {
        urls: [],
        artifacts: [],
        tasks: [],
        lastUpdated: update.lastUpdated || existing.lastUpdated || new Date().toISOString(),
    };

    const urlMap = new Map();
    [...(existing.urls || []), ...(update.urls || [])].forEach((entry) => {
        const url = normalizeUrl(entry?.url || '');
        if (!url) {
            return;
        }

        const previous = urlMap.get(url) || {};
        urlMap.set(url, {
            url,
            source: entry?.source || previous.source || 'assistant',
            kind: entry?.kind || previous.kind || inferUrlKind(url),
            title: sanitizeText(entry?.title || previous.title || '', 120),
            toolId: entry?.toolId || previous.toolId || null,
            capturedAt: entry?.capturedAt || previous.capturedAt || merged.lastUpdated,
        });
    });
    merged.urls = Array.from(urlMap.values()).slice(-MAX_PROJECT_URLS);

    const artifactMap = new Map();
    [...(existing.artifacts || []), ...(update.artifacts || [])].forEach((entry) => {
        if (!entry?.id) {
            return;
        }

        artifactMap.set(entry.id, {
            id: entry.id,
            filename: entry.filename || '',
            format: entry.format || '',
            downloadUrl: normalizeUrl(entry.downloadUrl || ''),
            sourcePrompt: sanitizeText(entry.sourcePrompt || '', 160),
            capturedAt: entry.capturedAt || merged.lastUpdated,
        });
    });
    merged.artifacts = Array.from(artifactMap.values()).slice(-MAX_PROJECT_ARTIFACTS);

    const taskMap = new Map();
    [...(existing.tasks || []), ...(update.tasks || [])].forEach((entry) => {
        const summary = sanitizeText(entry?.summary || '', 220);
        if (!summary) {
            return;
        }

        const toolKey = Array.isArray(entry.toolIds) ? entry.toolIds.join(',') : '';
        const key = `${summary.toLowerCase()}::${toolKey}`;
        taskMap.set(key, {
            summary,
            status: entry?.status || 'completed',
            toolIds: Array.isArray(entry?.toolIds) ? entry.toolIds.slice(0, 6) : [],
            artifactIds: Array.isArray(entry?.artifactIds) ? entry.artifactIds.slice(0, 6) : [],
            recordedAt: entry?.recordedAt || merged.lastUpdated,
        });
    });
    merged.tasks = Array.from(taskMap.values()).slice(-MAX_PROJECT_TASKS);

    return merged;
}

function buildProjectMemoryInstructions(session = null) {
    const memory = session?.metadata?.projectMemory;
    if (!memory) {
        return '';
    }

    const lines = [
        '[Project working memory]',
        'Reuse these verified session references, outputs, and completed tasks when the user refers to earlier work, images, research, URLs, or generated files.',
    ];

    if (Array.isArray(memory.tasks) && memory.tasks.length > 0) {
        lines.push('');
        lines.push('Recent completed tasks:');
        memory.tasks.slice(-6).forEach((task) => {
            const toolSuffix = Array.isArray(task.toolIds) && task.toolIds.length > 0
                ? ` via ${task.toolIds.join(', ')}`
                : '';
            lines.push(`- ${task.summary} [${task.status || 'completed'}${toolSuffix ? toolSuffix : ''}]`);
        });
    }

    if (Array.isArray(memory.urls) && memory.urls.length > 0) {
        lines.push('');
        lines.push('Remembered URLs:');
        memory.urls.slice(-8).forEach((entry) => {
            const label = entry.title ? `${entry.title} -> ` : '';
            lines.push(`- ${label}${entry.url}`);
        });
    }

    if (Array.isArray(memory.artifacts) && memory.artifacts.length > 0) {
        lines.push('');
        lines.push('Generated artifacts:');
        memory.artifacts.slice(-6).forEach((artifact) => {
            const download = artifact.downloadUrl ? ` -> ${artifact.downloadUrl}` : '';
            lines.push(`- ${artifact.filename || artifact.id} (${artifact.format || 'file'})${download}`);
        });
    }

    return lines.join('\n');
}

module.exports = {
    extractUrlsFromText,
    extractUrlsFromValue,
    buildProjectMemoryUpdate,
    mergeProjectMemory,
    buildProjectMemoryInstructions,
};
