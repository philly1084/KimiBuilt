const { normalizeWhitespace, stripHtml, stripNullCharacters } = require('../utils/text');

function createServiceError(statusCode, message, code = 'tts_error') {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function normalizeSpeechSentence(line = '') {
    const trimmed = String(line || '').trim();
    if (!trimmed) {
        return '';
    }

    if (/[.!?]$/.test(trimmed)) {
        return trimmed;
    }

    if (/[:;]$/.test(trimmed)) {
        return `${trimmed.slice(0, -1)}.`;
    }

    return `${trimmed}.`;
}

function stripMarkdownForSpeech(input = '') {
    const markdown = String(input || '')
        .replace(/\r\n?/g, '\n')
        .replace(/```[\s\S]*?```/g, '\nCode example omitted.\n')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/^\s{0,3}>\s?/gm, '')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/^\s*\d+\.\s+/gm, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/\|/g, ' ')
        .replace(/^\s*[-=]{3,}\s*$/gm, '')
        .replace(/\n{3,}/g, '\n\n');

    return stripHtml(markdown);
}

function stripMalformedUnicodeEscapes(input = '') {
    return String(input || '')
        .replace(/\\u(?![0-9a-fA-F]{4})/g, '')
        .replace(/\\u[0-9a-fA-F]{1,3}(?![0-9a-fA-F])/g, '')
        .replace(/\\x(?![0-9a-fA-F]{2})/g, '')
        .replace(/\\x[0-9a-fA-F](?![0-9a-fA-F])/g, '')
        .replace(/\\u\{[0-9a-fA-F]+\}(?![0-9a-fA-F])/g, '');
}

function stripUnpairedSurrogates(input = '') {
    const value = String(input || '');
    let output = '';

    for (let index = 0; index < value.length; index += 1) {
        const codeUnit = value.charCodeAt(index);

        if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
            const nextCodeUnit = value.charCodeAt(index + 1);
            if (nextCodeUnit >= 0xDC00 && nextCodeUnit <= 0xDFFF) {
                output += value[index] + value[index + 1];
                index += 1;
            }
            continue;
        }

        if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
            continue;
        }

        output += value[index];
    }

    return output;
}

function clampSpeechText(text = '', maxTextChars = 2400) {
    if (!text || text.length <= maxTextChars) {
        return text;
    }

    const truncated = text.slice(0, maxTextChars);
    const lastSentenceBoundary = Math.max(
        truncated.lastIndexOf('. '),
        truncated.lastIndexOf('! '),
        truncated.lastIndexOf('? '),
    );
    const lastWhitespace = truncated.lastIndexOf(' ');
    const safeCutoff = Math.max(lastSentenceBoundary, lastWhitespace);

    return `${(safeCutoff > 200 ? truncated.slice(0, safeCutoff) : truncated).trim()}...`;
}

function normalizeTextForSpeech(input = '', maxTextChars = 2400) {
    const sanitizedInput = stripMalformedUnicodeEscapes(stripUnpairedSurrogates(stripNullCharacters(input || '')));
    const stripped = stripMarkdownForSpeech(sanitizedInput);
    const normalized = normalizeWhitespace(stripped)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map(normalizeSpeechSentence)
        .join(' ')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

    const clamped = clampSpeechText(normalized, maxTextChars);
    if (!clamped) {
        throw createServiceError(400, 'No speakable text was provided.', 'empty_text');
    }

    return clamped;
}

module.exports = {
    clampSpeechText,
    createServiceError,
    normalizeSpeechSentence,
    normalizeTextForSpeech,
    stripMalformedUnicodeEscapes,
    stripMarkdownForSpeech,
    stripUnpairedSurrogates,
};
