/**
 * PPTX Generator - PowerPoint presentation generation
 * Supports structured slide layouts, metrics, and chart-ready slides.
 */

const PptxGenJS = require('pptxgenjs');
const { generateImage } = require('../../openai-client');

const SLIDE_WIDTH = 13.333;
const SLIDE_HEIGHT = 7.5;

class PptxGenerator {
  constructor() {
    this.mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }

  async generate(template, variablesOrOptions = {}, maybeOptions = {}) {
    const options = maybeOptions && Object.keys(maybeOptions).length > 0
      ? maybeOptions
      : (variablesOrOptions || {});
    const variables = maybeOptions && Object.keys(maybeOptions).length > 0
      ? (variablesOrOptions || {})
      : ((template && typeof template.variables === 'object' && !Array.isArray(template.variables)) ? template.variables : {});

    const content = this.buildContentFromTemplate(template, variables, options);
    return this.generateFromContent(content, options);
  }

  async generateFromContent(content, options = {}) {
    const presentation = this.normalizePresentationContent(content, options);
    const theme = this.getTheme(presentation.theme || options.theme || 'editorial');
    const pptx = new PptxGenJS();

    pptx.layout = 'LAYOUT_WIDE';
    pptx.title = presentation.title || 'Presentation';
    pptx.subject = presentation.subtitle || '';
    pptx.author = options.author || presentation.author || 'LillyBuilt AI';

    for (let index = 0; index < presentation.slides.length; index += 1) {
      const slide = pptx.addSlide();
      await this.renderSlide(slide, presentation.slides[index], index, presentation, theme, options);
    }

    const buffer = await pptx.write({ outputType: 'nodebuffer' });

    return {
      buffer,
      filename: this.generateFilename(presentation.title || 'presentation'),
      mimeType: this.mimeType,
      metadata: {
        format: 'pptx',
        slideCount: presentation.slides.length,
        theme: theme.id,
        title: presentation.title || 'Presentation',
      }
    };
  }

  async generateFromOutline(outline, options = {}) {
    const slides = Array.isArray(outline)
      ? outline.map((item, index) => ({
        layout: index === 0 ? 'title' : 'content',
        title: item.title || item,
        bullets: Array.isArray(item.subpoints) ? item.subpoints : [],
        imagePrompt: item.imagePrompt || '',
        imageUrl: item.imageUrl || '',
        imageAlt: item.imageAlt || '',
        imageSource: item.imageSource || '',
      }))
      : [];

    return this.generateFromContent({
      title: options.title || 'Generated Presentation',
      theme: options.theme || 'editorial',
      slides,
    }, options);
  }

  buildContentFromTemplate(template = {}, variables = {}, options = {}) {
    const slides = this.normalizeTemplateSlides(variables.slides);
    const fallbackTitle = variables.title || template.name || 'Presentation';
    const defaultTheme = this.resolveTemplateTheme(template, options.theme);

    switch (template.id) {
      case 'presentation-image-heavy':
        return {
          title: fallbackTitle,
          subtitle: variables.subtitle || '',
          theme: defaultTheme,
          slides: slides.map((slide, index) => ({
            layout: index === 0 ? 'title' : (slide.layout || 'image'),
            title: slide.title || (index === 0 ? fallbackTitle : `Slide ${index + 1}`),
            subtitle: index === 0 ? (variables.subtitle || '') : '',
            caption: slide.caption || '',
            imagePrompt: slide.imagePrompt || '',
            imageUrl: slide.imageUrl || '',
            imageAlt: slide.imageAlt || '',
            imageSource: slide.imageSource || '',
            content: slide.content || '',
            bullets: this.normalizeBullets(slide.bullets),
          })),
        };
      case 'presentation-bullet-points':
      default:
        return {
          title: fallbackTitle,
          subtitle: variables.subtitle || '',
          theme: defaultTheme,
          slides: slides.length > 0 ? slides.map((slide, index) => ({
            layout: index === 0 ? 'title' : (slide.layout || 'content'),
            title: slide.title || (index === 0 ? fallbackTitle : `Slide ${index + 1}`),
            subtitle: index === 0 ? (variables.subtitle || '') : '',
            content: slide.content || '',
            bullets: this.normalizeBullets(slide.bullets),
            stats: Array.isArray(slide.stats) ? slide.stats : [],
            chart: slide.chart || null,
            columns: Array.isArray(slide.columns) ? slide.columns : [],
            imagePrompt: slide.imagePrompt || '',
            imageUrl: slide.imageUrl || '',
            imageAlt: slide.imageAlt || '',
            imageSource: slide.imageSource || '',
          })) : [
            {
              layout: 'title',
              title: fallbackTitle,
              subtitle: variables.subtitle || '',
            },
            {
              layout: 'content',
              title: 'Overview',
              bullets: ['Add key points to begin the story.'],
            }
          ],
        };
    }
  }

