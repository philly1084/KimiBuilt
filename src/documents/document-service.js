/**
 * Document Service - Core module for document creation
 * Handles template-based generation, AI-powered generation, and document assembly
 */

const { DocxGenerator } = require('./generators/docx-generator');
const { PdfGenerator } = require('./generators/pdf-generator');
const { PptxGenerator } = require('./generators/pptx-generator');
const { HtmlGenerator } = require('./generators/html-generator');
const { MarkdownGenerator } = require('./generators/markdown-generator');
const { TemplateEngine } = require('./template-engine');
const { AIDocumentGenerator } = require('./ai-document-generator');
const { DocumentAssembler } = require('./document-assembler');

class DocumentService {
  constructor(openaiClient) {
    this.generators = {
      docx: new DocxGenerator(),
      pdf: new PdfGenerator(),
      pptx: new PptxGenerator(),
      html: new HtmlGenerator(),
      md: new MarkdownGenerator(),
      markdown: new MarkdownGenerator()
    };

    this.templateEngine = new TemplateEngine();
    this.aiGenerator = new AIDocumentGenerator(openaiClient);
    this.assembler = new DocumentAssembler(this.generators);
  }

  /**
   * Generate a document from a template
   * @param {string} templateId - Template identifier
   * @param {Object} variables - Template variables
   * @param {string} format - Output format (docx, pdf, html, md)
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated document
   */
  async generateFromTemplate(templateId, variables, format, options = {}) {
    const template = await this.templateEngine.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const generator = this.generators[format];
    if (!generator) {
      throw new Error(`Unsupported format: ${format}`);
    }

    // Populate template with variables
    const populated = await this.templateEngine.populate(template, variables);

    // Generate document
    const document = await generator.generate(populated, options);

    return {
      id: this.generateId(),
      content: document.buffer || document.content,
      filename: this.generateFilename(template.name, format),
      mimeType: generator.mimeType,
      size: document.buffer?.length || document.content?.length,
      metadata: {
        template: templateId,
        format,
        generatedAt: new Date().toISOString(),
        ...document.metadata
      }
    };
  }

  /**
   * Generate a document using AI
   * @param {string} prompt - User prompt
   * @param {Object} options - AI generation options
   * @returns {Promise<Object>} Generated document
   */
  async aiGenerate(prompt, options = {}) {
    const format = options.format || 'docx';
    const generator = this.generators[format];

    if (!generator) {
      throw new Error(`Unsupported format: ${format}`);
    }

    // Generate structured content using AI
    const content = await this.aiGenerator.generate(prompt, options);

    // Generate document from content
    const document = await generator.generateFromContent(content, options);

    return {
      id: this.generateId(),
      content: document.buffer || document.content,
      filename: this.generateFilename(content.title || 'document', format),
      mimeType: generator.mimeType,
      size: document.buffer?.length || document.content?.length,
      metadata: {
        format,
        generatedAt: new Date().toISOString(),
        aiGenerated: true,
        prompt,
        ...content.metadata,
        ...document.metadata
      },
      preview: content.sections?.map(s => ({
        heading: s.heading,
        preview: s.content?.substring(0, 200) + '...'
      }))
    };
  }

  /**
   * Expand an outline into a full document using AI
   * @param {Array} outline - Document outline
   * @param {Object} options - Expansion options
   * @returns {Promise<Object>} Generated document
   */
  async expandOutline(outline, options = {}) {
    const format = options.format || 'docx';
    const generator = this.generators[format];

    // Expand outline using AI
    const expanded = await this.aiGenerator.expandOutline(outline, options);

    // Convert to document structure
    const content = this.outlineToDocument(expanded, options);

    // Generate document
    const document = await generator.generateFromContent(content, options);

    return {
      id: this.generateId(),
      content: document.buffer || document.content,
      filename: this.generateFilename(content.title || 'document', format),
      mimeType: generator.mimeType,
      size: document.buffer?.length || document.content?.length,
      metadata: {
        format,
        generatedAt: new Date().toISOString(),
        aiGenerated: true,
        ...document.metadata
      }
    };
  }

  /**
   * Generate document from structured data
   * @param {Object} data - Structured data
   * @param {string} templateId - Template to use
   * @param {string} format - Output format
   * @returns {Promise<Object>} Generated document
   */
  async generateFromData(data, templateId, format) {
    const template = await this.templateEngine.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Flatten nested data for template variables
    const variables = this.flattenData(data);

    return this.generateFromTemplate(templateId, variables, format);
  }

