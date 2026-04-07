const { Router } = require('express');
const { validate } = require('../middleware/validate');

const router = Router();

const createTemplateSchema = {
    id: { required: false, type: 'string' },
    name: { required: true, type: 'string' },
    description: { required: false, type: 'string' },
    surface: { required: false, type: 'string' },
    kind: { required: false, type: 'string' },
    format: { required: false, type: 'string' },
    tags: { required: false, type: 'array' },
    promptHints: { required: false, type: 'array' },
    extends: { required: false, type: 'array' },
    variables: { required: false, type: 'object' },
    defaults: { required: false, type: 'object' },
    slots: { required: false, type: 'object' },
    body: { required: false, type: 'string' },
    metadata: { required: false, type: 'object' },
    overwrite: { required: false, type: 'boolean' },
};

const renderTemplateSchema = {
    variables: { required: false, type: 'object' },
};

function getTemplateStore(req) {
    const templateStore = req.app.locals.templateStore;
    if (!templateStore) {
        const error = new Error('Template store is not available');
        error.statusCode = 503;
        throw error;
    }

    return templateStore;
}

function parseLimit(value, fallback = 20) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.max(1, Math.min(Math.floor(parsed), 100));
}

function simplifyTemplate(template = {}, includeBody = false) {
    const simplified = {
        id: template.id,
        name: template.name,
        description: template.description,
        source: template.source,
        surface: template.surface,
        kind: template.kind,
        format: template.format,
        tags: template.tags || [],
        promptHints: template.promptHints || [],
        extends: template.extends || [],
        usageCount: template.usageCount || 0,
        lastUsedAt: template.lastUsedAt || null,
        createdAt: template.createdAt || null,
        updatedAt: template.updatedAt || null,
        metadata: template.metadata || {},
    };

    if (includeBody) {
        simplified.body = template.body || '';
        simplified.variables = template.variables || {};
        simplified.defaults = template.defaults || {};
        simplified.slots = template.slots || {};
    }

    return simplified;
}

router.get('/', async (req, res, next) => {
    try {
        const templateStore = getTemplateStore(req);
        const {
            q = '',
            surface = '',
            kind = '',
            source = '',
            tag = '',
            includeBody = 'false',
        } = req.query;
        const limit = parseLimit(req.query.limit, 20);
        const shouldIncludeBody = String(includeBody).trim().toLowerCase() === 'true';

        const templates = String(q || '').trim()
            ? templateStore.searchTemplates({ query: q, surface, kind, source, tag, limit })
            : templateStore.getTemplates({ surface, kind, source, tag, limit });

        res.json({
            templates: templates.map((template) => simplifyTemplate(template, shouldIncludeBody)),
            count: templates.length,
        });
    } catch (err) {
        next(err);
    }
});

router.get('/:id', async (req, res, next) => {
    try {
        const templateStore = getTemplateStore(req);
        const template = templateStore.getTemplate(req.params.id);
        if (!template) {
            return res.status(404).json({
                error: { message: `Template not found: ${req.params.id}` },
            });
        }

        res.json({
            template: simplifyTemplate(template, true),
        });
    } catch (err) {
        next(err);
    }
});

router.post('/', validate(createTemplateSchema), async (req, res, next) => {
    try {
        const templateStore = getTemplateStore(req);
        const {
            overwrite = false,
            ...templateInput
        } = req.body || {};
        const template = await templateStore.saveTemplate(templateInput, { overwrite });

        res.status(overwrite ? 200 : 201).json({
            success: true,
            template: simplifyTemplate(template, true),
        });
    } catch (err) {
        next(err);
    }
});

router.post('/:id/render', validate(renderTemplateSchema), async (req, res, next) => {
    try {
        const templateStore = getTemplateStore(req);
        const template = templateStore.getTemplate(req.params.id);
        if (!template) {
            return res.status(404).json({
                error: { message: `Template not found: ${req.params.id}` },
            });
        }

        const renderResult = templateStore.renderTemplate(req.params.id, req.body?.variables || {});
        await templateStore.noteTemplateUse([req.params.id]);

        res.json({
            success: true,
            template: simplifyTemplate(templateStore.getTemplate(req.params.id), true),
            render: {
                content: renderResult.content,
                graph: renderResult.graph,
            },
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
