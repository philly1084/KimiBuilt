const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { config } = require('./config');

class SessionStore {
    constructor() {
        this.sessions = new Map();
        this.filePath = config.sessions.filePath;
        this.initialized = false;
    }

    initialize() {
        if (this.initialized) return;

        this.ensureStorageDir();
        this.loadFromDisk();
        this.initialized = true;
    }

    ensureStorageDir() {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    loadFromDisk() {
        if (!fs.existsSync(this.filePath)) {
            return;
        }

        try {
            const raw = fs.readFileSync(this.filePath, 'utf8');
            const sessions = JSON.parse(raw);

            if (!Array.isArray(sessions)) {
                return;
            }

            for (const session of sessions) {
                if (session?.id) {
                    this.sessions.set(session.id, session);
                }
            }
        } catch (err) {
            console.error('[SessionStore] Failed to load sessions:', err.message);
        }
    }

    persist() {
        this.ensureStorageDir();

        try {
            const sessions = this.list();
            fs.writeFileSync(this.filePath, JSON.stringify(sessions, null, 2));
        } catch (err) {
            console.error('[SessionStore] Failed to persist sessions:', err.message);
        }
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

    create(metadata = {}) {
        this.initialize();

        const id = uuidv4();
        const now = new Date().toISOString();
        const session = {
            id,
            previousResponseId: null,
            createdAt: now,
            updatedAt: now,
            messageCount: 0,
            metadata: this.normalizeMetadata(metadata),
        };

        this.sessions.set(id, session);
        this.persist();
        return session;
    }

    get(id) {
        this.initialize();
        return this.sessions.get(id) || null;
    }

    update(id, updates = {}) {
        this.initialize();

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
        this.persist();
        return next;
    }

    recordResponse(id, responseId) {
        this.initialize();

        const session = this.sessions.get(id);
        if (!session) return null;

        session.previousResponseId = responseId;
        session.messageCount += 1;
        session.updatedAt = new Date().toISOString();
        this.persist();
        return session;
    }

    delete(id) {
        this.initialize();
        const deleted = this.sessions.delete(id);
        if (deleted) {
            this.persist();
        }
        return deleted;
    }

    list() {
        this.initialize();
        return Array.from(this.sessions.values()).sort((a, b) => {
            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });
    }
}

const sessionStore = new SessionStore();

module.exports = { sessionStore, SessionStore };
