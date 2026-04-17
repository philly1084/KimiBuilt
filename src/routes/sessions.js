const { Router } = require('express');
const { sessionStore } = require('../session-store');
const { memoryService } = require('../memory/memory-service');
const { artifactService } = require('../artifacts/artifact-service');
const { mergeRuntimeArtifacts } = require('../runtime-artifacts');
const { abortForegroundRequest } = require('../foreground-request-registry');
const { cancelForegroundTurn, resolveForegroundTurn } = require('../foreground-turn-state');
const {
    buildScopedSessionMetadata,
    hasSessionScopeHints,
    resolveSessionScope,
} = require('../session-scope');

const router = Router();

function getRequestOwnerId(req) {
    return String(req.user?.username || '').trim() || null;
}

function normalizeSessionId(value = null) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function extractScopeHints(source = {}) {
    const value = source && typeof source === 'object' && !Array.isArray(source)
        ? source
        : {};

    return {
        clientSurface: value.clientSurface,
        client_surface: value.client_surface,
        taskType: value.taskType,
        task_type: value.task_type,
        mode: value.mode,
        memoryScope: value.memoryScope,
        memory_scope: value.memory_scope,
        projectScope: value.projectScope,
        project_scope: value.project_scope,
        projectId: value.projectId,
        project_id: value.project_id,
        projectKey: value.projectKey,
        project_key: value.project_key,
        workspaceId: value.workspaceId,
        workspace_id: value.workspace_id,
        workspaceKey: value.workspaceKey,
        workspace_key: value.workspace_key,
        namespace: value.namespace,
    };
}

function buildSessionMetadataFromRequest(source = {}, metadata = {}) {
    return buildScopedSessionMetadata({
        ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}),
        ...extractScopeHints(source),
    });
}

function getRequestedScopeKey(source = {}) {
    const metadata = source?.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
        ? source.metadata
        : {};
    const scopeInput = {
        ...extractScopeHints(source),
        metadata,
    };

    return hasSessionScopeHints(scopeInput)
        ? resolveSessionScope(scopeInput)
        : null;
}

function extractArtifactsFromMessages(messages = []) {
    const artifactSets = (Array.isArray(messages) ? messages : [])
        .flatMap((message) => {
            if (!message || typeof message !== 'object') {
                return [];
            }

            const sets = [];
            if (Array.isArray(message.artifacts) && message.artifacts.length > 0) {
                sets.push(message.artifacts);
            }
            if (Array.isArray(message.metadata?.artifacts) && message.metadata.artifacts.length > 0) {
                sets.push(message.metadata.artifacts);
            }
            return sets;
        });

    return mergeRuntimeArtifacts(...artifactSets);
}

router.post('/', async (req, res, next) => {
    try {
        const ownerId = getRequestOwnerId(req);
        const { metadata } = req.body || {};
        const session = await sessionStore.create({
            ...buildSessionMetadataFromRequest(req.body || {}, metadata || {}),
            ownerId,
        });
        await sessionStore.setActiveSession(ownerId, session.id, session?.metadata?.memoryScope || null);
        res.status(201).json(session);
    } catch (err) {
        next(err);
    }
});

router.get('/', async (req, res, next) => {
    try {
        const ownerId = getRequestOwnerId(req);
        const scopeKey = getRequestedScopeKey(req.query || {});
        const sessions = await sessionStore.list({
            ownerId,
            ...(scopeKey ? { scopeKey } : {}),
        });
        const workloadService = req.app?.locals?.agentWorkloadService;
        const summaries = workloadService?.isAvailable?.()
            ? await workloadService.getSessionSummaries(
                sessions.map((session) => session.id),
                ownerId,
            )
            : {};
        const enrichedSessions = sessions.map((session) => ({
            ...session,
            workloadSummary: summaries[session.id] || {
                queued: 0,
                running: 0,
                failed: 0,
            },
        }));
        const activeSession = await sessionStore.getActiveOwnedSession(ownerId, scopeKey);
        res.json({
            sessions: enrichedSessions,
            count: enrichedSessions.length,
            activeSessionId: activeSession?.id || null,
        });
    } catch (err) {
        next(err);
    }
});

router.get('/state', async (req, res, next) => {
    try {
        const ownerId = getRequestOwnerId(req);
        const scopeKey = getRequestedScopeKey(req.query || {});
        const activeSession = await sessionStore.getActiveOwnedSession(ownerId, scopeKey);
        res.json({
            activeSessionId: activeSession?.id || null,
            session: activeSession,
        });
    } catch (err) {
        next(err);
    }
});

router.put('/state', async (req, res, next) => {
    try {
        const ownerId = getRequestOwnerId(req);
        const activeSessionId = normalizeSessionId(req.body?.activeSessionId);
        const scopeKey = getRequestedScopeKey(req.body || {});

        if (activeSessionId) {
            const session = await sessionStore.getOwned(activeSessionId, ownerId);
            if (!session) {
                return res.status(404).json({ error: { message: 'Session not found' } });
            }
        }

        await sessionStore.setActiveSession(ownerId, activeSessionId, scopeKey);
        const activeSession = await sessionStore.getActiveOwnedSession(ownerId, scopeKey);

        res.json({
            activeSessionId: activeSession?.id || null,
            session: activeSession,
        });
    } catch (err) {
        next(err);
    }
});

