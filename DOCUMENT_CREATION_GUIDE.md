# Document Creation Quick Reference Guide

## Getting Started

KimiBuilt now supports creating professional documents from templates or AI generation across all frontends.

Current generated formats are HTML, PDF, PPTX, XLSX, and Markdown. Native DOCX/Word generation is not currently exposed by the runtime; DOCX/Word requests are treated as HTML unless a separate conversion path is added and verified.

---

## Web-Chat

### Slash Commands

```
/create                          # Open document creator modal
/create business-letter          # Start creating a business letter
/create resume --format pdf      # Create resume as PDF
```

### Interactive Steps

1. Type `/create` in the chat
2. Browse templates by category (Business, Personal, Creative, Technical)
3. Select a template
4. Fill in the variable form
5. Choose output format (PDF, HTML, PPTX, XLSX, or Markdown)
6. Download your document

### AI Document Generation

1. Type `/create` then click "Use AI Instead ✨"
2. Describe the document you want:
   ```
   Create a project proposal for a mobile app that helps people 
   track their carbon footprint. Budget: $50,000. Timeline: 6 months.
   ```
3. Select options (tone, length, format)
4. Click "Generate with AI"

### Export Chat as Document

When exporting a conversation, you can now choose to include:
- Table of contents
- Professional formatting
- AI-generated summary

---

## CLI

### Commands

```bash
# List all templates
/templates

# List templates by category
/templates business
/templates personal

# Interactive document creation
/create

# Create specific template
/create business-letter
/create resume-modern --format pdf
/create meeting-notes --format pdf -o notes.pdf

# AI document generation
/generate "Project proposal for mobile app"
/generate "Business letter to decline partnership" --type letter --format pdf

# Generate from data file
/generate-from data.json --template quarterly-report --format xlsx -o report.xlsx
```

### Options

| Option | Description | Example |
|--------|-------------|---------|
| `--format, -f` | Output format | `--format pdf` |
| `--output, -o` | Output file path | `-o ./docs/letter.pdf` |
| `--type` | Document type for AI | `--type proposal` |

### Interactive Mode

The `/create` command without arguments launches interactive mode:

```
$ /create
? Select a category: Business Documents
? Select a template: Business Letter
? Output format: PDF Document
? Your Name: John Smith
? Recipient Name: Jane Doe
? Subject: Partnership Opportunity
? Letter Body: (opens editor)
Generating document... ✓
Saved to: documents/document-2024-03-09.pdf
```

---

## Available Templates

### Business Documents

| Template | ID | Description | Formats |
|----------|-----|-------------|---------|
| Business Letter | `business-letter` | Formal correspondence | PDF, HTML |
| Meeting Notes | `meeting-notes` | Meeting minutes & action items | PDF, HTML, MD |
| Project Proposal | `project-proposal` | Complete project proposal | PDF, HTML |
| Invoice | `invoice` | Professional invoice | PDF, HTML |
| Executive Summary | `executive-summary` | Report summary | PDF, HTML, MD |

### Personal Documents

| Template | ID | Description | Formats |
|----------|-----|-------------|---------|
| Modern Resume | `resume-modern` | Professional CV/resume | PDF, HTML |
| Cover Letter | `cover-letter` | Job application letter | PDF, HTML |
| Recommendation | `recommendation-letter` | Letter of recommendation | PDF, HTML |

### Creative Documents

| Template | ID | Description | Formats |
|----------|-----|-------------|---------|
| Blog Post | `blog-post` | Article structure | HTML, MD |
| Newsletter | `newsletter` | Email/marketing content | HTML |

### Technical Documents

| Template | ID | Description | Formats |
|----------|-----|-------------|---------|
| API Documentation | `api-documentation` | API reference | HTML, MD |
| Technical Spec | `technical-spec` | Requirements specification | PDF, HTML, MD |

---

## Template Variables

### Business Letter Variables

| Variable | Type | Description |
|----------|------|-------------|
| `sender_name` | text | Your full name |
| `sender_title` | text | Your job title |
| `sender_address` | textarea | Your address |
| `date` | date | Letter date |
| `recipient_name` | text | Recipient's name |
| `recipient_title` | text | Recipient's title |
| `company_name` | text | Company name |
| `subject` | text | Subject line |
| `salutation` | select | Greeting style |
| `body` | richtext | Letter content |
| `closing` | select | Closing phrase |
| `signature` | text | Signature name |

### Resume Variables

