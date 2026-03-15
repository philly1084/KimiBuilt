/**
 * PPTX Generator - PowerPoint presentation generation
 * Integrates with image generation for AI-generated slides
 */

const PptxGenJS = require('pptxgenjs');
const { generateImage } = require('../../openai-client');

class PptxGenerator {
  constructor() {
    this.mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }

  /**
   * Generate a presentation
   * @param {Object} template - Presentation template
   * @param {Object} variables - Template variables
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated presentation
   */
  async generate(template, variables, options = {}) {
    const pptx = new PptxGenJS();
    
    // Set metadata
    pptx.title = variables.title || template.name || 'Presentation';
    pptx.subject = variables.subject || '';
    pptx.author = variables.author || 'LillyBuilt AI';
    
    // Build slides based on template type
    switch (template.id) {
      case 'presentation-title-slide':
        await this.buildTitleSlide(pptx, variables);
        break;
      case 'presentation-bullet-points':
        await this.buildBulletPointSlides(pptx, variables);
        break;
      case 'presentation-image-heavy':
        await this.buildImageHeavySlides(pptx, variables, options);
        break;
      default:
        await this.buildGenericSlides(pptx, variables);
    }
    
    // Generate buffer
    const buffer = await pptx.write({ outputType: 'nodebuffer' });
    
    return {
      buffer,
      filename: this.generateFilename(variables.title || 'presentation'),
      mimeType: this.mimeType
    };
  }

  /**
   * Build a title slide
   */
  async buildTitleSlide(pptx, variables) {
    const slide = pptx.addSlide();
    
    // Title
    slide.addText(variables.title || 'Untitled Presentation', {
      x: 1, y: 2, w: 8, h: 1.5,
      fontSize: 44,
      bold: true,
      align: 'center',
      color: '363636'
    });
    
    // Subtitle
    if (variables.subtitle) {
      slide.addText(variables.subtitle, {
        x: 1, y: 3.5, w: 8, h: 0.8,
        fontSize: 24,
        align: 'center',
        color: '666666'
      });
    }
    
    // Author/Presenter
    if (variables.author) {
      slide.addText(`By ${variables.author}`, {
        x: 1, y: 5, w: 8, h: 0.5,
        fontSize: 18,
        align: 'center',
        color: '999999'
      });
    }
    
    // Add AI-generated background image if requested
    if (variables.generateBackground && variables.backgroundPrompt) {
      try {
        const imageData = await generateImage({
          prompt: variables.backgroundPrompt,
          size: '1792x1024',
          model: 'dall-e-3'
        });
        
        if (imageData.data && imageData.data[0]) {
          const imageUrl = imageData.data[0].url;
          const imageBuffer = await fetchImageBuffer(imageUrl);
          slide.background = { data: imageBuffer.toString('base64') };
        }
      } catch (err) {
        console.warn('[PptxGenerator] Failed to generate background:', err.message);
      }
    }
  }

  /**
   * Build bullet point slides
   */
  async buildBulletPointSlides(pptx, variables) {
    const slides = variables.slides || [];
    
    for (const slideData of slides) {
      const slide = pptx.addSlide();
      
      // Slide title
      if (slideData.title) {
        slide.addText(slideData.title, {
          x: 0.5, y: 0.5, w: 9, h: 0.8,
          fontSize: 32,
          bold: true,
          color: '363636'
        });
      }
      
      // Bullet points
      if (slideData.bullets && slideData.bullets.length > 0) {
        const bulletPoints = slideData.bullets.map(bullet => ({
          text: bullet,
          options: { fontSize: 20, breakLine: true }
        }));
        
        slide.addText(bulletPoints, {
          x: 0.5, y: 1.5, w: 9, h: 5,
          bullet: { type: 'number', color: '666666' },
          lineSpacing: 30,
          color: '444444'
        });
      }
      
      // Add slide image if provided
      if (slideData.imagePrompt) {
        try {
          const imageData = await generateImage({
            prompt: slideData.imagePrompt,
            size: '1024x1024',
            model: 'dall-e-3'
          });
          
          if (imageData.data && imageData.data[0]) {
            const imageUrl = imageData.data[0].url;
            const imageBuffer = await fetchImageBuffer(imageUrl);
            
            slide.addImage({
              data: imageBuffer.toString('base64'),
              x: 6.5, y: 1.5, w: 3, h: 3
            });
          }
        } catch (err) {
          console.warn('[PptxGenerator] Failed to generate slide image:', err.message);
        }
      }
    }
  }

