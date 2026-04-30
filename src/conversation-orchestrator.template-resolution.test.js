jest.mock('./routes/admin/settings.controller', () => ({
    settings: {
        api: {
            baseURL: 'http://localhost:3000',
        },
    },
    getEffectiveSshConfig: jest.fn(),
    getEffectiveOpencodeConfig: jest.fn(),
    getEffectiveDeployConfig: jest.fn(),
}));

const { ConversationOrchestrator } = require('./conversation-orchestrator');

function createOrchestrator() {
    return new ConversationOrchestrator({
        llmClient: {
            complete: jest.fn(),
            createResponse: jest.fn(),
        },
        embedder: {},
        vectorStore: null,
        config: {
            enableSkills: false,
        },
    });
}

describe('ConversationOrchestrator plan template resolution', () => {
    test('resolves legacy steps[n].previewUrl placeholders before screenshot QA', async () => {
        const orchestrator = createOrchestrator();
        const toolManager = {
            executeTool: jest.fn(async (toolId, params) => ({
                success: true,
                toolId,
                data: {
                    url: params.url,
                    screenshot: { available: true },
                },
                duration: 1,
                timestamp: new Date().toISOString(),
            })),
        };
        const previousToolEvents = [{
            toolCall: {
                function: {
                    name: 'code-sandbox',
                    arguments: JSON.stringify({ mode: 'project' }),
                },
            },
            result: {
                success: true,
                toolId: 'code-sandbox',
                data: {
                    previewUrl: '/api/sandbox-workspaces/demo/sandbox',
                },
            },
            reason: 'Build a previewable sandbox.',
        }];

        const result = await orchestrator.executePlan({
            plan: [{
                tool: 'web-scrape',
                reason: 'Capture a screenshot of the generated preview.',
                params: {
                    url: '{{steps[1].previewUrl}}',
                    browser: true,
                    captureScreenshot: true,
                },
            }],
            toolManager,
            sessionId: 'session-1',
            previousToolEvents,
            executionTrace: [],
        });

        expect(result.toolEvents).toHaveLength(1);
        expect(toolManager.executeTool).toHaveBeenCalledWith(
            'web-scrape',
            expect.objectContaining({
                url: 'http://localhost:3000/api/sandbox-workspaces/demo/sandbox',
                browser: true,
                captureScreenshot: true,
            }),
            expect.any(Object),
        );
        expect(result.toolEvents[0].toolCall.function.arguments).toContain(
            'http://localhost:3000/api/sandbox-workspaces/demo/sandbox',
        );
    });

    test('resolves lastPreviewUrl from an earlier step in the same execution plan', async () => {
        const orchestrator = createOrchestrator();
        const toolManager = {
            executeTool: jest.fn(async (toolId, params) => {
                if (toolId === 'code-sandbox') {
                    return {
                        success: true,
                        toolId,
                        data: {
                            previewUrl: '/api/artifacts/artifact-site-1/sandbox',
                        },
                        duration: 1,
                        timestamp: new Date().toISOString(),
                    };
                }

                return {
                    success: true,
                    toolId,
                    data: {
                        url: params.url,
                        screenshot: { available: true },
                    },
                    duration: 1,
                    timestamp: new Date().toISOString(),
                };
            }),
        };

        const result = await orchestrator.executePlan({
            plan: [
                {
                    tool: 'code-sandbox',
                    reason: 'Build a previewable sandbox.',
                    params: {
                        mode: 'project',
                        language: 'html',
                        files: [{ path: 'index.html', content: '<main>Preview</main>' }],
                    },
                },
                {
                    tool: 'web-scrape',
                    reason: 'Capture a screenshot of the generated preview.',
                    params: {
                        url: '{{lastPreviewUrl}}',
                        browser: true,
                        captureScreenshot: true,
                    },
                },
            ],
            toolManager,
            sessionId: 'session-1',
            executionTrace: [],
        });

        expect(result.toolEvents).toHaveLength(2);
        expect(toolManager.executeTool).toHaveBeenLastCalledWith(
            'web-scrape',
            expect.objectContaining({
                url: 'http://localhost:3000/api/artifacts/artifact-site-1/sandbox',
            }),
            expect.any(Object),
        );
    });
});
