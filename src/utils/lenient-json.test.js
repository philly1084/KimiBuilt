const { parseLenientJson } = require('./lenient-json');

describe('parseLenientJson', () => {
    test('parses code-fenced JSON with trailing commas', () => {
        expect(parseLenientJson('```json\n{"question":"Pick one","options":[{"label":"A"},{"label":"B"},],}\n```'))
            .toEqual({
                question: 'Pick one',
                options: [
                    { label: 'A' },
                    { label: 'B' },
                ],
            });
    });

    test('parses single-quoted and bare-key JSON-like objects', () => {
        expect(parseLenientJson("{question:'Pick one', options:[{label:'A'},{label:'B'}], allowFreeText:True, context:None}"))
            .toEqual({
                question: 'Pick one',
                options: [
                    { label: 'A' },
                    { label: 'B' },
                ],
                allowFreeText: true,
                context: null,
            });
    });

    test('wraps bare key-value blobs that omit outer braces', () => {
        expect(parseLenientJson("question:'Pick one', options:['A','B',], allowFreeText:undefined"))
            .toEqual({
                question: 'Pick one',
                options: ['A', 'B'],
                allowFreeText: null,
            });
    });

    test('extracts a structured object from surrounding prose', () => {
        expect(parseLenientJson('Use this payload next:\nquestion: nope\n{"question":"Choose","options":[{"label":"Fast"},{"label":"Safe"}]}'))
            .toEqual({
                question: 'Choose',
                options: [
                    { label: 'Fast' },
                    { label: 'Safe' },
                ],
            });
    });

    test('extracts the first balanced object instead of consuming trailing prose', () => {
        expect(parseLenientJson('Result:\n{"question":"Choose","options":[{"label":"Fast"}]}\nThen discuss {later}.'))
            .toEqual({
                question: 'Choose',
                options: [
                    { label: 'Fast' },
                ],
            });
    });
});
