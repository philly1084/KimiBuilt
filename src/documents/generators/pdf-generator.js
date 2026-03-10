/**
 * PDF Document Generator
 * Uses pdfmake library for client/server PDF generation
 */

class PdfGenerator {
  constructor() {
    this.mimeType = 'application/pdf';
    this.vfs = null;
    this.pdfMake = null;
  }

  /**
   * Initialize pdfmake (for server-side)
   */
  async initialize() {
    if (!this.pdfMake) {
      const pdfMakeModule = await import('pdfmake');
      const pdfFonts = await import('pdfmake/build/vfs_fonts.js');
      
      this.pdfMake = pdfMakeModule.default || pdfMakeModule;
      this.vfs = pdfFonts.default || pdfFonts;
      
      this.pdfMake.vfs = this.vfs.pdfMake ? this.vfs.pdfMake.vfs : this.vfs;
    }
  }

  /**
   * Generate PDF from template
   * @param {Object} template - Populated template
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated PDF
   */
  async generate(template, options = {}) {
    await this.initialize();

    const docDefinition = this.buildDocumentDefinition(template, options);
    
    const pdfDocGenerator = this.pdfMake.createPdf(docDefinition);
    
    return new Promise((resolve, reject) => {
      pdfDocGenerator.getBuffer((buffer) => {
        resolve({
          buffer,
          metadata: {
            format: 'pdf',
            pages: docDefinition.content.length
          }
        });
      });
    });
  }

  /**
   * Generate PDF from AI-generated content
   * @param {Object} content - Content structure
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated PDF
   */
  async generateFromContent(content, options = {}) {
    await this.initialize();

    const docDefinition = this.buildContentDefinition(content, options);
    
    const pdfDocGenerator = this.pdfMake.createPdf(docDefinition);
    
    return new Promise((resolve, reject) => {
      pdfDocGenerator.getBuffer((buffer) => {
        resolve({
          buffer,
          metadata: {
            format: 'pdf',
            title: content.title,
            sections: content.sections?.length || 0
          }
        });
      });
    });
  }

  /**
   * Build document definition from template
   * @param {Object} template - Template data
   * @param {Object} options - Options
   * @returns {Object} pdfmake document definition
   */
  buildDocumentDefinition(template, options) {
    const v = template.variables || {};

    const docDefinition = {
      pageSize: 'A4',
      pageMargins: [40, 60, 40, 60],
      
      defaultStyle: {
        font: 'Roboto',
        fontSize: 11,
        lineHeight: 1.3
      },

      styles: {
        title: {
          fontSize: 24,
          bold: true,
          margin: [0, 0, 0, 20],
          alignment: 'center'
        },
        heading1: {
          fontSize: 18,
          bold: true,
          margin: [0, 20, 0, 10]
        },
        heading2: {
          fontSize: 14,
          bold: true,
          margin: [0, 15, 0, 8]
        },
        heading3: {
          fontSize: 12,
          bold: true,
          margin: [0, 10, 0, 5]
        },
        paragraph: {
          margin: [0, 0, 0, 10]
        },
        list: {
          margin: [0, 0, 0, 10]
        },
        tableHeader: {
          bold: true,
          fillColor: '#f0f0f0'
        }
      }
    };

    // Build content based on template type
    switch (template.id) {
      case 'business-letter':
        docDefinition.content = this.buildBusinessLetter(v);
        break;
      case 'resume-modern':
        docDefinition.content = this.buildResume(v);
        break;
      case 'meeting-notes':
        docDefinition.content = this.buildMeetingNotes(v);
        break;
      case 'invoice':
        docDefinition.content = this.buildInvoice(v);
        break;
      default:
        docDefinition.content = this.buildGenericContent(v);
    }

    // Add header/footer if requested
    if (options.includePageNumbers) {
      docDefinition.footer = (currentPage, pageCount) => ({
        text: `Page ${currentPage} of ${pageCount}`,
        alignment: 'center',
        fontSize: 9,
        margin: [0, 20, 0, 0]
      });
    }

    return docDefinition;
  }

