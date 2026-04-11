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
const ttsRouter = require('./routes/tts');
const audioRouter = require('./routes/audio');
const { ttsService } = require('./tts/tts-service');
const imagesRouter = require('./routes/images');
const artifactsRouter = require('./routes/artifacts');
const { artifactService } = require('./artifacts/artifact-service');
const openaiCompatRouter = require('./routes/openai-compat');
const documentsRouter = require('./routes/documents');
const templatesRouter = require('./routes/templates');
const unsplashRouter = require('./routes/unsplash');
const adminRouter = require('./routes/admin');
const authRouter = require('./routes/auth');
const toolsRouter = require('./routes/tools');
const workloadsRouter = require('./routes/workloads');
const opencodeRouter = require('./routes/opencode');
const providerSessionsRouter = require('./routes/provider-sessions');
const DashboardController = require('./routes/admin/dashboard.controller');
const { getToolManager } = require('./agent-sdk/tools');
const { setDashboardController } = require('./admin/runtime-monitor');
const { getAuthenticatedUser, getSafeReturnTo, requireAuth } = require('./auth/service');
const { ConversationOrchestrator } = require('./conversation-orchestrator');
const { ConversationRunService } = require('./conversation-run-service');
const { AgentWorkloadService } = require('./workloads/service');
const { AgentWorkloadRunner } = require('./workloads/runner');
const { OpenCodeService } = require('./opencode/service');
const { ProviderSessionService } = require('./provider-session-service');
const { TemplateStore } = require('./template-store');

// Document Service
const { DocumentService } = require('./documents/document-service');
const { createResponse } = require('./openai-client');
const { extractResponseText } = require('./artifacts/artifact-service');

validate();

const app = express();
app.set('trust proxy', 1);

let startupState = {
    ready: false,
    startedAt: new Date().toISOString(),
};

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));

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

app.get('/live', (_req, res) => {
    res.status(200).json({
        status: 'live',
        timestamp: new Date().toISOString(),
    });
});

app.get('/ready', (_req, res) => {
    res.status(startupState.ready ? 200 : 503).json({
        status: startupState.ready ? 'ready' : 'starting',
        startedAt: startupState.startedAt,
        timestamp: new Date().toISOString(),
    });
});

const frontendPath = process.env.FRONTEND_PATH || path.join(__dirname, '../frontend');

function buildFrontendStaticOptions() {
    return {
        setHeaders(res, filePath) {
            if (String(filePath || '').toLowerCase().endsWith('.html')) {
                res.setHeader('Cache-Control', 'no-store');
                return;
            }

            res.setHeader('Cache-Control', 'no-cache');
        },
    };
}

app.get('/login', (req, res) => {
    const authState = getAuthenticatedUser(req);
    if (authState.authenticated) {
        return res.redirect(getSafeReturnTo(req.query.returnTo || '/'));
    }
    return res.sendFile(path.join(frontendPath, 'auth', 'login.html'));
});

app.use('/api/auth', authRouter);
app.use(requireAuth);

// Serve only the 4 active frontends
app.use('/web-chat', express.static(path.join(frontendPath, 'web-chat'), buildFrontendStaticOptions()));
app.use('/web-cli', express.static(path.join(frontendPath, 'web-cli'), buildFrontendStaticOptions()));
app.use('/notes', express.static(path.join(frontendPath, 'notes-notion'), buildFrontendStaticOptions()));
app.use('/canvas', express.static(path.join(frontendPath, 'canvas-excalidraw'), buildFrontendStaticOptions()));
app.use('/admin', express.static(path.join(frontendPath, 'agent-dashboard'), buildFrontendStaticOptions()));

