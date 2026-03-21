/**
 * Document Service - Core module for document creation
 * Handles template-based generation, AI-powered generation, and document assembly
 */

const { DocxGenerator } = require('./generators/docx-generator');
const { PdfGenerator } = require('./generators/pdf-generator');
const { PptxGenerator } = require('./generators/pptx-generator');
const { TemplateEngine } = require('./template-engine');
const { AIDocumentGenerator } = require('./ai-document-generator');
const { ensureHtmlDocument } = require('../artifacts/artifact-renderer');
const { createUniqueFilename } = require('../utils/text');

class DocumentService {
  constructor(openaiClient) {
    this.generators = {
      docx: new DocxGenerator(),
      pdf: new PdfGenerator(),
      pptx: new PptxGenerator(),
    };

    this.templateEngine = new TemplateEngine();
    this.aiGenerator = new AIDocumentGenerator(openaiClient);
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

    // Populate template with variables
    const populated = await this.templateEngine.populate(template, variables);

    // Generate document
    const document = await this.renderDocument({
      format,
      template: populated,
      title: template.name,
      options,
    });

    return {
      id: this.generateId(),
      content: document.buffer || document.content,
      filename: this.generateFilename(template.name, format),
      mimeType: document.mimeType,
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

    // Generate structured content using AI
    const content = await this.aiGenerator.generate(prompt, options);

    // Generate document from content
    const document = await this.renderDocument({
      format,
      content,
      title: content.title || 'document',
      options,
    });

    return {
      id: this.generateId(),
      content: document.buffer || document.content,
      filename: this.generateFilename(content.title || 'document', format),
      mimeType: document.mimeType,
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

    // Expand outline using AI
    const expanded = await this.aiGenerator.expandOutline(outline, options);

    // Convert to document structure
    const content = this.outlineToDocument(expanded, options);

    // Generate document
    const document = await this.renderDocument({
      format,
      content,
      title: content.title || 'document',
      options,
    });

    return {
      id: this.generateId(),
      content: document.buffer || document.content,
      filename: this.generateFilename(content.title || 'document', format),
      mimeType: document.mimeType,
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
    // TODO: Implement document assembly from multiple sources
    // For now, combine text sources into a single document
    const combined = sources.map(s => s.content || s.text || '').join('\n\n');
    const format = options.format || 'docx';

    const document = await this.renderDocument({
      format,
      content: {
        title: options.title || 'document',
        sections: [{
          heading: options.title || 'Document',
          content: combined,
          level: 1,
        }],
      },
      title: options.title || 'document',
      options,
      rawText: combined,
    });

    return {
      id: this.generateId(),
      content: document.buffer || document.content,
      filename: this.generateFilename(options.title || 'document', format),
      mimeType: document.mimeType,
      size: document.buffer?.length || document.content?.length,
      metadata: {
        format,
        generatedAt: new Date().toISOString(),
        sourceCount: sources.length,
        ...(document.metadata || {}),
      },
    };
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
   * Generate a presentation with optional AI images
   * @param {string|Object} content - Presentation content or outline
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated presentation
   */
  async generatePresentation(content, options = {}) {
    const generator = this.generators.pptx;
    if (!generator) {
      throw new Error('PPTX generator not available');
    }

    // Build presentation structure
    let presentationContent;
    if (typeof content === 'string') {
      // Parse from text outline
      presentationContent = this.parsePresentationOutline(content, options);
    } else if (content.slides) {
      // Already structured
      presentationContent = content;
    } else {
      throw new Error('Invalid presentation content format');
    }

    // Generate the presentation (generator handles image generation)
    const document = await generator.generateFromContent(presentationContent, options);

    return {
      id: this.generateId(),
      content: document.buffer,
      filename: this.generateFilename(presentationContent.title || 'presentation', 'pptx'),
      mimeType: generator.mimeType,
      size: document.buffer?.length,
      metadata: {
        format: 'pptx',
        generatedAt: new Date().toISOString(),
        aiGenerated: !!options.generateImages,
        slideCount: presentationContent.slides?.length,
        ...document.metadata
      }
    };
  }

  /**
   * Parse presentation outline into structured content
   * @param {string} outline - Text outline
   * @param {Object} options - Parsing options
   * @returns {Object} Structured presentation content
   */
  parsePresentationOutline(outline, options = {}) {
    const lines = outline.split('\n').map(l => l.trim()).filter(Boolean);
    const slides = [];
    let currentSlide = null;
    let title = options.title || 'Presentation';

    for (const line of lines) {
      // Main title (first level)
      if (line.startsWith('# ')) {
        title = line.substring(2).trim();
        slides.push({
          layout: 'title',
          title: title,
          subtitle: options.subtitle || ''
        });
      }
      // Section/Slide title
      else if (line.startsWith('## ')) {
        if (currentSlide) slides.push(currentSlide);
        currentSlide = {
          layout: 'content',
          title: line.substring(3).trim(),
          bullets: []
        };
      }
      // Bullet points
      else if (line.startsWith('- ') || line.startsWith('* ')) {
        if (currentSlide) {
          currentSlide.bullets.push(line.substring(2).trim());
        }
      }
      // Image marker
      else if (line.startsWith('![image]')) {
        const imageDesc = line.substring(8).trim();
        if (currentSlide) {
          currentSlide.layout = 'image';
          currentSlide.imagePrompt = imageDesc;
          currentSlide.generateImage = options.generateImages !== false;
        }
      }
    }

    if (currentSlide) slides.push(currentSlide);

    // Ensure we have at least a title slide
    if (slides.length === 0) {
      slides.push({
        layout: 'title',
        title: title,
        subtitle: options.subtitle || ''
      });
    }

    return { title, slides };
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
    return createUniqueFilename(name, format, 'document');
  }

  async renderDocument({ format, template = null, content = null, title = 'document', options = {}, rawText = '' }) {
    const normalizedFormat = String(format || 'docx').toLowerCase();

    if (normalizedFormat === 'html' || normalizedFormat === 'md' || normalizedFormat === 'markdown') {
      const structuredContent = content || this.templateToContent(template);
      const rendered = this.renderTextDocument(structuredContent, normalizedFormat);
      return {
        content: rendered.content,
        mimeType: rendered.mimeType,
        metadata: {
          format: normalizedFormat === 'markdown' ? 'md' : normalizedFormat,
          title: structuredContent.title || title,
          sections: structuredContent.sections?.length || 0,
        },
      };
    }

    const generator = this.generators[normalizedFormat];
    if (!generator) {
      throw new Error(`Unsupported format: ${format}`);
    }

    if (content && typeof generator.generateFromContent === 'function') {
      return generator.generateFromContent(content, options);
    }

    if (template && typeof generator.generate === 'function') {
      return generator.generate(template, options);
    }

    if (rawText && typeof generator.generateFromText === 'function') {
      return generator.generateFromText(rawText, options);
    }

    throw new Error(`Unsupported format: ${format}`);
  }

  renderTextDocument(content, format) {
    const title = content?.title || 'Document';
    const sections = Array.isArray(content?.sections) ? content.sections : [];
    const normalizedFormat = format === 'markdown' ? 'md' : format;

    if (normalizedFormat === 'html') {
      const body = [
        `<h1>${this.escapeHtml(title)}</h1>`,
        ...sections.map((section) => this.renderSectionHtml(section)),
      ].join('\n');

      return {
        content: ensureHtmlDocument(body, title),
        mimeType: 'text/html',
      };
    }

    const markdown = [
      `# ${title}`,
      '',
      ...sections.flatMap((section) => this.renderSectionMarkdown(section)),
    ].join('\n');

    return {
      content: markdown,
      mimeType: 'text/markdown',
    };
  }

  renderSectionHtml(section = {}) {
    const level = Math.min(Math.max(Number(section.level) || 1, 1), 6);
    const heading = section.heading ? `<h${level + 1}>${this.escapeHtml(section.heading)}</h${level + 1}>` : '';
    const blocks = this.renderRichTextBlocks(String(section.content || ''));
    return `${heading}\n${blocks}`.trim();
  }

  renderSectionMarkdown(section = {}) {
    const level = Math.min(Math.max(Number(section.level) || 1, 1), 6) + 1;
    const lines = [];

    if (section.heading) {
      lines.push(`${'#'.repeat(level)} ${section.heading}`);
      lines.push('');
    }

    const contentLines = String(section.content || '').split('\n');
    contentLines.forEach((line) => {
      lines.push(line);
    });
    lines.push('');
    return lines;
  }

  renderRichTextBlocks(text = '') {
    const blocks = String(text || '')
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean);

    return blocks.map((block) => {
      const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
      if (lines.length > 0 && lines.every((line) => /^[-*]\s+/.test(line))) {
        return `<ul>${lines.map((line) => `<li>${this.escapeHtml(line.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`;
      }
      if (lines.length > 0 && lines.every((line) => /^\d+\.\s+/.test(line))) {
        return `<ol>${lines.map((line) => `<li>${this.escapeHtml(line.replace(/^\d+\.\s+/, ''))}</li>`).join('')}</ol>`;
      }
      return lines.map((line) => `<p>${this.escapeHtml(line)}</p>`).join('\n');
    }).join('\n');
  }

  templateToContent(template = {}) {
    const variables = template?.variables || {};
    const sections = Object.entries(variables)
      .filter(([, value]) => value != null && String(value).trim())
      .map(([key, value]) => ({
        heading: key.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
        content: String(value),
        level: 1,
      }));

    return {
      title: template?.name || 'Document',
      sections,
    };
  }

  escapeHtml(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
