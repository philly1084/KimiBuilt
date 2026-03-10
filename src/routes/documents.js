/**
 * Document Creation Routes
 * API endpoints for template-based, AI-powered, and assembly document generation
 */

const { Router } = require('express');
const { validate } = require('../middleware/validate');

const router = Router();

// Validation schemas
const generateSchema = {
  templateId: { required: true, type: 'string' },
  variables: { required: true, type: 'object' },
  format: { required: true, type: 'string' },
  options: { required: false, type: 'object' }
};

const aiGenerateSchema = {
  prompt: { required: true, type: 'string' },
  documentType: { required: false, type: 'string' },
  tone: { required: false, type: 'string' },
  length: { required: false, type: 'string' },
  format: { required: false, type: 'string' },
  options: { required: false, type: 'object' },
  model: { required: false, type: 'string' }
};

const expandOutlineSchema = {
  outline: { required: true, type: 'array' },
  title: { required: false, type: 'string' },
  tone: { required: false, type: 'string' },
  length: { required: false, type: 'string' },
  format: { required: false, type: 'string' },
  options: { required: false, type: 'object' },
  model: { required: false, type: 'string' }
};

const dataGenerateSchema = {
  data: { required: true, type: 'object' },
  templateId: { required: true, type: 'string' },
  format: { required: false, type: 'string' },
  options: { required: false, type: 'object' }
};

const assembleSchema = {
  sources: { required: true, type: 'array' },
  format: { required: true, type: 'string' },
  options: { required: false, type: 'object' }
};

const convertSchema = {
  documentId: { required: true, type: 'string' },
  toFormat: { required: true, type: 'string' }
};

/**
 * GET /api/documents/templates
 * List all available templates
 */
