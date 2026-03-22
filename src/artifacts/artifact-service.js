const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { artifactStore } = require('./artifact-store');
const { extractArtifact } = require('./artifact-extractor');
const { renderArtifact } = require('./artifact-renderer');
const { FORMAT_MIME_TYPES, SUPPORTED_GENERATION_FORMATS, SUPPORTED_UPLOAD_FORMATS, inferFormat, normalizeFormat } = require('./constants');
const { chunkText, stripHtml } = require('../utils/text');
const { vectorStore } = require('../memory/vector-store');
const { createResponse } = require('../openai-client');
const { buildSessionInstructions } = require('../session-instructions');
const { postgres } = require('../postgres');
const { searchImages, isConfigured: isUnsplashConfigured } = require('../unsplash-client');
const MULTI_PASS_DOCUMENT_FORMATS = new Set(['html', 'pdf', 'docx']);

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function extractResponseText(response) {
    return response.output
        .filter((item) => item.type === 'message')
        .map((item) => item.content.map((content) => content.text).join(''))
        .join('\n')
        .trim();
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
        }))
        .filter((section) => section.heading && section.content);
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

function extractImageReferencesFromSession(session = null) {
    const entries = Array.isArray(session?.metadata?.projectMemory?.urls)
        ? session.metadata.projectMemory.urls
        : [];
    const unique = new Map();

    entries.forEach((entry) => {
        const url = normalizeImageReferenceUrl(entry?.url || '');
        if (!url || (!isLikelyImageUrl(url) && String(entry?.kind || '').toLowerCase() !== 'image')) {
            return;
        }

        unique.set(url, {
            url,
            title: String(entry?.title || '').trim(),
            source: String(entry?.source || '').trim() || 'session',
            toolId: String(entry?.toolId || '').trim(),
        });
    });

    return Array.from(unique.values()).slice(-8);
}

function buildDocumentImageInstructions() {
    return [
        'When verified image URLs are available in session memory or prompt context, use those real images with standard HTML <img> tags.',
        'Prefer remembered direct image URLs and Unsplash image URLs over generated decorative placeholders.',
        'Never create inline SVG artwork, multilayered SVG mockups, CSS-only fake photos, canvas placeholders, blob URLs, or data:image embeds unless the user explicitly asks for vector artwork.',
        'If no verified image URL is available for a visual slot, omit the image block and keep the section text-only.',
        'Use descriptive alt text and keep images tied to the content instead of decorative filler.',
    ].join('\n');
}

