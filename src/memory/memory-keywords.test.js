const {
    extractProgrammingKeywords,
    mergeMemoryKeywords,
} = require('./memory-keywords');

describe('memory keyword extraction', () => {
    test('extracts programming-specific keywords from code workflow text', () => {
        const keywords = extractProgrammingKeywords(
            'Fixed failing Jest tests in src/routes/chat.js by updating the React websocket handler and package-lock.json.',
        );

        expect(keywords).toEqual(expect.arrayContaining([
            'jest',
            'react',
            'websocket',
            'src/routes/chat.js',
            'chat.js',
            'package-lock.json',
            'debugging',
            'testing',
        ]));
    });

    test('prioritizes explicit and programming keywords when merging', () => {
        const keywords = mergeMemoryKeywords(
            ['agent-success'],
            'Patch src/memory/memory-service.js and run npm test for the Express route regression.',
        );

        expect(keywords.slice(0, 4)).toEqual(expect.arrayContaining([
            'agent-success',
            'src/memory/memory-service.js',
        ]));
        expect(keywords).toContain('express');
        expect(keywords).toContain('testing');
    });
});
