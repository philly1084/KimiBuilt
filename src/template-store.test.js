const fs = require('fs');
const os = require('os');
const path = require('path');
const { TemplateStore } = require('./template-store');

const tempDirs = [];

function createStore() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kimibuilt-template-store-'));
    const storagePath = path.join(directory, 'template-store.json');
    tempDirs.push(directory);
    return new TemplateStore({ storagePath });
}

afterAll(() => {
    tempDirs.forEach((directory) => {
        fs.rmSync(directory, { recursive: true, force: true });
    });
});

describe('TemplateStore', () => {
    test('loads built-in frontend and document templates', async () => {
        const store = createStore();
        await store.initialize();

        expect(store.getTemplate('layout.frontend-html-shell')).toEqual(expect.objectContaining({
            kind: 'layout',
            surface: 'frontend',
        }));
        expect(store.getTemplate('admin-control-room')).toEqual(expect.objectContaining({
            kind: 'dashboard',
            surface: 'frontend',
        }));
        expect(store.getTemplate('executive-brief')).toEqual(expect.objectContaining({
            kind: 'document',
            surface: 'document',
        }));
    });

    test('saves, renders, and reloads recursive custom templates', async () => {
        const store = createStore();
        await store.initialize();

        await store.saveTemplate({
            id: 'fragment.metric-summary',
            name: 'Metric Summary Fragment',
            surface: 'frontend',
            kind: 'fragment',
            format: 'html',
            body: '<section class="metric-fragment"><h2>{{headline}}</h2><p>{{summary}}</p></section>',
        });

        await store.saveTemplate({
            id: 'ops-dashboard-template',
            name: 'Ops Dashboard Template',
            surface: 'frontend',
            kind: 'dashboard',
            format: 'html',
            extends: ['layout.dashboard-shell'],
            defaults: {
                templateId: 'ops-dashboard-template',
            },
            slots: {
                hero: {
                    templateId: 'fragment.metric-summary',
                    variables: {
                        headline: '{{title}}',
                        summary: '{{deck}}',
                    },
                },
                kpis: '<section class="dashboard-kpis"><article class="dashboard-kpi"><span>Incidents</span><strong>{{incidentCount}}</strong></article></section>',
                modules: '<section class="dashboard-grid"><article class="dashboard-card"><h3>{{focusArea}}</h3></article></section>',
                notes: '<section class="dashboard-notes"><article class="dashboard-note"><p>{{operatorNote}}</p></article></section>',
            },
        });

        const render = store.renderTemplate('ops-dashboard-template', {
            title: 'Ops Control',
            deck: 'Track queues, incidents, and ownership in one place.',
            incidentCount: '4',
            focusArea: 'Queue depth',
            operatorNote: 'Escalate anything over 15 minutes.',
        });

        expect(render.content).toContain('Ops Control');
        expect(render.content).toContain('Track queues, incidents, and ownership in one place.');
        expect(render.content).toContain('Queue depth');
        expect(render.graph).toEqual(expect.arrayContaining([
            'layout.dashboard-shell',
            'layout.frontend-html-shell',
            'fragment.metric-summary',
            'ops-dashboard-template',
        ]));

        await store.noteTemplateUse(['ops-dashboard-template']);

        const reloaded = new TemplateStore({ storagePath: store.storagePath });
        await reloaded.initialize();
        expect(reloaded.getTemplate('ops-dashboard-template')).toEqual(expect.objectContaining({
            usageCount: 1,
        }));
    });

    test('detects recursive inheritance chains', async () => {
        const store = createStore();
        await store.initialize();

        await store.saveTemplate({
            id: 'loop-b',
            name: 'Loop B',
            surface: 'document',
            kind: 'document',
            body: 'B',
        });
        await store.saveTemplate({
            id: 'loop-a',
            name: 'Loop A',
            surface: 'document',
            kind: 'document',
            extends: ['loop-b'],
            body: 'A',
        });
        await store.saveTemplate({
            id: 'loop-b',
            name: 'Loop B',
            surface: 'document',
            kind: 'document',
            extends: ['loop-a'],
            body: 'B',
        }, { overwrite: true });

        expect(() => store.renderTemplate('loop-a')).toThrow(/Recursive template inheritance detected/i);
    });
});
