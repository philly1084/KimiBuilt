# KimiBuilt Canvas

A sophisticated side-by-side editor for structured content, built as **FRONTEND #3 of 4** for the KimiBuilt AI backend platform.

![KimiBuilt Canvas](https://img.shields.io/badge/KimiBuilt-Canvas-blue)
![Version](https://img.shields.io/badge/version-1.0.0-green)
![License](https://img.shields.io/badge/license-MIT-yellow)

## Features

- **🎨 Three Canvas Types**
  - **Code Editor**: Syntax-highlighted with language detection and line numbers
  - **Document Editor**: Rich markdown preview with live rendering
  - **Diagram Editor**: Mermaid.js integration for flowcharts and diagrams

- **💡 AI-Powered Workflow**
  - Send prompts directly to the KimiBuilt AI backend
  - Receive AI-generated content with suggestions
  - One-click apply to canvas

- **⚡ Editor Features**
  - Split-pane layout (prompt panel + editor)
  - CodeMirror 6 with 15+ language modes
  - Live preview for documents and diagrams
  - Split-view mode for side-by-side editing

- **🔄 History & Persistence**
  - 50-step undo/redo history
  - Auto-save to localStorage
  - Session persistence across page reloads

- **📤 Export Options**
  - Copy to clipboard
  - Download as file (auto-detects extension based on type)
  - SVG/PNG export for diagrams

- **🎭 VS Code Inspired UI**
  - Dark theme (default) with light theme option
  - Status bar with word/line count
  - Collapsible sidebar
  - Responsive design

## Quick Start

### Prerequisites

- A modern web browser (Chrome, Firefox, Safari, Edge)
- KimiBuilt AI backend running on `http://localhost:3000`

### Installation

1. **Clone or copy the frontend files** to your project:
```bash
mkdir -p /mnt/c/Users/phill/KimiBuilt/frontend/canvas
cd /mnt/c/Users/phill/KimiBuilt/frontend/canvas
```

2. **Ensure the file structure is correct**:
```
frontend/canvas/
├── index.html          # Main HTML structure
├── css/
│   └── styles.css      # Editor styling and themes
├── js/
│   ├── app.js          # Main application logic
│   ├── editor.js       # CodeMirror initialization
│   ├── api.js          # Canvas API client
│   ├── canvas-types.js # Type handlers (code/doc/diagram)
│   ├── history.js      # Undo/redo stack
│   └── export.js       # Export functionality
└── README.md           # This file
```

3. **Start a local server** (required for ES modules and CodeMirror):

Using Python:
```bash
# Python 3
python -m http.server 8080

# Python 2
python -m SimpleHTTPServer 8080
```

Using Node.js:
```bash
npx serve .
```

Using PHP:
```bash
php -S localhost:8080
```

4. **Open in browser**:
```
http://localhost:8080
```

### Backend Configuration

Ensure the KimiBuilt AI backend is running:
```bash
cd /mnt/c/Users/phill/KimiBuilt
npm start  # or your backend start command
```

Default backend URL: `http://localhost:3000`

To change the backend URL, edit `js/app.js`:
```javascript
this.api = new CanvasAPI('http://your-backend-url:port');
```

## API Specification

### HTTP Endpoint

**POST** `/api/canvas`

Request body:
```json
{
  "message": "Create a React component",
  "sessionId": "optional-session-id",
  "canvasType": "code",
  "existingContent": "optional context"
}
```

Response:
```json
{
  "sessionId": "uuid",
  "responseId": "uuid",
  "canvasType": "code",
  "content": "const Component = () => {...}",
  "metadata": {
    "language": "javascript",
    "title": "React Component",
    "type": "react"
  },
  "suggestions": ["Add props validation", "Add error handling"]
}
```

### WebSocket Support

Send:
```json
{
  "type": "canvas",
  "sessionId": "optional",
  "payload": {
    "message": "Create a function",
    "canvasType": "code",
    "existingContent": "..."
  }
}
```

Receive:
```json
{
  "type": "done",
  "sessionId": "uuid",
  "responseId": "uuid",
  "canvasType": "code",
  "content": "..."
}
```

## Usage Guide

### Canvas Types

#### 1. Code Editor
- Syntax highlighting for 15+ languages
- Automatic language detection
- Auto-closing brackets and matching
- Line numbers and active line highlighting

Supported languages: JavaScript, TypeScript, Python, Java, HTML, CSS, JSON, XML, SQL, YAML, Rust, Go, PHP, Ruby, C/C++, C#, Swift, Kotlin, Shell

#### 2. Document Editor
- Full Markdown support (GFM)
- Live preview mode
- Split-view editing
- Table of contents extraction

#### 3. Diagram Editor
- Mermaid.js integration
- Flowcharts, sequence diagrams, class diagrams
- State diagrams, ER diagrams, Gantt charts
- SVG/PNG export

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + S` | Save to localStorage |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |
| `Ctrl/Cmd + Y` | Redo (alternative) |
| `Ctrl/Cmd + /` | Toggle comment |
| `Tab` | Indent / Insert 2 spaces |
| `Shift + Tab` | Outdent |

### Tips

1. **Session Management**: Each conversation is tracked with a session ID. Start a new session anytime with the `+` button.

2. **Context Awareness**: Use "Use current content" to pass editor content as context to the AI.

3. **Suggestions**: AI suggestions appear as clickable chips - click to populate the prompt.

4. **Export**: File extensions are auto-detected based on content type and language.

## Browser Support

| Browser | Version |
|---------|---------|
| Chrome | 80+ |
| Firefox | 75+ |
| Safari | 13+ |
| Edge | 80+ |

## Dependencies

All dependencies are loaded via CDN (no local installation required):

- [CodeMirror 6](https://codemirror.net/) - Code editor
- [Mermaid.js](https://mermaid.js.org/) - Diagram rendering
- [Marked.js](https://marked.js.org/) - Markdown parsing

## Customization

### Themes

Toggle between dark and light themes using the sun/moon button in the header. Theme preference is saved to localStorage.

### Editor Settings

Modify `js/editor.js` to customize:
- Tab size
- Indentation
- Line wrapping
- Key bindings

### Styling

Edit `css/styles.css` CSS variables to customize:
```css
:root {
  --accent-primary: #007acc;
  --bg-primary: #1e1e1e;
  --text-primary: #d4d4d4;
  /* ... */
}
```

## Troubleshooting

### Editor not loading
- Ensure you're using a local server (not `file://`)
- Check browser console for CDN loading errors
- Try refreshing the page

### Backend connection failed
- Verify backend is running on `http://localhost:3000`
- Check for CORS errors in browser console
- Update API URL in `js/app.js` if needed

### WebSocket disconnected
- Falls back to HTTP automatically
- Check WebSocket support in backend
- Verify no firewall/proxy blocking WS

### Mermaid diagrams not rendering
- Check browser console for syntax errors
- Ensure valid Mermaid syntax
- Try refreshing after changing theme

## File Structure

```
frontend/canvas/
├── index.html              # Main structure with split-pane layout
├── css/
│   └── styles.css          # Editor styling, themes, responsive layout
├── js/
│   ├── app.js              # Main application logic (~500 lines)
│   ├── editor.js           # CodeMirror initialization and management
│   ├── api.js              # Canvas API client (HTTP + WebSocket)
│   ├── canvas-types.js     # Code/Document/Diagram mode handlers
│   ├── history.js          # Undo/redo stack management
│   └── export.js           # Export functionality
└── README.md               # This documentation
```

## Development

### Adding a new language

1. Add CodeMirror mode script to `index.html`:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/6.65.7/mode/lua/lua.min.js"></script>
```

2. Register in `js/canvas-types.js`:
```javascript
getCodeMirrorMode(language) {
    const modeMap = {
        // ... existing modes
        lua: 'lua',
    };
}
```

3. Add file extension mapping in `js/export.js`:
```javascript
fileExtensions: {
    code: {
        // ... existing extensions
        lua: '.lua',
    }
}
```

### Adding a new canvas type

1. Create handler class extending `CanvasTypeHandler` in `js/canvas-types.js`
2. Register in `CanvasTypeManager` constructor
3. Add UI button in `index.html`
4. Update `switchCanvasType()` method in `js/app.js`

## License

MIT License - Feel free to use in your own projects.

## Credits

Built for the KimiBuilt AI Platform by Kimi Code CLI.

---

**Part of KimiBuilt**: Frontend #3 of 4 - Canvas UI for structured content editing.
