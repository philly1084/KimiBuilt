const {
    buildArtifactSummary,
    buildFrontendAssistantMetadata,
    buildWebChatSessionMessages,
} = require('./web-chat-message-state');

describe('buildWebChatSessionMessages', () => {
    test('treats Mermaid artifacts as previewable files in the assistant summary', () => {
        expect(buildArtifactSummary([{
            id: 'artifact-mermaid-1',
            filename: 'system-flow.mmd',
            format: 'mermaid',
            downloadUrl: '/api/artifacts/artifact-mermaid-1/download',
        }])).toBe('Created system-flow.mmd. Preview and Download below.');
    });

    test('stores artifacts inline on the assistant message without a separate gallery message', () => {
        const messages = buildWebChatSessionMessages({
            userText: 'Question first',
            assistantText: 'Answer second',
            artifacts: [{
                id: 'artifact-1',
                filename: 'report.pdf',
                format: 'pdf',
                downloadUrl: '/api/artifacts/artifact-1/download',
            }],
            timestamp: '2026-04-04T15:00:00.000Z',
        });

        expect(messages).toHaveLength(2);
        expect(messages.map((message) => message.role)).toEqual([
            'user',
            'assistant',
        ]);

        const timestamps = messages.map((message) => new Date(message.timestamp).getTime());
        expect(timestamps[0]).toBeLessThan(timestamps[1]);
        expect(messages[1].metadata.artifacts).toEqual([
            expect.objectContaining({
                id: 'artifact-1',
                filename: 'report.pdf',
                downloadUrl: '/api/artifacts/artifact-1/download',
            }),
        ]);
    });

    test('stores checkpoint fallback display content as a bare survey fence without duplicated prose', () => {
        const messages = buildWebChatSessionMessages({
            userText: 'Please redesign the page.',
            assistantText: 'I need one decision before I continue.',
            toolEvents: [{
                toolCall: {
                    function: {
                        name: 'user-checkpoint',
                        arguments: JSON.stringify({
                            title: 'Choose a direction',
                            question: 'What visual and functional style should the new HTML follow?',
                        }),
                    },
                },
                result: {
                    success: true,
                    toolId: 'user-checkpoint',
                    data: {
                        checkpoint: {
                            id: 'checkpoint-redesign-style',
                            title: 'Choose a direction',
                            question: 'What visual and functional style should the new HTML follow?',
                            preamble: 'I need one decision before I continue with the main work.',
                            options: [
                                { id: 'minimal-modern', label: 'Minimal Modern' },
                                { id: 'bold-tech', label: 'Bold Tech' },
                            ],
                        },
                    },
                },
            }],
            timestamp: '2026-04-05T12:00:00.000Z',
        });

        expect(messages[1].metadata.displayContent.trim().startsWith('```survey')).toBe(true);
        expect(messages[1].metadata.displayContent).toContain('"question": "What visual and functional style should the new HTML follow?"');
        expect(messages[1].metadata.displayContent).not.toContain('Choose an option below and I will continue from there.');
    });

    test('preserves frontend-safe assistant metadata for agent replies', () => {
        const messages = buildWebChatSessionMessages({
            userText: 'Sketch the system layout.',
            assistantText: '### Architecture\n\n- Gateway\n- Services',
            assistantMetadata: {
                agentExecutor: true,
                taskType: 'chat',
                displayContent: '```survey\n{"id":"checkpoint-1","question":"Pick one.","options":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}\n```',
                trace: { steps: 4 },
            },
            timestamp: '2026-04-05T12:30:00.000Z',
        });

        expect(messages[1].metadata).toEqual(expect.objectContaining({
            agentExecutor: true,
            taskType: 'chat',
            displayContent: expect.stringContaining('```survey'),
        }));
        expect(messages[1].metadata.trace).toBeUndefined();
    });

    test('derives survey display content from tool events when explicit display content is absent', () => {
        const metadata = buildFrontendAssistantMetadata({
            taskType: 'chat',
            toolEvents: [{
                toolCall: {
                    function: {
                        name: 'user-checkpoint',
                    },
                },
                result: {
                    success: true,
                    toolId: 'user-checkpoint',
                    data: {
                        checkpoint: {
                            id: 'checkpoint-derive',
                            title: 'Quick test',
                            question: 'Which direction should we take?',
                            options: [
                                { id: 'a', label: 'A' },
                                { id: 'b', label: 'B' },
                            ],
                        },
                    },
                },
            }],
        });

        expect(metadata).toEqual(expect.objectContaining({
            taskType: 'chat',
            displayContent: expect.stringContaining('```survey'),
        }));
        expect(metadata.displayContent).toContain('"id": "checkpoint-derive"');
    });

    test('normalizes raw checkpoint JSON display content into a survey fence', () => {
        const metadata = buildFrontendAssistantMetadata({
            displayContent: JSON.stringify({
                id: 'checkpoint-mnnicelx',
                title: 'Choose a direction',
                question: 'Which branch should we continue from?',
                options: [
                    { id: 'dashboard-ui', label: 'Dashboard UI' },
                    { id: 'cluster-deployment', label: 'Cluster deployment' },
                ],
                steps: [
                    {
                        id: 'step-1',
                        question: 'Which branch should we continue from?',
                        inputType: 'choice',
                        options: '[truncated]',
                    },
                ],
            }),
        });

        expect(metadata.displayContent).toContain('```survey');
        expect(metadata.displayContent).toContain('"checkpoint-mnnicelx"');
    });

    test('keeps assistant artifact metadata when HTML output is created', () => {
        const metadata = buildFrontendAssistantMetadata({
            taskType: 'chat',
            artifacts: [{
                id: 'artifact-html-1',
                filename: 'dashboard.html',
                format: 'html',
                downloadUrl: '/api/artifacts/artifact-html-1/download',
                previewUrl: '/api/artifacts/artifact-html-1/preview',
                bundleDownloadUrl: '/api/artifacts/artifact-html-1/bundle',
            }],
        });

        expect(metadata).toEqual(expect.objectContaining({
            taskType: 'chat',
            artifacts: [
                expect.objectContaining({
                    id: 'artifact-html-1',
                    filename: 'dashboard.html',
                    downloadUrl: '/api/artifacts/artifact-html-1/download',
                    previewUrl: '/api/artifacts/artifact-html-1/preview',
                    bundleDownloadUrl: '/api/artifacts/artifact-html-1/bundle',
                }),
            ],
        }));
    });

    test('preserves Mermaid preview payloads for frontend rendering', () => {
        const metadata = buildFrontendAssistantMetadata({
            taskType: 'chat',
            artifacts: [{
                id: 'artifact-mermaid-2',
                filename: 'auth-flow.mmd',
                format: 'mermaid',
                downloadUrl: '/api/artifacts/artifact-mermaid-2/download',
                preview: {
                    type: 'text',
                    content: 'flowchart TD\nA[User] --> B[Login]',
                },
            }],
        });

        expect(metadata).toEqual(expect.objectContaining({
            taskType: 'chat',
            artifacts: [
                expect.objectContaining({
                    id: 'artifact-mermaid-2',
                    filename: 'auth-flow.mmd',
                    format: 'mermaid',
                    downloadUrl: '/api/artifacts/artifact-mermaid-2/download',
                    preview: expect.objectContaining({
                        type: 'text',
                        content: expect.stringContaining('flowchart TD'),
                    }),
                }),
            ],
        }));
    });

    test('preserves reasoning metadata for frontend rendering', () => {
        const metadata = buildFrontendAssistantMetadata({
            taskType: 'chat',
            reasoningSummary: 'Checked the request and chose the direct path.',
            reasoningAvailable: true,
        });

        expect(metadata).toEqual(expect.objectContaining({
            taskType: 'chat',
            reasoningSummary: 'Checked the request and chose the direct path.',
            reasoningAvailable: true,
        }));
    });
});
