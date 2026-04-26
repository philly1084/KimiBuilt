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

function hasExplicitPodcastVideoIntent(text = '') {
    const normalized = String(text || '').trim();
    if (!normalized) {
        return false;
    }

    return [
        /\bvideo\s+podcasts?\b/i,
        /\bpodcasts?\s+videos?\b/i,
        /\b(?:mp4|m4v|rendered|encoded)\b[\s\S]{0,40}\bpodcasts?\b/i,
        /\bpodcasts?\b[\s\S]{0,40}\b(?:mp4|m4v|rendered|encoded|video|visuals?|images?|cover art|scene images?)\b/i,
        /\b(?:make|create|generate|produce|build|render)\b[\s\S]{0,60}\b(?:podcasts?)\b[\s\S]{0,60}\b(?:video|visuals?|images?|mp4)\b/i,
        /\b(?:make|create|generate|produce|build|render)\b[\s\S]{0,60}\b(?:video|mp4)\b[\s\S]{0,60}\b(?:podcasts?)\b/i,
    ].some((pattern) => pattern.test(normalized));
}

function inferPodcastVideoAspectRatio(text = '') {
    const normalized = String(text || '').toLowerCase();
    if (/\b(?:vertical|portrait|shorts?|reels?|tiktok|9:16)\b/.test(normalized)) {
        return '9:16';
    }
    if (/\b(?:square|instagram post|1:1)\b/.test(normalized)) {
        return '1:1';
    }
    if (/\b(?:wide|widescreen|landscape|youtube|16:9)\b/.test(normalized)) {
        return '16:9';
    }
    return '16:9';
}

function inferPodcastVideoImageMode(text = '') {
    const normalized = String(text || '').toLowerCase();
    if (/\b(?:no generated images?|no ai images?|stock only|real photos? only|web images? only)\b/.test(normalized)) {
        return 'web';
    }
    if (/\b(?:generated images?|ai images?|custom images?|illustrations?|cover art|scene art)\b/.test(normalized)) {
        return 'generated';
    }
    if (/\b(?:unsplash|stock photos?)\b/.test(normalized)) {
        return 'unsplash';
    }
    if (/\b(?:fallback only|simple frames?|placeholder frames?)\b/.test(normalized)) {
        return 'fallback';
    }
    return 'mixed';
}

function inferPodcastVideoSceneCount(text = '') {
    const normalized = String(text || '').trim();
    if (!normalized) {
        return null;
    }

    const match = normalized.match(/\b(\d{1,2})\s+(?:scenes?|slides?|visuals?|images?|frames?)\b/i);
    if (!match) {
        return null;
    }

    const count = Number(match[1]);
    if (!Number.isFinite(count) || count < 1) {
        return null;
    }

    return Math.max(1, Math.min(36, Math.round(count)));
}

function inferPodcastVideoOptions(text = '') {
    if (!hasExplicitPodcastVideoIntent(text)) {
        return {};
    }

    const imageMode = inferPodcastVideoImageMode(text);
    const generateImages = !/\b(?:no generated images?|no ai images?|do not generate images?|without generated images?)\b/i.test(String(text || ''));
    const sceneCount = inferPodcastVideoSceneCount(text);

    return {
        includeVideo: true,
        videoAspectRatio: inferPodcastVideoAspectRatio(text),
        videoImageMode: imageMode,
        videoGenerateImages: generateImages,
        ...(sceneCount ? { videoSceneCount: sceneCount } : {}),
    };
}

function cleanExtractedPodcastTopic(value = '') {
    return String(value || '')
        .replace(/\bwith\s+(?:generated|ai|custom|scene|cover)\s+(?:images?|visuals?|art|artwork)\b[\s\S]*$/i, '')
        .replace(/\bwith\s+(?:visuals?|scene images?|cover art|an? image|images?)\b[\s\S]*$/i, '')
        .replace(/\b(?:as|for)\s+(?:an?\s+)?(?:video\s+podcast|podcast\s+video|mp4)\b[\s\S]*$/i, '')
        .replace(/\b(?:in|as)\s+(?:vertical|portrait|landscape|widescreen|square|9:16|16:9|1:1)\b[\s\S]*$/i, '')
        .replace(/[.?!]+$/, '')
        .trim();
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
            return cleanExtractedPodcastTopic(candidate);
        }
    }

    return cleanExtractedPodcastTopic(cleaned) || null;
}

module.exports = {
    hasExplicitPodcastIntent,
    hasExplicitPodcastVideoIntent,
    inferPodcastVideoOptions,
    extractExplicitPodcastTopic,
};
