const {
  buildScopedMemoryMetadata,
  PROJECT_SHARED_MEMORY_NAMESPACE,
  resolveProjectKey,
  SESSION_LOCAL_MEMORY_NAMESPACE,
  SURFACE_LOCAL_MEMORY_NAMESPACE,
  sessionMatchesScope,
  USER_GLOBAL_MEMORY_NAMESPACE,
} = require('./session-scope');

describe('session scope memory routing', () => {
  test('derives a canonical project key from explicit project metadata', () => {
    expect(resolveProjectKey({
      projectKey: 'Acme Platform',
      clientSurface: 'web-chat',
    })).toBe('acme-platform');
  });

  test('does not treat frontend-only scope labels as project keys', () => {
    expect(resolveProjectKey({
      memoryScope: 'web-chat',
      clientSurface: 'web-chat',
    })).toBe('');
  });

  test('routes artifact memory into project-shared namespace when a project key exists', () => {
    expect(buildScopedMemoryMetadata({
      ownerId: 'phill',
      memoryScope: 'acme-platform',
      sourceSurface: 'web-chat',
      memoryClass: 'artifact',
    })).toEqual(expect.objectContaining({
      projectKey: 'acme-platform',
      memoryNamespace: PROJECT_SHARED_MEMORY_NAMESPACE,
      shareAcrossSurfaces: true,
    }));
  });

  test('routes conversational memory into surface-local namespace inside a project', () => {
    expect(buildScopedMemoryMetadata({
      ownerId: 'phill',
      memoryScope: 'acme-platform',
      sourceSurface: 'canvas',
      memoryClass: 'conversation',
    })).toEqual(expect.objectContaining({
      projectKey: 'acme-platform',
      memoryNamespace: SURFACE_LOCAL_MEMORY_NAMESPACE,
      shareAcrossSurfaces: false,
    }));
  });

  test('routes parallel web-chat workspaces as durable project-scoped memory', () => {
    expect(buildScopedMemoryMetadata({
      ownerId: 'phill',
      memoryScope: 'web-chat-workspace-3',
      sourceSurface: 'web-chat',
      memoryClass: 'conversation',
      sessionIsolation: false,
    })).toEqual(expect.objectContaining({
      memoryScope: 'web-chat-workspace-3',
      projectKey: 'web-chat-workspace-3',
      memoryNamespace: SURFACE_LOCAL_MEMORY_NAMESPACE,
      shareAcrossSurfaces: false,
      sessionIsolation: false,
    }));
  });

  test('routes memory into session-local namespace when no project key exists', () => {
    expect(buildScopedMemoryMetadata({
      ownerId: 'phill',
      memoryScope: 'web-chat',
      sourceSurface: 'web-chat',
      memoryClass: 'artifact',
    })).toEqual(expect.objectContaining({
      memoryNamespace: SESSION_LOCAL_MEMORY_NAMESPACE,
    }));
  });

  test('routes reusable skills into user-global namespace', () => {
    expect(buildScopedMemoryMetadata({
      ownerId: 'phill',
      memoryScope: 'acme-platform',
      sourceSurface: 'web-chat',
      memoryClass: 'reusable_skill',
    })).toEqual(expect.objectContaining({
      projectKey: 'acme-platform',
      memoryNamespace: USER_GLOBAL_MEMORY_NAMESPACE,
      shareAcrossSurfaces: true,
    }));
  });

  test('keeps legacy parallel web-chat workspace sessions out of workspace one', () => {
    const workspaceTwoSession = {
      id: 'workspace-2-session',
      metadata: {
        clientSurface: 'web-chat',
        memoryScope: 'web-chat-workspace-2',
      },
    };

    expect(sessionMatchesScope(workspaceTwoSession, 'web-chat')).toBe(false);
    expect(sessionMatchesScope(workspaceTwoSession, 'web-chat-workspace-2')).toBe(true);
  });

  test('maps raw legacy workspace keys to durable web-chat workspace scopes', () => {
    const rawWorkspaceTwoSession = {
      id: 'raw-workspace-2-session',
      metadata: {
        clientSurface: 'web-chat',
        workspaceKey: 'workspace-2',
      },
    };

    expect(sessionMatchesScope(rawWorkspaceTwoSession, 'web-chat')).toBe(false);
    expect(sessionMatchesScope(rawWorkspaceTwoSession, 'web-chat-workspace-2')).toBe(true);
    expect(sessionMatchesScope(rawWorkspaceTwoSession, 'workspace-2')).toBe(true);
  });

  test('canonicalizes raw workspace memory metadata before routing', () => {
    expect(buildScopedMemoryMetadata({
      ownerId: 'phill',
      memoryScope: 'workspace-2',
      sourceSurface: 'web-chat',
      memoryClass: 'conversation',
      sessionIsolation: false,
    })).toEqual(expect.objectContaining({
      memoryScope: 'web-chat-workspace-2',
      projectKey: 'web-chat-workspace-2',
      memoryNamespace: SURFACE_LOCAL_MEMORY_NAMESPACE,
    }));
  });

  test('keeps project-scoped sessions visible inside their explicit workspace', () => {
    const projectWorkspaceSession = {
      id: 'project-session',
      metadata: {
        clientSurface: 'web-chat',
        workspaceKey: 'web-chat-workspace-2',
        memoryScope: 'project-alpha',
        projectKey: 'project-alpha',
      },
    };

    expect(sessionMatchesScope(projectWorkspaceSession, 'web-chat')).toBe(false);
    expect(sessionMatchesScope(projectWorkspaceSession, 'web-chat-workspace-2')).toBe(true);
    expect(sessionMatchesScope(projectWorkspaceSession, 'project-alpha')).toBe(true);
  });
});