router.get('/:id/artifacts', async (req, res, next) => {
    try {
        const session = await sessionStore.getOwned(req.params.id, getRequestOwnerId(req));
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }

        const canListStoredArtifacts = typeof sessionStore.isPersistent === 'function'
            ? sessionStore.isPersistent()
            : false;
        const [storedArtifacts, messages] = await Promise.all([
            canListStoredArtifacts
                ? artifactService.listSessionArtifacts(req.params.id)
                : Promise.resolve([]),
            sessionStore.listMessages(req.params.id, 500, getRequestOwnerId(req)),
        ]);
        const artifacts = mergeRuntimeArtifacts(
            storedArtifacts,
            extractArtifactsFromMessages(messages),
        );
        res.json({ sessionId: req.params.id, artifacts, count: artifacts.length });
    } catch (err) {
        next(err);
    }
});

router.get('/:id/messages', async (req, res, next) => {
    try {
        const limit = Number(req.query?.limit || 100);
        const session = await sessionStore.getOwned(req.params.id, getRequestOwnerId(req));
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }

        const messages = await sessionStore.listMessages(
            req.params.id,
            Number.isFinite(limit) ? Math.max(1, Math.min(limit, 500)) : 100,
            getRequestOwnerId(req),
        );
        res.json({ sessionId: req.params.id, messages, count: messages.length });
    } catch (err) {
        next(err);
    }
});

router.post('/:id/messages', async (req, res, next) => {
    try {
        const session = await sessionStore.getOwned(req.params.id, getRequestOwnerId(req));
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }

        const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
        if (messages.length === 0) {
            return res.status(400).json({ error: { message: 'messages[] is required' } });
        }

        await sessionStore.appendMessages(req.params.id, messages);
        await sessionStore.update(req.params.id, {});
        res.status(204).end();
    } catch (err) {
        next(err);
    }
});

router.put('/:id/messages/:messageId', async (req, res, next) => {
    try {
        const session = await sessionStore.getOwned(req.params.id, getRequestOwnerId(req));
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }

        const message = req.body?.message && typeof req.body.message === 'object'
            ? req.body.message
            : null;
        if (!message) {
            return res.status(400).json({ error: { message: 'message is required' } });
        }

        const savedMessage = await sessionStore.upsertMessage(req.params.id, {
            ...message,
            id: req.params.messageId,
        });

        if (!savedMessage) {
            return res.status(400).json({ error: { message: 'Unable to persist message' } });
        }

        await sessionStore.update(req.params.id, {});
        res.json({ sessionId: req.params.id, message: savedMessage });
    } catch (err) {
        next(err);
    }
});

router.post('/:id/foreground/cancel', async (req, res, next) => {
    try {
        const ownerId = getRequestOwnerId(req);
        const session = await sessionStore.getOwned(req.params.id, ownerId);
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }

        const requestedRequestId = normalizeSessionId(
            req.body?.requestId
            || req.body?.foregroundRequestId
            || req.body?.foreground_request_id,
        );
        const persistedTurn = resolveForegroundTurn(
            session,
            {},
            session?.metadata?.clientSurface || session?.metadata?.memoryScope || 'web-chat',
        );
        const matchingPersistedTurn = persistedTurn && requestedRequestId
            && ![persistedTurn.requestId, persistedTurn.assistantMessageId].includes(requestedRequestId)
            ? null
            : persistedTurn;
        const cancelResult = abortForegroundRequest({
            sessionId: req.params.id,
            requestId: requestedRequestId || matchingPersistedTurn?.requestId || null,
            ownerId,
            reason: 'user_cancelled',
        });

        let persisted = false;
        if (!cancelResult.cancelled && matchingPersistedTurn) {
            await cancelForegroundTurn(sessionStore, req.params.id, matchingPersistedTurn, {
                cancelledBy: 'user',
                reason: 'user_cancelled',
            });
            persisted = true;
        }

        res.json({
            sessionId: req.params.id,
            requestId: cancelResult.requestId
                || matchingPersistedTurn?.requestId
                || requestedRequestId
                || null,
            cancelled: cancelResult.cancelled === true || persisted,
            active: cancelResult.active === true,
            persisted,
            reason: cancelResult.reason || (persisted ? 'persisted_pending_turn' : 'not_found'),
        });
    } catch (err) {
        next(err);
    }
});

router.get('/:id', async (req, res, next) => {
    try {
        const session = await sessionStore.getOwned(req.params.id, getRequestOwnerId(req));
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }
        res.json(session);
    } catch (err) {
        next(err);
    }
});

router.patch('/:id', async (req, res, next) => {
    try {
        const { metadata } = req.body || {};
        const existing = await sessionStore.getOwned(req.params.id, getRequestOwnerId(req));
        if (!existing) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }

        const session = await sessionStore.update(req.params.id, {
            metadata: buildScopedSessionMetadata({
                ...(existing.metadata || {}),
                ...buildSessionMetadataFromRequest(req.body || {}, metadata || {}),
            }, existing),
        });
        res.json(session);
    } catch (err) {
        next(err);
    }
});

router.delete('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const ownerId = getRequestOwnerId(req);
        const session = await sessionStore.getOwned(id, ownerId);
        if (!session) {
            return res.status(404).json({ error: { message: 'Session not found' } });
        }
        const deletedScopeKey = session?.metadata?.memoryScope || null;
        const activeSession = await sessionStore.getActiveOwnedSession(ownerId, deletedScopeKey);

        if (typeof sessionStore.isPersistent === 'function' && sessionStore.isPersistent()) {
            await artifactService.deleteArtifactsForSession(id);
        }
        await memoryService.forget(id);
        await sessionStore.delete(id);

        if (activeSession?.id === id) {
            const nextSession = await sessionStore.getLatestOwnedSession(ownerId, {
                scopeKey: deletedScopeKey,
            });
            await sessionStore.setActiveSession(ownerId, nextSession?.id || null, deletedScopeKey);
        }

        res.status(204).end();
    } catch (err) {
        next(err);
    }
});

module.exports = router;