router.get('/templates', async (req, res, next) => {
  try {
    const { category } = req.query;
    const documentService = req.app.locals.documentService;
    
    const templates = await documentService.getTemplates(category);
    
    // Return simplified template info (without full structure)
    const simplified = templates.map(t => ({
      id: t.id,
      name: t.name,
      category: t.category,
      description: t.description,
      icon: t.icon,
      tags: t.tags,
      formats: t.formats
    }));
    
    res.json({
      templates: simplified,
      categories: documentService.templateEngine.getCategories(),
      count: simplified.length
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/documents/templates/:id
 * Get specific template details
 */
router.get('/templates/:id', async (req, res, next) => {
  try {
    const documentService = req.app.locals.documentService;
    const template = await documentService.getTemplate(req.params.id);
    
    if (!template) {
      return res.status(404).json({ 
        error: { message: `Template not found: ${req.params.id}` } 
      });
    }
    
    res.json({
      template: {
        id: template.id,
        name: template.name,
        category: template.category,
        description: template.description,
        icon: template.icon,
        tags: template.tags,
        formats: template.formats,
        variables: template.variables,
        aiEnhancement: template.aiEnhancement,
        variants: template.variants
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/documents/templates/:id/defaults
 * Get default variable values for a template
 */
router.get('/templates/:id/defaults', async (req, res, next) => {
  try {
    const documentService = req.app.locals.documentService;
    const template = documentService.templateEngine.getTemplate(req.params.id);
    
    if (!template) {
      return res.status(404).json({ 
        error: { message: `Template not found: ${req.params.id}` } 
      });
    }
    
    const defaults = documentService.templateEngine.getDefaultVariables(req.params.id);
    
    res.json({
      templateId: req.params.id,
      defaults
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/documents/formats
 * List supported document formats
 */
router.get('/formats', (req, res) => {
  const documentService = req.app.locals.documentService;
  
  res.json({
    formats: documentService.getSupportedFormats()
  });
});

/**
 * POST /api/documents/generate
 * Generate document from template
 */
router.post('/generate', validate(generateSchema), async (req, res, next) => {
  try {
    const { templateId, variables, format, options = {} } = req.body;
    const documentService = req.app.locals.documentService;
    
    const document = await documentService.generateFromTemplate(
      templateId, 
      variables, 
      format, 
      options
    );
    
    // Set appropriate headers
    res.setHeader('Content-Type', document.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${document.filename}"`);
    res.setHeader('X-Document-Id', document.id);
    res.setHeader('X-Document-Metadata', JSON.stringify(document.metadata));
    
    res.send(document.content);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/documents/ai-generate
 * Generate document using AI
 */
router.post('/ai-generate', validate(aiGenerateSchema), async (req, res, next) => {
  try {
    const { 
      prompt, 
      documentType, 
      tone = 'professional', 
      length = 'medium',
      format = 'docx',
      options = {},
      model
    } = req.body;
    
    const documentService = req.app.locals.documentService;
    
    const document = await documentService.aiGenerate(prompt, {
      documentType,
      tone,
      length,
      format,
      model,
      ...options
    });
    
    res.setHeader('Content-Type', document.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${document.filename}"`);
    res.setHeader('X-Document-Id', document.id);
    res.setHeader('X-Document-Metadata', JSON.stringify(document.metadata));
    
    res.json({
      success: true,
      document: {
        id: document.id,
        filename: document.filename,
        mimeType: document.mimeType,
        size: document.size,
        metadata: document.metadata,
        preview: document.preview
      },
      downloadUrl: `/api/documents/${document.id}/download`
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/documents/expand-outline
 * Expand an outline into a full document
 */
router.post('/expand-outline', validate(expandOutlineSchema), async (req, res, next) => {
  try {
    const {
      outline,
      title,
      tone = 'professional',
      length = 'medium',
      format = 'docx',
      options = {},
      model
    } = req.body;
    
    const documentService = req.app.locals.documentService;
    
    const document = await documentService.expandOutline(outline, {
      title,
      tone,
      length,
      format,
      model,
      ...options
    });
    
    res.setHeader('Content-Type', document.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${document.filename}"`);
    res.setHeader('X-Document-Id', document.id);
    
    res.json({
      success: true,
      document: {
        id: document.id,
        filename: document.filename,
        mimeType: document.mimeType,
        size: document.size,
        metadata: document.metadata
      },
      downloadUrl: `/api/documents/${document.id}/download`
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/documents/generate-from-data
 * Generate document from structured data
 */
router.post('/generate-from-data', validate(dataGenerateSchema), async (req, res, next) => {
  try {
    const { data, templateId, format = 'docx', options = {} } = req.body;
    const documentService = req.app.locals.documentService;
    
    const document = await documentService.generateFromData(
      data,
      templateId,
      format
    );
    
    res.setHeader('Content-Type', document.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${document.filename}"`);
    res.setHeader('X-Document-Id', document.id);
    
    res.send(document.content);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/documents/assemble
 * Assemble document from multiple sources
 */
router.post('/assemble', validate(assembleSchema), async (req, res, next) => {
  try {
    const { sources, format, options = {} } = req.body;
    const documentService = req.app.locals.documentService;
    
    const document = await documentService.assemble(sources, {
      format,
      ...options
    });
    
    res.setHeader('Content-Type', document.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${document.filename}"`);
    res.setHeader('X-Document-Id', document.id);
    
    res.send(document.content);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/documents/convert
 * Convert document between formats
 */
router.post('/convert', validate(convertSchema), async (req, res, next) => {
  try {
    const { documentId, toFormat } = req.body;
    
    // TODO: Implement document retrieval and conversion
    res.status(501).json({
      error: { message: 'Document conversion not yet implemented' }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/documents/preview
 * Generate document preview (metadata and first page)
 */
router.post('/preview', async (req, res, next) => {
  try {
    const { templateId, variables } = req.body;
    const documentService = req.app.locals.documentService;
    
    // Generate document in memory
    const document = await documentService.generateFromTemplate(
      templateId,
      variables,
      'html', // Use HTML for preview
      { includePageNumbers: false }
    );
    
    // Extract preview (first 1000 characters of HTML)
    const content = document.content.toString('utf-8');
    const preview = content.substring(0, 2000);
    
    res.json({
      preview,
      metadata: document.metadata
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/documents/:id/download
 * Download a generated document
 */
router.get('/:id/download', async (req, res, next) => {
  try {
    // TODO: Implement document storage and retrieval
    res.status(501).json({
      error: { message: 'Document storage not yet implemented' }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
