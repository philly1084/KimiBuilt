const { TemplateEngine } = require('./template-engine');

describe('TemplateEngine', () => {
  test('treats null filters as an empty template query', () => {
    const engine = new TemplateEngine();

    expect(() => engine.getTemplates(null)).not.toThrow();
    expect(Array.isArray(engine.getTemplates(null))).toBe(true);
  });

  test('supports object-form template variables when building defaults', () => {
    const engine = new TemplateEngine();

    const defaults = engine.getDefaultVariables('presentation-image-heavy');

    expect(defaults).toEqual(expect.objectContaining({
      imageModel: 'dall-e-3',
    }));
  });

  test('returns normalized variable definitions for object-form templates', () => {
    const engine = new TemplateEngine();

    const variables = engine.getTemplateVariables('presentation-bullet-points');

    expect(variables).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'title', type: 'text' }),
      expect.objectContaining({ id: 'slides', type: 'array' }),
    ]));
  });
});