  resolveTemplateTheme(template = {}, explicitTheme = '') {
    if (explicitTheme) {
      return explicitTheme;
    }

    const blueprint = String(template?.blueprint || '').trim().toLowerCase();
    const category = String(template?.category || '').trim().toLowerCase();

    if (blueprint === 'website-slides') {
      return 'bold';
    }

    if (blueprint === 'pitch-deck') {
      return 'executive';
    }

    if (blueprint === 'presentation' && category === 'creative') {
      return 'bold';
    }

    if (blueprint === 'presentation') {
      return 'executive';
    }

    return category === 'creative' ? 'editorial' : 'executive';
  }

  normalizePresentationContent(content = {}, options = {}) {
    const slides = Array.isArray(content.slides)
      ? content.slides.map((slide, index) => this.normalizeSlide(slide, index))
      : [];

    const normalizedSlides = slides.length > 0
      ? slides
      : this.parseContentIntoSections(content.content || content.body || '').map((section, index) => ({
        layout: index === 0 ? 'title' : 'content',
        title: section.title || `Slide ${index + 1}`,
        content: section.content || '',
        bullets: [],
        subtitle: index === 0 ? (content.subtitle || '') : '',
      }));

    if (normalizedSlides.length === 0) {
      normalizedSlides.push({
        layout: 'title',
        title: content.title || 'Presentation',
        subtitle: content.subtitle || '',
        bullets: [],
      });
    }

    if (normalizedSlides[0].layout !== 'title') {
      normalizedSlides.unshift({
        layout: 'title',
        title: content.title || options.title || 'Presentation',
        subtitle: content.subtitle || options.subtitle || '',
      });
    }

    return {
      title: content.title || options.title || 'Presentation',
      subtitle: content.subtitle || options.subtitle || '',
      theme: content.theme || options.theme || 'editorial',
      author: content.author || options.author || 'LillyBuilt AI',
      slides: normalizedSlides,
    };
  }

  normalizeSlide(slide = {}, index = 0) {
    return {
      layout: String(slide.layout || (index === 0 ? 'title' : 'content')).toLowerCase(),
      kicker: slide.kicker || '',
      title: slide.title || `Slide ${index + 1}`,
      subtitle: slide.subtitle || '',
      content: typeof slide.content === 'string' ? slide.content : '',
      bullets: this.normalizeBullets(slide.bullets || slide.points),
      stats: Array.isArray(slide.stats) ? slide.stats : [],
      chart: slide.chart && typeof slide.chart === 'object' ? slide.chart : null,
      columns: Array.isArray(slide.columns) ? slide.columns : [],
      imagePrompt: slide.imagePrompt || '',
      imageUrl: slide.imageUrl || '',
      imageAlt: slide.imageAlt || '',
      imageSource: slide.imageSource || '',
      caption: slide.caption || '',
    };
  }

  normalizeTemplateSlides(slides) {
    if (Array.isArray(slides)) {
      return slides;
    }

    if (typeof slides === 'string') {
      try {
        const parsed = JSON.parse(slides);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_error) {
        return [];
      }
    }

    return [];
  }

  normalizeBullets(value) {
    if (Array.isArray(value)) {
      return value.map((entry) => String(entry || '').trim()).filter(Boolean);
    }

    if (typeof value === 'string') {
      return value.split('\n').map((entry) => entry.replace(/^[-*]\s*/, '').trim()).filter(Boolean);
    }

    return [];
  }

