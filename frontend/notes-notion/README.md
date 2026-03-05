# Notes - Notion Style

A feature-rich, Notion-inspired note-taking application with block-based editing, AI integration with model selection, image generation, and a clean, minimal interface.

![Notes App](screenshot.png)

## ✨ Features

### Block-Based Editor
- **18 Block Types**: Text, Heading 1/2/3, Bulleted List, Numbered List, To-do, Toggle, Quote, Divider, Callout, Code, Image, AI Image, Bookmark, Database, AI Assistant
- **Drag & Drop**: Reorder blocks using the ⋮⋮ handle with smooth visual feedback
- **Nested Content**: Toggle lists support nested blocks
- **Block Colors**: 9 background colors (gray, brown, orange, yellow, green, blue, purple, pink, red)
- **Improved Placeholders**: Context-aware placeholder text that disappears when typing

### Slash Commands
Type `/` anywhere to open the command menu:
- Basic blocks (Text, Headings, Lists)
- Media (Image, AI Image, Bookmark, Code)
- Advanced (Toggle, Callout, Divider, Database)
- AI Assistant ✨
- AI Image 🎨

### Markdown Shortcuts
- `# ` → Heading 1
- `## ` → Heading 2
- `### ` → Heading 3
- `- ` → Bulleted list
- `1. ` → Numbered list
- `[] ` → To-do checkbox
- `> ` → Quote
- `---` → Divider
- `` ``` `` → Code block

### Inline Formatting Toolbar
Select text to see the formatting toolbar:
- **Bold** (Ctrl+B)
- *Italic* (Ctrl+I)
- <u>Underline</u> (Ctrl+U)
- ~~Strikethrough~~
- [Link](https://example.com) (Ctrl+K)
- Clear formatting

### @ Mentions
Type `@` to mention:
- Pages in your workspace
- Today's date / Tomorrow
- People (placeholder for future integration)

### AI Integration
Powered by your KimiBuilt backend (`http://localhost:3000`):

1. **AI Assistant Block**: Type `/ai` to insert an AI block with model selection
2. **AI Image Block**: Type `/image` to generate images with DALL-E
3. **Ask AI**: Select text to see the AI toolbar
   - Improve writing
   - Fix spelling & grammar
   - Make shorter/longer
   - Change tone (professional, casual)
   - Summarize
   - Convert to bullet points
   - Brainstorm ideas
4. **Generate**: Press Cmd/Ctrl+K for AI modal with suggestions

### Model Selection
- **Page-Level Model**: Set a default AI model for each page
- **Per-Block Model**: Choose different models for different AI operations
- **Inline Model Switch**: Change model directly in the AI toolbar
- **Supported Models**: GPT-4o, GPT-4o Mini, Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku

### AI Image Generation
- **DALL-E 3 Support**: High-quality image generation
- **DALL-E 2 Support**: Faster, cost-effective option
- **Customizable Options**:
  - Size: 1024x1024, 1024x1792 (portrait), 1792x1024 (landscape)
  - Quality: Standard or HD
  - Style: Vivid or Natural
- **Download Generated Images**: Save images directly to your device
- **Regenerate**: Retry with the same or modified prompt

### Page Management
- Collapsible sidebar with page tree
- Nested pages support
- Drag handles to reorder pages
- Page icons (emoji picker)
- Cover images (gradients or custom URLs)
- Properties (key-value pairs)
- **Page Templates** (6 templates: Blank, To-do, Meeting Notes, Documentation, Daily Journal, Project Plan)

### Page History
- Soft delete to trash
- Restore deleted pages
- Empty trash permanently

### Import/Export
- Export any page to Markdown
- Export all pages at once
- Import from Markdown
- Preserves formatting and structure

### Themes
- Light and Dark mode toggle
- System preference detection
- Persistent theme selection

### Mobile Support
- Responsive design
- Mobile menu toggle
- Touch-friendly interactions
- Optimized sidebar for mobile

## 🚀 Getting Started

### Prerequisites
- Modern web browser (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+)
- KimiBuilt backend running on `http://localhost:3000` (optional - works in offline mode)

### Running the App

#### Option 1: Direct File Open
Simply open `index.html` in your browser:
```bash
cd /mnt/c/Users/phill/KimiBuilt/frontend/notes-notion
start index.html  # Windows
open index.html   # macOS
xdg-open index.html # Linux
```

#### Option 2: Local Server (Recommended)
For full functionality, serve via a local server:

```bash
# Using Python
cd /mnt/c/Users/phill/KimiBuilt/frontend/notes-notion
python -m http.server 8080

# Using Node.js
npx serve .

# Using PHP
php -S localhost:8080
```

Then open: `http://localhost:8080`

#### Option 3: With KimiBuilt Backend
1. Start the KimiBuilt backend:
```bash
cd /mnt/c/Users/phill/KimiBuilt/backend
npm start
```

2. Start the notes frontend (on a different port):
```bash
cd /mnt/c/Users/phill/KimiBuilt/frontend/notes-notion
python -m http.server 8081
```

3. Open: `http://localhost:8081`

## ⌨️ Keyboard Shortcuts