  /**
   * Assemble a document from multiple sources
   * @param {Array} sources - Array of source objects
   * @param {Object} options - Assembly options
   * @returns {Promise<Object>} Assembled document
   */
  async assemble(sources, options = {}) {
    return this.assembler.assemble(sources, options);
  }

  /**
   * Convert a document between formats
   * @param {Buffer} content - Document content
   * @param {string} fromFormat - Source format
   * @param {string} toFormat - Target format
   * @returns {Promise<Object>} Converted document
   */
  async convert(content, fromFormat, toFormat) {
    // This is a simplified conversion - in production, use pandoc or similar
    const sourceGen = this.generators[fromFormat];
    const targetGen = this.generators[toFormat];

    if (!sourceGen || !targetGen) {
      throw new Error('Unsupported format conversion');
    }

    // Extract content structure
    const structure = await sourceGen.extract(content);

    // Generate in target format
    const result = await targetGen.generateFromContent(structure);

    return {
      id: this.generateId(),
      content: result.buffer || result.content,
      filename: this.generateFilename('converted', toFormat),
      mimeType: targetGen.mimeType,
      metadata: {
        convertedFrom: fromFormat,
        convertedTo: toFormat,
        convertedAt: new Date().toISOString()
      }
    };
  }

  /**
   * Get available templates
   * @param {string} category - Optional category filter
   * @returns {Promise<Array>} List of templates
   */
  async getTemplates(category = null) {
    return this.templateEngine.getTemplates(category);
  }

  /**
   * Get a single template by ID
   * @param {string} templateId - Template identifier
   * @returns {Promise<Object>} Template definition
   */
  async getTemplate(templateId) {
    return this.templateEngine.getTemplate(templateId);
  }

  /**
   * Get supported document formats
   * @returns {Array} List of formats with metadata
   */
  getSupportedFormats() {
    return [
      { id: 'docx', name: 'Word Document', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: '.docx' },
      { id: 'pdf', name: 'PDF Document', mimeType: 'application/pdf', extension: '.pdf' },
      { id: 'pptx', name: 'PowerPoint', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', extension: '.pptx' },
      { id: 'html', name: 'HTML Document', mimeType: 'text/html', extension: '.html' },
      { id: 'md', name: 'Markdown', mimeType: 'text/markdown', extension: '.md' }
    ];
  }

  /**
   * Generate a unique ID
   * @returns {string} Unique identifier
   */
  generateId() {
    return `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate a filename
   * @param {string} name - Base name
   * @param {string} format - File format
   * @returns {string} Generated filename
   */
  generateFilename(name, format) {
    const sanitized = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const timestamp = new Date().toISOString().split('T')[0];
    const extensions = { docx: '.docx', pdf: '.pdf', pptx: '.pptx', html: '.html', md: '.md', markdown: '.md' };
    return `${sanitized}_${timestamp}${extensions[format] || '.docx'}`;
  }

  /**
   * Flatten nested data object for template variables
   * @param {Object} data - Nested data
   * @param {string} prefix - Key prefix
   * @returns {Object} Flattened data
   */
  flattenData(data, prefix = '') {
    const result = {};

    for (const [key, value] of Object.entries(data)) {
      const newKey = prefix ? `${prefix}_${key}` : key;

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(result, this.flattenData(value, newKey));
      } else {
        result[newKey] = value;
      }
    }

    return result;
  }

  /**
   * Convert expanded outline to document structure
   * @param {Array} outline - Expanded outline
   * @param {Object} options - Options
   * @returns {Object} Document structure
   */
  outlineToDocument(outline, options = {}) {
    const sections = [];

    const processNode = (node, level = 1) => {
      sections.push({
        heading: node.title || node.heading,
        content: node.content,
        level
      });

      if (node.subsections) {
        node.subsections.forEach(child => processNode(child, level + 1));
      }
    };

    outline.forEach(node => processNode(node));

    return {
      title: options.title || 'Generated Document',
      sections,
      metadata: {
        sections: sections.length,
        generatedAt: new Date().toISOString()
      }
    };
  }
}

module.exports = { DocumentService };
