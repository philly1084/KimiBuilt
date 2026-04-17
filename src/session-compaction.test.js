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
});
