jest.mock('../middleware/validate', () => ({
    validate: () => (_req, _res, next) => next(),
}));

jest.mock('../session-store', () => ({
    sessionStore: {},
}));

jest.mock('../memory/memory-service', () => ({
    memoryService: {},
}));

jest.mock('../runtime-execution', () => ({
    executeConversationRuntime: jest.fn(),
    resolveConversationExecutorFlag: jest.fn(() => false),
}));

jest.mock('../ai-route-utils', () => ({
    buildInstructionsWithArtifacts: jest.fn(),
    maybeGenerateOutputArtifact: jest.fn(),
    resolveReasoningEffort: jest.fn(() => null),
}));

jest.mock('../admin/runtime-monitor', () => ({
    startRuntimeTask: jest.fn(() => ({ id: 'task-1' })),
    completeRuntimeTask: jest.fn(),
    failRuntimeTask: jest.fn(),
}));

const canvasRouter = require('./canvas');

const {
    buildCanvasInstructions,
    parseCanvasResponse,
    buildFrontendFallbackMetadata,
} = canvasRouter._private;

describe('/api/canvas helpers', () => {
    test('buildCanvasInstructions includes frontend bundle and handoff requirements', () => {
        const instructions = buildCanvasInstructions('frontend', '<section>Existing demo</section>');

        expect(instructions).toContain('DEMO WEBSITE FRONTEND');
        expect(instructions).toContain('metadata.bundle');
        expect(instructions).toContain('metadata.handoff');
        expect(instructions).toContain('Existing demo');
    });

    test('parseCanvasResponse normalizes frontend metadata from structured JSON', () => {
        const parsed = parseCanvasResponse(JSON.stringify({
            content: '<!DOCTYPE html><html><head><title>Nova Demo</title></head><body><section id="hero"></section></body></html>',
            metadata: {
                frameworkTarget: 'react',
                bundle: {
                    files: [
                        {
                            path: 'styles.css',
                            language: 'css',
                            purpose: 'Shared styles',
                            content: 'body { color: black; }',
                        },
                    ],
                },
                handoff: {
                    summary: 'Split hero and CTA into React components.',
                    componentMap: [
                        { name: 'Hero', purpose: 'Top-level value proposition' },
                    ],
                },
            },
            suggestions: ['Add a pricing section'],
        }), 'frontend');

        expect(parsed.content).toContain('<!DOCTYPE html>');
        expect(parsed.metadata).toMatchObject({
            type: 'frontend',
            title: 'Nova Demo',
            frameworkTarget: 'react',
            previewMode: 'iframe',
        });
        expect(parsed.metadata.bundle.files).toEqual(expect.arrayContaining([
            expect.objectContaining({ path: 'index.html', language: 'html' }),
            expect.objectContaining({ path: 'styles.css', language: 'css' }),
        ]));
        expect(parsed.metadata.handoff.componentMap).toEqual([
            expect.objectContaining({ name: 'Hero' }),
        ]);
        expect(parsed.suggestions).toEqual(['Add a pricing section']);
    });

    test('buildFrontendFallbackMetadata creates a repo-handoff shell for raw html', () => {
        const metadata = buildFrontendFallbackMetadata('<!DOCTYPE html><html><body><h1>Orbit Launch</h1></body></html>');

        expect(metadata).toMatchObject({
            type: 'frontend',
            title: 'Orbit Launch',
            language: 'html',
            previewMode: 'iframe',
        });
        expect(metadata.bundle.files).toEqual([
            expect.objectContaining({
                path: 'index.html',
                language: 'html',
            }),
        ]);
        expect(metadata.handoff.integrationSteps.length).toBeGreaterThan(0);
    });
});
