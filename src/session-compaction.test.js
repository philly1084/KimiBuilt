const {
    buildSessionCompaction,
    shouldCompactSession,
} = require('./session-compaction');

function buildTranscript(length = 12) {
    return Array.from({ length }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: index % 2 === 0
            ? `Please handle task ${index + 1} for the k3s deployment and TLS setup.`
            : `Completed step ${index + 1} for the deployment workflow and verified the latest change.`,
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString(),
    }));
}

describe('session compaction', () => {
    test('builds a durable summary at workflow completion points', () => {
        const compaction = buildSessionCompaction({
            messages: buildTranscript(12),
            workflow: {
                status: 'completed',
                lane: 'deploy',
                stage: 'verified',
            },
            projectMemory: {
                tasks: [{
                    summary: 'Waiting on DNS propagation for the production hostname.',
                    status: 'partial',
                }],
            },
        });

        expect(compaction).toEqual(expect.objectContaining({
            compactedMessageCount: 6,
            trigger: 'workflow-completed',
            updatedAt: expect.any(String),
            objectives: expect.any(Array),
            outcomes: expect.any(Array),
            openItems: expect.arrayContaining([
                'Latest partial task: Waiting on DNS propagation for the production hostname.',
            ]),
        }));
        expect(compaction.summary).toContain('Compacted through 6 transcript messages in this session.');
    });

    test('preserves the final completion report in compacted handoff context', () => {
        const messages = buildTranscript(11);
        messages.push({
            role: 'assistant',
            content: [
                'Finished the build.',
                '',
                'Changed files:',
                '- src/session-compaction.js',
                '- src/session-compaction.test.js',
                '',
                'Verified with targeted Jest tests.',
            ].join('\n'),
            timestamp: new Date(Date.UTC(2026, 0, 1, 0, 12, 0)).toISOString(),
        });

        const compaction = buildSessionCompaction({
            messages,
            workflow: {
                status: 'completed',
                lane: 'build',
                stage: 'reported',
            },
        });

        expect(compaction.completionReport).toContain('Finished the build.');
        expect(compaction.summary).toContain('Final user-visible completion report:');
        expect(compaction.summary).toContain('- src/session-compaction.js');
        expect(compaction.summary).toContain('Verified with targeted Jest tests.');
    });

    test('requires meaningful new transcript growth before another non-completion compaction', () => {
        const messages = buildTranscript(20);

        expect(shouldCompactSession({
            messages,
            existingCompaction: {
                compactedMessageCount: 12,
                summary: 'Earlier summary',
            },
            workflow: {
                status: 'active',
                lane: 'deploy',
                stage: 'apply',
            },
        })).toBe(false);
    });

    test('defers routine transcript-growth compaction while a workflow is active', () => {
        expect(shouldCompactSession({
            messages: buildTranscript(40),
            workflow: {
                status: 'active',
                lane: 'build',
                stage: 'implement',
            },
        })).toBe(false);
    });

    test('allows compaction during an active workflow when transcript growth becomes unruly', () => {
        expect(shouldCompactSession({
            messages: buildTranscript(85),
            workflow: {
                status: 'active',
                lane: 'build',
                stage: 'verify',
            },
        })).toBe(true);

        const compaction = buildSessionCompaction({
            messages: buildTranscript(85),
            workflow: {
                status: 'active',
                lane: 'build',
                stage: 'verify',
            },
        });

        expect(compaction).toEqual(expect.objectContaining({
            compactedMessageCount: 79,
            trigger: 'active-workflow-transcript-unruly',
        }));
    });
});
