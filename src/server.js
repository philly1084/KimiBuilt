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
const { sessionStore } = require('./session-store');

const chatRouter = require('./routes/chat');
const canvasRouter = require('./routes/canvas');
const notationRouter = require('./routes/notation');
const sessionsRouter = require('./routes/sessions');
const modelsRouter = require('./routes/models');
const imagesRouter = require('./routes/images');
const artifactsRouter = require('./routes/artifacts');
const openaiCompatRouter = require('./routes/openai-compat');
const documentsRouter = require('./routes/documents');
const unsplashRouter = require('./routes/unsplash');
const adminRouter = require('./routes/admin');
const toolsRouter = require('./routes/tools');
const DashboardController = require('./routes/admin/dashboard.controller');
const { getToolManager } = require('./agent-sdk/tools');
const { setDashboardController } = require('./admin/runtime-monitor');
const { ToolDefinition, ToolSideEffect } = require('./agent-sdk/tools/ToolDefinition');

// Document Service
const { DocumentService } = require('./documents/document-service');
const { createResponse } = require('./openai-client');

validate();

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));

function mapToolSideEffects(sideEffects = []) {
    const effectMap = {
        read: ToolSideEffect.READ,
        write: ToolSideEffect.WRITE,
        network: ToolSideEffect.NETWORK,
        execute: ToolSideEffect.EXECUTE,
        none: ToolSideEffect.NONE,
    };

    return (Array.isArray(sideEffects) ? sideEffects : [])
        .map((effect) => effectMap[String(effect || '').toLowerCase()])
        .filter(Boolean);
}

function registerUnifiedToolsWithOrchestrator(orchestrator, toolManager) {
    if (!orchestrator || !toolManager?.registry) {
        return 0;
    }

    let registeredCount = 0;
    const registryTools = toolManager.registry.getAllTools();

    registryTools.forEach((tool) => {
        if (!tool?.id || typeof tool?.backend?.handler !== 'function') {
            return;
        }

        if (orchestrator.toolRegistry.has(tool.id)) {
            return;
        }

        orchestrator.registerTool(new ToolDefinition({
            id: tool.id,
            name: tool.name || tool.id,
            description: tool.description || '',
            inputSchema: tool.inputSchema || { type: 'object', properties: {} },
            outputSchema: tool.outputSchema || { type: 'object', properties: {} },
            sideEffects: mapToolSideEffects(tool.backend.sideEffects),
            handler: async (input, context = {}) => {
                const result = await toolManager.executeTool(tool.id, input, context);
                if (!result?.success) {
                    throw new Error(result?.error || `Tool ${tool.id} failed`);
                }
                return result.data;
            },
            timeout: tool.backend.timeout || 30000,
        }));

        registeredCount += 1;
    });

    return registeredCount;
}

