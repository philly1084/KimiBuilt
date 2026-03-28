const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadAgent(overrides = {}) {
    const source = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
    const windowObject = {
        location: { origin: 'http://localhost:3000' },
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
        ImportExport: {
            importFromMarkdown: jest.fn(() => null),
        },
        ...overrides,
    };

    const context = {
        window: windowObject,
        document: {
            readyState: 'loading',
            addEventListener: jest.fn(),
        },
        localStorage: {
            getItem: jest.fn(() => null),
            setItem: jest.fn(),
            removeItem: jest.fn(),
        },
        console,
        URL,
        setTimeout,
        clearTimeout,
        CustomEvent: function CustomEvent(type, init = {}) {
            this.type = type;
            this.detail = init.detail;
        },
        fetch: jest.fn(),
    };

    context.global = context;
    context.globalThis = context;

    vm.runInNewContext(source, context, { filename: 'agent.js' });
    return context.window.Agent;
}

describe('notes agent parsing', () => {
    test('normalizes legacy notes-actions replace-content payloads into rebuild_page actions', () => {
        const agent = loadAgent();
        const responseText = JSON.stringify({
            'notes-actions': [
                {
                    action: 'replace-content',
                    content: '# Paris: A Little City of Art\n\n![Paris art hero](https://images.unsplash.com/photo-12345)',
                },
            ],
        });

        const parsed = agent._extractNotesActionPlan(responseText);

        expect(parsed.actions).toHaveLength(1);
        expect(parsed.actions[0].op).toBe('rebuild_page');
        expect(parsed.actions[0].blocks).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'heading_1', content: 'Paris: A Little City of Art' }),
            expect.objectContaining({
                type: 'ai_image',
                content: expect.objectContaining({
                    imageUrl: 'https://images.unsplash.com/photo-12345',
                    source: 'unsplash',
                }),
            }),
        ]));
    });

    test('recovers shorthand direct block payloads for ai_image blocks', () => {
        const agent = loadAgent();
        const responseText = JSON.stringify([
            {
                type: 'ai_image',
                prompt: 'Paris watercolor street scene',
                imageUrl: 'https://images.unsplash.com/photo-98765',
                source: 'unsplash',
            },
            {
                type: 'text',
                text: 'A soft Paris street scene for the page hero.',
            },
        ]);

        const parsed = agent._extractNotesActionPlan(responseText);

        expect(parsed.actions).toHaveLength(1);
        expect(parsed.actions[0].op).toBe('append_to_page');
        expect(parsed.actions[0].blocks).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'ai_image',
                prompt: 'Paris watercolor street scene',
                imageUrl: 'https://images.unsplash.com/photo-98765',
            }),
            expect.objectContaining({
                type: 'text',
                text: 'A soft Paris street scene for the page hero.',
            }),
        ]));
    });

    test('rebuilds the page from assistant reply plus top-level markdown content when actions are omitted', () => {
        const agent = loadAgent();
        const responseText = JSON.stringify({
            assistant_reply: 'I turned this into a page draft.',
            content: '# Paris Art Guide\n\n![Paris hero](https://images.unsplash.com/photo-44444)\n\nMontmartre is still one of the city\'s best-known art neighborhoods.',
        });

        const parsed = agent._extractNotesActionPlan(responseText);

        expect(parsed.displayText).toBe('I turned this into a page draft.');
        expect(parsed.actions).toHaveLength(1);
        expect(parsed.actions[0].op).toBe('rebuild_page');
        expect(parsed.actions[0].blocks).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'heading_1', content: 'Paris Art Guide' }),
            expect.objectContaining({
                type: 'ai_image',
                content: expect.objectContaining({
                    imageUrl: 'https://images.unsplash.com/photo-44444',
                    source: 'unsplash',
                }),
            }),
            expect.objectContaining({
                type: 'text',
                content: 'Montmartre is still one of the city\'s best-known art neighborhoods.',
            }),
        ]));
    });
});
