const {
  buildScopedMemoryMetadata,
  PROJECT_SHARED_MEMORY_NAMESPACE,
  resolveProjectKey,
  SESSION_LOCAL_MEMORY_NAMESPACE,
  SURFACE_LOCAL_MEMORY_NAMESPACE,
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
});