app.get('/health', async (_req, res) => {
    const checks = {
        server: 'ok',
        qdrant: 'unknown',
        ollama: 'unknown',
        postgres: 'unknown',
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

    if (!sessionStore.isPersistent()) {
        checks.postgres = 'disabled';
    } else {
        try {
            checks.postgres = (await sessionStore.healthCheck()) ? 'ok' : 'down';
        } catch {
            checks.postgres = 'down';
        }
    }

    const allOk = Object.values(checks).every((value) => value === 'ok' || value === 'disabled');
    res.status(allOk ? 200 : 503).json({
        status: allOk ? 'healthy' : 'degraded',
        components: checks,
        timestamp: new Date().toISOString(),
    });
});

const frontendPath = process.env.FRONTEND_PATH || path.join(__dirname, '../frontend');
// Serve only the 4 active frontends
app.use('/web-chat', express.static(path.join(frontendPath, 'web-chat')));
app.use('/web-cli', express.static(path.join(frontendPath, 'web-cli')));
app.use('/notes', express.static(path.join(frontendPath, 'notes-notion')));
app.use('/canvas', express.static(path.join(frontendPath, 'canvas-excalidraw')));
app.use('/admin', express.static(path.join(frontendPath, 'agent-dashboard')));

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
    <h1>KimiBuilt AI Platform</h1>
    <p>Choose your interface:</p>
    <div class="grid">
        <a href="/web-chat/" class="card">
            <h3>Web Chat</h3>
            <p>ChatGPT-style interface</p>
        </a>
        <a href="/web-cli/" class="card">
            <h3>Web CLI</h3>
            <p>Terminal-style AI interface</p>
        </a>
        <a href="/notes/" class="card">
            <h3>Notes</h3>
            <p>Notion-style note taking with AI</p>
        </a>
        <a href="/canvas/" class="card">
            <h3>Canvas</h3>
            <p>Visual canvas with Excalidraw integration</p>
        </a>
        <a href="/admin/" class="card" style="border-color: #22c55e;">
            <h3>🎛️ Admin Dashboard</h3>
            <p>Agent SDK control and monitoring</p>
        </a>
    </div>
</body>
</html>
    `);
});

app.use('/api/chat', chatRouter);
app.use('/api/canvas', canvasRouter);
app.use('/api/notation', notationRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/models', modelsRouter);
app.use('/api/images', imagesRouter);
app.use('/api/artifacts', artifactsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/unsplash', unsplashRouter);
app.use('/v1', openaiCompatRouter);
app.use('/api/admin', adminRouter);
app.use('/api/tools', toolsRouter);

app.use(express.static(path.join(__dirname, '../frontend')));

app.use((_req, res) => {
    res.status(404).json({ error: { message: 'Not found' } });
});

app.use(errorHandler);

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
setupWebSocket(wss, app);

async function start() {
    try {
        console.log('[Boot] Initializing session store...');
        await sessionStore.initialize();
        console.log('[Boot] Session store ready');

        console.log('[Boot] Initializing memory service...');
        await memoryService.initialize();
        console.log('[Boot] Memory service ready');

        console.log('[Boot] Initializing tool platform...');
        const toolManager = getToolManager();
        await toolManager.initialize();
        app.locals.toolManager = toolManager;
        console.log(`[Boot] Tool platform ready (${toolManager.registry.getAllTools().length} tools)`);
        
        console.log('[Boot] Initializing document service...');
        // Create OpenAI-compatible client for document generation
        const openaiClient = {
            createResponse: async (params) => {
                return createResponse(params);
            },
            complete: async (prompt, options = {}) => {
                const response = await createResponse({
                    input: prompt,
                    stream: false,
                    model: options.model || null,
                });

                return response.output
                    .filter((item) => item.type === 'message')
                    .map((item) => item.content.map((content) => content.text).join(''))
                    .join('\n');
            }
        };
        const documentService = new DocumentService(openaiClient);
        app.locals.documentService = documentService;
        console.log('[Boot] Document service ready');

        console.log('[Boot] Initializing Agent SDK...');
        let agentOrchestrator = null;

        try {
            const { AgentOrchestrator } = require('./agent-sdk');
            agentOrchestrator = new AgentOrchestrator({
                llmClient: openaiClient,
                embedder: embedder,
                vectorStore: vectorStore,
                config: {
                    enableTracing: true,
                    enableSkills: true
                }
            });
            const registeredTools = registerUnifiedToolsWithOrchestrator(agentOrchestrator, toolManager);
            console.log(`[Boot] Agent SDK ready (${registeredTools} tools registered)`);
        } catch (sdkError) {
            console.warn('[Boot] Agent SDK disabled:', sdkError.message);
        }

        app.locals.agentOrchestrator = agentOrchestrator;
        app.locals.dashboardController = new DashboardController(agentOrchestrator);
        setDashboardController(app.locals.dashboardController);
    } catch (err) {
        console.warn('[Boot] Service init failed (will retry on first use):', err.message);
    }

    server.listen(config.port, '0.0.0.0', () => {
        console.log(`KimiBuilt AI backend listening on http://0.0.0.0:${config.port}`);
    });
}

start();

module.exports = { app, server };
