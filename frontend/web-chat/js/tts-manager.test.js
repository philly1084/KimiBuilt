const {
    DEFAULT_PIPER_FIRST_CHUNK_SENTENCES,
    DEFAULT_PIPER_MAX_SENTENCES_PER_CHUNK,
    splitTextIntoSpeechChunks,
} = require('./tts-manager');

describe('splitTextIntoSpeechChunks', () => {
    test('keeps the first chunk short and groups follow-up sentences into rolling batches', () => {
        const chunks = splitTextIntoSpeechChunks(
            'One. Two. Three. Four. Five. Six. Seven. Eight.',
            {
                absoluteMaxChars: 2400,
                targetChunkChars: 520,
                firstChunkMaxSentences: DEFAULT_PIPER_FIRST_CHUNK_SENTENCES,
                maxSentencesPerChunk: DEFAULT_PIPER_MAX_SENTENCES_PER_CHUNK,
            },
        );

        expect(chunks).toEqual([
            'One.',
            'Two. Three. Four. Five. Six. Seven.',
            'Eight.',
        ]);
    });

    test('keeps oversized chunks under the absolute char limit after grouping sentences', () => {
        const chunks = splitTextIntoSpeechChunks(
            [
                'This sentence is intentionally verbose so the realtime chunker has to split it before playback can stay smooth.',
                'Another fairly long sentence gives the lookahead queue something realistic to chew on.',
                'A shorter sentence closes the paragraph cleanly.',
            ].join(' '),
            {
                absoluteMaxChars: 140,
                targetChunkChars: 120,
                firstChunkMaxSentences: DEFAULT_PIPER_FIRST_CHUNK_SENTENCES,
                maxSentencesPerChunk: DEFAULT_PIPER_MAX_SENTENCES_PER_CHUNK,
            },
        );

        expect(chunks.length).toBeGreaterThanOrEqual(3);
        expect(chunks.every((chunk) => chunk.length <= 140)).toBe(true);
        expect(chunks[0]).toMatch(/^This sentence is intentionally verbose/);
    });
});
