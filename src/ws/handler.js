const { sessionStore } = require('../session-store');
const { memoryService } = require('../memory/memory-service');
const { ensureRuntimeToolManager } = require('../runtime-tool-manager');
const { executeConversationRuntime, resolveConversationExecutorFlag } = require('../runtime-execution');
const {
    buildInstructionsWithArtifacts,
    maybeGenerateOutputArtifact,
    generateOutputArtifactFromPrompt,
    resolveSshRequestContext,
    formatSshToolResult,
    extractSshSessionMetadataFromToolEvents,
    inferOutputFormatFromSession,
    resolveArtifactContextIds,
} = require('../ai-route-utils');
const { startRuntimeTask, completeRuntimeTask, failRuntimeTask } = require('../admin/runtime-monitor');
const { getAuthenticatedUser, isAuthEnabled } = require('../auth/service');
const { buildProjectMemoryUpdate, mergeProjectMemory } = require('../project-memory');

// Admin dashboard event emitter
const EventEmitter = require('events');
const adminEvents = new EventEmitter();

// Store admin dashboard connections
const adminConnections = new Set();

async function updateSessionProjectMemory(sessionId, updates = {}) {
    if (!sessionId) {
        return null;
    }

    const session = await sessionStore.get(sessionId);
    if (!session) {
        return null;
    }

    return sessionStore.update(sessionId, {
        metadata: {
            projectMemory: mergeProjectMemory(
                session?.metadata?.projectMemory || {},
                buildProjectMemoryUpdate(updates),
            ),
        },
    });
}

function inferOutputFormatFromText(text = '') {
    const normalized = String(text || '').toLowerCase();
    const checks = [
        ['power-query', /\b(power\s*query|\.(pq|m)\b)/],
        ['xlsx', /\b(xlsx|spreadsheet|excel|workbook)\b/],
        ['pdf', /\bpdf\b/],
        ['docx', /\b(docx|word document)\b/],
        ['xml', /\bxml\b/],
        ['mermaid', /\bmermaid\b/],
        ['html', /\bhtml\b/],
    ];

    return checks.find(([, pattern]) => pattern.test(normalized))?.[0] || null;
}

function setupWebSocket(wss, app = null) {
    wss.on('connection', (ws, req) => {
        ws.app = app;
        if (isAuthEnabled()) {
            const authState = getAuthenticatedUser(req);
            if (!authState.authenticated) {
                ws.close(4401, 'Authentication required');
                return;
            }
            ws.user = authState.user;
        }

        console.log('[WS] Client connected');

        ws.on('message', async (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                const { type, payload } = msg;
                let { sessionId } = msg;

                let session;
                if (!sessionId) {
                    session = await sessionStore.create({ mode: type, transport: 'ws' });
                    sessionId = session.id;
                    ws.send(JSON.stringify({ type: 'session_created', sessionId }));
                } else {
                    session = await sessionStore.getOrCreate(sessionId, { mode: type, transport: 'ws' });
                }

                if (!session) {
                    session = await sessionStore.get(sessionId);
                }
                if (!session) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
                    return;
                }

                switch (type) {
                    case 'chat':
                        await handleChat(ws, session, payload, app?.locals?.toolManager || null);
                        break;
                    case 'canvas':
                        await handleCanvas(ws, session, payload);
                        break;
                    case 'notation':
                        await handleNotation(ws, session, payload);
                        break;
                    case 'admin_subscribe':
                        handleAdminSubscribe(ws);
                        break;
                    case 'admin_unsubscribe':
                        handleAdminUnsubscribe(ws);
                        break;
                    default:
                        ws.send(JSON.stringify({ type: 'error', message: `Unknown type: ${type}` }));
                }
            } catch (err) {
                console.error('[WS] Error:', err.message);
                ws.send(JSON.stringify({ type: 'error', message: err.message }));
            }
        });

        ws.on('close', () => {
            console.log('[WS] Client disconnected');
        });
    });
}

