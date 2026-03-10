# KimiBuilt Document Creation System

## Executive Summary

This document outlines the design and implementation plan for adding comprehensive **document CREATION capabilities** to all KimiBuilt frontends. Unlike the existing import/export functionality, this system enables users to create professional documents from scratch using templates, AI generation, and document assembly.

## Current State Analysis

### Existing Document Capabilities

| Frontend | Import | Export | Create |
|----------|--------|--------|--------|
| Web-Chat | DOCX, PDF, HTML, MD, TXT, JSON | Markdown, JSON, TXT, HTML, DOCX, PDF | ❌ |
| Web-CLI | JSON sessions | JSON sessions | ❌ |
| Notes-Notion | DOCX, PDF, MD, TXT | DOCX, PDF, HTML, MD, JSON, TXT | ❌ |
| Canvas | Various formats | Code, Document, Diagram formats | ❌ |

### Gap Analysis
- **No template-based creation**: Users cannot start from professional templates
- **No AI document generation**: Cannot generate complete documents from prompts
- **No document assembly**: Cannot combine multiple sources into one document
- **Limited business document support**: No specialized templates for common business needs

---

## Document Creation Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DOCUMENT CREATION MODULE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ Template Engine │  │ AI Generator    │  │ Doc Assembler   │             │
│  │                 │  │                 │  │                 │             │
│  │ • Business      │  │ • Prompt→Doc    │  │ • Merge sources │             │
│  │ • Personal      │  │ • Expand outline│  │ • Data binding  │             │
│  │ • Creative      │  │ • JSON→Document │  │ • Components    │             │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘             │
│           │                    │                    │                       │
│           └────────────────────┼────────────────────┘                       │
│                                ▼                                             │
│                  ┌─────────────────────────┐                                │
│                  │ Document Format Engine  │                                │
│                  │                         │                                │
│                  │ • DOCX (docx.js)        │                                │
│                  │ • PDF (pdfmake)         │                                │
│                  │ • PPTX (pptxgenjs)      │                                │
│                  │ • HTML (native)         │                                │
│                  │ • MD (native)           │                                │
│                  └────────────┬────────────┘                                │
│                               │                                              │
│           ┌───────────────────┼───────────────────┐                         │
│           ▼                   ▼                   ▼                         │
│    ┌────────────┐     ┌────────────┐     ┌────────────┐                    │
│    │  Web-Chat  │     │   Notes    │     │   Canvas   │                    │
│    │  /create   │     │  Templates │     │  Visual    │                    │
│    └────────────┘     └────────────┘     └────────────┘                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Template-Based Creation

### 1.1 Template Categories

#### Business Templates

| Template | Description | Variables | Output Formats |
|----------|-------------|-----------|----------------|
| **Business Letter** | Formal correspondence | recipient, sender, date, subject, body, signature | DOCX, PDF, HTML |
| **Meeting Notes** | Structured meeting documentation | title, date, attendees, agenda, decisions, action items | DOCX, PDF, MD |
| **Project Proposal** | Complete project proposal | title, client, scope, timeline, budget, team | DOCX, PDF, PPTX |
| **Invoice** | Professional invoice | company, client, items, totals, tax, payment terms | DOCX, PDF, HTML |
| **Report** | Executive summary report | title, author, sections, charts, conclusions | DOCX, PDF, PPTX |
| **Memo** | Internal memorandum | to, from, date, subject, message | DOCX, PDF |
| **Press Release** | Media announcement | headline, dateline, body, boilerplate, contact | DOCX, PDF |
| **Job Description** | Role specification | title, department, responsibilities, requirements | DOCX, PDF, HTML |
| **Contract** | Basic agreement template | parties, terms, clauses, signatures | DOCX, PDF |
| **NDA** | Non-disclosure agreement | parties, duration, scope, jurisdiction | DOCX, PDF |

#### Personal Templates

| Template | Description | Variables | Output Formats |
|----------|-------------|-----------|----------------|
| **Resume/CV** | Professional resume | name, contact, experience, education, skills | DOCX, PDF, HTML |
| **Cover Letter** | Job application letter | position, company, qualifications, closing | DOCX, PDF |
| **Recommendation** | Letter of recommendation | candidate, relationship, strengths, endorsement | DOCX, PDF |
| **Thank You** | Gratitude letter | recipient, occasion, message | DOCX, PDF, HTML |

