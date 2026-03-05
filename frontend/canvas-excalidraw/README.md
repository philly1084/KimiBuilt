# Kimi Canvas - Excalidraw Style

A fully-featured Excalidraw-style infinite canvas frontend with AI-powered diagram generation, connected to the KimiBuilt backend.

## Features

### Drawing Tools
- **Selection** (V or 1) - Select, move, and resize elements
- **Rectangle** (R or 2) - Draw rectangles with hand-drawn style
- **Diamond** (D or 3) - Draw diamonds for flowcharts
- **Ellipse** (O or 4) - Draw circles and ovals
- **Arrow** (A or 5) - Draw arrows with automatic arrowheads
- **Line** (L or 6) - Draw straight lines with 45° angle constraint (Shift)
- **Pencil** (P or 7) - Freehand drawing with smoothing
- **Text** (T or 8) - Add text labels, double-click to edit
- **Sticky Note** (S) - Create sticky notes with auto-sizing
- **Frame** (F) - Create frames for organizing content
- **Image** (I or 0) - Insert images (drag & drop, copy/paste, or file picker)
- **Eraser** (E or 9) - Remove elements

### Canvas Features
- **Infinite Canvas** - Pan and zoom freely
  - Space + Drag or Middle Mouse to pan
  - Ctrl/Cmd + Scroll to zoom
  - Pinch to zoom on touch devices
  - Two-finger pan on touch devices
- **Hand-drawn Rendering** - Rough.js for sketchy, organic look
- **Grid Background** - Dot grid with major grid lines
- **Grid Snapping** - Toggle snap to grid for precise placement
- **Dark/Light Theme** - Toggle between themes
- **Export** - PNG, SVG, and JSON formats
- **Import** - Import JSON files, drag & drop support
- **Undo/Redo** - Full history management (Ctrl+Z/Y)
- **Copy/Paste** - Copy and paste elements (Ctrl+C/V)

### Properties Panel
- **Grid Snap Toggle** - Enable/disable grid snapping
- Stroke color picker
- Background fill color picker
- Stroke width (thin, regular, bold, extra bold)
- Stroke style (solid, dashed, dotted)
- Sloppiness/Roughness (architect, artist, cartoonist)
- Edge style (sharp, round)
- Opacity slider
- Font size and family (for text)
- **Alignment Tools** (for multi-select)
  - Align left, center, right
  - Align top, middle, bottom
  - Distribute horizontally, vertically
- Layer actions (delete, duplicate, bring to front, send to back)

### Selection & Multi-Select
- **Single Selection** - Click to select element
- **Multi-Selection** - Shift+click to add/remove, or drag selection box
- **Resize** - 8 resize handles for scaling elements
- **Move** - Drag to move, Shift+drag for constrained movement
- **Double-click** - Edit text or sticky notes inline

### AI Assistant
- Describe diagrams in natural language
- AI generates diagram elements
- Suggestions for common diagrams
- Integrates with KimiBuilt backend

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| V / 1 | Selection tool |
| R / 2 | Rectangle tool |
| D / 3 | Diamond tool |
| O / 4 | Ellipse tool |
| A / 5 | Arrow tool |
| L / 6 | Line tool |
| P / 7 | Pencil tool |
| T / 8 | Text tool |
| E / 9 | Eraser tool |
| I / 0 | Image tool |
| S | Sticky Note tool |
| F | Frame tool |
| Space + Drag | Pan canvas |
| Ctrl + + | Zoom in |
| Ctrl + - | Zoom out |
| Ctrl + 0 | Reset zoom |
| Ctrl + D | Duplicate selection |
| Ctrl + G | Group selection |
| Ctrl + Shift + G | Ungroup selection |
| Ctrl + C | Copy selection |
| Ctrl + V | Paste selection |
| Ctrl + X | Cut selection |
| Ctrl + A | Select all |
| Ctrl + Z | Undo |
| Ctrl + Y | Redo |
| Ctrl + S | Save as JSON |
| Ctrl + O | Open JSON file |
| Delete / Backspace | Delete selection |
| Shift + Drag | Constrain proportions |
| ? | Show help |
| Escape | Close panels, deselect |

## Backend Integration

The frontend connects to the KimiBuilt backend using the OpenAI SDK at `http://localhost:3000/v1`:

