const {
    DEFAULT_WORKSPACE_KEY,
    buildWorkspaceScopeMetadata,
    createWorkspaceContext,
    getWorkspaceContext,
    resolveWorkspaceScopeKey,
    resolveWorkspaceScopedStorageKey,
} = require('./workspace-context');

describe('workspace-context', () => {
    test('keeps workspace-1 on the legacy web-chat scope', () => {
        expect(resolveWorkspaceScopeKey(DEFAULT_WORKSPACE_KEY)).toBe('web-chat');
        expect(createWorkspaceContext({ key: DEFAULT_WORKSPACE_KEY })).toEqual(expect.objectContaining({
            key: 'workspace-1',
            label: 'Workspace 1',
            scopeKey: 'web-chat',
            longTermMemoryEnabled: true,
        }));
    });

    test('creates isolated scope keys and session-local memory for secondary workspaces', () => {
        expect(resolveWorkspaceScopeKey('workspace-3')).toBe('web-chat-workspace-3');
        expect(buildWorkspaceScopeMetadata(
            { clientSurface: 'web-chat', taskType: 'chat' },
            createWorkspaceContext({ key: 'workspace-3' }),
        )).toEqual(expect.objectContaining({
            workspaceKey: 'web-chat-workspace-3',
            workspaceId: 'web-chat-workspace-3',
            projectScope: 'web-chat-workspace-3',
            memoryScope: 'web-chat-workspace-3',
            sessionIsolation: true,
        }));
    });

    test('keeps long-term memory enabled only for workspace-1 metadata', () => {
        expect(buildWorkspaceScopeMetadata(
            { clientSurface: 'web-chat', taskType: 'chat' },
            createWorkspaceContext({ key: 'workspace-1' }),
        )).toEqual(expect.objectContaining({
            memoryScope: 'web-chat',
            sessionIsolation: false,
        }));
    });

    test('scopes session cache storage only for non-default workspaces', () => {
        expect(resolveWorkspaceScopedStorageKey('kimibuilt_web_chat_sessions_v4', 'workspace-1'))
            .toBe('kimibuilt_web_chat_sessions_v4');
        expect(resolveWorkspaceScopedStorageKey('kimibuilt_web_chat_sessions_v4', 'workspace-4'))
            .toBe('kimibuilt_web_chat_sessions_v4::workspace-4');
        expect(resolveWorkspaceScopedStorageKey('kimibuilt_theme', 'workspace-4'))
            .toBe('kimibuilt_theme');
    });

    test('parses workspace context from a query string', () => {
        expect(getWorkspaceContext('?workspace=workspace-2&workspaceLabel=Ops&embedded=1'))
            .toEqual(expect.objectContaining({
                key: 'workspace-2',
                label: 'Ops',
                scopeKey: 'web-chat-workspace-2',
                embedded: true,
            }));
    });
});
