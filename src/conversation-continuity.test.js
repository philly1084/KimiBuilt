const {
    isLikelyTranscriptDependentTurn,
    resolveTranscriptObjectiveFromSession,
} = require('./conversation-continuity');

describe('conversation continuity', () => {
    test('does not blend an old task into a retry-prefixed new explicit request', () => {
        const input = 'try again. Can we make a video podcast on dating in Halifax this weekend?';
        const recentMessages = [
            { role: 'user', content: 'can you fix the calander app with the remote cli agent' },
            { role: 'assistant', content: 'The remote build is blocked by git authentication.' },
        ];

        expect(isLikelyTranscriptDependentTurn(input)).toBe(false);
        expect(resolveTranscriptObjectiveFromSession(input, recentMessages)).toEqual({
            objective: input,
            usedTranscriptContext: false,
        });
    });

    test('still treats bare retry requests as transcript-dependent', () => {
        expect(isLikelyTranscriptDependentTurn('try again')).toBe(true);
        expect(resolveTranscriptObjectiveFromSession('try again', [
            { role: 'user', content: 'Make a video podcast about battery storage.' },
        ])).toEqual({
            objective: 'Make a video podcast about battery storage. try again',
            usedTranscriptContext: true,
            priorUserObjective: 'Make a video podcast about battery storage.',
        });
    });
});
