# Notation Helper UI

A specialized IDE-style interface for the KimiBuilt AI Notation API. Process shorthand notations into expanded documentation, explanations, or validation reports.

![Notation Helper](https://img.shields.io/badge/KimiBuilt-Notation%20Helper-blue)
![Frontend](https://img.shields.io/badge/Frontend-Vanilla%20JS-green)

## Features

- **Dual-Pane Layout**: Editor on the left, rendered output on the right
- **Three Processing Modes**:
  - **Expand**: Convert shorthand to full documentation
  - **Explain**: Get detailed explanations of notation meaning
  - **Validate**: Check notation syntax and get feedback
- **Smart Editor**: CodeMirror-powered with line numbers and syntax awareness
- **Annotations**: Clickable line-by-line notes and suggestions
- **Templates Library**: Pre-built examples for common patterns
- **History**: Local storage of recent sessions
- **Export Options**: Copy, Markdown export, annotations as comments
- **Keyboard Shortcuts**: Power-user friendly shortcuts
- **Responsive Design**: Works on desktop and mobile
- **Dark/Light Themes**: Choose your preferred appearance

## Quick Start

### Prerequisites

- KimiBuilt AI Backend running on `http://localhost:3000`
- Modern web browser (Chrome, Firefox, Safari, Edge)

### Running the Application

1. **Serve the files**: Use any static file server

```bash
# Using Python 3
python -m http.server 8080

# Using Node.js (http-server)
npx http-server -p 8080

# Using PHP
php -S localhost:8080
```

2. **Open in browser**: Navigate to `http://localhost:8080`

3. **Verify connection**: Check the connection status indicator in the header

## API Integration

The Notation Helper connects to the KimiBuilt AI backend:

### HTTP API
```
POST http://localhost:3000/api/notation
Content-Type: application/json

{
  "notation": "user -> auth -> dashboard",
  "helperMode": "expand",
  "context": "optional context"
}
```

### WebSocket
```javascript
ws://localhost:3000

// Send
{
  "type": "notation",
  "payload": {
    "notation": "user -> auth -> dashboard",
    "helperMode": "expand"
  }
}

// Receive
{
  "type": "done",
  "content": "{ \"result\": \"...\" }"
}
```

## File Structure

```
notation/
├── index.html          # Main HTML structure
├── css/
│   └── styles.css      # All styling, themes, responsive design
├── js/
│   ├── app.js          # Main application, event handling
│   ├── editor.js       # CodeMirror editor wrapper
│   ├── output.js       # Output rendering and export
│   ├── api.js          # HTTP/WebSocket API client
│   ├── templates.js    # Template definitions
│   ├── history.js      # Local storage history
│   └── annotations.js  # Annotation display/navigation
└── README.md           # This file
```

## Usage Guide

### Basic Usage

1. **Enter notation** in the left panel
2. **Select mode** (Expand/Explain/Validate) using the tabs
3. **Click Process** or press `Ctrl+Enter`
4. **View result** in the right panel

### Using Context

Click the **Context** bar to expand additional context input. This helps the AI understand your notation better:

- System architecture details
- Notation format (e.g., "Mermaid syntax")
- Domain-specific information

Process with context using `Ctrl+Shift+Enter`.

### Templates

Click any template in the sidebar to load it:

- **System Design**: Architecture diagrams, service flows
- **Flowcharts**: Decision trees, process flows
- **Data Models**: Entity relationships, schemas
- **API Specs**: REST endpoints, GraphQL, webhooks

### History

Previous sessions are automatically saved to browser local storage:

- Click any history item to reload it
- History includes notation, result, mode, and annotations
- Clear history using the trash button

### Annotations

Annotations appear in the right sidebar:

- Click an annotation to navigate to the corresponding line
- Lines with annotations are highlighted in the output
- Annotations include line numbers and notes

### Export

Three export options are available:

- **Copy**: Copy result to clipboard
- **Markdown**: Download as `.md` file with metadata
- **Annotations**: Export with annotations as HTML comments

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` / `Cmd+Enter` | Process notation |
| `Ctrl+Shift+Enter` / `Cmd+Shift+Enter` | Process with context |
| `Ctrl+/` / `Cmd+/` | Toggle comment (in editor) |

## Notation Examples

### System Design
```
user -> auth -> dashboard -> api -> db
auth --> email [verification]
session --stored-in--> redis
```

### Flowchart
```
start -> [isValid?] -> yes -> process -> end
[isValid?] -> no -> error -> retry -> [isValid?]
```

### Data Model
```
User { id: PK, email } --has-many--> Post { id: title }
User --has-many--> Comment { id, body }
```

### API Spec
```
GET    /api/users       -> 200 [User] | 401 { error }
POST   /api/users       -> 201 { User } | 400 { error }
```

## Customization

### Adding Templates

Edit `js/templates.js` to add new templates:

```javascript
{
    id: 'my-template',
    name: 'My Template',
    category: 'system', // system, flowchart, data, api
    description: 'Description here',
    notation: `your -> notation -> here`,
    mode: 'expand' // expand, explain, validate
}
```

### Changing API Endpoint

Edit the API configuration in `js/app.js`:

```javascript
NotationAPI.init({
    baseUrl: 'http://your-api-url:port',
    wsUrl: 'ws://your-api-url:port'
});
```

### Themes

Toggle between dark and light themes using the moon/sun icon in the header. The theme preference is saved to local storage.

## Browser Support

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## Troubleshooting

### Connection Issues

If the connection status shows "Error":

1. Verify the backend is running on `localhost:3000`
2. Check browser console for CORS errors
3. Ensure WebSocket support is enabled in the backend

### Editor Not Loading

If the CodeMirror editor doesn't appear:

1. Check browser console for script loading errors
2. Verify internet connection (for CDN resources)
3. Clear browser cache and reload

### History Not Saving

History requires local storage:

1. Ensure cookies/local storage aren't disabled
2. Check if in private/incognito mode
3. Clear site data if storage is corrupted

## Development

### Local Development

No build step required! The app uses vanilla JavaScript with CDN resources:

- CodeMirror 6 (from CDNJS)
- Marked.js (from jsDelivr)
- Font Awesome (from CDNJS)

### Code Style

- ES6+ features
- Module pattern with global fallbacks
- Event-driven architecture
- CSS custom properties for theming

## License

Part of the KimiBuilt AI project.

## Support

For issues or feature requests, please refer to the main KimiBuilt AI documentation.
