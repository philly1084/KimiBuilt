const {
    MemoryService,
    DEFAULT_RECALL_PROFILE,
    RESEARCH_RECALL_PROFILE,
} = require('./memory-service');
const config = require('../config');

describe('MemoryService recall profiles', () => {
    beforeEach(() => {
        config.config.runtime.judgmentV2Enabled = false;
    });

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
            sourceSurface: 'web-chat',
        });
        expect(recallSpy).toHaveBeenCalledWith('hello world', expect.objectContaining({
            sessionId: null,
            ownerId: 'phill',
            memoryScope: 'web-chat',
            profile: DEFAULT_RECALL_PROFILE,
        }));
    });

    test('process keeps recall locked to the current session when session isolation is enabled', async () => {
        const service = new MemoryService();
        const recallSpy = jest.spyOn(service, 'recall').mockResolvedValue(['ctx']);
        jest.spyOn(service, 'remember').mockResolvedValue('point-1');

        const context = await service.process('session-1', 'hello world', {
            ownerId: 'phill',
            memoryScope: 'web-chat',
            sessionIsolation: true,
            profile: DEFAULT_RECALL_PROFILE,
        });

        expect(context).toEqual(['ctx']);
        expect(recallSpy).toHaveBeenCalledWith('hello world', expect.objectContaining({
            sessionId: 'session-1',
            ownerId: null,
            memoryScope: 'web-chat',
            sessionIsolation: true,
            profile: DEFAULT_RECALL_PROFILE,
        }));
    });

    test('recall keeps keyword matches isolated to the current frontend scope', async () => {
        const service = new MemoryService();
        jest.spyOn(service.store, 'search').mockResolvedValue([]);
        jest.spyOn(service.store, 'scroll').mockResolvedValue([
            {
                id: 'artifact-web-chat',
                payload: {
                    sessionId: 'session-1',
                    ownerId: 'phill',
                    memoryScope: 'web-chat',
                    text: 'Previous HTML artifact for the chat frontend',
                    keywords: ['html', 'landing-page'],
                    memoryType: 'artifact',
                    artifactFilename: 'chat-landing.html',
                    artifactFormat: 'html',
                    timestamp: '2026-04-05T10:00:00.000Z',
                },
            },
            {
                id: 'artifact-canvas',
                payload: {
                    sessionId: 'session-2',
                    ownerId: 'phill',
                    memoryScope: 'canvas',
                    text: 'Canvas-only HTML artifact memory',
                    keywords: ['html', 'landing-page'],
                    memoryType: 'artifact',
                    artifactFilename: 'canvas-landing.html',
                    artifactFormat: 'html',
                    timestamp: '2026-04-05T10:00:00.000Z',
                },
            },
        ]);

        const recall = await service.recall('revise the html landing page', {
            ownerId: 'phill',
            memoryScope: 'web-chat',
            memoryKeywords: ['html', 'landing-page'],
            returnDetails: true,
        });

        expect(recall.contextMessages).toHaveLength(1);
        expect(recall.contextMessages[0]).toContain('chat-landing.html');
        expect(recall.contextMessages[0]).not.toContain('canvas-landing.html');
    });

    test('rememberArtifactResult stores both a summary and chunked source memories', async () => {
        const service = new MemoryService();
        const rememberSpy = jest.spyOn(service, 'remember').mockResolvedValue('point-1');

        await service.rememberArtifactResult('session-1', {
            artifact: {
                id: 'artifact-1',
                filename: 'brief.html',
                format: 'html',
            },
            summary: 'Created the HTML artifact (brief.html).',
            sourceText: '<!DOCTYPE html><html><body><section>Alpha</section></body></html>',
            metadata: {
                ownerId: 'phill',
                memoryScope: 'web-chat',
                memoryKeywords: ['html', 'brief'],
            },
        });

        expect(rememberSpy).toHaveBeenCalledWith('session-1', 'Created the HTML artifact (brief.html).', 'artifact-summary', expect.objectContaining({
            artifactId: 'artifact-1',
            artifactFilename: 'brief.html',
            artifactFormat: 'html',
        }));
        expect(rememberSpy).toHaveBeenCalledWith('session-1', expect.stringContaining('<!DOCTYPE html>'), 'artifact-source', expect.objectContaining({
            artifactId: 'artifact-1',
            artifactFilename: 'brief.html',
            artifactFormat: 'html',
            chunkIndex: 0,
        }));
    });

    test('judgment v2 returns typed recall bundles and rationale details', async () => {
        config.config.runtime.judgmentV2Enabled = true;
        const service = new MemoryService();
        jest.spyOn(service.store, 'search').mockResolvedValue([
            {
                id: 'memory-artifact-1',
                score: 0.82,
                text: 'Created pricing-report.html for the latest GPU pricing brief.',
                sessionId: 'session-1',
                timestamp: '2026-04-08T10:00:00.000Z',
                metadata: {
                    memoryType: 'artifact',
                    artifactId: 'artifact-1',
                    artifactFilename: 'pricing-report.html',
                    artifactFormat: 'html',
                    keywords: ['gpu', 'pricing', 'report'],
                },
            },
        ]);
        jest.spyOn(service.store, 'scroll').mockResolvedValue([]);

        const recall = await service.recall('revise the latest GPU pricing report', {
            sessionId: 'session-1',
            profile: RESEARCH_RECALL_PROFILE,
            returnDetails: true,
        });

        expect(recall.bundles.artifact).toHaveLength(1);
        expect(recall.trace.bundles).toEqual(expect.objectContaining({
            artifact: 1,
        }));
        expect(recall.trace.selected[0].rationale).toEqual(expect.arrayContaining([
            expect.stringContaining('keyword overlap'),
        ]));
    });

    test('judgment v2 boosts workflow-summary skills when tool family matches the new objective', async () => {
        config.config.runtime.judgmentV2Enabled = true;
        const service = new MemoryService();
        jest.spyOn(service.store, 'search').mockResolvedValue([
            {
                id: 'skill-1',
                score: 0.35,
                text: 'Reusable workflow: Repair the remote k3s rollout. Verified steps: remote-command -> k3s-deploy.',
                sessionId: 'session-1',
                timestamp: '2026-04-08T10:00:00.000Z',
                metadata: {
                    memoryType: 'skill',
                    skillKind: 'workflow-summary',
                    toolFamily: 'remote',
                    toolIds: ['remote-command', 'k3s-deploy'],
                    keywords: ['remote', 'k3s', 'rollout'],
                },
            },
        ]);
        jest.spyOn(service.store, 'scroll').mockResolvedValue([]);

        const recall = await service.recall('Continue the remote k3s rollout fix', {
            sessionId: 'session-1',
            returnDetails: true,
            preferredToolIds: ['remote-command'],
        });

        expect(recall.bundles.skill).toHaveLength(1);
        expect(recall.trace.selected[0]).toEqual(expect.objectContaining({
            typeGroup: 'skill',
            rationale: expect.arrayContaining([
                'workflow family match: remote',
                'matches preferred tools',
            ]),
        }));
    });
});
