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
});
