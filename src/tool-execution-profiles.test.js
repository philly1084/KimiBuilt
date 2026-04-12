const {
    DEFAULT_EXECUTION_PROFILE,
    NOTES_EXECUTION_PROFILE,
    NOTES_ALLOWED_TOOL_IDS,
    REMOTE_BUILD_EXECUTION_PROFILE,
    HIDDEN_FRONTEND_TOOL_IDS,
    getAllowedToolIdsForProfile,
} = require('./tool-execution-profiles');

describe('tool execution profiles', () => {
    test('promoted local tools are available in the default profile', () => {
        const toolIds = getAllowedToolIdsForProfile(DEFAULT_EXECUTION_PROFILE);

        expect(toolIds).toEqual(expect.arrayContaining([
            'git-safe',
            'agent-workload',
            'asset-search',
            'speech-generate',
            'podcast',
            'deep-research-presentation',
            'security-scan',
            'architecture-design',
            'uml-generate',
            'api-design',
            'schema-generate',
            'migration-create',
        ]));
    });

    test('notes profile is restricted to web research tools only', () => {
        const toolIds = getAllowedToolIdsForProfile(NOTES_EXECUTION_PROFILE);

        expect(toolIds).toEqual([...NOTES_ALLOWED_TOOL_IDS]);
        expect(toolIds).not.toContain('remote-command');
        expect(toolIds).not.toContain('document-workflow');
        expect(toolIds).not.toContain('file-write');
        expect(toolIds).not.toContain('ssh-execute');
    });

    test('remote-build profile adds code-sandbox without exposing code-execute', () => {
        const toolIds = getAllowedToolIdsForProfile(REMOTE_BUILD_EXECUTION_PROFILE);

        expect(toolIds).toContain('k3s-deploy');
        expect(toolIds).toContain('opencode-run');
        expect(toolIds).toContain('code-sandbox');
        expect(toolIds).toContain('podcast');
        expect(toolIds).not.toContain('code-execute');
        expect(HIDDEN_FRONTEND_TOOL_IDS).toContain('code-execute');
    });
});
