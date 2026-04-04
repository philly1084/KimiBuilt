const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { artifactStore } = require('./artifact-store');
const { extractArtifact } = require('./artifact-extractor');
const { renderArtifact } = require('./artifact-renderer');
const { FORMAT_MIME_TYPES, SUPPORTED_GENERATION_FORMATS, SUPPORTED_UPLOAD_FORMATS, inferFormat, normalizeFormat } = require('./constants');
const { chunkText, escapeHtml, stripHtml, stripNullCharacters } = require('../utils/text');
const { vectorStore } = require('../memory/vector-store');
const { buildSessionInstructions } = require('../session-instructions');
const { postgres } = require('../postgres');
const { searchImages, isConfigured: isUnsplashConfigured } = require('../unsplash-client');
const {
    buildDocumentCreativityPacket,
    inferDocumentTypeFromPrompt,
    renderCreativityPromptContext,
} = require('../documents/document-creativity');
const { resolveDocumentTheme } = require('../documents/document-design-engine');
const MULTI_PASS_DOCUMENT_FORMATS = new Set(['html', 'pdf', 'docx']);
const DEFAULT_DOCUMENT_IMAGE_TARGET = 20;
const COMPOSITION_PLANNING_PATTERNS = [
    /\bpage layout plan\b/i,
    /\bcredits? and source register\b/i,
    /\bfinal build checks\b/i,
    /\bapproved outline\b/i,
    /\bstructured document draft\b/i,
];
const COMPOSITION_META_PHRASES = [
    /\bthe layout should\b/i,
    /\bif attribution must appear\b/i,
    /\ba separate source register should\b/i,
    /\bbefore delivery\b/i,
    /\bthe final pass should\b/i,
    /\bverification date used for the build\b/i,
];

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function tryParseResponseJsonString(value = '') {
    const trimmed = String(value || '').trim();
    if (!trimmed || ((!trimmed.startsWith('{') || !trimmed.endsWith('}'))
        && (!trimmed.startsWith('[') || !trimmed.endsWith(']')))) {
        return null;
    }

    try {
        return JSON.parse(trimmed);
    } catch (_error) {
        return null;
    }
}

function extractFunctionPayloadText(content, depth = 0) {
    if (!content || typeof content !== 'object' || Array.isArray(content) || depth > 8) {
        return '';
    }

    const type = String(content.type || '').trim().toLowerCase();
    const functionName = String(content.name || content.function?.name || '').trim();
    if (type !== 'function' && !functionName) {
        return '';
    }

    const parameterSources = [
        content.parameters,
        content.arguments,
        content.function?.arguments,
        content.function?.parameters,
    ];

    for (const source of parameterSources) {
        const parsed = typeof source === 'string'
            ? tryParseResponseJsonString(source)
            : source;
        if (!parsed || typeof parsed !== 'object') {
            continue;
        }

        const functionText = [
            parsed.notes_page_update,
            parsed.assistant_reply,
            parsed.assistantReply,
            parsed.message,
            parsed.content,
            parsed.text,
            parsed.result,
            parsed.response,
            parsed.output_text,
            parsed.outputText,
            parsed.answer,
        ].find((entry) => typeof entry === 'string' && entry.trim());

        if (functionText) {
            return functionText.trim();
        }

        const nested = extractResponseContentText(parsed, depth + 1);
        if (nested) {
            return nested;
        }
    }

    return '';
}