  async renderSlide(slide, slideData, index, presentation, theme, options) {
    this.paintBackground(slide, slideData.layout, theme);

    switch (slideData.layout) {
      case 'title':
        this.renderTitleSlide(slide, slideData, theme, presentation);
        break;
      case 'section':
        this.renderSectionSlide(slide, slideData, theme);
        break;
      case 'two-column':
        this.renderTwoColumnSlide(slide, slideData, theme);
        break;
      case 'chart':
        this.renderChartSlide(slide, slideData, theme);
        break;
      case 'image':
        await this.renderImageSlide(slide, slideData, theme, options);
        break;
      case 'content':
      default:
        this.renderContentSlide(slide, slideData, theme);
        break;
    }

    this.addSlideFooter(slide, index + 1, presentation.title || 'Presentation', theme);
  }

  paintBackground(slide, layout = 'content', theme) {
    slide.addShape('rect', {
      x: 0,
      y: 0,
      w: SLIDE_WIDTH,
      h: SLIDE_HEIGHT,
      line: { color: this.stripHash(theme.background), transparency: 100 },
      fill: { color: this.stripHash(theme.background) }
    });

    if (layout === 'section') {
      slide.addShape('rect', {
        x: 0,
        y: 0,
        w: SLIDE_WIDTH,
        h: SLIDE_HEIGHT,
        line: { color: this.stripHash(theme.accent), transparency: 100 },
        fill: { color: this.stripHash(theme.accent) }
      });
    } else {
      slide.addShape('rect', {
        x: 0,
        y: 0,
        w: 3.8,
        h: 3.8,
        line: { color: this.stripHash(theme.accentSoft), transparency: 100 },
        fill: { color: this.stripHash(theme.accentSoft), transparency: 22 }
      });
    }
  }

  renderTitleSlide(slide, slideData, theme, presentation) {
    if (slideData.kicker) {
      this.addText(slide, slideData.kicker, {
        x: 0.9, y: 0.8, w: 4.5, h: 0.3,
        fontSize: 10,
        color: theme.accent,
        bold: true,
      });
    }

    this.addText(slide, slideData.title || presentation.title || 'Presentation', {
      x: 0.9, y: 1.4, w: 8.8, h: 1.4,
      fontSize: 28,
      bold: true,
      color: theme.text,
      fit: 'shrink',
    });

    if (slideData.subtitle || presentation.subtitle) {
      this.addText(slide, slideData.subtitle || presentation.subtitle, {
        x: 0.9, y: 3.05, w: 7.5, h: 0.8,
        fontSize: 16,
        color: theme.muted,
      });
    }

    slide.addShape('rect', {
      x: 0.9,
      y: 4.5,
      w: 2.6,
      h: 0.08,
      line: { color: this.stripHash(theme.accent), transparency: 100 },
      fill: { color: this.stripHash(theme.accent) }
    });

    this.addText(slide, presentation.author || 'LillyBuilt AI', {
      x: 0.9, y: 4.75, w: 3.6, h: 0.4,
      fontSize: 10,
      color: theme.muted,
    });
  }

  renderSectionSlide(slide, slideData, theme) {
    if (slideData.kicker) {
      this.addText(slide, slideData.kicker, {
        x: 0.9, y: 1.0, w: 5.2, h: 0.3,
        fontSize: 10,
        color: '#FFFFFF',
        bold: true,
      });
    }

    this.addText(slide, slideData.title, {
      x: 0.9, y: 2.0, w: 9.5, h: 1.4,
      fontSize: 30,
      bold: true,
      color: '#FFFFFF',
      fit: 'shrink',
    });

    if (slideData.content) {
      this.addText(slide, slideData.content, {
        x: 0.9, y: 3.7, w: 8.4, h: 1.6,
        fontSize: 16,
        color: '#F8FAFC',
      });
    }
  }

  renderContentSlide(slide, slideData, theme) {
    this.addSlideHeading(slide, slideData, theme);

    if (slideData.content) {
      this.addText(slide, slideData.content, {
        x: 0.9, y: 1.9, w: 6.6, h: 1.6,
        fontSize: 14,
        color: theme.text,
        fit: 'shrink',
      });
    }

    this.addBulletList(slide, slideData.bullets, {
      x: 0.9,
      y: slideData.content ? 3.0 : 1.9,
      w: 6.6,
      h: 2.8,
      color: theme.text,
      bulletColor: theme.accent,
    });

    if (Array.isArray(slideData.stats) && slideData.stats.length > 0) {
      this.addStatCards(slide, slideData.stats.slice(0, 4), {
        x: 8.1,
        y: 1.8,
        w: 4.2,
        h: 1.2,
      }, theme);
    }
  }