async function handleChat(ws, session, payload = {}, toolManager = null) {
    let runtimeTask = null;
    const startedAt = Date.now();
    const { message, model = null, artifactIds = [], outputFormat = null, executionProfile = null } = payload;
    const enableConversationExecutor = resolveConversationExecutorFlag(payload);
    if (!message) {
        ws.send(JSON.stringify({ type: 'error', message: "'message' is required" }));
        return;
    }

    const sshContext = resolveSshRequestContext(message, session);
    const effectiveMessage = sshContext.effectivePrompt || message;
    const effectiveOutputFormat = outputFormat
        || inferOutputFormatFromText(message)
        || inferOutputFormatFromSession(message, session);
    const effectiveArtifactIds = resolveArtifactContextIds(session, artifactIds);
    runtimeTask = startRuntimeTask({
        sessionId: session.id,
        input: message,
        model,
        mode: 'chat',
        transport: 'ws',
        metadata: { route: '/ws', stream: true, phase: 'preflight' },
    });

    try {
        const runtimeToolManager = toolManager || await ensureRuntimeToolManager(ws.app);

        if (sshContext.directParams) {
            const sshResult = await runtimeToolManager.executeTool('ssh-execute', sshContext.directParams, {
                sessionId: session.id,
                route: '/ws',
                transport: 'ws',
                toolManager: runtimeToolManager,
            });
            const assistantMessage = formatSshToolResult(sshResult, sshContext.target);
            await sessionStore.update(session.id, {
                metadata: {
                    lastToolIntent: 'ssh-execute',
                    ...(sshContext.target?.host ? {
                        lastSshTarget: {
                            host: sshContext.target.host,
                            username: sshContext.target.username || '',
                            port: sshContext.target.port || 22,
                        },
                    } : {}),
                },
            });
            memoryService.rememberResponse(session.id, assistantMessage);
            await sessionStore.appendMessages(session.id, [
                { role: 'user', content: message },
                { role: 'assistant', content: assistantMessage },
            ]);
            await updateSessionProjectMemory(session.id, {
                userText: message,
                assistantText: assistantMessage,
                toolEvents: [{
                    toolCall: { function: { name: 'ssh-execute' } },
                    result: {
                        success: sshResult?.success !== false,
                        toolId: 'ssh-execute',
                        data: sshResult?.data,
                        error: sshResult?.error || null,
                    },
                    reason: 'Direct SSH execution',
                }],
            });
            completeRuntimeTask(runtimeTask?.id, {
                responseId: `tool-ssh-${Date.now()}`,
                output: assistantMessage,
                model: model || null,
                duration: Date.now() - startedAt,
                metadata: {
                    directTool: 'ssh-execute',
                    toolEvents: [{
                        toolCall: { function: { name: 'ssh-execute', arguments: JSON.stringify(sshContext.directParams || {}) } },
                        result: {
                            success: sshResult?.success !== false,
                            toolId: 'ssh-execute',
                            duration: sshResult?.duration || 0,
                            data: sshResult?.data,
                            error: sshResult?.error || null,
                            timestamp: sshResult?.timestamp || new Date().toISOString(),
                        },
                        reason: 'Direct SSH execution',
                    }],
                },
            });
            ws.send(JSON.stringify({ type: 'delta', content: assistantMessage }));
            ws.send(JSON.stringify({
                type: 'done',
                sessionId: session.id,
                responseId: null,
                artifacts: [],
            }));
            return;
        }

        if (effectiveOutputFormat) {
            const generation = await generateOutputArtifactFromPrompt({
                sessionId: session.id,
                session,
                mode: 'chat',
                outputFormat: effectiveOutputFormat,
                prompt: message,
                artifactIds: effectiveArtifactIds,
                model,
            });

            await sessionStore.recordResponse(session.id, generation.responseId);
            await sessionStore.update(session.id, {
                metadata: {
                    lastOutputFormat: effectiveOutputFormat,
                    lastGeneratedArtifactId: generation.artifact.id,
                },
            });
            memoryService.rememberResponse(session.id, generation.assistantMessage);
            await sessionStore.appendMessages(session.id, [
                { role: 'user', content: message },
                { role: 'assistant', content: generation.assistantMessage },
            ]);
            await updateSessionProjectMemory(session.id, {
                userText: message,
                assistantText: generation.assistantMessage,
                artifacts: generation.artifacts,
            });

            completeRuntimeTask(runtimeTask?.id, {
                responseId: generation.responseId,
                output: generation.assistantMessage,
                model: model || null,
                duration: Date.now() - startedAt,
                metadata: { outputFormat: effectiveOutputFormat, artifactDirect: true },
            });

            ws.send(JSON.stringify({ type: 'delta', content: generation.assistantMessage }));
            ws.send(JSON.stringify({
                type: 'done',
                sessionId: session.id,
                responseId: generation.responseId,
                artifacts: generation.artifacts,
            }));
            return;
        }

        const instructions = await buildInstructionsWithArtifacts(
            session,
            'You are a helpful AI assistant. Use the recent session transcript as the primary context for follow-up references like "that", "again", or "same as before". Use recalled memory only as supplemental context. Follow the user\'s current request directly instead of defaulting to document or business-workflow tasks unless they ask for that. For substantial writing tasks such as reports, briefs, plans, specs, pages, or polished notes, work in passes: identify sections, expand the sections, then polish the full result before replying. Be concise and informative.',
            effectiveArtifactIds,
        );
        const execution = await executeConversationRuntime(ws.app, {
            input: effectiveMessage,
            sessionId: session.id,
            memoryInput: message,
            previousResponseId: session.previousResponseId,
            instructions,
            stream: true,
            model,
            toolManager: runtimeToolManager,
            toolContext: {
                sessionId: session.id,
                route: '/ws',
                transport: 'ws',
            },
            executionProfile,
            enableAutomaticToolCalls: true,
            enableConversationExecutor,
            taskType: 'chat',
        });
        const response = execution.response;

        let fullText = '';

        for await (const event of response) {
            if (event.type === 'response.output_text.delta') {
                fullText += event.delta;
                ws.send(JSON.stringify({ type: 'delta', content: event.delta }));
            }

            if (event.type === 'response.completed') {
                if (!execution.handledPersistence) {
                    await sessionStore.recordResponse(session.id, event.response.id);
                    memoryService.rememberResponse(session.id, fullText);
                    await sessionStore.appendMessages(session.id, [
                        { role: 'user', content: message },
                        { role: 'assistant', content: fullText },
                    ]);
                }
                const sshMetadata = extractSshSessionMetadataFromToolEvents(event.response?.metadata?.toolEvents);
                if (sshMetadata) {
                    await sessionStore.update(session.id, { metadata: sshMetadata });
                }
                const artifacts = await maybeGenerateOutputArtifact({
                    sessionId: session.id,
                    session,
                    mode: 'chat',
                    outputFormat: effectiveOutputFormat,
                    content: fullText,
                    prompt: message,
                    title: 'chat-output',
                    responseId: event.response.id,
                    artifactIds,
                    model,
                });
                await updateSessionProjectMemory(session.id, {
                    userText: message,
                    assistantText: fullText,
                    toolEvents: event.response?.metadata?.toolEvents || [],
                    artifacts,
                });
                completeRuntimeTask(runtimeTask?.id, {
                    responseId: event.response.id,
                    output: fullText,
                    model: event.response.model || model || null,
                    duration: Date.now() - startedAt,
                    metadata: event.response?.metadata || {},
                });
                ws.send(JSON.stringify({
                    type: 'done',
                    sessionId: session.id,
                    responseId: event.response.id,
                    artifacts,
                }));
            }
        }
    } catch (error) {
        failRuntimeTask(runtimeTask?.id, {
            error,
            duration: Date.now() - startedAt,
            model,
        });
        throw error;
    }
}

