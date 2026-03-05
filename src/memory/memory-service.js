const { vectorStore } = require('./vector-store');

/**
 * Memory service orchestrates the contextual memory pipeline:
 * 1. Store user messages as embeddings in Qdrant
 * 2. Retrieve relevant memories to inject as context into prompts
 * 3. Store assistant responses for future retrieval
 */
class MemoryService {
    constructor() {
        this.store = vectorStore;
    }

    /**
     * Initialize the vector store (ensure collection exists).
     */
    async initialize() {
        await this.store.initialize();
    }

    /**
     * Store a user message in memory.
     * @param {string} sessionId
     * @param {string} message - The user's message
     * @param {string} [role='user'] - Role (user or assistant)
     * @returns {Promise<string>} Point ID
     */
    async remember(sessionId, message, role = 'user') {
        return this.store.store(sessionId, message, { role });
    }

    /**
     * Retrieve relevant context for a query.
     * Searches across all sessions by default, or scoped to a specific session.
     *
     * @param {string} query - The current user message
     * @param {Object} [options]
     * @param {string} [options.sessionId] - Scope search to this session
     * @param {number} [options.topK=5] - Max results
     * @param {number} [options.scoreThreshold=0.7] - Min similarity
     * @returns {Promise<string[]>} Array of relevant text snippets
     */
    async recall(query, { sessionId = null, topK = 5, scoreThreshold = 0.7 } = {}) {
        const results = await this.store.search(query, {
            sessionId,
            topK,
            scoreThreshold,
        });

        return results.map((r) => r.text);
    }

    /**
     * Full memory pipeline for a single turn:
     * 1. Remember the user message
     * 2. Recall relevant context
     * 3. Return context strings for injection into the prompt
     *
     * @param {string} sessionId
     * @param {string} message
     * @param {Object} [options]
     * @returns {Promise<string[]>} Context messages to inject
     */
    async process(sessionId, message, options = {}) {
        // Store the user message (fire and forget — don't block on it)
        this.remember(sessionId, message, 'user').catch((err) => {
            console.error('[Memory] Failed to store message:', err.message);
        });

        // Recall relevant context
        try {
            const context = await this.recall(message, {
                sessionId,
                ...options,
            });
            return context;
        } catch (err) {
            console.error('[Memory] Failed to recall context:', err.message);
            return [];
        }
    }

    /**
     * Store an assistant response in memory.
     * @param {string} sessionId
     * @param {string} response
     */
    async rememberResponse(sessionId, response) {
        try {
            await this.remember(sessionId, response, 'assistant');
        } catch (err) {
            console.error('[Memory] Failed to store response:', err.message);
        }
    }

    /**
     * Delete all memories for a session.
     * @param {string} sessionId
     */
    async forget(sessionId) {
        await this.store.deleteSession(sessionId);
    }
}

// Singleton
const memoryService = new MemoryService();

module.exports = { memoryService, MemoryService };
