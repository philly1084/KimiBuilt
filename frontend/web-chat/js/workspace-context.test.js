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

    test('keeps every workspace key on the single web-chat scope', () => {
        expect(resolveWorkspaceScopeKey('workspace-3')).toBe('web-chat');
        expect(buildWorkspaceScopeMetadata(
            { clientSurface: 'web-chat', taskType: 'chat' },
            createWorkspaceContext({ key: 'workspace-3' }),
        )).toEqual(expect.objectContaining({
            workspaceKey: 'web-chat',
            workspaceId: 'web-chat',
            projectScope: 'web-chat',
            memoryScope: 'web-chat',
            sessionIsolation: false,
        }));
    });

    test('keeps durable memory enabled for all workspace metadata', () => {
        expect(buildWorkspaceScopeMetadata(
            { clientSurface: 'web-chat', taskType: 'chat' },
            createWorkspaceContext({ key: 'workspace-1' }),
        )).toEqual(expect.objectContaining({
            memoryScope: 'web-chat',
            sessionIsolation: false,
        }));
        expect(createWorkspaceContext({ key: 'workspace-4' })).toEqual(expect.objectContaining({
            scopeKey: 'web-chat',
            longTermMemoryEnabled: true,
            persistentMemoryEnabled: true,
        }));
    });

    test('keeps session cache storage shared for the single workspace', () => {
        expect(resolveWorkspaceScopedStorageKey('kimibuilt_web_chat_sessions_v4', 'workspace-1'))
            .toBe('kimibuilt_web_chat_sessions_v4');
        expect(resolveWorkspaceScopedStorageKey('kimibuilt_web_chat_sessions_v4', 'workspace-4'))
            .toBe('kimibuilt_web_chat_sessions_v4');
        expect(resolveWorkspaceScopedStorageKey('kimibuilt_web_chat_deleted_sessions_v1', 'workspace-4'))
            .toBe('kimibuilt_web_chat_deleted_sessions_v1');
        expect(resolveWorkspaceScopedStorageKey('kimibuilt_theme', 'workspace-4'))
            .toBe('kimibuilt_theme');
    });

    test('parses workspace context from a query string', () => {
        expect(getWorkspaceContext('?workspace=workspace-2&workspaceLabel=Ops&embedded=1'))
            .toEqual(expect.objectContaining({
                key: 'workspace-2',
                label: 'Ops',
                scopeKey: 'web-chat',
                embedded: true,
            }));
    });
});
