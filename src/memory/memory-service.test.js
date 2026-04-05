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

    test('process forwards memory scope to persistence and recall', async () => {
        const service = new MemoryService();
        const rememberSpy = jest.spyOn(service, 'remember').mockResolvedValue('point-1');
        const recallSpy = jest.spyOn(service, 'recall').mockResolvedValue(['ctx']);

        const context = await service.process('session-1', 'hello world', {
            ownerId: 'phill',
            memoryScope: 'web-chat',
            profile: DEFAULT_RECALL_PROFILE,
        });

        expect(context).toEqual(['ctx']);
        expect(rememberSpy).toHaveBeenCalledWith('session-1', 'hello world', 'user', {
            ownerId: 'phill',
            memoryScope: 'web-chat',
        });
        expect(recallSpy).toHaveBeenCalledWith('hello world', expect.objectContaining({
            sessionId: null,
            ownerId: 'phill',
            memoryScope: 'web-chat',
            profile: DEFAULT_RECALL_PROFILE,
        }));
    });
});
