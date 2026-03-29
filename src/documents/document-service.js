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
    this.documentStore = new Map();
    this.maxStoredDocuments = 100;
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
    const renderableTemplate = this.buildRenderableTemplate(populated, variables);

    // Generate document
    const document = await this.renderDocument({
      format,
      template: renderableTemplate,
      title: template.name,
      options,
    });

    return this.storeDocument({
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
    });
  }

  /**
   * Generate a document using AI
   * @param {string} prompt - User prompt
   * @param {Object} options - AI generation options
   * @returns {Promise<Object>} Generated document
   */
  async aiGenerate(prompt, options = {}) {
    const format = String(options.format || 'docx').toLowerCase();

    if (this.shouldUsePresentationPipeline(options.documentType, format)) {
      return this.generatePresentation(prompt, {
        ...options,
        format,
      });
    }

    // Generate structured content using AI
    const content = await this.aiGenerator.generate(prompt, options);

    // Generate document from content
    const document = await this.renderDocument({
      format,
      content,
      title: content.title || 'document',
      options,
    });

    return this.storeDocument({
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
    });
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

    return this.storeDocument({
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
    });
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

    return this.storeDocument({
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
    });
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

    return this.storeDocument({
      id: this.generateId(),
      content: result.buffer || result.content,
      filename: this.generateFilename('converted', toFormat),
      mimeType: targetGen.mimeType,
      metadata: {
        convertedFrom: fromFormat,
        convertedTo: toFormat,
        convertedAt: new Date().toISOString()
      }
    });
  }

  /**
   * Generate a presentation with optional AI images
   * @param {string|Object} content - Presentation content or outline
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated presentation
   */
  async generatePresentation(content, options = {}) {
    const format = String(options.format || 'pptx').toLowerCase();

    // Build presentation structure
    let presentationContent;
    if (typeof content === 'string') {
      if (this.looksLikePresentationOutline(content)) {
        presentationContent = this.parsePresentationOutline(content, options);
      } else {
        presentationContent = await this.aiGenerator.generatePresentationContent(content, {
          ...options,
          slideCount: options.slideCount || this.inferSlideCount(options.length),
        });
      }
    } else if (content.slides) {
      presentationContent = this.aiGenerator.normalizePresentationStructure(content, options);
    } else {
      throw new Error('Invalid presentation content format');
    }

    let document;
    let mimeType;
    let generatedContent;

    if (format === 'html') {
      document = this.renderPresentationDeck(presentationContent, options);
      mimeType = document.mimeType;
      generatedContent = document.content;
    } else {
      const generator = this.generators.pptx;
      if (!generator) {
        throw new Error('PPTX generator not available');
      }

      document = await generator.generateFromContent(presentationContent, options);
      mimeType = generator.mimeType;
      generatedContent = document.buffer;
    }

    return this.storeDocument({
      id: this.generateId(),
      content: generatedContent,
      filename: this.generateFilename(presentationContent.title || 'presentation', format),
      mimeType,
      size: document.buffer?.length || document.content?.length,
      metadata: {
        format,
        generatedAt: new Date().toISOString(),
        aiGenerated: typeof content === 'string',
        slideCount: presentationContent.slides?.length,
        theme: presentationContent.theme || options.theme || 'editorial',
        ...document.metadata
      }
    });
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

  storeDocument(document) {
    if (!document || !document.id) {
      return document;
    }

    const contentBuffer = Buffer.isBuffer(document.content)
      ? document.content
      : Buffer.from(String(document.content || ''), 'utf-8');

    const stored = {
      ...document,
      contentBuffer,
      storedAt: new Date().toISOString(),
      size: document.size || contentBuffer.length,
      downloadUrl: `/api/documents/${document.id}/download`,
    };

    this.documentStore.set(document.id, stored);
    this.pruneStoredDocuments();

    return stored;
  }

  getDocument(id) {
    return this.documentStore.get(id) || null;
  }

  pruneStoredDocuments() {
    if (this.documentStore.size <= this.maxStoredDocuments) {
      return;
    }

    const oldestIds = Array.from(this.documentStore.entries())
      .sort((a, b) => new Date(a[1].storedAt || 0).getTime() - new Date(b[1].storedAt || 0).getTime())
      .slice(0, this.documentStore.size - this.maxStoredDocuments)
      .map(([id]) => id);

    oldestIds.forEach((id) => this.documentStore.delete(id));
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
    const subtitle = content?.subtitle ? `<p class="document-subtitle">${this.escapeHtml(content.subtitle)}</p>` : '';
    const sections = Array.isArray(content?.sections) ? content.sections : [];
    const normalizedFormat = format === 'markdown' ? 'md' : format;

    if (normalizedFormat === 'html') {
      const body = [
        `<div class="document-shell document-theme-${this.escapeHtml(content?.theme || 'editorial')}">`,
        `<header class="document-header"><h1>${this.escapeHtml(title)}</h1>${subtitle}</header>`,
        ...sections.map((section) => this.renderSectionHtml(section)),
        '</div>',
      ].join('\n');

      return {
        content: ensureHtmlDocument(`${this.renderDocumentStyles()}${body}`, title),
        mimeType: 'text/html',
      };
    }

    const markdown = [
      `# ${title}`,
      content?.subtitle ? `_${content.subtitle}_` : '',
      content?.subtitle ? '' : '',
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
    const blocks = [
      this.renderRichTextBlocks(String(section.content || '')),
      this.renderBulletListHtml(section.bullets),
      this.renderCalloutHtml(section.callout),
      this.renderStatsHtml(section.stats),
      this.renderTableHtml(section.table),
      this.renderChartHtml(section.chart),
    ].filter(Boolean).join('\n');
    return `${heading}\n${blocks}`.trim();
  }

  renderSectionMarkdown(section = {}) {
    const level = Math.min(Math.max(Number(section.level) || 1, 1), 6) + 1;
    const lines = [];

    if (section.heading) {
      lines.push(`${'#'.repeat(level)} ${section.heading}`);
      lines.push('');
    }

    if (section.content) {
      const contentLines = String(section.content || '').split('\n');
      contentLines.forEach((line) => {
        lines.push(line);
      });
    }
    if (Array.isArray(section.bullets) && section.bullets.length > 0) {
      section.bullets.forEach((bullet) => lines.push(`- ${bullet}`));
    }
    if (section.callout) {
      const callout = typeof section.callout === 'string'
        ? { body: section.callout }
        : section.callout;
      lines.push(`> ${callout.title ? `**${callout.title}** ` : ''}${callout.body || ''}`.trim());
    }
    if (Array.isArray(section.stats) && section.stats.length > 0) {
      lines.push('');
      section.stats.forEach((stat) => {
        lines.push(`- **${stat.label || 'Metric'}:** ${stat.value || ''}${stat.detail ? ` (${stat.detail})` : ''}`);
      });
    }
    if (section.table?.headers?.length || section.table?.rows?.length) {
      const headers = Array.isArray(section.table.headers) ? section.table.headers : [];
      if (headers.length > 0) {
        lines.push('');
        lines.push(`| ${headers.join(' | ')} |`);
        lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
      }
      (section.table.rows || []).forEach((row) => lines.push(`| ${row.join(' | ')} |`));
    }
    if (section.chart?.series?.length) {
      lines.push('');
      lines.push(`**${section.chart.title || 'Chart'}**`);
      section.chart.series.forEach((point) => lines.push(`- ${point.label}: ${point.value}`));
      if (section.chart.summary) {
        lines.push(section.chart.summary);
      }
    }
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
    const values = template?.values || template?.variables || {};
    const sections = Object.entries(values)
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

  buildRenderableTemplate(template = {}, values = {}) {
    return {
      ...template,
      variableDefinitions: template.variables,
      values: { ...values },
      variables: { ...values },
    };
  }

  shouldUsePresentationPipeline(documentType = '', format = '') {
    const normalizedType = String(documentType || '').trim().toLowerCase();
    const normalizedFormat = String(format || '').trim().toLowerCase();
    return normalizedFormat === 'pptx'
      || (normalizedFormat === 'html' && /(presentation|slides|deck|pitch)/.test(normalizedType));
  }

  inferSlideCount(length = '') {
    const normalized = String(length || '').trim().toLowerCase();
    if (normalized === 'short') return 5;
    if (normalized === 'long') return 10;
    if (normalized === 'detailed') return 12;
    return 7;
  }

  looksLikePresentationOutline(text = '') {
    const normalized = String(text || '').trim();
    if (!normalized) {
      return false;
    }

    return /^#\s+/m.test(normalized)
      || /^##\s+/m.test(normalized)
      || /^[-*]\s+/m.test(normalized)
      || /^slide\s+\d+/im.test(normalized);
  }

  renderPresentationDeck(presentation = {}, options = {}) {
    const theme = this.getPresentationTheme(presentation.theme || options.theme || 'editorial');
    const slides = Array.isArray(presentation.slides) ? presentation.slides : [];
    const title = presentation.title || 'Presentation';
    const subtitle = presentation.subtitle ? `<p class="deck-subtitle">${this.escapeHtml(presentation.subtitle)}</p>` : '';
    const html = [
      this.renderPresentationStyles(theme),
      `<div class="presentation-deck theme-${theme.id}">`,
      `<header class="deck-meta"><span>Website Slides</span><span>${slides.length} slides</span></header>`,
      `<main class="deck-track">`,
      slides.map((slide, index) => this.renderPresentationSlideHtml(slide, index, theme)).join('\n'),
      `</main>`,
      `<footer class="deck-footer"><strong>${this.escapeHtml(title)}</strong>${subtitle}</footer>`,
      `</div>`,
    ].join('\n');

    return {
      content: ensureHtmlDocument(html, title),
      mimeType: 'text/html',
      metadata: {
        format: 'html',
        slideCount: slides.length,
        theme: theme.id,
        title,
      },
    };
  }

  renderPresentationSlideHtml(slide = {}, index = 0, theme = this.getPresentationTheme()) {
    const layout = String(slide.layout || (index === 0 ? 'title' : 'content')).toLowerCase();
    const stats = Array.isArray(slide.stats) ? slide.stats : [];
    const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
    const chartSeries = Array.isArray(slide.chart?.series) ? slide.chart.series : [];
    const columns = Array.isArray(slide.columns) ? slide.columns : [];
    const maxValue = Math.max(...chartSeries.map((point) => Number(point.value) || 0), 1);

    const chartHtml = chartSeries.length > 0
      ? `<div class="slide-chart">${chartSeries.map((point) => `
          <div class="chart-row">
            <span class="chart-label">${this.escapeHtml(point.label || '')}</span>
            <div class="chart-bar"><span style="width:${Math.max(8, Math.round(((Number(point.value) || 0) / maxValue) * 100))}%"></span></div>
            <strong class="chart-value">${this.escapeHtml(String(point.value ?? ''))}</strong>
          </div>
        `).join('')}</div>`
      : '';

    return `
      <section class="deck-slide layout-${this.escapeHtml(layout)}">
        <div class="slide-index">${String(index + 1).padStart(2, '0')}</div>
        ${slide.kicker ? `<p class="slide-kicker">${this.escapeHtml(slide.kicker)}</p>` : ''}
        <h2>${this.escapeHtml(slide.title || `Slide ${index + 1}`)}</h2>
        ${slide.subtitle ? `<p class="slide-subtitle">${this.escapeHtml(slide.subtitle)}</p>` : ''}
        ${slide.content ? `<div class="slide-copy">${this.renderRichTextBlocks(slide.content)}</div>` : ''}
        ${bullets.length > 0 ? `<ul class="slide-bullets">${bullets.map((bullet) => `<li>${this.escapeHtml(bullet)}</li>`).join('')}</ul>` : ''}
        ${stats.length > 0 ? `<div class="slide-stats">${stats.map((stat) => `
          <article class="stat-card">
            <span>${this.escapeHtml(stat.label || 'Metric')}</span>
            <strong>${this.escapeHtml(String(stat.value ?? ''))}</strong>
            ${stat.detail ? `<p>${this.escapeHtml(stat.detail)}</p>` : ''}
          </article>
        `).join('')}</div>` : ''}
        ${columns.length > 0 ? `<div class="slide-columns">${columns.map((column) => `
          <article class="column-card">
            ${column.heading ? `<h3>${this.escapeHtml(column.heading)}</h3>` : ''}
            ${column.content ? `<div>${this.renderRichTextBlocks(column.content)}</div>` : ''}
            ${Array.isArray(column.bullets) && column.bullets.length ? `<ul>${column.bullets.map((bullet) => `<li>${this.escapeHtml(bullet)}</li>`).join('')}</ul>` : ''}
          </article>
        `).join('')}</div>` : ''}
        ${chartHtml}
        ${slide.imagePrompt ? `<p class="slide-visual-note">Visual direction: ${this.escapeHtml(slide.imagePrompt)}</p>` : ''}
      </section>
    `;
  }

  renderBulletListHtml(bullets = []) {
    if (!Array.isArray(bullets) || bullets.length === 0) {
      return '';
    }

    return `<ul>${bullets.map((bullet) => `<li>${this.escapeHtml(bullet)}</li>`).join('')}</ul>`;
  }

  renderCalloutHtml(callout) {
    if (!callout) {
      return '';
    }

    const normalized = typeof callout === 'string'
      ? { body: callout }
      : callout;

    return `
      <aside class="document-callout tone-${this.escapeHtml(normalized.tone || 'note')}">
        ${normalized.title ? `<strong>${this.escapeHtml(normalized.title)}</strong>` : ''}
        <p>${this.escapeHtml(normalized.body || '')}</p>
      </aside>
    `;
  }

  renderStatsHtml(stats = []) {
    if (!Array.isArray(stats) || stats.length === 0) {
      return '';
    }

    return `
      <div class="document-stats">
        ${stats.map((stat) => `
          <article class="document-stat">
            <span>${this.escapeHtml(stat.label || 'Metric')}</span>
            <strong>${this.escapeHtml(String(stat.value ?? ''))}</strong>
            ${stat.detail ? `<p>${this.escapeHtml(stat.detail)}</p>` : ''}
          </article>
        `).join('')}
      </div>
    `;
  }

  renderTableHtml(table = {}) {
    const headers = Array.isArray(table.headers) ? table.headers : [];
    const rows = Array.isArray(table.rows) ? table.rows : [];
    if (headers.length === 0 && rows.length === 0) {
      return '';
    }

    const headerRow = headers.length > 0
      ? `<tr>${headers.map((header) => `<th>${this.escapeHtml(header)}</th>`).join('')}</tr>`
      : '';

    return `
      <div class="document-table-wrap">
        ${table.caption ? `<p class="document-table-caption">${this.escapeHtml(table.caption)}</p>` : ''}
        <table>
          <thead>${headerRow}</thead>
          <tbody>
            ${rows.map((row) => `<tr>${row.map((cell) => `<td>${this.escapeHtml(String(cell ?? ''))}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  renderChartHtml(chart = {}) {
    const series = Array.isArray(chart.series) ? chart.series : [];
    if (series.length === 0) {
      return '';
    }

    const maxValue = Math.max(...series.map((point) => Number(point.value) || 0), 1);
    return `
      <div class="document-chart">
        ${chart.title ? `<h4>${this.escapeHtml(chart.title)}</h4>` : ''}
        ${chart.summary ? `<p>${this.escapeHtml(chart.summary)}</p>` : ''}
        <div class="chart-stack">
          ${series.map((point) => `
            <div class="chart-row">
              <span class="chart-label">${this.escapeHtml(point.label || '')}</span>
              <div class="chart-bar"><span style="width:${Math.max(8, Math.round(((Number(point.value) || 0) / maxValue) * 100))}%"></span></div>
              <strong class="chart-value">${this.escapeHtml(String(point.value ?? ''))}</strong>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  getPresentationTheme(theme = 'editorial') {
    const normalized = String(theme || '').trim().toLowerCase();
    const themes = {
      editorial: {
        id: 'editorial',
        background: '#f7f3ee',
        panel: '#fffaf5',
        text: '#1e293b',
        muted: '#52606d',
        accent: '#d94841',
        accentSoft: '#f7d9d4',
      },
      executive: {
        id: 'executive',
        background: '#f8fafc',
        panel: '#ffffff',
        text: '#0f172a',
        muted: '#475569',
        accent: '#2563eb',
        accentSoft: '#dbeafe',
      },
      product: {
        id: 'product',
        background: '#0f172a',
        panel: '#111f3b',
        text: '#f8fafc',
        muted: '#cbd5e1',
        accent: '#22c55e',
        accentSoft: '#163f2c',
      },
      bold: {
        id: 'bold',
        background: '#1f2937',
        panel: '#111827',
        text: '#f9fafb',
        muted: '#d1d5db',
        accent: '#f59e0b',
        accentSoft: '#4b2d00',
      },
    };

    return themes[normalized] || themes.editorial;
  }

  renderDocumentStyles() {
    return `
      <style>
        body { background: #eef2f7; color: #17202a; font-family: "Aptos", "Segoe UI", sans-serif; margin: 0; }
        .document-shell { max-width: 920px; margin: 0 auto; padding: 56px 40px 72px; background: #fff; }
        .document-header { margin-bottom: 32px; }
        .document-header h1 { font-size: 2.6rem; line-height: 1.05; margin: 0 0 10px; }
        .document-subtitle { color: #5b6776; font-size: 1.05rem; margin: 0; }
        h2, h3, h4, h5, h6 { color: #132238; margin-top: 2rem; }
        p { line-height: 1.7; }
        .document-callout { border-left: 4px solid #d94841; background: #fff6f5; padding: 14px 16px; margin: 18px 0; border-radius: 0 14px 14px 0; }
        .document-callout p { margin: 6px 0 0; }
        .document-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; margin: 22px 0; }
        .document-stat { border: 1px solid #dbe2ea; border-radius: 16px; padding: 16px; background: #fbfdff; }
        .document-stat span { display: block; color: #5b6776; font-size: 0.86rem; text-transform: uppercase; letter-spacing: 0.08em; }
        .document-stat strong { display: block; font-size: 1.5rem; margin-top: 8px; }
        .document-stat p { color: #5b6776; margin: 8px 0 0; }
        .document-table-wrap { margin: 20px 0; }
        .document-table-caption { font-size: 0.92rem; color: #5b6776; margin-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 14px; }
        th, td { padding: 12px 14px; border-bottom: 1px solid #e2e8f0; text-align: left; }
        th { background: #f8fafc; color: #132238; }
        .document-chart { margin: 24px 0; }
        .chart-stack { display: grid; gap: 10px; }
        .chart-row { display: grid; grid-template-columns: 140px 1fr 64px; gap: 12px; align-items: center; }
        .chart-label, .chart-value { font-size: 0.92rem; }
        .chart-bar { background: #e2e8f0; border-radius: 999px; height: 12px; overflow: hidden; }
        .chart-bar span { display: block; height: 100%; background: linear-gradient(90deg, #d94841, #f97316); border-radius: 999px; }
      </style>
    `;
  }

  renderPresentationStyles(theme) {
    return `
      <style>
        :root {
          --deck-bg: ${theme.background};
          --deck-panel: ${theme.panel};
          --deck-text: ${theme.text};
          --deck-muted: ${theme.muted};
          --deck-accent: ${theme.accent};
          --deck-accent-soft: ${theme.accentSoft};
        }
        body { margin: 0; background: linear-gradient(180deg, var(--deck-bg), #dfe7f1); color: var(--deck-text); font-family: "Space Grotesk", "Segoe UI", sans-serif; }
        .presentation-deck { padding: 28px; }
        .deck-meta, .deck-footer { max-width: 1180px; margin: 0 auto 18px; display: flex; justify-content: space-between; color: var(--deck-muted); font-size: 0.92rem; letter-spacing: 0.08em; text-transform: uppercase; }
        .deck-track { max-width: 1180px; margin: 0 auto; display: grid; gap: 28px; }
        .deck-slide { min-height: 88vh; background: var(--deck-panel); border-radius: 32px; padding: 48px; position: relative; overflow: hidden; box-shadow: 0 30px 80px rgba(15, 23, 42, 0.12); }
        .deck-slide::before { content: ""; position: absolute; inset: 0 auto auto 0; width: 220px; height: 220px; background: radial-gradient(circle, var(--deck-accent-soft), transparent 70%); opacity: 0.9; }
        .deck-slide h2 { font-size: clamp(2.4rem, 5vw, 4.4rem); line-height: 0.95; margin: 0 0 12px; max-width: 10ch; position: relative; }
        .slide-index { position: absolute; top: 32px; right: 36px; color: var(--deck-muted); font-size: 0.9rem; letter-spacing: 0.08em; }
        .slide-kicker { color: var(--deck-accent); text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.8rem; margin: 0 0 16px; position: relative; }
        .slide-subtitle, .slide-visual-note, .deck-footer p { color: var(--deck-muted); max-width: 52ch; }
        .slide-copy p { max-width: 58ch; font-size: 1.08rem; line-height: 1.7; }
        .slide-bullets { max-width: 58ch; display: grid; gap: 10px; padding-left: 1.25rem; }
        .slide-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-top: 24px; }
        .stat-card, .column-card { padding: 18px; border-radius: 18px; background: rgba(255,255,255,0.6); border: 1px solid rgba(15,23,42,0.08); backdrop-filter: blur(8px); }
        .stat-card span { display: block; color: var(--deck-muted); font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.08em; }
        .stat-card strong { display: block; font-size: 1.8rem; margin-top: 6px; }
        .slide-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; margin-top: 18px; }
        .slide-chart { margin-top: 28px; display: grid; gap: 12px; max-width: 760px; }
        .chart-row { display: grid; grid-template-columns: 150px 1fr 70px; gap: 12px; align-items: center; }
        .chart-bar { height: 16px; background: rgba(15,23,42,0.09); border-radius: 999px; overflow: hidden; }
        .chart-bar span { display: block; height: 100%; background: linear-gradient(90deg, var(--deck-accent), #fb7185); border-radius: 999px; }
        .layout-title { display: flex; flex-direction: column; justify-content: center; }
        .layout-section { background: linear-gradient(135deg, var(--deck-accent), #111827); color: #fff; }
        .layout-section .slide-kicker, .layout-section .slide-subtitle, .layout-section .slide-visual-note, .layout-section .slide-index { color: rgba(255,255,255,0.78); }
        .layout-section::before { background: radial-gradient(circle, rgba(255,255,255,0.12), transparent 70%); }
        @media (max-width: 768px) {
          .presentation-deck { padding: 12px; }
          .deck-slide { min-height: auto; padding: 28px 22px; border-radius: 24px; }
          .slide-columns, .slide-stats { grid-template-columns: 1fr; }
          .chart-row { grid-template-columns: 1fr; }
        }
      </style>
    `;
  }
}

module.exports = { DocumentService };