  renderTwoColumnSlide(slide, slideData, theme) {
    this.addSlideHeading(slide, slideData, theme);

    const columns = Array.isArray(slideData.columns) && slideData.columns.length > 0
      ? slideData.columns.slice(0, 2)
      : [
        { heading: 'Column A', content: slideData.content, bullets: slideData.bullets.slice(0, 3) },
        { heading: 'Column B', content: '', bullets: slideData.bullets.slice(3) },
      ];

    columns.forEach((column, columnIndex) => {
      const x = columnIndex === 0 ? 0.9 : 6.95;
      slide.addShape('roundRect', {
        x,
        y: 1.85,
        w: 5.4,
        h: 4.6,
        line: { color: this.stripHash(theme.accentSoft), transparency: 65 },
        fill: { color: this.stripHash(theme.panel), transparency: 12 }
      });
      if (column.heading) {
        this.addText(slide, column.heading, {
          x: x + 0.25, y: 2.1, w: 5.0, h: 0.4,
          fontSize: 16,
          bold: true,
          color: theme.text,
        });
      }
      if (column.content) {
        this.addText(slide, column.content, {
          x: x + 0.25, y: 2.65, w: 5.0, h: 1.0,
          fontSize: 12,
          color: theme.muted,
          fit: 'shrink',
        });
      }
      this.addBulletList(slide, this.normalizeBullets(column.bullets), {
        x: x + 0.25,
        y: column.content ? 3.35 : 2.75,
        w: 4.95,
        h: 2.7,
        color: theme.text,
        bulletColor: theme.accent,
      });
    });
  }

  renderChartSlide(slide, slideData, theme) {
    this.addSlideHeading(slide, slideData, theme);

    if (slideData.chart?.summary || slideData.content) {
      this.addText(slide, slideData.chart?.summary || slideData.content, {
        x: 0.9, y: 1.95, w: 4.0, h: 1.3,
        fontSize: 13,
        color: theme.muted,
        fit: 'shrink',
      });
    }

    const series = Array.isArray(slideData.chart?.series) ? slideData.chart.series.slice(0, 6) : [];
    const maxValue = Math.max(...series.map((point) => Number(point.value) || 0), 1);
    let cursorY = 2.3;

    series.forEach((point) => {
      this.addText(slide, point.label || '', {
        x: 5.2, y: cursorY - 0.05, w: 1.5, h: 0.3,
        fontSize: 11,
        color: theme.text,
      });
      slide.addShape('roundRect', {
        x: 6.8,
        y: cursorY,
        w: 4.6,
        h: 0.22,
        line: { color: this.stripHash(theme.accentSoft), transparency: 100 },
        fill: { color: this.stripHash(theme.accentSoft), transparency: 45 }
      });
      slide.addShape('roundRect', {
        x: 6.8,
        y: cursorY,
        w: Math.max(0.4, ((Number(point.value) || 0) / maxValue) * 4.6),
        h: 0.22,
        line: { color: this.stripHash(theme.accent), transparency: 100 },
        fill: { color: this.stripHash(theme.accent) }
      });
      this.addText(slide, String(point.value ?? ''), {
        x: 11.55, y: cursorY - 0.06, w: 0.8, h: 0.3,
        fontSize: 11,
        color: theme.text,
        bold: true,
      });
      cursorY += 0.65;
    });

    if (Array.isArray(slideData.stats) && slideData.stats.length > 0) {
      this.addStatCards(slide, slideData.stats.slice(0, 3), {
        x: 0.9,
        y: 3.8,
        w: 3.8,
        h: 1.0,
      }, theme);
    }
  }

