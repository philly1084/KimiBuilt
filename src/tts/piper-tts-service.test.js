const { normalizeTextForSpeech } = require('./piper-tts-service');

describe('normalizeTextForSpeech', () => {
    test('converts markdown into speech-friendly sentences', () => {
        const normalized = normalizeTextForSpeech(`
# Release plan

- Ship the API route
- Add the web chat button

\`\`\`js
console.log('hidden');
\`\`\`

Read the [docs](https://example.com/docs).
        `, 600);

        expect(normalized).toContain('Release plan.');
        expect(normalized).toContain('Ship the API route.');
        expect(normalized).toContain('Add the web chat button.');
        expect(normalized).toContain('Code example omitted.');
        expect(normalized).toContain('Read the docs.');
        expect(normalized).not.toContain('console.log');
    });

    test('keeps a fallback sentence when content is only code', () => {
        expect(normalizeTextForSpeech('```js\nconst hidden = true;\n```', 200))
            .toContain('Code example omitted.');
    });

    test('clamps long speech requests', () => {
        const normalized = normalizeTextForSpeech('A '.repeat(1000), 320);
        expect(normalized.length).toBeLessThanOrEqual(323);
        expect(normalized.endsWith('...')).toBe(true);
    });
});
