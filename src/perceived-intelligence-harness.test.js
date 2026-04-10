const {
    normalizeFixture,
    inferSurfaceFinisher,
    scorePerceivedIntelligence,
} = require('./perceived-intelligence-harness');
const {
    PROJECT_SHARED_MEMORY_NAMESPACE,
    SURFACE_LOCAL_MEMORY_NAMESPACE,
} = require('./session-scope');

describe('perceived intelligence harness', () => {
    test('normalizes fixture metadata for deterministic harness runs', () => {
        expect(normalizeFixture({
            id: 'scenario-1',
            input: 'continue',
            projectKey: 'alpha-store',
            clientSurface: 'notes',
            expected: { finishers: ['notes_page'] },
            session: { id: 'session-1' },
            toolResults: [{}],
            memoryFixtures: [{}],
        })).toEqual({
            id: 'scenario-1',
            prompt: 'continue',
            projectKey: 'alpha-store',
            surface: 'notes',
            expected: { finishers: ['notes_page'] },
            session: { id: 'session-1' },
            toolResults: [{}],
            memoryFixtures: [{}],
        });
    });

    test('infers the correct finisher for each shared surface', () => {
        expect(inferSurfaceFinisher({ clientSurface: 'notes' })).toBe('notes_page');
        expect(inferSurfaceFinisher({ clientSurface: 'canvas' })).toBe('canvas_structured');
        expect(inferSurfaceFinisher({ clientSurface: 'notation' })).toBe('notation_helper');
        expect(inferSurfaceFinisher({ clientSurface: 'web-chat' })).toBe('chat_reply');
    });

    test('flags cross-project recall as an isolation failure', () => {
        const summary = scorePerceivedIntelligence({
            projectKey: 'alpha-store',
            clientSurface: 'web-chat',
            memoryTrace: {
                selected: [
                    {
                        id: 'foreign-project-memory',
                        projectKey: 'beta-store',
                        memoryNamespace: PROJECT_SHARED_MEMORY_NAMESPACE,
                        sourceSurface: 'web-chat',
                        summary: 'Beta project artifact',
                    },
                ],
            },
        });

        expect(summary.crossScopeReuse.foreignProjectCount).toBe(1);
        expect(summary.failureTags).toContain('cross_project_recall');
        expect(summary.perceivedIntelligenceScores.isolation).toBeLessThan(0.2);
    });

    test('flags cross-surface recall only for surface-local memory', () => {
        const surfaceLocalSummary = scorePerceivedIntelligence({
            projectKey: 'alpha-store',
            clientSurface: 'web-chat',
            memoryTrace: {
                selected: [
                    {
                        id: 'surface-local-memory',
                        projectKey: 'alpha-store',
                        memoryNamespace: SURFACE_LOCAL_MEMORY_NAMESPACE,
                        sourceSurface: 'canvas',
                        summary: 'Canvas-only working memory',
                    },
                ],
            },
        });
        const sharedSummary = scorePerceivedIntelligence({
            projectKey: 'alpha-store',
            clientSurface: 'web-chat',
            memoryTrace: {
                selected: [
                    {
                        id: 'project-shared-memory',
                        projectKey: 'alpha-store',
                        memoryNamespace: PROJECT_SHARED_MEMORY_NAMESPACE,
                        sourceSurface: 'canvas',
                        summary: 'Project artifact',
                    },
                ],
            },
        });

        expect(surfaceLocalSummary.failureTags).toContain('cross_surface_recall');
        expect(surfaceLocalSummary.crossScopeReuse.foreignSurfaceCount).toBe(1);
        expect(sharedSummary.failureTags).not.toContain('cross_surface_recall');
        expect(sharedSummary.crossScopeReuse.foreignSurfaceCount).toBe(0);
    });
});
