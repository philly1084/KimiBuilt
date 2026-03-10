# Import/Export Functionality Guide

## Overview
The Kimi Canvas now features comprehensive import/export capabilities for business file formats. This guide documents all the available features.

## Files Added/Modified

### New Files
- `js/import-export.js` - Main import/export module (60KB+)

### Modified Files
- `index.html` - Added CDN libraries, export dropdown menu, file drop overlay
- `js/app.js` - Integrated new import/export handlers
- `css/styles.css` - Added styles for export dialog, drop overlay, and dropdown menus

## CDN Libraries Added
The following libraries are loaded on-demand for specific features:

- **jsPDF** (2.5.1) - PDF export functionality
- **PDF.js** (3.11.174) - PDF import and rendering
- **SheetJS** (0.18.5) - Excel/CSV import/export
- **PptxGenJS** (3.12.0) - PowerPoint export

## Export Formats

### 1. PNG (Enhanced)
- High-quality raster export
- Configurable scale (1x-4x)
- Transparency option
- Padding settings
- **Shortcut**: Export dropdown → PNG

### 2. JPEG
- Compressed photo format
- Quality settings (0.1-1.0)
- Automatic background fill
- **Shortcut**: Export dropdown → JPEG

### 3. SVG (Vector)
- Scalable vector graphics
- All elements converted to SVG primitives
- Embedded styles
- **Shortcut**: Export dropdown → SVG

### 4. PDF (Multi-page)
- Multi-page PDF for large canvases
- Automatic pagination
- A4 page size
- Scale-to-fit
- **Shortcut**: Export dropdown → PDF

### 5. HTML (Interactive)
- Standalone HTML page
- Embedded SVG preview
- Download buttons for SVG/JSON
- Print-friendly CSS
- **Shortcut**: Export dropdown → HTML

### 6. PowerPoint (PPTX)
- Convert canvas to slides
- Automatic slide grouping
- All shapes supported
- **Shortcut**: Export dropdown → PowerPoint

### 7. JSON (Full Data)
- Complete canvas data export
- Metadata included
- Importable back to canvas
- **Shortcut**: Ctrl+S (legacy)

## Import Formats

### 1. Images (PNG, JPG, SVG, GIF, WebP)
- Drag and drop anywhere on canvas
- Position at drop location
- Automatic sizing with aspect ratio preservation
- SVG imports converted to editable elements

### 2. JSON
- Full canvas restoration
- Excalidraw-compatible format
- Drag & drop or file picker

### 3. CSV/Excel (XLS, XLSX)
- Converted to table elements
- Grid layout with cells
- First row as header styling
- Automatic sizing

### 4. PDF
- Each page as separate image element
- Up to 10 pages per import
- High-quality rendering

### 5. MindMap Files
- **FreeMind (.mm)** - Full diagram conversion
- **OPML (.opml)** - Outline import as flowchart
- Hierarchical layout

### 6. Draw.io (.drawio, .xml)
- Import diagrams
- Shapes converted to canvas elements
- Text preserved

## User Interface

### Export Button (Top Bar)
- Click to open dropdown menu
- All export formats listed with icons
- Quick access to common formats

### Import Button (Top Bar)
- Click to open file picker
- Multi-file selection supported
- Batch import capability

### Drag & Drop
- Drag files anywhere on canvas
- Visual overlay shows supported formats
- Position imported content at drop location
- Multiple files supported

### Export Dialog (Ctrl+E)
- Visual grid of export formats
- Export options panel:
  - Transparent background toggle
  - Scale slider (1x-4x)
  - Padding slider (0-100px)
- One-click export

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+O | Open Import Dialog |
| Ctrl+E | Open Export Dialog |
| Ctrl+S | Save as JSON (legacy) |
| Drag & Drop | Import Files |

## Supported File Extensions

### Images
.png, .jpg, .jpeg, .gif, .svg, .webp

### Data
.json, .csv, .xls, .xlsx

### Documents
.pdf

### Mind Maps
.mm (FreeMind), .opml (OPML)

### Diagrams
.drawio, .xml (Draw.io)

## Usage Examples

### Export to PDF
1. Click Export button in top bar
2. Select "PDF Document"
3. PDF downloads automatically

### Import a Mind Map
1. Click Import button or press Ctrl+O
2. Select .mm or .opml file
3. Diagram appears on canvas

### Drag & Drop Multiple Files
1. Select files in file explorer
2. Drag to canvas
3. Drop to position content
4. Each file is imported in sequence

### Export with Custom Options
1. Press Ctrl+E
2. Select format
3. Adjust options (scale, padding, transparency)
4. Click export button

## Technical Details

### Import/Export Manager
The `ImportExportManager` class provides:
- Lazy loading of external libraries
- Format detection by MIME type and extension
- Progress tracking for batch operations
- Error handling with user feedback

### Canvas Bounds Calculation
All exports calculate element bounds to:
- Include all content
- Apply padding
- Support multi-page layouts

### SVG Generation
Elements converted to SVG:
- Rectangles, ellipses, diamonds
- Lines and arrows
- Text with font preservation
- Images (embedded as data URLs)
- Free-draw paths

## Error Handling

Import/export errors are:
- Logged to console
- Displayed as toast notifications
- Non-blocking for batch operations

Common errors:
- Unsupported file format
- Corrupted file data
- Missing external library
- Canvas is empty for export

## Browser Compatibility

Requires modern browsers with support for:
- ES6+ JavaScript
- Canvas API
- FileReader API
- Blob/URL API
- Drag and Drop API

Tested on:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Future Enhancements

Potential additions:
- OCR for text extraction from images
- More diagram formats (Visio, Lucidchart)
- Export to video/animation
- Cloud storage integration
- Collaborative import/export
