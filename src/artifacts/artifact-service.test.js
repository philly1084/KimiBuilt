jest.mock('./artifact-store', () => ({
    artifactStore: {
        create: jest.fn(),
        updateProcessing: jest.fn(),
        listBySession: jest.fn(),
        get: jest.fn(),
        delete: jest.fn(),
        deleteBySession: jest.fn(),
    },
}));

jest.mock('./artifact-renderer', () => ({
    renderArtifact: jest.fn(),
}));

jest.mock('../openai-client', () => ({
    createResponse: jest.fn(),
}));

jest.mock('../unsplash-client', () => ({
    searchImages: jest.fn(),
    isConfigured: jest.fn(() => false),
}));

jest.mock('../memory/vector-store', () => ({
    vectorStore: {
        store: jest.fn(),
        deleteArtifact: jest.fn(),
    },
}));

jest.mock('../postgres', () => ({
    postgres: {
        enabled: true,
        initialize: jest.fn().mockResolvedValue(true),
        query: jest.fn().mockResolvedValue({ rows: [] }),
    },
}));

const { artifactService, extractResponseText, resolveCompletedResponseText } = require('./artifact-service');
const { artifactStore } = require('./artifact-store');
const { postgres } = require('../postgres');
const { renderArtifact } = require('./artifact-renderer');
const { createResponse } = require('../openai-client');
const { searchImages, isConfigured } = require('../unsplash-client');