  async renderImageSlide(slide, slideData, theme, options) {
    this.addSlideHeading(slide, slideData, theme);

    const imageAdded = await this.tryAddReferencedImage(slide, slideData)
      || await this.tryAddGeneratedImage(slide, slideData, options);
    if (!imageAdded) {
      slide.addShape('roundRect', {
        x: 6.6,
        y: 1.7,
        w: 5.5,
        h: 4.7,
        line: { color: this.stripHash(theme.accentSoft), transparency: 45 },
        fill: { color: this.stripHash(theme.accentSoft), transparency: 16 }
      });
      this.addText(slide, slideData.imagePrompt || 'Add a hero visual here.', {
        x: 6.95, y: 3.2, w: 4.8, h: 0.8,
        fontSize: 16,
        color: theme.muted,
        align: 'center',
      });
    }

    if (slideData.content) {
      this.addText(slide, slideData.content, {
        x: 0.9, y: 2.0, w: 4.9, h: 1.6,
        fontSize: 13,
        color: theme.text,
        fit: 'shrink',
      });
    }

    this.addBulletList(slide, slideData.bullets.slice(0, 4), {
      x: 0.9,
      y: 3.35,
      w: 4.8,
      h: 2.3,
      color: theme.text,
      bulletColor: theme.accent,
    });

    if (slideData.caption) {
      this.addText(slide, slideData.caption, {
        x: 6.7, y: 6.55, w: 5.1, h: 0.3,
        fontSize: 10,
        color: theme.muted,
        italic: true,
      });
    } else if (slideData.imageSource) {
      this.addText(slide, slideData.imageSource, {
        x: 6.7, y: 6.55, w: 5.1, h: 0.3,
        fontSize: 10,
        color: theme.muted,
        italic: true,
      });
    }
  }

  addSlideHeading(slide, slideData, theme) {
    if (slideData.kicker) {
      this.addText(slide, slideData.kicker, {
        x: 0.9, y: 0.55, w: 5.2, h: 0.25,
        fontSize: 9,
        color: theme.accent,
        bold: true,
      });
    }

    this.addText(slide, slideData.title, {
      x: 0.9, y: 0.95, w: 8.5, h: 0.6,
      fontSize: 22,
      bold: true,
      color: theme.text,
      fit: 'shrink',
    });

    if (slideData.subtitle) {
      this.addText(slide, slideData.subtitle, {
        x: 0.9, y: 1.48, w: 6.6, h: 0.35,
        fontSize: 11,
        color: theme.muted,
      });
    }
  }

  addBulletList(slide, bullets = [], box = {}, theme = {}) {
    const safeBullets = Array.isArray(bullets) ? bullets.filter(Boolean) : [];
    if (safeBullets.length === 0) {
      return;
    }

    safeBullets.forEach((bullet, index) => {
      const y = box.y + (index * 0.52);
      slide.addShape('ellipse', {
        x: box.x,
        y: y + 0.12,
        w: 0.1,
        h: 0.1,
        line: { color: this.stripHash(box.bulletColor || theme.accent || '#2563EB'), transparency: 100 },
        fill: { color: this.stripHash(box.bulletColor || theme.accent || '#2563EB') }
      });
      this.addText(slide, bullet, {
        x: box.x + 0.18,
        y,
        w: Math.max((box.w || 5) - 0.18, 1),
        h: 0.4,
        fontSize: 13,
        color: box.color || theme.text || '#0F172A',
        fit: 'shrink',
      });
    });
  }

  addStatCards(slide, stats = [], frame = {}, theme) {
    const count = Math.min(stats.length, 4);
    for (let index = 0; index < count; index += 1) {
      const stat = stats[index];
      const y = frame.y + (index * (frame.h + 0.15));
      slide.addShape('roundRect', {
        x: frame.x,
        y,
        w: frame.w,
        h: frame.h,
        line: { color: this.stripHash(theme.accentSoft), transparency: 55 },
        fill: { color: this.stripHash(theme.panel), transparency: 6 }
      });
      this.addText(slide, stat.label || 'Metric', {
        x: frame.x + 0.18,
        y: y + 0.12,
        w: frame.w - 0.36,
        h: 0.2,
        fontSize: 8,
        color: theme.muted,
        bold: true,
      });
      this.addText(slide, String(stat.value ?? ''), {
        x: frame.x + 0.18,
        y: y + 0.32,
        w: frame.w - 0.36,
        h: 0.32,
        fontSize: 18,
        color: theme.text,
        bold: true,
        fit: 'shrink',
      });
      if (stat.detail) {
        this.addText(slide, stat.detail, {
          x: frame.x + 0.18,
          y: y + frame.h - 0.3,
          w: frame.w - 0.36,
          h: 0.18,
          fontSize: 8,
          color: theme.muted,
        });
      }
    }
  }

