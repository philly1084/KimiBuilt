const {
  buildImageGenerationDiagnostics,
  formatImageDiagnosticsSummary,
} = require('./image-generation-diagnostics');

describe('image generation diagnostics', () => {
  test('prioritizes missing artifact persistence over frontend parsing when usable images are unpersisted', () => {
    const diagnostics = buildImageGenerationDiagnostics({
      route: 'agent-tool:image-generate',
      source: 'agent-tool',
      response: { data: [{ b64_json: 'abc123' }] },
      parsedImages: [{ b64_json: 'abc123' }],
      returnedImages: [{ b64_json: 'abc123' }],
      artifacts: [],
      requestedCount: 1,
      model: 'gpt-image-2',
      prompt: 'can you generate a cat image',
    });

    expect(diagnostics).toMatchObject({
      status: 'warning',
      code: 'backend_sent_usable_unpersisted_images',
      flags: expect.objectContaining({
        backendReturnedUsableImageRecords: true,
        artifactsPersisted: false,
        likelyArtifactPersistenceIssue: true,
        likelyFrontendReceiveOrParserIssue: false,
      }),
      counts: expect.objectContaining({
        parsedImageRecords: 1,
        returnedImageRecords: 1,
        usableReturnedImageRecords: 1,
        artifacts: 0,
      }),
    });

    expect(formatImageDiagnosticsSummary(diagnostics)).toContain(
      'no reusable artifact was persisted; inspect artifact persistence/image validation path',
    );
  });

  test('includes provider error response shape and upstream diagnostics from gateway errors', () => {
    const error = new Error('Provider returned no parseable image data.');
    error.status = 500;
    error.provider = 'gateway';
    error.baseURL = 'http://gateway.local/v1';
    error.providerResponse = {
      error: 'Provider returned no parseable image data.',
      diagnostics: {
        imageGeneration: {
          code: 'provider_response_not_parsable',
          stage: 'provider_response_parse',
          counts: {
            parsedImageRecords: 0,
          },
        },
      },
    };
    error.diagnostics = error.providerResponse.diagnostics;

    const diagnostics = buildImageGenerationDiagnostics({
      route: '/v1/images/generations',
      stage: 'route_error',
      source: 'backend-route',
      requestedCount: 1,
      model: 'gpt-image-2',
      prompt: 'cat',
      error,
    });

    expect(diagnostics).toMatchObject({
      code: 'provider_response_not_parsable',
      provider: expect.objectContaining({
        source: 'gateway',
        baseUrl: 'http://gateway.local/v1',
        status: 500,
      }),
      responseShape: expect.objectContaining({
        keys: expect.arrayContaining(['error', 'diagnostics']),
      }),
      upstreamDiagnostics: [
        expect.objectContaining({
          code: 'provider_response_not_parsable',
        }),
      ],
    });
  });
});