#### Creative Templates

| Template | Description | Variables | Output Formats |
|----------|-------------|-----------|----------------|
| **Blog Post** | Article structure | title, author, tags, content, meta | HTML, MD, DOCX |
| **Newsletter** | Email/marketing content | header, sections, articles, footer | HTML, DOCX |
| **Story Outline** | Creative writing framework | title, characters, acts, scenes | DOCX, MD |
| **Script** | Screenplay/play format | title, scenes, dialogue, stage directions | DOCX, PDF |

#### Technical Templates

| Template | Description | Variables | Output Formats |
|----------|-------------|-----------|----------------|
| **API Documentation** | Endpoint documentation | api_name, version, endpoints, examples | HTML, MD, DOCX |
| **User Manual** | Product instructions | product, version, sections, screenshots | DOCX, PDF, HTML |
| **Research Paper** | Academic format | title, authors, abstract, sections, references | DOCX, PDF |
| **Specification** | Technical requirements | project, requirements, constraints, acceptance | DOCX, PDF |

### 1.2 Template Structure

```javascript
// Template Definition Schema
{
  id: 'business-letter',
  name: 'Business Letter',
  category: 'business',
  description: 'Professional formal correspondence',
  icon: '📄',
  
  // Input fields for template variables
  variables: [
    {
      id: 'recipient_name',
      label: 'Recipient Name',
      type: 'text',
      required: true,
      placeholder: 'John Smith'
    },
    {
      id: 'recipient_title',
      label: 'Recipient Title',
      type: 'text',
      required: false,
      placeholder: 'CEO'
    },
    {
      id: 'company_name',
      label: 'Company Name',
      type: 'text',
      required: true
    },
    {
      id: 'subject',
      label: 'Subject',
      type: 'text',
      required: true
    },
    {
      id: 'body',
      label: 'Letter Body',
      type: 'textarea',
      required: true,
      rows: 10
    },
    {
      id: 'tone',
      label: 'Tone',
      type: 'select',
      options: ['Formal', 'Professional', 'Friendly'],
      default: 'Professional'
    }
  ],
  
  // Supported output formats
  formats: ['docx', 'pdf', 'html'],
  
  // Template engine (handlebars-like syntax)
  template: {
    docx: 'business-letter.docx.template',
    pdf: 'business-letter.pdf.template',
    html: 'business-letter.html.template'
  },
  
  // AI enhancement options
  aiEnhancement: {
    enabled: true,
    features: ['improve-writing', 'professional-tone', 'grammar-check']
  }
}
```

---

## 2. AI-Powered Document Generation

### 2.1 Generation Modes

#### Mode 1: Prompt-to-Document
Transform natural language prompts into complete documents.

```
User: "Create a project proposal for a mobile app that helps people track their carbon footprint. 
       Target audience: environmentally conscious millennials. 
       Budget: $50,000. Timeline: 6 months."

AI generates:
- Executive Summary
- Problem Statement
- Solution Overview
- Technical Approach
- Timeline with milestones
- Budget breakdown
- Team structure
- Risk assessment
- Success metrics
```

#### Mode 2: Outline Expansion
Expand structured outlines into full documents.

```
Input Outline:
- Introduction
- Market Analysis
  - Current trends
  - Competitor analysis
- Product Features
  - Core functionality
  - Premium features
- Go-to-Market Strategy

AI expands each section into detailed paragraphs with:
- Data-driven insights
- Professional formatting
- Consistent tone
- Proper citations (if requested)
```

#### Mode 3: Data-to-Document
Convert structured data (JSON, CSV) into formatted documents.

```json
{
  "document_type": "quarterly_report",
  "company": "Acme Corp",
  "quarter": "Q3 2024",
  "metrics": {
    "revenue": "$2.4M",
    "growth": "15%",
    "customers": 1240
  },
  "highlights": [
    "Launched new product line",
    "Expanded to 3 new markets",
    "Achieved 95% customer satisfaction"
  ]
}
```

