const { normalizeMermaidSource } = require('./artifact-renderer');

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
});
