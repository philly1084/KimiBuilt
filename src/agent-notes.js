const fs = require('fs');
const path = require('path');
const {
    PROJECT_ROOT,
    resolvePreferredWritableFile,
} = require('./runtime-state-paths');

const REPO_AGENT_NOTES_FILE = path.join(PROJECT_ROOT, 'agent-notes.md');
const AGENT_NOTES_CHAR_LIMIT = 4000;
const DEFAULT_AGENT_NOTES_MARKDOWN = `# Carryover Notes

## Project
- Capture stable project facts, decisions, and worthwhile ideas here.

## Phil
- Capture durable preferences or collaboration notes that help future sessions work better with Phil.
`;

let cachedAgentNotes = null;

function getAgentNotesFilePath() {
    const configured = String(process.env.KIMIBUILT_AGENT_NOTES_PATH || '').trim();
    if (configured) {
        return path.resolve(PROJECT_ROOT, configured);
    }

    return resolvePreferredWritableFile(REPO_AGENT_NOTES_FILE, ['agent-notes.md']);
}

function toDisplayPath(filePath = '') {
    const relative = path.relative(PROJECT_ROOT, filePath);
    return relative && !relative.startsWith('..') ? relative.replace(/\\/g, '/') : filePath;
}

function normalizeComparablePath(filePath = '') {
    const normalized = path.resolve(String(filePath || '')).replace(/\\/g, '/');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function normalizeAgentNotesMarkdown(value = '') {
    const normalized = String(value || '').replace(/\r\n/g, '\n').trimEnd();
    return normalized ? `${normalized}\n` : '';
}

function createAgentNotesLimitError(actualLength = 0) {
    const error = new Error(`agent-notes.md cannot exceed ${AGENT_NOTES_CHAR_LIMIT} characters (received ${actualLength}).`);
    error.code = 'AGENT_NOTES_LIMIT_EXCEEDED';
    error.statusCode = 400;
    error.details = {
        actualLength,
        limit: AGENT_NOTES_CHAR_LIMIT,
    };
    return error;
}

function validateAgentNotesContent(content = '') {
    const normalized = normalizeAgentNotesMarkdown(content);
    if (normalized.length > AGENT_NOTES_CHAR_LIMIT) {
        throw createAgentNotesLimitError(normalized.length);
    }

    return normalized;
}

function readAgentNotesFile() {
    const absoluteFilePath = getAgentNotesFilePath();

    try {
        const stat = fs.statSync(absoluteFilePath);
        if (cachedAgentNotes && cachedAgentNotes.absoluteFilePath === absoluteFilePath && cachedAgentNotes.mtimeMs === stat.mtimeMs) {
            return cachedAgentNotes.data;
        }

        const content = fs.readFileSync(absoluteFilePath, 'utf8');
        const data = {
            content,
            absoluteFilePath,
            filePath: toDisplayPath(absoluteFilePath),
            updatedAt: stat.mtime.toISOString(),
            source: 'file',
        };

        cachedAgentNotes = {
            absoluteFilePath,
            mtimeMs: stat.mtimeMs,
            data,
        };

        return data;
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }

        return {
            content: DEFAULT_AGENT_NOTES_MARKDOWN,
            absoluteFilePath,
            filePath: toDisplayPath(absoluteFilePath),
            updatedAt: null,
            source: 'default',
        };
    }
}

function getEffectiveAgentNotesConfig(settings = {}) {
    const fileState = readAgentNotesFile();
    const displayName = String(settings?.displayName || 'Carryover Notes').trim() || 'Carryover Notes';
    const content = String(fileState.content || '');

    return {
        enabled: settings?.enabled !== false,
        displayName,
        content,
        defaultContent: DEFAULT_AGENT_NOTES_MARKDOWN,
        filePath: fileState.filePath,
        absoluteFilePath: fileState.absoluteFilePath,
        updatedAt: fileState.updatedAt,
        source: fileState.source,
        characterLimit: AGENT_NOTES_CHAR_LIMIT,
        characterCount: content.length,
    };
}

function isAgentNotesFilePath(filePath = '') {
    if (!filePath) {
        return false;
    }

    return normalizeComparablePath(filePath) === normalizeComparablePath(getAgentNotesFilePath());
}

function writeAgentNotesFile(content = '') {
    const absoluteFilePath = getAgentNotesFilePath();
    const normalizedContent = validateAgentNotesContent(content);

    fs.mkdirSync(path.dirname(absoluteFilePath), { recursive: true });
    fs.writeFileSync(absoluteFilePath, normalizedContent, 'utf8');
    cachedAgentNotes = null;

    return getEffectiveAgentNotesConfig();
}

function resetAgentNotesFile() {
    return writeAgentNotesFile(DEFAULT_AGENT_NOTES_MARKDOWN);
}

function buildAgentNotesInstructions(settings = {}) {
    const effective = getEffectiveAgentNotesConfig(settings);

    if (!effective.enabled) {
        return '';
    }

    const currentNotes = String(effective.content || '').trim() || '(empty)';

    return [
        '[Carryover notes memory]',
        'Treat this as durable cross-session notes for stable project facts, longer-term ideas, and collaboration details that help future sessions.',
        `The notes file lives at ${effective.filePath} and has a hard limit of ${AGENT_NOTES_CHAR_LIMIT} characters.`,
        'When the `agent-notes-write` tool is available, you may update these notes without a separate confirmation if the new information is genuinely useful to carry forward.',
        'Keep the notes compact and factual. Prefer distilled bullets over prose.',
        'Good candidates: project direction, durable constraints, recurring preferences, facts about working with Phil, and decisions likely to matter later.',
        'Do not store secrets, credentials, temporary scratch notes, verbose logs, or code dumps.',
        'Rewrite the full notes file when you update it, preserving useful existing context while removing stale noise.',
        'Current notes:',
        currentNotes,
    ].join('\n');
}

module.exports = {
    AGENT_NOTES_CHAR_LIMIT,
    DEFAULT_AGENT_NOTES_MARKDOWN,
    buildAgentNotesInstructions,
    createAgentNotesLimitError,
    getAgentNotesFilePath,
    getEffectiveAgentNotesConfig,
    isAgentNotesFilePath,
    normalizeAgentNotesMarkdown,
    resetAgentNotesFile,
    validateAgentNotesContent,
    writeAgentNotesFile,
};