Converts to: Professional quarterly report with charts, tables, and narrative.

### 2.2 AI Document Generation API

```javascript
// Backend API Endpoint: POST /api/documents/generate
{
  "mode": "prompt-to-document" | "outline-expansion" | "data-to-document",
  "prompt": "string",           // For prompt-to-document mode
  "outline": [],                // For outline-expansion mode
  "data": {},                   // For data-to-document mode
  "documentType": "proposal",   // Optional: guide the generation
  "tone": "professional",       // professional, casual, technical, academic
  "length": "medium",           // short, medium, long, detailed
  "format": "docx",             // Output format
  "template": "business",       // Optional: template category hint
  "options": {
    "includeTableOfContents": true,
    "includeHeaders": true,
    "includePageNumbers": true,
    "language": "en"
  }
}

// Response
{
  "documentId": "doc_123456",
  "content": "base64-encoded-document",
  "format": "docx",
  "filename": "generated-document.docx",
  "metadata": {
    "pages": 5,
    "wordCount": 1200,
    "generationTime": 3.2,
    "model": "gpt-4o"
  },
  "sections": [  // Generated sections for review
    { "title": "Executive Summary", "preview": "..." },
    { "title": "Introduction", "preview": "..." }
  ]
}
```

---

## 3. Document Assembly

### 3.1 Assembly Operations

#### Merge Sources
Combine multiple content sources into a single document.

```javascript
{
  "operation": "merge",
  "sources": [
    { "type": "template", "id": "cover-page", "data": {...} },
    { "type": "chat-session", "sessionId": "sess_123", "filter": "assistant-only" },
    { "type": "canvas", "canvasId": "canvas_456", "section": "diagram" },
    { "type": "document", "documentId": "doc_789", "pages": "1-5" },
    { "type": "text", "content": "Custom appendix text..." }
  ],
  "options": {
    "pageBreaks": true,
    "tableOfContents": true,
    "headersFooters": true,
    "consistentFormatting": true
  }
}
```

#### Template + Data Binding
Merge template with structured data.

```javascript
{
  "operation": "bind",
  "template": "invoice-template",
  "data": {
    "invoice_number": "INV-2024-001",
    "date": "2024-03-09",
    "company": { "name": "Acme Corp", "address": "..." },
    "client": { "name": "Client Inc", "address": "..." },
    "items": [
      { "description": "Consulting", "qty": 10, "rate": 150, "total": 1500 }
    ],
    "subtotal": 1500,
    "tax": 120,
    "total": 1620
  }
}
```

#### Component Assembly
Build documents from reusable components.

```javascript
{
  "operation": "assemble",
  "layout": "report-layout",
  "components": [
    { "type": "header", "variant": "corporate", "data": {...} },
    { "type": "toc", "depth": 3 },
    { "type": "section", "title": "Executive Summary", "content": "..." },
    { "type": "chart", "data": {...}, "type": "bar" },
    { "type": "section", "title": "Analysis", "content": "..." },
    { "type": "table", "data": {...}, "style": "professional" },
    { "type": "footer", "variant": "standard" }
  ]
}
```

---

## 4. Frontend Integration Plans

### 4.1 Web-Chat Integration

#### New `/create` Command

```
/create <document-type> [--template <id>] [--format <fmt>]

Examples:
/create business-letter --format docx
/create resume --template modern
/create proposal --ai "Mobile app for carbon tracking"
```

#### Interactive Document Creation Flow

```
1. User types: /create business-letter

2. System responds with template selection UI:
   📄 Choose a business letter template:
   ┌─────────────────────────────────────────┐
   │ 1. Formal Business Letter               │
   │ 2. Cover Letter (Job Application)       │
   │ 3. Thank You Letter                     │
   │ 4. Complaint Letter                     │
   └─────────────────────────────────────────┘

3. User selects → System shows variable input form

4. User fills variables → Preview generated

5. User confirms → Document downloaded
```

#### Export Chat as Formatted Document

Enhance existing export with:
- AI-generated summary
- Professional formatting
- Table of contents
- Appendix with metadata

