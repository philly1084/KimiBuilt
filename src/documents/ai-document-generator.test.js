const { AIDocumentGenerator } = require('./ai-document-generator');

function buildResponse(text) {
  return {
    output: [{
      type: 'message',
      content: [{ text }],
    }],
  };
}

describe('AIDocumentGenerator', () => {
  test('extracts JSON payloads from prose-wrapped responses', async () => {
    const generator = new AIDocumentGenerator({
      createResponse: jest.fn(async () => buildResponse(
        'Here is the document JSON:\n{"title":"Weekly Brief","sections":[{"heading":"Overview","content":"Clear summary","level":1}]}',
      )),
    });

    const result = await generator.generate('Create a weekly brief', {
      documentType: 'report',
    });

    expect(result.title).toBe('Weekly Brief');
    expect(result.sections[0]).toEqual(expect.objectContaining({
      heading: 'Overview',
      content: 'Clear summary',
    }));
  });

  test('falls back to plain-text document structure when the model does not return JSON', async () => {
    const generator = new AIDocumentGenerator({
      createResponse: jest.fn(async () => buildResponse(
        'The source brief highlights three shifts: ticket volume is rising, overnight SLA misses are concentrated in one queue, and the backlog is now trending down.',
      )),
    });

    const result = await generator.generate('Create a dashboard-style HTML based on the weekly technology brief', {
      format: 'html',
      designPlan: {
        titleSuggestion: 'Weekly Technology Brief Dashboard',
        themeSuggestion: 'executive',
        outline: [{ heading: 'Operations Snapshot' }],
      },
    });

    expect(result.title).toBe('Weekly Technology Brief Dashboard');
    expect(result.theme).toBe('executive');
    expect(result.sections[0]).toEqual(expect.objectContaining({
      heading: 'Operations Snapshot',
      content: expect.stringContaining('The source brief highlights three shifts'),
    }));
    expect(result.metadata.parseRecovery).toBe('plain-text-fallback');
  });
});
