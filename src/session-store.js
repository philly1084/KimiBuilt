const { v4: uuidv4 } = require('uuid');
const { postgres } = require('./postgres');

const MAX_RECENT_MESSAGES = 24;
const MAX_RECENT_MESSAGE_LENGTH = 4000;

class SessionStore {
    constructor() {
        this.sessions = new Map();
        this.initialized = false;
        this.usePostgres = false;
    }

    trimRecentMessageContent(content = '') {
        const value = String(content || '').trim();
        if (!value) {
            return '';
        }

        if (value.length <= MAX_RECENT_MESSAGE_LENGTH) {
            return value;
        }

        const hiddenCharacters = value.length - MAX_RECENT_MESSAGE_LENGTH;
        return `${value.slice(0, MAX_RECENT_MESSAGE_LENGTH)}\n...[truncated ${hiddenCharacters} chars]`;
    }

    normalizeRecentMessages(messages = []) {
        if (!Array.isArray(messages)) {
            return [];
        }

        return messages
            .map((entry) => {
                const role = ['user', 'assistant', 'system', 'tool'].includes(entry?.role)
                    ? entry.role
                    : null;
                const content = this.trimRecentMessageContent(entry?.content || '');
                const timestamp = entry?.timestamp || new Date().toISOString();

                if (!role || !content) {
                    return null;
                }

                return {
                    role,
                    content,
                    timestamp,
                };
            })
            .filter(Boolean)
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

    normalizeOwnerId(ownerId = null) {
        const normalized = String(ownerId || '').trim();
        return normalized || null;
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

    buildOwnedMetadata(metadata = {}, ownerId = null) {
        const normalizedOwnerId = this.normalizeOwnerId(ownerId);
        if (!normalizedOwnerId) {
            return this.normalizeMetadata(metadata);
        }

        return this.normalizeMetadata({
            ...metadata,
            ownerId: normalizedOwnerId,
            ownerType: metadata?.ownerType || 'user',
        });
    }

    toSession(row) {
        if (!row) return null;

        return {
            id: row.id,
            previousResponseId: row.previous_response_id,
            createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
            updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
            messageCount: row.message_count,
            metadata: row.metadata || {},
        };
    }

    async initialize() {
        if (this.initialized) return;

        try {
            this.usePostgres = await postgres.initialize();
            if (this.usePostgres) {
                console.log('[SessionStore] Using Postgres-backed sessions');
            } else {
                console.warn('[SessionStore] Postgres not configured, using in-memory sessions');
            }
        } catch (err) {
            this.usePostgres = false;
            console.error('[SessionStore] Postgres init failed, using in-memory sessions:', err.message);
        }

        this.initialized = true;
    }

    async create(metadata = {}, preferredId = null) {
        await this.initialize();

        const id = preferredId || uuidv4();
        const now = new Date().toISOString();
        const session = {
            id,
            previousResponseId: null,
            createdAt: now,
            updatedAt: now,
            messageCount: 0,
            metadata: this.normalizeMetadata(metadata),
        };

        if (!this.usePostgres) {
            this.sessions.set(id, session);
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

        return this.toSession(result.rows[0]);
    }

    async get(id) {
        await this.initialize();

        if (!this.usePostgres) {
            return this.sessions.get(id) || null;
        }

        const result = await postgres.query('SELECT * FROM sessions WHERE id = $1', [id]);
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
        const existing = await this.getOwned(id, normalizedOwnerId);
        if (existing) {
            return existing;
        }

        return this.create(this.buildOwnedMetadata(metadata, normalizedOwnerId), id);
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
                updatedAt: new Date().toISOString(),
            };

            this.sessions.set(id, next);
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

        return this.toSession(result.rows[0]);
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
                    SELECT role, content, created_at
                    FROM session_messages
                    WHERE session_id = $1
                    ORDER BY created_at DESC
                    LIMIT $2
                `,
                [sessionId, Math.max(0, limit)],
            );

            return result.rows
                .map((row) => this.normalizeRecentMessageRow(row))
                .filter(Boolean)
                .reverse();
        }

        const recentMessages = Array.isArray(session?.metadata?.recentMessages)
            ? session.metadata.recentMessages
            : [];

        return this.normalizeRecentMessages(recentMessages).slice(-Math.max(0, limit));
    }

    async appendMessages(id, messages = []) {
        await this.initialize();

        const normalizedMessages = this.normalizeRecentMessages(messages);
        if (normalizedMessages.length === 0) {
            return this.get(id);
        }

        if (this.usePostgres) {
            const current = await this.get(id);
            if (!current) {
                return null;
            }

            for (const message of normalizedMessages) {
                await postgres.query(
                    `
                        INSERT INTO session_messages (id, session_id, role, content, created_at)
                        VALUES ($1, $2, $3, $4, $5)
                    `,
                    [
                        uuidv4(),
                        id,
                        message.role,
                        message.content,
                        message.timestamp,
                    ],
                );
            }

            await postgres.query(
                `
                    DELETE FROM session_messages
                    WHERE session_id = $1
                    AND id IN (
                        SELECT id
                        FROM session_messages
                        WHERE session_id = $1
                        ORDER BY created_at DESC
                        OFFSET $2
                    )
                `,
                [id, MAX_RECENT_MESSAGES],
            );

            return current;
        }

        const current = await this.get(id);
        if (!current) {
            return null;
        }

        const existingMessages = await this.getRecentMessages(current);
        const recentMessages = [...existingMessages, ...normalizedMessages].slice(-MAX_RECENT_MESSAGES);

        return this.update(id, {
            metadata: {
                recentMessages,
            },
        });
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
            return this.sessions.delete(id);
        }

        const result = await postgres.query('DELETE FROM sessions WHERE id = $1', [id]);
        return result.rowCount > 0;
    }

    async list(options = {}) {
        await this.initialize();
        const ownerId = this.normalizeOwnerId(options?.ownerId);

        if (!this.usePostgres) {
            return Array.from(this.sessions.values())
                .filter((session) => {
                    if (!ownerId) {
                        return true;
                    }

                    const sessionOwnerId = this.getSessionOwnerId(session);
                    return !sessionOwnerId || sessionOwnerId === ownerId;
                })
                .sort((a, b) => {
                    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
                });
        }

        const result = ownerId
            ? await postgres.query(
                `
                    SELECT *
                    FROM sessions
                    WHERE COALESCE(metadata->>'ownerId', '') = ''
                       OR metadata->>'ownerId' = $1
                    ORDER BY updated_at DESC
                `,
                [ownerId],
            )
            : await postgres.query('SELECT * FROM sessions ORDER BY updated_at DESC');

        return result.rows.map((row) => this.toSession(row));
    }

    async listMessages(id, limit = MAX_RECENT_MESSAGES, ownerId = null) {
        const session = await this.getOwned(id, ownerId);
        if (!session) {
            return [];
        }

        return this.getRecentMessages(session, limit);
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