function extractResponseContentText(content, depth = 0) {
    if (depth > 8) {
        return '';
    }

    if (typeof content === 'string') {
        const trimmed = stripNullCharacters(content).trim();
        if (!trimmed) {
            return '';
        }

        const parsed = tryParseResponseJsonString(trimmed);
        if (parsed) {
            const extracted = extractResponseContentText(parsed, depth + 1);
            if (extracted) {
                return extracted;
            }
        }

        return trimmed;
    }

    if (Array.isArray(content)) {
        return content
            .map((item) => extractResponseContentText(item, depth + 1))
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    if (!content || typeof content !== 'object') {
        return '';
    }

    const functionPayloadText = extractFunctionPayloadText(content, depth + 1);
    if (functionPayloadText) {
        return functionPayloadText;
    }

    if (typeof content.text === 'string') {
        return extractResponseContentText(content.text, depth + 1);
    }

    if (typeof content.output_text === 'string') {
        return extractResponseContentText(content.output_text, depth + 1);
    }

    if (typeof content.content === 'string') {
        return extractResponseContentText(content.content, depth + 1);
    }

    if (typeof content.message === 'string') {
        return extractResponseContentText(content.message, depth + 1);
    }

    if (typeof content.reasoning_content === 'string') {
        return extractResponseContentText(content.reasoning_content, depth + 1);
    }

    if (typeof content.reasoning === 'string') {
        return extractResponseContentText(content.reasoning, depth + 1);
    }

    if (typeof content.refusal === 'string') {
        return extractResponseContentText(content.refusal, depth + 1);
    }

    if (typeof content.value === 'string') {
        return extractResponseContentText(content.value, depth + 1);
    }

    const nestedKeys = [
        'content',
        'parts',
        'items',
        'output',
        'payload',
        'data',
        'result',
        'value',
        'message',
        'reasoning_content',
        'reasoning',
        'refusal',
    ];
    for (const key of nestedKeys) {
        if (content[key] == null) {
            continue;
        }

        const nested = extractResponseContentText(content[key], depth + 1);
        if (nested) {
            return nested;
        }
    }

    return '';
}

function extractResponseText(response) {
    if (typeof response?.output_text === 'string' && response.output_text.trim()) {
        return stripNullCharacters(response.output_text).trim();
    }

    const choiceMessage = response?.choices?.[0]?.message || null;
    if (choiceMessage) {
        const choiceText = extractResponseContentText(
            choiceMessage.content
            ?? choiceMessage.parts
            ?? choiceMessage.items
            ?? choiceMessage.text
            ?? choiceMessage.output_text
            ?? choiceMessage.reasoning_content
            ?? choiceMessage.reasoning
            ?? ''
        ).trim();
        if (choiceText) {
            return stripNullCharacters(choiceText).trim();
        }
    }

    const choiceText = stripNullCharacters(extractResponseContentText(response?.choices?.[0]?.text || '')).trim();
    if (choiceText) {
        return choiceText;
    }

    const candidate = response?.candidates?.[0] || null;
    if (candidate) {
        const candidateText = extractResponseContentText(
            candidate.content
            ?? candidate.parts
            ?? candidate.text
            ?? ''
        ).trim();
        if (candidateText) {
            return stripNullCharacters(candidateText).trim();
        }
    }

    const output = Array.isArray(response?.output) ? response.output : [];

    return output
        .filter((item) => item?.type === 'message' || item?.role === 'assistant')
        .map((item) => extractResponseContentText(item?.content ?? item?.text ?? item?.output_text ?? ''))
        .filter(Boolean)
        .join('\n')
        .replace(/\u0000/g, '')
        .trim();
}

function resolveCompletedResponseText(streamedText = '', response = {}) {
    const streamed = stripNullCharacters(streamedText);
    const completed = extractResponseText(response);

    if (!completed) {
        return streamed.trim();
    }

    if (!streamed) {
        return completed;
    }

    if (completed === streamed) {
        return streamed;
    }

    if (completed.startsWith(streamed)) {
        return completed;
    }

    if (streamed.includes(completed)) {
        return streamed;
    }

    return completed;
}

function getMissingCompletionDelta(streamedText = '', completedText = '') {
    const streamed = String(streamedText || '');
    const completed = String(completedText || '');

    if (!completed) {
        return '';
    }

    if (!streamed) {
        return completed;
    }

    if (completed.startsWith(streamed)) {
        return completed.slice(streamed.length);
    }

    return '';
}

function requestModelResponse(params = {}) {
    const { createResponse } = require('../openai-client');
    if (typeof createResponse !== 'function') {
        throw new Error('openai-client.createResponse is unavailable');
    }
    return createResponse(params);
}

function unwrapCodeFence(text = '') {
    const trimmed = String(text || '').trim();
    const match = trimmed.match(/^```(?:[a-z0-9_-]+)?\n([\s\S]*?)\n```$/i);
    return match ? match[1].trim() : trimmed;
}

function tryParseJson(text, fallbackTitle = 'Workbook') {
    try {
        const parsed = JSON.parse(unwrapCodeFence(text));
        return {
            title: parsed.title || fallbackTitle,
            sheets: Array.isArray(parsed.sheets) ? parsed.sheets : [],
        };
    } catch {
        return {
            title: fallbackTitle,
            sheets: [
                {
                    name: 'Sheet1',
                    rows: unwrapCodeFence(text)
                        .split('\n')
                        .filter(Boolean)
                        .map((line) => line.split('|').map((cell) => cell.trim())),
                },
            ],
        };
    }
}

function safeJsonParse(text = '') {
    try {
        return JSON.parse(unwrapCodeFence(text));
    } catch (_error) {
        return null;
    }
}

function inferDocumentTitle(prompt = '', fallback = 'Document') {
    const normalized = String(prompt || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalized) {
        return fallback;
    }

    const title = normalized
        .replace(/^(create|make|generate|write|draft|build)\s+/i, '')
        .replace(/[.?!]+$/g, '')
        .slice(0, 80)
        .trim();

    return title || fallback;
}

function normalizePlanSections(sections = []) {
    return (Array.isArray(sections) ? sections : [])
        .slice(0, 12)
        .map((section, index) => ({
            heading: String(section?.heading || section?.title || `Section ${index + 1}`).trim(),
            purpose: String(section?.purpose || section?.goal || '').trim(),
            keyPoints: (Array.isArray(section?.keyPoints) ? section.keyPoints : [])
                .map((point) => String(point || '').trim())
                .filter(Boolean)
                .slice(0, 6),
            targetLength: String(section?.targetLength || 'medium').trim() || 'medium',
            layout: String(section?.layout || section?.sectionLayout || '').trim() || 'narrative',
            tone: String(section?.tone || '').trim(),
            visualIntent: String(section?.visualIntent || section?.visual || '').trim(),
        }))
        .filter((section) => section.heading);
}

function normalizeDocumentSections(sections = [], fallbackSections = []) {
    const fallbackByIndex = Array.isArray(fallbackSections) ? fallbackSections : [];

    return (Array.isArray(sections) ? sections : [])
        .slice(0, 18)
        .map((section, index) => ({
            heading: String(section?.heading || section?.title || fallbackByIndex[index]?.heading || `Section ${index + 1}`).trim(),
            content: String(section?.content || section?.body || '').trim(),
            level: Number(section?.level) > 0 ? Number(section.level) : 1,
            kicker: String(section?.kicker || fallbackByIndex[index]?.tone || '').trim(),
            visualIntent: String(section?.visualIntent || fallbackByIndex[index]?.visualIntent || '').trim(),
        }))
        .filter((section) => section.heading && section.content);
}

function normalizeCreativePlan(parsedPlan = {}, fallbackPacket = null) {
    const packet = fallbackPacket && typeof fallbackPacket === 'object'
        ? fallbackPacket
        : {};
    const direction = packet.direction || {};
    const directionLabel = typeof parsedPlan?.creativeDirection === 'string'
        ? parsedPlan.creativeDirection
        : parsedPlan?.creativeDirection?.label;

    return {
        id: String(parsedPlan?.creativeDirection?.id || direction.id || '').trim() || null,
        label: String(
            directionLabel
            || direction.label
            || ''
        ).trim() || 'Editorial Feature',
        rationale: String(parsedPlan?.creativeDirection?.rationale || direction.rationale || '').trim(),
        themeSuggestion: String(
            parsedPlan?.theme
            || parsedPlan?.themeSuggestion
            || packet.themeSuggestion
            || direction.preferredTheme
            || 'editorial'
        ).trim(),
        humanizationNotes: (Array.isArray(parsedPlan?.humanizationNotes) ? parsedPlan.humanizationNotes : packet.humanizationNotes || [])
            .map((entry) => String(entry || '').trim())
            .filter(Boolean)
            .slice(0, 4),
        sampleHandling: (Array.isArray(parsedPlan?.sampleHandling) ? parsedPlan.sampleHandling : packet.sampleSignals?.guidance || [])
            .map((entry) => String(entry || '').trim())
            .filter(Boolean)
            .slice(0, 4),
    };
}

function normalizeImageReferenceUrl(url = '') {
    const trimmed = String(url || '').trim();
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

function isLikelyImageUrl(url = '') {
    const normalized = String(url || '').toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\.(png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(normalized)
        || normalized.includes('images.unsplash.com')
        || normalized.includes('source.unsplash.com')
        || normalized.includes('/photo-');
}

function isExternalImageReferenceUrl(url = '') {
    const normalized = String(url || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    if (normalized.startsWith('/')) {
        return false;
    }

    return /^https?:\/\//.test(normalized) && !/\/api\/artifacts\/.+\/download\b/.test(normalized);
}

function isInternalArtifactImageReferenceUrl(url = '') {
    const normalized = String(url || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /^\/api\/artifacts\/.+\/download\b/.test(normalized)
        || /^https?:\/\/[^/]+\/api\/artifacts\/.+\/download\b/.test(normalized);
}

function isRenderableImageReferenceUrl(url = '', { allowInternal = false } = {}) {
    if (allowInternal && isInternalArtifactImageReferenceUrl(url)) {
        return true;
    }

    return isExternalImageReferenceUrl(url);
}

function buildArtifactInlinePath(artifactId = '') {
    return `/api/artifacts/${artifactId}/download?inline=1`;
}

function refersToPriorImages(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(last|latest|generated|previous|prior|same|those|these|this|earlier|above)\b[\s\S]{0,40}\b(images?|photos?|pictures?|illustrations?|renders?)\b/i.test(normalized)
        || /\b(images?|photos?|pictures?|illustrations?|renders?)\b[\s\S]{0,60}\b(from earlier|from before|from above|you made|you generated|we generated|from the last turn)\b/i.test(normalized)
        || /\b(use|put|place|include|embed|make|turn|convert|compile)\b[\s\S]{0,40}\b(those|these|the generated|the previous|the earlier)\b[\s\S]{0,20}\b(images?|photos?|pictures?)\b/i.test(normalized);
}

function extractImageReferencesFromSession(session = null) {
    const entries = Array.isArray(session?.metadata?.projectMemory?.urls)
        ? session.metadata.projectMemory.urls
        : [];
    const unique = new Map();

    entries.forEach((entry) => {
        const url = normalizeImageReferenceUrl(entry?.url || '');
        if (!url || !isExternalImageReferenceUrl(url) || (!isLikelyImageUrl(url) && String(entry?.kind || '').toLowerCase() !== 'image')) {
            return;
        }

        unique.set(url, {
            url,
            title: String(entry?.title || '').trim(),
            source: String(entry?.source || '').trim() || 'session',
            toolId: String(entry?.toolId || '').trim(),
        });
    });

    return Array.from(unique.values()).slice(-DEFAULT_DOCUMENT_IMAGE_TARGET);
}

function extractImageReferencesFromArtifacts(artifacts = []) {
    const unique = new Map();

    (Array.isArray(artifacts) ? artifacts : []).forEach((artifact) => {
        const artifactId = String(artifact?.id || '').trim();
        const mimeType = String(artifact?.mimeType || '').trim().toLowerCase();
        const extension = String(artifact?.extension || artifact?.format || '').trim().toLowerCase();
        if (!artifactId || (!mimeType.startsWith('image/') && !['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension))) {
            return;
        }

        const url = buildArtifactInlinePath(artifactId);
        unique.set(url, {
            url,
            title: String(
                artifact?.metadata?.altText
                || artifact?.metadata?.title
                || artifact?.metadata?.revisedPrompt
                || artifact?.filename
                || 'Generated image'
            ).trim(),
            source: 'artifact',
            toolId: String(artifact?.metadata?.generatedBy || 'image-generate').trim(),
            internal: true,
            artifactId,
        });
    });

    return Array.from(unique.values()).slice(0, DEFAULT_DOCUMENT_IMAGE_TARGET);
}

function buildDocumentImageInstructions() {
    return [
        'When verified image URLs are available in session memory or prompt context, use those real images with standard HTML <img> tags.',
        'Prefer remembered direct image URLs and Unsplash image URLs over generated decorative placeholders.',
        `When the user asks for real or image-rich output, reuse as many as ${DEFAULT_DOCUMENT_IMAGE_TARGET} verified image references across the document before falling back to text-only sections.`,
        'Prefer standard HTML <img src="..."> elements over background-image-only treatments when the image is meaningful content.',
        'For HTML, PDF, and DOCX designs, distribute real images throughout the document instead of clustering them in a single appendix or final page.',
        'Use a strong visual rhythm: opening hero image, repeated section visuals, image cards, and galleries when enough verified image URLs exist.',
        'If there are enough verified images, include visuals in most major sections rather than only one or two isolated slots.',
        'Never create inline SVG artwork, multilayered SVG mockups, CSS-only fake photos, canvas placeholders, blob URLs, or data:image embeds unless the user explicitly asks for vector artwork.',
        'If no verified image URL is available for a visual slot, omit the image block and keep the section text-only.',
        'Use descriptive alt text and keep images tied to the content instead of decorative filler.',
    ].join('\n');
}

function looksLikeStandaloneHtml(text = '') {
    return /<!doctype html>|<html\b|<body\b|<main\b|<article\b|<section\b|<header\b|<figure\b|<img\b|<h1\b/i.test(String(text || ''));
}

function renderSectionContentHtml(content = '') {
    const normalized = String(content || '').trim();
    if (!normalized) {
        return '';
    }

    if (/<[a-z][\s\S]*>/i.test(normalized)) {
        return normalized;
    }

    return normalized
        .split(/\n{2,}/)
        .map((block) => {
            const trimmed = block.trim();
            if (!trimmed) {
                return '';
            }

            const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);
            const bulletLines = lines.filter((line) => /^[-*]\s+/.test(line));
            const numberedLines = lines.filter((line) => /^\d+\.\s+/.test(line));

            if (lines.length > 0 && bulletLines.length === lines.length) {
                return `<ul>${bulletLines.map((line) => `<li>${escapeHtml(line.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`;
            }

            if (lines.length > 0 && numberedLines.length === lines.length) {
                return `<ol>${numberedLines.map((line) => `<li>${escapeHtml(line.replace(/^\d+\.\s+/, ''))}</li>`).join('')}</ol>`;
            }

            return `<p>${escapeHtml(trimmed).replace(/\n/g, '<br>')}</p>`;
        })
        .filter(Boolean)
        .join('\n');
}

function buildImageFigureHtml(imageReference, fallbackAlt = 'Document image') {
    const url = normalizeImageReferenceUrl(imageReference?.url || '');
    const allowInternal = imageReference?.internal === true || isInternalArtifactImageReferenceUrl(url);
    if (!url || !isRenderableImageReferenceUrl(url, { allowInternal })) {
        return '';
    }

    const alt = escapeHtml(String(imageReference?.title || fallbackAlt || 'Document image').trim());
    const sourceLabel = escapeHtml(String(imageReference?.source || 'source').trim());
    const safeUrl = escapeHtml(url);

    return [
        '<figure class="document-image">',
        `  <img src="${safeUrl}" alt="${alt}" loading="eager">`,
        `  <figcaption>${alt} <span class="document-credit">Source: <a href="${safeUrl}" target="_blank" rel="noreferrer">${sourceLabel}</a></span></figcaption>`,
        '</figure>',
    ].join('\n');
}

function pickImageReference(imageReferences = [], index = 0) {
    const normalized = Array.isArray(imageReferences)
        ? imageReferences.filter((entry) => {
            const url = normalizeImageReferenceUrl(entry?.url || '');
            return url && isRenderableImageReferenceUrl(url, {
                allowInternal: entry?.internal === true || isInternalArtifactImageReferenceUrl(url),
            });
        })
        : [];

    if (normalized.length === 0) {
        return null;
    }

    return normalized[index % normalized.length];
}

function buildExpandedDocumentHtml(title = 'Document', sections = [], imageReferences = [], creativePlan = null) {
    const safeTitle = escapeHtml(title);
    const normalizedSections = Array.isArray(sections) ? sections : [];
    const normalizedImages = Array.isArray(imageReferences) ? imageReferences : [];
    const theme = resolveDocumentTheme(creativePlan?.themeSuggestion || 'editorial');
    const heroImage = pickImageReference(normalizedImages, 0);
    const accentPills = [
        creativePlan?.label || 'Crafted document',
        `${normalizedSections.length || 1} section${normalizedSections.length === 1 ? '' : 's'}`,
        creativePlan?.rationale || '',
    ].filter(Boolean).slice(0, 3);
    const humanNotes = Array.isArray(creativePlan?.humanizationNotes)
        ? creativePlan.humanizationNotes.slice(0, 3)
        : [];

    const heroMarkup = [
        '<section class="document-hero-shell">',
        '  <div class="document-hero-copy">',
        `    <p class="document-eyebrow">${escapeHtml(creativePlan?.label || 'Crafted document')}</p>`,
        `    <h1>${safeTitle}</h1>`,
        creativePlan?.rationale ? `    <p class="document-standfirst">${escapeHtml(creativePlan.rationale)}</p>` : '',
        accentPills.length > 0 ? `    <div class="document-pill-row">${accentPills.map((pill) => `<span class="document-pill">${escapeHtml(pill)}</span>`).join('')}</div>` : '',
        humanNotes.length > 0 ? `    <div class="document-human-notes">${humanNotes.map((note) => `<p>${escapeHtml(note)}</p>`).join('')}</div>` : '',
        '  </div>',
        heroImage
            ? `  <div class="document-hero-media">${buildImageFigureHtml(heroImage, `${title} hero image`).replace(/\n/g, '\n    ')}</div>`
            : '  <div class="document-hero-panel"><p>Built from the approved plan with a deliberate narrative rhythm and visual structure.</p></div>',
        '</section>',
    ].filter(Boolean).join('\n');

    const sectionMarkup = normalizedSections.map((section, index) => {
        const safeHeading = escapeHtml(String(section?.heading || `Section ${index + 1}`).trim());
        const bodyMarkup = renderSectionContentHtml(section?.content || '');
        const primaryImage = pickImageReference(normalizedImages, index + 1);
        const supportingImage = normalizedImages.length >= 4 && index % 2 === 0
            ? pickImageReference(normalizedImages, index + 2)
            : null;
        const figureMarkup = buildImageFigureHtml(primaryImage, section?.heading || title);
        const supportingFigureMarkup = supportingImage && supportingImage?.url !== primaryImage?.url
            ? buildImageFigureHtml(supportingImage, `${section?.heading || title} supporting image`)
            : '';
        const imageRailMarkup = figureMarkup || supportingFigureMarkup
            ? [
                '<div class="document-image-rail">',
                figureMarkup ? `  ${figureMarkup.replace(/\n/g, '\n  ')}` : '',
                supportingFigureMarkup ? `  ${supportingFigureMarkup.replace(/\n/g, '\n  ')}` : '',
                '</div>',
            ].filter(Boolean).join('\n')
            : '';
        const kicker = section?.kicker
            ? `<p class="document-section-kicker">${escapeHtml(section.kicker)}</p>`
            : '';
        const aside = section?.visualIntent
            ? `<aside class="document-section-aside">${escapeHtml(section.visualIntent)}</aside>`
            : '';

        return [
            `<section class="document-section" data-section-index="${index + 1}">`,
            '  <div class="document-section-chrome">',
            `    <span class="document-section-number">${String(index + 1).padStart(2, '0')}</span>`,
            `    <span class="document-section-tag">${escapeHtml(section?.visualIntent || section?.kicker || 'story block')}</span>`,
            '  </div>',
            '  <div class="document-section-body">',
            kicker ? `    ${kicker}` : '',
            `    <h2>${safeHeading}</h2>`,
            aside ? `    ${aside}` : '',
            imageRailMarkup ? `    ${imageRailMarkup.replace(/\n/g, '\n    ')}` : '',
            `    <div class="document-copy">${bodyMarkup}</div>`,
            '  </div>',
            '</section>',
        ].filter(Boolean).join('\n');
    }).join('\n');

    const remainingImages = normalizedImages.slice(Math.min(normalizedImages.length, normalizedSections.length + 1));
    const galleryMarkup = remainingImages.length > 0
        ? [
            '<section class="document-section document-gallery">',
            '  <div class="document-section-chrome">',
            '    <span class="document-section-number">++</span>',
            '    <span class="document-section-tag">visual appendix</span>',
            '  </div>',
            '  <div class="document-section-body">',
            '    <h2>Image Gallery</h2>',
            '    <div class="document-gallery-grid">',
            ...remainingImages.map((imageReference, index) => `      ${buildImageFigureHtml(imageReference, `${title} image ${index + 1}`).replace(/\n/g, '\n      ')}`),
            '    </div>',
            '  </div>',
            '</section>',
        ].join('\n')
        : '';

    return [
        '<!DOCTYPE html>',
        '<html>',
        '<head>',
        '  <meta charset="utf-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1">',
        `  <title>${safeTitle}</title>`,
        '  <style>',
        '    :root {',
        `      --doc-bg: ${theme.background};`,
        `      --doc-surface: ${theme.page};`,
        `      --doc-panel: ${theme.panel};`,
        `      --doc-panel-alt: ${theme.panelAlt};`,
        `      --doc-text: ${theme.text};`,
        `      --doc-muted: ${theme.muted};`,
        `      --doc-accent: ${theme.accent};`,
        `      --doc-border: ${theme.border};`,
        '      --doc-shadow: 0 28px 70px rgba(15, 23, 42, 0.12);',
        '    }',
        '    * { box-sizing: border-box; }',
        '    body { margin: 0; font-family: "Aptos", "Segoe UI", sans-serif; color: var(--doc-text); background: radial-gradient(circle at top, rgba(255,255,255,0.72), var(--doc-bg) 46%); }',
        '    main { max-width: 1120px; margin: 0 auto; padding: 36px 20px 72px; }',
        '    .document-hero-shell { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(260px, 0.9fr); gap: 20px; background: var(--doc-surface); border: 1px solid var(--doc-border); border-radius: 28px; padding: 28px; box-shadow: var(--doc-shadow); margin-bottom: 24px; }',
        '    .document-eyebrow, .document-section-kicker, .document-section-tag { color: var(--doc-accent); text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.78rem; font-weight: 700; }',
        '    .document-hero-copy h1 { margin: 0; font-size: clamp(2.6rem, 6vw, 4.8rem); line-height: 0.94; max-width: 12ch; }',
        '    .document-standfirst { color: var(--doc-muted); font-size: 1.05rem; line-height: 1.7; max-width: 58ch; margin: 16px 0 0; }',
        '    .document-pill-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }',
        '    .document-pill { display: inline-flex; align-items: center; padding: 8px 12px; border-radius: 999px; background: var(--doc-panel); border: 1px solid var(--doc-border); font-size: 0.88rem; }',
        '    .document-human-notes { display: grid; gap: 8px; margin-top: 18px; }',
        '    .document-human-notes p, .document-hero-panel p { margin: 0; padding: 12px 14px; background: var(--doc-panel-alt); border: 1px solid var(--doc-border); border-radius: 16px; color: var(--doc-muted); }',
        '    .document-hero-media, .document-hero-panel { display: grid; align-content: stretch; }',
        '    .document-hero-media .document-image, .document-hero-panel { height: 100%; margin: 0; }',
        '    .document-hero-media .document-image img { min-height: 100%; height: 100%; object-fit: cover; }',
        '    .document-section { display: grid; grid-template-columns: 82px minmax(0, 1fr); gap: 18px; background: var(--doc-surface); border: 1px solid var(--doc-border); border-radius: 24px; padding: 22px; box-shadow: var(--doc-shadow); margin: 0 0 20px; }',
        '    .document-section:nth-of-type(even) { background: linear-gradient(180deg, var(--doc-surface), var(--doc-panel)); }',
        '    .document-section-number { font-size: 1.95rem; font-weight: 800; color: var(--doc-accent); line-height: 1; }',
        '    .document-section-chrome { display: grid; align-content: start; gap: 8px; }',
        '    .document-section-body h2 { margin: 0; font-size: clamp(1.5rem, 3vw, 2.4rem); line-height: 1.02; }',
        '    .document-section-aside { margin: 14px 0 0; padding: 12px 14px; border-left: 4px solid var(--doc-accent); background: var(--doc-panel); border-radius: 0 16px 16px 0; color: var(--doc-muted); }',
        '    .document-copy { margin-top: 18px; }',
        '    .document-copy p, .document-copy ul, .document-copy ol { margin: 0 0 16px; }',
        '    .document-copy ul, .document-copy ol { padding-left: 1.2rem; }',
        '    .document-image-rail { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin: 22px 0 24px; }',
        '    .document-image { margin: 0; }',
        '    .document-image img { width: 100%; height: auto; min-height: 220px; object-fit: cover; border-radius: 18px; display: block; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.16); }',
        '    .document-image figcaption { font-size: 12px; color: var(--doc-muted); margin-top: 8px; }',
        '    .document-credit { display: inline-block; margin-left: 8px; }',
        '    .document-gallery-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; margin-top: 18px; }',
        '    a { color: var(--doc-accent); }',
        '    @media (max-width: 840px) {',
        '      .document-hero-shell, .document-section { grid-template-columns: 1fr; }',
        '      .document-section-chrome { grid-auto-flow: column; justify-content: space-between; align-items: center; }',
        '    }',
        '  </style>',
        '</head>',
        '<body>',
        '  <main>',
        `    ${heroMarkup.replace(/\n/g, '\n    ')}`,
        sectionMarkup || '    <section class="document-section"><div class="document-section-body"><p>No content provided.</p></div></section>',
        galleryMarkup ? `    ${galleryMarkup.replace(/\n/g, '\n    ')}` : '',
        '  </main>',
        '</body>',
        '</html>',
    ].filter(Boolean).join('\n');
}

function shouldRecoverCompositionOutput(outputText = '', expandedDocument = null) {
    const raw = String(outputText || '').trim();
    if (!raw) {
        return true;
    }

    const plain = stripHtml(raw).replace(/\s+/g, ' ').trim();
    if (!plain) {
        return true;
    }

    let score = 0;
    if (!looksLikeStandaloneHtml(raw)) {
        score += 2;
    }

    score += COMPOSITION_PLANNING_PATTERNS.filter((pattern) => pattern.test(plain)).length * 2;
    score += Math.min(2, COMPOSITION_META_PHRASES.filter((pattern) => pattern.test(plain)).length);

    const expectedHeadings = Array.isArray(expandedDocument?.sections)
        ? expandedDocument.sections
            .map((section) => String(section?.heading || '').trim().toLowerCase())
            .filter(Boolean)
        : [];

    if (expectedHeadings.length > 0) {
        const matchedHeadings = expectedHeadings.filter((heading) => plain.toLowerCase().includes(heading)).length;
        if (matchedHeadings === 0) {
            score += 1;
        }
    }

    return score >= 3;
}

function shouldFetchUnsplashReferences(prompt = '') {
    const normalized = String(prompt || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    if (/\b(no images|without images|text only|text-only|no photos|without photos)\b/.test(normalized)) {
        return false;
    }

    return /\bunsplash\b/.test(normalized)
        || /\b(image|images|photo|photos|hero|gallery|visual|visuals|cover image|real images)\b/.test(normalized);
}

function inferUnsplashQuery(prompt = '') {
    const cleaned = String(prompt || '').toLowerCase()
        .replace(/^(create|make|generate|build|produce|write|draft)\s+/i, '')
        .replace(/\b(a|an|the|with|for|using|use|real|visual|visuals|image|images|photo|photos|unsplash)\b/g, ' ')
        .replace(/\b(html|pdf|docx|page|document|website|web|landing|create|make|generate|build|polished|guide|brief|report)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned) {
        return null;
    }

    return cleaned.split(' ').slice(0, 6).join(' ');
}

function isFrontendDemoArtifactRequest(prompt = '') {
    const normalized = String(prompt || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(website|web page|webpage|landing page|homepage|microsite|marketing site|product page|campaign page|frontend demo|front-end demo|site prototype|site mockup)\b/.test(normalized);
}

class ArtifactService {
    ensureEnabled() {
        if (!postgres.enabled) {
            const error = new Error('Artifacts require Postgres to be configured');
            error.statusCode = 503;
            throw error;
        }
    }

    async ensureSessionRecord(sessionId, session = null) {
        this.ensureEnabled();

        if (!sessionId) {
            const error = new Error('sessionId is required for artifact storage');
            error.statusCode = 400;
            throw error;
        }

        await postgres.initialize();
        await postgres.query(
            `
                INSERT INTO sessions (id, previous_response_id, metadata)
                VALUES ($1, $2, $3::jsonb)
                ON CONFLICT (id) DO NOTHING
            `,
            [
                sessionId,
                session?.previousResponseId || null,
                JSON.stringify(session?.metadata || {}),
            ],
        );
    }

    serializeArtifact(artifact) {
        if (!artifact) return null;

        return {
            id: artifact.id,
            sessionId: artifact.sessionId,
            parentArtifactId: artifact.parentArtifactId,
            direction: artifact.direction,
            sourceMode: artifact.sourceMode,
            filename: artifact.filename,
            format: artifact.extension,
            mimeType: artifact.mimeType,
            sizeBytes: artifact.sizeBytes,
            status: 'ready',
            vectorized: Boolean(artifact.vectorizedAt),
            downloadUrl: `/api/artifacts/${artifact.id}/download`,
            preview: artifact.previewHtml
                ? { type: 'html', content: artifact.previewHtml }
                : (artifact.extractedText ? { type: 'text', content: artifact.extractedText.slice(0, 4000) } : null),
            metadata: artifact.metadata || {},
            createdAt: artifact.createdAt,
        };
    }

    async vectorizeArtifactText(artifact, extractedText) {
        const chunks = chunkText(extractedText);
        if (chunks.length === 0) {
            return null;
        }

        for (let index = 0; index < chunks.length; index += 1) {
            await vectorStore.store(artifact.sessionId, chunks[index], {
                artifactId: artifact.id,
                filename: artifact.filename,
                mimeType: artifact.mimeType,
                chunkIndex: index,
                sourceKind: 'file',
            });
        }

        return new Date().toISOString();
    }

    async createStoredArtifact({
        sessionId,
        session = null,
        parentArtifactId = null,
        direction,
        sourceMode,
        filename,
        extension,
        mimeType,
        buffer,
        extractedText = '',
        previewHtml = '',
        metadata = {},
        vectorize = true,
    }) {
        this.ensureEnabled();
        await this.ensureSessionRecord(sessionId, session);

        const artifact = await artifactStore.create({
            id: uuidv4(),
            sessionId,
            parentArtifactId,
            direction,
            sourceMode,
            filename,
            extension,
            mimeType,
            sizeBytes: buffer.length,
            sha256: sha256(buffer),
            contentBuffer: buffer,
            extractedText,
            previewHtml,
            metadata,
            vectorizedAt: null,
        });

        let vectorizedAt = null;
        if (vectorize && extractedText) {
            vectorizedAt = await this.vectorizeArtifactText(artifact, extractedText);
        }

        return artifactStore.updateProcessing(artifact.id, {
            extractedText,
            previewHtml,
            metadata,
            vectorizedAt,
        });
    }

    async uploadArtifact({ sessionId, mode = 'chat', label = '', tags = [], file }) {
        this.ensureEnabled();

        if (!file || !file.buffer || !file.filename) {
            const error = new Error('A file upload is required');
            error.statusCode = 400;
            throw error;
        }

        const requestedFormat = normalizeFormat(inferFormat(file.filename, file.mimeType));
        if (!SUPPORTED_UPLOAD_FORMATS.has(requestedFormat) && requestedFormat !== 'power-query') {
            const error = new Error(`Unsupported upload format: ${requestedFormat || file.filename}`);
            error.statusCode = 400;
            throw error;
        }

        let extraction = {
            format: requestedFormat,
            extractedText: '',
            previewHtml: '',
            metadata: {},
            vectorizable: false,
        };

        try {
            extraction = await extractArtifact({
                filename: file.filename,
                mimeType: file.mimeType,
                buffer: file.buffer,
            });
        } catch (error) {
            console.warn('[Artifacts] Extraction failed, storing raw file only:', error.message);
            extraction.metadata = {
                extractionError: error.message,
            };
        }

        const format = normalizeFormat(extraction.format || requestedFormat);
        const artifact = await this.createStoredArtifact({
            sessionId,
            direction: 'uploaded',
            sourceMode: mode,
            filename: file.filename,
            extension: format,
            mimeType: file.mimeType || FORMAT_MIME_TYPES[format] || 'application/octet-stream',
            buffer: file.buffer,
            extractedText: extraction.extractedText,
            previewHtml: extraction.previewHtml,
            metadata: {
                ...extraction.metadata,
                label,
                tags: Array.isArray(tags) ? tags : (tags ? [tags] : []),
                originalFilename: file.filename,
            },
            vectorize: extraction.vectorizable,
        });

        return this.serializeArtifact(artifact);
    }

    async listSessionArtifacts(sessionId) {
        const artifacts = await artifactStore.listBySession(sessionId);
        return artifacts.map((artifact) => this.serializeArtifact(artifact));
    }

    async getArtifact(id, options = {}) {
        const artifact = await artifactStore.get(id, options);
        if (!artifact) return null;
        return options.includeContent ? artifact : this.serializeArtifact(artifact);
    }

    async deleteArtifact(id) {
        const artifact = await artifactStore.get(id);
        if (!artifact) return false;

        await vectorStore.deleteArtifact(id);
        return artifactStore.delete(id);
    }

    async deleteArtifactsForSession(sessionId) {
        const artifacts = await artifactStore.listBySession(sessionId);
        for (const artifact of artifacts) {
            await vectorStore.deleteArtifact(artifact.id);
        }
        await artifactStore.deleteBySession(sessionId);
    }

    async buildPromptContext(sessionId, artifactIds = []) {
        if (!postgres.enabled) {
            return '';
        }

        const allArtifacts = await artifactStore.listBySession(sessionId);
        if (allArtifacts.length === 0) {
            return '';
        }

        const selected = artifactIds.length > 0
            ? allArtifacts.filter((artifact) => artifactIds.includes(artifact.id))
            : allArtifacts.slice(0, 8);

        const inventory = allArtifacts.slice(0, 12).map((artifact) => {
            const marker = artifactIds.includes(artifact.id) ? 'selected' : 'available';
            return `- ${artifact.filename} (${artifact.extension}, ${marker}, ${artifact.sizeBytes} bytes)`;
        }).join('\n');

        const selectedDetails = selected.map((artifact) => {
            const summary = artifact.extractedText
                ? artifact.extractedText.slice(0, 1600)
                : stripHtml(artifact.previewHtml || '').slice(0, 1600);
            return `File: ${artifact.filename}\nType: ${artifact.extension}\nSummary:\n${summary || '[binary file without extractable text]'}`;
        }).join('\n\n---\n\n');

        return `[Session artifacts]\n${inventory}\n\n[Selected artifact details]\n${selectedDetails}`;
    }

    sanitizeDocumentInstructionSession(session = null) {
        if (!session?.metadata || typeof session.metadata !== 'object') {
            return session;
        }

        const memory = session.metadata.projectMemory;
        if (!memory || typeof memory !== 'object') {
            return session;
        }

        const sanitizedUrls = Array.isArray(memory.urls)
            ? memory.urls.filter((entry) => {
                const normalizedUrl = normalizeImageReferenceUrl(entry?.url || '');
                if (!normalizedUrl) {
                    return true;
                }

                return !(String(entry?.kind || '').toLowerCase() === 'image' && isInternalArtifactImageReferenceUrl(normalizedUrl));
            })
            : memory.urls;
        const sanitizedArtifacts = Array.isArray(memory.artifacts)
            ? memory.artifacts.filter((entry) => {
                const downloadUrl = normalizeImageReferenceUrl(entry?.downloadUrl || '');
                const format = String(entry?.format || '').trim().toLowerCase();
                const imageLike = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(format);
                return !(downloadUrl && imageLike && isInternalArtifactImageReferenceUrl(downloadUrl));
            })
            : memory.artifacts;

        return {
            ...session,
            metadata: {
                ...session.metadata,
                projectMemory: {
                    ...memory,
                    urls: sanitizedUrls,
                    artifacts: sanitizedArtifacts,
                },
            },
        };
    }

    getGenerationInstructions(format, existingContent = '', promptContext = '', creativityPacket = null, requestPrompt = '') {
        const normalizedFormat = normalizeFormat(format);
        const creativityContext = renderCreativityPromptContext(creativityPacket);
        const base = [
            'You are the LillyBuilt Business Agent.',
            'Produce business-ready output only, with no surrounding commentary.',
            'Do not use external tools, function calls, or tool invocation syntax.',
            'Do not mention environment limitations, permissions, API keys, or inability to create files.',
            'The platform will render, store, and deliver the file artifact for the user.',
            promptContext,
            creativityContext,
            existingContent ? `Existing content to revise:\n${existingContent}` : '',
        ].filter(Boolean).join('\n\n');

        if (normalizedFormat === 'html' && isFrontendDemoArtifactRequest(requestPrompt || `${promptContext}\n${existingContent}`)) {
            return [
                base,
                buildDocumentImageInstructions(),
                'Return standalone HTML only.',
                'Build a polished frontend demo instead of a plain document.',
                'Aim for a strong visual thesis, deliberate layout hierarchy, and a premium landing-page or microsite feel.',
                'Use semantic sections, responsive CSS, and purposeful but restrained interaction.',
                'Keep the result portable so it can be moved into a real frontend repository later.',
                'Use stable ids or data-component attributes on major sections to help later component extraction.',
                'Prefer realistic copy, concrete sections, and clean calls to action over filler cards or placeholder boxes.',
                'Inline CSS and JavaScript are acceptable when they help keep the demo self-contained.',
                'Do not output markdown fences, implementation notes, or follow-up instructions.',
            ].filter(Boolean).join('\n\n');
        }

        if (normalizedFormat === 'html' || normalizedFormat === 'pdf' || normalizedFormat === 'docx') {
            return [
                base,
                buildDocumentImageInstructions(),
                'Return valid standalone HTML with inline-friendly structure and business formatting.',
                'Use a deliberate visual thesis, strong hierarchy, and non-generic section pacing.',
                'Treat any provided template or sample as reference material, not copy to preserve verbatim.',
            ].filter(Boolean).join('\n\n');
        }
        if (normalizedFormat === 'xml') {
            return `${base}\n\nReturn valid XML only. No markdown fences.`;
        }
        if (normalizedFormat === 'mermaid') {
            return `${base}\n\nReturn Mermaid v10-compatible source only. No markdown fences. Put each statement on its own line. Do not collapse the diagram into a single line.`;
        }
        if (normalizedFormat === 'power-query') {
            return `${base}\n\nReturn valid Power Query M script only. No markdown fences.`;
        }
        if (normalizedFormat === 'xlsx') {
            return `${base}\n\nReturn valid JSON only in the shape {"title":"...","sheets":[{"name":"...","rows":[["...", "..."]]}]}. Keep rows tabular and concise.`;
        }

        return base;
    }

    async runGenerationPass({
        session = null,
        input,
        instructions,
        model = null,
        reasoningEffort = null,
        previousResponseId = null,
    }) {
        const response = await requestModelResponse({
            input,
            previousResponseId,
            contextMessages: [],
            recentMessages: [],
            instructions,
            stream: false,
            model,
            reasoningEffort,
        });

        return {
            responseId: response.id,
            outputText: extractResponseText(response),
        };
    }

    getArtifactPlanInstructions(format, promptContext = '', existingContent = '', creativityPacket = null) {
        const creativityContext = renderCreativityPromptContext(creativityPacket);
        return [
            'You are planning a high-quality business document generation workflow.',
            'Return JSON only. No markdown fences.',
            'First decide the document title, creative direction, and the major sections required to satisfy the request.',
            'Prefer 4-8 sections for substantial documents unless the request clearly needs fewer.',
            'Each section should have a concrete purpose, a visible layout role, and 2-5 key points that must be covered.',
            'If verified images are available, plan where real images support the document, but do not invent illustrations.',
            'Do not mirror placeholder headings or sample copy from provided templates.',
            existingContent ? `Existing content to revise:\n${existingContent}` : '',
            promptContext,
            creativityContext,
            '',
            'Return exactly this shape:',
            '{',
            '  "title": "Document title",',
            '  "creativeDirection": {',
            '    "id": "direction-id",',
            '    "label": "Direction label",',
            '    "rationale": "Why this direction fits"',
            '  },',
            '  "themeSuggestion": "editorial|executive|product|bold",',
            '  "humanizationNotes": ["Short note about how to keep the writing human"],',
            '  "sampleHandling": ["Short note about how to avoid copying the sample"],',
            '  "sections": [',
            '    {',
            '      "heading": "Section heading",',
            '      "purpose": "Why this section exists",',
            '      "keyPoints": ["Point 1", "Point 2"],',
            '      "targetLength": "short|medium|long",',
            '      "layout": "lead|briefing|analysis|proof|comparison|close",',
            '      "tone": "How this section should sound",',
            '      "visualIntent": "How real visuals or layout contrast should support the section"',
            '    }',
            '  ]',
            '}',
            `Target output format: ${format}.`,
        ].filter(Boolean).join('\n');
    }

    getArtifactExpansionInstructions(format, promptContext = '', existingContent = '', creativityPacket = null) {
        const creativityContext = renderCreativityPromptContext(creativityPacket);
        return [
            'You are expanding an approved document outline into full section content.',
            'Return JSON only. No markdown fences.',
            'Write polished, business-ready prose for each section.',
            'Keep sections distinct, avoid repetition, and fully cover the requested key points.',
            'Use paragraphs and inline bullets within section content when appropriate.',
            'Make the voice feel authored by a thoughtful human, not evenly templated by a machine.',
            'Vary rhythm between sections instead of giving every section the same sentence cadence.',
            'If verified image references are available, mention the real image use naturally in the section content instead of describing fake illustrations.',
            'Do not echo placeholder copy, sample headings, or tutorial language from the scaffold.',
            existingContent ? `Existing content to revise:\n${existingContent}` : '',
            promptContext,
            creativityContext,
            '',
            'Return exactly this shape:',
            '{',
            '  "title": "Document title",',
            '  "sections": [',
            '    {',
            '      "heading": "Section heading",',
            '      "kicker": "Optional short eyebrow line",',
            '      "content": "Full section content",',
            '      "level": 1,',
            '      "visualIntent": "Optional note for composition about contrast, image use, or pacing"',
            '    }',
            '  ]',
            '}',
            `Target output format: ${format}.`,
        ].filter(Boolean).join('\n');
    }

    getArtifactCompositionInstructions(format, promptContext = '', creativityPacket = null) {
        const creativityContext = renderCreativityPromptContext(creativityPacket);
        return [
            'You are composing the final document artifact from an expanded section draft.',
            'Return valid standalone HTML only. No markdown fences.',
            'Use semantic HTML with a strong document structure.',
            'Include one H1 title and then H2/H3 sections as appropriate.',
            'Preserve the section order and cover all requested content.',
            'Use professional formatting suitable for business reports, briefs, plans, and polished notes.',
            'Keep the layout printer-friendly because the HTML may be rendered to PDF or DOCX.',
            'Use CSS variables, a deliberate theme, and section-level hierarchy so the result feels designed rather than default.',
            'Create a strong opening hero, visible section chrome, and alternating density across sections.',
            'Do not let every section reuse the same card treatment, paragraph width, or transition language.',
            'When verified image URLs are available, make the design image-rich with a hero image, repeated section visuals, image cards, and gallery treatments across the document.',
            'Do not output a layout plan, source register instructions, build checklist, editorial note, or any meta-document that describes how a future document should be assembled.',
            'The output must be the finished document itself, not instructions for building it.',
            buildDocumentImageInstructions(),
            promptContext,
            creativityContext,
            `Target output format: ${format}.`,
        ].filter(Boolean).join('\n');
    }

    formatImageReferenceContext(imageReferences = []) {
        if (!Array.isArray(imageReferences) || imageReferences.length === 0) {
            return '';
        }

        return [
            '[Verified image references]',
            'Use these real image URLs when the output benefits from visuals.',
            `These verified references can be reused throughout the document, up to ${DEFAULT_DOCUMENT_IMAGE_TARGET} images when the request supports it.`,
            'Prefer standard HTML <img src="..."> elements that point to these URLs.',
            ...imageReferences.map((entry, index) => {
                const label = entry.title || `Image ${index + 1}`;
                const source = entry.toolId ? ` via ${entry.toolId}` : '';
                return `- ${label} -> ${entry.url} [${entry.source}${source}]`;
            }),
        ].join('\n');
    }

    async resolveImageReferences(session = null, prompt = '', options = {}) {
        const desiredCount = Math.max(1, Number(options.desiredCount || DEFAULT_DOCUMENT_IMAGE_TARGET) || DEFAULT_DOCUMENT_IMAGE_TARGET);
        const selectedArtifacts = Array.isArray(options.selectedArtifacts) ? options.selectedArtifacts : [];
        const selectedArtifactRefs = extractImageReferencesFromArtifacts(selectedArtifacts);
        const sessionRefs = extractImageReferencesFromSession(session);
        const unique = new Map();
        [...selectedArtifactRefs, ...sessionRefs].forEach((entry) => {
            const allowInternal = entry?.internal === true || isInternalArtifactImageReferenceUrl(entry?.url || '');
            if (!entry?.url || !isRenderableImageReferenceUrl(entry.url, { allowInternal }) || unique.has(entry.url)) {
                return;
            }
            unique.set(entry.url, entry);
        });

        let combinedRefs = Array.from(unique.values()).slice(0, desiredCount);
        const preferVisualDefaults = options.preferVisualDefaults === true;
        const explicitPriorImageReference = refersToPriorImages(prompt);

        if (selectedArtifactRefs.length > 0 || explicitPriorImageReference) {
            return combinedRefs;
        }

        if (!isUnsplashConfigured() || (!preferVisualDefaults && !shouldFetchUnsplashReferences(prompt))) {
            return combinedRefs;
        }

        const query = inferUnsplashQuery(prompt);
        if (!query) {
            return combinedRefs;
        }

        try {
            const results = await searchImages(query, { perPage: desiredCount, orientation: 'landscape' });
            const unsplashRefs = (Array.isArray(results?.results) ? results.results : [])
                .map((image) => ({
                    url: normalizeImageReferenceUrl(image?.urls?.regular || image?.urls?.full || image?.urls?.small || ''),
                    title: String(image?.description || image?.altDescription || query).trim(),
                    source: 'unsplash',
                    toolId: 'image-search-unsplash',
                }))
                .filter((entry) => entry.url && isExternalImageReferenceUrl(entry.url));

            [...combinedRefs, ...unsplashRefs].forEach((entry) => {
                if (!entry?.url || !isExternalImageReferenceUrl(entry.url) || unique.has(entry.url)) {
                    return;
                }
                unique.set(entry.url, entry);
            });

            combinedRefs = Array.from(unique.values()).slice(0, desiredCount);
            return combinedRefs;
        } catch (error) {
            console.warn('[Artifacts] Failed to fetch Unsplash references:', error.message);
            return combinedRefs;
        }
    }

    async buildImageReferenceContext(session = null, prompt = '') {
        return this.formatImageReferenceContext(
            await this.resolveImageReferences(session, prompt, {
                desiredCount: DEFAULT_DOCUMENT_IMAGE_TARGET,
                preferVisualDefaults: true,
            }),
        );
    }

    async generateMultiPassDocumentSource({
        session,
        prompt,
        format,
        promptContext = '',
        existingContent = '',
        model = null,
        reasoningEffort = null,
        imageReferences = [],
        imageReferenceContext = '',
        creativityPacket = null,
    }) {
        const resolvedImageReferences = Array.isArray(imageReferences) ? imageReferences : [];
        const resolvedImageReferenceContext = imageReferenceContext || this.formatImageReferenceContext(resolvedImageReferences);
        const enrichedPromptContext = [promptContext, resolvedImageReferenceContext].filter(Boolean).join('\n\n');
        const planPass = await this.runGenerationPass({
            session,
            input: prompt,
            instructions: buildSessionInstructions(
                session,
                this.getArtifactPlanInstructions(format, enrichedPromptContext, existingContent, creativityPacket),
            ),
            model,
            reasoningEffort,
            previousResponseId: session?.previousResponseId || null,
        });

        const parsedPlan = safeJsonParse(planPass.outputText) || {};
        const creativePlan = normalizeCreativePlan(parsedPlan, creativityPacket);
        const normalizedPlan = {
            title: String(parsedPlan.title || inferDocumentTitle(prompt, `${String(format || 'document').toUpperCase()} Document`)).trim(),
            sections: normalizePlanSections(parsedPlan.sections),
            creativePlan,
        };

        if (normalizedPlan.sections.length === 0) {
            normalizedPlan.sections = [
                {
                    heading: 'Overview',
                    purpose: 'Summarize the document objective and context.',
                    keyPoints: [],
                    targetLength: 'medium',
                    layout: 'lead',
                    tone: 'direct',
                    visualIntent: 'Use a strong opening block that frames the request clearly.',
                },
                {
                    heading: 'Details',
                    purpose: 'Cover the main requested content in detail.',
                    keyPoints: [],
                    targetLength: 'medium',
                    layout: 'analysis',
                    tone: 'grounded',
                    visualIntent: 'Add contrast through image use or spacing rather than repeating the opener.',
                },
            ];
        }

        const expansionPass = await this.runGenerationPass({
            session,
            input: [
                'Original request:',
                prompt,
                '',
                'Approved outline:',
                JSON.stringify(normalizedPlan, null, 2),
            ].join('\n'),
            instructions: buildSessionInstructions(
                session,
                this.getArtifactExpansionInstructions(format, enrichedPromptContext, existingContent, creativityPacket),
            ),
            model,
            reasoningEffort,
        });

        const parsedExpanded = safeJsonParse(expansionPass.outputText) || {};
        const expandedDocument = {
            title: String(parsedExpanded.title || normalizedPlan.title).trim() || normalizedPlan.title,
            sections: normalizeDocumentSections(parsedExpanded.sections, normalizedPlan.sections),
        };

        if (expandedDocument.sections.length === 0) {
            expandedDocument.sections = normalizedPlan.sections.map((section) => ({
                heading: section.heading,
                content: section.keyPoints.length > 0
                    ? section.keyPoints.map((point) => `- ${point}`).join('\n')
                    : section.purpose || '',
                level: 1,
            }));
        }

        const compositionPass = await this.runGenerationPass({
            session,
            input: [
                'Original request:',
                prompt,
                '',
                'Structured document draft:',
                JSON.stringify(expandedDocument, null, 2),
            ].join('\n'),
            instructions: buildSessionInstructions(
                session,
                this.getArtifactCompositionInstructions(format, enrichedPromptContext, creativityPacket),
            ),
            model,
            reasoningEffort,
        });

        const usedCompositionRecovery = shouldRecoverCompositionOutput(compositionPass.outputText, expandedDocument);
        const finalOutputText = usedCompositionRecovery
            ? buildExpandedDocumentHtml(
                expandedDocument.title || normalizedPlan.title,
                expandedDocument.sections,
                resolvedImageReferences,
                creativePlan,
            )
            : compositionPass.outputText;

        return {
            responseId: compositionPass.responseId,
            title: expandedDocument.title || normalizedPlan.title,
            outputText: finalOutputText,
            metadata: {
                generationStrategy: 'multi-pass',
                generationPasses: ['plan', 'expand', 'compose'],
                sectionCount: expandedDocument.sections.length,
                compositionRecovered: usedCompositionRecovery,
                creativeDirectionId: creativePlan.id,
                creativeDirection: creativePlan.label,
                creativeRationale: creativePlan.rationale,
                themeSuggestion: creativePlan.themeSuggestion,
                outline: normalizedPlan.sections.map((section) => ({
                    heading: section.heading,
                    purpose: section.purpose,
                    targetLength: section.targetLength,
                    layout: section.layout,
                })),
            },
        };
    }

    async generateArtifact({
        session,
        sessionId,
        mode = 'chat',
        prompt,
        format,
        artifactIds = [],
        existingContent = '',
        template = '',
        model = null,
        reasoningEffort = null,
        parentArtifactId = null,
    }) {
        const normalizedFormat = normalizeFormat(format);
        const frontendDemoRequest = normalizedFormat === 'html' && isFrontendDemoArtifactRequest(prompt);
        if (!SUPPORTED_GENERATION_FORMATS.has(normalizedFormat)) {
            throw new Error(`Unsupported generation format: ${format}`);
        }

        const promptContext = await this.buildPromptContext(sessionId, artifactIds);
        const selectedArtifacts = postgres.enabled && artifactIds.length > 0
            ? (await Promise.all(artifactIds.slice(0, 8).map((artifactId) => artifactStore.get(artifactId)))).filter(Boolean)
            : [];
        const imageReferences = await this.resolveImageReferences(session, prompt, {
            desiredCount: (MULTI_PASS_DOCUMENT_FORMATS.has(normalizedFormat) || frontendDemoRequest) ? DEFAULT_DOCUMENT_IMAGE_TARGET : 3,
            preferVisualDefaults: MULTI_PASS_DOCUMENT_FORMATS.has(normalizedFormat) || frontendDemoRequest,
            selectedArtifacts,
        });
        const imageReferenceContext = this.formatImageReferenceContext(imageReferences);
        const combinedExistingContent = [template, existingContent].filter(Boolean).join('\n\n');
        const creativityPacket = buildDocumentCreativityPacket({
            prompt,
            documentType: inferDocumentTypeFromPrompt(prompt),
            format: normalizedFormat,
            existingContent: combinedExistingContent,
            session,
        });
        const instructionSession = this.sanitizeDocumentInstructionSession(session);
        const generated = frontendDemoRequest
            ? {
                ...(await this.runGenerationPass({
                    session: instructionSession,
                    input: prompt,
                    instructions: buildSessionInstructions(
                        instructionSession,
                        this.getGenerationInstructions(
                            normalizedFormat,
                            combinedExistingContent,
                            [promptContext, imageReferenceContext].filter(Boolean).join('\n\n'),
                            creativityPacket,
                            prompt,
                        ),
                    ),
                    model,
                    reasoningEffort,
                    previousResponseId: session?.previousResponseId || null,
                })),
                title: inferDocumentTitle(prompt, 'Frontend Demo'),
                metadata: {
                    generationStrategy: 'single-pass-frontend-demo',
                },
            }
            : MULTI_PASS_DOCUMENT_FORMATS.has(normalizedFormat)
            ? await this.generateMultiPassDocumentSource({
                session: instructionSession,
                prompt,
                format: normalizedFormat,
                promptContext,
                existingContent: combinedExistingContent,
                model,
                reasoningEffort,
                imageReferences,
                imageReferenceContext,
                creativityPacket,
            })
            : await this.runGenerationPass({
                session: instructionSession,
                input: prompt,
                instructions: buildSessionInstructions(
                    instructionSession,
                    this.getGenerationInstructions(
                        normalizedFormat,
                        combinedExistingContent,
                        [promptContext, imageReferenceContext].filter(Boolean).join('\n\n'),
                        creativityPacket,
                        prompt,
                    ),
                ),
                model,
                reasoningEffort,
                previousResponseId: session?.previousResponseId || null,
            });

        const outputText = generated.outputText;
        const unwrapped = unwrapCodeFence(outputText);
        const title = generated.title || `${normalizedFormat}-${new Date().toISOString().slice(0, 10)}`;

        const rendered = normalizedFormat === 'xlsx'
            ? await renderArtifact({
                format: normalizedFormat,
                title,
                content: unwrapped,
                workbookSpec: tryParseJson(unwrapped, title),
            })
            : await renderArtifact({
                format: normalizedFormat,
                title,
                content: unwrapped,
            });
        const creativeMetadata = creativityPacket
            ? {
                creativeDirectionId: generated.metadata?.creativeDirectionId || creativityPacket.direction?.id || null,
                creativeDirection: generated.metadata?.creativeDirection || creativityPacket.direction?.label || null,
                creativeRationale: generated.metadata?.creativeRationale || creativityPacket.direction?.rationale || null,
                themeSuggestion: generated.metadata?.themeSuggestion || creativityPacket.themeSuggestion || null,
            }
            : {};

        const artifact = await this.createStoredArtifact({
            sessionId,
            session,
            parentArtifactId,
            direction: 'generated',
            sourceMode: mode,
            filename: rendered.filename,
            extension: rendered.format,
            mimeType: rendered.mimeType,
            buffer: rendered.buffer,
            extractedText: rendered.extractedText,
            previewHtml: rendered.previewHtml,
            metadata: {
                ...rendered.metadata,
                format: normalizedFormat,
                sourcePrompt: prompt,
                artifactIds,
                ...creativeMetadata,
                ...(generated.metadata || {}),
            },
            vectorize: Boolean(rendered.extractedText),
        });

        return {
            responseId: generated.responseId,
            artifact: this.serializeArtifact(artifact),
            outputText,
        };
    }

    async storeGeneratedArtifactFromContent({
        sessionId,
        mode = 'chat',
        format,
        content,
        title = 'generated-artifact',
        parentArtifactId = null,
        metadata = {},
        workbookSpec = null,
    }) {
        const normalizedFormat = normalizeFormat(format);
        const rendered = await renderArtifact({
            format: normalizedFormat,
            title,
            content,
            workbookSpec,
        });

        const artifact = await this.createStoredArtifact({
            sessionId,
            parentArtifactId,
            direction: 'generated',
            sourceMode: mode,
            filename: rendered.filename,
            extension: rendered.format,
            mimeType: rendered.mimeType,
            buffer: rendered.buffer,
            extractedText: rendered.extractedText,
            previewHtml: rendered.previewHtml,
            metadata: { ...rendered.metadata, ...metadata },
            vectorize: Boolean(rendered.extractedText),
        });

        return this.serializeArtifact(artifact);
    }
}

const artifactService = new ArtifactService();

module.exports = {
    artifactService,
    ArtifactService,
    extractResponseText,
    resolveCompletedResponseText,
    getMissingCompletionDelta,
};



