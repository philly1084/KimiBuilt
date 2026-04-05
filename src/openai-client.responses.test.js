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

    test('forwards previous_response_id on normal responses-api turns', async () => {
        const OpenAI = require('openai');
        const { createResponse } = require('./openai-client');

        await createResponse({
            input: 'Continue the previous reply.',
            previousResponseId: 'resp_prev_123',
            stream: false,
        });

        const client = OpenAI.mock.results[0].value;
        expect(client.responses.create).toHaveBeenCalledWith(expect.objectContaining({
            previous_response_id: 'resp_prev_123',
        }));
    });
});