### 4.2 Web-CLI Integration

#### New Commands

```bash
# Template-based creation
/create <template-id> [--output <file>] [--format <fmt>]
/create business-letter -o letter.docx
/create resume --format pdf

# AI document generation
/generate "<prompt>" [--type <doc-type>] [--output <file>]
/generate "Project proposal for carbon tracking app" --type proposal -o proposal.docx

# Data-driven generation
/generate-from <data-file> [--template <id>] [--output <file>]
/generate-from data.json --template quarterly-report -o report.docx

# List available templates
/templates [category]
/templates business
/templates --all

# Template preview
/template-preview <id>
```

#### Interactive Mode

```bash
$ /create
? Select document type: (Use arrow keys)
❯ Business Documents
  Personal Documents  
  Creative Documents
  Technical Documents

? Select template: (Use arrow keys)
❯ Business Letter
  Meeting Notes
  Project Proposal
  Invoice
  Report

? Output format: (Use arrow keys)
❯ DOCX
  PDF
  HTML

? Recipient Name: John Smith
? Recipient Title: CEO
? Company: Acme Corporation
? Subject: Partnership Opportunity
? Body (press Ctrl+D when done):
  Dear Mr. Smith,
  
  I am writing to discuss...
  
Generating document... ✓
Saved to: business-letter-2024-03-09.docx
```

### 4.3 Notes-Notion Integration

#### Template Gallery

New sidebar section with visual template browser:

```
┌─────────────────────────────────────────────────────────┐
│ 📋 Template Gallery                    [Search...]     │
├─────────────────────────────────────────────────────────┤
│ Business Documents                                       │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐        │
│ │ 📄          │ │ 📊          │ │ 📋          │        │
│ │ Business    │ │ Project     │ │ Meeting     │        │
│ │ Letter      │ │ Proposal    │ │ Notes       │        │
│ └─────────────┘ └─────────────┘ └─────────────┘        │
│                                                          │
│ Personal Documents                                       │
│ ┌─────────────┐ ┌─────────────┐                        │
│ │ 👤          │ │ 📝          │                        │
│ │ Resume      │ │ Cover       │                        │
│ │             │ │ Letter      │                        │
│ └─────────────┘ └─────────────┘                        │
│                                                          │
│ [+ Create Custom Template]                              │
└─────────────────────────────────────────────────────────┘
```

#### AI Document Generator Block

New block type: `/ai-document`

```
1. User types /ai-document in a block

2. Block transforms to:
   ┌─────────────────────────────────────────────────────┐
   │ ✨ AI Document Generator                             │
   │                                                      │
   │ What would you like to create?                       │
   │ [Generate a project proposal for...         ] [▶]   │
   │                                                      │
   │ Or choose a template:                                │
   │ [Business Letter] [Report] [Resume] [More...]       │
   └─────────────────────────────────────────────────────┘

3. AI generates content directly into the page as blocks

4. User can edit, rearrange, and export
```

#### Page Merge Feature

New command: `/merge-pages`

```
Select pages to merge into a single document:
☑ Project Overview
☑ Technical Specifications  
☑ Budget Analysis
☐ Meeting Notes (unchecked)
☑ Timeline

[ ] Add table of contents
[✓] Include page numbers
[✓] Consistent formatting

[Merge into DOCX] [Merge into PDF] [Merge into single page]
```

### 4.4 Canvas Integration

#### Visual Document Templates

Canvas-based visual document creation:

