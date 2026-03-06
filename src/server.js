const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const helmet = require('helmet');

const { config, validate } = require('./config');
const { errorHandler } = require('./middleware/error-handler');
const { memoryService } = require('./memory/memory-service');
const { setupWebSocket } = require('./ws/handler');
const { embedder } = require('./memory/embedder');
const { vectorStore } = require('./memory/vector-store');

// Routes
const chatRouter = require('./routes/chat');
const canvasRouter = require('./routes/canvas');
const notationRouter = require('./routes/notation');
const sessionsRouter = require('./routes/sessions');
const modelsRouter = require('./routes/models');
const imagesRouter = require('./routes/images');
const openaiCompatRouter = require('./routes/openai-compat');

// Validate config on startup
validate();

const app = express();

// ---------------------
// Middleware
// ---------------------
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ---------------------
// Health check
// ---------------------
app.get('/health', async (_req, res) => {
    const checks = {
        server: 'ok',
        qdrant: 'unknown',
        ollama: 'unknown',
    };

    try {
        checks.qdrant = (await vectorStore.healthCheck()) ? 'ok' : 'down';
    } catch {
        checks.qdrant = 'down';
    }

    try {
        checks.ollama = (await embedder.healthCheck()) ? 'ok' : 'down';
    } catch {
        checks.ollama = 'down';
    }

    const allOk = Object.values(checks).every((v) => v === 'ok');
    res.status(allOk ? 200 : 503).json({
        status: allOk ? 'healthy' : 'degraded',
        components: checks,
        timestamp: new Date().toISOString(),
    });
});

// ---------------------
// Static Files (Frontend)
// ---------------------
const frontendPath = process.env.FRONTEND_PATH || path.join(__dirname, '../frontend');
app.use('/cli', express.static(path.join(frontendPath, 'cli')));
app.use('/web-chat', express.static(path.join(frontendPath, 'web-chat')));
app.use('/canvas', express.static(path.join(frontendPath, 'canvas-excalidraw')));
app.use('/notes', express.static(path.join(frontendPath, 'notes-notion')));

// Simple index page
app.get('/', (_req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>KimiBuilt AI</title>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background: #0d0d0d;
            color: #fafafa;
        }
        h1 { color: #3b82f6; }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-top: 30px;
        }
        .card {
            background: #1f1f1f;
            border: 1px solid #333;
            border-radius: 12px;
            padding: 20px;
            text-decoration: none;
            color: inherit;
            transition: all 0.2s;
        }
        .card:hover {
            border-color: #3b82f6;
            transform: translateY(-2px);
        }
        .card h3 {
            margin-top: 0;
            color: #3b82f6;
        }
    </style>
</head>
<body>
    <h1>🚀 KimiBuilt AI Platform</h1>
    <p>Choose your interface:</p>
    <div class="grid">
        <a href="/cli/README.md" class="card">
            <h3>💻 CLI</h3>
            <p>Terminal-based interface</p>
        </a>
        <a href="/web-chat/" class="card">
            <h3>💬 Web Chat</h3>
            <p>ChatGPT-style interface</p>
        </a>
        <a href="/canvas/" class="card">
            <h3>🎨 Canvas</h3>
            <p>Excalidraw-style whiteboard</p>
        </a>
        <a href="/notes/" class="card">
            <h3>📝 Notes</h3>
            <p>Notion-style editor</p>
        </a>
    </div>
</body>
</html>
    `);
});

// ---------------------
// API Routes
// ---------------------
app.use('/api/chat', chatRouter);
app.use('/api/canvas', canvasRouter);
app.use('/api/notation', notationRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/models', modelsRouter);
app.use('/api/images', imagesRouter);

// OpenAI-compatible endpoints
app.use('/v1', openaiCompatRouter);

// ---------------------
// Static Frontend Serving
// ---------------------
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/', (req, res) => {
    res.redirect('/web-chat/');
});

// ---------------------
// 404 handler
// ---------------------
app.use((_req, res) => {
    res.status(404).json({ error: { message: 'Not found' } });
});

// ---------------------
// Error handler
// ---------------------
app.use(errorHandler);

// ---------------------
// Create HTTP + WebSocket server
// ---------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
setupWebSocket(wss);

// ---------------------
// Start
// ---------------------
async function start() {
    try {
        // Initialize memory service (creates Qdrant collection if needed)
        console.log('[Boot] Initializing memory service...');
        await memoryService.initialize();
        console.log('[Boot] Memory service ready');
    } catch (err) {
        console.warn('[Boot] Memory service init failed (will retry on first use):', err.message);
    }

    server.listen(config.port, '0.0.0.0', () => {
        console.log(`
╔══════════════════════════════════════════════╗
║           KimiBuilt AI Backend               ║
╠══════════════════════════════════════════════╣
║  HTTP:    http://0.0.0.0:${config.port}               ║
║  WS:      ws://0.0.0.0:${config.port}/ws              ║
║  Health:  http://0.0.0.0:${config.port}/health         ║
╠══════════════════════════════════════════════╣
║  Model:   ${config.openai.model.padEnd(33)}║
║  Embed:   ${config.ollama.embedModel.padEnd(33)}║
║  Qdrant:  ${config.qdrant.url.padEnd(33)}║
╠══════════════════════════════════════════════╣
║  Custom Endpoints:                           ║
║  • /api/chat      • /api/models              ║
║  • /api/canvas    • /api/images              ║
║  • /api/notation  • /api/sessions            ║
╠══════════════════════════════════════════════╣
║  OpenAI-Compatible:                          ║
║  • /v1/chat/completions  • /v1/models        ║
║  • /v1/responses         • /v1/images/gen... ║
╚══════════════════════════════════════════════╝
    `);
    });
}

start();

module.exports = { app, server };
