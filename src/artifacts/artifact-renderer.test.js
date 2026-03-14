const { normalizeMermaidSource, ensureHtmlDocument, extractCompositeDocumentParts } = require('./artifact-renderer');

describe('normalizeMermaidSource', () => {
    test('splits collapsed flowchart statements onto separate lines', () => {
        const input = 'flowchart LR    A[Kitten<br/>0-6 months] --> B[Junior<br/>6 months - 2 years]    B --> C[Prime<br/>3-6 years]    C --> D[Mature<br/>7-10 years]    D --> E[Senior<br/>11-14 years]    E --> F[Geriatric<br/>15+ years]    style A fill:#FFB6C1    style B fill:#FFD700';

        expect(normalizeMermaidSource(input)).toBe([
            'flowchart LR',
            'A[Kitten<br/>0-6 months] --> B[Junior<br/>6 months - 2 years]',
            'B --> C[Prime<br/>3-6 years]',
            'C --> D[Mature<br/>7-10 years]',
            'D --> E[Senior<br/>11-14 years]',
            'E --> F[Geriatric<br/>15+ years]',
            'style A fill:#FFB6C1',
            'style B fill:#FFD700',
        ].join('\n'));
    });

    test('unwraps fenced mermaid blocks', () => {
        const input = '```mermaid\nflowchart TD\nA --> B\n```';

        expect(normalizeMermaidSource(input)).toBe('flowchart TD\nA --> B');
    });

    test('extracts collapsed mermaid from mixed mermaid and html content', () => {
        const input = [
            'flowchart TD Birth[Birth] Neonatal[Neonatal',
            '0-2 weeks] Transitional[Transitional',
            '2-4 weeks] Socialization[Socialization',
            '4-12 weeks] Juvenile[Juvenile',
            '3-6 months] Adult[Adult',
            '1-7 years] Birth --> Neonatal Neonatal --> Transitional Transitional --> Socialization Socialization --> Juvenile Juvenile --> Adult',
            '```html',
            '<h1>Dog Life Stages Assessment</h1>',
            '<p>This report outlines the typical life stages of a dog.</p>',
            '```',
        ].join('\n');

        const parts = extractCompositeDocumentParts(input);

        expect(parts.mermaidSource).toContain('flowchart TD');
        expect(parts.mermaidSource).toContain('Birth --> Neonatal');
        expect(parts.bodyContent).toContain('<h1>Dog Life Stages Assessment</h1>');
    });

    test('injects mermaid block into printable html documents', () => {
        const html = ensureHtmlDocument([
            'flowchart TD A[Birth] --> B[Adult]',
            '```html',
            '<h1>Dog Life Stages Assessment</h1>',
            '```',
        ].join('\n'), 'Dog Life Stages');

        expect(html).toContain('class="mermaid"');
        expect(html).toContain('Dog Life Stages Assessment');
        expect(html).toContain('cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js');
    });
});
