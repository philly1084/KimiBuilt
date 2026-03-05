# KimiBuilt CLI v2.2 🚀

A premium Node.js CLI client for the KimiBuilt AI backend featuring an interactive REPL, real-time streaming responses, session persistence, beautiful terminal UI, model selection, image generation, and support for multiple interaction modes.

> **Note:** v2.2+ uses the official OpenAI SDK to connect to KimiBuilt's OpenAI-compatible endpoints at `/v1/*`.

![Version](https://img.shields.io/badge/version-2.1.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Features

- 🔄 **Interactive REPL** with real-time streaming responses
- 🤖 **Model Selection** - Choose from available AI models
- 🎨 **Image Generation** - Generate images using DALL-E and other models
- 💾 **Session persistence** - automatically saves and resumes sessions
- 📜 **Session history** - manage and switch between past sessions
- 📤 **Export/Import** - backup and restore sessions
- 📝 **Multiple modes**: Chat, Canvas, and Notation
- 📝 **Markdown rendering** with syntax highlighting
- 🎭 **Themes**: Choose from default, minimal, colorful, or dark themes
- ⏱️ **Performance tracking** - see response times
- 🔧 **Configurable** API base URL and settings
- 📡 **Pipe support** for scripting and automation
- 🖥️ **Beautiful UI** with gradients, spinners, and polished output
- ⌨️ **Auto-completion** for commands
- 🚨 **Helpful error messages** with troubleshooting tips

## 📦 Installation

```bash
# Navigate to the CLI directory
cd /mnt/c/Users/phill/KimiBuilt/frontend/cli

# Install dependencies
npm install

# Make globally available (optional)
npm link

# Or use directly
node cli.js
```

## 🚀 Usage

### Interactive Mode

```bash
# Start the CLI
kimibuilt
# or
kbc
# or
node cli.js
```

### Command Line Options

```bash
# Show version
kimibuilt --version

# Show help
kimibuilt --help

# Set API URL
kimibuilt --api-url http://localhost:3000

# Set mode
kimibuilt --mode canvas

# Set theme
kimibuilt --theme colorful

# Set model
kimibuilt --model gpt-4o-mini
```

### Pipe Mode

```bash
# Send a single message
echo "Explain quantum computing" | kimibuilt

# Process a file
cat mycode.js | kimibuilt

# Use with other tools
git diff | kimibuilt "Review these changes"
```

## ⌨️ Commands

| Command | Description |
|---------|-------------|
| `/new` | Create a new session |
| `/mode <chat\|canvas\|notation>` | Switch interaction mode |
| `/models` | List available chat models |
| `/model <id>` | Set default model |
| `/image <prompt>` | Generate an image |
| `/imgmodels` | List image generation models |
| `/history` | Show current session details |
| `/sessions` | List all session history |
| `/rename <name>` | Rename current session |
| `/export [file]` | Export session to JSON file |
| `/import <file>` | Import session from file |
| `/delete [id]` | Delete a session |
| `/clear` | Clear the screen |
| `/url [url]` | Show or set API base URL |
| `/config` | Show current configuration |
| `/theme [name]` | Show or set theme |
| `/help` | Show help message |
| `/quit` or `/exit` | Exit the CLI |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+C` | Cancel current operation (once) / Exit (twice) |
| `Ctrl+L` | Clear screen |
| `Tab` | Auto-complete commands |
| `↑/↓` | Navigate command history |

## 🤖 Model Selection

The CLI supports selecting different AI models for chat, canvas, and notation modes.

### List Available Models

```bash
You> /models
┌─ Available Models ────────────────────┐
  ● gpt-4o (OpenAI)
  2. gpt-4o-mini (OpenAI)
  3. claude-3-opus-20240229 (Anthropic)
  4. claude-3-sonnet-20240229 (Anthropic)
  5. claude-3-haiku-20240307 (Anthropic)

  Use /model <id> to select a model
└───────────────────────────────────────┘
```

### Set Default Model

```bash
You> /model gpt-4o-mini
✓ Model set to: gpt-4o-mini
```

### Check Current Model

```bash
You> /model
Current model: gpt-4o-mini
```

## 🎨 Image Generation

Generate images using DALL-E and other supported image models.

### Basic Usage

```bash
You> /image "a futuristic city at sunset, cyberpunk style"
Generating image...

┌─ Image Generated ─────────────────────┐
  Model: dall-e-3
  Size: 1024x1024
  Quality: standard
  Style: vivid

  Image 1:
  ✓ Saved to: ./images/img_1234567890_1.png
  URL: https://...
└───────────────────────────────────────┘
```

### With Options

```bash
You> /image "a serene mountain landscape" --model dall-e-3 --size 1792x1024 --quality hd --style natural
```

### Available Options

| Option | Description | Default |
|--------|-------------|---------|
| `--model`, `-m` | Model ID (dall-e-3, dall-e-2) | dall-e-3 |
| `--size`, `-s` | Image size | 1024x1024 |
| `--quality`, `-q` | Quality (standard, hd) | standard |
| `--style` | Style (vivid, natural) | vivid |
| `--n` | Number of images | 1 |
| `--output`, `-o` | Output filename | auto-generated |

### List Image Models

```bash
You> /imgmodels
┌─ Image Generation Models ─────────────┐
  1. DALL-E 3 - High-quality image generation
     Sizes: 1024x1024, 1024x1792, 1792x1024
     Qualities: standard, hd
     Styles: vivid, natural

  2. DALL-E 2 - Fast image generation
     Sizes: 256x256, 512x512, 1024x1024
     Qualities: standard
     Styles: natural
└───────────────────────────────────────┘
```

## 🎨 Modes

### Chat Mode (default)

Standard conversational AI with streaming responses:

```
You> How do I create a React component?
AI: [streaming response appears in real-time]
     (completed in 2456ms)
```

### Canvas Mode

For generating structured content like code, documents, or diagrams:

```
You> /mode canvas
✓ Switched to canvas mode

You> Create a Python function to fetch data from an API
[spinner] Generating canvas content...

┌─ Canvas Result ───────────────────────┐
  Type: code
  Time: 3245ms
└───────────────────────────────────────┘

# Python code appears here with syntax highlighting
```

Canvas types:
- `code` - Programming code with syntax metadata
- `document` - Markdown documents
- `diagram` - Mermaid diagram syntax

### Notation Mode

For shorthand notation processing:

```
You> /mode notation
✓ Switched to notation mode

You> fn:getUser(id) -> User
[spinner] Processing notation...

┌─ Notation Result ─────────────────────┐
  Mode: expand
  Time: 1234ms
└───────────────────────────────────────┘
```

Helper modes:
- `expand` - Expand shorthand into full content
- `explain` - Explain the notation components
- `validate` - Check notation for correctness

## ⚙️ Configuration

Configuration is stored in `~/.kimibuilt/config.json`:

```json
{
  "apiBaseUrl": "http://localhost:3000",
  "defaultMode": "chat",
  "defaultModel": null,
  "theme": "default",
  "autoSave": true,
  "showTimestamps": false,
  "streamResponses": true,
  "maxHistory": 100,
  "confirmQuit": false,
  "highlightCode": true,
  "imageOutputDir": "./images"
}
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `KIMIBUILT_API_URL` | Override the API base URL |

### Changing Settings

```bash
# Set API URL
You> /url http://localhost:3000
✓ API URL set to: http://localhost:3000

# View configuration
You> /config
┌─ Configuration ───────────────────────┐
  apiBaseUrl          : http://localhost:3000
  defaultMode         : chat
  defaultModel        : gpt-4o-mini
  theme               : default
  autoSave            : true
  showTimestamps      : false
  imageOutputDir      : ./images
  ...
└───────────────────────────────────────┘

# Change theme
You> /theme colorful
✓ Theme set to colorful

# Set image output directory
You> /config
# Edit imageOutputDir in ~/.kimibuilt/config.json
```

## 💾 Session Management

Sessions are automatically saved to `~/.kimibuilt/session-history.json`. The CLI will:
- Resume the previous session on startup
- Create a new session if none exists
- Update the session when the server returns a new one
- Maintain a history of up to 50 sessions
- Store the selected model per session

### Session Operations

```bash
# List all sessions
You> /sessions
┌─ Session History ─────────────────────┐
  ● My Project Session   [chat] (gpt-4o)  3/15/2025
  ○ Quick Question       [chat]           3/14/2025
  ○ Code Review          [canvas]         3/13/2025
└───────────────────────────────────────┘

# Rename current session
You> /rename "My Important Project"
✓ Renamed session to: My Important Project

# Export session
You> /export my-session.json
✓ Exported to: my-session.json

# Import session
You> /import my-session.json
✓ Imported session: My Important Project
```

## 🔌 API Endpoints

The CLI uses the OpenAI SDK to communicate with KimiBuilt's OpenAI-compatible endpoints:

### OpenAI-Compatible Endpoints (via OpenAI SDK)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/models` | GET | List available models |
| `/v1/chat/completions` | POST | Chat with streaming/non-streaming |
| `/v1/images/generations` | POST | Generate images |

### KimiBuilt Custom Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sessions` | GET/POST | List/Create sessions |
| `/api/sessions/:id` | GET/DELETE | Get/Delete session |
| `/api/images/models` | GET | List image generation models |

### Configuration

The CLI now connects to `http://localhost:3000/v1` by default (previously `http://localhost:3000`).

```bash
# Update existing configs to use the /v1 endpoint
You> /url http://localhost:3000/v1
```

## 🛠️ Development

```bash
# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format

# Start with development backend
npm start
```

## 🐛 Troubleshooting

### Connection Refused

```
❌ Connection refused. Please ensure the KimiBuilt server is running at http://localhost:3000
```

**Solution:** Start the KimiBuilt backend server or update the API URL with `/url <new-url>`.

### Invalid API URL

```
❌ Invalid API URL: example.com
```

**Solution:** Include the protocol: `/url http://example.com`

### Rate Limit Exceeded

```
❌ Rate limit exceeded. Please wait a moment before trying again.
```

**Solution:** Wait a few seconds before sending another request.

### Model Not Found

```
❌ Unknown model: gpt-5
```

**Solution:** Use `/models` to list available models.

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- Built with [Node.js](https://nodejs.org/)
- Terminal UI powered by [Chalk](https://github.com/chalk/chalk), [Ora](https://github.com/sindresorhus/ora), and [Figlet](https://github.com/patorjk/figlet.js)
- Markdown rendering by [Marked](https://marked.js.org/)