  async tryAddGeneratedImage(slide, slideData, options = {}) {
    if (!slideData.imagePrompt || options.generateImages === false) {
      return false;
    }

    try {
      const imageData = await generateImage({
        prompt: slideData.imagePrompt,
        size: '1792x1024',
        model: options.imageModel || 'dall-e-3'
      });

      if (!imageData?.data?.[0]?.url) {
        return false;
      }

      const imageBuffer = await fetchImageBuffer(imageData.data[0].url);
      slide.addImage({
        data: imageBuffer.toString('base64'),
        x: 6.6,
        y: 1.7,
        w: 5.5,
        h: 4.7,
      });
      return true;
    } catch (error) {
      console.warn('[PptxGenerator] Failed to generate image:', error.message);
      return false;
    }
  }

  async tryAddReferencedImage(slide, slideData) {
    if (!slideData.imageUrl) {
      return false;
    }

    try {
      const imageBuffer = await fetchImageBuffer(slideData.imageUrl);
      slide.addImage({
        data: imageBuffer.toString('base64'),
        x: 6.6,
        y: 1.7,
        w: 5.5,
        h: 4.7,
        altText: slideData.imageAlt || slideData.title || 'Presentation image',
      });
      return true;
    } catch (error) {
      console.warn('[PptxGenerator] Failed to load referenced image:', error.message);
      return false;
    }
  }

  addSlideFooter(slide, slideNumber, title, theme) {
    slide.addText(`${title} - ${slideNumber}`, {
      x: 0.9,
      y: 7.0,
      w: 3.5,
      h: 0.2,
      fontSize: 8,
      color: theme.muted,
    });
  }

  addText(slide, text, options = {}) {
    slide.addText(String(text || ''), {
      margin: 0,
      valign: options.valign || 'mid',
      align: options.align || 'left',
      fontFace: options.fontFace || 'Aptos',
      ...options,
      color: this.stripHash(options.color || '#0F172A'),
    });
  }

  getTheme(theme = 'editorial') {
    const normalized = String(theme || '').trim().toLowerCase();
    const themes = {
      editorial: {
        id: 'editorial',
        background: '#F7F3EE',
        panel: '#FFF9F2',
        text: '#17212B',
        muted: '#66707A',
        accent: '#D94841',
        accentSoft: '#F6DDD7',
      },
      executive: {
        id: 'executive',
        background: '#F8FAFC',
        panel: '#FFFFFF',
        text: '#0F172A',
        muted: '#475569',
        accent: '#2563EB',
        accentSoft: '#DBEAFE',
      },
      product: {
        id: 'product',
        background: '#0F172A',
        panel: '#10233F',
        text: '#F8FAFC',
        muted: '#CBD5E1',
        accent: '#22C55E',
        accentSoft: '#183B2A',
      },
      bold: {
        id: 'bold',
        background: '#1F2937',
        panel: '#111827',
        text: '#F9FAFB',
        muted: '#D1D5DB',
        accent: '#F59E0B',
        accentSoft: '#4B2D00',
      },
    };

    return themes[normalized] || themes.editorial;
  }

  parseContentIntoSections(content) {
    const sections = [];
    const lines = String(content || '').split('\n');
    let currentSection = { title: '', content: [] };

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('#') || /^[A-Z][A-Z\s]+$/.test(trimmed)) {
        if (currentSection.title || currentSection.content.length > 0) {
          sections.push({
            title: currentSection.title,
            content: currentSection.content.join('\n')
          });
        }
        currentSection = {
          title: trimmed.replace(/^#+\s*/, ''),
          content: []
        };
      } else {
        currentSection.content.push(trimmed);
      }
    }

    if (currentSection.title || currentSection.content.length > 0) {
      sections.push({
        title: currentSection.title,
        content: currentSection.content.join('\n')
      });
    }

    return sections;
  }

  generateFilename(title) {
    const sanitized = String(title || 'presentation').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const timestamp = new Date().toISOString().split('T')[0];
    return `${sanitized}_${timestamp}.pptx`;
  }

  stripHash(value = '') {
    return String(value || '').replace(/^#/, '');
  }
}

async function fetchImageBuffer(url) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error('Failed to load image.');
}

module.exports = { PptxGenerator };
