# Enhanced PDF Import Documentation

## Overview

The notes-notion app now includes an enhanced PDF import system that can handle complex PDFs with mixed pictures and text content. This system uses Mozilla's PDF.js library for robust text and image extraction.

## Features

### 1. **Mixed Content Support**
- Extracts both text and images from PDFs
- Handles scanned/image-based PDFs by rendering pages as images
- Preserves text formatting (headings, lists, quotes)

### 2. **PDF Preview**
- Shows thumbnail previews of pages before import
- Displays page count and content type detection
- Warns about scanned/image-based PDFs

### 3. **Import Options**
- **Page selection**: Import specific pages or ranges (e.g., "1-5, 8, 10-12")
- **Image quality**: Choose between Standard, High, or Maximum quality
- **Image extraction**: Option to extract embedded images

### 4. **Progress Tracking**
- Real-time progress bar during import
- Status messages for each processing stage
- Page-by-page progress indication

### 5. **Fallback Mechanisms**
- Multiple extraction methods (PDF.js → basic extraction)
- Clear error messages with helpful tips
- Suggestions for handling problematic PDFs

## Implementation

### Files Added/Modified

1. **`js/pdf-import.js`** (NEW)
   - Core PDF import functionality
   - Text extraction with formatting detection
   - Image extraction and rendering
   - Progress callbacks

2. **`js/import-export.js`** (MODIFIED)
   - Updated `importFromPDF()` to use new module
   - Added `previewPDF()` and `detectScannedPDF()` functions
   - Maintains backward compatibility

3. **`js/sidebar.js`** (MODIFIED)
   - Enhanced `handleFileImport()` for PDFs
   - Added PDF import UI with preview and options
   - Progress visualization

4. **`index.html`** (MODIFIED)
   - Added PDF.js CDN link
   - Included new `pdf-import.js` script

5. **`css/styles.css`** (MODIFIED)
   - Added PDF import UI styles
   - Dark mode support
   - Responsive design

### Key Functions

#### `PDFImport.importPDF(arrayBuffer, options, progressCallback)`
Main import function with options:
```javascript
{
    title: 'Document Title',           // Custom title
    pageRange: '1-5,8,10-12',          // Page selection
    imageQuality: 0.92,                // JPEG quality (0-1)
    extractImages: true,               // Extract embedded images
    skipOCRWarning: false              // Skip scanned PDF warning
}
```

#### `PDFImport.previewPDF(arrayBuffer, maxPages)`
Returns preview data:
```javascript
{
    totalPages: 10,
    previews: [
        { pageNum: 1, thumbnail: 'data:image/...', hasText: true, dimensions: {...} }
    ],
    hasMore: true
}
```

#### `PDFImport.detectScannedPDF(arrayBuffer)`
Detects if PDF is image-based:
```javascript
{
    isScanned: false,
    hasText: true,
    confidence: 0.33
}
```

## Usage

### For Users

1. Click "Import" button in sidebar
2. Select or drop a PDF file
3. Preview the PDF and configure options:
   - Choose specific pages or import all
   - Set image quality
   - Toggle image extraction
4. Click "Import PDF" and wait for processing
5. PDF content appears as editable blocks

### For Developers

```javascript
// Basic import
const page = await ImportExport.importFromPDF(arrayBuffer);

// With options and progress
const page = await ImportExport.importFromPDF(arrayBuffer, {
    title: 'My Document',
    pageRange: '1-10',
    imageQuality: 0.92,
    extractImages: true
}, (progress) => {
    console.log(`${Math.round(progress.progress * 100)}% - ${progress.message}`);
});

// Preview before import
const preview = await ImportExport.previewPDF(arrayBuffer, 5);

// Check if scanned
const scanInfo = await ImportExport.detectScannedPDF(arrayBuffer);
if (scanInfo.isScanned) {
    console.warn('This PDF may need OCR processing');
}
```

## Text Formatting Detection

The importer automatically detects and preserves:

- **Headings**: Based on font size (H1, H2, H3)
- **Lists**: Bulleted (•, -, *) and numbered (1., 2.)
- **Quotes**: Lines starting with " or >
- **Paragraphs**: Text separated by vertical gaps

## Limitations

1. **OCR**: No built-in OCR for scanned PDFs. Pages are imported as images.
2. **Complex layouts**: Multi-column layouts may not preserve exact formatting
3. **Embedded fonts**: Some custom fonts may not render correctly
4. **Password protection**: Encrypted PDFs cannot be imported

## Troubleshooting

### PDF won't import
- Check if PDF is password-protected
- Try converting to a different format first
- Check browser console for error messages

### Text not extracted
- PDF may be image-based (scanned)
- Use OCR software (Adobe Acrobat, online OCR) before importing
- Import will include page images instead

### Poor formatting
- Complex layouts may need manual cleanup
- Tables are converted to text blocks
- Multi-column text may flow as single column

## Dependencies

- **PDF.js 3.11.174**: Core PDF parsing library
  - CDN: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js`
  - Worker: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`

## Browser Compatibility

- Chrome 80+
- Firefox 75+
- Safari 13.1+
- Edge 80+

Requires ES2018 support for async/await and modern array methods.
