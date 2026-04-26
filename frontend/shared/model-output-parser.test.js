const parser = require('./model-output-parser');

describe('model-output-parser', () => {
    test('unwraps common model response envelopes before markdown repair', () => {
        const normalized = parser.normalizeModelOutputMarkdown({
            model: 'example-model',
            result: '```json\n{"content":"<final>Summary | Item | Value | |---|---| | A | B |</final>","metadata":{"provider":"example"}}\n```',
        });

        expect(normalized).toContain('### Summary');
        expect(normalized).toContain('| Item | Value |');
        expect(normalized).toContain('| A | B |');
    });

    test('extracts OpenAI-style content parts', () => {
        const normalized = parser.normalizeModelOutputMarkdown({
            content: [
                { type: 'output_text', text: 'Why it works Crispy outside. --- Ingredients | Item | Quantity | |---|---| | Potatoes | 2 lbs |' },
            ],
        });

        expect(normalized).toContain('### Why it works');
        expect(normalized).toContain('### Ingredients');
        expect(normalized).toContain('| Potatoes | 2 lbs |');
    });

    test('keeps fenced code blocks intact while repairing surrounding prose', () => {
        const normalized = parser.normalizeModelOutputMarkdown('Summary: useful\n\n```js\nconst table = \"| not markdown |\";\n```\n\nIngredients | Item | Quantity | |---|---| | A | B |');

        expect(normalized).toContain('```js\nconst table = "| not markdown |";\n```');
        expect(normalized).toContain('### Ingredients');
        expect(normalized).toContain('| A | B |');
    });

    test('restores flattened html fences before preview rendering', () => {
        const normalized = parser.normalizeModelOutputMarkdown('Save this as `brief.html`.```html <!doctype html><html><head><title>Brief</title></head><body><main>Ready</main></body></html> ```');

        expect(normalized).toContain('```html\n<!doctype html>');
        expect(normalized).toContain('</html>\n```');
    });

    test('normalizes lightweight presentation markup outside code fences', () => {
        const normalized = parser.normalizeModelOutputMarkdown('This is ==important== and ::warning[check this].\n\n```md\n==literal== ::warning[literal]\n```');

        expect(normalized).toContain('<mark class="kb-highlight">important</mark>');
        expect(normalized).toContain('<span class="kb-tone kb-tone--warning">check this</span>');
        expect(normalized).toContain('```md\n==literal== ::warning[literal]\n```');
    });
});
