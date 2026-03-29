/**
 * DOCX Document Generator
 * Uses the docx library to generate Word documents
 */

const docx = require('docx');
const { Document, Paragraph, TextRun, HeadingLevel, AlignmentType, 
        BorderStyle, Table, TableCell, TableRow, WidthType, 
        convertInchesToTwip, Header, Footer, PageNumber } = docx;

class DocxGenerator {
  constructor() {
    this.mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }

  /**
   * Generate a DOCX document from template/populated data
   * @param {Object} template - Populated template
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated document
   */
  async generate(template, options = {}) {
    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(options.marginTop || 1),
              right: convertInchesToTwip(options.marginRight || 1),
              bottom: convertInchesToTwip(options.marginBottom || 1),
              left: convertInchesToTwip(options.marginLeft || 1)
            }
          }
        },
        headers: options.includeHeaders ? this.createHeader(template) : undefined,
        footers: options.includePageNumbers ? this.createFooter() : undefined,
        children: this.buildDocumentContent(template, options)
      }]
    });

    const buffer = await docx.Packer.toBuffer(doc);

    return {
      buffer,
      metadata: {
        format: 'docx',
        sections: template.sections?.length || 1
      }
    };
  }

  /**
   * Generate from content structure (AI-generated)
   * @param {Object} content - Content structure
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated document
   */
  async generateFromContent(content, options = {}) {
    const children = [];

    // Title
    if (content.title) {
      children.push(new Paragraph({
        text: content.title,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 }
      }));
    }

    // Table of Contents
    if (options.includeTableOfContents && content.sections?.length > 2) {
      children.push(new Paragraph({
        text: 'Table of Contents',
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 200 }
      }));
      
      for (const section of content.sections) {
        children.push(new Paragraph({
          text: section.heading,
          spacing: { after: 100 },
          tabStops: [{
            type: 'right',
            position: convertInchesToTwip(6)
          }]
        }));
      }
      
      children.push(new Paragraph({
        text: '',
        spacing: { after: 400 },
        border: {
          bottom: {
            color: 'CCCCCC',
            space: 1,
            style: BorderStyle.SINGLE,
            size: 6
          }
        }
      }));
    }

    // Sections
    if (content.sections) {
      for (const section of content.sections) {
        // Section heading
        if (section.heading) {
          const headingLevel = this.mapHeadingLevel(section.level);
          children.push(new Paragraph({
            text: section.heading,
            heading: headingLevel,
            spacing: { before: 300, after: 200 }
          }));
        }

        children.push(...this.buildStructuredSection(section));
      }
    }

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1)
            }
          }
        },
        footers: options.includePageNumbers ? this.createFooter() : undefined,
        children
      }]
    });

    const buffer = await docx.Packer.toBuffer(doc);

    return {
      buffer,
      metadata: {
        format: 'docx',
        title: content.title,
        sections: content.sections?.length || 0
      }
    };
  }

  /**
   * Build document content from template
   * @param {Object} template - Template data
   * @param {Object} options - Options
   * @returns {Array} Array of docx elements
   */
  buildDocumentContent(template, options) {
    const children = [];

    // Template-specific content building
    switch (template.id) {
      case 'business-letter':
        return this.buildBusinessLetter(template, options);
      case 'resume-modern':
        return this.buildResume(template, options);
      case 'meeting-notes':
        return this.buildMeetingNotes(template, options);
      case 'invoice':
        return this.buildInvoice(template, options);
      default:
        return this.buildGenericDocument(template, options);
    }
  }

  /**
   * Build business letter content
   * @param {Object} data - Letter data
   * @returns {Array} docx elements
   */
  buildBusinessLetter(data, options) {
    const children = [];
    const v = data.variables || {};

    // Sender info
    if (v.sender_name) {
      children.push(new Paragraph({
        text: v.sender_name,
        spacing: { after: 0 }
      }));
      if (v.sender_title) {
        children.push(new Paragraph({
          text: v.sender_title,
          spacing: { after: 0 }
        }));
      }
      if (v.sender_address) {
        children.push(new Paragraph({
          text: v.sender_address,
          spacing: { after: 200 }
        }));
      }
    }

    // Date
    children.push(new Paragraph({
      text: v.date || new Date().toLocaleDateString(),
      spacing: { after: 200 }
    }));

    // Recipient
    if (v.recipient_name) {
      children.push(new Paragraph({
        text: v.recipient_name,
        spacing: { after: 0 }
      }));
      if (v.recipient_title) {
        children.push(new Paragraph({
          text: v.recipient_title,
          spacing: { after: 0 }
        }));
      }
      if (v.company_name) {
        children.push(new Paragraph({
          text: v.company_name,
          spacing: { after: 200 }
        }));
      }
    }

    // Subject
    if (v.subject) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: 'Subject: ', bold: true }),
          new TextRun(v.subject)
        ],
        spacing: { after: 200 }
      }));
    }

    // Salutation
    const salutation = v.salutation || `Dear ${v.recipient_name || 'Sir/Madam'},`;
    children.push(new Paragraph({
      text: salutation,
      spacing: { after: 200 }
    }));

    // Body
    if (v.body) {
      const paragraphs = v.body.split('\n\n');
      for (const para of paragraphs) {
        if (para.trim()) {
          children.push(new Paragraph({
            text: para.trim(),
            spacing: { after: 200 }
          }));
        }
      }
    }

    // Closing
    const closing = v.closing || 'Sincerely,';
    children.push(new Paragraph({
      text: closing,
      spacing: { before: 400, after: 400 }
    }));

    // Signature
    if (v.signature) {
      children.push(new Paragraph({
        text: v.signature,
        spacing: { after: 0 }
      }));
    }
    if (v.sender_name) {
      children.push(new Paragraph({
        text: v.sender_name,
        spacing: { after: 0 }
      }));
    }

    return children;
  }

  buildStructuredSection(section = {}) {
    const children = [];

    if (section.content) {
      children.push(...this.parseContent(section.content));
    }

    if (Array.isArray(section.bullets) && section.bullets.length > 0) {
      section.bullets.forEach((bullet) => {
        children.push(new Paragraph({
          text: bullet,
          bullet: { level: 0 },
          spacing: { after: 100 }
        }));
      });
    }

    const callout = this.normalizeCallout(section.callout);
    if (callout) {
      children.push(this.buildCalloutTable(callout));
    }

    if (Array.isArray(section.stats) && section.stats.length > 0) {
      children.push(this.buildKeyValueTable(
        ['Metric', 'Value', 'Context'],
        section.stats.map((stat) => [stat.label || '', stat.value || '', stat.detail || ''])
      ));
    }

    if (section.table?.headers?.length || section.table?.rows?.length) {
      children.push(this.buildKeyValueTable(
        section.table.headers || [],
        section.table.rows || [],
        section.table.caption || ''
      ));
    }

    if (section.chart?.series?.length) {
      children.push(new Paragraph({
        text: section.chart.title || 'Chart',
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 160, after: 100 }
      }));
      if (section.chart.summary) {
        children.push(...this.parseContent(section.chart.summary));
      }
      children.push(this.buildKeyValueTable(
        ['Label', 'Value'],
        section.chart.series.map((point) => [point.label || '', String(point.value ?? '')]),
      ));
    }

    return children;
  }

  normalizeCallout(callout) {
    if (!callout) {
      return null;
    }

    if (typeof callout === 'string') {
      return {
        title: '',
        body: callout,
      };
    }

    return {
      title: callout.title || '',
      body: callout.body || callout.content || callout.text || '',
    };
  }

  buildCalloutTable(callout) {
    const text = [callout.title, callout.body].filter(Boolean).join('\n');
    return new Table({
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({
                children: this.parseInlineFormatting(text),
                spacing: { after: 120 },
              })],
              width: { size: 100, type: WidthType.PERCENTAGE }
            })
          ]
        })
      ],
      width: { size: 100, type: WidthType.PERCENTAGE }
    });
  }

  buildKeyValueTable(headers = [], rows = [], caption = '') {
    const safeHeaders = Array.isArray(headers) ? headers : [];
    const safeRows = Array.isArray(rows) ? rows : [];
    const tableRows = [];

    if (caption) {
      tableRows.push(new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({
              text: caption,
              spacing: { after: 80 }
            })],
            columnSpan: Math.max(safeHeaders.length || 1, 1),
            width: { size: 100, type: WidthType.PERCENTAGE }
          }),
          ...Array.from({ length: Math.max((safeHeaders.length || 1) - 1, 0) }, () => new TableCell({ children: [new Paragraph('')] }))
        ]
      }));
    }

    if (safeHeaders.length > 0) {
      tableRows.push(new TableRow({
        children: safeHeaders.map((header) => new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ text: header, bold: true })]
          })]
        }))
      }));
    }

    safeRows.forEach((row) => {
      tableRows.push(new TableRow({
        children: row.map((cell) => new TableCell({
          children: [new Paragraph(String(cell ?? ''))]
        }))
      }));
    });

    return new Table({
      rows: tableRows,
      width: { size: 100, type: WidthType.PERCENTAGE }
    });
  }

  /**
   * Build resume content
   * @param {Object} data - Resume data
   * @returns {Array} docx elements
   */
  buildResume(data, options) {
    const children = [];
    const v = data.variables || {};

    // Name header
    children.push(new Paragraph({
      text: v.full_name || 'Name',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 }
    }));

    // Contact info
    const contactParts = [];
    if (v.email) contactParts.push(v.email);
    if (v.phone) contactParts.push(v.phone);
    if (v.location) contactParts.push(v.location);
    if (v.linkedin) contactParts.push(v.linkedin);

    if (contactParts.length > 0) {
      children.push(new Paragraph({
        text: contactParts.join(' | '),
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 },
        border: {
          bottom: {
            color: '333333',
            space: 1,
            style: BorderStyle.SINGLE,
            size: 12
          }
        }
      }));
    }

    // Summary
    if (v.summary) {
      children.push(new Paragraph({
        text: 'PROFESSIONAL SUMMARY',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 200, after: 100 }
      }));
      children.push(new Paragraph({
        text: v.summary,
        spacing: { after: 200 }
      }));
    }

    // Experience
    if (v.experience) {
      children.push(new Paragraph({
        text: 'EXPERIENCE',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 200, after: 100 }
      }));
      const expParagraphs = this.parseContent(v.experience);
      children.push(...expParagraphs);
    }

    // Education
    if (v.education) {
      children.push(new Paragraph({
        text: 'EDUCATION',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 200, after: 100 }
      }));
      const eduParagraphs = this.parseContent(v.education);
      children.push(...eduParagraphs);
    }

    // Skills
    if (v.skills) {
      children.push(new Paragraph({
        text: 'SKILLS',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 200, after: 100 }
      }));
      children.push(new Paragraph({
        text: v.skills,
        spacing: { after: 200 }
      }));
    }

    return children;
  }

  /**
   * Build meeting notes content
   * @param {Object} data - Meeting data
   * @returns {Array} docx elements
   */
  buildMeetingNotes(data, options) {
    const children = [];
    const v = data.variables || {};

    // Title
    children.push(new Paragraph({
      text: v.meeting_title || 'Meeting Notes',
      heading: HeadingLevel.TITLE,
      spacing: { after: 200 }
    }));

    // Meeting details table
    const details = [
      ['Date:', v.meeting_date || ''],
      ['Time:', v.meeting_time || ''],
      ['Location:', v.location || ''],
      ['Facilitator:', v.facilitator || '']
    ];

    const tableRows = details.map(([label, value]) => 
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({
              children: [new TextRun({ text: label, bold: true })]
            })],
            width: { size: 30, type: WidthType.PERCENTAGE }
          }),
          new TableCell({
            children: [new Paragraph(value)],
            width: { size: 70, type: WidthType.PERCENTAGE }
          })
        ]
      })
    );

    children.push(new Table({
      rows: tableRows,
      width: { size: 100, type: WidthType.PERCENTAGE }
    }));

    children.push(new Paragraph({ spacing: { after: 200 } }));

    // Attendees
    if (v.attendees) {
      children.push(new Paragraph({
        text: 'Attendees',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 }
      }));
      const attendeeList = v.attendees.split('\n');
      for (const attendee of attendeeList) {
        if (attendee.trim()) {
          children.push(new Paragraph({
            text: attendee.trim(),
            bullet: { level: 0 },
            spacing: { after: 50 }
          }));
        }
      }
    }

    // Agenda
    if (v.agenda) {
      children.push(new Paragraph({
        text: 'Agenda',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 }
      }));
      children.push(...this.parseContent(v.agenda));
    }

    // Notes
    if (v.notes) {
      children.push(new Paragraph({
        text: 'Notes',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 }
      }));
      children.push(...this.parseContent(v.notes));
    }

    // Action Items
    if (v.action_items) {
      children.push(new Paragraph({
        text: 'Action Items',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 }
      }));
      const items = v.action_items.split('\n');
      for (const item of items) {
        if (item.trim()) {
          children.push(new Paragraph({
            text: `☐ ${item.trim()}`,
            spacing: { after: 100 }
          }));
        }
      }
    }

    return children;
  }

  /**
   * Build invoice content
   * @param {Object} data - Invoice data
   * @returns {Array} docx elements
   */
  buildInvoice(data, options) {
    const children = [];
    const v = data.variables || {};

    // Invoice title
    children.push(new Paragraph({
      text: 'INVOICE',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.RIGHT,
      spacing: { after: 100 }
    }));

    // Invoice number and date
    children.push(new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({ text: 'Invoice #: ', bold: true }),
        new TextRun(v.invoice_number || ''),
      ],
      spacing: { after: 50 }
    }));
    children.push(new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({ text: 'Date: ', bold: true }),
        new TextRun(v.invoice_date || new Date().toLocaleDateString()),
      ],
      spacing: { after: 200 }
    }));

    // From/To section would go here
    // (simplified for brevity)

    return children;
  }

  /**
   * Build generic document
   * @param {Object} data - Document data
   * @returns {Array} docx elements
   */
  buildGenericDocument(data, options) {
    const children = [];

    // Title
    if (data.name || data.title) {
      children.push(new Paragraph({
        text: data.name || data.title,
        heading: HeadingLevel.TITLE,
        spacing: { after: 200 }
      }));
    }

    // Variables as sections
    if (data.variables) {
      for (const [key, value] of Object.entries(data.variables)) {
        if (value && typeof value === 'string') {
          // Format key as heading
          const heading = key.split('_').map(w => 
            w.charAt(0).toUpperCase() + w.slice(1)
          ).join(' ');

          children.push(new Paragraph({
            text: heading,
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 }
          }));

          // Parse content
          children.push(...this.parseContent(value));
        }
      }
    }

    return children;
  }

  /**
   * Parse markdown-like content into docx paragraphs
   * @param {string} content - Content to parse
   * @returns {Array} Array of Paragraph objects
   */
  parseContent(content) {
    if (!content) return [];

    const paragraphs = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (!line) {
        // Empty line - add spacing
        continue;
      }

      // Bullet list
      if (line.startsWith('- ') || line.startsWith('* ')) {
        paragraphs.push(new Paragraph({
          text: line.substring(2),
          bullet: { level: 0 },
          spacing: { after: 100 }
        }));
      }
      // Numbered list
      else if (/^\d+\.\s/.test(line)) {
        paragraphs.push(new Paragraph({
          text: line.replace(/^\d+\.\s/, ''),
          numbering: { level: 0 },
          spacing: { after: 100 }
        }));
      }
      // Regular paragraph with inline formatting
      else {
        paragraphs.push(new Paragraph({
          children: this.parseInlineFormatting(line),
          spacing: { after: 120 }
        }));
      }
    }

    return paragraphs;
  }

  /**
   * Parse inline formatting (bold, italic, etc.)
   * @param {string} text - Text to parse
   * @returns {Array} Array of TextRun objects
   */
  parseInlineFormatting(text) {
    const runs = [];
    let remaining = text;

    // Patterns for inline formatting
    const patterns = [
      { regex: /\*\*\*(.+?)\*\*\*/g, format: { bold: true, italics: true } },
      { regex: /\*\*(.+?)\*\*/g, format: { bold: true } },
      { regex: /\*(.+?)\*/g, format: { italics: true } },
      { regex: /`(.+?)`/g, format: { font: { name: 'Courier New' } } },
      { regex: /__(.+?)__/g, format: { underline: {} } },
      { regex: /~~(.+?)~~/g, format: { strike: true } }
    ];

    while (remaining.length > 0) {
      let earliestMatch = null;
      let earliestPattern = null;

      for (const pattern of patterns) {
        pattern.regex.lastIndex = 0;
        const match = pattern.regex.exec(remaining);
        if (match && (!earliestMatch || match.index < earliestMatch.index)) {
          earliestMatch = match;
          earliestPattern = pattern;
        }
      }

      if (earliestMatch) {
        // Add text before match
        if (earliestMatch.index > 0) {
          runs.push(new TextRun(remaining.substring(0, earliestMatch.index)));
        }
        // Add formatted text
        runs.push(new TextRun({
          text: earliestMatch[1],
          ...earliestPattern.format
        }));
        remaining = remaining.substring(earliestMatch.index + earliestMatch[0].length);
      } else {
        // No more matches
        runs.push(new TextRun(remaining));
        break;
      }
    }

    return runs.length > 0 ? runs : [new TextRun(text)];
  }

  /**
   * Map heading level
   * @param {number} level - Heading level (1-6)
   * @returns {HeadingLevel} docx heading level
   */
  mapHeadingLevel(level) {
    const levels = {
      1: HeadingLevel.HEADING_1,
      2: HeadingLevel.HEADING_2,
      3: HeadingLevel.HEADING_3,
      4: HeadingLevel.HEADING_4,
      5: HeadingLevel.HEADING_5,
      6: HeadingLevel.HEADING_6
    };
    return levels[level] || HeadingLevel.HEADING_1;
  }

  /**
   * Create document header
   * @param {Object} template - Template data
   * @returns {Header}
   */
  createHeader(template) {
    return new Header({
      children: [
        new Paragraph({
          text: template.name || 'Document',
          alignment: AlignmentType.RIGHT
        })
      ]
    });
  }

  /**
   * Create document footer with page numbers
   * @returns {Footer}
   */
  createFooter() {
    return new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun('Page '),
            new TextRun({
              children: [PageNumber.CURRENT]
            }),
            new TextRun(' of '),
            new TextRun({
              children: [PageNumber.TOTAL_PAGES]
            })
          ]
        })
      ]
    });
  }

  /**
   * Generate document from plain text
   * @param {string} text - Plain text content
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated document
   */
  async generateFromText(text, options = {}) {
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: text,
                font: this.fonts.body
              })
            ]
          })
        ]
      }]
    });

    const buffer = await Packer.toBuffer(doc);

    return {
      buffer,
      filename: options.filename || 'document.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };
  }
}

module.exports = { DocxGenerator };
