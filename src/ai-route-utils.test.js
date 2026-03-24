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
    inferRequestedOutputFormat,
    inferOutputFormatFromSession,
    getPreferredRemoteToolId,
    resolveArtifactContextIds,
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

    test('resolveArtifactContextIds falls back to the last generated artifact', () => {
        expect(resolveArtifactContextIds({
            metadata: {
                lastGeneratedArtifactId: 'artifact-1',
            },
        }, [])).toEqual(['artifact-1']);
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
});