### General
| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + P` | New page (with template picker) |
| `Cmd/Ctrl + S` | Save page |
| `Cmd/Ctrl + E` | Export to Markdown |
| `Cmd/Ctrl + B` | Toggle sidebar |
| `Cmd/Ctrl + K` | AI Assistant |
| `Cmd/Ctrl + /` | Help |

### Editor
| Shortcut | Action |
|----------|--------|
| `/` | Show slash menu |
| `@` | Show mentions |
| `Enter` | New block |
| `Shift + Enter` | New line in same block |
| `Tab` | Indent block |
| `Shift + Tab` | Unindent block |
| `Backspace` (empty) | Delete block |
| `↑ / ↓` | Navigate between blocks |
| `Esc` | Deselect / Close menu |

### Text Formatting
| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + B` | Bold |
| `Ctrl/Cmd + I` | Italic |
| `Ctrl/Cmd + U` | Underline |
| `Ctrl/Cmd + K` | Add link |

### Markdown Shortcuts
| Shortcut | Result |
|----------|--------|
| `# ` | Heading 1 |
| `## ` | Heading 2 |
| `### ` | Heading 3 |
| `- ` | Bulleted list |
| `1. ` | Numbered list |
| `[] ` | To-do |
| `> ` | Quote |
| `---` | Divider |
| `` ``` `` | Code block |

## 📁 File Structure

```
notes-notion/
├── index.html              # Main HTML file
├── css/
│   └── styles.css          # All styles (Notion-inspired design)
├── js/
│   ├── app.js              # App controller & initialization
│   ├── editor.js           # Block editor core with inline toolbar & mentions
│   ├── blocks.js           # Block type definitions & rendering (18 types)
│   ├── slash-menu.js       # / command menu with improved positioning
│   ├── selection.js        # Block selection, drag & drop with visual feedback
│   ├── sidebar.js          # Page tree, navigation, templates, model selector
│   ├── ai-integration.js   # AI blocks, Ask AI features, model selection
│   ├── api.js              # Backend API client (models, chat, images)
│   └── storage.js          # LocalStorage persistence
└── README.md               # This file
```

## 💾 Data Model

### Page
```javascript
{
  id: string,
  title: string,
  icon: string,              // emoji
  cover: string|null,        // URL or gradient
  defaultModel: string|null, // default AI model for this page
  properties: [{key, value}],
  blocks: [Block],
  createdAt: Date,
  updatedAt: Date
}
```

### Block
```javascript
{
  id: string,
  type: 'text'|'heading_1'|'heading_2'|'heading_3'|
        'bulleted_list'|'numbered_list'|'todo'|'toggle'|
        'quote'|'divider'|'callout'|'code'|'image'|'ai_image'|
        'bookmark'|'database'|'ai',
  content: string | object,
  children?: [Block],
  formatting: object,
  color: string|null,
  createdAt: Date
}
```

### AI Image Block Content
```javascript
{
  prompt: string,            // image generation prompt
  imageUrl: string|null,     // generated image URL
  model: 'dall-e-3'|'dall-e-2',
  size: '1024x1024'|'1024x1792'|'1792x1024',
  quality: 'standard'|'hd',
  style: 'vivid'|'natural',
  status: 'pending'|'generating'|'done'|'error'
}
```

## 🔌 API Integration

The app uses the **OpenAI SDK** to connect to your KimiBuilt backend for AI features.

### Configuration

The OpenAI SDK is loaded via CDN in `index.html`:
```html
<script src="https://unpkg.com/openai@4.82.0/dist/index.browser.js"></script>
```

### SDK Configuration

In `js/api.js`, the SDK is configured to point to your KimiBuilt backend:
```javascript
const client = new OpenAI({
    baseURL: 'http://localhost:3000/v1',  // KimiBuilt backend
    apiKey: 'any-key',                     // Not required for local backend
    dangerouslyAllowBrowser: true,         // Required for browser usage
});
```

### API Methods Used

| Method | SDK Endpoint | Purpose |
|--------|--------------|---------|
| `client.models.list()` | `GET /v1/models` | Get available AI models |
| `client.chat.completions.create()` | `POST /v1/chat/completions` | Chat and text generation |
| `client.images.generate()` | `POST /v1/images/generations` | Image generation |
| `fetch /health` | Custom endpoint | Backend health check |

### Session Management

The SDK maintains session context via the `session_id` parameter, allowing KimiBuilt to track conversation context across requests:
```javascript
const params = {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: message }],
    session_id: currentSessionId,  // KimiBuilt extension
};
```

### Streaming Responses

The SDK handles streaming automatically:
```javascript
const stream = await client.chat.completions.create({ ...params, stream: true });
for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    // Handle streaming content
}
```

### Offline Mode
If the backend is unavailable, the app works fully in local mode:
- All data stored in LocalStorage
- AI features use client-side fallbacks
- No data is lost when backend reconnects
- Placeholder responses generated for demo purposes

## 🎨 Customization

### Changing the Theme Colors
Edit CSS variables in `css/styles.css`:
```css
:root {
  --accent-color: #2383e2;
  --bg-primary: #ffffff;
  --text-primary: #37352f;
  /* ... */
}
```

### Adding New Block Types
1. Add to `BLOCK_TYPES` in `js/blocks.js`
2. Create render function
3. Add to slash menu in `index.html`
4. Add CSS styles in `css/styles.css`

### Updating OpenAI SDK Version
To update the OpenAI SDK, change the CDN URL in `index.html`:
```html
<script src="https://unpkg.com/openai@4.82.0/dist/index.browser.js"></script>
```

Check [OpenAI SDK releases](https://github.com/openai/openai-node/releases) for the latest version.

### Connecting to Different Backend
Update `BASE_URL` in `js/api.js`:
```javascript
const BASE_URL = 'http://your-backend-url/v1';
```

Or update the OpenAI client configuration:
```javascript
const client = new OpenAI({
    baseURL: 'http://your-backend-url/v1',
    apiKey: 'your-api-key',
    dangerouslyAllowBrowser: true,
});