```
┌──────────────────────────────────────────────────────────────┐
│  Canvas: Visual Document Editor                    [Export ▼]│
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  [Drag elements to build your document]              │    │
│  │                                                      │    │
│  │  ┌──────────────────────────────────────────────┐   │    │
│  │  │  ACME CORPORATION                              │   │    │
│  │  │                                                │   │    │
│  │  │  QUARTERLY BUSINESS REPORT                     │   │    │
│  │  │  Q1 2024                                       │   │    │
│  │  └──────────────────────────────────────────────┘   │    │
│  │                                                      │    │
│  │  ┌──────────────────┐  ┌──────────────────────┐    │    │
│  │  │ [Text Block]     │  │ [Chart Component]    │    │    │
│  │  │ Executive        │  │  Revenue: $2.4M      │    │    │
│  │  │ Summary...       │  │  ▲ 15%              │    │    │
│  │  └──────────────────┘  └──────────────────────┘    │    │
│  │                                                      │    │
│  │  ┌──────────────────────────────────────────────┐   │    │
│  │  │ [Table Component]                            │   │    │
│  │  │ Department    | Q1     | Q2     | Q3         │   │    │
│  │  │ Sales         | $800K  | $950K  | $1.1M      │   │    │
│  │  └──────────────────────────────────────────────┘   │    │
│  │                                                      │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
│  [Text] [Heading] [Image] [Chart] [Table] [Shape] [AI ✨]    │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

#### Diagram-to-Document Conversion

Convert canvas diagrams into formal documentation:

```
1. User creates architecture diagram on canvas

2. Right-click → "Generate Documentation"

3. System generates:
   - System Architecture Document
   - Component descriptions
   - Data flow explanations
   - Integration points

4. Export as DOCX, PDF, or Confluence markup
```

#### Presentation Mode

Create presentations from canvas content:

```
[New Presentation from Canvas]

Slide 1: Title + Overview diagram
Slide 2: Architecture diagram
Slide 3: Data flow + explanation
Slide 4: Components breakdown
...

Export as: PPTX, PDF, Google Slides
```

---

## 5. Implementation Libraries

### 5.1 JavaScript/Node.js Libraries

| Library | Purpose | Size | License |
|---------|---------|------|---------|
| **docx** (docx.js) | DOCX generation | ~500KB | MIT |
| **pdfmake** | PDF generation | ~2MB | MIT |
| **pptxgenjs** | PowerPoint generation | ~800KB | MIT |
| **mammoth** | DOCX parsing | ~200KB | BSD-2 |
| **html-to-docx** | HTML → DOCX | ~100KB | MIT |
| **puppeteer** | HTML → PDF | ~50MB | Apache-2.0 |

### 5.2 Library Selection Rationale

#### DOCX Generation: `docx` (npm package)
- **Pros**: Pure JavaScript, no dependencies, excellent API
- **Cons**: Limited styling options compared to native Word
- **Use for**: All DOCX creation needs

```javascript
const docx = require('docx');
const { Document, Paragraph, TextRun, HeadingLevel } = docx;

const doc = new Document({
  sections: [{
    properties: {},
    children: [
      new Paragraph({
        text: "Business Letter",
        heading: HeadingLevel.TITLE
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Date: ", bold: true }),
          new TextRun(new Date().toLocaleDateString())
        ]
      })
    ]
  }]
});
```

#### PDF Generation: `pdfmake`
- **Pros**: Client-side generation, declarative syntax, tables/charts
- **Cons**: Limited complex layout support
- **Use for**: Reports, invoices, structured documents

```javascript
const pdfMake = require('pdfmake/build/pdfmake');
const pdfFonts = require('pdfmake/build/vfs_fonts');
pdfMake.vfs = pdfFonts.pdfMake.vfs;

const docDefinition = {
  content: [
    { text: 'Business Report', style: 'header' },
    { text: 'Generated by KimiBuilt', style: 'subheader' },
    {
      table: {
        body: [
          ['Department', 'Q1', 'Q2'],
          ['Sales', '$800K', '$950K']
        ]
      }
    }
  ],
  styles: {
    header: { fontSize: 18, bold: true },
    subheader: { fontSize: 14 }
  }
};

pdfMake.createPdf(docDefinition).download('report.pdf');
```

#### PowerPoint Generation: `pptxgenjs`
- **Pros**: Feature-rich, master slides, charts, images
- **Cons**: Larger bundle size
- **Use for**: Presentations, pitch decks

```javascript
const PptxGenJS = require('pptxgenjs');
const pres = new PptxGenJS();

pres.title = 'Quarterly Report';
pres.author = 'KimiBuilt';

