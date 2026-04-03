const {
  buildDocumentCreativityPacket,
  pickCreativeDirection,
  renderCreativityPromptContext,
} = require('./document-creativity');

describe('document-creativity', () => {
  test('captures recent creative history and warns against cloning the prior document shape', () => {
    const packet = buildDocumentCreativityPacket({
      prompt: 'Create a polished executive brief for Atlantic expansion.',
      documentType: 'executive-brief',
      format: 'pdf',
      existingContent: '## Overview\n## Details\n{{company_name}}\nPlaceholder copy here',
      session: {
        metadata: {
          projectMemory: {
            artifacts: [{
              id: 'artifact-1',
              filename: 'prior-brief.pdf',
              format: 'pdf',
              creativeDirection: 'Boardroom Brief',
              creativeDirectionId: 'boardroom-brief',
              themeSuggestion: 'executive',
            }],
          },
        },
      },
    });

    expect(packet.sampleSignals.hasTemplateScaffold).toBe(true);
    expect(packet.continuity.recentDirectionIds).toEqual(['boardroom-brief']);

    const promptContext = renderCreativityPromptContext(packet);
    expect(promptContext).toContain('Recent creative directions:');
    expect(promptContext).toContain('Boardroom Brief (executive)');
    expect(promptContext).toContain('do not clone the most recent document structure or section naming');
  });

  test('rotates away from the most recent creative direction when alternatives exist', () => {
    let prompt = '';

    for (let index = 0; index < 256; index += 1) {
      const candidate = `Create a polished executive brief for Atlantic expansion variation ${index}.`;
      const direction = pickCreativeDirection({
        prompt: candidate,
        documentType: 'executive-brief',
        format: 'pdf',
      });
      if (direction.id === 'boardroom-brief') {
        prompt = candidate;
        break;
      }
    }

    expect(prompt).toBeTruthy();

    const rotated = pickCreativeDirection({
      prompt,
      documentType: 'executive-brief',
      format: 'pdf',
      session: {
        metadata: {
          projectMemory: {
            artifacts: [{
              id: 'artifact-1',
              filename: 'prior-brief.pdf',
              format: 'pdf',
              creativeDirection: 'Boardroom Brief',
              creativeDirectionId: 'boardroom-brief',
              themeSuggestion: 'executive',
            }],
          },
        },
      },
    });

    expect(rotated.id).toBe('signal-journal');
  });
});
