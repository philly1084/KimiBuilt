jest.mock('./artifacts/artifact-service', () => ({
    artifactService: {
        buildPromptContext: jest.fn(),
        generateArtifact: jest.fn(),
    },
}));

const { artifactService } = require('./artifacts/artifact-service');
const {
    buildArtifactCompletionMessage,
    generateOutputArtifactFromPrompt,
    hasExplicitMermaidFileIntent,
    inferRequestedOutputFormat,
    inferOutputFormatFromSession,
    getPreferredRemoteToolId,
    resolveSshRequestContext,
    resolveArtifactContextIds,
    shouldSuppressImplicitMermaidArtifact,
} = require('./ai-route-utils');

describe('ai-route-utils', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('buildArtifactCompletionMessage formats friendly labels', () => {
        expect(buildArtifactCompletionMessage('pdf', { filename: 'space-zine.pdf' }))
            .toBe('Created the PDF artifact (space-zine.pdf).');
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

    test('hasExplicitMermaidFileIntent only returns true for file-like Mermaid requests', () => {
        expect(hasExplicitMermaidFileIntent('Create a Mermaid diagram for the auth flow')).toBe(false);
        expect(hasExplicitMermaidFileIntent('Export this as a Mermaid file')).toBe(true);
        expect(hasExplicitMermaidFileIntent('Share a .mmd artifact for this flow')).toBe(true);
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

    test('resolveArtifactContextIds does not attach the last generated artifact on unrelated turns', () => {
        expect(resolveArtifactContextIds({
            metadata: {
                lastGeneratedArtifactId: 'artifact-1',
            },
        }, [], 'deploy the site online and verify the public route')).toEqual([]);
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
});
