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

class ArtifactService {
    ensureEnabled() {
        if (!postgres.enabled) {
            const error = new Error('Artifacts require Postgres to be configured');
            error.statusCode = 503;
            throw error;
        }
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
            return `${base}\n\nReturn valid standalone HTML with inline-friendly structure and business formatting.`;
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
        const instructions = buildSessionInstructions(
            session,
            this.getGenerationInstructions(normalizedFormat, [template, existingContent].filter(Boolean).join('\n\n'), promptContext),
        );

        const response = await createResponse({
            input: prompt,
            previousResponseId: session?.previousResponseId || null,
            contextMessages: [],
            instructions,
            stream: false,
            model,
        });

        const outputText = extractResponseText(response);
        const unwrapped = unwrapCodeFence(outputText);
        const title = `${normalizedFormat}-${new Date().toISOString().slice(0, 10)}`;

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
            },
            vectorize: Boolean(rendered.extractedText),
        });

        return {
            responseId: response.id,
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



