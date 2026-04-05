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

    test('unwraps nested assistant content arrays and stringified output_text payloads', () => {
        const agent = loadAgent();
        const responseText = JSON.stringify({
            role: 'assistant',
            content: [
                {
                    type: 'think',
                    think: 'Internal reasoning that should stay hidden.',
                    encrypted: null,
                },
                {
                    type: 'text',
                    text: JSON.stringify({
                        output_text: 'Hey there! How can I help you today?',
                        finish_reason: 'stop',
                    }),
                },
            ],
        });

        const parsed = agent._extractNotesActionPlan(responseText);

        expect(parsed.displayText).toBe('Hey there! How can I help you today?');
        expect(parsed.actions).toEqual([]);
    });

    test('unwraps raw function payloads into visible assistant text instead of showing the tool wrapper', () => {
        const agent = loadAgent();
        const responseText = JSON.stringify({
            type: 'function',
            name: 'update_notes_page',
            parameters: {
                notes_page_update: 'It is going well, thanks for asking. How can I help?'
            }
        });

        const parsed = agent._extractNotesActionPlan(responseText);

        expect(parsed.displayText).toBe('It is going well, thanks for asking. How can I help?');
        expect(parsed.actions).toEqual([]);
    });

    test('suppresses placeholder-only assistant replies', () => {
        const agent = loadAgent();
        const responseText = '<assistant reply>';

        const parsed = agent._extractNotesActionPlan(responseText);

        expect(parsed.displayText).toBe('');
        expect(parsed.actions).toEqual([]);
    });

    test('suppresses leaked internal notes planning scaffolds instead of showing them in chat', () => {
        const agent = loadAgent();
        const responseText = `Original request:
read the different block options and build this page to cool

Interpret "page" as the current notes page shown in this editor.

Approved page plan:
{
  "title": "Cool Page",
  "sections": [
    { "heading": "Intro", "goal": "Open strong", "blockTypes": ["heading_1", "text"] }
  ]
}`;

        const parsed = agent._extractNotesActionPlan(responseText);

        expect(parsed.displayText).toBe('');
        expect(parsed.actions).toEqual([]);
    });

    test('strips null bytes from wrapped function payload text', () => {
        const agent = loadAgent();
        const responseText = JSON.stringify({
            type: 'function',
            name: 'update_notes_page',
            parameters: {
                notes_page_update: 'Hello\u0000 world'
            }
        });

        const parsed = agent._extractNotesActionPlan(responseText);

        expect(parsed.displayText).toBe('Hello world');
        expect(parsed.actions).toEqual([]);
    });

    test('treats explicit website review prompts as non-page runtime work', () => {
        const agent = loadAgent();
        const question = 'Can you continue to look over the site https://bicyclethief.ca and continue researching what is new?';
        const context = {
            blockCount: 8,
            outline: [{ id: 'h1' }],
        };

        expect(agent._hasNonPageRuntimeIntent(question, {})).toBe(true);
        expect(agent._shouldForcePageEditActions(question, context, {})).toBe(false);
    });

    test('still forces page actions for direct current-page writing requests', () => {
        const agent = loadAgent();
        const question = 'Continue this page and turn it into a cleaner summary with better structure.';
        const context = {
            blockCount: 8,
            outline: [{ id: 'h1' }],
        };

        expect(agent._hasNonPageRuntimeIntent(question, {})).toBe(false);
        expect(agent._shouldForcePageEditActions(question, context, {})).toBe(true);
    });

    test('includes page content and design criteria in the system prompt', () => {
        const agent = loadAgent();
        const prompt = agent._buildSystemPrompt({
            title: 'Penguin Notes',
            pageId: 'page_penguins',
            blockCount: 5,
            wordCount: 180,
            readingTime: 1,
            defaultModel: 'gpt-4o',
            properties: [],
            lastUpdated: '2026-04-05T10:00:00.000Z',
            outline: [
                { id: 'block_h1', content: 'Overview' },
            ],
            blocks: [
                { id: 'block_1', type: 'heading_1', content: 'Penguin Notes', depth: 0 },
                { id: 'block_2', type: 'text', content: 'Penguins are flightless birds adapted to life in cold oceans.', depth: 0 },
                { id: 'block_3', type: 'heading_2', content: 'Overview', depth: 0 },
                { id: 'block_4', type: 'text', content: 'They swim efficiently and live in large colonies.', depth: 0 },
                { id: 'block_5', type: 'text', content: 'Their diet includes fish, squid, and krill.', depth: 0 },
            ],
        }, {
            question: 'Create a research brief about penguins with sources and key findings.',
        });

        expect(prompt).toContain('CURRENT PAGE CONTENT (excerpt):');
        expect(prompt).toContain('PAGE DESIGN CRITERIA:');
        expect(prompt).toContain('BEST-FIT PAGE TEMPLATES:');
        expect(prompt).toContain('BLOCK CAPABILITY PLAYBOOK:');
        expect(prompt).toContain('BLOCK OPPORTUNITIES FOR THIS REQUEST:');
        expect(prompt).toContain('Top-level flow');
        expect(prompt).toContain('Do not return a single giant text block');
        expect(prompt).toContain('Executive Brief [brief]');
        expect(prompt).toContain('Research Page [research]');
        expect(prompt).toContain('callout: Key takeaways');
        expect(prompt).toContain('database: Comparisons, trackers');
    });

    test('selects a project-oriented template for project planning requests', () => {
        const agent = loadAgent();
        const templates = agent._selectNotesPageTemplates(
            'Create a project plan for launching the new notes agent with milestones, owners, and a timeline.',
            {
                title: 'Launch Planning',
                blockCount: 0,
                blocks: [],
                outline: [],
            }
        );

        expect(Array.isArray(templates)).toBe(true);
        expect(templates[0].id).toBe('project');
    });

    test('expands oversized single-block rebuild actions into multiple page blocks', () => {
        const agent = loadAgent();
        const normalizedActions = agent._normalizeStructuredPageActions([
            {
                op: 'rebuild_page',
                blocks: [{
                    type: 'text',
                    content: '# Penguins\n\n## Habitat\nPenguins live in cold climates and gather in large colonies.\n\n- Antarctica\n- Southern Ocean\n- Rocky coastal islands'
                }],
            },
        ], 'Create a page about penguins with sections and supporting bullets.', {
            blockCount: 0,
            outline: [],
        });

        expect(normalizedActions).toHaveLength(1);
        expect(normalizedActions[0].blocks).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'heading_1', content: 'Penguins' }),
            expect.objectContaining({ type: 'heading_2', content: 'Habitat' }),
            expect.objectContaining({ type: 'bulleted_list', content: 'Antarctica' }),
        ]));
        expect(normalizedActions[0].blocks.length).toBeGreaterThan(1);
    });

    test('suppresses inferred html artifacts for notes page build requests unless file delivery is explicit', () => {
        const agent = loadAgent();
        const context = {
            blockCount: 8,
            outline: [{ id: 'h1' }],
        };

        expect(agent._shouldSuppressRequestedArtifactFormat(
            'Can you make me an HTML page about tropical fish with sections for habitat and care?',
            context,
            'html',
        )).toBe(true);

        expect(agent._shouldSuppressRequestedArtifactFormat(
            'Create an HTML file I can download for a tropical fish landing page.',
            context,
            'html',
        )).toBe(false);
    });
});
