jest.mock('openai', () => {
    const responsesCreate = jest.fn(async (params) => ({
        id: 'resp-test',
        model: params.model,
        output: [{
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok' }],
        }],
    }));
    const chatCreate = jest.fn();

    return jest.fn().mockImplementation(() => ({
        responses: {
            create: responsesCreate,
        },
        chat: {
            completions: {
                create: chatCreate,
            },
        },
    }));
});

describe('openai-client response threading', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.doMock('./routes/admin/settings.controller', () => ({
            getSettings: jest.fn(() => ({})),
        }));
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';
        process.env.OPENAI_API_MODE = 'responses';
    });

    afterEach(() => {
        delete process.env.OPENAI_API_MODE;
    });

    test('forwards previous_response_id when the prior prompt fingerprint matches', async () => {
        const OpenAI = require('openai');
        const { createResponse, __testUtils } = require('./openai-client');
        const instructionsFingerprint = __testUtils.hashPromptText('You are a helpful AI assistant.');

        await createResponse({
            input: 'Continue the previous reply.',
            previousResponseId: 'resp_prev_123',
            previousPromptState: { instructionsFingerprint },
            instructions: 'You are a helpful AI assistant.',
            stream: false,
        });

        const client = OpenAI.mock.results[0].value;
        expect(client.responses.create).toHaveBeenCalledWith(expect.objectContaining({
            previous_response_id: 'resp_prev_123',
        }));
    });

    test('reuses the threaded response without resending unchanged instructions or transcript', async () => {
        const OpenAI = require('openai');
        const { createResponse, __testUtils } = require('./openai-client');
        const instructionsFingerprint = __testUtils.hashPromptText('You are a helpful AI assistant.');

        await createResponse({
            input: 'Continue the previous reply.',
            previousResponseId: 'resp_prev_123',
            previousPromptState: { instructionsFingerprint },
            instructions: 'You are a helpful AI assistant.',
            recentMessages: [
                { role: 'user', content: 'Earlier question' },
                { role: 'assistant', content: 'Earlier answer' },
            ],
            stream: false,
        });

        const client = OpenAI.mock.results[0].value;
        expect(client.responses.create).toHaveBeenCalledWith(expect.objectContaining({
            previous_response_id: 'resp_prev_123',
            input: [
                { type: 'message', role: 'user', content: 'Continue the previous reply.' },
            ],
        }));
    });

    test('drops threaded reuse when the instruction fingerprint changes', async () => {
        const OpenAI = require('openai');
        const { createResponse, __testUtils } = require('./openai-client');

        await createResponse({
            input: 'Continue the previous reply.',
            previousResponseId: 'resp_prev_123',
            previousPromptState: {
                instructionsFingerprint: __testUtils.hashPromptText('Old instructions'),
            },
            instructions: 'New instructions',
            stream: false,
        });

        const client = OpenAI.mock.results[0].value;
        expect(client.responses.create).toHaveBeenCalledWith(expect.not.objectContaining({
            previous_response_id: 'resp_prev_123',
        }));
        expect(client.responses.create).toHaveBeenCalledWith(expect.objectContaining({
            input: expect.arrayContaining([
                { type: 'message', role: 'system', content: 'New instructions' },
                { type: 'message', role: 'user', content: 'Continue the previous reply.' },
            ]),
        }));
    });
});
