const {
    DEFAULT_EXECUTION_PROFILE,
    NOTES_EXECUTION_PROFILE,
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
            'security-scan',
            'architecture-design',
            'uml-generate',
            'api-design',
            'schema-generate',
            'migration-create',
        ]));
    });

    test('notes profile keeps remote-command and promoted local tools', () => {
        const toolIds = getAllowedToolIdsForProfile(NOTES_EXECUTION_PROFILE);

        expect(toolIds).toEqual(expect.arrayContaining([
            'remote-command',
            'k3s-deploy',
            'architecture-design',
            'schema-generate',
        ]));
        expect(toolIds).not.toContain('file-write');
        expect(toolIds).not.toContain('file-mkdir');
        expect(toolIds).not.toContain('ssh-execute');
    });

    test('remote-build profile adds code-sandbox without exposing code-execute', () => {
        const toolIds = getAllowedToolIdsForProfile(REMOTE_BUILD_EXECUTION_PROFILE);

        expect(toolIds).toContain('k3s-deploy');
        expect(toolIds).toContain('code-sandbox');
        expect(toolIds).not.toContain('code-execute');
        expect(HIDDEN_FRONTEND_TOOL_IDS).toContain('code-execute');
    });
});