  /**
   * Build image-heavy slides
   */
  async buildImageHeavySlides(pptx, variables, options) {
    const slides = variables.slides || [];
    
    for (const slideData of slides) {
      const slide = pptx.addSlide();
      
      // Title
      if (slideData.title) {
        slide.addText(slideData.title, {
          x: 0.5, y: 0.3, w: 9, h: 0.6,
          fontSize: 28,
          bold: true,
          color: '363636'
        });
      }
      
      // Generate and add main image
      if (slideData.imagePrompt) {
        try {
          const imageData = await generateImage({
            prompt: slideData.imagePrompt,
            size: slideData.imageSize === 'portrait' ? '1024x1792' : '1792x1024',
            model: slideData.imageModel || 'dall-e-3'
          });
          
          if (imageData.data && imageData.data[0]) {
            const imageUrl = imageData.data[0].url;
            const imageBuffer = await fetchImageBuffer(imageUrl);
            
            // Image placement based on layout
            const layout = slideData.layout || 'full';
            const imageConfig = this.getImageLayout(layout);
            
            slide.addImage({
              data: imageBuffer.toString('base64'),
              ...imageConfig
            });
          }
        } catch (err) {
          console.warn('[PptxGenerator] Failed to generate image:', err.message);
        }
      }
      
      // Caption
      if (slideData.caption) {
        slide.addText(slideData.caption, {
          x: 0.5, y: 6.8, w: 9, h: 0.5,
          fontSize: 14,
          italic: true,
          align: 'center',
          color: '666666'
        });
      }
    }
  }

  /**
   * Build generic slides from content
   */
  async buildGenericSlides(pptx, variables) {
    const content = variables.content || variables.body || '';
    const sections = this.parseContentIntoSections(content);
    
    for (const section of sections) {
      const slide = pptx.addSlide();
      
      // Title
      if (section.title) {
        slide.addText(section.title, {
          x: 0.5, y: 0.5, w: 9, h: 0.8,
          fontSize: 32,
          bold: true,
          color: '363636'
        });
      }
      
      // Body content
      if (section.content) {
        slide.addText(section.content, {
          x: 0.5, y: 1.5, w: 9, h: 5,
          fontSize: 18,
          lineSpacing: 24,
          color: '444444'
        });
      }
    }
  }

  /**
   * Generate presentation from outline
   */
  async generateFromOutline(outline, options = {}) {
    const pptx = new PptxGenJS();
    
    pptx.title = options.title || 'Generated Presentation';
    pptx.author = 'LillyBuilt AI';
    
    // Title slide
    const titleSlide = pptx.addSlide();
    titleSlide.addText(options.title || 'Presentation', {
      x: 1, y: 2, w: 8, h: 1.5,
      fontSize: 44,
      bold: true,
      align: 'center'
    });
    
    // Content slides from outline
    for (const item of outline) {
      const slide = pptx.addSlide();
      
      // Main point
      slide.addText(item.title || item, {
        x: 0.5, y: 0.5, w: 9, h: 0.8,
        fontSize: 32,
        bold: true,
        color: '363636'
      });
      
      // Sub-points
      if (item.subpoints && item.subpoints.length > 0) {
        const bullets = item.subpoints.map(sp => ({
          text: sp,
          options: { fontSize: 20 }
        }));
        
        slide.addText(bullets, {
          x: 0.5, y: 1.5, w: 9, h: 5,
          bullet: true,
          lineSpacing: 28
        });
      }
      
      // Generate slide image if AI images enabled
      if (options.generateImages && item.imagePrompt) {
        try {
          const imageData = await generateImage({
            prompt: item.imagePrompt,
            size: '1024x1024',
            model: 'dall-e-3'
          });
          
          if (imageData.data && imageData.data[0]) {
            const imageBuffer = await fetchImageBuffer(imageData.data[0].url);
            slide.addImage({
              data: imageBuffer.toString('base64'),
              x: 6.5, y: 2, w: 3, h: 3
            });
          }
        } catch (err) {
          console.warn('[PptxGenerator] Image generation failed:', err.message);
        }
      }
    }
    
    const buffer = await pptx.write({ outputType: 'nodebuffer' });
    
    return {
      buffer,
      filename: this.generateFilename(options.title || 'presentation'),
      mimeType: this.mimeType
    };
  }

  /**
   * Get image layout configuration
   */
  getImageLayout(layout) {
    const layouts = {
      full: { x: 0.5, y: 1, w: 9, h: 5.5 },
      left: { x: 0.5, y: 1.5, w: 4.5, h: 5 },
      right: { x: 5, y: 1.5, w: 4.5, h: 5 },
      top: { x: 1, y: 1, w: 8, h: 4 },
      bottom: { x: 1, y: 3.5, w: 8, h: 3.5 }
    };
    return layouts[layout] || layouts.full;
  }

  /**
   * Parse content into sections
   */
  parseContentIntoSections(content) {
    const sections = [];
    const lines = content.split('\n');
    let currentSection = { title: '', content: [] };
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Check if it's a heading (starts with # or is all caps)
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
    
    // Add last section
    if (currentSection.title || currentSection.content.length > 0) {
      sections.push({
        title: currentSection.title,
        content: currentSection.content.join('\n')
      });
    }
    
    return sections;
  }

  /**
   * Generate filename
   */
  generateFilename(title) {
    const sanitized = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const timestamp = new Date().toISOString().split('T')[0];
    return `${sanitized}_${timestamp}.pptx`;
  }
}

/**
 * Fetch image buffer from URL
 */
async function fetchImageBuffer(url) {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { PptxGenerator };