### OpenAI SDK Configuration

The frontend uses the OpenAI JavaScript SDK (loaded via CDN) to communicate with the KimiBuilt backend:

```html
<script src="https://unpkg.com/openai@4.82.0/dist/index.browser.js"></script>
```

### API Methods

The `OpenAICanvasAPI` class provides:

- `generateDiagram(message, existingContent)` - Generate AI diagrams using chat completions
- `generateImage(options)` - Generate images using DALL-E models
- `getModels()` - Fetch available chat models from `/v1/models`
- `getImageModels()` - Get available image generation models
- `checkHealth()` - Check backend health status

### Configuration

The API client is configured in `js/api.js`:

```javascript
const client = new OpenAI({
    baseURL: 'http://localhost:3000/v1',
    apiKey: 'any-key',  // Backend doesn't require a real API key
    dangerouslyAllowBrowser: true,  // Required for browser usage
});
```

### Model Selection

The selected model is persisted to `localStorage` and used for all AI requests:

- Default model: `gpt-4o`
- Supported models: gpt-4o, gpt-4o-mini, claude-3-opus, claude-3-sonnet, etc.

### Data Format
```json
{
  "id": "unique-id",
  "type": "rectangle|diamond|ellipse|arrow|line|freedraw|text|image|sticky|frame",
  "x": 100,
  "y": 100,
  "width": 200,
  "height": 100,
  "strokeColor": "#000000",
  "backgroundColor": "transparent",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "roughness": 1,
  "opacity": 1,
  "text": "Optional text",
  "fontSize": 20,
  "fontFamily": "Virgil, cursive",
  "points": [{"x": 0, "y": 0}, {"x": 100, "y": 100}],
  "name": "Frame name (for frames)"
}
```

## File Structure

```
canvas-excalidraw/
├── index.html              # Main HTML with layout structure
├── css/
│   └── styles.css          # Excalidraw-inspired styles
├── js/
│   ├── app.js              # Main app controller
│   ├── canvas.js           # Infinite canvas with pan/zoom, touch support
│   ├── renderer.js         # Rough.js rendering engine
│   ├── tools.js            # Tool definitions and behaviors
│   ├── selection.js        # Selection, move, resize, alignment logic
│   ├── properties.js       # Right panel property controls
│   ├── history.js          # Undo/redo stack
│   ├── api.js              # Backend integration
│   └── ai-assistant.js     # AI diagram generation panel
└── README.md
```

## Usage

1. Open `index.html` in a modern web browser
2. Use the left toolbar to select tools
3. Click and drag on the canvas to draw
4. Use the properties panel to customize elements
5. Use the AI assistant for automated diagram generation
6. Drag and drop images or JSON files onto the canvas
7. Copy/paste elements with Ctrl+C/V or paste images from clipboard

## Browser Requirements

- Modern browsers with ES6+ support
- Canvas API support
- Touch events support (for tablet/mobile)

## Recent Updates

### Version 2.1
- **OpenAI SDK**: Migrated from custom HTTP calls to OpenAI SDK
- **Chat Completions**: Diagram generation now uses chat.completions API
- **Image Generation**: Uses images.generate API for DALL-E models
- **Model Management**: Fetches available models from `/v1/models` endpoint

### Version 2.0
- **Fixed Tools**: All 10+ tools now working correctly
- **Touch Support**: Full touch support for tablets and mobile devices
- **Grid Snapping**: New snap-to-grid feature for precise placement
- **Alignment Tools**: Align and distribute multiple elements
- **Sticky Notes**: New sticky note element type with auto-editing
- **Frames**: New frame element type for organizing content
- **Copy/Paste**: Full copy/paste support for elements
- **Drag & Drop**: Drag images and JSON files onto the canvas
- **Clipboard Paste**: Paste images directly from clipboard
- **Better Pan/Zoom**: Improved pan and zoom with touch gestures
- **Selection Box**: Drag-to-select multiple elements
- **Resize Handles**: All 8 resize handles working correctly
- **Text Editing**: Double-click to edit text inline

## Credits

- [Rough.js](https://roughjs.com/) - Hand-drawn graphics library
- [Excalidraw](https://excalidraw.com/) - UI inspiration
- Virgil font from Excalidraw
