const DEFAULT_EXECUTION_PROFILE = 'default';
const NOTES_EXECUTION_PROFILE = 'notes';
const REMOTE_BUILD_EXECUTION_PROFILE = 'remote-build';

const PROMOTED_LOCAL_TOOL_IDS = Object.freeze([
    'security-scan',
    'architecture-design',
    'uml-generate',
    'api-design',
    'schema-generate',
    'migration-create',
]);

const BASE_SHARED_TOOL_IDS = Object.freeze([
    'web-search',
    'web-fetch',
    'web-scrape',
    'image-generate',
    'image-search-unsplash',
    'image-from-url',
    'file-read',
    'file-write',
    'file-search',
    'file-mkdir',
    'tool-doc-read',
    ...PROMOTED_LOCAL_TOOL_IDS,
]);

const PROFILE_TOOL_ALLOWLISTS = Object.freeze({
    [DEFAULT_EXECUTION_PROFILE]: Object.freeze([
        ...BASE_SHARED_TOOL_IDS,
    ]),
    [NOTES_EXECUTION_PROFILE]: Object.freeze([
        'remote-command',
        'docker-exec',
        ...BASE_SHARED_TOOL_IDS,
    ]),
    [REMOTE_BUILD_EXECUTION_PROFILE]: Object.freeze([
        'remote-command',
        'docker-exec',
        ...BASE_SHARED_TOOL_IDS,
        'code-sandbox',
    ]),
});

const HIDDEN_FRONTEND_TOOL_IDS = Object.freeze([
    'code-execute',
]);

function getAllowedToolIdsForProfile(profile = DEFAULT_EXECUTION_PROFILE) {
    return PROFILE_TOOL_ALLOWLISTS[profile] || PROFILE_TOOL_ALLOWLISTS[DEFAULT_EXECUTION_PROFILE];
}

module.exports = {
    DEFAULT_EXECUTION_PROFILE,
    NOTES_EXECUTION_PROFILE,
    REMOTE_BUILD_EXECUTION_PROFILE,
    PROMOTED_LOCAL_TOOL_IDS,
    PROFILE_TOOL_ALLOWLISTS,
    HIDDEN_FRONTEND_TOOL_IDS,
    getAllowedToolIdsForProfile,
};
