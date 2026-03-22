const {
    buildProjectMemoryUpdate,
    mergeProjectMemory,
    buildProjectMemoryInstructions,
} = require('./project-memory');

describe('project-memory', () => {
    test('captures urls from tool results and artifacts', () => {
        const update = buildProjectMemoryUpdate({
            userText: 'Use this reference https://example.com/spec and make a PDF.',
            assistantText: 'Created the file and used https://example.com/spec.',
            toolEvents: [{
                toolCall: {
                    function: {
                        name: 'image-generate',
                    },
                },
                result: {
                    success: true,
                    toolId: 'image-generate',
                    data: {
                        data: [
                            { url: 'https://images.example.com/hero.png' },
                        ],
                    },
                },
                reason: 'Generate hero image',
            }],
            artifacts: [{
                id: 'artifact-1',
                filename: 'brief.html',
                format: 'html',
                downloadUrl: '/api/artifacts/artifact-1/download',
                metadata: {
                    sourcePrompt: 'Create an HTML brief from the research',
                },
            }],
        });

        expect(update.urls.map((entry) => entry.url)).toEqual(expect.arrayContaining([
            'https://example.com/spec',
            'https://images.example.com/hero.png',
        ]));
        expect(update.artifacts).toHaveLength(1);
        expect(update.tasks[0].summary).toMatch(/Created the file/i);
    });

    test('merges and deduplicates project memory for prompt instructions', () => {
        const merged = mergeProjectMemory(
            {
                urls: [{ url: 'https://example.com/spec', source: 'user', kind: 'reference' }],
                artifacts: [{ id: 'artifact-1', filename: 'brief.html', format: 'html', downloadUrl: 'https://app.example.com/api/artifacts/artifact-1/download' }],
                tasks: [{ summary: 'Researched the brief structure.', status: 'completed', toolIds: ['web-search'] }],
            },
            {
                urls: [{ url: 'https://example.com/spec', source: 'assistant', kind: 'reference' }],
                tasks: [{ summary: 'Researched the brief structure.', status: 'completed', toolIds: ['web-search'] }],
            },
        );

        expect(merged.urls).toHaveLength(1);
        expect(merged.tasks).toHaveLength(1);

        const instructions = buildProjectMemoryInstructions({
            metadata: {
                projectMemory: merged,
            },
        });

        expect(instructions).toContain('[Project working memory]');
        expect(instructions).toContain('https://example.com/spec');
        expect(instructions).toContain('brief.html');
        expect(instructions).toContain('Researched the brief structure.');
    });
});
