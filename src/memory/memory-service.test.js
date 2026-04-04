const {
    MemoryService,
    DEFAULT_RECALL_PROFILE,
    RESEARCH_RECALL_PROFILE,
} = require('./memory-service');

describe('MemoryService recall profiles', () => {
    test('uses wider recall for normal conversations by default', () => {
        const service = new MemoryService();

        expect(service.getRecallOptions({
            profile: DEFAULT_RECALL_PROFILE,
        })).toEqual({
            topK: 12,
            scoreThreshold: 0.7,
        });
    });

    test('uses looser recall settings for research mode', () => {
        const service = new MemoryService();

        expect(service.getRecallOptions({
            profile: RESEARCH_RECALL_PROFILE,
        })).toEqual({
            topK: 16,
            scoreThreshold: 0.64,
        });
    });
});
