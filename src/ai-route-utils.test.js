jest.mock('./artifacts/artifact-service', () => ({
    artifactService: {
        buildPromptContext: jest.fn(),
        generateArtifact: jest.fn(),
    },
}));

jest.mock('./routes/admin/settings.controller', () => ({
    getEffectiveSshConfig: jest.fn(() => ({
        enabled: false,
        host: '',
        port: 22,
        username: '',
        password: '',
        privateKeyPath: '',
    })),
}));

const { artifactService } = require('./artifacts/artifact-service');
const settingsController = require('./routes/admin/settings.controller');
const {
    buildImagePromptFromArtifactRequest,
    buildArtifactCompletionMessage,
    generateOutputArtifactFromPrompt,
    extractSshSessionMetadataFromToolEvents,
    hasExplicitArtifactDeliveryIntent,
    hasExplicitImageGenerationIntent,
    hasExplicitMermaidFileIntent,
    hasPlanningConversationIntent,
    hasImplicitNotesPageBuildIntent,
    hasExplicitNotesPageEditIntent,
    inferRequestedOutputFormat,
    inferOutputFormatFromSession,
    maybePrepareImagesForArtifactPrompt,
    getPreferredRemoteToolId,
    resolveDeferredWorkloadPreflight,
    resolveReasoningEffort,
    resolveSshRequestContext,
    resolveArtifactContextIds,
    shouldPreGenerateImagesForArtifactRequest,
    shouldDeferArtifactGenerationToWorkload,
    shouldSuppressNotesSurfaceArtifact,
    shouldSuppressImplicitMermaidArtifact,
} = require('./ai-route-utils');

