const { v4: uuidv4 } = require('uuid');
const fs = require('fs/promises');
const path = require('path');
const { postgres } = require('./postgres');
const { config } = require('./config');
const { stripNullCharacters } = require('./utils/text');
const {
    buildScopedSessionMetadata,
    normalizeSessionScopeKey,
    resolveSessionScope,
    sessionMatchesScope,
} = require('./session-scope');
const {
    buildLegacyControlMetadata,
    getSessionControlState,
    mergeControlState,
    normalizeRuntimeControlState,
} = require('./runtime-control-state');

const MAX_RECENT_MESSAGES = config.memory.recentMessageWindow;
const MAX_RECENT_MESSAGE_LENGTH = config.memory.recentMessageCharLimit;

class SessionStore {
    constructor() {
        this.sessions = new Map();
        this.sessionMessages = new Map();
        this.userSessionState = new Map();
        this.initialized = false;
        this.usePostgres = false;
        this.fallbackStoragePath = path.join(config.persistence.dataDir, 'sessions.json');
        this.fallbackLoaded = false;
    }

    sanitizeMessageMetadataValue(value, depth = 0) {
        if (depth > 8 || value == null) {
            return null;
        }

        if (typeof value === 'string') {
            return stripNullCharacters(value);
        }

        if (typeof value === 'number' || typeof value === 'boolean') {
            return value;
        }

        if (Array.isArray(value)) {
            return value
                .map((entry) => this.sanitizeMessageMetadataValue(entry, depth + 1))
                .filter((entry) => entry != null);
        }

        if (typeof value !== 'object') {
            return null;
        }

        return Object.fromEntries(
            Object.entries(value)
                .map(([key, entry]) => [key, this.sanitizeMessageMetadataValue(entry, depth + 1)])
                .filter(([, entry]) => entry != null),
        );
    }

    normalizeMessageMetadata(metadata = {}) {
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
            return {};
        }