## 🛠️ Development

### Code Style
- ES6+ JavaScript
- Vanilla JS (no frameworks)
- Modular architecture with IIFE pattern
- Event-driven communication
- Semantic HTML and CSS custom properties

### Adding Features
1. Create module in `js/` directory
2. Expose public API via `window.ModuleName`
3. Initialize in `app.js`
4. Update this README
5. Add CSS styles for new UI components

## 🐛 Fixed Issues

### v3.0 Upgrade - Model Selection & Image Generation
1. **✅ Model Selection** - Page-level and per-block AI model selection
2. **✅ AI Image Block** - Generate images with DALL-E 3 and DALL-E 2
3. **✅ Image Options** - Customizable size, quality, and style settings
4. **✅ Model Selector UI** - Dropdown in page header and AI toolbar
5. **✅ Model Badges** - Shows which model generated content
6. **✅ API Updates** - New endpoints for models and image generation

### v2.0 Upgrade
1. **✅ Header being cut off** - Fixed `.page-header` padding and negative margin issues
2. **✅ Placeholder text** - Improved placeholder behavior with CSS `::before` pseudo-element
3. **✅ Slash menu positioning** - Menu now stays on screen and positions correctly
4. **✅ Drag handle visibility** - Better opacity handling and hover states
5. **✅ Block navigation** - Improved Arrow key navigation between blocks
6. **✅ Mobile support** - Added mobile menu toggle and responsive adjustments
7. **✅ Inline formatting toolbar** - Added toolbar for bold, italic, underline, strikethrough, links
8. **✅ @ Mentions** - Added mention support for pages and dates
9. **✅ Database block** - Added simple table view block type
10. **✅ Page templates** - Added 6 templates for quick page creation
11. **✅ Page history** - Added trash with restore functionality
12. **✅ Import/Export** - Added Markdown import and bulk export
13. **✅ Drag and drop** - Improved with visual feedback and drop indicators
14. **✅ AI integration** - Better prompt suggestions and toolbar positioning

## 💡 Tips & Tricks

1. **Quick Navigation**: Use `Cmd/Ctrl + B` to toggle sidebar for more space
2. **AI Everywhere**: Press Space on empty blocks for AI suggestions
3. **Drag & Drop**: Grab the ⋮⋮ handle to reorder blocks with visual feedback
4. **Block Menu**: Click the ⋮⋮ handle for duplicate, delete, color options
5. **Cover Images**: Click "Add cover" for beautiful gradient headers
6. **Nested Pages**: Use the expand arrow (▶) in the sidebar to see nested pages
7. **Templates**: Use `Cmd/Ctrl + P` to create pages from templates
8. **Mentions**: Type `@` to quickly link to other pages
9. **Formatting**: Select text to see the inline formatting toolbar
10. **Model Selection**: Set different AI models for different pages based on your needs
11. **AI Images**: Use `/image` to create diagrams, illustrations, or visual concepts

## 🐛 Troubleshooting

### Changes not saving
- Check browser LocalStorage permissions
- Ensure you're not in private/incognito mode
- Check browser console for errors

### AI not working
- Verify backend is running on `http://localhost:3000`
- Check browser console for CORS errors
- App will work in offline mode with limited AI features

### Models not loading
- Check that `/api/models` endpoint is accessible
- Verify backend supports model listing
- Default models will be used as fallback

### Image generation failing
- Check that `/api/images` endpoint is accessible
- Verify backend has image generation configured
- Placeholder images will be shown in offline mode

### Slash menu not appearing
- Make sure you're typing `/` at the start of a block
- Check if another menu (emoji picker, etc.) is open
- Press Escape to close any open menus and try again

### Header cut off at top
This should be fixed in v2.0. If you still see issues:
- Hard refresh the page (Ctrl+F5 or Cmd+Shift+R)
- Clear browser cache
- Check that you're using the latest version

## 📄 License

MIT License - Feel free to use, modify, and distribute!

## 🙏 Credits

Built with inspiration from Notion's excellent UX design and powered by the KimiBuilt AI backend.

---

**Version 3.0** - AI Model Selection & Image Generation

**Version 2.0** - Major upgrade with improved layout, new features, and bug fixes
