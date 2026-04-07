const express = require('express');
const request = require('supertest');

jest.mock('../middleware/validate', () => ({
    validate: () => (_req, _res, next) => next(),
}));

const templatesRouter = require('./templates');

describe('/api/templates routes', () => {
    function buildApp(templateStore) {
        const app = express();
        app.use(express.json());
        app.locals.templateStore = templateStore;
        app.use('/api/templates', templatesRouter);
        return app;
    }

    test('lists templates through the store search interface', async () => {
        const templateStore = {
            searchTemplates: jest.fn().mockReturnValue([
                {
                    id: 'admin-control-room',
                    name: 'Admin Control Room',
                    description: 'Admin dashboard',
                    source: 'built-in',
                    surface: 'frontend',
                    kind: 'dashboard',
                    format: 'html',
                    tags: ['admin'],
                    promptHints: [],
                    extends: ['layout.dashboard-shell'],
                    usageCount: 3,
                    metadata: {},
                },
            ]),
        };

        const response = await request(buildApp(templateStore))
            .get('/api/templates')
            .query({ q: 'admin dashboard' });

        expect(response.status).toBe(200);
        expect(templateStore.searchTemplates).toHaveBeenCalledWith(expect.objectContaining({
            query: 'admin dashboard',
        }));
        expect(response.body.templates).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'admin-control-room' }),
        ]));
    });

    test('creates a custom template', async () => {
        const templateStore = {
            saveTemplate: jest.fn().mockResolvedValue({
                id: 'ops-dashboard',
                name: 'Ops Dashboard',
                description: 'Custom dashboard',
                source: 'custom',
                surface: 'frontend',
                kind: 'dashboard',
                format: 'html',
                tags: ['ops'],
                promptHints: [],
                extends: ['layout.dashboard-shell'],
                variables: {},
                defaults: {},
                slots: {},
                body: '<main>Ops</main>',
                usageCount: 0,
                metadata: {},
                createdAt: '2026-04-06T00:00:00.000Z',
                updatedAt: '2026-04-06T00:00:00.000Z',
            }),
        };

        const response = await request(buildApp(templateStore))
            .post('/api/templates')
            .send({
                name: 'Ops Dashboard',
                surface: 'frontend',
                kind: 'dashboard',
                format: 'html',
                body: '<main>Ops</main>',
            });

        expect(response.status).toBe(201);
        expect(templateStore.saveTemplate).toHaveBeenCalled();
        expect(response.body.template).toEqual(expect.objectContaining({
            name: 'Ops Dashboard',
            body: '<main>Ops</main>',
        }));
    });

    test('renders a template and records usage', async () => {
        const templateStore = {
            getTemplate: jest.fn()
                .mockReturnValueOnce({
                    id: 'executive-brief',
                    name: 'Executive Brief',
                    description: 'Brief',
                    source: 'built-in',
                    surface: 'document',
                    kind: 'document',
                    format: 'markdown',
                    tags: ['brief'],
                    promptHints: [],
                    extends: ['layout.document-shell'],
                    variables: {},
                    defaults: {},
                    slots: {},
                    body: '# {{title}}',
                    usageCount: 0,
                    metadata: {},
                })
                .mockReturnValueOnce({
                    id: 'executive-brief',
                    name: 'Executive Brief',
                    description: 'Brief',
                    source: 'built-in',
                    surface: 'document',
                    kind: 'document',
                    format: 'markdown',
                    tags: ['brief'],
                    promptHints: [],
                    extends: ['layout.document-shell'],
                    variables: {},
                    defaults: {},
                    slots: {},
                    body: '# {{title}}',
                    usageCount: 1,
                    metadata: {},
                }),
            renderTemplate: jest.fn().mockReturnValue({
                content: '# Q2 Brief',
                graph: ['layout.document-shell', 'executive-brief'],
            }),
            noteTemplateUse: jest.fn().mockResolvedValue(undefined),
        };

        const response = await request(buildApp(templateStore))
            .post('/api/templates/executive-brief/render')
            .send({
                variables: {
                    title: 'Q2 Brief',
                },
            });

        expect(response.status).toBe(200);
        expect(templateStore.renderTemplate).toHaveBeenCalledWith('executive-brief', { title: 'Q2 Brief' });
        expect(templateStore.noteTemplateUse).toHaveBeenCalledWith(['executive-brief']);
        expect(response.body.render).toEqual(expect.objectContaining({
            content: '# Q2 Brief',
        }));
    });
});