| Variable | Type | Description |
|----------|------|-------------|
| `full_name` | text | Your name |
| `email` | email | Contact email |
| `phone` | tel | Phone number |
| `location` | text | City, State |
| `linkedin` | url | LinkedIn URL |
| `summary` | textarea | Professional summary |
| `experience` | richtext | Work history |
| `education` | textarea | Education details |
| `skills` | textarea | Skills list |

---

## AI Document Generation

### Prompt Tips

**Be specific:**
```
"Create a project proposal for a mobile fitness tracking app targeting 
users aged 25-40. Include market analysis, technical requirements, 
timeline with milestones, and budget breakdown of $75,000."
```

**Include key details:**
- Document type (proposal, report, letter, etc.)
- Target audience
- Key topics to cover
- Desired length/complexity
- Tone (professional, casual, technical)

### Document Types for AI

- `proposal` - Project/business proposals
- `report` - Business/analytical reports
- `letter` - Formal correspondence
- `memo` - Internal communications
- `specification` - Technical specifications

### Tone Options

- `professional` - Business formal (default)
- `casual` - Conversational
- `technical` - Precise, jargon-appropriate
- `academic` - Scholarly, research-based
- `persuasive` - Compelling, marketing-oriented

---

## API Reference

### Generate from Template

```bash
POST /api/documents/generate
Content-Type: application/json

{
  "templateId": "business-letter",
  "variables": {
    "sender_name": "John Smith",
    "recipient_name": "Jane Doe",
    "subject": "Hello",
    "body": "I am writing to..."
  },
  "format": "pdf",
  "options": {
    "includePageNumbers": true
  }
}
```

### AI Generate

```bash
POST /api/documents/ai-generate
Content-Type: application/json

{
  "prompt": "Create a project proposal for...",
  "documentType": "proposal",
  "tone": "professional",
  "length": "medium",
  "format": "pdf"
}
```

### List Templates

```bash
GET /api/documents/templates
GET /api/documents/templates?category=business
GET /api/documents/templates/business-letter
```

---

## Troubleshooting

### Common Issues

**"Template not found"**
- Check the template ID with `/templates`
- Ensure you're using the exact ID shown

**"Failed to generate document"**
- Check API connectivity
- Ensure all required variables are provided
- Try a currently supported format: HTML, PDF, PPTX, XLSX, or Markdown

**AI generation is slow**
- AI generation can take 10-30 seconds for long documents
- Use shorter prompts for faster results
- Try reducing the requested length

### Getting Help

In Web-Chat:
```
/help documents
```

In CLI:
```
/help
/templates --help
```

---

## Tips & Best Practices

### For Business Letters
- Keep paragraphs concise (3-4 sentences)
- Use professional tone
- Include specific dates and references
- Proofread before sending

### For Resumes
- Tailor to the specific job
- Use action verbs
- Quantify achievements when possible
- Keep to 1-2 pages

### For Meeting Notes
- Assign owners to action items
- Include deadlines
- Distribute within 24 hours
- Follow up on previous action items

### For AI Generation
- The more specific your prompt, the better the result
- Include numbers, dates, and names when relevant
- Specify the target audience
- Request specific sections if needed

---

## Format Guidelines

| Format | Best For | Notes |
|--------|----------|-------|
| **HTML** | Web publishing, sandbox previews, editable visual source | Responsive and easiest to inspect with `kimibuilt-ui-check` |
| **PDF** | Sharing, printing, polished reports | Fixed layout; verify page breaks and rendered pages |
| **PPTX** | Presentations and decks | Slides with visuals; verify in a deck renderer/viewer |
| **XLSX** | Data workbooks and structured report appendices | Inspect sheets, formulas, and chart/image references |
| **Markdown** | Version control and lightweight text handoff | Plain text, portable |
| **DOCX** | Future or external conversion path only | Not a native generated output in the current runtime |

### Verification Checklist

- HTML: run `node bin/kimibuilt-ui-check.js <url-or-file-url> --out ui-checks/<name>` when a browser is available.
- PDF: render or open the PDF and inspect contrast, page breaks, tables, captions, headers/footers, and images.
- PPTX/XLSX: open or render with available office tooling and confirm content is not clipped or missing.
- Sandbox previews: keep source files, preview URL, artifact/download URL, and QA notes together for follow-up agents.

---

## Future Features

Coming soon:
- 📝 Custom template builder
- 📝 Template marketplace (share templates)
- 📝 Document collaboration
- 📝 E-signatures
- 📝 More AI enhancements
- 📝 Diagram-to-document (Canvas)
- 📝 Page merging (Notes-Notion)

---

*Last Updated: March 2024*
*Version: 1.0*
