const fs = require('fs');
const path = require('path');
const { TemplateEngine } = require('./documents/template-engine');
const { DASHBOARD_TEMPLATE_CATALOG } = require('./dashboard-template-catalog');
const {
    PROJECT_ROOT,
    resolvePreferredWritableFile,
} = require('./runtime-state-paths');

const STORE_VERSION = 1;
const REPO_TEMPLATE_STORE_FILE = path.join(PROJECT_ROOT, 'data', 'template-store.json');

function cloneValue(value) {
    if (value === undefined) {
        return undefined;
    }

    return JSON.parse(JSON.stringify(value));
}

function getTemplateStoreFilePath() {
    const configured = String(process.env.KIMIBUILT_TEMPLATE_STORE_PATH || '').trim();
    if (configured) {
        return path.resolve(PROJECT_ROOT, configured);
    }

    return resolvePreferredWritableFile(REPO_TEMPLATE_STORE_FILE, ['template-store.json']);
}

function slugifyTemplateId(value = '') {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9.]+/g, '-')
        .replace(/\.+/g, '.')
        .replace(/^-+|-+$/g, '')
        .replace(/^\.+|\.+$/g, '')
        .replace(/-{2,}/g, '-');
}

function normalizeStringList(value) {
    if (Array.isArray(value)) {
        return value
            .map((entry) => String(entry || '').trim())
            .filter(Boolean);
    }

    if (typeof value === 'string') {
        return value
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean);
    }

    return [];
}

function normalizeExtends(value) {
    const ids = normalizeStringList(value)
        .map((entry) => slugifyTemplateId(entry))
        .filter(Boolean);

    return Array.from(new Set(ids));
}

function normalizeVariableDefinitions(variables = {}) {
    if (Array.isArray(variables)) {
        return variables.reduce((result, entry) => {
            const id = slugifyTemplateId(entry?.id || '');
            if (!id) {
                return result;
            }

            result[id] = {
                ...(entry || {}),
                id,
            };
            return result;
        }, {});
    }

    if (!variables || typeof variables !== 'object') {
        return {};
    }

    return Object.entries(variables).reduce((result, [key, entry]) => {
        const id = slugifyTemplateId(key);
        if (!id) {
            return result;
        }

        result[id] = {
            ...(entry && typeof entry === 'object' ? entry : {}),
            id,
        };
        return result;
    }, {});
}

function extractVariableDefaults(variables = {}) {
    return Object.values(normalizeVariableDefinitions(variables)).reduce((result, entry) => {
        if (entry.default !== undefined) {
            result[entry.id] = cloneValue(entry.default);
        }
        return result;
    }, {});
}

function mergeUniqueStringLists(...lists) {
    const merged = [];
    lists.flat().forEach((entry) => {
        const normalized = String(entry || '').trim();
        if (normalized && !merged.includes(normalized)) {
            merged.push(normalized);
        }
    });
    return merged;
}

function mergePlainObjects(base = {}, override = {}) {
    const result = cloneValue(base) || {};

    Object.entries(override || {}).forEach(([key, value]) => {
        if (Array.isArray(value)) {
            result[key] = cloneValue(value);
            return;
        }

        if (value && typeof value === 'object') {
            const current = result[key];
            if (current && typeof current === 'object' && !Array.isArray(current)) {
                result[key] = mergePlainObjects(current, value);
            } else {
                result[key] = cloneValue(value);
            }
            return;
        }

        result[key] = value;
    });

    return result;
}

function mergeTemplateRecords(parent = {}, child = {}) {
    return {
        ...cloneValue(parent),
        ...cloneValue(child),
        body: child.body != null ? cloneValue(child.body) : cloneValue(parent.body),
        tags: mergeUniqueStringLists(parent.tags || [], child.tags || []),
        promptHints: mergeUniqueStringLists(parent.promptHints || [], child.promptHints || []),
        extends: mergeUniqueStringLists(parent.extends || [], child.extends || []),
        variables: mergePlainObjects(parent.variables || {}, child.variables || {}),
        defaults: mergePlainObjects(parent.defaults || {}, child.defaults || {}),
        slots: mergePlainObjects(parent.slots || {}, child.slots || {}),
        metadata: mergePlainObjects(parent.metadata || {}, child.metadata || {}),
    };
}

function truncatePreview(value = '', limit = 420) {
    const text = String(value || '').replace(/\r\n/g, '\n').trim();
    if (!text) {
        return '';
    }

    if (text.length <= limit) {
        return text;
    }

    return `${text.slice(0, limit - 3).trimEnd()}...`;
}

function escapeHtml(value = '') {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function tokenize(text = '') {
    return Array.from(new Set(
        String(text || '')
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .map((entry) => entry.trim())
            .filter((entry) => entry.length >= 2),
    ));
}

function resolvePathValue(scope = {}, pathText = '') {
    const normalizedPath = String(pathText || '').trim();
    if (!normalizedPath) {
        return undefined;
    }

    if (normalizedPath === '.' || normalizedPath === 'this') {
        return scope.this !== undefined ? scope.this : scope;
    }

    return normalizedPath
        .split('.')
        .reduce((current, segment) => {
            if (current == null) {
                return undefined;
            }
            return current[segment];
        }, scope);
}

function stringifyRenderedValue(value) {
    if (value == null) {
        return '';
    }

    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }

    if (Array.isArray(value)) {
        return value.map((entry) => stringifyRenderedValue(entry)).join('\n');
    }

    if (typeof value === 'object') {
        if (typeof value.body === 'string') {
            return value.body;
        }
        if (typeof value.content === 'string') {
            return value.content;
        }
        return JSON.stringify(value, null, 2);
    }

    return String(value);
}

