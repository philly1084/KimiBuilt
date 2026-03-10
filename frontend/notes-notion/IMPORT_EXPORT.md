# Import/Export Functionality Documentation

## Overview

The notes-notion editor now includes comprehensive import/export functionality supporting multiple business file formats. This feature allows users to import content from various sources and export their notes in formats suitable for sharing and archiving.

## Supported Formats

### Export Formats

| Format | Extension | Library | Features |
|--------|-----------|---------|----------|
| **Word Document** | .docx | docx.js | Full formatting, headings, lists, tables, images |
| **PDF Document** | .pdf | Browser print | Page breaks, print-friendly layout |
| **HTML Document** | .html | Native | Styling, images, bookmarks, tables |
| **Markdown** | .md | Native | Frontmatter, all block types |
| **Notion JSON** | .json | Native | Notion-compatible structure |
| **Plain Text** | .txt | Native | Simple text output |

### Import Formats

| Format | Extension | Library | Parsing Capabilities |
|--------|-----------|---------|---------------------|
| **Word Document** | .docx | mammoth.js | Headings, paragraphs, lists, tables, images |
| **PDF Document** | .pdf | pdf-lib.js / fallback | Text extraction, structure detection |
| **HTML Document** | .html | Native DOM | All HTML elements to blocks |
| **Markdown** | .md | Native parser | Frontmatter, all markdown features |
| **Notion JSON** | .json | Native | Full Notion format support |
| **Plain Text** | .txt | Native | Paragraph detection, list recognition |

## User Interface

### Export Button
- Location: Top-right of page header (next to connection status)
- Dropdown menu with all export format options
- One-click export with automatic filename generation

### Import Button
- Location: Sidebar actions (next to "New page")
- Modal dialog with drag-and-drop support
- File browser for selecting files
- Visual feedback during import process

### Settings Modal
- Enhanced with categorized sections
- Export section: All export formats
- Import section: File import and Markdown paste
- Data management: Backup and storage info

## Block Type Mapping

### Import Mapping

| Source Format | Block Type | Target Block |
|--------------|------------|--------------|
| `<h1>` / `#` | Heading 1 | `heading_1` |
| `<h2>` / `##` | Heading 2 | `heading_2` |
| `<h3>`+ / `###` | Heading 3 | `heading_3` |
| `<p>` / text | Paragraph | `text` |
| `<ul>` / `-` | Bulleted list | `bulleted_list` |
| `<ol>` / `1.` | Numbered list | `numbered_list` |
| `- [ ]` / `- [x]` | To-do | `todo` |
| `<blockquote>` / `>` | Quote | `quote` |
| `<pre>` / ` ``` ` | Code block | `code` |
| `<hr>` / `---` | Divider | `divider` |
| `<table>` | Table | `database` |
| `<img>` | Image | `image` |
| `<a>` (rich) | Bookmark | `bookmark` |

### Export Mapping

| Block Type | DOCX | PDF | HTML | Markdown | JSON | TXT |
|-----------|------|-----|------|----------|------|-----|
| `heading_1` | Heading 1 | H1 | H2 | `#` | heading_1 | UPPERCASE |
| `heading_2` | Heading 2 | H2 | H3 | `##` | heading_2 | Underlined |
| `heading_3` | Heading 3 | H3 | H4 | `###` | heading_3 | `###` |
| `text` | Paragraph | p | p | text | paragraph | text |
| `bulleted_list` | Bullet | • | ul/li | `-` | bulleted_list | • |
| `numbered_list` | Number | 1. | ol/li | `1.` | numbered_list | 1. |
| `todo` | Checkbox | ☐/☑ | checkbox | `- [ ]` | to_do | [ ]/[x] |
| `quote` | Border-left | blockquote | blockquote | `>` | quote | > |
| `code` | Code block | pre/code | pre/code | ` ``` ` | code | --- |
| `divider` | Line | hr | hr | `---` | divider | ─── |
| `callout` | Shaded | callout | callout div | `> 💡` | callout | [💡] |
| `image` | Reference | img | img | `![]()` | image | [Image] |
| `database` | Table | table | table | Markdown table | table | [Table] |

## Technical Implementation

### File Structure

```
js/
├── import-export.js    # Main import/export module
├── sidebar.js          # UI integration (import modal, settings)
├── editor.js           # Editor methods for import/export
└── blocks.js           # Block creation utilities

