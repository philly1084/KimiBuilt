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

    test('does not blend prior transcript into a self-contained uploaded image turn', () => {
        const input = 'I just uploaded an image. did you see it?';
        const recentMessages = [
            { role: 'user', content: 'can you give me todays news in a video podcast' },
            { role: 'assistant', content: 'I generated a video podcast.' },
        ];

        expect(isLikelyTranscriptDependentTurn(input)).toBe(false);
        expect(resolveTranscriptObjectiveFromSession(input, recentMessages)).toEqual({
            objective: input,
            usedTranscriptContext: false,
        });
    });

    test('does not treat local pronouns inside explicit new work as transcript references', () => {
        const input = 'Write a poem about AI and make it funny.';
        const recentMessages = [
            { role: 'user', content: 'Deploy the calendar app to the cluster.' },
        ];

        expect(isLikelyTranscriptDependentTurn(input)).toBe(false);
        expect(resolveTranscriptObjectiveFromSession(input, recentMessages)).toEqual({
            objective: input,
            usedTranscriptContext: false,
        });
    });

    test('still blends genuinely abbreviated image follow-ups with recent transcript', () => {
        expect(isLikelyTranscriptDependentTurn('did you see it?')).toBe(true);
        expect(resolveTranscriptObjectiveFromSession('did you see it?', [
            { role: 'user', content: 'I uploaded a screenshot of the dashboard.' },
        ])).toEqual({
            objective: 'I uploaded a screenshot of the dashboard. did you see it?',
            usedTranscriptContext: true,
            priorUserObjective: 'I uploaded a screenshot of the dashboard.',
        });
    });
});
