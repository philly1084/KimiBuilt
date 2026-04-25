const { normalizeFormat } = require('./constants');

function normalizeHaystack(...values) {
    return values
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join('\n')
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function hasPlainOutputOptOut(haystack = '') {
    return /\b(text only|text-only|plain text|no html|without html|no website|not a website|no interactive|without interaction|static only)\b/.test(haystack);
}

function hasResearchCue(haystack = '') {
    return /\b(research|sources?|citations?|latest|recent|current|news|headline|headlines|coverage|fact check|fact-check|verify|look up|web search|online|evidence)\b/.test(haystack);
}

function hasDocumentCue(haystack = '') {
    return /\b(document|doc|report|brief|guide|research|case study|whitepaper|dossier|analysis|article|memo|note)\b/.test(haystack);
}

function hasInteractiveCue(haystack = '') {
    return /\b(interactive|clickable|explorable|sortable|filterable|drill down|drilldown|animated|animation|motion|web native|browser native|website grade|website feel|site like|living document|rich document|evidence explorer|source explorer|source map)\b/.test(haystack);
}

function isInteractiveDocumentRequest(prompt = '', existingContent = '') {
    const haystack = normalizeHaystack(prompt, existingContent);
    if (!haystack || hasPlainOutputOptOut(haystack)) {
        return false;
    }

    if (/\binteractive\s+(?:document|doc|report|brief|research|guide|dossier|whitepaper|article|page)\b/.test(haystack)) {
        return true;
    }

    if (/\b(?:document|doc|report|brief|research|guide|dossier|whitepaper|article|analysis)\b.{0,60}\b(?:interactive|clickable|explorable|animated|animation|motion|web native|browser native|website grade|website feel|site like|rich)\b/.test(haystack)) {
        return true;
    }

    if (/\b(?:website grade|website feel|web native|browser native|living document|rich document|interactive article|interactive essay)\b/.test(haystack)
        && hasDocumentCue(haystack)) {
        return true;
    }

    if (hasResearchCue(haystack)
        && /\b(research dashboard|research page|research site|evidence explorer|source explorer|source map|visual report|microsite|web page|webpage|html page|browser page)\b/.test(haystack)) {
        return true;
    }

    if (hasResearchCue(haystack) && hasDocumentCue(haystack) && hasInteractiveCue(haystack)) {
        return true;
    }

    return false;
}

function shouldUseInteractiveHtmlArtifact({ prompt = '', format = '', existingContent = '' } = {}) {
    return normalizeFormat(format) === 'html' && isInteractiveDocumentRequest(prompt, existingContent);
}

function renderInteractiveArtifactInstructions(prompt = '', existingContent = '') {
    const haystack = normalizeHaystack(prompt, existingContent);
    if (!isInteractiveDocumentRequest(prompt, existingContent)) {
        return '';
    }

    const researchBacked = hasResearchCue(haystack);
    return [
        '[Interactive document experience]',
        'Treat this as a web-native interactive document, not a generic landing page and not a static report.',
        'Open with a strong editorial or analytical thesis, then let the user explore evidence, sections, and data through the page.',
        'Use a sticky table of contents, source/evidence cards, expandable details, tabs, filters, sortable or selectable rows, chart toggles, or timeline controls when they fit the content.',
        'Add restrained motion that clarifies hierarchy or state changes, and include a prefers-reduced-motion fallback.',
        'Keep the copy source-aware and specific. Avoid marketing CTAs unless the user asked for a product or campaign site.',
        'Use semantic HTML, accessible buttons and controls, stable data-component attributes, and responsive layouts that work inside a sandboxed preview iframe.',
        'Keep interactions client-side and dependency-light so the artifact can be previewed, zipped, and deployed as a static site.',
        researchBacked
            ? 'For research-backed content, include visible source quality, date checked, caveats, and a source register or evidence drawer. Use web-search and web-fetch when tools are available.'
            : '',
    ].filter(Boolean).join('\n');
}

function buildArtifactExperienceMetadata({ prompt = '', format = '', existingContent = '' } = {}) {
    const normalizedFormat = normalizeFormat(format);
    const haystack = normalizeHaystack(prompt, existingContent);
    const interactive = isInteractiveDocumentRequest(prompt, existingContent);
    const researchBacked = hasResearchCue(haystack);

    if (!interactive && normalizedFormat !== 'html') {
        return {};
    }

    const family = interactive
        ? (researchBacked ? 'interactive-research-document' : 'interactive-document')
        : 'html-artifact';

    return {
        artifactExperience: {
            family,
            surface: normalizedFormat || 'artifact',
            sandbox: normalizedFormat === 'html'
                ? {
                    mode: 'opaque-origin-iframe',
                    scripts: true,
                    sameOrigin: false,
                }
                : null,
            deployment: normalizedFormat === 'html'
                ? {
                    staticPreview: true,
                    bundleReady: true,
                }
                : {
                    staticPreview: false,
                    bundleReady: false,
                },
        },
    };
}

module.exports = {
    buildArtifactExperienceMetadata,
    hasResearchCue,
    isInteractiveDocumentRequest,
    renderInteractiveArtifactInstructions,
    shouldUseInteractiveHtmlArtifact,
};