const slide = pres.addSlide();
slide.addText('Q1 2024 Results', { x: 1, y: 1, fontSize: 44, bold: true });
slide.addChart(pres.charts.BAR, {
  data: [{ name: 'Revenue', values: [2.4, 2.8, 3.1] }]
});

pres.writeFile({ fileName: 'presentation.pptx' });
```

---

## 6. Backend Implementation

### 6.1 New API Routes

```javascript
// src/routes/documents.js

// Template management
GET    /api/documents/templates              // List all templates
GET    /api/documents/templates/:category    // Templates by category
GET    /api/documents/templates/:id          // Get template details

// Document generation
POST   /api/documents/generate               // Generate from template
POST   /api/documents/ai-generate            // AI-powered generation
POST   /api/documents/assemble               // Assemble from sources

// Document operations
POST   /api/documents/convert                // Convert between formats
POST   /api/documents/merge                  // Merge multiple documents
POST   /api/documents/bind                   // Bind data to template

// Document storage
GET    /api/documents/:id                    // Get document metadata
GET    /api/documents/:id/download           // Download document
DELETE /api/documents/:id                    // Delete document
```

### 6.2 Document Service Architecture

```javascript
// src/documents/document-service.js

class DocumentService {
  constructor() {
    this.generators = {
      docx: new DocxGenerator(),
      pdf: new PdfGenerator(),
      pptx: new PptxGenerator(),
      html: new HtmlGenerator(),
      md: new MarkdownGenerator()
    };
    
    this.templateEngine = new TemplateEngine();
    this.aiDocumentGenerator = new AIDocumentGenerator();
    this.assembler = new DocumentAssembler();
  }
  
  // Generate document from template
  async generateFromTemplate(templateId, variables, format, options) {
    const template = await this.templateEngine.getTemplate(templateId);
    const populated = await this.templateEngine.populate(template, variables);
    
    const generator = this.generators[format];
    const document = await generator.generate(populated, options);
    
    return {
      id: generateId(),
      content: document.toBuffer(),
      filename: `${template.name}.${format}`,
      mimeType: generator.mimeType
    };
  }
  
  // AI-powered document generation
  async aiGenerate(prompt, options) {
    // Use OpenAI to generate structured content
    const content = await this.aiDocumentGenerator.generate(prompt, options);
    
    // Generate document in requested format
    const generator = this.generators[options.format];
    const document = await generator.generateFromContent(content, options);
    
    return document;
  }
  
  // Assemble document from multiple sources
  async assemble(sources, options) {
    return this.assembler.assemble(sources, options);
  }
}
```

### 6.3 Template Engine

```javascript
// src/documents/template-engine.js

class TemplateEngine {
  constructor() {
    this.templates = new Map();
    this.loadTemplates();
  }
  
  async loadTemplates() {
    // Load from filesystem or database
    const templateFiles = await glob('templates/**/*.json');
    for (const file of templateFiles) {
      const template = await fs.readJson(file);
      this.templates.set(template.id, template);
    }
  }
  
  async populate(template, variables) {
    // Simple variable substitution
    let populated = JSON.parse(JSON.stringify(template));
    
    // Replace {{variable}} placeholders
    const replaceVariables = (obj) => {
      if (typeof obj === 'string') {
        return obj.replace(/\{\{(\w+)\}\}/g, (match, key) => {
          return variables[key] !== undefined ? variables[key] : match;
        });
      }
      if (Array.isArray(obj)) {
        return obj.map(replaceVariables);
      }
      if (typeof obj === 'object' && obj !== null) {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = replaceVariables(value);
        }
        return result;
      }
      return obj;
    };
    
    return replaceVariables(populated);
  }
  
  getTemplatesByCategory(category) {
    return Array.from(this.templates.values())
      .filter(t => t.category === category);
  }
}
```

### 6.4 AI Document Generator

```javascript
// src/documents/ai-document-generator.js

class AIDocumentGenerator {
  constructor(openaiClient) {
    this.openai = openaiClient;
  }
  
