# KimiBuilt AI Web Chat v3.0

A premium, modern web chat interface for the KimiBuilt AI backend. Now powered by the **OpenAI SDK** for seamless API integration with streaming support, session management, markdown rendering with syntax highlighting, dark/light theme support, AI model selection, and image generation capabilities.

![KimiBuilt AI Chat](https://via.placeholder.com/800x500/0d0d0d/3b82f6?text=KimiBuilt+AI+Chat)

## Features

### Core Chat Features
- 🚀 **Real-time Streaming** - OpenAI SDK streaming with HTTP fallback
- 🤖 **AI Model Selection** - Choose from multiple AI models (GPT-4o, Claude, etc.)
- 🎨 **Image Generation** - Create stunning AI-generated images with DALL-E 3
- 💬 **Session Management** - Create, switch, rename, and delete chat sessions
- 🎨 **Dark/Light Themes** - Automatic theme switching with system preference detection
- ✨ **Markdown Support** - Full markdown rendering with GitHub-flavored markdown
- 📱 **Mobile Responsive** - Optimized for desktop, tablet, and mobile devices
- ⌨️ **Keyboard Shortcuts** - Power-user shortcuts for all common actions
- 📋 **Code Copy** - One-click copy for code blocks with visual feedback
- 🔍 **Message Search** - Search within conversations with result navigation
- 📤 **Export Conversations** - Export as Markdown, JSON, or plain text
- 🔄 **Regenerate Responses** - Regenerate AI responses with one click
- 👁️ **Typing Indicators** - Visual feedback when AI is processing

### Model Selection Features
- 🎯 **Multiple AI Providers** - Support for OpenAI, Anthropic, Google, and Meta models
- 💾 **Persistent Preferences** - Default model saved to localStorage
- 🔧 **Per-Session Model** - Each session can use a different model
- ⚡ **Quick Switching** - Change models via header dropdown or command palette
- 🔍 **Model Search** - Find models quickly with search functionality

### Image Generation Features
- 🖼️ **DALL-E 3 Support** - High-quality image generation
- 🎨 **Multiple Sizes** - Square, landscape, and portrait orientations
- ✨ **Quality Options** - Standard and HD quality (DALL-E 3)
- 🌈 **Style Options** - Vivid and natural styles (DALL-E 3)
- 💾 **Download Images** - Save generated images to your device
- 🔗 **Copy URLs** - Quick copy of image URLs
- 🔍 **Lightbox View** - Click to enlarge and view full images
- 📝 **Revised Prompts** - See how the AI interpreted your prompt

### Premium UI/UX
- 🎯 **ChatGPT/Claude-inspired Design** - Clean, modern interface with premium feel
- 💎 **Syntax Highlighting** - Line numbers and language detection for 15+ languages
- 🔗 **Safe Links** - All external links open in new tabs with security attributes
- 🔔 **Toast Notifications** - Non-intrusive feedback for all actions
- 🎭 **Smooth Animations** - Subtle animations for better user experience
- 📊 **Connection Status** - Real-time backend connection indicator
- 🖨️ **Print Styles** - Optimized styling for printing conversations

## Quick Start

### Prerequisites

- KimiBuilt AI backend running with OpenAI-compatible API at `http://kimibuilt.local/v1`
- Modern web browser (Chrome 80+, Firefox 75+, Safari 13.1+, Edge 80+)

### Running the Chat UI

1. **Navigate to the project directory:**
   ```bash
   cd /mnt/c/Users/phill/KimiBuilt/frontend/web-chat
   ```

2. **Start a local server:**

   Using Python:
   ```bash
   # Python 3
   python -m http.server 8080
   
   # Python 2
   python -m SimpleHTTPServer 8080
   ```

   Using Node.js:
   ```bash
   npx serve -p 8080
   ```

   Using PHP:
   ```bash
   php -S localhost:8080
   ```

3. **Open in browser:**
   ```
   http://localhost:8080
   ```

## Project Structure

```
web-chat/
├── index.html          # Main HTML structure with model selector and image UI
├── css/
│   └── styles.css      # All styling including model selector and image components
├── js/
│   ├── api.js          # OpenAI SDK client with streaming support
│   ├── session.js      # Session management with model persistence
│   ├── ui.js           # UI rendering, search, command palette, model selector
│   └── app.js          # Main application logic with image generation
└── README.md           # This file
```

## Configuration

### Backend URL

To change the backend URL, edit `js/api.js`:

```javascript
const API_BASE_URL = 'http://your-backend/v1'; // Your KimiBuilt backend URL
const API_KEY = 'any-key'; // Required by SDK but not validated by KimiBuilt
```

The OpenAI SDK is loaded via CDN in `index.html`:
```html
<script src="https://unpkg.com/openai@4.82.0/dist/index.browser.js"></script>
```

### Default Model

The default model is stored in localStorage. To change it programmatically:

```javascript
// Set default model
localStorage.setItem('kimibuilt_default_model', 'claude-3-opus');

// Get current default
const defaultModel = localStorage.getItem('kimibuilt_default_model') || 'gpt-4o';
```

### Theme

The theme preference is automatically saved to `localStorage` and respects system preferences. Toggle between dark and light mode using the button in the sidebar or the command palette.

### Model Cache

Available models are cached for 5 minutes. To clear the cache:

```javascript
apiClient.clearModelsCache();
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift + Enter` | New line in message |
| `Ctrl/Cmd + K` | Open command palette |
| `Ctrl/Cmd + I` | Open image generation modal |
| `Ctrl/Cmd + F` | Search in conversation |
| `Ctrl/Cmd + N` | New chat |
| `Ctrl/Cmd + B` | Toggle sidebar |
| `Escape` | Close sidebar / search / command palette / modals |
| `↑ / ↓` | Navigate command palette or search results |

## Commands

Type `/` in the message input or open the command palette to use these commands:

| Command | Description |
|---------|-------------|
| `/model <name>` | Change default model (e.g., `/model gpt-4o`) |
| `/models` | Show model selector dropdown |
| `/image` | Open image generation panel |
| `/image <prompt>` | Generate image with prompt |

## API Integration

### OpenAI SDK Usage

The frontend now uses the official OpenAI JavaScript SDK for all API communication:

```javascript
// Initialize client
const client = new OpenAI({
    baseURL: 'http://kimibuilt.local/v1',
    apiKey: 'any-key',
    dangerouslyAllowBrowser: true,
});

// Streaming chat
const stream = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello!' }],
    stream: true,
});

for await (const chunk of stream) {
    console.log(chunk.choices[0]?.delta?.content);
}

// Image generation
const response = await client.images.generate({
    model: 'dall-e-3',
    prompt: 'A futuristic cityscape',
    size: '1024x1024',
});
```

### Message Format

Messages are sent in OpenAI-compatible format:

```json
[
  { "role": "user", "content": "Hello!" },
  { "role": "assistant", "content": "Hi there!" }
]
```

### Streaming Response Format

The streaming API yields chunks in this format:

```javascript
// Delta chunk
{
  type: 'delta',
  content: 'Hello'
}

// Done chunk
{
  type: 'done',
  sessionId: 'session-123'
}
```

### HTTP Endpoints (via OpenAI SDK)

The following OpenAI-compatible endpoints are used:

- `GET /v1/models` - List available chat models
- `POST /v1/chat/completions` - Chat completions with streaming
- `POST /v1/images/generations` - Generate images with DALL-E
- `GET /health` - Health check (KimiBuilt custom endpoint)

### Image Generation API

**Request:**
```json
POST /v1/images/generations
{
  "prompt": "futuristic cityscape at night",
  "model": "dall-e-3",
  "size": "1024x1024",
  "quality": "hd",
  "style": "vivid",
  "n": 1
}
```

**Response:**
```json
{
  "created": 1234567890,
  "data": [
    {
      "url": "https://...",
      "revised_prompt": "A detailed futuristic cityscape..."
    }
  ]
}
```

## Supported Languages for Syntax Highlighting

- JavaScript / TypeScript
- Python
- Java
- C / C++ / C#
- Go
- Rust
- Ruby
- PHP
- Bash / Shell
- SQL
- HTML / XML / JSX / TSX
- CSS
- JSON / YAML
- Docker

## Supported AI Models

The UI supports any model returned by the `/v1/models` endpoint. Common models include:

### OpenAI
- `gpt-4o` - Most capable multimodal model (default)
- `gpt-4o-mini` - Fast and affordable
- `gpt-4-turbo` - Advanced reasoning
- `gpt-3.5-turbo` - Balanced performance

### Anthropic
- `claude-3-opus` - Most powerful reasoning
- `claude-3-sonnet` - Balanced performance
- `claude-3-haiku` - Fast and efficient
- `claude-3-5-sonnet` - Latest and most capable

### Image Models
- `dall-e-3` - High-quality image generation
- `dall-e-2` - Standard image generation

## Browser Support

- Chrome 80+
- Firefox 75+
- Safari 13.1+
- Edge 80+

## Dependencies

All dependencies are loaded via CDN:

- [OpenAI SDK](https://github.com/openai/openai-node) - Official OpenAI JavaScript SDK
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS framework
- [Marked.js](https://marked.js.org/) - Markdown parser
- [Prism.js](https://prismjs.com/) - Syntax highlighting
- [DOMPurify](https://github.com/cure53/DOMPurify) - XSS sanitizer
- [Lucide](https://lucide.dev/) - Icon library

## Development

### Local Development Tips

1. **Enable browser auto-reload:**
   ```bash
   # Using browser-sync
   npx browser-sync start --server --files "**/*"
   ```

2. **Debug mode:**
   Open browser DevTools (F12) to see API calls and streaming responses.

3. **Test model selection:**
   ```javascript
   // List available models
   apiClient.getModels().then(r => console.log(r.data));
   
   // Change current model
   uiHelpers.selectModel('claude-3-opus');
   ```

4. **Test streaming chat:**
   ```javascript
   // Stream a chat (requires active session)
   const messages = [{ role: 'user', content: 'Hello!' }];
   for await (const chunk of apiClient.streamChat(messages, 'gpt-4o')) {
     console.log(chunk);
   }
   ```

5. **Test image generation:**
   ```javascript
   // Generate an image
   const result = await apiClient.generateImage({
     prompt: 'a serene mountain landscape at sunset',
     model: 'dall-e-3',
     size: '1024x1024',
     quality: 'hd',
     style: 'vivid'
   });
   console.log(result.data[0].url);
   ```

### Customization

#### Adding New Code Languages

Edit `index.html` and add Prism.js language components:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-rust.min.js"></script>
```

#### Custom Themes

Modify CSS variables in `css/styles.css`:

```css
:root {
  --bg-primary: #your-color;
  --bg-secondary: #your-color;
  --accent: #your-accent;
  /* ... */
}
```

#### Adding Model Provider Icons

To add icons for new model providers, edit the CSS in `styles.css`:

```css
.model-item-icon.your-provider {
    background: linear-gradient(135deg, #your-color, #your-color-2);
}
```

## Troubleshooting

### Connection Issues

If you see "Disconnected" in the status:

1. Ensure the backend is running and accessible
2. Check that `API_BASE_URL` in `js/api.js` points to the correct backend URL
3. Verify the backend has the OpenAI-compatible `/v1` endpoints
4. Try refreshing the page to reconnect
5. Check browser console for CORS errors

### CORS Errors

If you see CORS errors, ensure your backend has CORS enabled:

```javascript
// Express.js example
app.use(cors({
  origin: 'http://localhost:8080'
}));
```

### OpenAI SDK Not Loading

If you see "OpenAI SDK not loaded" errors:

1. Check that the CDN script is included in `index.html`:
   ```html
   <script src="https://unpkg.com/openai@4.82.0/dist/index.browser.js"></script>
   ```
2. Ensure you have an internet connection to load the SDK
3. Check browser DevTools Network tab for failed requests

### Messages Not Saving

Sessions and messages are stored in `localStorage`. Check:
- Browser storage quota not exceeded (check with `sessionManager.getStorageStats()` in console)
- Private/Incognito mode (storage is limited)
- LocalStorage not disabled

### Performance Issues

For conversations with many messages:
- The app uses batch rendering for smooth loading
- Consider exporting and starting a new session if performance degrades
- Use `sessionManager.cleanupOldSessions()` to remove old sessions

### Image Generation Not Working

1. Check that the backend has image generation enabled
2. Verify the `/v1/images/generations` endpoint is accessible
3. Check browser console for error messages
4. Ensure the DALL-E API credentials are configured on the backend

### Models Not Loading

1. Check that `/v1/models` returns valid JSON
2. Verify the backend is accessible
3. Clear the model cache: `apiClient.clearModelsCache()`
4. Check browser console for error messages

## Changelog

### v3.0 - OpenAI SDK Integration
- 🚀 **OpenAI SDK** - Now uses official OpenAI JavaScript SDK
- 🔄 **Streaming Support** - Native streaming with async generators
- 🛡️ **Browser Support** - Uses `dangerouslyAllowBrowser` for browser compatibility
- 🔧 **Simplified API** - Cleaner code with SDK abstraction
- 📦 **CDN Loading** - OpenAI SDK loaded via unpkg CDN

### v2.5 - Model Selection & Image Generation
- 🎯 **Model Selection** - Choose from multiple AI providers (OpenAI, Anthropic, etc.)
- 🖼️ **Image Generation** - Create AI images with DALL-E 3
- 🔧 **Per-Session Model** - Each conversation can use a different model
- 💾 **Model Persistence** - Default model saved across sessions
- 🔍 **Model Search** - Find models via command palette
- 📱 **Mobile Image UI** - Responsive image generation interface
- 💾 **Image Export** - Download generated images

### v2.0 - Major Upgrade
- ✨ New ChatGPT/Claude-inspired premium design
- 🔍 Added message search with navigation
- 📤 Added export functionality (Markdown, JSON, Text)
- 🎭 Added command palette (Ctrl+K)
- 🔢 Added line numbers to code blocks
- 🔄 Added regenerate response feature
- 👁️ Added typing indicator
- 🎨 Improved dark/light theme switching
- 📱 Enhanced mobile experience
- ⌨️ Added comprehensive keyboard shortcuts
- 🛡️ Enhanced XSS protection
- ⚡ Improved performance with batch rendering

### v1.0 - Initial Release
- Basic chat functionality
- WebSocket support
- Session management
- Markdown rendering
- Code syntax highlighting

## License

MIT License - See LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Support

For issues and feature requests, please open an issue on the project repository.

---

Built with ❤️ for the KimiBuilt AI ecosystem.