async function handleCanvas(ws, session, payload = {}) {
    let runtimeTask = null;
    const startedAt = Date.now();
    const {
        message,
        canvasType = 'document',
        existingContent = '',
        model = null,
        artifactIds = [],
        outputFormat = null,
        executionProfile = null,
    } = payload;
    const enableConversationExecutor = resolveConversationExecutorFlag(payload);

    if (!message) {
        ws.send(JSON.stringify({ type: 'error', message: "'message' is required" }));
        return;
    }

    runtimeTask = startRuntimeTask({
        sessionId: session.id,
        input: message,
        model,
        mode: 'canvas',
        transport: 'ws',
        metadata: { route: '/ws', canvasType, phase: 'preflight' },
    });

    try {
        const instructions = await buildInstructionsWithArtifacts(
            session,
            `You are an AI canvas assistant generating ${canvasType} content. Respond with valid JSON: { "content": "...", "metadata": {...}, "suggestions": [...] }${existingContent ? `\n\nExisting content:\n${existingContent}` : ''}`,
            artifactIds,
        );
        const execution = await executeConversationRuntime(ws.app, {
            input: existingContent ? `${message}\n\nExisting content:\n${existingContent}` : message,
            sessionId: session.id,
            memoryInput: message,
            previousResponseId: session.previousResponseId,
            instructions,
            stream: false,
            model,
            executionProfile,
            enableConversationExecutor,
            taskType: 'canvas',
        });
        const response = execution.response;
        if (!execution.handledPersistence) {
            await sessionStore.recordResponse(session.id, response.id);
        }

        const outputText = response.output
            .filter((item) => item.type === 'message')
            .map((item) => item.content.map((content) => content.text).join(''))
            .join('\n');
        if (!execution.handledPersistence) {
            memoryService.rememberResponse(session.id, outputText);
            await sessionStore.appendMessages(session.id, [
                { role: 'user', content: message },
                { role: 'assistant', content: outputText },
            ]);
        }
        const artifacts = await maybeGenerateOutputArtifact({
            sessionId: session.id,
            session,
            mode: 'canvas',
            outputFormat,
            content: outputText,
            prompt: message,
            title: `canvas-${canvasType}`,
            responseId: response.id,
            artifactIds,
            existingContent,
            model,
        });
        completeRuntimeTask(runtimeTask?.id, {
            responseId: response.id,
            output: outputText,
            model: response.model || model || null,
            duration: Date.now() - startedAt,
            metadata: {
                canvasType,
                ...(response?.metadata || {}),
            },
        });

        ws.send(JSON.stringify({
            type: 'done',
            sessionId: session.id,
            responseId: response.id,
            canvasType,
            content: outputText,
            artifacts,
        }));
    } catch (error) {
        failRuntimeTask(runtimeTask?.id, {
            error,
            duration: Date.now() - startedAt,
            model,
            metadata: { canvasType },
        });
        throw error;
    }
}

