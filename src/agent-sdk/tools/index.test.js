jest.mock('../../artifacts/artifact-service', () => ({
  artifactService: {
    generateArtifact: jest.fn(),
  },
}));

jest.mock('../../asset-manager', () => ({
  assetManager: {
    searchAssets: jest.fn(),
    upsertWorkspacePath: jest.fn(async () => null),
  },
}));

jest.mock('../../tts/piper-tts-service', () => ({
  piperTtsService: {
    synthesize: jest.fn(),
    getPublicConfig: jest.fn(() => ({
      configured: true,
      provider: 'piper',
      maxTextChars: 2400,
      defaultVoiceId: 'piper-female-natural',
      voices: [{
        id: 'piper-female-natural',
        label: 'Female natural',
        provider: 'piper',
      }],
    })),
  },
}));

jest.mock('../../generated-audio-artifacts', () => ({
  persistGeneratedAudio: jest.fn(),
}));

const { ToolManager } = require('./index');
const { artifactService } = require('../../artifacts/artifact-service');
const { assetManager } = require('../../asset-manager');
const { piperTtsService } = require('../../tts/piper-tts-service');
const { persistGeneratedAudio } = require('../../generated-audio-artifacts');
const { config } = require('../../config');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

describe('ToolManager image tools', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    artifactService.generateArtifact.mockReset();
    assetManager.searchAssets.mockReset();
    assetManager.upsertWorkspacePath.mockClear();
    piperTtsService.synthesize.mockReset();
    persistGeneratedAudio.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('registers restricted git and k3s deploy tools', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    expect(toolManager.getTool('git-safe')).toBeTruthy();
    expect(toolManager.getTool('k3s-deploy')).toBeTruthy();
    expect(toolManager.getTool('opencode-run')).toBeTruthy();
    expect(toolManager.getTool('agent-delegate')).toBeTruthy();
  });

  test('routes opencode-run through the injected OpenCode service', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const opencodeService = {
      createRun: jest.fn(),
      runTool: jest.fn(async () => ({
        async: false,
        runId: 'run-1',
        status: 'completed',
        workspacePath: '/srv/apps/kimibuilt',
        summary: 'Build fixed.',
      })),
    };

    const result = await toolManager.executeTool('opencode-run', {
      prompt: 'Fix the build in this repo.',
      workspacePath: '/srv/apps/kimibuilt',
      target: 'remote-default',
    }, {
      sessionId: 'session-1',
      ownerId: 'user-1',
      opencodeService,
    });

    expect(result.success).toBe(true);
    expect(opencodeService.runTool).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Fix the build in this repo.',
        workspacePath: '/srv/apps/kimibuilt',
        target: 'remote-default',
      }),
      expect.objectContaining({
        ownerId: 'user-1',
        sessionId: 'session-1',
      }),
    );
    expect(result.data.summary).toBe('Build fixed.');
  });

  test('normalizes markdown-wrapped image URLs before validation', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();
    global.fetch = jest.fn(async (url, options = {}) => ({
      ok: true,
      url,
      headers: {
        get: (name) => (String(name).toLowerCase() === 'content-type' ? 'image/jpeg' : null),
      },
      body: options.method === 'HEAD'
        ? null
        : {
          cancel: jest.fn(async () => {}),
        },
    }));

    const result = await toolManager.executeTool('image-from-url', {
      url: '![Hero image](https://images.unsplash.com/photo-12345?fit=crop&w=1200).',
    });

    expect(result.success).toBe(true);
    expect(result.data.image.url).toBe('https://images.unsplash.com/photo-12345?fit=crop&w=1200');
    expect(result.data.image.verified).toBe(true);
    expect(result.data.markdownImage).toContain('https://images.unsplash.com/photo-12345?fit=crop&w=1200');
  });

  test('verifies and normalizes batches of direct image urls', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();
    global.fetch = jest.fn(async (url, options = {}) => ({
      ok: true,
      url,
      headers: {
        get: (name) => (String(name).toLowerCase() === 'content-type' ? 'image/png' : null),
      },
      body: options.method === 'HEAD'
        ? null
        : {
          cancel: jest.fn(async () => {}),
        },
    }));

    const result = await toolManager.executeTool('image-from-url', {
      urls: [
        'https://cdn.example.com/photo-one',
        'https://cdn.example.com/photo-two',
      ],
    });

    expect(result.success).toBe(true);
    expect(result.data.verifiedCount).toBe(2);
    expect(result.data.images).toHaveLength(2);
    expect(result.data.markdownImages).toHaveLength(2);
    expect(result.data.rejected).toEqual([]);
  });

  test('accepts file-write content aliases and writes the file body', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kimibuilt-file-write-'));
    try {
      const targetPath = path.join(tempDir, 'sample.html');

      const result = await toolManager.executeTool('file-write', {
        path: targetPath,
        html: '<!DOCTYPE html><html><body><h1>Hello</h1></body></html>',
      });

      const written = await fs.readFile(targetPath, 'utf8');

      expect(result.success).toBe(true);
      expect(result.data.path).toBe(targetPath);
      expect(written).toContain('<h1>Hello</h1>');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('returns a helpful error when file-write is called without content', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const result = await toolManager.executeTool('file-write', {
      path: 'missing-content.txt',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('file-write requires a `content` string');
  });

  test('searches indexed assets through asset-search', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    assetManager.searchAssets.mockResolvedValue({
      query: 'pricing pdf',
      count: 1,
      results: [
        {
          id: 'artifact:report-1',
          sourceType: 'artifact',
          kind: 'document',
          filename: 'pricing-report.pdf',
          artifactId: 'report-1',
          downloadUrl: '/api/artifacts/report-1/download',
        },
      ],
    });

    const result = await toolManager.executeTool('asset-search', {
      query: 'pricing pdf',
      kind: 'document',
      includeContent: true,
    }, {
      ownerId: 'phill',
      sessionId: 'session-1',
    });

    expect(result.success).toBe(true);
    expect(assetManager.searchAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'pricing pdf',
        kind: 'document',
        includeContent: true,
      }),
      expect.objectContaining({
        ownerId: 'phill',
        sessionId: 'session-1',
      }),
    );
    expect(result.data.results[0].filename).toBe('pricing-report.pdf');
  });

  test('synthesizes speech with Piper and persists the audio into the active session', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    piperTtsService.synthesize.mockResolvedValue({
      audioBuffer: Buffer.from('RIFF-test-audio'),
      contentType: 'audio/wav',
      text: 'Read this status update aloud.',
      voice: {
        id: 'piper-female-natural',
        label: 'Female natural',
        provider: 'piper',
      },
    });
    persistGeneratedAudio.mockResolvedValue({
      artifact: {
        id: 'artifact-audio-1',
        filename: 'status-update.wav',
        mimeType: 'audio/wav',
        downloadUrl: '/api/artifacts/artifact-audio-1/download',
      },
      audio: {
        artifactId: 'artifact-audio-1',
        downloadUrl: '/api/artifacts/artifact-audio-1/download',
        inlinePath: '/api/artifacts/artifact-audio-1/download?inline=1',
      },
      artifactIds: ['artifact-audio-1'],
    });

    const result = await toolManager.executeTool('speech-generate', {
      text: 'Read this status update aloud.',
      title: 'Status update',
    }, {
      sessionId: 'session-1',
      clientSurface: 'chat',
    });

    expect(result.success).toBe(true);
    expect(piperTtsService.synthesize).toHaveBeenCalledWith({
      text: 'Read this status update aloud.',
      voiceId: '',
    });
    expect(persistGeneratedAudio).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      sourceMode: 'chat',
      text: 'Read this status update aloud.',
      title: 'Status update',
      provider: 'piper',
      mimeType: 'audio/wav',
      metadata: expect.objectContaining({
        requestedText: 'Read this status update aloud.',
        createdByAgentTool: true,
      }),
    }));
    expect(result.data).toEqual(expect.objectContaining({
      provider: 'piper',
      contentType: 'audio/wav',
      artifactIds: ['artifact-audio-1'],
      audio: expect.objectContaining({
        inlinePath: '/api/artifacts/artifact-audio-1/download?inline=1',
      }),
    }));
  });

  test('writes durable carryover notes through agent-notes-write and enforces the character limit', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kimibuilt-agent-notes-tool-'));
    const originalPath = process.env.KIMIBUILT_AGENT_NOTES_PATH;
    process.env.KIMIBUILT_AGENT_NOTES_PATH = path.join(tempDir, 'agent-notes.md');

    try {
      const success = await toolManager.executeTool('agent-notes-write', {
        content: '# Carryover Notes\n- Phil prefers concise diffs.\n',
        reason: 'Useful collaboration detail for future sessions.',
      });

      expect(success.success).toBe(true);
      expect(success.data.filePath).toContain('agent-notes.md');
      expect(await fs.readFile(process.env.KIMIBUILT_AGENT_NOTES_PATH, 'utf8')).toBe('# Carryover Notes\n- Phil prefers concise diffs.\n');

      const failure = await toolManager.executeTool('agent-notes-write', {
        content: 'x'.repeat(5000),
      });

      expect(failure.success).toBe(false);
      expect(failure.error).toContain('agent-notes.md cannot exceed');
    } finally {
      if (originalPath === undefined) {
        delete process.env.KIMIBUILT_AGENT_NOTES_PATH;
      } else {
        process.env.KIMIBUILT_AGENT_NOTES_PATH = originalPath;
      }
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('recommends a document workflow through the document-workflow tool', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const documentService = {
      recommendDocumentWorkflow: jest.fn(() => ({
        inferredType: 'website-slides',
        recommendedFormat: 'html',
        blueprint: { label: 'Website Slides' },
      })),
      buildDocumentPlan: jest.fn(),
      aiGenerate: jest.fn(),
      assemble: jest.fn(),
      generatePresentation: jest.fn(),
    };

    const result = await toolManager.executeTool('document-workflow', {
      action: 'recommend',
      prompt: 'Research vacation pricing and build website slides I can review.',
    }, {
      documentService,
    });

    expect(result.success).toBe(true);
    expect(documentService.recommendDocumentWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Research vacation pricing and build website slides I can review.',
    }));
    expect(result.data.recommendation).toEqual(expect.objectContaining({
      inferredType: 'website-slides',
      recommendedFormat: 'html',
    }));
  });

  test('generates grounded html content from source material through document-workflow', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const documentService = {
      recommendDocumentWorkflow: jest.fn(() => ({
        inferredType: 'document',
        recommendedFormat: 'html',
        blueprint: { label: 'Executive Brief' },
      })),
      buildDocumentPlan: jest.fn(),
      aiGenerate: jest.fn(async (prompt) => ({
        id: 'doc-1',
        filename: 'vacation-pricing.html',
        mimeType: 'text/html',
        content: '<!DOCTYPE html><html><body><h1>Vacation Pricing</h1></body></html>',
        contentBuffer: Buffer.from('<!DOCTYPE html><html><body><h1>Vacation Pricing</h1></body></html>'),
        metadata: { format: 'html' },
        downloadUrl: '/api/documents/doc-1/download',
      })),
      assemble: jest.fn(),
      generatePresentation: jest.fn(),
    };

    const result = await toolManager.executeTool('document-workflow', {
      action: 'generate',
      prompt: 'Create a vacation pricing summary page.',
      format: 'html',
      includeContent: true,
      sources: [
        {
          title: 'Sample pricing',
          sourceUrl: 'https://travel.example.com/packages',
          content: 'Weekend package: $799. Flights from Halifax start at $214.',
        },
      ],
    }, {
      documentService,
      model: 'gpt-5.4-mini',
    });

    expect(result.success).toBe(true);
    expect(documentService.aiGenerate).toHaveBeenCalledWith(
      expect.stringContaining('Do not ask the user to supply website lists or source URLs'),
      expect.objectContaining({
        format: 'html',
        model: 'gpt-5.4-mini',
      }),
    );
    expect(documentService.aiGenerate).toHaveBeenCalledWith(
      expect.stringContaining('Weekend package: $799. Flights from Halifax start at $214.'),
      expect.any(Object),
    );
    expect(result.data.document).toEqual(expect.objectContaining({
      filename: 'vacation-pricing.html',
      downloadUrl: '/api/documents/doc-1/download',
      content: expect.stringContaining('<h1>Vacation Pricing</h1>'),
    }));
  });

  test('generates presentations from structured slide payloads through document-workflow', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const documentService = {
      recommendDocumentWorkflow: jest.fn(() => ({
        inferredType: 'presentation',
        recommendedFormat: 'pptx',
        blueprint: { label: 'Presentation' },
      })),
      buildDocumentPlan: jest.fn(),
      aiGenerate: jest.fn(),
      assemble: jest.fn(),
      generatePresentation: jest.fn(async () => ({
        id: 'deck-structured-1',
        filename: 'structured-deck.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        metadata: { slideCount: 2 },
        downloadUrl: '/api/documents/deck-structured-1/download',
      })),
    };

    const result = await toolManager.executeTool('document-workflow', {
      action: 'generate',
      documentType: 'presentation',
      format: 'pptx',
      generateImages: false,
      presentation: {
        title: 'Structured Deck',
        theme: 'executive',
        slides: [
          { layout: 'title', title: 'Structured Deck' },
          { layout: 'image', title: 'Hero', imageUrl: 'https://images.example.com/hero.jpg' },
        ],
      },
    }, {
      documentService,
      model: 'gpt-5.4-mini',
    });

    expect(result.success).toBe(true);
    expect(documentService.generatePresentation).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Structured Deck',
        slides: expect.arrayContaining([
          expect.objectContaining({
            imageUrl: 'https://images.example.com/hero.jpg',
          }),
        ]),
      }),
      expect.objectContaining({
        format: 'pptx',
        model: 'gpt-5.4-mini',
        generateImages: false,
      }),
    );
    expect(result.data.document).toEqual(expect.objectContaining({
      filename: 'structured-deck.pptx',
      downloadUrl: '/api/documents/deck-structured-1/download',
    }));
  });

  test('routes dashboard html generation through the artifact pipeline inside document-workflow', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const documentService = {
      recommendDocumentWorkflow: jest.fn(() => ({
        inferredType: 'document',
        recommendedFormat: 'html',
        blueprint: { label: 'Executive Brief' },
      })),
      buildDocumentPlan: jest.fn(),
      aiGenerate: jest.fn(),
      assemble: jest.fn(),
      generatePresentation: jest.fn(),
    };

    artifactService.generateArtifact.mockResolvedValue({
      artifact: {
        id: 'artifact-1',
        filename: 'support-ops-dashboard.html',
        mimeType: 'text/html',
        sizeBytes: 2048,
        downloadUrl: '/api/artifacts/artifact-1/download',
        preview: {
          type: 'html',
          content: '<!DOCTYPE html><html><body data-dashboard-template="admin-control-room"></body></html>',
        },
        metadata: {
          dashboardTemplateSuggestedPrimaryId: 'admin-control-room',
        },
      },
      outputText: '<!DOCTYPE html><html><body data-dashboard-template="admin-control-room"></body></html>',
    });

    const result = await toolManager.executeTool('document-workflow', {
      action: 'generate',
      prompt: 'Create a dashboard-style HTML for support operations.',
      format: 'html',
      includeContent: true,
      sources: [
        {
          title: 'Weekly technology brief',
          content: 'Ticket volume is up 18%. SLA misses concentrated in the overnight queue.',
        },
      ],
    }, {
      sessionId: 'session-1',
      documentService,
      model: 'gpt-5.4-mini',
    });

    expect(result.success).toBe(true);
    expect(artifactService.generateArtifact).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      format: 'html',
      prompt: expect.stringContaining('Ticket volume is up 18%'),
    }));
    expect(documentService.aiGenerate).not.toHaveBeenCalled();
    expect(result.data.document).toEqual(expect.objectContaining({
      filename: 'support-ops-dashboard.html',
      downloadUrl: '/api/artifacts/artifact-1/download',
      content: expect.stringContaining('data-dashboard-template'),
    }));
  });

  test('generates a research-backed presentation through the deep research workflow tool', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const nestedToolManager = {
      executeTool: jest.fn(async (id, params) => {
        if (id === 'document-workflow' && params.action === 'recommend') {
          return {
            success: true,
            data: {
              recommendation: {
                inferredType: 'presentation',
                recommendedFormat: 'pptx',
                blueprint: { label: 'Presentation' },
              },
            },
          };
        }

        if (id === 'document-workflow' && params.action === 'plan') {
          return {
            success: true,
            data: {
              plan: {
                titleSuggestion: 'Halifax Travel Pricing',
                themeSuggestion: 'executive',
                outline: [
                  { title: 'Title Slide' },
                  { title: 'Pricing Snapshot' },
                ],
              },
            },
          };
        }

        if (id === 'web-search') {
          return {
            success: true,
            data: {
              totalResults: 1,
              results: [{
                title: 'Nova Scotia Travel Packages',
                url: 'https://travel.example.com/packages',
                source: 'travel.example.com',
              }],
            },
          };
        }

        if (id === 'web-fetch') {
          return {
            success: true,
            data: {
              url: 'https://travel.example.com/packages',
              title: 'Nova Scotia Travel Packages',
              body: '<main>Weekend package: $799. Flights from Halifax start at $214.</main>',
            },
          };
        }

        if (id === 'image-search-unsplash') {
          return {
            success: true,
            data: {
              images: [{
                url: 'https://images.example.com/halifax.jpg',
                alt: 'Halifax waterfront',
                author: 'Jane Doe',
              }],
            },
          };
        }

        if (id === 'image-from-url') {
          return {
            success: true,
            data: {
              image: {
                url: params.url,
                alt: params.alt,
                host: 'images.example.com',
                mimeType: 'image/jpeg',
                verified: true,
                verificationMethod: 'GET',
              },
            },
          };
        }

        if (id === 'document-workflow' && params.action === 'generate') {
          return {
            success: true,
            data: {
              document: {
                id: 'deck-1',
                filename: 'halifax-travel-pricing.pptx',
                mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                downloadUrl: '/api/documents/deck-1/download',
              },
            },
          };
        }

        throw new Error(`Unexpected nested tool call: ${id}`);
      }),
    };

    const documentService = {
      recommendDocumentWorkflow: jest.fn(),
      buildDocumentPlan: jest.fn(),
      aiGenerate: jest.fn(),
      assemble: jest.fn(),
      generatePresentation: jest.fn(),
      inferSlideCount: jest.fn(() => 6),
      aiGenerator: {
        generatePresentationContent: jest.fn(async () => ({
          title: 'Halifax Travel Pricing',
          subtitle: 'Research-backed deck',
          theme: 'executive',
          slides: [
            { layout: 'title', title: 'Halifax Travel Pricing', subtitle: 'Research-backed deck' },
            {
              layout: 'image',
              title: 'Pricing Snapshot',
              imagePrompt: 'Halifax waterfront travel hero image',
              bullets: ['Weekend package: $799', 'Flights from Halifax start at $214'],
            },
          ],
        })),
      },
    };

    const result = await toolManager.executeTool('deep-research-presentation', {
      prompt: 'Research vacation pricing in Halifax and build a slide deck I can review.',
      researchPasses: 1,
      imageLimit: 1,
      imageSettleDelayMs: 1,
    }, {
      documentService,
      toolManager: nestedToolManager,
      model: 'gpt-5.4-mini',
    });

    expect(result.success).toBe(true);
    expect(documentService.aiGenerator.generatePresentationContent).toHaveBeenCalledWith(
      expect.stringContaining('Do not ask the user to supply website lists or source URLs'),
      expect.objectContaining({
        documentType: 'presentation',
        model: 'gpt-5.4-mini',
      }),
    );
    expect(documentService.aiGenerator.generatePresentationContent).toHaveBeenCalledWith(
      expect.stringContaining('Weekend package: $799'),
      expect.any(Object),
    );

    expect(nestedToolManager.executeTool.mock.calls.map(([id]) => id)).toEqual([
      'document-workflow',
      'document-workflow',
      'web-search',
      'web-fetch',
      'image-search-unsplash',
      'image-from-url',
      'document-workflow',
    ]);

    const webSearchCall = nestedToolManager.executeTool.mock.calls.find(([id]) => id === 'web-search');
    expect(webSearchCall?.[1]).toEqual(expect.objectContaining({
      limit: Math.min(config.memory.researchSearchLimit, config.search.maxLimit),
      engine: 'perplexity',
      researchMode: 'deep-research',
    }));

    const finalGenerateCall = nestedToolManager.executeTool.mock.calls.find(([id, params]) => (
      id === 'document-workflow' && params.action === 'generate'
    ));
    expect(finalGenerateCall?.[1]).toEqual(expect.objectContaining({
      presentation: expect.objectContaining({
        slides: expect.arrayContaining([
          expect.objectContaining({
            imageUrl: 'https://images.example.com/halifax.jpg',
            imageSource: 'Jane Doe / Unsplash',
          }),
        ]),
      }),
      sources: expect.arrayContaining([
        expect.objectContaining({
          sourceUrl: 'https://travel.example.com/packages',
          kind: 'web-fetch',
          content: expect.stringContaining('Weekend package: $799'),
        }),
      ]),
    }));
    expect(result.data.document).toEqual(expect.objectContaining({
      filename: 'halifax-travel-pricing.pptx',
      downloadUrl: '/api/documents/deck-1/download',
    }));
  });

  test('refines later deep research passes from stored research-note keywords', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const nestedToolManager = {
      executeTool: jest.fn(async (id, params) => {
        if (id === 'document-workflow' && params.action === 'recommend') {
          return {
            success: true,
            data: {
              recommendation: {
                inferredType: 'presentation',
                recommendedFormat: 'pptx',
              },
            },
          };
        }

        if (id === 'document-workflow' && params.action === 'plan') {
          return {
            success: true,
            data: {
              plan: {
                titleSuggestion: 'Halifax Travel Pricing',
                outline: [
                  { title: 'Title Slide' },
                  { title: 'Pricing Snapshot' },
                ],
              },
            },
          };
        }

        if (id === 'web-search') {
          return {
            success: true,
            data: {
              totalResults: 1,
              results: [{
                title: 'Nova Scotia Travel Packages',
                url: 'https://travel.example.com/packages',
                source: 'travel.example.com',
              }],
            },
          };
        }

        if (id === 'web-fetch') {
          return {
            success: true,
            data: {
              url: 'https://travel.example.com/packages',
              title: 'Nova Scotia Travel Packages',
              body: '<main>Weekend package pricing is $799 and flight costs start at $214.</main>',
            },
          };
        }

        if (id === 'image-search-unsplash') {
          return {
            success: true,
            data: {
              images: [],
            },
          };
        }

        if (id === 'document-workflow' && params.action === 'generate') {
          return {
            success: true,
            data: {
              document: {
                id: 'deck-2',
                filename: 'halifax-research-pass.pptx',
                mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                downloadUrl: '/api/documents/deck-2/download',
              },
            },
          };
        }

        throw new Error(`Unexpected nested tool call: ${id}`);
      }),
    };

    const memoryService = {
      rememberResearchNote: jest.fn().mockResolvedValue('note-1'),
      recallDetailed: jest.fn().mockResolvedValue({
        entries: [
          {
            text: 'Weekend package pricing and flight costs for Halifax travel.',
            metadata: {
              keywords: ['weekend package', 'flight costs', 'halifax travel'],
            },
          },
        ],
      }),
    };

    const documentService = {
      recommendDocumentWorkflow: jest.fn(),
      buildDocumentPlan: jest.fn(),
      aiGenerate: jest.fn(),
      assemble: jest.fn(),
      generatePresentation: jest.fn(),
      inferSlideCount: jest.fn(() => 6),
      aiGenerator: {
        generatePresentationContent: jest.fn(async () => ({
          title: 'Halifax Travel Pricing',
          slides: [
            { layout: 'title', title: 'Halifax Travel Pricing' },
          ],
        })),
      },
    };

    const result = await toolManager.executeTool('deep-research-presentation', {
      prompt: 'Research vacation pricing in Halifax and build a slide deck I can review.',
      researchPasses: 2,
      imageLimit: 0,
    }, {
      documentService,
      toolManager: nestedToolManager,
      memoryService,
      sessionId: 'session-1',
      memoryScope: 'web-chat',
    });

    expect(result.success).toBe(true);
    expect(memoryService.rememberResearchNote).toHaveBeenCalled();
    expect(memoryService.recallDetailed).toHaveBeenCalledWith(
      'Research vacation pricing in Halifax and build a slide deck I can review.',
      expect.objectContaining({
        sessionId: 'session-1',
        memoryScope: 'web-chat',
        profile: 'research',
      }),
    );

    const webSearchCalls = nestedToolManager.executeTool.mock.calls.filter(([id]) => id === 'web-search');
    expect(webSearchCalls).toHaveLength(2);
    expect(webSearchCalls[1][1].query).toContain('weekend package');
  });

  test('creates a workload from structured cron fields when request is omitted', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const createWorkload = jest.fn(async (payload) => ({
      id: 'workload-1',
      ...payload,
    }));

    const result = await toolManager.executeTool('agent-workload', {
      action: 'create_from_scenario',
      prompt: 'summarize blockers from this conversation',
      trigger: {
        type: 'cron',
        expression: '5 23 * * *',
        timezone: 'America/Halifax',
      },
    }, {
      ownerId: 'user-1',
      sessionId: 'session-1',
      timezone: 'America/Halifax',
      workloadService: {
        isAvailable: () => true,
        createWorkload,
      },
    });

    expect(result.success).toBe(true);
    expect(createWorkload).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      title: 'Summarize Blockers From This Conversation',
      prompt: 'summarize blockers from this conversation',
      trigger: {
        type: 'cron',
        expression: '5 23 * * *',
        timezone: 'America/Halifax',
      },
      metadata: expect.objectContaining({
        createdFromScenario: true,
        scenarioRequest: 'summarize blockers from this conversation',
      }),
    }), 'user-1');
    expect(result.data.message).toContain('Every day at 11:05 PM');
  });

  test('routes sub-agent spawning through the workload service with the caller model', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const spawnSubAgents = jest.fn(async () => ({
      orchestrationId: 'subagent-1',
      taskCount: 2,
      requestedModel: 'gpt-5.4',
      tasks: [
        { workloadId: 'w1', runId: 'r1', title: 'Research facts', status: 'queued' },
        { workloadId: 'w2', runId: 'r2', title: 'Build html', status: 'queued' },
      ],
    }));

    const result = await toolManager.executeTool('agent-delegate', {
      action: 'spawn',
      title: 'Parallel batch',
      tasks: [{
        title: 'Research facts',
        prompt: 'Research the topic and save the findings.',
        writeTargets: ['notes/research.md'],
      }, {
        title: 'Build html',
        prompt: 'Create the html output file.',
        writeTargets: ['frontend/index.html'],
      }],
    }, {
      ownerId: 'user-1',
      sessionId: 'session-1',
      model: 'gpt-5.4',
      workloadService: {
        isAvailable: () => true,
        spawnSubAgents,
      },
    });

    expect(result.success).toBe(true);
    expect(spawnSubAgents).toHaveBeenCalledWith(expect.objectContaining({
      action: 'spawn',
      title: 'Parallel batch',
      tasks: expect.arrayContaining([
        expect.objectContaining({ title: 'Research facts' }),
        expect.objectContaining({ title: 'Build html' }),
      ]),
    }), 'user-1', expect.objectContaining({
      sessionId: 'session-1',
      model: 'gpt-5.4',
      subAgentDepth: 0,
    }));
    expect(result.data.message).toContain('Queued 2 sub-agent tasks');
  });

  test('returns sub-agent orchestration status through the workload service', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const getSubAgentOrchestration = jest.fn(async () => ({
      orchestrationId: 'subagent-1',
      title: 'Parallel batch',
      counts: {
        total: 2,
        active: 1,
        queued: 0,
        running: 1,
        completed: 1,
        failed: 0,
        cancelled: 0,
        idle: 0,
      },
      tasks: [
        { workloadId: 'w1', title: 'Research facts', status: 'completed' },
        { workloadId: 'w2', title: 'Build html', status: 'running' },
      ],
    }));

    const result = await toolManager.executeTool('agent-delegate', {
      action: 'status',
      orchestrationId: 'subagent-1',
    }, {
      ownerId: 'user-1',
      sessionId: 'session-1',
      workloadService: {
        isAvailable: () => true,
        getSubAgentOrchestration,
      },
    });

    expect(result.success).toBe(true);
    expect(getSubAgentOrchestration).toHaveBeenCalledWith('subagent-1', 'user-1', 'session-1');
    expect(result.data.orchestration.counts.running).toBe(1);
  });

  test('infers a cron trigger for create when the prompt still contains schedule text', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const createWorkload = jest.fn(async (payload) => ({
      id: 'workload-2',
      ...payload,
    }));

    const result = await toolManager.executeTool('agent-workload', {
      action: 'create',
      prompt: 'Every weekday at 8:30 AM review the latest repo activity and summarize blockers.',
    }, {
      ownerId: 'user-1',
      sessionId: 'session-1',
      timezone: 'America/Halifax',
      workloadService: {
        isAvailable: () => true,
        createWorkload,
      },
    });

    expect(result.success).toBe(true);
    expect(createWorkload).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      title: 'Review The Latest Repo Activity',
      prompt: 'Every weekday at 8:30 AM review the latest repo activity and summarize blockers.',
      trigger: {
        type: 'cron',
        expression: '30 8 * * 1-5',
        timezone: 'America/Halifax',
      },
      metadata: expect.objectContaining({
        createdFromScenario: true,
        scenarioRequest: 'Every weekday at 8:30 AM review the latest repo activity and summarize blockers.',
      }),
    }), 'user-1');
    expect(result.data.message).toContain('Every weekday at 8:30 AM');
  });

  test('extracts a structured remote execution from a scheduled server command request', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const createWorkload = jest.fn(async (payload) => ({
      id: 'workload-remote-1',
      ...payload,
    }));

    const result = await toolManager.executeTool('agent-workload', {
      action: 'create_from_scenario',
      request: 'Run `date` on the server in 5 minutes.',
      timezone: 'UTC',
    }, {
      ownerId: 'user-1',
      sessionId: 'session-1',
      timezone: 'UTC',
      now: '2026-04-02T09:00:00.000Z',
      workloadService: {
        isAvailable: () => true,
        createWorkload,
        sessionStore: {
          getOwned: jest.fn(async () => ({
            id: 'session-1',
            metadata: {
              lastSshTarget: {
                host: '10.0.0.5',
                username: 'ubuntu',
                port: 22,
              },
            },
          })),
        },
      },
    });

    expect(result.success).toBe(true);
    expect(createWorkload).toHaveBeenCalledWith(expect.objectContaining({
      execution: {
        tool: 'remote-command',
        params: {
          host: '10.0.0.5',
          username: 'ubuntu',
          port: 22,
          command: 'date',
        },
      },
      trigger: expect.objectContaining({
        type: 'once',
        runAt: '2026-04-02T09:05:00.000Z',
      }),
    }), 'user-1');
  });

  test('canonicalizes malformed remote command workload params into a scheduled structured create', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const createWorkload = jest.fn(async (payload) => ({
      id: 'workload-remote-2',
      ...payload,
    }));

    const result = await toolManager.executeTool('agent-workload', {
      action: 'create_from_scenario',
      command: 'date',
      schedule: 'in 5 minutes',
      title: 'Check remote time',
      tool: 'remote-command',
    }, {
      ownerId: 'user-1',
      sessionId: 'session-1',
      timezone: 'UTC',
      now: '2026-04-02T09:00:00.000Z',
      workloadService: {
        isAvailable: () => true,
        createWorkload,
        sessionStore: {
          getOwned: jest.fn(async () => ({
            id: 'session-1',
            metadata: {
              lastSshTarget: {
                host: '10.0.0.5',
                username: 'ubuntu',
                port: 22,
              },
            },
          })),
        },
      },
    });

    expect(result.success).toBe(true);
    expect(createWorkload).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Check remote time',
      trigger: {
        type: 'once',
        runAt: '2026-04-02T09:05:00.000Z',
      },
      execution: {
        tool: 'remote-command',
        params: {
          host: '10.0.0.5',
          username: 'ubuntu',
          port: 22,
          command: 'date',
        },
      },
      metadata: expect.objectContaining({
        createdFromScenario: true,
        scenarioRequest: 'Run `date` on the server in 5 minutes',
      }),
    }), 'user-1');
  });

  test('reconstructs a fragmented scheduled workload request from recent transcript context', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const createWorkload = jest.fn(async (payload) => ({
      id: 'workload-fragmented-1',
      ...payload,
    }));

    const result = await toolManager.executeTool('agent-workload', {
      action: 'create_from_scenario',
      request: 'run it five minutes from now',
    }, {
      ownerId: 'user-1',
      sessionId: 'session-1',
      timezone: 'UTC',
      now: '2026-04-02T09:00:00.000Z',
      recentMessages: [
        { role: 'user', content: 'gather information on the k3s cluster on the server' },
      ],
      workloadService: {
        isAvailable: () => true,
        createWorkload,
      },
    });

    expect(result.success).toBe(true);
    expect(createWorkload).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('gather information on the k3s cluster on the server'),
      trigger: {
        type: 'once',
        runAt: '2026-04-02T09:05:00.000Z',
      },
      metadata: expect.objectContaining({
        createdFromScenario: true,
        scenarioRequest: expect.stringContaining('gather information on the k3s cluster on the server'),
      }),
    }), 'user-1');
  });

  test('persists the caller model on created workloads so deferred runs can reuse it', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const createWorkload = jest.fn(async (payload) => ({
      id: 'workload-model-1',
      ...payload,
    }));

    const result = await toolManager.executeTool('agent-workload', {
      action: 'create_from_scenario',
      request: 'Run `date` on the server in 5 minutes.',
    }, {
      ownerId: 'user-1',
      sessionId: 'session-1',
      timezone: 'UTC',
      now: '2026-04-02T09:00:00.000Z',
      model: 'gpt-5.3-instant',
      workloadService: {
        isAvailable: () => true,
        createWorkload,
      },
    });

    expect(result.success).toBe(true);
    expect(createWorkload).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        requestedModel: 'gpt-5.3-instant',
      }),
    }), 'user-1');
  });

  test('rejects ambiguous scenario requests instead of silently creating a manual workload', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const createWorkload = jest.fn(async (payload) => ({
      id: 'workload-3',
      ...payload,
    }));

    const result = await toolManager.executeTool('agent-workload', {
      action: 'create_from_scenario',
      request: 'Can you run one that',
    }, {
      ownerId: 'user-1',
      sessionId: 'session-1',
      timezone: 'America/Halifax',
      workloadService: {
        isAvailable: () => true,
        createWorkload,
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('explicit manual request');
    expect(createWorkload).not.toHaveBeenCalled();
  });

  test('returns project plans through the workload tool', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const getProjectPlan = jest.fn(async () => ({
      title: 'Long project',
      milestones: [{ id: 'm1', title: 'Approve the rollout plan' }],
    }));

    const result = await toolManager.executeTool('agent-workload', {
      action: 'get_project',
      workloadId: 'workload-1',
    }, {
      ownerId: 'user-1',
      sessionId: 'session-1',
      workloadService: {
        isAvailable: () => true,
        getProjectPlan,
      },
    });

    expect(result.success).toBe(true);
    expect(getProjectPlan).toHaveBeenCalledWith('workload-1', 'user-1');
    expect(result.data.project.title).toBe('Long project');
  });

  test('updates project plans through the workload tool', async () => {
    const toolManager = new ToolManager();
    await toolManager.initialize();

    const updateProjectPlan = jest.fn(async () => ({
      workload: { id: 'workload-1' },
      project: {
        title: 'Long project',
        milestones: [{ id: 'm1', title: 'Approve the rollout plan', status: 'completed' }],
      },
    }));

    const result = await toolManager.executeTool('agent-workload', {
      action: 'update_project',
      workloadId: 'workload-1',
      project: {
        milestones: [{ id: 'm1', title: 'Approve the rollout plan', status: 'completed' }],
      },
      changeReason: {
        type: 'status_update',
        summary: 'Marked the milestone complete.',
      },
    }, {
      ownerId: 'user-1',
      sessionId: 'session-1',
      workloadService: {
        isAvailable: () => true,
        updateProjectPlan,
      },
    });

    expect(result.success).toBe(true);
    expect(updateProjectPlan).toHaveBeenCalledWith(
      'workload-1',
      'user-1',
      expect.objectContaining({
        milestones: [expect.objectContaining({ status: 'completed' })],
      }),
      expect.objectContaining({
        changeReason: expect.objectContaining({
          type: 'status_update',
        }),
      }),
    );
  });
});