function createTemplateError(message, statusCode = 400, code = 'TEMPLATE_ERROR') {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function titleCaseFromId(value = '') {
    return String(value || '')
        .split(/[_-]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function buildArrayVariableBlock(variable = {}) {
    const id = variable.id;
    const label = variable.label || titleCaseFromId(id);
    const itemFields = variable.itemFields && typeof variable.itemFields === 'object'
        ? Object.entries(variable.itemFields)
            .map(([fieldId, field]) => ({
                id: slugifyTemplateId(fieldId),
                label: field?.label || titleCaseFromId(fieldId),
            }))
            .filter((field) => field.id)
        : [];

    if (itemFields.length === 0) {
        return `## ${label}\n{{#each ${id}}}\n- {{.}}\n{{/each}}`;
    }

    const lines = [`## ${label}`, `{{#each ${id}}}`];
    itemFields.forEach((field) => {
        lines.push(`- **${field.label}:** {{${field.id}}}`);
    });
    lines.push('{{/each}}');
    return lines.join('\n');
}

function buildDocumentTemplateBody(template = {}) {
    const variables = Object.values(normalizeVariableDefinitions(template.variables));
    const sections = variables
        .filter((entry) => !['title', 'subtitle'].includes(entry.id))
        .map((entry) => {
            if (entry.type === 'array') {
                return buildArrayVariableBlock(entry);
            }

            const label = entry.label || titleCaseFromId(entry.id);
            return `## ${label}\n{{${entry.id}}}`;
        })
        .filter(Boolean);

    return sections.join('\n\n');
}

function buildDocumentTemplateRecords() {
    const engine = new TemplateEngine();
    const templates = engine.getTemplates();

    return templates.map((template) => {
        const variables = normalizeVariableDefinitions(template.variables);
        const defaults = mergePlainObjects({
            title: template.name,
            subtitle: '',
        }, extractVariableDefaults(variables));

        return {
            id: slugifyTemplateId(template.id),
            name: template.name,
            description: template.description || '',
            source: 'built-in',
            surface: 'document',
            kind: 'document',
            format: 'markdown',
            tags: mergeUniqueStringLists(template.tags || [], template.useCases || [], [
                template.category,
                template.blueprint,
            ]),
            promptHints: mergeUniqueStringLists(
                template.useCases || [],
                template.productionProfile?.bestFor || [],
                template.productionProfile?.strengths || [],
            ),
            extends: ['layout.document-shell'],
            variables,
            defaults,
            slots: {
                overview: template.description ? `> ${template.description}` : '',
                body: buildDocumentTemplateBody(template),
            },
            metadata: {
                category: template.category || null,
                blueprint: template.blueprint || null,
                formats: Array.isArray(template.formats) ? template.formats : [],
                recommendedFormats: Array.isArray(template.recommendedFormats)
                    ? template.recommendedFormats
                    : [],
                sourceCollection: 'documents',
            },
        };
    });
}

function buildDashboardModuleCards(modules = []) {
    return (Array.isArray(modules) ? modules : [])
        .map((moduleName) => `
        <article class="dashboard-card">
          <span class="dashboard-card-eyebrow">Module</span>
          <h3>${escapeHtml(moduleName)}</h3>
          <p>Adapt this block to the current product context with real product metrics, owners, and actions.</p>
        </article>`.trim())
        .join('\n');
}

function buildDashboardRecords() {
    return DASHBOARD_TEMPLATE_CATALOG.map((template) => ({
        id: slugifyTemplateId(template.id),
        name: template.label,
        description: template.summary,
        source: 'built-in',
        surface: 'frontend',
        kind: 'dashboard',
        format: 'html',
        tags: mergeUniqueStringLists(template.keywords || [], template.modules || []),
        promptHints: mergeUniqueStringLists([
            template.bestFor,
            template.layout,
            template.visualDirection,
        ]),
        extends: ['layout.dashboard-shell'],
        defaults: {
            title: template.label,
            templateId: template.id,
            headline: template.label,
            description: template.summary,
            bestFor: template.bestFor,
            layoutNote: template.layout,
            visualDirection: template.visualDirection,
        },
        slots: {
            hero: `
              <section class="dashboard-hero" data-dashboard-zone="hero">
                <div>
                  <p class="dashboard-eyebrow">Dashboard Template</p>
                  <h1>{{headline}}</h1>
                  <p class="dashboard-copy">{{description}}</p>
                </div>
                <aside class="dashboard-sidepanel">
                  <span>Best for</span>
                  <strong>{{bestFor}}</strong>
                  <p>{{visualDirection}}</p>
                </aside>
              </section>
            `,
            kpis: `
              <section class="dashboard-kpis" data-dashboard-zone="kpi-rail">
                <article class="dashboard-kpi"><span>Layout</span><strong>${escapeHtml(template.layout)}</strong></article>
                <article class="dashboard-kpi"><span>Modules</span><strong>${String(template.modules?.length || 0)}</strong></article>
                <article class="dashboard-kpi"><span>Focus</span><strong>${escapeHtml(template.bestFor)}</strong></article>
              </section>
            `,
            modules: `
              <section class="dashboard-grid" data-dashboard-zone="modules">
                ${buildDashboardModuleCards(template.modules)}
              </section>
            `,
            notes: `
              <section class="dashboard-notes" data-dashboard-zone="notes">
                <article class="dashboard-note">
                  <h2>Layout Direction</h2>
                  <p>${escapeHtml(template.layout)}</p>
                </article>
                <article class="dashboard-note">
                  <h2>Visual Direction</h2>
                  <p>${escapeHtml(template.visualDirection)}</p>
                </article>
              </section>
            `,
        },
        metadata: {
            modules: Array.isArray(template.modules) ? template.modules : [],
            bestFor: template.bestFor,
            layout: template.layout,
            visualDirection: template.visualDirection,
            sourceCollection: 'dashboards',
        },
    }));
}

function buildFrontendPageTemplates() {
    return [
        {
            id: 'landing-page-editorial',
            name: 'Editorial Landing Page',
            description: 'Narrative-first HTML landing page with a strong hero, proof section, and CTA.',
            source: 'built-in',
            surface: 'frontend',
            kind: 'page',
            format: 'html',
            tags: ['landing page', 'marketing', 'hero', 'cta', 'editorial'],
            promptHints: [
                'Premium product landing pages',
                'Launch story pages',
                'Narrative homepage concepts',
            ],
            extends: ['layout.frontend-html-shell'],
            defaults: {
                title: 'Editorial Landing Page',
                eyebrow: 'Launch',
                headline: 'A narrative-first landing page that feels intentional.',
                deck: 'Use bold hierarchy, a concrete product promise, proof blocks, and a call to action with momentum.',
                ctaLabel: 'Start the project',
            },
            slots: {
                body: `
                  <main class="page-shell editorial-page">
                    <section class="page-hero">
                      <p class="page-eyebrow">{{eyebrow}}</p>
                      <h1>{{headline}}</h1>
                      <p class="page-deck">{{deck}}</p>
                      <button class="page-cta">{{ctaLabel}}</button>
                    </section>
                    <section class="page-grid">
                      <article><span>01</span><h2>Hero frame</h2><p>Lead with one sharp promise and one supporting visual direction.</p></article>
                      <article><span>02</span><h2>Proof band</h2><p>Translate product truth into signal-rich cards, metrics, or screenshots.</p></article>
                      <article><span>03</span><h2>Close</h2><p>End with a deliberate CTA and remove dead-end filler sections.</p></article>
                    </section>
                  </main>
                `,
            },
            metadata: {
                sourceCollection: 'frontend',
            },
        },
        {
            id: 'saas-product-launch-page',
            name: 'SaaS Product Launch Page',
            description: 'Conversion-oriented HTML page for SaaS launches with proof, features, and pricing rhythm.',
            source: 'built-in',
            surface: 'frontend',
            kind: 'page',
            format: 'html',
            tags: ['saas', 'product page', 'launch', 'pricing', 'features'],
            promptHints: [
                'SaaS launch landing pages',
                'Feature marketing pages',
                'Product-led conversion concepts',
            ],
            extends: ['layout.frontend-html-shell'],
            defaults: {
                title: 'SaaS Product Launch Page',
                productName: 'Orbit',
                heroLine: 'Launch a SaaS page that looks product-led, not template-led.',
                subcopy: 'Combine feature framing, proof, pricing, and product UX screenshots into one coherent funnel.',
            },
            slots: {
                body: `
                  <main class="page-shell saas-launch-page">
                    <section class="saas-hero">
                      <div>
                        <p class="page-eyebrow">Product launch</p>
                        <h1>{{heroLine}}</h1>
                        <p class="page-deck">{{subcopy}}</p>
                      </div>
                      <div class="mock-panel">
                        <span>{{productName}}</span>
                        <strong>Activation +32%</strong>
                        <p>Use this panel as a placeholder for live UI proof.</p>
                      </div>
                    </section>
                    <section class="feature-columns">
                      <article><h2>Feature arc</h2><p>Show three to five differentiated product capabilities, not a laundry list.</p></article>
                      <article><h2>Pricing rhythm</h2><p>Keep pricing comparative and close to product proof.</p></article>
                      <article><h2>Adoption proof</h2><p>Back claims with numbers, customer quotes, or workflow screenshots.</p></article>
                    </section>
                  </main>
                `,
            },
            metadata: {
                sourceCollection: 'frontend',
            },
        },
        {
            id: 'docs-overview-page',
            name: 'Documentation Overview Page',
            description: 'Structured HTML documentation homepage with navigation, quickstart, and system map sections.',
            source: 'built-in',
            surface: 'frontend',
            kind: 'page',
            format: 'html',
            tags: ['documentation', 'docs', 'developer', 'quickstart', 'reference'],
            promptHints: [
                'Developer documentation overviews',
                'Product docs hubs',
                'Technical quickstart pages',
            ],
            extends: ['layout.frontend-html-shell'],
            defaults: {
                title: 'Documentation Overview',
                productName: 'Platform',
            },
            slots: {
                body: `
                  <main class="page-shell docs-overview-page">
                    <section class="docs-header">
                      <p class="page-eyebrow">Documentation</p>
                      <h1>{{productName}} docs that orient fast.</h1>
                      <p class="page-deck">Open with architecture, quickstart steps, and the routes people actually need first.</p>
                    </section>
                    <section class="docs-grid">
                      <article><h2>Quickstart</h2><p>Make setup linear, observable, and copy-pastable.</p></article>
                      <article><h2>Core concepts</h2><p>Explain architecture, moving parts, and trust boundaries before API details.</p></article>
                      <article><h2>Reference</h2><p>Keep endpoint or component reference dense, searchable, and separate from narrative guides.</p></article>
                    </section>
                  </main>
                `,
            },
            metadata: {
                sourceCollection: 'frontend',
            },
        },
    ];
}

function buildBaseTemplates() {
    return [
        {
            id: 'layout.document-shell',
            name: 'Document Shell',
            description: 'Base markdown document shell with overview, body, and footer slots.',
            source: 'built-in',
            surface: 'document',
            kind: 'layout',
            format: 'markdown',
            tags: ['layout', 'document', 'markdown'],
            promptHints: ['Reusable document scaffold'],
            defaults: {
                title: 'Untitled Document',
                subtitle: '',
            },
            slots: {
                overview: '',
                body: '',
                footer: '',
            },
            body: `# {{title}}

{{#if subtitle}}{{subtitle}}{{/if}}

{{slot:overview}}

{{slot:body}}

{{slot:footer}}`,
            metadata: {
                sourceCollection: 'base',
            },
        },
        {
            id: 'layout.frontend-html-shell',
            name: 'Frontend HTML Shell',
            description: 'Base standalone HTML shell for reusable page and dashboard templates.',
            source: 'built-in',
            surface: 'frontend',
            kind: 'layout',
            format: 'html',
            tags: ['layout', 'html', 'page'],
            promptHints: ['Standalone HTML scaffold'],
            defaults: {
                title: 'Untitled Page',
                templateId: 'template',
            },
            slots: {
                head: '',
                body: '',
                scripts: '',
            },
            body: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{title}}</title>
  <style>
    :root {
      --bg: #f4efe7;
      --surface: rgba(255, 255, 255, 0.82);
      --panel: #ffffff;
      --ink: #1f2937;
      --muted: #6b7280;
      --accent: #b45309;
      --accent-soft: rgba(251, 191, 36, 0.18);
      --border: rgba(15, 23, 42, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Arial, sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, var(--accent-soft), transparent 28%),
        linear-gradient(180deg, #fcfaf6, var(--bg));
    }
    h1, h2, h3, p { margin-top: 0; }
    .page-shell {
      max-width: 1180px;
      margin: 0 auto;
      padding: 48px 24px 72px;
    }
    .page-eyebrow {
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-size: 0.78rem;
      font-weight: 700;
      color: var(--accent);
    }
    .page-hero, .saas-hero, .docs-header, .dashboard-hero {
      display: grid;
      gap: 24px;
      border: 1px solid var(--border);
      background: var(--surface);
      backdrop-filter: blur(12px);
      border-radius: 28px;
      padding: 28px;
      box-shadow: 0 20px 60px rgba(15, 23, 42, 0.08);
    }
    .page-hero h1, .saas-hero h1, .docs-header h1, .dashboard-hero h1 {
      font-size: clamp(2.6rem, 6vw, 5rem);
      line-height: 0.94;
      max-width: 12ch;
    }
    .page-deck, .dashboard-copy {
      color: var(--muted);
      font-size: 1.05rem;
      line-height: 1.7;
      max-width: 58ch;
    }
    .page-grid, .feature-columns, .docs-grid, .dashboard-grid, .dashboard-notes {
      display: grid;
      gap: 18px;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      margin-top: 20px;
    }
    .page-grid article, .feature-columns article, .docs-grid article, .dashboard-card, .dashboard-note, .dashboard-sidepanel, .mock-panel {
      border-radius: 22px;
      border: 1px solid var(--border);
      background: var(--panel);
      padding: 20px;
      box-shadow: 0 12px 34px rgba(15, 23, 42, 0.05);
    }
    .dashboard-kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
      margin-top: 18px;
    }
    .dashboard-kpi {
      border-radius: 18px;
      background: var(--panel);
      border: 1px solid var(--border);
      padding: 18px;
    }
    .dashboard-kpi span, .dashboard-card-eyebrow {
      display: block;
      color: var(--muted);
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .dashboard-kpi strong {
      display: block;
      margin-top: 8px;
      font-size: 1.4rem;
    }
    .page-cta {
      border: 0;
      border-radius: 999px;
      padding: 14px 20px;
      font-weight: 700;
      color: #fff;
      background: linear-gradient(135deg, #b45309, #ea580c);
      width: fit-content;
      cursor: pointer;
    }
    @media (max-width: 768px) {
      .page-shell { padding: 28px 16px 44px; }
      .page-hero h1, .saas-hero h1, .docs-header h1, .dashboard-hero h1 {
        max-width: none;
      }
    }
  </style>
  {{slot:head}}
</head>
<body data-template-id="{{templateId}}">
{{slot:body}}
{{slot:scripts}}
</body>
</html>`,
            metadata: {
                sourceCollection: 'base',
            },
        },
        {
            id: 'layout.dashboard-shell',
            name: 'Dashboard Shell',
            description: 'Standalone dashboard scaffold with hero, KPI rail, module grid, and notes slots.',
            source: 'built-in',
            surface: 'frontend',
            kind: 'layout',
            format: 'html',
            tags: ['layout', 'dashboard', 'html'],
            promptHints: ['Reusable dashboard scaffold'],
            extends: ['layout.frontend-html-shell'],
            defaults: {
                title: 'Dashboard',
                templateId: 'dashboard-template',
            },
            slots: {
                hero: '',
                kpis: '',
                modules: '',
                notes: '',
            },
            body: `
              <main class="page-shell dashboard-shell" data-dashboard-template="{{templateId}}">
                {{slot:hero}}
                {{slot:kpis}}
                {{slot:modules}}
                {{slot:notes}}
              </main>
            `,
            metadata: {
                sourceCollection: 'base',
            },
        },
    ];
}

function buildBuiltInTemplates() {
    return [
        ...buildBaseTemplates(),
        ...buildFrontendPageTemplates(),
        ...buildDashboardRecords(),
        ...buildDocumentTemplateRecords(),
    ];
}

class TemplateStore {
    constructor({ storagePath = getTemplateStoreFilePath() } = {}) {
        this.storagePath = storagePath;
        this.templates = new Map();
        this.templateStats = new Map();
        this.initialized = false;
        this.seedBuiltInTemplates();
    }

    seedBuiltInTemplates() {
        buildBuiltInTemplates().forEach((template) => {
            this.templates.set(template.id, this.normalizeTemplate(template, { source: 'built-in' }));
        });
    }

    async initialize() {
        this.seedBuiltInTemplates();
        await this.load();
        this.initialized = true;
        return this;
    }

    async load() {
        try {
            const content = await fs.promises.readFile(this.storagePath, 'utf8');
            const parsed = JSON.parse(content);
            const templates = Array.isArray(parsed?.templates) ? parsed.templates : [];
            const stats = parsed?.stats && typeof parsed.stats === 'object' ? parsed.stats : {};

            templates.forEach((template) => {
                const normalized = this.normalizeTemplate(template, { source: 'custom' });
                this.templates.set(normalized.id, normalized);
            });

            Object.entries(stats).forEach(([templateId, entry]) => {
                const normalizedId = slugifyTemplateId(templateId);
                if (!normalizedId) {
                    return;
                }

                this.templateStats.set(normalizedId, {
                    usageCount: Math.max(0, Number(entry?.usageCount) || 0),
                    lastUsedAt: entry?.lastUsedAt || null,
                });
            });
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }

    async persist() {
        const customTemplates = Array.from(this.templates.values())
            .filter((template) => template.source === 'custom')
            .sort((a, b) => a.id.localeCompare(b.id));
        const stats = {};

        Array.from(this.templateStats.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .forEach(([templateId, entry]) => {
                stats[templateId] = {
                    usageCount: Math.max(0, Number(entry?.usageCount) || 0),
                    lastUsedAt: entry?.lastUsedAt || null,
                };
            });

        await fs.promises.mkdir(path.dirname(this.storagePath), { recursive: true });
        await fs.promises.writeFile(this.storagePath, JSON.stringify({
            version: STORE_VERSION,
            templates: customTemplates,
            stats,
        }, null, 2), 'utf8');
    }

    normalizeTemplate(template = {}, { source = null } = {}) {
        const id = slugifyTemplateId(template.id || template.name || '');
        if (!id) {
            throw createTemplateError('Template id or name is required.', 400, 'TEMPLATE_INVALID');
        }

        const normalizedSource = String(source || template.source || 'custom').trim().toLowerCase();
        const variables = normalizeVariableDefinitions(template.variables);
        const defaults = mergePlainObjects(
            extractVariableDefaults(variables),
            template.defaults && typeof template.defaults === 'object' ? template.defaults : {},
        );
        const body = typeof template.body === 'string'
            ? template.body
            : (typeof template.content === 'string' ? template.content : null);
        const slots = template.slots && typeof template.slots === 'object' && !Array.isArray(template.slots)
            ? cloneValue(template.slots)
            : {};
        const normalized = {
            id,
            name: String(template.name || titleCaseFromId(id)).trim(),
            description: String(template.description || '').trim(),
            source: normalizedSource,
            surface: String(template.surface || 'any').trim().toLowerCase() || 'any',
            kind: String(template.kind || 'template').trim().toLowerCase() || 'template',
            format: String(template.format || 'text').trim().toLowerCase() || 'text',
            tags: normalizeStringList(template.tags),
            promptHints: normalizeStringList(template.promptHints),
            extends: normalizeExtends(template.extends || template.inherits || template.parentId || []),
            variables,
            defaults,
            slots,
            body,
            metadata: template.metadata && typeof template.metadata === 'object' && !Array.isArray(template.metadata)
                ? cloneValue(template.metadata)
                : {},
            createdAt: template.createdAt || null,
            updatedAt: template.updatedAt || null,
        };

        if (!normalized.body && normalized.extends.length === 0 && Object.keys(normalized.slots).length === 0) {
            throw createTemplateError(
                `Template '${normalized.id}' must provide body, extends, or slots.`,
                400,
                'TEMPLATE_INVALID',
            );
        }

        return normalized;
    }

    buildUniqueId(name = 'template') {
        const baseId = slugifyTemplateId(name) || 'template';
        if (!this.templates.has(baseId)) {
            return baseId;
        }

        let counter = 2;
        let nextId = `${baseId}-${counter}`;
        while (this.templates.has(nextId)) {
            counter += 1;
            nextId = `${baseId}-${counter}`;
        }
        return nextId;
    }

    getTemplate(templateId = '') {
        const normalizedId = slugifyTemplateId(templateId);
        if (!normalizedId) {
            return null;
        }

        const template = this.templates.get(normalizedId);
        if (!template) {
            return null;
        }

        const stats = this.templateStats.get(normalizedId) || {};
        return {
            ...cloneValue(template),
            usageCount: Math.max(0, Number(stats.usageCount) || 0),
            lastUsedAt: stats.lastUsedAt || null,
        };
    }

    getTemplates({ surface = '', kind = '', source = '', tag = '', limit = null } = {}) {
        const normalizedSurface = String(surface || '').trim().toLowerCase();
        const normalizedKind = String(kind || '').trim().toLowerCase();
        const normalizedSource = String(source || '').trim().toLowerCase();
        const normalizedTag = String(tag || '').trim().toLowerCase();
        const maxResults = limit == null ? null : Math.max(1, Number(limit) || 1);

        let templates = Array.from(this.templates.keys())
            .map((templateId) => this.getTemplate(templateId))
            .filter(Boolean);

        if (normalizedSurface) {
            templates = templates.filter((template) => (
                template.surface === normalizedSurface
                || template.surface === 'any'
            ));
        }

        if (normalizedKind) {
            templates = templates.filter((template) => template.kind === normalizedKind);
        }

        if (normalizedSource) {
            templates = templates.filter((template) => template.source === normalizedSource);
        }

        if (normalizedTag) {
            templates = templates.filter((template) => (
                Array.isArray(template.tags)
                && template.tags.some((entry) => String(entry || '').trim().toLowerCase() === normalizedTag)
            ));
        }

        templates.sort((a, b) => (
            (Number(b.usageCount) || 0) - (Number(a.usageCount) || 0)
            || a.name.localeCompare(b.name)
        ));

        if (maxResults != null) {
            return templates.slice(0, maxResults);
        }

        return templates;
    }

    scoreTemplate(template = {}, query = '', { surface = '', kind = '' } = {}) {
        const haystack = [
            template.id,
            template.name,
            template.description,
            template.kind,
            template.surface,
            ...(Array.isArray(template.tags) ? template.tags : []),
            ...(Array.isArray(template.promptHints) ? template.promptHints : []),
            template.metadata?.blueprint,
            template.metadata?.category,
            template.metadata?.bestFor,
            template.metadata?.layout,
        ]
            .map((entry) => String(entry || '').toLowerCase())
            .join(' ');
        const tokens = tokenize(query);
        let score = 0;

        if (!query) {
            score += Number(template.usageCount) || 0;
        }

        tokens.forEach((token) => {
            if (template.id === token) {
                score += 18;
            } else if (template.id.includes(token)) {
                score += 12;
            }

            if (String(template.name || '').toLowerCase().includes(token)) {
                score += 10;
            }

            if (haystack.includes(token)) {
                score += 4;
            }
        });

        const normalizedSurface = String(surface || '').trim().toLowerCase();
        const normalizedKind = String(kind || '').trim().toLowerCase();
        if (normalizedSurface) {
            if (template.surface === normalizedSurface) {
                score += 10;
            } else if (template.surface !== 'any') {
                score -= 4;
            }
        }

        if (normalizedKind) {
            if (template.kind === normalizedKind) {
                score += 10;
            } else {
                score -= 3;
            }
        }

        score += Math.min(10, Number(template.usageCount) || 0);
        return score;
    }

    searchTemplates({ query = '', surface = '', kind = '', source = '', tag = '', limit = 6 } = {}) {
        const templates = this.getTemplates({ surface, kind, source, tag })
            .map((template) => ({
                ...template,
                score: this.scoreTemplate(template, query, { surface, kind }),
            }))
            .filter((template) => template.score > 0 || !query)
            .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

        return templates.slice(0, Math.max(1, Number(limit) || 1));
    }

    async saveTemplate(template = {}, { overwrite = false } = {}) {
        const incoming = { ...template };
        if (!incoming.id) {
            incoming.id = this.buildUniqueId(incoming.name || 'template');
        }

        const normalized = this.normalizeTemplate(incoming, { source: 'custom' });
        const existing = this.getTemplate(normalized.id);

        if (existing?.source === 'built-in') {
            throw createTemplateError(
                `Cannot overwrite built-in template '${normalized.id}'. Save with a new id instead.`,
                409,
                'TEMPLATE_CONFLICT',
            );
        }

        if (existing && !overwrite) {
            throw createTemplateError(
                `Template '${normalized.id}' already exists.`,
                409,
                'TEMPLATE_CONFLICT',
            );
        }

        const now = new Date().toISOString();
        const stored = {
            ...normalized,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
        };

        this.templates.set(stored.id, stored);
        await this.persist();
        return this.getTemplate(stored.id);
    }

    async noteTemplateUse(templateIds = []) {
        const ids = normalizeStringList(templateIds)
            .map((entry) => slugifyTemplateId(entry))
            .filter((entry) => this.templates.has(entry));

        if (ids.length === 0) {
            return;
        }

        const now = new Date().toISOString();
        ids.forEach((templateId) => {
            const current = this.templateStats.get(templateId) || { usageCount: 0, lastUsedAt: null };
            this.templateStats.set(templateId, {
                usageCount: Math.max(0, Number(current.usageCount) || 0) + 1,
                lastUsedAt: now,
            });
        });

        await this.persist();
    }

    resolveTemplate(templateId = '', stack = []) {
        const normalizedId = slugifyTemplateId(templateId);
        if (!normalizedId) {
            throw createTemplateError('Template id is required.', 400, 'TEMPLATE_INVALID');
        }

        if (stack.includes(normalizedId)) {
            throw createTemplateError(
                `Recursive template inheritance detected: ${[...stack, normalizedId].join(' -> ')}`,
                400,
                'TEMPLATE_RECURSION_DETECTED',
            );
        }

        const template = this.getTemplate(normalizedId);
        if (!template) {
            throw createTemplateError(`Template not found: ${normalizedId}`, 404, 'TEMPLATE_NOT_FOUND');
        }

        const parentIds = Array.isArray(template.extends) ? template.extends : [];
        let resolved = cloneValue(template);
        let lineage = [normalizedId];

        parentIds.forEach((parentId) => {
            const parentResolved = this.resolveTemplate(parentId, [...stack, normalizedId]);
            resolved = mergeTemplateRecords(parentResolved.template, resolved);
            lineage = mergeUniqueStringLists(parentResolved.lineage, lineage);
        });

        resolved.id = normalizedId;
        return {
            template: resolved,
            lineage,
        };
    }

    renderTemplateValue(value, context, state) {
        if (typeof value === 'string') {
            return this.renderTemplateString(value, context, state);
        }

        if (Array.isArray(value)) {
            return value.map((entry) => this.renderTemplateValue(entry, context, state));
        }

        if (value && typeof value === 'object') {
            if (typeof value.templateId === 'string') {
                const nestedVariables = value.variables && typeof value.variables === 'object'
                    ? Object.entries(value.variables).reduce((result, [key, entry]) => {
                        result[key] = this.renderTemplateValue(entry, context, state);
                        return result;
                    }, {})
                    : {};
                const nested = this.renderTemplate(value.templateId, mergePlainObjects(context.scope, nestedVariables), state);
                return nested.content;
            }

            return Object.entries(value).reduce((result, [key, entry]) => {
                result[key] = this.renderTemplateValue(entry, context, state);
                return result;
            }, {});
        }

        return value;
    }

    renderTemplateString(source = '', context, state) {
        let rendered = String(source || '');

        rendered = rendered.replace(/\{\{#if\s+([a-zA-Z0-9_.-]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_match, pathText, content) => {
            const value = resolvePathValue(context.scope, pathText);
            if (!value) {
                return '';
            }
            return this.renderTemplateString(content, context, state);
        });

        rendered = rendered.replace(/\{\{#each\s+([a-zA-Z0-9_.-]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_match, pathText, content) => {
            const collection = resolvePathValue(context.scope, pathText);
            if (!Array.isArray(collection) || collection.length === 0) {
                return '';
            }

            return collection.map((entry, index) => {
                const itemScope = entry && typeof entry === 'object' && !Array.isArray(entry)
                    ? { ...context.scope, this: entry, index, ...entry }
                    : { ...context.scope, this: entry, index, value: entry };
                return this.renderTemplateString(content, {
                    ...context,
                    scope: itemScope,
                }, state);
            }).join('');
        });

        rendered = rendered.replace(/\{\{slot:([a-zA-Z0-9_.-]+)\}\}/g, (_match, slotName) => {
            if (!context.resolveSlot) {
                return '';
            }
            return context.resolveSlot(slotName);
        });

        rendered = rendered.replace(/\{\{include:([a-zA-Z0-9_.-]+)\}\}/g, (_match, templateId) => {
            const nested = this.renderTemplate(templateId, context.scope, state);
            return nested.content;
        });

        rendered = rendered.replace(/\{\{\{?\s*([a-zA-Z0-9_.-]+)\s*\}?\}\}/g, (_match, pathText) => {
            const value = resolvePathValue(context.scope, pathText);
            return stringifyRenderedValue(value);
        });

        return rendered;
    }

    renderTemplate(templateId = '', variables = {}, existingState = null) {
        const state = existingState || {
            usedTemplateIds: new Set(),
        };
        const { template, lineage } = this.resolveTemplate(templateId);
        lineage.forEach((entry) => state.usedTemplateIds.add(entry));

        const scope = mergePlainObjects(template.defaults || {}, variables && typeof variables === 'object' ? variables : {});
        const slotCache = new Map();
        const slotStack = [];
        const context = {
            scope,
            resolveSlot: (slotName) => {
                const normalizedSlotName = String(slotName || '').trim();
                if (!normalizedSlotName) {
                    return '';
                }

                if (slotCache.has(normalizedSlotName)) {
                    return slotCache.get(normalizedSlotName);
                }

                if (slotStack.includes(normalizedSlotName)) {
                    throw createTemplateError(
                        `Recursive slot detected in template '${template.id}': ${[...slotStack, normalizedSlotName].join(' -> ')}`,
                        400,
                        'TEMPLATE_RECURSION_DETECTED',
                    );
                }

                slotStack.push(normalizedSlotName);
                const slotValue = template.slots?.[normalizedSlotName];
                const renderedSlot = this.renderTemplateValue(slotValue, context, state);
                const normalizedSlot = stringifyRenderedValue(renderedSlot);
                slotStack.pop();
                slotCache.set(normalizedSlotName, normalizedSlot);
                return normalizedSlot;
            },
        };

        const content = stringifyRenderedValue(this.renderTemplateValue(template.body || '', context, state));
        return {
            template,
            content,
            graph: Array.from(state.usedTemplateIds),
        };
    }

    summarizeTemplate(template = {}, { preview = '' } = {}) {
        return {
            id: template.id,
            name: template.name,
            description: template.description,
            source: template.source,
            surface: template.surface,
            kind: template.kind,
            format: template.format,
            tags: template.tags || [],
            extends: template.extends || [],
            usageCount: template.usageCount || 0,
            lastUsedAt: template.lastUsedAt || null,
            preview,
        };
    }

    buildPromptContext({
        explicitTemplateIds = [],
        query = '',
        existingContent = '',
        surface = '',
        kind = '',
        limit = 3,
        variables = {},
    } = {}) {
        const matches = [];
        const seen = new Set();
        const normalizedExplicit = normalizeStringList(explicitTemplateIds)
            .map((entry) => slugifyTemplateId(entry))
            .filter(Boolean);

        normalizedExplicit.forEach((templateId) => {
            const template = this.getTemplate(templateId);
            if (template && !seen.has(template.id)) {
                seen.add(template.id);
                matches.push(template);
            }
        });

        const searchQuery = [query, existingContent].filter(Boolean).join('\n');
        if (matches.length < limit) {
            const found = this.searchTemplates({
                query: searchQuery,
                surface,
                kind,
                limit: Math.max(limit, 4),
            });

            found.forEach((template) => {
                if (matches.length >= limit || seen.has(template.id)) {
                    return;
                }
                seen.add(template.id);
                matches.push(template);
            });
        }

        if (matches.length === 0 && kind) {
            this.searchTemplates({
                query: searchQuery,
                surface,
                limit: Math.max(limit, 4),
            }).forEach((template) => {
                if (matches.length >= limit || seen.has(template.id)) {
                    return;
                }
                seen.add(template.id);
                matches.push(template);
            });
        }

        const summaries = matches.map((template) => {
            let preview = truncatePreview(template.body || '', 260);
            try {
                const previewLimit = normalizedExplicit.includes(template.id) ? 520 : 260;
                preview = truncatePreview(this.renderTemplate(template.id, variables).content, previewLimit);
            } catch (_error) {
                preview = truncatePreview(template.body || '', 260);
            }

            return this.summarizeTemplate(template, { preview });
        });

        if (summaries.length === 0) {
            return { matches: [], context: '' };
        }

        const lines = [
            '[Reference pattern library]',
            'Use these patterns as reusable structure and composition guidance. Adapt, combine, or ignore them when the request calls for a better fit.',
            'Keep the architecture, information flow, and section logic; rewrite the copy, labels, and specifics for the current request.',
            'Never surface template ids, reference labels, or internal library wording in the final user-visible output.',
        ];

        summaries.forEach((template, index) => {
            lines.push(
                `- ${template.name} [${template.id}] | surface=${template.surface} | kind=${template.kind} | source=${template.source} | usage=${template.usageCount || 0}`,
            );
            if (template.description) {
                lines.push(`  Description: ${template.description}`);
            }
            if (Array.isArray(template.extends) && template.extends.length > 0) {
                lines.push(`  Extends: ${template.extends.join(', ')}`);
            }
            if (Array.isArray(template.tags) && template.tags.length > 0) {
                lines.push(`  Tags: ${template.tags.join(', ')}`);
            }
            if (template.preview) {
                lines.push('  Preview:');
                lines.push(template.preview);
            }
        });

        return {
            matches: summaries,
            context: lines.join('\n'),
        };
    }
}

module.exports = {
    STORE_VERSION,
    TemplateStore,
    getTemplateStoreFilePath,
    slugifyTemplateId,
};