css/
└── styles.css          # Import/export UI styles

index.html              # CDN links, UI elements
```

### Libraries Used

| Library | CDN | Purpose |
|---------|-----|---------|
| mammoth.js | unpkg | DOCX → HTML conversion |
| docx.js | unpkg | DOCX generation |
| pdf-lib.js | unpkg | PDF manipulation |
| turndown.js | unpkg | HTML → Markdown |

### Module API

#### ImportExport Module

```javascript
// Export
ImportExport.exportPage(page, format)     // → Promise<Blob>
ImportExport.exportToDOCX(page)           // → Promise<Blob>
ImportExport.exportToPDF(page)            // → Promise<Blob>
ImportExport.exportToHTML(page)           // → string
ImportExport.exportToMarkdown(page)       // → string
ImportExport.exportToJSON(page)           // → string
ImportExport.exportToTXT(page)            // → string

// Import
ImportExport.importFile(file, format)     // → Promise<page>
ImportExport.importFromDOCX(arrayBuffer)  // → Promise<page>
ImportExport.importFromPDF(arrayBuffer)   // → Promise<page>
ImportExport.importFromHTML(html)         // → page
ImportExport.importFromMarkdown(md)       // → page
ImportExport.importFromJSON(json)         // → page
ImportExport.importFromTXT(text)          // → page

// Utilities
ImportExport.download(content, filename, mimeType)
ImportExport.getFormats()                 // → {export, import}
ImportExport.isFormatSupported(format, type)
```

## Error Handling

### Import Errors
- **Invalid format**: Shows error message with retry option
- **Corrupted file**: Graceful fallback to text extraction
- **Large files**: Progress indicator during processing
- **Network issues**: Cached library handling

### Export Errors
- **Library not loaded**: Graceful degradation to available formats
- **Empty content**: Warning message
- **Browser restrictions**: PDF export uses print dialog fallback

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + E` | Export to Markdown (quick export) |

## Future Enhancements

### Potential Additions
1. **CSV Import/Export**: For database blocks
2. **EPUB Export**: E-book format
3. **LaTeX Export**: Academic papers
4. **RTF Export**: Rich text format
5. **Google Docs Integration**: Direct import/export
6. **Notion API Integration**: Direct sync

### Performance Optimizations
- Web Workers for large file processing
- Streaming for large exports
- Image compression during import
- Progress callbacks for batch operations

## Testing Checklist

### Export Tests
- [ ] DOCX export preserves formatting
- [ ] PDF export opens print dialog
- [ ] HTML export includes styles
- [ ] Markdown includes frontmatter
- [ ] JSON matches Notion format
- [ ] TXT export is readable

### Import Tests
- [ ] DOCX import preserves structure
- [ ] PDF extracts text correctly
- [ ] HTML converts blocks accurately
- [ ] Markdown parses frontmatter
- [ ] JSON imports Notion exports
- [ ] TXT creates proper paragraphs

### UI Tests
- [ ] Export dropdown works
- [ ] Import modal accepts drag-drop
- [ ] Settings modal shows all options
- [ ] Progress indicators appear
- [ ] Error messages are helpful
- [ ] Success toasts display

## Security Considerations

1. **File validation**: MIME type checking before processing
2. **Size limits**: Warn on files > 10MB
3. **XSS prevention**: HTML sanitization during import
4. **Script stripping**: Remove JavaScript from HTML imports
5. **Local processing**: All processing happens client-side

## Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| DOCX Export | ✅ | ✅ | ✅ | ✅ |
| PDF Export | ✅ | ✅ | ✅ | ✅ |
| DOCX Import | ✅ | ✅ | ✅ | ✅ |
| PDF Import | ✅ | ✅ | ⚠️ | ✅ |
| Drag & Drop | ✅ | ✅ | ✅ | ✅ |
| File API | ✅ | ✅ | ✅ | ✅ |

*Note: Safari PDF import uses fallback text extraction*