describe('ArtifactService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        isConfigured.mockReturnValue(false);
        artifactStore.create.mockResolvedValue({
            id: 'artifact-1',
            sessionId: 'session-1',
            filename: 'test.txt',
            extension: 'txt',
            mimeType: 'text/plain',
            sizeBytes: 4,
            extractedText: 'test',
            previewHtml: '',
            metadata: {},
            vectorizedAt: null,
        });
        artifactStore.updateProcessing.mockResolvedValue({
            id: 'artifact-1',
            sessionId: 'session-1',
            filename: 'test.txt',
            extension: 'txt',
            mimeType: 'text/plain',
            sizeBytes: 4,
            extractedText: 'test',
            previewHtml: '',
            metadata: {},
            vectorizedAt: null,
        });
        artifactStore.listBySession.mockResolvedValue([]);
        artifactStore.get.mockResolvedValue(null);
        renderArtifact.mockResolvedValue({
            filename: 'out.html',
            format: 'html',
            mimeType: 'text/html',
            buffer: Buffer.from('<!DOCTYPE html><html><body>ok</body></html>'),
            extractedText: 'ok',
            previewHtml: '<!DOCTYPE html><html><body>ok</body></html>',
            metadata: { title: 'Test' },
        });
    });

    test('ensures a backing session row exists before storing an artifact', async () => {
        await artifactService.createStoredArtifact({
            sessionId: 'session-1',
            direction: 'generated',
            sourceMode: 'chat',
            filename: 'test.txt',
            extension: 'txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('test'),
            extractedText: 'test',
            previewHtml: '',
            metadata: {},
            vectorize: false,
        });

        expect(postgres.initialize).toHaveBeenCalled();
        expect(postgres.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO sessions'),
            ['session-1', null, '{}'],
        );
        expect(artifactStore.create).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session-1',
        }));
    });

    test('extractResponseText handles direct output_text and mixed content item types', () => {
        expect(extractResponseText({
            output_text: 'Top-level answer',
        })).toBe('Top-level answer');

        expect(extractResponseText({
            output: [
                {
                    type: 'message',
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'First part. ' },
                        { type: 'output_text', text: 'Second part.' },
                    ],
                },
            ],
        })).toBe('First part. Second part.');

        expect(extractResponseText({
            choices: [{
                message: {
                    parts: [{ text: 'Gemini parts answer' }],
                },
            }],
        })).toBe('Gemini parts answer');

        expect(extractResponseText({
            candidates: [{
                content: {
                    parts: [{ text: 'Gemini candidate answer' }],
                },
            }],
        })).toBe('Gemini candidate answer');
    });

    test('extractResponseText strips null bytes from wrapped model outputs', () => {
        expect(extractResponseText({
            choices: [{
                message: {
                    content: [
                        { type: 'think', think: 'hidden', encrypted: null },
                        { type: 'text', text: '{"output_text":"Hello\\u0000 world","finish_reason":"stop"}' },
                    ],
                },
            }],
        })).toBe('Hello world');
    });

    test('extractResponseText recovers provider text from reasoning-style fields', () => {
        expect(extractResponseText({
            choices: [{
                message: {
                    reasoning_content: 'Reasoning surfaced as final text',
                },
            }],
        })).toBe('Reasoning surfaced as final text');
    });

    test('resolveCompletedResponseText recovers the final answer when streaming deltas were missing', () => {
        const response = {
            output: [
                {
                    type: 'message',
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'Recovered final answer' },
                    ],
                },
            ],
        };

        expect(resolveCompletedResponseText('', response)).toBe('Recovered final answer');
        expect(resolveCompletedResponseText('Recovered', response)).toBe('Recovered final answer');
    });

    test('uses multi-pass generation for html-family artifacts', async () => {
        createResponse
            .mockResolvedValueOnce({
                id: 'resp-plan',
                output: [{
                    type: 'message',
                    content: [{ text: JSON.stringify({
                        title: 'Operations Runbook',
                        sections: [
                            { heading: 'Overview', purpose: 'Summarize the objective', keyPoints: ['Scope'], targetLength: 'short' },
                            { heading: 'Implementation', purpose: 'Explain the work', keyPoints: ['Steps'], targetLength: 'medium' },
                        ],
                    }) }],
                }],
            })
            .mockResolvedValueOnce({
                id: 'resp-expand',
                output: [{
                    type: 'message',
                    content: [{ text: JSON.stringify({
                        title: 'Operations Runbook',
                        sections: [
                            { heading: 'Overview', content: 'Overview content', level: 1 },
                            { heading: 'Implementation', content: 'Implementation content', level: 1 },
                        ],
                    }) }],
                }],
            })
            .mockResolvedValueOnce({
                id: 'resp-compose',
                output: [{
                    type: 'message',
                    content: [{ text: '<!DOCTYPE html><html><body><h1>Operations Runbook</h1></body></html>' }],
                }],
            });

        const result = await artifactService.generateArtifact({
            session: { previousResponseId: 'prev-1', metadata: {} },
            sessionId: 'session-1',
            mode: 'chat',
            prompt: 'Create a polished operations runbook for cluster setup.',
            format: 'pdf',
            artifactIds: [],
            existingContent: '',
            model: 'gpt-5.3',
        });

        expect(createResponse).toHaveBeenCalledTimes(3);
        expect(renderArtifact).toHaveBeenCalledWith(expect.objectContaining({
            format: 'pdf',
            title: 'Operations Runbook',
            content: expect.stringContaining('<html'),
        }));
        expect(artifactStore.create).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({
                generationStrategy: 'multi-pass',
                generationPasses: ['plan', 'expand', 'compose'],
                sectionCount: 2,
            }),
        }));
        expect(result.responseId).toBe('resp-compose');
    });

    test('threads recalled context, recent transcript, and response chaining through multi-pass artifact generation', async () => {
        createResponse
            .mockResolvedValueOnce({
                id: 'resp-plan',
                output: [{
                    type: 'message',
                    content: [{ text: JSON.stringify({
                        title: 'Continuity Report',
                        sections: [
                            { heading: 'Overview', purpose: 'Summarize the request', keyPoints: ['Continuity'], targetLength: 'short' },
                        ],
                    }) }],
                }],
            })
            .mockResolvedValueOnce({
                id: 'resp-expand',
                output: [{
                    type: 'message',
                    content: [{ text: JSON.stringify({
                        title: 'Continuity Report',
                        sections: [
                            { heading: 'Overview', content: 'Expanded continuity content', level: 1 },
                        ],
                    }) }],
                }],
            })
            .mockResolvedValueOnce({
                id: 'resp-compose',
                output: [{
                    type: 'message',
                    content: [{ text: '<!DOCTYPE html><html><body><h1>Continuity Report</h1></body></html>' }],
                }],
            });

        await artifactService.generateArtifact({
            session: { previousResponseId: 'prev-session', metadata: {} },
            sessionId: 'session-1',
            mode: 'chat',
            prompt: 'Create the same HTML report, but update section 3 from the previous version.',
            format: 'html',
            artifactIds: [],
            model: 'gpt-5.3',
            contextMessages: ['Relevant prior artifacts:\n- report-v1.html: Existing section 3 summary'],
            recentMessages: [
                { role: 'user', content: 'Create the first version of the report.' },
                { role: 'assistant', content: 'Created report-v1.html.' },
            ],
        });

        expect(createResponse).toHaveBeenCalledTimes(3);
        expect(createResponse.mock.calls[0][0]).toEqual(expect.objectContaining({
            previousResponseId: 'prev-session',
            contextMessages: ['Relevant prior artifacts:\n- report-v1.html: Existing section 3 summary'],
            recentMessages: expect.arrayContaining([
                expect.objectContaining({ role: 'user', content: 'Create the first version of the report.' }),
            ]),
        }));
        expect(createResponse.mock.calls[1][0]).toEqual(expect.objectContaining({
            previousResponseId: 'resp-plan',
            contextMessages: ['Relevant prior artifacts:\n- report-v1.html: Existing section 3 summary'],
        }));
        expect(createResponse.mock.calls[2][0]).toEqual(expect.objectContaining({
            previousResponseId: 'resp-expand',
            contextMessages: ['Relevant prior artifacts:\n- report-v1.html: Existing section 3 summary'],
        }));
    });

    test('uses single-pass frontend-demo generation for html landing-page requests', async () => {
        createResponse.mockResolvedValueOnce({
            id: 'resp-frontend-1',
            output: [{
                type: 'message',
                content: [{
                    text: '<!DOCTYPE html><html><head><title>Nova Studio</title></head><body><section id="hero" data-component="hero"><h1>Nova Studio</h1></section></body></html>',
                }],
            }],
        });

        const result = await artifactService.generateArtifact({
            session: { previousResponseId: 'prev-1', metadata: {} },
            sessionId: 'session-1',
            mode: 'chat',
            prompt: 'Build a landing page demo for Nova Studio with a premium editorial feel.',
            format: 'html',
            artifactIds: [],
            existingContent: '',
            model: 'gpt-5.3',
        });

        expect(createResponse).toHaveBeenCalledTimes(1);
        expect(createResponse.mock.calls[0][0]?.instructions).toContain('Build a polished frontend demo instead of a plain document.');
        expect(renderArtifact).toHaveBeenCalledWith(expect.objectContaining({
            format: 'html',
            title: expect.stringContaining('Nova Studio'),
            content: expect.stringContaining('data-component="hero"'),
        }));
        expect(artifactStore.create).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({
                generationStrategy: 'single-pass-frontend-demo',
            }),
        }));
        expect(result.responseId).toBe('resp-frontend-1');
    });

    test('injects dashboard template guidance for dashboard html artifacts', async () => {
        createResponse.mockResolvedValueOnce({
            id: 'resp-dashboard-1',
            output: [{
                type: 'message',
                content: [{
                    text: '<!DOCTYPE html><html><body data-dashboard-template="admin-control-room"><main data-dashboard-zone="hero"><h1>Support Ops</h1></main></body></html>',
                }],
            }],
        });

        await artifactService.generateArtifact({
            session: { previousResponseId: 'prev-1', metadata: {} },
            sessionId: 'session-1',
            mode: 'chat',
            prompt: 'Create an admin dashboard HTML for support operations with ticket queues and SLA timers.',
            format: 'html',
            artifactIds: [],
            existingContent: '',
            model: 'gpt-5.3',
        });

        expect(createResponse).toHaveBeenCalledTimes(1);
        expect(createResponse.mock.calls[0][0]?.instructions).toContain('[Dashboard template catalog]');
        expect(createResponse.mock.calls[0][0]?.instructions).toContain('data-dashboard-template');
        expect(artifactStore.create).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({
                dashboardTemplateSuggestedPrimaryId: expect.any(String),
                dashboardTemplateOptions: expect.arrayContaining([
                    expect.objectContaining({
                        id: expect.any(String),
                        label: expect.any(String),
                    }),
                ]),
            }),
        }));
    });

    test('injects verified session image references into multi-pass document instructions', async () => {
        createResponse
            .mockResolvedValueOnce({
                id: 'resp-plan',
                output: [{
                    type: 'message',
                    content: [{ text: JSON.stringify({
                        title: 'Axe Throwing Guide',
                        sections: [
                            { heading: 'Overview', purpose: 'Introduce the venues', keyPoints: ['Atmosphere'], targetLength: 'short' },
                        ],
                    }) }],
                }],
            })
            .mockResolvedValueOnce({
                id: 'resp-expand',
                output: [{
                    type: 'message',
                    content: [{ text: JSON.stringify({
                        title: 'Axe Throwing Guide',
                        sections: [
                            { heading: 'Overview', content: 'Overview content', level: 1 },
                        ],
                    }) }],
                }],
            })
            .mockResolvedValueOnce({
                id: 'resp-compose',
                output: [{
                    type: 'message',
                    content: [{ text: '<!DOCTYPE html><html><body><h1>Axe Throwing Guide</h1><img src="https://images.unsplash.com/photo-123" alt="Axe throwing venue"></body></html>' }],
                }],
            });

        await artifactService.generateArtifact({
            session: {
                previousResponseId: 'prev-1',
                metadata: {
                    projectMemory: {
                        urls: [
                            {
                                url: 'https://images.unsplash.com/photo-123',
                                kind: 'image',
                                title: 'Venue action shot',
                                source: 'tool',
                                toolId: 'image-search-unsplash',
                            },
                        ],
                    },
                },
            },
            sessionId: 'session-1',
            mode: 'chat',
            prompt: 'Create a polished HTML guide for Atlantic Canada axe throwing venues.',
            format: 'html',
            artifactIds: [],
            existingContent: '',
            model: 'gpt-5.3',
        });

        expect(createResponse).toHaveBeenCalledTimes(3);
        const instructions = createResponse.mock.calls.map((call) => call[0]?.instructions || '').join('\n\n---\n\n');
        expect(instructions).toContain('[Verified image references]');
        expect(instructions).toContain('https://images.unsplash.com/photo-123');
        expect(instructions).toContain('Never create inline SVG artwork');
        expect(instructions).toContain('Prefer standard HTML <img src="..."> elements');
    });

    test('adds sample-handling and creative-direction guardrails when scaffold content is provided', async () => {
        createResponse
            .mockResolvedValueOnce({
                id: 'resp-plan',
                output: [{
                    type: 'message',
                    content: [{ text: JSON.stringify({
                        title: 'Expansion Brief',
                        creativeDirection: {
                            id: 'boardroom-brief',
                            label: 'Boardroom Brief',
                            rationale: 'Fast, decision-ready structure.',
                        },
                        sections: [
                            { heading: 'Decision', purpose: 'Frame the call', keyPoints: ['Approve the move'], targetLength: 'short' },
                        ],
                    }) }],
                }],
            })
            .mockResolvedValueOnce({
                id: 'resp-expand',
                output: [{
                    type: 'message',
                    content: [{ text: JSON.stringify({
                        title: 'Expansion Brief',
                        sections: [
                            { heading: 'Decision', kicker: 'Go / no-go', content: 'Approve the move.', level: 1 },
                        ],
                    }) }],
                }],
            })
            .mockResolvedValueOnce({
                id: 'resp-compose',
                output: [{
                    type: 'message',
                    content: [{ text: '<!DOCTYPE html><html><body><h1>Expansion Brief</h1></body></html>' }],
                }],
            });

        await artifactService.generateArtifact({
            session: { previousResponseId: 'prev-1', metadata: {} },
            sessionId: 'session-1',
            mode: 'chat',
            prompt: 'Create a polished executive brief for Atlantic expansion.',
            format: 'pdf',
            artifactIds: [],
            existingContent: '## Overview\n## Details\n{{company_name}}\nPlaceholder copy here',
            model: 'gpt-5.3',
        });

        const instructions = createResponse.mock.calls.map((call) => call[0]?.instructions || '').join('\n\n---\n\n');
        expect(instructions).toContain('<creative_direction>');
        expect(instructions).toContain('Direction:');
        expect(instructions).toContain('<sample_handling>');
        expect(instructions).toContain('Treat the provided template, defaults, and sample text as scaffolding, not final copy.');
        expect(instructions).toContain('Do not simply recycle the sample section labels');
        expect(artifactStore.create).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({
                creativeDirection: expect.any(String),
                themeSuggestion: expect.any(String),
            }),
        }));
    });

    test('fetches Unsplash image references for visual html documents when configured', async () => {
        isConfigured.mockReturnValue(true);
        searchImages.mockResolvedValue({
            results: [
                {
                    description: 'Axe throwing lane',
                    altDescription: 'Axe throwing target',
                    urls: {
                        regular: 'https://images.unsplash.com/photo-999',
                    },
                },
            ],
        });

        createResponse
            .mockResolvedValueOnce({
                id: 'resp-plan',
                output: [{
                    type: 'message',
                    content: [{ text: JSON.stringify({
                        title: 'Axe Throwing Guide',
                        sections: [
                            { heading: 'Overview', purpose: 'Introduce the venues', keyPoints: ['Atmosphere'], targetLength: 'short' },
                        ],
                    }) }],
                }],
            })
            .mockResolvedValueOnce({
                id: 'resp-expand',
                output: [{
                    type: 'message',
                    content: [{ text: JSON.stringify({
                        title: 'Axe Throwing Guide',
                        sections: [
                            { heading: 'Overview', content: 'Overview content', level: 1 },
                        ],
                    }) }],
                }],
            })
            .mockResolvedValueOnce({
                id: 'resp-compose',
                output: [{
                    type: 'message',
                    content: [{ text: '<!DOCTYPE html><html><body><h1>Axe Throwing Guide</h1><img src="https://images.unsplash.com/photo-999" alt="Axe throwing lane"></body></html>' }],
                }],
            });

        await artifactService.generateArtifact({
            session: { previousResponseId: 'prev-1', metadata: {} },
            sessionId: 'session-1',
            mode: 'chat',
            prompt: 'Create a visual HTML guide with real Unsplash images for Atlantic Canada axe throwing venues.',
            format: 'html',
            artifactIds: [],
            existingContent: '',
            model: 'gpt-5.3',
        });

        expect(searchImages).toHaveBeenCalledWith(expect.stringContaining('atlantic canada axe throwing venues'), expect.objectContaining({
            perPage: 20,
            orientation: 'landscape',
        }));
        const instructions = createResponse.mock.calls.map((call) => call[0]?.instructions || '').join('\n\n---\n\n');
        expect(instructions).toContain('https://images.unsplash.com/photo-999');
        expect(instructions).toContain('[Verified image references]');
        expect(instructions).toContain('up to 20 images');
    });

    test('ignores internal artifact image links and prefers external urls for document visuals', async () => {
        isConfigured.mockReturnValue(true);
        searchImages.mockResolvedValue({
            results: [
                {
                    description: 'External photo',
                    altDescription: 'External fallback photo',
                    urls: {
                        regular: 'https://images.unsplash.com/photo-456',
                    },
                },
            ],
        });

        createResponse
            .mockResolvedValueOnce({
                id: 'resp-plan',
                output: [{
                    type: 'message',
                    content: [{ text: JSON.stringify({
                        title: 'Travel Brief',
                        sections: [
                            { heading: 'Overview', purpose: 'Summarize the brief', keyPoints: ['Goal'], targetLength: 'short' },
                        ],
                    }) }],
                }],
            })
            .mockResolvedValueOnce({
                id: 'resp-expand',
                output: [{
                    type: 'message',
                    content: [{ text: JSON.stringify({
                        title: 'Travel Brief',
                        sections: [
                            { heading: 'Overview', content: 'Overview content', level: 1 },
                        ],
                    }) }],
                }],
            })
            .mockResolvedValueOnce({
                id: 'resp-compose',
                output: [{
                    type: 'message',
                    content: [{ text: 'Page Layout Plan\n\nUse verified photos throughout the PDF.' }],
                }],
            });

        await artifactService.generateArtifact({
            session: {
                previousResponseId: 'prev-1',
                metadata: {
                    projectMemory: {
                        urls: [
                            {
                                url: '/api/artifacts/internal-image/download',
                                kind: 'image',
                                title: 'Internal artifact image',
                                source: 'session',
                            },
                        ],
                    },
                },
            },
            sessionId: 'session-1',
            mode: 'chat',
            prompt: 'Create a polished PDF travel brief.',
            format: 'pdf',
            artifactIds: [],
            existingContent: '',
            model: 'gpt-5.3',
        });

        const instructions = createResponse.mock.calls.map((call) => call[0]?.instructions || '').join('\n\n---\n\n');
        expect(instructions).not.toContain('/api/artifacts/internal-image/download');
        expect(instructions).toContain('https://images.unsplash.com/photo-456');
        expect(renderArtifact).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('https://images.unsplash.com/photo-456'),
        }));
        expect(renderArtifact).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.not.stringContaining('/api/artifacts/internal-image/download'),
        }));
    });

    test('reuses selected image artifacts instead of falling back to Unsplash on prior-image follow-ups', async () => {
        isConfigured.mockReturnValue(true);
        artifactStore.get.mockResolvedValue({
            id: 'image-artifact-1',
            sessionId: 'session-1',
            filename: 'generated-image-01.png',
            extension: 'png',
            mimeType: 'image/png',
            metadata: {
                generatedBy: 'image-generate',
                title: 'Verified generated beach image',
            },
        });

        createResponse
            .mockResolvedValueOnce({
                id: 'resp-plan',
                output: [{
                    type: 'message',
                    content: [{ text: JSON.stringify({
                        title: 'Beach PDF',
                        sections: [
                            { heading: 'Overview', purpose: 'Summarize the image set', keyPoints: ['Visual theme'], targetLength: 'short' },
                        ],
                    }) }],
                }],
            })
            .mockResolvedValueOnce({
                id: 'resp-expand',
                output: [{
                    type: 'message',
                    content: [{ text: JSON.stringify({
                        title: 'Beach PDF',
                        sections: [
                            { heading: 'Overview', content: 'Overview content', level: 1 },
                        ],
                    }) }],
                }],
            })
            .mockResolvedValueOnce({
                id: 'resp-compose',
                output: [{
                    type: 'message',
                    content: [{ text: '<!DOCTYPE html><html><body><h1>Beach PDF</h1><img src="/api/artifacts/image-artifact-1/download?inline=1" alt="Verified generated beach image"></body></html>' }],
                }],
            });

        await artifactService.generateArtifact({
            session: { previousResponseId: 'prev-1', metadata: {} },
            sessionId: 'session-1',
            mode: 'chat',
            prompt: 'Make a PDF with those images from earlier.',
            format: 'pdf',
            artifactIds: ['image-artifact-1'],
            existingContent: '',
            model: 'gpt-5.3',
        });

        expect(searchImages).not.toHaveBeenCalled();
        const instructions = createResponse.mock.calls.map((call) => call[0]?.instructions || '').join('\n\n---\n\n');
        expect(instructions).toContain('/api/artifacts/image-artifact-1/download?inline=1');
        expect(renderArtifact).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('/api/artifacts/image-artifact-1/download?inline=1'),
        }));
    });

    test('recovers when composition returns a layout plan instead of final html', async () => {
        createResponse
            .mockResolvedValueOnce({
                id: 'resp-plan',
                output: [{
                    type: 'message',
                    content: [{ text: JSON.stringify({
                        title: 'Photo Brief',
                        sections: [
                            { heading: 'Overview', purpose: 'Summarize the brief', keyPoints: ['Goal'], targetLength: 'short' },
                            { heading: 'Gallery Notes', purpose: 'Explain the images', keyPoints: ['Verified photos'], targetLength: 'medium' },
                        ],
                    }) }],
                }],
            })
            .mockResolvedValueOnce({
                id: 'resp-expand',
                output: [{
                    type: 'message',
                    content: [{ text: JSON.stringify({
                        title: 'Photo Brief',
                        sections: [
                            { heading: 'Overview', content: 'This is the real overview content.', level: 1 },
                            { heading: 'Gallery Notes', content: '- Verified Unsplash photos\n- Coherent sequence', level: 1 },
                        ],
                    }) }],
                }],
            })
            .mockResolvedValueOnce({
                id: 'resp-compose',
                output: [{
                    type: 'message',
                    content: [{ text: [
                        'Page Layout Plan',
                        'The layout should keep attention on the verified photographs.',
                        'Credits And Source Register',
                        'Final Build Checks',
                    ].join('\n\n') }],
                }],
            });

        await artifactService.generateArtifact({
            session: {
                previousResponseId: 'prev-1',
                metadata: {
                    projectMemory: {
                        urls: [
                            {
                                url: 'https://images.unsplash.com/photo-321',
                                kind: 'image',
                                title: 'Verified photo',
                                source: 'tool',
                                toolId: 'image-search-unsplash',
                            },
                        ],
                    },
                },
            },
            sessionId: 'session-1',
            mode: 'chat',
            prompt: 'Create a polished PDF photo brief using the verified session images.',
            format: 'pdf',
            artifactIds: [],
            existingContent: '',
            model: 'gpt-5.3',
        });

        expect(renderArtifact).toHaveBeenCalledWith(expect.objectContaining({
            format: 'pdf',
            content: expect.stringContaining('<!DOCTYPE html>'),
        }));
        expect(renderArtifact).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('This is the real overview content.'),
        }));
        expect(renderArtifact).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('https://images.unsplash.com/photo-321'),
        }));
        expect(artifactStore.create).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({
                compositionRecovered: true,
            }),
        }));
    });
});
