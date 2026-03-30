const {
  normalizeDocumentType,
  resolveDocumentBlueprint,
  renderBlueprintPrompt,
} = require('./document-design-blueprints');

describe('document design blueprints', () => {
  test('normalizes common aliases into canonical blueprint ids', () => {
    expect(normalizeDocumentType('Pitch Deck')).toBe('pitch-deck');
    expect(normalizeDocumentType('website slides')).toBe('website-slides');
    expect(normalizeDocumentType('analytics report')).toBe('data-story');
    expect(normalizeDocumentType('board brief')).toBe('executive-brief');
  });

  test('resolves data-story and website-slide blueprints with narrative guidance', () => {
    const dataStory = resolveDocumentBlueprint('data-story');
    const websiteSlides = resolveDocumentBlueprint('website-slides');

    expect(dataStory.requiredElements).toEqual(expect.arrayContaining([
      'Topline insight',
      'Chart-ready trend or comparison section with explicit series values',
    ]));
    expect(websiteSlides.structurePatterns).toEqual(expect.arrayContaining([
      'Each slide should behave like a strong website section with one dominant visual idea',
    ]));
  });

  test('renders blueprint prompts with structured sections', () => {
    const prompt = renderBlueprintPrompt(resolveDocumentBlueprint('pitch-deck'));

    expect(prompt).toContain('<design_blueprint id="pitch-deck">');
    expect(prompt).toContain('<required_elements>');
    expect(prompt).toContain('Problem or market tension');
    expect(prompt).toContain('<avoid>');
  });
});