async function handleNotation(ws, session, payload = {}) {
    let runtimeTask = null;
    const startedAt = Date.now();
    const {
        notation,
        helperMode = 'expand',
        context = '',
        model = null,
        artifactIds = [],
        outputFormat = null,
        executionProfile = null,
    } = payload;
    const enableConversationExecutor = resolveConversationExecutorFlag(payload);

    if (!notation) {
        ws.send(JSON.stringify({ type: 'error', message: "'notation' is required" }));
        return;
    }

    runtimeTask = startRuntimeTask({
        sessionId: session.id,
        input: notation,
        model,
        mode: 'notation',
        transport: 'ws',
        metadata: { route: '/ws', helperMode, phase: 'preflight' },
    });

    try {
        const instructions = await buildInstructionsWithArtifacts(
            session,
            `You are an AI notation helper in ${helperMode} mode. Respond with valid JSON: { "result": "...", "annotations": [...], "suggestions": [...] }${context ? `\nContext: ${context}` : ''}`,
            artifactIds,
        );
        const execution = await executeConversationRuntime(ws.app, {
            input: notation,
            sessionId: session.id,
            memoryInput: notation,
            previousResponseId: session.previousResponseId,
            instructions,
            stream: false,
            model,
            executionProfile,
            enableConversationExecutor,
            taskType: 'notation',
        });
        const response = execution.response;
        if (!execution.handledPersistence) {
            await sessionStore.recordResponse(session.id, response.id);
        }

        const outputText = response.output
            .filter((item) => item.type === 'message')
            .map((item) => item.content.map((content) => content.text).join(''))
            .join('\n');
        if (!execution.handledPersistence) {
            memoryService.rememberResponse(session.id, outputText);
            await sessionStore.appendMessages(session.id, [
                { role: 'user', content: notation },
                { role: 'assistant', content: outputText },
            ]);
        }
        const artifacts = await maybeGenerateOutputArtifact({
            sessionId: session.id,
            session,
            mode: 'notation',
            outputFormat,
            content: outputText,
            prompt: notation,
            title: `notation-${helperMode}`,
            responseId: response.id,
            artifactIds,
            existingContent: context,
            model,
        });
        completeRuntimeTask(runtimeTask?.id, {
            responseId: response.id,
            output: outputText,
            model: response.model || model || null,
            duration: Date.now() - startedAt,
            metadata: {
                helperMode,
                ...(response?.metadata || {}),
            },
        });

        ws.send(JSON.stringify({
            type: 'done',
            sessionId: session.id,
            responseId: response.id,
            helperMode,
            content: outputText,
            artifacts,
        }));
    } catch (error) {
        failRuntimeTask(runtimeTask?.id, {
            error,
            duration: Date.now() - startedAt,
            model,
            metadata: { helperMode },
        });
        throw error;
    }
}

// Admin WebSocket handlers
function handleAdminSubscribe(ws) {
    adminConnections.add(ws);
    ws.isAdmin = true;
    
    // Send initial stats
    ws.send(JSON.stringify({
        type: 'admin_connected',
        timestamp: new Date().toISOString()
    }));
    
    console.log(`[WS] Admin client subscribed. Total: ${adminConnections.size}`);
}

function handleAdminUnsubscribe(ws) {
    adminConnections.delete(ws);
    ws.isAdmin = false;
    console.log(`[WS] Admin client unsubscribed. Total: ${adminConnections.size}`);
}

// Broadcast to all admin connections
function broadcastToAdmins(data) {
    const message = JSON.stringify(data);
    adminConnections.forEach(ws => {
        if (ws.readyState === 1) { // WebSocket.OPEN
            ws.send(message);
        }
    });
}

// Admin event helpers
function emitTaskEvent(eventType, data) {
    broadcastToAdmins({
        type: 'task_event',
        event: eventType,
        data,
        timestamp: new Date().toISOString()
    });
}

function emitLogEvent(logEntry) {
    broadcastToAdmins({
        type: 'log_event',
        data: logEntry,
        timestamp: new Date().toISOString()
    });
}

function emitStatsUpdate(stats) {
    broadcastToAdmins({
        type: 'stats_update',
        data: stats,
        timestamp: new Date().toISOString()
    });
}

module.exports = { 
    setupWebSocket,
    adminEvents,
    broadcastToAdmins,
    emitTaskEvent,
    emitLogEvent,
    emitStatsUpdate
};
