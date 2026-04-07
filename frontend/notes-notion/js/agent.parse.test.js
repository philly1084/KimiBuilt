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

    test('turns Unsplash photo-page links into pending ai_image blocks instead of broken image embeds', () => {
        const agent = loadAgent();
        const responseText = JSON.stringify({
            assistant_reply: 'Added a penguin visual.',
            content: '# Penguins\n\n![Penguins during daytime](https://unsplash.com/photos/penguins-during-daytime-_FRAYdYmQCM)',
        });

        const parsed = agent._extractNotesActionPlan(responseText);
        const imageBlock = parsed.actions[0].blocks.find((block) => block.type === 'ai_image');

        expect(imageBlock).toEqual(expect.objectContaining({
            type: 'ai_image',
            content: expect.objectContaining({
                imageUrl: null,
                status: 'pending',
                source: 'unsplash',
                downloadUrl: 'https://unsplash.com/photos/penguins-during-daytime-_FRAYdYmQCM',
            }),
        }));
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
        expect(prompt).toContain('CURRENT VISUAL ANCHORS:');
        expect(prompt).toContain('BEST-FIT PAGE TEMPLATES:');
        expect(prompt).toContain('VISUAL PAGE RECIPES:');
        expect(prompt).toContain('DESIGN SCHEMES:');
        expect(prompt).toContain('BLOCK CAPABILITY PLAYBOOK:');
        expect(prompt).toContain('FRONTEND FEATURES YOU CAN USE:');
        expect(prompt).toContain('PAGE DESIGN MANUAL:');
        expect(prompt).toContain('BLOCK OPPORTUNITIES FOR THIS REQUEST:');
        expect(prompt).toContain('TEMPLATE EXECUTION CHECKLIST:');
        expect(prompt).toContain('VISUAL DESIGN CHECKLIST:');
        expect(prompt).toContain('DESIGN SCHEME CHECKLIST:');
        expect(prompt).toContain('Top-level flow');
        expect(prompt).toContain('Do not return a single giant text block');
        expect(prompt).toContain('Think in page roles, not just paragraphs');
        expect(prompt).toContain('Treat style as part of the page system');
        expect(prompt).toContain('visual hierarchy as required work');
        expect(prompt).toContain('Editorial Explainer [editorial-explainer]');
        expect(prompt).toContain('Cool Knowledge [cool-knowledge]');
        expect(prompt).toContain('Avoid more than two plain text blocks in a row');
        expect(prompt).toContain('Choose one dominant design scheme');
        expect(prompt).toContain('Lead focal blocks');
        expect(prompt).toContain('Page metadata: Use `update_page` to set `title`, `icon`, `cover`, `properties`, and `defaultModel`');
        expect(prompt).toContain('Properties: `properties` accepts an array of `{key, value}` pairs');
        expect(prompt).toContain('Nested structure: Blocks can include `children`');
        expect(prompt).toContain('Use todo blocks for real checkboxes');
        expect(prompt).toContain('Do not leave markdown markers like `##`, `-`, `--`, `[ ]`, or `**bold**`');
        expect(prompt).toContain('Use heading blocks for headings, list blocks for bullets, todo blocks for checkboxes');
        expect(prompt).toContain('Use `heading_3` for compact section labels, mini-subheads');
        expect(prompt).toContain('heading_2 / heading_3: Major sections, compact section labels');
        expect(prompt).toContain('Recommended metadata: Type: Research');
        expect(prompt).toContain('Required palette: callout + hero image/ai_image + bookmark source cluster + toggle for deep detail');
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

    test('selects an explainer-oriented template for educational topic pages', () => {
        const agent = loadAgent();
        const templates = agent._selectNotesPageTemplates(
            'Create a polished page about penguins with science facts, habitat notes, and quick facts.',
            {
                title: 'Penguins',
                blockCount: 0,
                blocks: [],
                outline: [],
            }
        );

        expect(Array.isArray(templates)).toBe(true);
        expect(templates[0].id).toBe('explainer');
    });

    test('selects a field-guide design scheme for educational nature pages', () => {
        const agent = loadAgent();
        const schemes = agent._selectNotesDesignSchemes(
            'Create a polished page about penguins with science facts, habitat notes, and quick facts.',
            {
                title: 'Penguins',
                blockCount: 0,
                blocks: [],
                outline: [],
            },
            [{ id: 'explainer' }]
        );

        expect(Array.isArray(schemes)).toBe(true);
        expect(schemes[0].id).toBe('field-guide');
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

    test('rehydrates collapsed one-line markdown into structured notes blocks', () => {
        const agent = loadAgent();
        const normalizedActions = agent._normalizeStructuredPageActions([
            {
                op: 'rebuild_page',
                blocks: [{
                    type: 'text',
                    content: '☀️ Suns and the Science of Suns > Big idea: The Sun is a star that gives Earth light and heat. ## What Is a Sun? A sun is a star. - light for daytime - heat for life ## Stay Safe > Never look directly at the Sun with your eyes.',
                }],
            },
        ], 'Create a researched page about suns with sections, solar safety, and key facts.', {
            blockCount: 0,
            outline: [],
        });

        expect(normalizedActions).toHaveLength(1);
        expect(normalizedActions[0].blocks).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'heading_1', content: '☀️ Suns and the Science of Suns' }),
            expect.objectContaining({
                type: 'callout',
                content: expect.objectContaining({
                    text: expect.stringContaining('The Sun is a star'),
                }),
            }),
            expect.objectContaining({ type: 'heading_2', content: 'What Is a Sun?' }),
            expect.objectContaining({ type: 'bulleted_list', content: 'light for daytime' }),
            expect.objectContaining({ type: 'heading_2', content: 'Stay Safe' }),
        ]));
        expect(normalizedActions[0].blocks.length).toBeGreaterThan(4);
    });

    test('upgrades plain research rebuilds with richer support blocks and source bookmarks', () => {
        const agent = loadAgent();
        const normalizedActions = agent._normalizeStructuredPageActions([
            {
                op: 'rebuild_page',
                blocks: [
                    { type: 'heading_1', content: 'Penguins: Built for Water, Pressed by Change' },
                    { type: 'quote', content: 'Shoutout to emperor penguins for surviving brutal Antarctic cold with patience, teamwork, and elite-level parenting.' },
                    { type: 'heading_2', content: 'Why Penguins Stand Out' },
                    { type: 'text', content: 'Penguins are flightless seabirds engineered for life in the ocean. On land they can look awkward and almost comic, but in the water they become fast, controlled, and highly efficient swimmers.' },
                    { type: 'heading_2', content: 'Source Note' },
                    { type: 'text', content: 'This page is based on verified research already established in the session, including Nat Geo Kids and ScienceDaily notes about penguin habitats across the Southern Hemisphere.' },
                ],
            },
        ], 'Create a researched page about penguins with verified sources and a polished layout.', {
            title: 'Untitled',
            blockCount: 0,
            outline: [],
            blocks: [],
        }, [
            {
                toolCall: { function: { name: 'web-search', arguments: '{}' } },
                result: {
                    success: true,
                    toolId: 'web-search',
                    data: {
                        results: [
                            {
                                title: 'National Geographic Kids: Penguins',
                                url: 'https://kids.nationalgeographic.com/animals/birds/facts/penguin',
                                snippet: 'Penguins are flightless birds that live across the Southern Hemisphere.',
                            },
                            {
                                title: 'ScienceDaily: Penguins',
                                url: 'https://www.sciencedaily.com/releases/2024/01/240101123456.htm',
                                snippet: 'Research overview on penguin habitats and climate pressure.',
                            },
                        ],
                    },
                },
            },
        ]);

        expect(normalizedActions).toHaveLength(1);
        expect(normalizedActions[0].icon).toBe('🔎');
        expect(normalizedActions[0].title).toBe('Penguins: Built for Water, Pressed by Change');
        expect(normalizedActions[0].properties).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: 'Type', value: 'Research' }),
            expect.objectContaining({ key: 'Mode', value: 'Knowledge hub' }),
            expect.objectContaining({ key: 'Evidence', value: 'Source-linked' }),
        ]));
        expect(normalizedActions[0].blocks).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'callout',
                content: expect.objectContaining({
                    icon: '🧭',
                }),
                color: 'blue',
            }),
            expect.objectContaining({ type: 'divider' }),
            expect.objectContaining({ type: 'toggle', color: 'gray' }),
            expect.objectContaining({
                type: 'bookmark',
                content: expect.objectContaining({
                    url: 'https://kids.nationalgeographic.com/animals/birds/facts/penguin',
                }),
            }),
        ]));
        expect(normalizedActions[0].blocks).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'ai_image',
                content: expect.objectContaining({
                    source: 'unsplash',
                    prompt: expect.stringMatching(/penguins/i),
                }),
            }),
            expect.objectContaining({
                type: 'heading_2',
                content: 'Why Penguins Stand Out',
                textColor: 'blue',
            }),
            expect.objectContaining({
                type: 'heading_2',
                content: 'Source Note',
                textColor: 'gray',
            }),
        ]));
    });

    test('turns markdown task lists into todo blocks during fallback expansion', () => {
        const agent = loadAgent();
        const normalizedActions = agent._normalizeStructuredPageActions([
            {
                op: 'rebuild_page',
                blocks: [{
                    type: 'text',
                    content: '# Penguin Tasks\n\n- [ ] Find habitat sources\n- [x] Add hero image\n- [ ] Verify colony facts',
                }],
            },
        ], 'Build a notes page with penguin research tasks and clean structure.', {
            blockCount: 0,
            outline: [],
        });

        expect(normalizedActions).toHaveLength(1);
        expect(normalizedActions[0].blocks).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'heading_1', content: 'Penguin Tasks' }),
            expect.objectContaining({
                type: 'todo',
                content: expect.objectContaining({ text: 'Find habitat sources', checked: false }),
            }),
            expect.objectContaining({
                type: 'todo',
                content: expect.objectContaining({ text: 'Add hero image', checked: true }),
            }),
        ]));
    });

    test('converts quick facts lists into a richer explainer layout cluster', () => {
        const agent = loadAgent();
        const normalizedActions = agent._normalizeStructuredPageActions([
            {
                op: 'rebuild_page',
                blocks: [
                    { type: 'heading_1', content: 'Suns and the Science of Suns' },
                    { type: 'text', content: 'The Sun is a star and gives Earth light and heat.' },
                    { type: 'heading_2', content: 'Quick Facts' },
                    { type: 'bulleted_list', content: 'The Sun is a star.' },
                    { type: 'bulleted_list', content: 'It gives Earth light and heat.' },
                    { type: 'bulleted_list', content: 'Many stars in the night sky are other suns.' },
                    { type: 'heading_2', content: 'Stay Safe' },
                    { type: 'text', content: 'Never look directly at the Sun with your eyes. It can damage your vision.' },
                ],
            },
        ], 'Build a polished explainer page about suns with quick facts and a safety note.', {
            title: 'Untitled',
            blockCount: 0,
            outline: [],
            blocks: [],
        });

        expect(normalizedActions).toHaveLength(1);
        expect(normalizedActions[0].icon).toBe('💡');
        expect(normalizedActions[0].properties).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: 'Type', value: 'Explainer' }),
            expect.objectContaining({ key: 'Mode', value: 'Visual knowledge page' }),
        ]));
        expect(normalizedActions[0].blocks).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'ai_image' }),
            expect.objectContaining({
                type: 'database',
                content: expect.objectContaining({
                    columns: expect.arrayContaining(['Quick fact']),
                }),
            }),
            expect.objectContaining({
                type: 'callout',
                color: 'orange',
            }),
            expect.objectContaining({ type: 'divider' }),
        ]));
    });

    test('preserves existing accent colors when upgrading a page redesign', () => {
        const agent = loadAgent();
        const normalizedActions = agent._normalizeStructuredPageActions([
            {
                op: 'rebuild_page',
                blocks: [
                    { type: 'heading_1', content: 'Penguins' },
                    { type: 'text', content: 'Penguins are flightless seabirds adapted for life in the ocean.' },
                    { type: 'heading_2', content: 'Habitat' },
                    { type: 'text', content: 'They live across the Southern Hemisphere and depend on productive marine ecosystems.' },
                    { type: 'heading_2', content: 'Quick Facts' },
                    { type: 'bulleted_list', content: 'They are expert swimmers.' },
                    { type: 'bulleted_list', content: 'Many species live in colonies.' },
                    { type: 'bulleted_list', content: 'Not all penguins live in Antarctica.' },
                ],
            },
        ], 'Refresh this page about penguins but keep the current green accent and make it feel more polished.', {
            title: 'Penguins',
            blockCount: 6,
            outline: [{ id: 'h1', content: 'Penguins' }],
            blocks: [
                { id: 'b1', type: 'callout', content: { text: 'Existing lead' }, color: 'green' },
                { id: 'b2', type: 'heading_2', content: 'Habitat', textColor: 'green' },
            ],
        });

        expect(normalizedActions).toHaveLength(1);
        expect(normalizedActions[0].blocks).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'callout', color: 'green' }),
            expect.objectContaining({ type: 'heading_2', textColor: 'green' }),
        ]));
    });

    test('promotes compact inline section labels into heading_3 blocks for stronger page rhythm', () => {
        const agent = loadAgent();
        const normalizedActions = agent._normalizeStructuredPageActions([
            {
                op: 'rebuild_page',
                blocks: [
                    { type: 'heading_1', content: 'Penguins' },
                    { type: 'text', content: 'Penguins are flightless seabirds adapted for life in the ocean.' },
                    { type: 'text', content: 'Why It Matters' },
                    { type: 'text', content: 'Penguins help show how evolution shapes animals for a specific environment.' },
                    { type: 'text', content: 'Habitat Snapshot: Southern Hemisphere coasts, islands, and cold ocean ecosystems.' },
                ],
            },
        ], 'Make this penguin page feel more designed and notion-like.', {
            title: 'Penguins',
            blockCount: 5,
            outline: [{ id: 'h1', content: 'Penguins' }],
            blocks: [],
        });

        expect(normalizedActions).toHaveLength(1);
        expect(normalizedActions[0].blocks).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'heading_3', content: 'Why It Matters' }),
            expect.objectContaining({ type: 'heading_3', content: 'Habitat Snapshot' }),
            expect.objectContaining({
                type: 'text',
                content: 'Southern Hemisphere coasts, islands, and cold ocean ecosystems.',
            }),
        ]));
    });

    test('normalizes markdown-like single-line block definitions into native block types', () => {
        const agent = loadAgent();
        const normalizedActions = agent._normalizeStructuredPageActions([
            {
                op: 'append_to_page',
                blocks: [
                    { type: 'text', content: '## Habitat' },
                    { type: 'text', content: '-- Ice shelves and rocky coasts' },
                    { type: 'text', content: '[ ] Add conservation section' },
                    { type: 'text', content: '**Big idea:** Penguins are built for water.' },
                ],
            },
        ], 'Add cleaner native blocks to this penguin page.', {
            blockCount: 4,
            outline: [{ id: 'h1', content: 'Penguins' }],
        });

        expect(normalizedActions).toHaveLength(1);
        expect(normalizedActions[0].blocks).toEqual([
            expect.objectContaining({ type: 'heading_2', content: 'Habitat' }),
            expect.objectContaining({ type: 'bulleted_list', content: 'Ice shelves and rocky coasts' }),
            expect.objectContaining({
                type: 'todo',
                content: expect.objectContaining({ text: 'Add conservation section', checked: false }),
            }),
            expect.objectContaining({
                type: 'callout',
                content: expect.objectContaining({ text: 'Big idea: Penguins are built for water.' }),
            }),
        ]);
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