app.get('/', (_req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>LillyBuilt AI</title>
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
    <h1>LillyBuilt AI Platform</h1>
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
            <p>Lilly-style note taking with AI</p>
        </a>
        <a href="/canvas/" class="card">
            <h3>Canvas</h3>
            <p>Visual canvas with Lilly drawing tools</p>
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
app.use('/api/tts', ttsRouter);
app.use('/api/audio', audioRouter);
app.use('/api/images', imagesRouter);
app.use('/api/artifacts', artifactsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/unsplash', unsplashRouter);
app.use('/v1', openaiCompatRouter);
app.use('/api/admin', adminRouter);
app.use('/api/admin', providerSessionsRouter);
app.use('/admin', providerSessionsRouter);
app.use('/api/tools', toolsRouter);
app.use('/api', workloadsRouter);
app.use('/api', opencodeRouter);

app.use(express.static(path.join(__dirname, '../frontend'), buildFrontendStaticOptions()));

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
        
        console.log('[Boot] Initializing template store...');
        const templateStore = new TemplateStore();
        await templateStore.initialize();
        app.locals.templateStore = templateStore;
        console.log('[Boot] Template store ready');

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
                    reasoningEffort: options.reasoningEffort || null,
                });

                return extractResponseText(response);
            },
        };
        openaiClient.responses = {
            create: async (params = {}) => createResponse({
                input: params.input || params.messages || '',
                stream: Boolean(params.stream),
                model: params.model || null,
                reasoningEffort: params.reasoning?.effort || params.reasoning_effort || null,
            }),
        };
        openaiClient.chat = {
            completions: {
                create: async (params = {}) => {
                    const response = await createResponse({
                        input: params.messages || params.input || '',
                        stream: Boolean(params.stream),
                        model: params.model || null,
                        reasoningEffort: params.reasoning_effort || params.reasoning?.effort || null,
                    });
                    const content = extractResponseText(response);

                    return {
                        id: response.id,
                        object: 'chat.completion',
                        created: response.created || Math.floor(Date.now() / 1000),
                        model: response.model || params.model || null,
                        choices: [{
                            index: 0,
                            message: {
                                role: 'assistant',
                                content,
                            },
                            finish_reason: 'stop',
                        }],
                    };
                },
            },
        };
        const documentService = new DocumentService(openaiClient);
        app.locals.documentService = documentService;
        app.locals.artifactService = artifactService;
        console.log('[Boot] Document service ready');

        console.log('[Boot] Initializing conversation orchestrator...');
        const conversationOrchestrator = new ConversationOrchestrator({
            llmClient: openaiClient,
            toolManager,
            sessionStore,
            memoryService,
            embedder,
            vectorStore,
        });
        console.log('[Boot] Conversation orchestrator ready');

        app.locals.conversationOrchestrator = conversationOrchestrator;
        app.locals.opencodeService = new OpenCodeService({
            sessionStore,
        });
        app.locals.providerSessionService = new ProviderSessionService();
        app.locals.conversationRunService = new ConversationRunService({
            app,
            sessionStore,
            memoryService,
        });
        app.locals.agentWorkloadService = new AgentWorkloadService({
            sessionStore,
            conversationRunService: app.locals.conversationRunService,
        });
        app.locals.agentWorkloadRunner = new AgentWorkloadRunner({
            workloadService: app.locals.agentWorkloadService,
        });
        app.locals.agentWorkloadRunner.start();
        app.locals.dashboardController = new DashboardController(conversationOrchestrator);
        setDashboardController(app.locals.dashboardController);
        const ttsConfig = ttsService.getPublicConfig();
        console.log(`[Boot] TTS ${ttsConfig.provider || 'unknown'} ${ttsConfig.diagnostics?.status || 'unknown'}: ${ttsConfig.diagnostics?.message || 'No details available.'}`);
        startupState.ready = true;
    } catch (err) {
        console.warn('[Boot] Service init failed (will retry on first use):', err.message);
        startupState.ready = true;
    }

    server.listen(config.port, '0.0.0.0', () => {
        console.log(`LillyBuilt AI backend listening on http://0.0.0.0:${config.port}`);
    });
}

start();

module.exports = { app, server };
