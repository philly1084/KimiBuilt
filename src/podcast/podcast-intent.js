function hasExplicitPodcastIntent(text = '') {
    const normalized = String(text || '').trim();
    if (!normalized) {
        return false;
    }

    return [
        /\bpodcasts?\b/i,
        /\btwo[- ]host podcasts?\b/i,
        /\btwo[- ]agent podcasts?\b/i,
        /\b(?:record|make|create|generate|produce|turn|convert)\b[\s\S]{0,40}\b(?:a |the )?podcasts?\b/i,
        /\b(?:use|run|start|launch|trigger)\b[\s\S]{0,20}\bpodcast(?: workflow| tool)?\b/i,
    ].some((pattern) => pattern.test(normalized));
}

function extractExplicitPodcastTopic(text = '') {
    const normalized = String(text || '').trim();
    if (!normalized) {
        return null;
    }

    const cleaned = normalized
        .replace(/\b(can you|could you|please|let'?s|lets|i want|we need to|help me)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const matchers = [
        /\bpodcasts?(?: episode)?\b[\s\S]{0,30}\b(?:about|on|regarding|covering)\b\s+(.+)$/i,
        /\b(?:make|create|generate|record|produce|turn|convert)\b[\s\S]{0,30}\bpodcasts?\b[\s\S]{0,20}\b(?:about|on|regarding|covering)\b\s+(.+)$/i,
        /\b(?:use|run|start|launch|trigger)\b[\s\S]{0,20}\bpodcast(?: workflow| tool)?\b[\s\S]{0,20}\b(?:for|on|about)\b\s+(.+)$/i,
        /\b(?:about|on)\b\s+(.+?)\s*\b(?:for|in)\s+(?:a |the )?podcasts?\b/i,
    ];

    for (const matcher of matchers) {
        const candidate = String(cleaned.match(matcher)?.[1] || '').trim();
        if (candidate) {
            return candidate.replace(/[.?!]+$/, '').trim();
        }
    }

    return cleaned.replace(/[.?!]+$/, '').trim() || null;
}

module.exports = {
    hasExplicitPodcastIntent,
    extractExplicitPodcastTopic,
};
