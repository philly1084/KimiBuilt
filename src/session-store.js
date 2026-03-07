const { v4: uuidv4 } = require('uuid');
const { postgres } = require('./postgres');

class SessionStore {
    constructor() {
        this.sessions = new Map();
        this.initialized = false;
        this.usePostgres = false;
    }

    normalizeMetadata(metadata = {}) {
        return {
            ...metadata,
            agent: metadata.agent
                ? {
                    id: metadata.agent.id || null,
                    name: metadata.agent.name || null,
                    instructions: metadata.agent.instructions || '',
                    tools: Array.isArray(metadata.agent.tools) ? metadata.agent.tools : [],
                }
                : undefined,
        };
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

    async list() {
        await this.initialize();

        if (!this.usePostgres) {
            return Array.from(this.sessions.values()).sort((a, b) => {
                return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
            });
        }

        const result = await postgres.query('SELECT * FROM sessions ORDER BY updated_at DESC');
        return result.rows.map((row) => this.toSession(row));
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
