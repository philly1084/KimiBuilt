'use strict';

jest.mock('./documents/template-engine', () => ({
    TemplateEngine: jest.fn(() => ({
        getTemplates: jest.fn(() => [
            null,
            {
                id: 'valid-doc-template',
                name: 'Valid Doc Template',
                description: 'A valid template used for startup seeding tests.',
                category: 'technical',
                blueprint: 'report',
                variables: {},
                formats: ['markdown'],
            },
        ]),
    })),
}));

const { TemplateStore } = require('./template-store');

describe('TemplateStore', () => {
    test('ignores invalid built-in document templates during startup seeding', async () => {
        const store = new TemplateStore({
            storagePath: 'C:\\nonexistent\\template-store.json',
        });

        await expect(store.initialize()).resolves.toBe(store);

        const template = store.getTemplate('valid-doc-template');
        expect(template).toBeTruthy();
        expect(template.metadata.category).toBe('technical');
    });
});