  async generate(prompt, options) {
    const systemPrompt = this.buildSystemPrompt(options);
    
    const response = await this.openai.responses.create({
      model: options.model || 'gpt-4o',
      system: systemPrompt,
      messages: [
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' }
    });
    
    return JSON.parse(response.choices[0].message.content);
  }
  
  buildSystemPrompt(options) {
    const documentType = options.documentType || 'document';
    const tone = options.tone || 'professional';
    const length = options.length || 'medium';
    
    return `You are an expert document writer. Generate a ${documentType} 
with a ${tone} tone. The length should be ${length}.

Output the document as a JSON object with this structure:
{
  "title": "Document Title",
  "sections": [
    {
      "heading": "Section Title",
      "content": "Section content...",
      "level": 1
    }
  ],
  "metadata": {
    "wordCount": 1234,
    "estimatedPages": 4
  }
}`;
  }
  
  async expandOutline(outline, options) {
    // Expand each outline item into detailed content
    const expanded = [];
    
    for (const item of outline) {
      const content = await this.generateSection(item, options);
      expanded.push({
        ...item,
        content,
        subsections: item.children ? 
          await this.expandOutline(item.children, options) : []
      });
    }
    
    return expanded;
  }
}
```

---

## 7. Implementation Phases

### Phase 1: Core Infrastructure (Week 1-2)

1. **Backend Setup**
   - [ ] Install document generation libraries (docx, pdfmake, pptxgenjs)
   - [ ] Create document service with generator interfaces
   - [ ] Implement template engine with variable substitution
   - [ ] Create base template definitions (5 core templates)

2. **API Development**
   - [ ] `GET /api/documents/templates` - List templates
   - [ ] `POST /api/documents/generate` - Generate from template
   - [ ] `POST /api/documents/ai-generate` - AI generation endpoint

### Phase 2: Web-Chat Integration (Week 3)

1. **Frontend Components**
   - [ ] `/create` command handler
   - [ ] Template selection modal
   - [ ] Variable input form component
   - [ ] Document preview component

2. **Features**
   - [ ] Generate business letter from template
   - [ ] Export chat as formatted document with TOC
   - [ ] AI document generation from conversation

### Phase 3: Notes-Notion Integration (Week 4)

1. **Template Gallery**
   - [ ] Sidebar template browser component
   - [ ] Template preview cards
   - [ ] Category filtering

2. **AI Document Block**
   - [ ] `/ai-document` slash command
   - [ ] Inline document generation UI
   - [ ] Generated content as blocks

3. **Merge Feature**
   - [ ] Page selection modal
   - [ ] Document assembly logic
   - [ ] Export merged documents

### Phase 4: CLI Enhancement (Week 5)

1. **New Commands**
   - [ ] `/create` with interactive prompts
   - [ ] `/templates` listing
   - [ ] `/generate` for AI documents
   - [ ] `/generate-from` for data-driven docs

2. **Interactive Mode**
   - [ ] Inquirer.js integration
   - [ ] Step-by-step template filling
   - [ ] Progress indicators

### Phase 5: Canvas Enhancement (Week 6)

1. **Visual Document Editor**
   - [ ] Document-specific canvas mode
   - [ ] Text, table, chart components
   - [ ] Layout templates

2. **Diagram-to-Document**
   - [ ] Export diagrams as documentation
   - [ ] Auto-generate descriptions
   - [ ] Technical specification export

### Phase 6: AI Enhancement & Polish (Week 7-8)

1. **Advanced AI Features**
   - [ ] Smart template recommendations
   - [ ] Content improvement suggestions
   - [ ] Multi-language document generation

2. **Template Library Expansion**
   - [ ] 20+ professional templates
   - [ ] Industry-specific templates
   - [ ] Custom template creation

3. **Testing & Documentation**
   - [ ] Unit tests for generators
   - [ ] Integration tests for API
   - [ ] User documentation

---

## 8. Template Library

### Initial Template Set (15 Templates)

#### Business (8)
1. Formal Business Letter
2. Meeting Notes / Minutes
3. Project Proposal
4. Invoice
5. Executive Summary Report
6. Internal Memo
7. Job Description
8. Contract Agreement

#### Personal (3)
9. Professional Resume (Modern)
10. Cover Letter
11. Letter of Recommendation

#### Creative (2)
12. Blog Post
13. Newsletter

#### Technical (2)
14. API Documentation
15. Technical Specification

---

## 9. File Structure

```
KimiBuilt/
├── src/
│   ├── documents/
│   │   ├── document-service.js
│   │   ├── template-engine.js
│   │   ├── ai-document-generator.js
│   │   ├── document-assembler.js
│   │   ├── generators/
│   │   │   ├── base-generator.js
│   │   │   ├── docx-generator.js
│   │   │   ├── pdf-generator.js
│   │   │   ├── pptx-generator.js
│   │   │   ├── html-generator.js
│   │   │   └── markdown-generator.js
│   │   └── templates/
│   │       ├── business/
│   │       │   ├── business-letter.json
│   │       │   ├── meeting-notes.json
│   │       │   ├── project-proposal.json
│   │       │   └── ...
│   │       ├── personal/
│   │       ├── creative/
│   │       └── technical/
│   └── routes/
│       └── documents.js          # New document routes
├── frontend/
│   ├── web-chat/
│   │   └── js/
│   │       └── document-creator.js   # /create command
│   ├── notes-notion/
│   │   └── js/
│   │       ├── template-gallery.js   # Template browser
│   │       ├── ai-document-block.js  # AI block type
│   │       └── document-merger.js    # Page merge
│   └── canvas/
│       └── js/
│           ├── visual-doc-editor.js  # Document canvas mode
│           └── diagram-to-doc.js     # Export documentation
└── templates/                    # Template definitions
    ├── business-letter.docx.template
    ├── resume-modern.docx.template
    └── ...
```

---

## 10. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Document generation time | < 3 seconds | Backend API response time |
| Template variety | 20+ templates | Count at launch |
| User adoption | 30% of sessions | Analytics tracking |
| Format coverage | DOCX, PDF, PPTX, HTML | Supported exports |
| AI generation quality | 4+ rating | User feedback survey |
| Error rate | < 2% | Error tracking |

---

## 11. Security Considerations

1. **Input Sanitization**: All user inputs sanitized before processing
2. **File Size Limits**: Maximum generated document size (50MB)
3. **Rate Limiting**: Prevent abuse of AI generation endpoints
4. **Content Filtering**: Ensure generated content is appropriate
5. **Data Privacy**: Templates don't store user data
6. **XSS Prevention**: Safe HTML generation for web previews

---

## 12. Future Enhancements

### Near-term (Post-launch)
- [ ] Collaborative document editing
- [ ] Real-time document preview
- [ ] Custom template builder UI
- [ ] Template marketplace
- [ ] E-signature integration

### Long-term
- [ ] OCR for document digitization
- [ ] Advanced document analytics
- [ ] Multi-language templates
- [ ] Industry-specific template packs
- [ ] Integration with cloud storage (Google Drive, Dropbox)

---

## Appendix A: API Examples

### Generate from Template

```bash
curl -X POST http://localhost:3000/api/documents/generate \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "business-letter",
    "variables": {
      "recipient_name": "John Smith",
      "recipient_title": "CEO",
      "company_name": "Acme Corp",
      "subject": "Partnership Opportunity",
      "body": "I am writing to propose a strategic partnership..."
    },
    "format": "docx"
  }'
```

### AI Document Generation

```bash
curl -X POST http://localhost:3000/api/documents/ai-generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Create a project proposal for a mobile app that tracks carbon footprint",
    "documentType": "proposal",
    "tone": "professional",
    "length": "medium",
    "format": "docx"
  }'
```

### Merge Documents

```bash
curl -X POST http://localhost:3000/api/documents/assemble \
  -H "Content-Type: application/json" \
  -d '{
    "sources": [
      { "type": "template", "id": "cover-page", "data": {...} },
      { "type": "session", "sessionId": "sess_123", "filter": "assistant" },
      { "type": "canvas", "canvasId": "canvas_456" }
    ],
    "options": {
      "tableOfContents": true,
      "pageNumbers": true
    },
    "format": "pdf"
  }'
```

---

*Document Version: 1.0*
*Last Updated: 2024-03-09*
*Status: Design Complete - Ready for Implementation*
