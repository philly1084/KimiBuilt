function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function decodeXmlEntities(value = '') {
    return String(value)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '\"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

function stripHtml(html = '') {
    return decodeXmlEntities(
        String(html)
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|section|article|h[1-6]|li|tr|table)>/gi, '\n')
            .replace(/<li[^>]*>/gi, '- ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\r/g, '')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]{2,}/g, ' ')
            .trim(),
    );
}

function xmlToText(xml = '') {
    return decodeXmlEntities(
        String(xml)
            .replace(/<w:tab\/>/g, '\t')
            .replace(/<w:br\/>/g, '\n')
            .replace(/<\/w:p>/g, '\n')
            .replace(/<\/(?:row|sheetData|si|t|p|div|br|li|tr|h[1-6])>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\r/g, '')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]{2,}/g, ' ')
            .trim(),
    );
}

function escapeXml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function normalizeWhitespace(value = '') {
    return String(value)
        .replace(/\r/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function slugifyFilename(value = 'artifact') {
    const clean = String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return clean || 'artifact';
}

function chunkText(text = '', maxLength = 1200) {
    const normalized = normalizeWhitespace(text);
    if (!normalized) return [];

    const chunks = [];
    const paragraphs = normalized.split(/\n{2,}/);
    let current = '';

    for (const paragraph of paragraphs) {
        const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
        if (candidate.length <= maxLength) {
            current = candidate;
            continue;
        }

        if (current) {
            chunks.push(current);
            current = '';
        }

        if (paragraph.length <= maxLength) {
            current = paragraph;
            continue;
        }

        const sentences = paragraph.split(/(?<=[.!?])\s+/);
        let sentenceBuffer = '';
        for (const sentence of sentences) {
            const sentenceCandidate = sentenceBuffer ? `${sentenceBuffer} ${sentence}` : sentence;
            if (sentenceCandidate.length <= maxLength) {
                sentenceBuffer = sentenceCandidate;
            } else {
                if (sentenceBuffer) {
                    chunks.push(sentenceBuffer);
                }
                if (sentence.length <= maxLength) {
                    sentenceBuffer = sentence;
                } else {
                    for (let index = 0; index < sentence.length; index += maxLength) {
                        chunks.push(sentence.slice(index, index + maxLength));
                    }
                    sentenceBuffer = '';
                }
            }
        }

        if (sentenceBuffer) {
            current = sentenceBuffer;
        }
    }

    if (current) {
        chunks.push(current);
    }

    return chunks.filter(Boolean);
}

module.exports = {
    chunkText,
    decodeXmlEntities,
    escapeHtml,
    escapeXml,
    normalizeWhitespace,
    slugifyFilename,
    stripHtml,
    xmlToText,
};