function shouldFetchUnsplashReferences(prompt = '') {
    const normalized = String(prompt || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\bunsplash\b/.test(normalized)
        || /\b(image|images|photo|photos|hero|gallery|visual|visuals|cover image|real images)\b/.test(normalized);
}

function inferUnsplashQuery(prompt = '') {
    const title = inferDocumentTitle(prompt, '').toLowerCase();
    const cleaned = title
        .replace(/\b(a|an|the|with|for|using|use|real|visual|visuals|image|images|photo|photos|unsplash)\b/g, ' ')
        .replace(/\b(html|pdf|docx|page|document|website|web|landing|create|make|generate|build|polished|guide|brief|report)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned) {
        return null;
    }

    return cleaned.split(' ').slice(0, 6).join(' ');
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

    getGenerationInstructions(format, existingContent = '', promptContext = '') {
        const normalizedFormat = normalizeFormat(format);
        const base = [
            'You are the LillyBuilt Business Agent.',
            'Produce business-ready output only, with no surrounding commentary.',
            'Do not use external tools, function calls, or tool invocation syntax.',
            'Do not mention environment limitations, permissions, API keys, or inability to create files.',
            'The platform will render, store, and deliver the file artifact for the user.',
            promptContext,
            existingContent ? `Existing content to revise:\n${existingContent}` : '',
        ].filter(Boolean).join('\n\n');

        if (normalizedFormat === 'html' || normalizedFormat === 'pdf' || normalizedFormat === 'docx') {
            return `${base}\n\n${buildDocumentImageInstructions()}\n\nReturn valid standalone HTML with inline-friendly structure and business formatting.`;
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
        previousResponseId = null,
    }) {
        const response = await createResponse({
            input,
            previousResponseId,
            contextMessages: [],
            recentMessages: [],
            instructions,
            stream: false,
            model,
        });

        return {
            responseId: response.id,
            outputText: extractResponseText(response),
        };
    }

    getArtifactPlanInstructions(format, promptContext = '', existingContent = '') {
        return [
            'You are planning a high-quality business document generation workflow.',
            'Return JSON only. No markdown fences.',
            'First decide the document title and the major sections required to satisfy the request.',
            'Prefer 4-8 sections for substantial documents unless the request clearly needs fewer.',
            'Each section should have a concrete purpose and 2-5 key points that must be covered.',
            'If verified images are available, plan where real images support the document, but do not invent illustrations.',
            existingContent ? `Existing content to revise:\n${existingContent}` : '',
            promptContext,
            '',
            'Return exactly this shape:',
            '{',
            '  "title": "Document title",',
            '  "sections": [',
            '    {',
            '      "heading": "Section heading",',
            '      "purpose": "Why this section exists",',
            '      "keyPoints": ["Point 1", "Point 2"],',
            '      "targetLength": "short|medium|long"',
            '    }',
            '  ]',
            '}',
            `Target output format: ${format}.`,
        ].filter(Boolean).join('\n');
    }

    getArtifactExpansionInstructions(format, promptContext = '', existingContent = '') {
        return [
            'You are expanding an approved document outline into full section content.',
            'Return JSON only. No markdown fences.',
            'Write polished, business-ready prose for each section.',
            'Keep sections distinct, avoid repetition, and fully cover the requested key points.',
            'Use paragraphs and inline bullets within section content when appropriate.',
            'If verified image references are available, mention the real image use naturally in the section content instead of describing fake illustrations.',
            existingContent ? `Existing content to revise:\n${existingContent}` : '',
            promptContext,
            '',
            'Return exactly this shape:',
            '{',
            '  "title": "Document title",',
            '  "sections": [',
            '    {',
            '      "heading": "Section heading",',
            '      "content": "Full section content",',
            '      "level": 1',
            '    }',
            '  ]',
            '}',
            `Target output format: ${format}.`,
        ].filter(Boolean).join('\n');
    }

    getArtifactCompositionInstructions(format, promptContext = '') {
        return [
            'You are composing the final document artifact from an expanded section draft.',
            'Return valid standalone HTML only. No markdown fences.',
            'Use semantic HTML with a strong document structure.',
            'Include one H1 title and then H2/H3 sections as appropriate.',
            'Preserve the section order and cover all requested content.',
            'Use professional formatting suitable for business reports, briefs, plans, and polished notes.',
            'Keep the layout printer-friendly because the HTML may be rendered to PDF or DOCX.',
            buildDocumentImageInstructions(),
            promptContext,
            `Target output format: ${format}.`,
        ].filter(Boolean).join('\n');
    }

    async buildImageReferenceContext(session = null, prompt = '') {
        const sessionRefs = extractImageReferencesFromSession(session);
        if (sessionRefs.length > 0) {
            return [
                '[Verified image references]',
                'Use these real image URLs when the output benefits from visuals.',
                'Prefer standard HTML <img src="..."> elements that point to these URLs.',
                ...sessionRefs.map((entry, index) => {
                    const label = entry.title || `Image ${index + 1}`;
                    const source = entry.toolId ? ` via ${entry.toolId}` : '';
                    return `- ${label} -> ${entry.url} [${entry.source}${source}]`;
                }),
            ].join('\n');
        }

        if (!isUnsplashConfigured() || !shouldFetchUnsplashReferences(prompt)) {
            return '';
        }

        const query = inferUnsplashQuery(prompt);
        if (!query) {
            return '';
        }

        try {
            const results = await searchImages(query, { perPage: 3, orientation: 'landscape' });
            const unsplashRefs = (Array.isArray(results?.results) ? results.results : [])
                .map((image) => ({
                    url: normalizeImageReferenceUrl(image?.urls?.regular || image?.urls?.full || image?.urls?.small || ''),
                    title: String(image?.description || image?.altDescription || query).trim(),
                    source: 'unsplash',
                    toolId: 'image-search-unsplash',
                }))
                .filter((entry) => entry.url);

            if (unsplashRefs.length === 0) {
                return '';
            }

            return [
                '[Verified image references]',
                'Use these real image URLs when the output benefits from visuals.',
                'Prefer standard HTML <img src="..."> elements that point to these URLs.',
                ...unsplashRefs.map((entry, index) => {
                    const label = entry.title || `Unsplash image ${index + 1}`;
                    return `- ${label} -> ${entry.url} [${entry.source} via ${entry.toolId}]`;
                }),
            ].join('\n');
        } catch (error) {
            console.warn('[Artifacts] Failed to fetch Unsplash references:', error.message);
            return '';
        }
    }

    async generateMultiPassDocumentSource({
        session,
        prompt,
        format,
        promptContext = '',
        existingContent = '',
        model = null,
    }) {
        const imageReferenceContext = await this.buildImageReferenceContext(session, prompt);
        const enrichedPromptContext = [promptContext, imageReferenceContext].filter(Boolean).join('\n\n');
        const planPass = await this.runGenerationPass({
            session,
            input: prompt,
            instructions: buildSessionInstructions(
                session,
                this.getArtifactPlanInstructions(format, enrichedPromptContext, existingContent),
            ),
            model,
            previousResponseId: session?.previousResponseId || null,
        });

        const parsedPlan = safeJsonParse(planPass.outputText) || {};
        const normalizedPlan = {
            title: String(parsedPlan.title || inferDocumentTitle(prompt, `${String(format || 'document').toUpperCase()} Document`)).trim(),
            sections: normalizePlanSections(parsedPlan.sections),
        };

        if (normalizedPlan.sections.length === 0) {
            normalizedPlan.sections = [
                {
                    heading: 'Overview',
                    purpose: 'Summarize the document objective and context.',
                    keyPoints: [],
                    targetLength: 'medium',
                },
                {
                    heading: 'Details',
                    purpose: 'Cover the main requested content in detail.',
                    keyPoints: [],
                    targetLength: 'medium',
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
                this.getArtifactExpansionInstructions(format, enrichedPromptContext, existingContent),
            ),
            model,
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
                this.getArtifactCompositionInstructions(format, enrichedPromptContext),
            ),
            model,
        });

        return {
            responseId: compositionPass.responseId,
            title: expandedDocument.title || normalizedPlan.title,
            outputText: compositionPass.outputText,
            metadata: {
                generationStrategy: 'multi-pass',
                generationPasses: ['plan', 'expand', 'compose'],
                sectionCount: expandedDocument.sections.length,
                outline: normalizedPlan.sections.map((section) => ({
                    heading: section.heading,
                    purpose: section.purpose,
                    targetLength: section.targetLength,
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
        parentArtifactId = null,
    }) {
        const normalizedFormat = normalizeFormat(format);
        if (!SUPPORTED_GENERATION_FORMATS.has(normalizedFormat)) {
            throw new Error(`Unsupported generation format: ${format}`);
        }

        const promptContext = await this.buildPromptContext(sessionId, artifactIds);
        const imageReferenceContext = await this.buildImageReferenceContext(session, prompt);
        const enrichedPromptContext = [promptContext, imageReferenceContext].filter(Boolean).join('\n\n');
        const combinedExistingContent = [template, existingContent].filter(Boolean).join('\n\n');
        const generated = MULTI_PASS_DOCUMENT_FORMATS.has(normalizedFormat)
            ? await this.generateMultiPassDocumentSource({
                session,
                prompt,
                format: normalizedFormat,
                promptContext: enrichedPromptContext,
                existingContent: combinedExistingContent,
                model,
            })
            : await this.runGenerationPass({
                session,
                input: prompt,
                instructions: buildSessionInstructions(
                    session,
                    this.getGenerationInstructions(normalizedFormat, combinedExistingContent, enrichedPromptContext),
                ),
                model,
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
};