  /**
   * Build content definition from AI-generated structure
   * @param {Object} content - Content structure
   * @param {Object} options - Options
   * @returns {Object} pdfmake document definition
   */
  buildContentDefinition(content, options = {}) {
    const docContent = [];

    // Title
    if (content.title) {
      docContent.push({
        text: content.title,
        style: 'title'
      });
    }

    // Table of Contents
    if (options.includeTableOfContents && content.sections?.length > 2) {
      docContent.push(
        { text: 'Table of Contents', style: 'heading1' },
        ...content.sections.map(section => ({
          text: section.heading,
          margin: [section.level * 20, 2, 0, 2],
          fontSize: 11
        })),
        { text: '', margin: [0, 20, 0, 0] }
      );
    }

    // Sections
    if (content.sections) {
      for (const section of content.sections) {
        // Section heading
        if (section.heading) {
          const styleName = `heading${Math.min(section.level || 1, 3)}`;
          docContent.push({
            text: section.heading,
            style: styleName
          });
        }

        // Section content
        if (section.content) {
          const paragraphs = this.parseContent(section.content);
          docContent.push(...paragraphs);
        }
      }
    }

    return {
      pageSize: 'A4',
      pageMargins: [40, 60, 40, 60],
      
      defaultStyle: {
        font: 'Roboto',
        fontSize: 11,
        lineHeight: 1.3
      },

      styles: {
        title: {
          fontSize: 24,
          bold: true,
          margin: [0, 0, 0, 20],
          alignment: 'center'
        },
        heading1: {
          fontSize: 18,
          bold: true,
          margin: [0, 20, 0, 10]
        },
        heading2: {
          fontSize: 14,
          bold: true,
          margin: [0, 15, 0, 8]
        },
        heading3: {
          fontSize: 12,
          bold: true,
          margin: [0, 10, 0, 5]
        },
        paragraph: {
          margin: [0, 0, 0, 10]
        }
      },

      content: docContent,

      footer: options.includePageNumbers ? (currentPage, pageCount) => ({
        text: `Page ${currentPage} of ${pageCount}`,
        alignment: 'center',
        fontSize: 9,
        margin: [0, 20, 0, 0]
      }) : undefined
    };
  }

  /**
   * Build business letter
   * @param {Object} v - Variables
   * @returns {Array} PDF content
   */
  buildBusinessLetter(v) {
    const content = [];

    // Sender info
    if (v.sender_name) {
      content.push({ text: v.sender_name, margin: [0, 0, 0, 0] });
      if (v.sender_title) content.push({ text: v.sender_title, margin: [0, 0, 0, 0] });
      if (v.sender_address) content.push({ text: v.sender_address, margin: [0, 0, 0, 20] });
    }

    // Date
    content.push({ 
      text: v.date || new Date().toLocaleDateString(),
      margin: [0, 0, 0, 20]
    });

    // Recipient
    if (v.recipient_name) {
      content.push({ text: v.recipient_name, margin: [0, 0, 0, 0] });
      if (v.recipient_title) content.push({ text: v.recipient_title, margin: [0, 0, 0, 0] });
      if (v.company_name) content.push({ text: v.company_name, margin: [0, 0, 0, 20] });
    }

    // Subject
    if (v.subject) {
      content.push({
        text: [{ text: 'Subject: ', bold: true }, v.subject],
        margin: [0, 0, 0, 20]
      });
    }

    // Salutation
    content.push({
      text: v.salutation || `Dear ${v.recipient_name || 'Sir/Madam'},`,
      margin: [0, 0, 0, 20]
    });

    // Body
    if (v.body) {
      const paragraphs = v.body.split('\n\n').filter(p => p.trim());
      for (const para of paragraphs) {
        content.push({
          text: para.trim(),
          style: 'paragraph'
        });
      }
    }

    // Closing
    content.push({
      text: v.closing || 'Sincerely,',
      margin: [0, 40, 0, 40]
    });

    // Signature
    if (v.signature) content.push({ text: v.signature });
    if (v.sender_name) content.push({ text: v.sender_name });

    return content;
  }