        const sanitized = this.sanitizeMessageMetadataValue(metadata);
        return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
            ? sanitized
            : {};
    }

    extractMessageMetadata(message = {}) {
        if (!message || typeof message !== 'object') {
            return {};
        }

        const metadata = message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)
            ? { ...message.metadata }
            : {};

        Object.entries(message).forEach(([key, value]) => {
            if (['id', 'role', 'content', 'timestamp', 'metadata'].includes(key)) {
                return;
            }

            metadata[key] = value;
        });

        return this.normalizeMessageMetadata(metadata);
    }

    normalizeStoredMessages(messages = []) {
        if (!Array.isArray(messages)) {
            return [];
        }

        return messages
            .map((entry) => {
                const role = ['user', 'assistant', 'system', 'tool'].includes(entry?.role)
                    ? entry.role
                    : null;
                const content = stripNullCharacters(entry?.content || '').trim();
                const timestamp = entry?.timestamp || new Date().toISOString();
                const metadata = this.extractMessageMetadata(entry);

                if (!role || !content) {
                    return null;
                }

                return {
                    id: entry?.id || uuidv4(),
                    role,
                    content,
                    timestamp,
                    metadata,
                };
            })
            .filter(Boolean);
    }

    toClientMessage(message = {}) {
        const metadata = this.normalizeMessageMetadata(message?.metadata || {});

        return {
            id: message?.id || uuidv4(),
            role: message?.role,
            content: message?.content,
            timestamp: message?.timestamp || new Date().toISOString(),
            ...metadata,
            metadata,
        };
    }

    trimRecentMessageContent(content = '') {
        const value = stripNullCharacters(content).trim();
        if (!value) {
            return '';
        }

        if (value.length <= MAX_RECENT_MESSAGE_LENGTH) {
            return value;
        }

        const hiddenCharacters = value.length - MAX_RECENT_MESSAGE_LENGTH;
        return `${value.slice(0, MAX_RECENT_MESSAGE_LENGTH)}\n...[truncated ${hiddenCharacters} chars]`;
    }

    normalizeTranscriptMessages(messages = []) {
        return this.normalizeStoredMessages(messages)
            .filter((entry) => entry?.metadata?.excludeFromTranscript !== true)
            .map((entry) => ({
                role: entry.role,
                content: entry.content,
                timestamp: entry.timestamp,
            }));
    }

    normalizeRecentMessages(messages = []) {
        return this.normalizeTranscriptMessages(messages)
            .map((entry) => ({
                ...entry,
                content: this.trimRecentMessageContent(entry.content || ''),
            }))
            .slice(-MAX_RECENT_MESSAGES);
    }

    normalizeRecentMessageRow(row) {
        const normalized = this.normalizeRecentMessages([{
            role: row?.role,
            content: row?.content,
            timestamp: row?.created_at instanceof Date ? row.created_at.toISOString() : row?.created_at,
        }]);

        return normalized[0] || null;
    }

    normalizeMetadata(metadata = {}) {
        const normalized = {
            ...metadata,
        };

        if (metadata.agent) {
            normalized.agent = {
                id: metadata.agent.id || null,
                name: metadata.agent.name || null,
                instructions: metadata.agent.instructions || '',
                tools: Array.isArray(metadata.agent.tools) ? metadata.agent.tools : [],
            };
        }

        if ('recentMessages' in metadata) {
            normalized.recentMessages = this.normalizeRecentMessages(metadata.recentMessages);
        }

        return normalized;
    }

    normalizeControlState(controlState = {}) {
        return normalizeRuntimeControlState(controlState);
    }

    normalizeOwnerId(ownerId = null) {
        const normalized = String(ownerId || '').trim();
        return normalized || null;
    }

    normalizeSessionId(sessionId = null) {
        const normalized = String(sessionId || '').trim();
        return normalized || null;
    }

    normalizeScopedActiveSessionIds(scopedActiveSessionIds = {}) {
        if (!scopedActiveSessionIds || typeof scopedActiveSessionIds !== 'object' || Array.isArray(scopedActiveSessionIds)) {
            return {};
        }

        return Object.fromEntries(
            Object.entries(scopedActiveSessionIds)
                .map(([scopeKey, sessionId]) => [
                    normalizeSessionScopeKey(scopeKey),
                    this.normalizeSessionId(sessionId),
                ])
                .filter(([, sessionId]) => Boolean(sessionId)),
        );
    }

    getSessionOwnerId(sessionOrMetadata = null) {
        const metadata = sessionOrMetadata?.metadata || sessionOrMetadata || {};
        const ownerId = this.normalizeOwnerId(
            metadata?.ownerId
            || metadata?.userId
            || metadata?.username,
        );

        return ownerId;
    }

    normalizeUserSessionState(state = {}) {
        return {
            ownerId: this.normalizeOwnerId(state?.ownerId || state?.owner_id),
            activeSessionId: this.normalizeSessionId(state?.activeSessionId || state?.active_session_id),
            scopedActiveSessionIds: this.normalizeScopedActiveSessionIds(
                state?.scopedActiveSessionIds || state?.scoped_active_session_ids || {},
            ),
            updatedAt: state?.updatedAt instanceof Date
                ? state.updatedAt.toISOString()
                : (state?.updatedAt || state?.updated_at || new Date().toISOString()),
        };
    }

    toUserSessionState(row) {
        const normalized = this.normalizeUserSessionState(row);
        if (!normalized.ownerId) {
            return null;
        }

        return normalized;
    }

    buildOwnedMetadata(metadata = {}, ownerId = null) {
        const scopedMetadata = buildScopedSessionMetadata(metadata);
        const normalizedOwnerId = this.normalizeOwnerId(ownerId);
        if (!normalizedOwnerId) {
            return this.normalizeMetadata(scopedMetadata);
        }

        return this.normalizeMetadata({
            ...scopedMetadata,
            ownerId: normalizedOwnerId,
            ownerType: metadata?.ownerType || scopedMetadata?.ownerType || 'user',
        });
    }

    toSession(row) {
        if (!row) return null;

        const controlState = this.normalizeControlState(
            row?.control_state
            || row?.controlState
            || row?.metadata?.controlState
            || {},
        );

        return {
            id: row.id,
            previousResponseId: row.previous_response_id,
            createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
            updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
            messageCount: row.message_count,
            metadata: row.metadata || {},
            controlState,
        };
    }

    async loadFallbackState() {
        if (this.fallbackLoaded) {
            return;
        }

        this.fallbackLoaded = true;

        try {
            const raw = await fs.readFile(this.fallbackStoragePath, 'utf8');
            const parsed = JSON.parse(raw);
            const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
            const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
            const userSessionState = Array.isArray(parsed?.userSessionState) ? parsed.userSessionState : [];

            this.sessions = new Map(
                sessions
                    .map((session) => {
                        if (!session?.id) {
                            return null;
                        }

                        return [
                            session.id,
                            {
                                ...session,
                                metadata: this.normalizeMetadata(session.metadata || {}),
                                controlState: this.normalizeControlState(
                                    session.controlState
                                    || session.metadata?.controlState
                                    || {},
                                ),
                            },
                        ];
                    })
                    .filter(Boolean),
            );

            this.sessionMessages = new Map(
                messages
                    .map((entry) => {
                        const sessionId = entry?.[0];
                        if (!sessionId) {
                            return null;
                        }

                        return [
                            sessionId,
                            this.normalizeStoredMessages(entry?.[1] || []),
                        ];
                    })
                    .filter(Boolean),
            );

            this.userSessionState = new Map(
                userSessionState
                    .map((entry) => {
                        const normalized = this.toUserSessionState(entry);
                        if (!normalized?.ownerId) {
                            return null;
                        }

                        return [normalized.ownerId, normalized];
                    })
                    .filter(Boolean),
            );
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.warn('[SessionStore] Failed to load file-backed sessions:', error.message);
            }
        }
    }

    async persistFallbackState() {
        if (this.usePostgres) {
            return;
        }

        const payload = {
            version: 1,
            savedAt: new Date().toISOString(),
            sessions: Array.from(this.sessions.values()),
            messages: Array.from(this.sessionMessages.entries()),
            userSessionState: Array.from(this.userSessionState.values()),
        };

        const directory = path.dirname(this.fallbackStoragePath);
        const tempPath = `${this.fallbackStoragePath}.tmp`;

        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8');
        await fs.rename(tempPath, this.fallbackStoragePath);
    }

    async initialize() {
        if (this.initialized) return;

        try {
            this.usePostgres = await postgres.initialize();
            if (this.usePostgres) {
                console.log('[SessionStore] Using Postgres-backed sessions');
            } else {
                console.warn(`[SessionStore] Postgres not configured, using file-backed sessions at ${this.fallbackStoragePath}`);
                await this.loadFallbackState();
            }
        } catch (err) {
            this.usePostgres = false;
            console.error('[SessionStore] Postgres init failed, using file-backed sessions:', err.message);
            await this.loadFallbackState();
        }

        this.initialized = true;
    }

    async create(metadata = {}, preferredId = null) {
        await this.initialize();

        const id = preferredId || uuidv4();
        const existing = preferredId ? await this.get(id) : null;
        if (existing) {
            return existing;
        }
        const now = new Date().toISOString();
        const normalizedMetadata = this.normalizeMetadata(buildScopedSessionMetadata(metadata));
        const session = {
            id,
            previousResponseId: null,
            createdAt: now,
            updatedAt: now,
            messageCount: 0,
            metadata: normalizedMetadata,
            controlState: this.normalizeControlState(metadata?.controlState || {}),
        };

        if (!this.usePostgres) {
            this.sessions.set(id, session);
            if (!this.sessionMessages.has(id)) {
                this.sessionMessages.set(id, []);
            }
            await this.persistFallbackState();
            return session;
        }

        const result = await postgres.query(
            `
                INSERT INTO sessions (id, previous_response_id, created_at, updated_at, message_count, metadata)
                VALUES ($1, $2, $3, $4, $5, $6::jsonb)
                ON CONFLICT (id) DO UPDATE
                SET metadata = EXCLUDED.metadata,
                    updated_at = EXCLUDED.updated_at
                RETURNING *
            `,
            [
                id,
                null,
                session.createdAt,
                session.updatedAt,
                0,
                JSON.stringify(session.metadata || {}),
            ],
        );

        await postgres.query(
            `
                INSERT INTO session_runtime_state (session_id, state)
                VALUES ($1, $2::jsonb)
                ON CONFLICT (session_id) DO NOTHING
            `,
            [
                id,
                JSON.stringify(session.controlState || {}),
            ],
        );

        return this.toSession({
            ...result.rows[0],
            control_state: session.controlState,
        });
    }

    async get(id) {
        await this.initialize();

        if (!this.usePostgres) {
            return this.sessions.get(id) || null;
        }

        const result = await postgres.query(
            `
                SELECT sessions.*, session_runtime_state.state AS control_state
                FROM sessions
                LEFT JOIN session_runtime_state
                    ON session_runtime_state.session_id = sessions.id
                WHERE sessions.id = $1
            `,
            [id],
        );
        return this.toSession(result.rows[0]);
    }

    async getOrCreate(id, metadata = {}) {
        const existing = await this.get(id);
        if (existing) {
            return existing;
        }

        return this.create(metadata, id);
    }

    async claimOwnershipIfNeeded(id, ownerId = null) {
        const normalizedOwnerId = this.normalizeOwnerId(ownerId);
        if (!normalizedOwnerId) {
            return this.get(id);
        }

        const session = await this.get(id);
        if (!session) {
            return null;
        }

        const existingOwnerId = this.getSessionOwnerId(session);
        if (existingOwnerId && existingOwnerId !== normalizedOwnerId) {
            return null;
        }

        if (existingOwnerId === normalizedOwnerId) {
            return session;
        }

        return this.update(id, {
            metadata: this.buildOwnedMetadata(session.metadata || {}, normalizedOwnerId),
        });
    }

    async getOwned(id, ownerId = null) {
        const normalizedOwnerId = this.normalizeOwnerId(ownerId);
        if (!normalizedOwnerId) {
            return this.get(id);
        }

        return this.claimOwnershipIfNeeded(id, normalizedOwnerId);
    }

    async getOrCreateOwned(id, metadata = {}, ownerId = null) {
        const normalizedOwnerId = this.normalizeOwnerId(ownerId);
        const existing = await this.get(id);
        if (existing) {
            return normalizedOwnerId ? this.getOwned(id, normalizedOwnerId) : existing;
        }

        return this.create(this.buildOwnedMetadata(metadata, normalizedOwnerId), id);
    }

    async getUserSessionState(ownerId = null) {
        await this.initialize();

        const normalizedOwnerId = this.normalizeOwnerId(ownerId);
        if (!normalizedOwnerId) {
            return null;
        }

        if (!this.usePostgres) {
            return this.userSessionState.get(normalizedOwnerId) || null;
        }

        const result = await postgres.query(
            `
                SELECT owner_id, active_session_id, scoped_active_session_ids, updated_at
                FROM user_session_state
                WHERE owner_id = $1
            `,
            [normalizedOwnerId],
        );

        return this.toUserSessionState(result.rows[0]);
    }

    async setActiveSession(ownerId = null, sessionId = null, scopeKey = null) {
        await this.initialize();

        const normalizedOwnerId = this.normalizeOwnerId(ownerId);
        if (!normalizedOwnerId) {
            return null;
        }

        const normalizedSessionId = this.normalizeSessionId(sessionId);
        if (normalizedSessionId) {
            const session = await this.getOwned(normalizedSessionId, normalizedOwnerId);
            if (!session) {
                return null;
            }
        }

        const normalizedScopeKey = normalizeSessionScopeKey(scopeKey);
        const currentState = await this.getUserSessionState(normalizedOwnerId);
        const scopedActiveSessionIds = {
            ...(currentState?.scopedActiveSessionIds || {}),
        };

        if (normalizedSessionId) {
            scopedActiveSessionIds[normalizedScopeKey] = normalizedSessionId;
        } else {
            delete scopedActiveSessionIds[normalizedScopeKey];
        }

        let nextGlobalActiveSessionId = normalizedSessionId || currentState?.activeSessionId || null;
        const removedScopedActiveSessionId = currentState?.scopedActiveSessionIds?.[normalizedScopeKey] || null;
        if (!normalizedSessionId
            && currentState?.activeSessionId
            && removedScopedActiveSessionId
            && currentState.activeSessionId === removedScopedActiveSessionId) {
            nextGlobalActiveSessionId = Object.values(scopedActiveSessionIds)[0] || null;
        }

        const nextState = this.normalizeUserSessionState({
            ownerId: normalizedOwnerId,
            activeSessionId: nextGlobalActiveSessionId,
            scopedActiveSessionIds,
            updatedAt: new Date().toISOString(),
        });

        if (!this.usePostgres) {
            this.userSessionState.set(normalizedOwnerId, nextState);
            await this.persistFallbackState();
            return nextState;
        }

        const result = await postgres.query(
            `
                INSERT INTO user_session_state (owner_id, active_session_id, scoped_active_session_ids, updated_at)
                VALUES ($1, $2, $3::jsonb, NOW())
                ON CONFLICT (owner_id) DO UPDATE
                SET active_session_id = EXCLUDED.active_session_id,
                    scoped_active_session_ids = EXCLUDED.scoped_active_session_ids,
                    updated_at = NOW()
                RETURNING owner_id, active_session_id, scoped_active_session_ids, updated_at
            `,
            [
                normalizedOwnerId,
                nextState.activeSessionId,
                JSON.stringify(nextState.scopedActiveSessionIds || {}),
            ],
        );

        return this.toUserSessionState(result.rows[0]);
    }

    async getActiveOwnedSession(ownerId = null, scopeKey = null) {
        const normalizedOwnerId = this.normalizeOwnerId(ownerId);
        if (!normalizedOwnerId) {
            return null;
        }

        const state = await this.getUserSessionState(normalizedOwnerId);
        const normalizedScopeKey = normalizeSessionScopeKey(scopeKey);
        const activeSessionId = this.normalizeSessionId(
            state?.scopedActiveSessionIds?.[normalizedScopeKey]
            || (normalizedScopeKey === normalizeSessionScopeKey() ? state?.activeSessionId : null),
        );
        if (!activeSessionId) {
            return null;
        }

        const session = await this.getOwned(activeSessionId, normalizedOwnerId);
        if (session) {
            return session;
        }

        await this.setActiveSession(normalizedOwnerId, null, normalizedScopeKey);
        return null;
    }

    async getLatestOwnedSession(ownerId = null, options = {}) {
        const normalizedOwnerId = this.normalizeOwnerId(ownerId);
        const normalizedScopeKey = options?.scopeKey
            ? normalizeSessionScopeKey(options.scopeKey)
            : null;
        const sessions = await this.list(normalizedOwnerId ? {
            ownerId: normalizedOwnerId,
            ...(normalizedScopeKey ? { scopeKey: normalizedScopeKey } : {}),
        } : {
            ...(normalizedScopeKey ? { scopeKey: normalizedScopeKey } : {}),
        });
        const latest = sessions[0] || null;

        if (!latest) {
            return null;
        }

        if (!normalizedOwnerId) {
            return latest;
        }

        return this.getOwned(latest.id, normalizedOwnerId);
    }

    async resolveOwnedSession(sessionId = null, metadata = {}, ownerId = null) {
        const normalizedOwnerId = this.normalizeOwnerId(ownerId);
        const normalizedSessionId = this.normalizeSessionId(sessionId);
        const normalizedScopeKey = resolveSessionScope(metadata);

        if (normalizedSessionId) {
            const session = await this.getOrCreateOwned(
                normalizedSessionId,
                metadata,
                normalizedOwnerId,
            );

            if (session && normalizedOwnerId) {
                await this.setActiveSession(normalizedOwnerId, session.id, normalizedScopeKey);
            }

            return session;
        }

        if (normalizedOwnerId) {
            const activeSession = await this.getActiveOwnedSession(normalizedOwnerId, normalizedScopeKey);
            if (activeSession) {
                return activeSession;
            }

            const latestSession = await this.getLatestOwnedSession(normalizedOwnerId, {
                scopeKey: normalizedScopeKey,
            });
            if (latestSession) {
                await this.setActiveSession(normalizedOwnerId, latestSession.id, normalizedScopeKey);
                return latestSession;
            }
        }

        const session = await this.create(
            normalizedOwnerId ? this.buildOwnedMetadata(metadata, normalizedOwnerId) : metadata,
        );

        if (session && normalizedOwnerId) {
            await this.setActiveSession(normalizedOwnerId, session.id, normalizedScopeKey);
        }

        return session;
    }

    async update(id, updates = {}) {
        await this.initialize();

        if (!this.usePostgres) {
            const session = this.sessions.get(id);
            if (!session) return null;

            const next = {
                ...session,
                ...updates,
                metadata: updates.metadata
                    ? this.normalizeMetadata({
                        ...(session.metadata || {}),
                        ...updates.metadata,
                    })
                    : session.metadata,
                controlState: updates.controlState
                    ? this.normalizeControlState(mergeControlState(
                        session.controlState || {},
                        updates.controlState,
                    ))
                    : this.normalizeControlState(session.controlState || {}),
                updatedAt: new Date().toISOString(),
            };

            this.sessions.set(id, next);
            await this.persistFallbackState();
            return next;
        }

        const current = await this.get(id);
        if (!current) return null;

        const nextMetadata = updates.metadata
            ? this.normalizeMetadata({
                ...(current.metadata || {}),
                ...updates.metadata,
            })
            : current.metadata;
        const nextControlState = updates.controlState
            ? this.normalizeControlState(mergeControlState(
                current.controlState || {},
                updates.controlState,
            ))
            : this.normalizeControlState(current.controlState || {});

        const result = await postgres.query(
            `
                UPDATE sessions
                SET previous_response_id = $2,
                    message_count = $3,
                    metadata = $4::jsonb,
                    updated_at = NOW()
                WHERE id = $1
                RETURNING *
            `,
            [
                id,
                updates.previousResponseId ?? current.previousResponseId,
                updates.messageCount ?? current.messageCount,
                JSON.stringify(nextMetadata || {}),
            ],
        );

        if (updates.controlState) {
            await postgres.query(
                `
                    INSERT INTO session_runtime_state (session_id, state, updated_at)
                    VALUES ($1, $2::jsonb, NOW())
                    ON CONFLICT (session_id) DO UPDATE
                    SET state = $2::jsonb,
                        updated_at = NOW()
                `,
                [
                    id,
                    JSON.stringify(nextControlState || {}),
                ],
            );
        }

        return this.toSession({
            ...result.rows[0],
            control_state: nextControlState,
        });
    }

    async getControlState(sessionOrId) {
        const session = typeof sessionOrId === 'string'
            ? await this.get(sessionOrId)
            : sessionOrId;

        return getSessionControlState(session);
    }

    async updateControlState(id, controlState = {}) {
        await this.initialize();

        const current = await this.get(id);
        if (!current) {
            return null;
        }

        const nextControlState = this.normalizeControlState(mergeControlState(
            current.controlState || {},
            controlState,
        ));
        const legacyMetadata = buildLegacyControlMetadata(nextControlState);

        if (!this.usePostgres) {
            const session = this.sessions.get(id);
            const next = {
                ...session,
                controlState: nextControlState,
                metadata: this.normalizeMetadata({
                    ...(session?.metadata || {}),
                    ...legacyMetadata,
                }),
                updatedAt: new Date().toISOString(),
            };
            this.sessions.set(id, next);
            await this.persistFallbackState();
            return nextControlState;
        }

        await postgres.query(
            `
                INSERT INTO session_runtime_state (session_id, state, updated_at)
                VALUES ($1, $2::jsonb, NOW())
                ON CONFLICT (session_id) DO UPDATE
                SET state = $2::jsonb,
                    updated_at = NOW()
            `,
            [
                id,
                JSON.stringify(nextControlState || {}),
            ],
        );

        await this.update(id, {
            metadata: legacyMetadata,
        });

        return nextControlState;
    }

    async getRecentMessages(sessionOrId, limit = MAX_RECENT_MESSAGES) {
        await this.initialize();

        const session = typeof sessionOrId === 'string'
            ? await this.get(sessionOrId)
            : sessionOrId;
        const sessionId = typeof sessionOrId === 'string' ? sessionOrId : session?.id;

        if (!sessionId) {
            return [];
        }

        if (this.usePostgres) {
            const result = await postgres.query(
                `
                    SELECT id, role, content, created_at, metadata
                    FROM session_messages
                    WHERE session_id = $1
                      AND COALESCE(metadata->>'excludeFromTranscript', 'false') <> 'true'
                    ORDER BY created_at DESC
                    LIMIT $2
                `,
                [sessionId, Math.max(0, limit)],
            );

            return result.rows
                .map((row) => this.normalizeRecentMessageRow({
                    role: row?.role,
                    content: row?.content,
                    created_at: row?.created_at,
                }))
                .filter(Boolean)
                .reverse();
        }

        const transcript = this.sessionMessages.get(sessionId) || [];
        return this.normalizeRecentMessages(transcript.slice(-Math.max(0, limit)));
    }

    async appendMessages(id, messages = []) {
        await this.initialize();

        const storedMessages = this.normalizeStoredMessages(messages);
        if (storedMessages.length === 0) {
            return this.get(id);
        }

        if (this.usePostgres) {
            const current = await this.get(id);
            if (!current) {
                return null;
            }

            for (const message of storedMessages) {
                await postgres.query(
                    `
                        INSERT INTO session_messages (id, session_id, role, content, created_at, metadata)
                        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
                    `,
                    [
                        message.id,
                        id,
                        message.role,
                        message.content,
                        message.timestamp,
                        JSON.stringify(message.metadata || {}),
                    ],
                );
            }

            return current;
        }

        const current = await this.get(id);
        if (!current) {
            return null;
        }

        const existingMessages = this.sessionMessages.get(id) || [];
        const nextMessages = [...existingMessages, ...storedMessages];
        this.sessionMessages.set(id, nextMessages);

        const updated = await this.update(id, {
            metadata: {
                recentMessages: this.normalizeRecentMessages(nextMessages),
            },
        });
        await this.persistFallbackState();
        return updated;
    }

    async upsertMessage(id, message = {}) {
        await this.initialize();

        const storedMessage = this.normalizeStoredMessages([message])[0] || null;
        if (!storedMessage) {
            return null;
        }

        const current = await this.get(id);
        if (!current) {
            return null;
        }

        if (this.usePostgres) {
            const result = await postgres.query(
                `
                    INSERT INTO session_messages (id, session_id, role, content, created_at, metadata)
                    VALUES ($1, $2, $3, $4, $5, $6::jsonb)
                    ON CONFLICT (id) DO UPDATE
                    SET role = EXCLUDED.role,
                        content = EXCLUDED.content,
                        created_at = EXCLUDED.created_at,
                        metadata = EXCLUDED.metadata
                    WHERE session_messages.session_id = EXCLUDED.session_id
                    RETURNING id, role, content, created_at, metadata
                `,
                [
                    storedMessage.id,
                    id,
                    storedMessage.role,
                    storedMessage.content,
                    storedMessage.timestamp,
                    JSON.stringify(storedMessage.metadata || {}),
                ],
            );

            if (result.rowCount === 0) {
                return null;
            }

            return this.toClientMessage({
                id: result.rows[0].id,
                role: result.rows[0].role,
                content: result.rows[0].content,
                timestamp: result.rows[0].created_at instanceof Date
                    ? result.rows[0].created_at.toISOString()
                    : result.rows[0].created_at,
                metadata: result.rows[0].metadata || {},
            });
        }

        const existingMessages = this.sessionMessages.get(id) || [];
        const index = existingMessages.findIndex((entry) => entry.id === storedMessage.id);
        const nextMessages = [...existingMessages];

        if (index >= 0) {
            nextMessages[index] = {
                ...nextMessages[index],
                ...storedMessage,
                metadata: this.normalizeMessageMetadata({
                    ...(nextMessages[index]?.metadata || {}),
                    ...(storedMessage.metadata || {}),
                }),
            };
        } else {
            nextMessages.push(storedMessage);
        }

        this.sessionMessages.set(id, nextMessages);

        await this.update(id, {
            metadata: {
                recentMessages: this.normalizeRecentMessages(nextMessages),
            },
        });
        await this.persistFallbackState();

        return this.toClientMessage(index >= 0 ? nextMessages[index] : storedMessage);
    }

    async recordResponse(id, responseId) {
        await this.initialize();

        if (!this.usePostgres) {
            const session = this.sessions.get(id);
            if (!session) return null;

            session.previousResponseId = responseId;
            session.messageCount += 1;
            session.updatedAt = new Date().toISOString();
            this.sessions.set(id, session);
            await this.persistFallbackState();
            return session;
        }

        const result = await postgres.query(
            `
                UPDATE sessions
                SET previous_response_id = $2,
                    message_count = message_count + 1,
                    updated_at = NOW()
                WHERE id = $1
                RETURNING *
            `,
            [id, responseId],
        );

        return this.toSession(result.rows[0]);
    }

    async delete(id) {
        await this.initialize();

        if (!this.usePostgres) {
            this.sessionMessages.delete(id);
            const deleted = this.sessions.delete(id);
            await this.persistFallbackState();
            return deleted;
        }

        const result = await postgres.query('DELETE FROM sessions WHERE id = $1', [id]);
        return result.rowCount > 0;
    }

    async list(options = {}) {
        await this.initialize();
        const ownerId = this.normalizeOwnerId(options?.ownerId);
        const scopeKey = options?.scopeKey
            ? normalizeSessionScopeKey(options.scopeKey)
            : null;

        if (!this.usePostgres) {
            return Array.from(this.sessions.values())
                .filter((session) => {
                    if (!ownerId) {
                        return !scopeKey || sessionMatchesScope(session, scopeKey);
                    }

                    const sessionOwnerId = this.getSessionOwnerId(session);
                    return (!sessionOwnerId || sessionOwnerId === ownerId)
                        && (!scopeKey || sessionMatchesScope(session, scopeKey));
                })
                .sort((a, b) => {
                    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
                });
        }

        const result = ownerId
            ? await postgres.query(
                `
                    SELECT sessions.*, session_runtime_state.state AS control_state
                    FROM sessions
                    LEFT JOIN session_runtime_state
                        ON session_runtime_state.session_id = sessions.id
                    WHERE COALESCE(sessions.metadata->>'ownerId', '') = ''
                       OR sessions.metadata->>'ownerId' = $1
                    ORDER BY sessions.updated_at DESC
                `,
                [ownerId],
            )
            : await postgres.query(
                `
                    SELECT sessions.*, session_runtime_state.state AS control_state
                    FROM sessions
                    LEFT JOIN session_runtime_state
                        ON session_runtime_state.session_id = sessions.id
                    ORDER BY sessions.updated_at DESC
                `,
            );

        const sessions = result.rows.map((row) => this.toSession(row));
        return scopeKey
            ? sessions.filter((session) => sessionMatchesScope(session, scopeKey))
            : sessions;
    }

    async listMessages(id, limit = MAX_RECENT_MESSAGES, ownerId = null) {
        const session = await this.getOwned(id, ownerId);
        if (!session) {
            return [];
        }

        const normalizedLimit = Math.max(0, limit);

        if (this.usePostgres) {
            const result = await postgres.query(
                `
                    SELECT id, role, content, created_at, metadata
                    FROM session_messages
                    WHERE session_id = $1
                    ORDER BY created_at DESC
                    LIMIT $2
                `,
                [session.id, normalizedLimit],
            );

            return result.rows
                .map((row) => this.toClientMessage({
                    id: row?.id,
                    role: ['user', 'assistant', 'system', 'tool'].includes(row?.role) ? row.role : null,
                    content: stripNullCharacters(row?.content || '').trim(),
                    timestamp: row?.created_at instanceof Date ? row.created_at.toISOString() : row?.created_at,
                    metadata: row?.metadata || {},
                }))
                .filter((row) => row.role && row.content)
                .reverse();
        }

        const transcript = this.sessionMessages.get(session.id) || [];
        return transcript
            .slice(-normalizedLimit)
            .map((message) => this.toClientMessage(message));
    }

    async healthCheck() {
        await this.initialize();

        if (!this.usePostgres) {
            return false;
        }

        return postgres.healthCheck();
    }

    isPersistent() {
        return this.usePostgres;
    }
}

const sessionStore = new SessionStore();

module.exports = { sessionStore, SessionStore };