describe('ai-route-utils', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: false,
            host: '',
            port: 22,
            username: '',
            password: '',
            privateKeyPath: '',
        });
    });

    test('buildArtifactCompletionMessage formats friendly labels', () => {
        expect(buildArtifactCompletionMessage('pdf', { filename: 'space-zine.pdf' }))
            .toBe('Created the PDF artifact (space-zine.pdf).');
    });

    test('shouldDeferArtifactGenerationToWorkload detects scheduled artifact requests', () => {
        expect(shouldDeferArtifactGenerationToWorkload(
            'can you do web search on penguins and then make a pdf for me but schedule it for 5 minutes from now',
            'pdf',
        )).toBe(true);
        expect(shouldDeferArtifactGenerationToWorkload(
            'in 5 minutes can you do some research on adhd and make a pdf document on it I can review',
            'pdf',
        )).toBe(true);
        expect(shouldDeferArtifactGenerationToWorkload(
            'make me a pdf about penguins right now',
            'pdf',
        )).toBe(false);
        expect(shouldDeferArtifactGenerationToWorkload(
            'make me a pdf of today\'s news',
            'pdf',
        )).toBe(false);
        expect(shouldDeferArtifactGenerationToWorkload(
            'make me a pdf about daily adhd traits',
            'pdf',
        )).toBe(false);
    });

    test('resolveDeferredWorkloadPreflight uses transcript context for fragmented future requests', () => {
        expect(resolveDeferredWorkloadPreflight({
            text: 'in five minutes from now',
            recentMessages: [
                { role: 'user', content: 'do some research on adhd and make a pdf document on it I can review' },
            ],
            timezone: 'UTC',
            now: '2026-04-03T14:47:00.000Z',
        })).toMatchObject({
            timing: 'future',
            shouldSchedule: true,
            request: expect.stringContaining('do some research on adhd'),
            scenario: {
                trigger: {
                    type: 'once',
                    runAt: '2026-04-03T14:52:00.000Z',
                },
            },
        });
    });

    test('resolveDeferredWorkloadPreflight does not keep prior schedule context sticky for a new task turn', () => {
        expect(resolveDeferredWorkloadPreflight({
            text: 'do some research on adhd and make a pdf document on it I can review',
            recentMessages: [
                { role: 'user', content: 'in five minutes from now' },
            ],
            timezone: 'UTC',
            now: '2026-04-03T14:47:00.000Z',
        })).toMatchObject({
            timing: 'now',
            shouldSchedule: false,
            scenario: null,
        });
    });

    test('resolveDeferredWorkloadPreflight keeps greetings out of scheduled workload routing', () => {
        expect(resolveDeferredWorkloadPreflight({
            text: 'hi',
            recentMessages: [
                { role: 'user', content: 'in five minutes from now' },
            ],
            timezone: 'UTC',
            now: '2026-04-03T14:47:00.000Z',
        })).toMatchObject({
            timing: 'now',
            shouldSchedule: false,
            scenario: null,
        });
    });

    test('generateOutputArtifactFromPrompt requires a user prompt', async () => {
        await expect(generateOutputArtifactFromPrompt({
            sessionId: 'session-1',
            mode: 'chat',
            outputFormat: 'pdf',
            prompt: '',
        })).rejects.toMatchObject({
            message: 'A user prompt is required to generate an output artifact',
            statusCode: 400,
        });
    });

    test('generateOutputArtifactFromPrompt returns artifact metadata and completion text', async () => {
        artifactService.generateArtifact.mockResolvedValue({
            responseId: 'resp-1',
            artifact: {
                id: 'artifact-1',
                filename: 'space-zine.pdf',
            },
            outputText: '<html><body>Space zine</body></html>',
        });

        await expect(generateOutputArtifactFromPrompt({
            sessionId: 'session-1',
            mode: 'chat',
            outputFormat: 'pdf',
            prompt: 'Make me a PDF about space',
            artifactIds: ['artifact-a'],
            model: 'gpt-test',
        })).resolves.toEqual({
            responseId: 'resp-1',
            artifact: {
                id: 'artifact-1',
                filename: 'space-zine.pdf',
            },
            artifacts: [{
                id: 'artifact-1',
                filename: 'space-zine.pdf',
            }],
            outputText: '<html><body>Space zine</body></html>',
            assistantMessage: 'Created the PDF artifact (space-zine.pdf).',
        });

        expect(artifactService.generateArtifact).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session-1',
            mode: 'chat',
            prompt: 'Make me a PDF about space',
            format: 'pdf',
            artifactIds: ['artifact-a'],
            model: 'gpt-test',
        }));
    });

    test('inferOutputFormatFromSession keeps artifact workflows sticky on continuation turns', () => {
        expect(inferOutputFormatFromSession('another pass, keep the pacing quieter', {
            metadata: {
                lastOutputFormat: 'pdf',
                lastGeneratedArtifactId: 'artifact-1',
            },
        })).toBe('pdf');
    });

    test('inferRequestedOutputFormat does not treat casual diagram mentions as mermaid exports', () => {
        expect(inferRequestedOutputFormat('Can you explain the architecture diagram from earlier?')).toBeNull();
        expect(inferRequestedOutputFormat('I want the content, not a diagram.')).toBeNull();
    });

    test('inferRequestedOutputFormat requires an explicit mermaid export request', () => {
        expect(inferRequestedOutputFormat('Create a Mermaid diagram for the auth flow')).toBe('mermaid');
        expect(inferRequestedOutputFormat('Export this as a Mermaid file')).toBe('mermaid');
    });

    test('inferRequestedOutputFormat treats landing-page and frontend-demo requests as html artifacts', () => {
        expect(inferRequestedOutputFormat('Build a landing page for a climate startup')).toBe('html');
        expect(inferRequestedOutputFormat('Create a frontend demo microsite for our product launch')).toBe('html');
        expect(inferRequestedOutputFormat('Create an admin dashboard HTML for customer support ops')).toBe('html');
    });

    test('hasExplicitMermaidFileIntent only returns true for file-like Mermaid requests', () => {
        expect(hasExplicitMermaidFileIntent('Create a Mermaid diagram for the auth flow')).toBe(false);
        expect(hasExplicitMermaidFileIntent('Export this as a Mermaid file')).toBe(true);
        expect(hasExplicitMermaidFileIntent('Share a .mmd artifact for this flow')).toBe(true);
    });

    test('distinguishes notes page edits from explicit artifact delivery requests', () => {
        expect(hasExplicitNotesPageEditIntent('Put this on the page as a polished hypercar brochure.')).toBe(true);
        expect(hasImplicitNotesPageBuildIntent('Can you make me an HTML page about tropical fish with sections for habitat and care?')).toBe(true);
        expect(hasPlanningConversationIntent('Help me plan the structure for an HTML page about tropical fish before you write it.')).toBe(true);
        expect(hasPlanningConversationIntent('Put this implementation plan on the page as a structured brief.')).toBe(false);
        expect(hasExplicitArtifactDeliveryIntent('Export a PDF file and add the download link to the page.')).toBe(true);
        expect(hasExplicitArtifactDeliveryIntent('Put this on the page as a polished hypercar brochure.')).toBe(false);
    });

    test('detects explicit image generation intent without confusing follow-up image references', () => {
        expect(hasExplicitImageGenerationIntent('Make a hypercar image and put it in a PDF brochure.')).toBe(true);
        expect(hasExplicitImageGenerationIntent('Make a PDF with those images from earlier.')).toBe(false);
    });

    test('extracts an image-only prompt from mixed image-plus-artifact requests', () => {
        expect(buildImagePromptFromArtifactRequest('Make a hypercar image and put it in a PDF brochure.'))
            .toBe('Make a hypercar image');
    });

    test('only pre-generates images for explicit image-plus-document requests', () => {
        expect(shouldPreGenerateImagesForArtifactRequest({
            text: 'Make a hypercar image and put it in a PDF brochure.',
            outputFormat: 'pdf',
        })).toBe(true);

        expect(shouldPreGenerateImagesForArtifactRequest({
            text: 'Make a PDF with those images from earlier.',
            outputFormat: 'pdf',
        })).toBe(false);
    });

    test('shouldSuppressImplicitMermaidArtifact keeps Mermaid inline for notes unless export was explicit', () => {
        expect(shouldSuppressImplicitMermaidArtifact({
            taskType: 'notes',
            text: 'Create a Mermaid diagram for the auth flow inside this page',
            outputFormat: 'mermaid',
            outputFormatProvided: false,
        })).toBe(true);

        expect(shouldSuppressImplicitMermaidArtifact({
            taskType: 'notes',
            text: 'Export this as a Mermaid file',
            outputFormat: 'mermaid',
            outputFormatProvided: false,
        })).toBe(false);

        expect(shouldSuppressImplicitMermaidArtifact({
            taskType: 'notes',
            text: 'Create a Mermaid diagram for the auth flow',
            outputFormat: 'mermaid',
            outputFormatProvided: true,
        })).toBe(false);
    });

    test('shouldSuppressNotesSurfaceArtifact keeps notes page edits inline unless file delivery was explicit', () => {
        expect(shouldSuppressNotesSurfaceArtifact({
            taskType: 'notes',
            text: 'Put this hypercar collection on the page as a polished brochure PDF.',
            outputFormat: 'pdf',
            outputFormatProvided: true,
        })).toBe(true);

        expect(shouldSuppressNotesSurfaceArtifact({
            taskType: 'notes',
            text: 'Export this as a PDF file and add the download link to the page.',
            outputFormat: 'pdf',
            outputFormatProvided: true,
        })).toBe(false);

        expect(shouldSuppressNotesSurfaceArtifact({
            taskType: 'notes',
            text: 'Can you make me an HTML page about tropical fish with sections for habitat and care?',
            outputFormat: 'html',
            outputFormatProvided: false,
        })).toBe(true);

        expect(shouldSuppressNotesSurfaceArtifact({
            taskType: 'notes',
            text: 'Create an HTML file I can download for a tropical fish landing page.',
            outputFormat: 'html',
            outputFormatProvided: false,
        })).toBe(false);

        expect(shouldSuppressNotesSurfaceArtifact({
            taskType: 'notes',
            text: 'Help me plan the structure for an HTML page about tropical fish before you write it.',
            outputFormat: 'html',
            outputFormatProvided: false,
        })).toBe(true);
    });

    test('shouldSuppressNotesSurfaceArtifact keeps Power Query inline on notes unless file delivery was explicit', () => {
        expect(shouldSuppressNotesSurfaceArtifact({
            taskType: 'notes',
            text: 'Write a Power Query script to clean these columns and put it in the note.',
            outputFormat: 'power-query',
            outputFormatProvided: false,
        })).toBe(true);

        expect(shouldSuppressNotesSurfaceArtifact({
            taskType: 'notes',
            text: 'Create a Power Query file and give me the artifact link.',
            outputFormat: 'power-query',
            outputFormatProvided: false,
        })).toBe(false);
    });

    test('inferOutputFormatFromSession does not keep mermaid sticky on generic continuation turns', () => {
        expect(inferOutputFormatFromSession('another pass, keep the pacing quieter', {
            metadata: {
                lastOutputFormat: 'mermaid',
                lastGeneratedArtifactId: 'artifact-1',
            },
        })).toBeNull();

        expect(inferOutputFormatFromSession('continue the diagram and add retries', {
            metadata: {
                lastOutputFormat: 'mermaid',
                lastGeneratedArtifactId: 'artifact-1',
            },
        })).toBe('mermaid');
    });

    test('resolveArtifactContextIds falls back to the last generated artifact on continuation turns', () => {
        expect(resolveArtifactContextIds({
            metadata: {
                lastGeneratedArtifactId: 'artifact-1',
            },
        }, [], 'another pass, keep refining that html file')).toEqual(['artifact-1']);
    });

    test('resolveArtifactContextIds prefers the last generated image artifacts for image follow-ups', () => {
        expect(resolveArtifactContextIds({
            metadata: {
                lastGeneratedArtifactId: 'artifact-1',
                lastGeneratedImageArtifactIds: ['image-1', 'image-2'],
            },
        }, [], 'make a pdf with those images from earlier')).toEqual(['image-1', 'image-2']);
    });

    test('resolveArtifactContextIds does not carry old artifacts into explicit new-image requests', () => {
        expect(resolveArtifactContextIds({
            metadata: {
                lastGeneratedArtifactId: 'artifact-1',
                lastGeneratedImageArtifactIds: ['image-1', 'image-2'],
            },
        }, [], 'Generate more hypercar images and then make a document with it.')).toEqual([]);
    });

    test('resolveArtifactContextIds does not attach the last generated artifact on unrelated turns', () => {
        expect(resolveArtifactContextIds({
            metadata: {
                lastGeneratedArtifactId: 'artifact-1',
            },
        }, [], 'deploy the site online and verify the public route')).toEqual([]);
    });

    test('maybePrepareImagesForArtifactPrompt executes image generation and merges artifact ids', async () => {
        const toolManager = {
            getTool: jest.fn(() => ({ id: 'image-generate' })),
            executeTool: jest.fn().mockResolvedValue({
                success: true,
                toolId: 'image-generate',
                data: {
                    artifacts: [{ id: 'image-1', filename: 'hypercar-01.png' }],
                },
            }),
        };

        await expect(maybePrepareImagesForArtifactPrompt({
            toolManager,
            sessionId: 'session-1',
            route: '/api/chat',
            transport: 'http',
            taskType: 'chat',
            text: 'Make a hypercar image and put it in a PDF brochure.',
            outputFormat: 'pdf',
            artifactIds: ['existing-1'],
        })).resolves.toEqual({
            artifactIds: ['existing-1', 'image-1'],
            artifacts: [{ id: 'image-1', filename: 'hypercar-01.png' }],
            imagePrompt: 'Make a hypercar image',
            resetPreviousResponse: true,
            toolEvents: [expect.objectContaining({
                reason: 'Generate image artifacts before creating the pdf artifact.',
                result: expect.objectContaining({
                    success: true,
                    toolId: 'image-generate',
                }),
            })],
        });
    });

    test('getPreferredRemoteToolId prefers remote-command when both SSH tools exist', () => {
        const toolManager = {
            getTool: jest.fn((toolId) => (
                ['ssh-execute', 'remote-command'].includes(toolId)
                    ? { id: toolId }
                    : null
            )),
        };

        expect(getPreferredRemoteToolId(toolManager)).toBe('remote-command');
    });

    test('resolveReasoningEffort accepts camelCase, snake_case, and OpenAI-style reasoning objects', () => {
        expect(resolveReasoningEffort({ reasoningEffort: 'high' })).toBe('high');
        expect(resolveReasoningEffort({ reasoning_effort: 'medium' })).toBe('medium');
        expect(resolveReasoningEffort({ reasoning: { effort: 'low' } })).toBe('low');
        expect(resolveReasoningEffort({ reasoningEffort: 'invalid' })).toBeNull();
    });

    test('resolveSshRequestContext does not infer kubectl pod listing for generic cluster deployment continuations', () => {
        const sshContext = resolveSshRequestContext(
            'can you please set this up on the cluster. you will find everything you need on that cluster to deploy, you can move it to a pod on the cluster if you would like.',
            {
                metadata: {
                    lastToolIntent: 'remote-command',
                    lastSshTarget: {
                        host: 'test.demoserver2.buzz',
                        username: 'root',
                        port: 22,
                    },
                },
            },
        );

        expect(sshContext.shouldTreatAsSsh).toBe(true);
        expect(sshContext.command).toBeNull();
        expect(sshContext.directParams).toBeNull();
    });

    test('resolveSshRequestContext infers a direct baseline command for health report phrasing', () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const sshContext = resolveSshRequestContext('can you remote into the server and get a health report');

        expect(sshContext.shouldTreatAsSsh).toBe(true);
        expect(sshContext.command).toBe('hostname && uptime && (df -h / || true) && (free -m || true)');
        expect(sshContext.directParams).toEqual({
            host: '10.0.0.5',
            username: 'ubuntu',
            port: 22,
            command: 'hostname && uptime && (df -h / || true) && (free -m || true)',
        });
    });

    test('resolveSshRequestContext infers a direct baseline command for server state phrasing', () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const sshContext = resolveSshRequestContext('do a remote command and tell me the server state');

        expect(sshContext.shouldTreatAsSsh).toBe(true);
        expect(sshContext.command).toBe('hostname && uptime && (df -h / || true) && (free -m || true)');
        expect(sshContext.directParams).toEqual({
            host: '10.0.0.5',
            username: 'ubuntu',
            port: 22,
            command: 'hostname && uptime && (df -h / || true) && (free -m || true)',
        });
    });

    test('resolveSshRequestContext reuses the previous remote command for retry-style continuation prompts', () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '10.0.0.5',
            port: 22,
            username: 'ubuntu',
            password: 'secret',
            privateKeyPath: '',
        });

        const sshContext = resolveSshRequestContext(
            'try again to remote command',
            {
                metadata: {
                    lastToolIntent: 'remote-command',
                    lastSshTarget: {
                        host: '10.0.0.5',
                        username: 'ubuntu',
                        port: 22,
                    },
                    remoteWorkingState: {
                        lastUpdated: new Date().toISOString(),
                        target: {
                            host: '10.0.0.5',
                            username: 'ubuntu',
                            port: 22,
                        },
                        lastCommand: 'hostname && uptime && (df -h / || true) && (free -m || true)',
                    },
                },
            },
        );

        expect(sshContext.continuation).toBe(true);
        expect(sshContext.command).toBe('hostname && uptime && (df -h / || true) && (free -m || true)');
        expect(sshContext.directParams).toEqual({
            host: '10.0.0.5',
            username: 'ubuntu',
            port: 22,
            command: 'hostname && uptime && (df -h / || true) && (free -m || true)',
        });
    });

    test('resolveSshRequestContext does not keep generic go-ahead sticky without fresh remote state', () => {
        const sshContext = resolveSshRequestContext(
            'go ahead',
            {
                metadata: {
                    lastToolIntent: 'remote-command',
                    lastSshTarget: {
                        host: 'test.demoserver2.buzz',
                        username: 'root',
                        port: 22,
                    },
                },
            },
        );

        expect(sshContext.shouldTreatAsSsh).toBe(false);
        expect(sshContext.effectivePrompt).toBe('go ahead');
    });

    test('resolveSshRequestContext keeps generic go-ahead sticky while remote state is fresh', () => {
        const sshContext = resolveSshRequestContext(
            'go ahead',
            {
                metadata: {
                    lastToolIntent: 'remote-command',
                    lastSshTarget: {
                        host: 'test.demoserver2.buzz',
                        username: 'root',
                        port: 22,
                    },
                    remoteWorkingState: {
                        lastUpdated: new Date().toISOString(),
                        target: {
                            host: 'test.demoserver2.buzz',
                            username: 'root',
                            port: 22,
                        },
                        lastCommand: 'kubectl describe pod -n gitea gitea-5479f795f8-pk2dp',
                    },
                },
            },
        );

        expect(sshContext.shouldTreatAsSsh).toBe(true);
        expect(sshContext.effectivePrompt).toContain('SSH into root@test.demoserver2.buzz');
        expect(sshContext.command).toBeNull();
    });

    test('resolveSshRequestContext prefers configured SSH defaults over a suspicious sticky host', () => {
        settingsController.getEffectiveSshConfig.mockReturnValue({
            enabled: true,
            host: '162.55.163.199',
            port: 22,
            username: 'root',
            password: 'secret',
            privateKeyPath: '',
        });

        const sshContext = resolveSshRequestContext(
            'go ahead',
            {
                metadata: {
                    lastToolIntent: 'remote-command',
                    lastSshTarget: {
                        host: 'web-fetch.body',
                        username: '',
                        port: 22,
                    },
                    remoteWorkingState: {
                        lastUpdated: new Date().toISOString(),
                        target: {
                            host: 'web-fetch.body',
                            username: '',
                            port: 22,
                        },
                        lastCommand: 'kubectl get deployment website',
                    },
                },
            },
        );

        expect(sshContext.shouldTreatAsSsh).toBe(true);
        expect(sshContext.target).toEqual({
            host: '162.55.163.199',
            username: 'root',
            port: 22,
        });
        expect(sshContext.effectivePrompt).toContain('SSH into root@162.55.163.199');
    });

    test('resolveSshRequestContext does not treat an email address as an explicit SSH target override', () => {
        const sshContext = resolveSshRequestContext(
            'Please update the contact email to philly1084@gmail.com on the deployed site.',
            {
                metadata: {
                    lastToolIntent: 'remote-command',
                    lastSshTarget: {
                        host: '162.55.163.199',
                        username: 'root',
                        port: 22,
                    },
                    remoteWorkingState: {
                        lastUpdated: new Date().toISOString(),
                        target: {
                            host: '162.55.163.199',
                            username: 'root',
                            port: 22,
                        },
                        lastCommand: 'grep -R "support@" /opt/kimibuilt',
                    },
                },
            },
        );

        expect(sshContext.shouldTreatAsSsh).toBe(true);
        expect(sshContext.target).toEqual({
            host: '162.55.163.199',
            username: 'root',
            port: 22,
        });
        expect(sshContext.effectivePrompt).toContain('SSH into root@162.55.163.199');
        expect(sshContext.effectivePrompt).toContain('philly1084@gmail.com');
    });

    test('resolveSshRequestContext does not treat index.html as an SSH host override', () => {
        const sshContext = resolveSshRequestContext(
            'SSH into the server and replace the index.html with the 3D tic tac toe game on game.demoserver2.buzz.',
            {
                metadata: {
                    lastToolIntent: 'remote-command',
                    lastSshTarget: {
                        host: '162.55.163.199',
                        username: 'root',
                        port: 22,
                    },
                    remoteWorkingState: {
                        lastUpdated: new Date().toISOString(),
                        target: {
                            host: '162.55.163.199',
                            username: 'root',
                            port: 22,
                        },
                        lastCommand: 'kubectl get ingress -A',
                    },
                },
            },
        );

        expect(sshContext.target).toEqual({
            host: 'game.demoserver2.buzz',
            username: null,
            port: null,
        });
        expect(sshContext.effectivePrompt).toContain('index.html');
        expect(sshContext.effectivePrompt).not.toContain('index.html and');
    });

    test('extractSshSessionMetadataFromToolEvents keeps the last good host after a hostname-resolution failure on a bogus host', () => {
        const metadata = extractSshSessionMetadataFromToolEvents([
            {
                toolCall: {
                    function: {
                        name: 'remote-command',
                        arguments: JSON.stringify({
                            host: '162.55.163.199',
                            username: 'root',
                            port: 22,
                            command: 'hostname',
                        }),
                    },
                },
                result: {
                    success: true,
                    toolId: 'remote-command',
                    data: {
                        host: '162.55.163.199:22',
                        stdout: 'ubuntu-32gb-fsn1-2',
                        stderr: '',
                    },
                },
            },
            {
                toolCall: {
                    function: {
                        name: 'remote-command',
                        arguments: JSON.stringify({
                            host: 'web-fetch.body',
                            username: 'root',
                            port: 22,
                            command: 'kubectl rollout restart deployment/website',
                        }),
                    },
                },
                result: {
                    success: false,
                    toolId: 'remote-command',
                    error: 'ssh: Could not resolve hostname web-fetch.body: Name or service not known',
                    data: {},
                },
            },
        ]);

        expect(metadata).toMatchObject({
            lastToolIntent: 'remote-command',
            lastSshTarget: {
                host: '162.55.163.199',
                username: 'root',
                port: 22,
            },
        });
    });
});