  /**
   * Build resume
   * @param {Object} v - Variables
   * @returns {Array} PDF content
   */
  buildResume(v) {
    const content = [];

    // Name
    content.push({
      text: v.full_name || 'Name',
      style: 'title',
      alignment: 'center'
    });

    // Contact info
    const contactParts = [];
    if (v.email) contactParts.push(v.email);
    if (v.phone) contactParts.push(v.phone);
    if (v.location) contactParts.push(v.location);

    if (contactParts.length > 0) {
      content.push({
        text: contactParts.join(' | '),
        alignment: 'center',
        margin: [0, 0, 0, 20]
      });
    }

    // Separator line
    content.push({
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2 }],
      margin: [0, 0, 0, 20]
    });

    // Summary
    if (v.summary) {
      content.push({ text: 'PROFESSIONAL SUMMARY', style: 'heading2' });
      content.push({ text: v.summary, style: 'paragraph' });
    }

    // Experience
    if (v.experience) {
      content.push({ text: 'EXPERIENCE', style: 'heading2' });
      content.push(...this.parseContent(v.experience));
    }

    // Education
    if (v.education) {
      content.push({ text: 'EDUCATION', style: 'heading2' });
      content.push(...this.parseContent(v.education));
    }

    // Skills
    if (v.skills) {
      content.push({ text: 'SKILLS', style: 'heading2' });
      content.push({ text: v.skills, style: 'paragraph' });
    }

    return content;
  }

  /**
   * Build meeting notes
   * @param {Object} v - Variables
   * @returns {Array} PDF content
   */
  buildMeetingNotes(v) {
    const content = [];

    // Title
    content.push({
      text: v.meeting_title || 'Meeting Notes',
      style: 'title'
    });

    // Details table
    const details = [];
    if (v.meeting_date) details.push(['Date:', v.meeting_date]);
    if (v.meeting_time) details.push(['Time:', v.meeting_time]);
    if (v.location) details.push(['Location:', v.location]);
    if (v.facilitator) details.push(['Facilitator:', v.facilitator]);

    if (details.length > 0) {
      content.push({
        table: {
          widths: [100, '*'],
          body: details.map(([label, value]) => [
            { text: label, bold: true },
            value
          ])
        },
        margin: [0, 0, 0, 20]
      });
    }

    // Attendees
    if (v.attendees) {
      content.push({ text: 'Attendees', style: 'heading2' });
      const attendees = v.attendees.split('\n').filter(a => a.trim());
      content.push({
        ul: attendees,
        margin: [0, 0, 0, 20]
      });
    }

    // Agenda
    if (v.agenda) {
      content.push({ text: 'Agenda', style: 'heading2' });
      content.push(...this.parseContent(v.agenda));
    }

    // Notes
    if (v.notes) {
      content.push({ text: 'Notes', style: 'heading2' });
      content.push(...this.parseContent(v.notes));
    }

    // Action Items
    if (v.action_items) {
      content.push({ text: 'Action Items', style: 'heading2' });
      const items = v.action_items.split('\n').filter(i => i.trim());
      content.push({
        ul: items.map(item => `☐ ${item.trim()}`),
        margin: [0, 0, 0, 20]
      });
    }

    return content;
  }

  /**
   * Build invoice
   * @param {Object} v - Variables
   * @returns {Array} PDF content
   */
  buildInvoice(v) {
    const content = [];

    // Header
    content.push({
      columns: [
        { text: '', width: '*' },
        { 
          stack: [
            { text: 'INVOICE', style: 'title', alignment: 'right' },
            { text: `Invoice #: ${v.invoice_number || ''}`, alignment: 'right' },
            { text: `Date: ${v.invoice_date || new Date().toLocaleDateString()}`, alignment: 'right' }
          ],
          width: 'auto'
        }
      ],
      margin: [0, 0, 0, 30]
    });

    // From/To
    const columns = [];
    
    if (v.company_name) {
      columns.push({
        stack: [
          { text: 'From:', bold: true, margin: [0, 0, 0, 5] },
          { text: v.company_name },
          { text: v.company_address || '' }
        ],
        width: '*'
      });
    }

    if (v.client_name) {
      columns.push({
        stack: [
          { text: 'To:', bold: true, margin: [0, 0, 0, 5] },
          { text: v.client_name },
          { text: v.client_address || '' }
        ],
        width: '*'
      });
    }

    if (columns.length > 0) {
      content.push({ columns, margin: [0, 0, 0, 30] });
    }

    // Items table would go here
    content.push({ text: 'Invoice content would be rendered here', margin: [0, 20, 0, 0] });

    return content;
  }

  /**
   * Build generic content
   * @param {Object} v - Variables
   * @returns {Array} PDF content
   */
  buildGenericContent(v) {
    const content = [];

    for (const [key, value] of Object.entries(v)) {
      if (value && typeof value === 'string') {
        const heading = key.split('_').map(w => 
          w.charAt(0).toUpperCase() + w.slice(1)
        ).join(' ');

        content.push({ text: heading, style: 'heading2' });
        content.push(...this.parseContent(value));
      }
    }

    return content;
  }

  /**
   * Parse content string into PDF elements
   * @param {string} content - Content to parse
   * @returns {Array} PDF elements
   */
  parseContent(content) {
    if (!content) return [];

    const elements = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Bullet list
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        elements.push({
          ul: [trimmed.substring(2)],
          margin: [0, 0, 0, 5]
        });
      }
      // Numbered list
      else if (/^\d+\.\s/.test(trimmed)) {
        elements.push({
          ol: [trimmed.replace(/^\d+\.\s/, '')],
          margin: [0, 0, 0, 5]
        });
      }
      // Regular paragraph
      else {
        elements.push({
          text: trimmed,
          style: 'paragraph'
        });
      }
    }

    return elements;
  }
}

module.exports = { PdfGenerator };
