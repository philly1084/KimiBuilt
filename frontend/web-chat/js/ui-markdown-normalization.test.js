const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadUIHelpersPrototype() {
    const sourcePath = path.join(__dirname, 'ui.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace(/const uiHelpers = new UIHelpers\(\);[\s\S]*$/, 'globalThis.UIHelpers = UIHelpers;');
    const escapeHtml = (value) => String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const context = {
        window: { KimiBuiltGatewaySSE: {} },
        document: {
            getElementById: () => null,
            createElement: () => {
                const element = {};
                Object.defineProperty(element, 'textContent', {
                    set(value) {
                        this._text = String(value == null ? '' : value);
                    },
                });
                Object.defineProperty(element, 'innerHTML', {
                    get() {
                        return escapeHtml(this._text);
                    },
                });
                return element;
            },
        },
        localStorage: {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
        },
        marked: {
            setOptions: () => {},
            Renderer: function Renderer() {},
            use: () => {},
        },
        DOMPurify: { sanitize: (html) => html },
        console,
    };

    vm.createContext(context);
    vm.runInContext(source, context);
    return context.UIHelpers.prototype;
}

describe('web-chat markdown normalization', () => {
    test('restores flattened recipe headings and tables before rendering', () => {
        const helper = Object.create(loadUIHelpersPrototype());
        const normalized = helper.normalizeStructuredAssistantMarkdown(`Here is a potato recipe: Garlic-Herb Roasted Potatoes Why it works

Crispy outside.
Minimal prep. ---
Ingredients | Item | Quantity | |----------------|----------| | Baby potatoes | 2 lbs | | Olive oil | 3 Tbsp | > Tip: Dry potatoes first. ---
Preparation | Step | Action | |------|--------| | 1 | Pre-heat oven.
Grease the sheet. | | 2 | Roast until golden. | ---
Serving Suggestions
Meat & Pie: Fried chicken. ---
Variations | Variation | What changes | |-----------|--------------| | Spicy | Add cayenne. | --- Enjoy hot.`);

        expect(normalized).toContain('### Why it works');
        expect(normalized).toContain('### Ingredients');
        expect(normalized).toContain('| Item | Quantity |');
        expect(normalized).toContain('|----------------|----------|');
        expect(normalized).toContain('| Baby potatoes | 2 lbs |');
        expect(normalized).toContain('> Tip: Dry potatoes first.');
        expect(normalized).toContain('### Preparation');
        expect(normalized).toContain('| 1 | Pre-heat oven.<br>Grease the sheet. |');
        expect(normalized).toContain('### Serving Suggestions');
        expect(normalized).toContain('### Variations');
        expect(normalized).not.toMatch(/(^|\n)#{1,6}\s*(\n|$)/);
    });

    test('enhances presentation callout blockquotes', () => {
        const helper = Object.create(loadUIHelpersPrototype());
        const html = helper.enhancePresentationCallouts('<blockquote><p>[!WARNING] Check this<br>Review the deployment target.</p></blockquote>');

        expect(html).toContain('kb-callout kb-callout--warning');
        expect(html).toContain('kb-callout__title">Check this</div>');
        expect(html).toContain('Review the deployment target.');
    });

    test('renders progress as one live reasoning block with completed task styling', () => {
        const helper = Object.create(loadUIHelpersPrototype());
        const html = helper.buildAssistantRenderPlan({
            role: 'assistant',
            content: '',
            isStreaming: true,
            reasoningDisplaySource: 'generated',
            reasoningDisplayText: { text: 'Checking the next useful step.' },
            reasoningDisplayFullText: { text: 'Checking the next useful step.' },
            reasoningDisplayTitle: 'Live reasoning',
            reasoningDisplayIcon: 'sparkles',
            progressState: {
                phase: { label: 'executing' },
                detail: { message: 'Running the task list.' },
                completedSteps: 1,
                activeStepIndex: 1,
                steps: [
                    { title: { text: 'Inspect the stream payload' } },
                    { title: { text: 'Render the task list' } },
                    { title: { text: 'Verify the update path' } },
                ],
            },
        }, true).html;

        expect(html).toContain('Live reasoning');
        expect(html).toContain('Checking the next useful step.');
        expect(html).toContain('assistant-progress-card__step--completed');
        expect(html).toContain('assistant-progress-card__step--in_progress');
        expect(html).toContain('Inspect the stream payload');
        expect(html).not.toContain('[object Object]');
        expect(html).not.toContain('assistant-reasoning-ribbon');
        expect(html).not.toContain('Snapshot');
    });

    test('renders progress step titles without visible truncation markers', () => {
        const helper = Object.create(loadUIHelpersPrototype());
        const html = helper.buildAssistantRenderPlan({
            role: 'assistant',
            content: '',
            isStreaming: true,
            reasoningDisplaySource: 'generated',
            reasoningDisplayText: { text: 'Checking the next useful step.' },
            reasoningDisplayFullText: { text: 'Checking the next useful step.' },
            reasoningDisplayTitle: 'Live reasoning',
            reasoningDisplayIcon: 'sparkles',
            progressState: {
                phase: 'executing',
                detail: 'Running the task list.',
                completedSteps: 0,
                activeStepIndex: 0,
                steps: [
                    {
                        title: 'Inspect the deployment state before editing. Then keep reading extra context that should not be shown when the compact step row needs to stay readable for the user because this generated planning note keeps going with implementation details, fallback checks, and final verification notes.',
                        status: 'in_progress',
                    },
                    {
                        title: 'Validate the output after the change [truncated 48 chars]',
                        status: 'pending',
                    },
                ],
            },
        }, true).html;

        expect(html).toContain('Inspect the deployment state before editing.');
        expect(html).toContain('Validate the output after the change');
        expect(html).not.toContain('Then keep reading extra context');
        expect(html).not.toContain('[truncated');
        expect(html).not.toContain('...');
    });
});
