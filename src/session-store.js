const { v4: uuidv4 } = require('uuid');

/**
 * In-memory session store.
 * Tracks conversation state including the previous_response_id
 * for OpenAI Response API continuity.
 */
class SessionStore {
    constructor() {
        this.sessions = new Map();
    }

    /**
     * Create a new session.
     * @param {Object} [metadata] - Optional metadata for the session
     * @returns {Object} The created session
     */
    create(metadata = {}) {
        const id = uuidv4();
        const session = {
            id,
            previousResponseId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messageCount: 0,
            metadata,
        };
        this.sessions.set(id, session);
        return session;
    }

    /**
     * Get a session by ID.
     * @param {string} id
     * @returns {Object|null}
     */
    get(id) {
        return this.sessions.get(id) || null;
    }

    /**
     * Update a session (typically after a response is received).
     * @param {string} id
     * @param {Object} updates
     * @returns {Object|null}
     */
    update(id, updates) {
        const session = this.sessions.get(id);
        if (!session) return null;

        Object.assign(session, updates, {
            updatedAt: new Date().toISOString(),
        });
        return session;
    }

    /**
     * Increment message count and update previousResponseId.
     * @param {string} id
     * @param {string} responseId - The response ID from the OpenAI API
     * @returns {Object|null}
     */
    recordResponse(id, responseId) {
        const session = this.sessions.get(id);
        if (!session) return null;

        session.previousResponseId = responseId;
        session.messageCount += 1;
        session.updatedAt = new Date().toISOString();
        return session;
    }

    /**
     * Delete a session.
     * @param {string} id
     * @returns {boolean}
     */
    delete(id) {
        return this.sessions.delete(id);
    }

    /**
     * List all sessions.
     * @returns {Object[]}
     */
    list() {
        return Array.from(this.sessions.values());
    }
}

// Singleton
const sessionStore = new SessionStore();

module.exports = { sessionStore, SessionStore };
