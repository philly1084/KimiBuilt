const {
    buildUserCheckpointAskedPatch,
    buildUserCheckpointInstructions,
    buildUserCheckpointMessage,
    buildUserCheckpointPolicy,
    buildUserCheckpointResponseMessage,
    extractPendingUserCheckpoint,
    parseUserCheckpointResponseMessage,
} = require('./user-checkpoints');

describe('user checkpoint helpers', () => {
    test('builds a normalized web-chat checkpoint policy from session control state', () => {
        const policy = buildUserCheckpointPolicy({
            clientSurface: 'web-chat',
            session: {
                controlState: {
                    userCheckpoint: {
                        askedCount: 1,
                        maxQuestions: 2,
                        pending: {
                            id: 'checkpoint-1',
                            title: 'Choose a path',
                            question: 'Which path should I take?',
                            options: [
                                { id: 'fast', label: 'Fast patch' },
                                { id: 'deep', label: 'Deeper refactor' },
                            ],
                        },
                    },
                },
            },
        });

        expect(policy).toEqual(expect.objectContaining({
            enabled: true,
            askedCount: 1,
            remaining: 1,
            pending: expect.objectContaining({
                id: 'checkpoint-1',
                question: 'Which path should I take?',
            }),
        }));
    });

    test('formats a checkpoint message with an embedded survey fence', () => {
        const message = buildUserCheckpointMessage({
            id: 'checkpoint-1',
            title: 'Choose a path',
            question: 'Which path should I take?',
            options: [
                { id: 'fast', label: 'Fast patch' },
                { id: 'deep', label: 'Deeper refactor' },
            ],
        });

        expect(message).toContain('```survey');
        expect(message).toContain('"id": "checkpoint-1"');
        expect(message).toContain('Choose an option below');
        expect(message).toContain('"allowFreeText": true');
    });

    test('checkpoint instructions explicitly forbid plain-text multiple-choice questions in web-chat', () => {
        const instructions = buildUserCheckpointInstructions({
            enabled: true,
            maxQuestions: 2,
            remaining: 2,
            pending: null,
        });

        expect(instructions).toContain('do not ask a blocking multiple-choice question as plain assistant text');
        expect(instructions).toContain('use the tool so the UI can render inline options');
        expect(instructions).toContain('keep the free-text field available');
        expect(instructions).toContain('Do not call or mention `request_user_input`');
        expect(instructions).toContain('Do not claim that the questionnaire rendered');
        expect(instructions).toContain('Do not turn that into a multi-question quiz');
        expect(instructions).toContain('sample survey text, markdown checkboxes');
        expect(instructions).toContain('primary quick way to involve the user');
        expect(instructions).toContain('Prefer `user-checkpoint` over a prose "which option do you want?" message');
        expect(instructions).toContain('one card, one question');
    });

    test('extracts a pending checkpoint from tool events and increments asked count', () => {
        const toolEvents = [{
            toolCall: {
                function: {
                    name: 'user-checkpoint',
                },
            },
            result: {
                success: true,
                toolId: 'user-checkpoint',
                data: {
                    checkpoint: {
                        id: 'checkpoint-2',
                        title: 'Choose a path',
                        question: 'Which path should I take?',
                        options: [
                            { id: 'fast', label: 'Fast patch' },
                            { id: 'deep', label: 'Deeper refactor' },
                        ],
                    },
                },
            },
        }];

        const checkpoint = extractPendingUserCheckpoint(toolEvents);
        const patch = buildUserCheckpointAskedPatch({
            controlState: {
                userCheckpoint: {
                    askedCount: 0,
                    maxQuestions: 2,
                },
            },
        }, checkpoint);

        expect(checkpoint).toEqual(expect.objectContaining({
            id: 'checkpoint-2',
        }));
        expect(patch).toEqual(expect.objectContaining({
            userCheckpoint: expect.objectContaining({
                askedCount: 1,
                pending: expect.objectContaining({
                    id: 'checkpoint-2',
                }),
            }),
        }));
    });

    test('serializes and parses a user checkpoint response message', () => {
        const message = buildUserCheckpointResponseMessage({
            checkpointId: 'checkpoint-3',
            selectedOptions: [
                { id: 'fast', label: 'Fast patch' },
            ],
            notes: 'Keep the backend changes narrow.',
        });

        const parsed = parseUserCheckpointResponseMessage(message);

        expect(parsed).toEqual({
            checkpointId: 'checkpoint-3',
            summary: 'chose "Fast patch" [fast]. Notes: Keep the backend changes narrow.',
        });
    });
});
