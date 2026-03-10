# Document Creation Quick Reference Guide

## Getting Started

KimiBuilt now supports creating professional documents from templates or AI generation across all frontends.

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
5. Choose output format (DOCX, PDF, HTML, Markdown)
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
/create meeting-notes -o notes.docx

# AI document generation
/generate "Project proposal for mobile app"
/generate "Business letter to decline partnership" --type letter --format pdf

# Generate from data file
/generate-from data.json --template quarterly-report -o report.docx
```

### Options

| Option | Description | Example |
|--------|-------------|---------|
| `--format, -f` | Output format | `--format pdf` |
| `--output, -o` | Output file path | `-o ./docs/letter.docx` |
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
| Business Letter | `business-letter` | Formal correspondence | DOCX, PDF, HTML |
| Meeting Notes | `meeting-notes` | Meeting minutes & action items | DOCX, PDF, MD |
| Project Proposal | `project-proposal` | Complete project proposal | DOCX, PDF |
| Invoice | `invoice` | Professional invoice | DOCX, PDF |
| Executive Summary | `executive-summary` | Report summary | DOCX, PDF |

### Personal Documents

| Template | ID | Description | Formats |
|----------|-----|-------------|---------|
| Modern Resume | `resume-modern` | Professional CV/resume | DOCX, PDF, HTML |
| Cover Letter | `cover-letter` | Job application letter | DOCX, PDF |
| Recommendation | `recommendation-letter` | Letter of recommendation | DOCX, PDF |

### Creative Documents

| Template | ID | Description | Formats |
|----------|-----|-------------|---------|
| Blog Post | `blog-post` | Article structure | HTML, MD, DOCX |
| Newsletter | `newsletter` | Email/marketing content | HTML, DOCX |

### Technical Documents

| Template | ID | Description | Formats |
|----------|-----|-------------|---------|
| API Documentation | `api-documentation` | API reference | HTML, MD, DOCX |
| Technical Spec | `technical-spec` | Requirements specification | DOCX, PDF |

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
  "format": "docx",
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
- Try a different format (DOCX is most reliable)

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
| **DOCX** | Editing, collaboration | Most flexible, editable |
| **PDF** | Sharing, printing | Fixed layout, universal |
| **HTML** | Web publishing | Responsive, linkable |
| **Markdown** | Version control | Plain text, portable |
| **PPTX** | Presentations | Slides with visuals |

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
