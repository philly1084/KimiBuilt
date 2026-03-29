const { config } = require('../config');
const { vectorStore } = require('./vector-store');
const { stripNullCharacters } = require('../utils/text');

const DEFAULT_RECALL_PROFILE = 'default';
const RESEARCH_RECALL_PROFILE = 'research';

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
    async remember(sessionId, message, role = 'user', metadata = {}) {
        return this.store.store(sessionId, stripNullCharacters(message), { role, ...metadata });
    }

    /**
     * Retrieve relevant context for a query.
     * Searches across all sessions by default, or scoped to a specific session.
     *
     * @param {string} query - The current user message
     * @param {Object} [options]
     * @param {string} [options.sessionId] - Scope search to this session
     * @param {number} [options.topK] - Max results, defaults by recall profile
     * @param {number} [options.scoreThreshold] - Min similarity, defaults by recall profile
     * @param {string} [options.profile='default'] - Recall profile (`default` or `research`)
     * @returns {Promise<string[]>} Array of relevant text snippets
     */
    getRecallOptions({ profile = DEFAULT_RECALL_PROFILE, topK, scoreThreshold } = {}) {
        const normalizedProfile = String(profile || DEFAULT_RECALL_PROFILE).trim().toLowerCase();
        const isResearch = normalizedProfile === RESEARCH_RECALL_PROFILE;

        return {
            topK: Number.isFinite(Number(topK))
                ? Number(topK)
                : (isResearch ? config.memory.researchRecallTopK : config.memory.recallTopK),
            scoreThreshold: Number.isFinite(Number(scoreThreshold))
                ? Number(scoreThreshold)
                : (isResearch ? config.memory.researchRecallScoreThreshold : config.memory.recallScoreThreshold),
        };
    }

    async recall(query, { sessionId = null, ownerId = null, topK, scoreThreshold, profile = DEFAULT_RECALL_PROFILE } = {}) {
        const recallOptions = this.getRecallOptions({
            profile,
            topK,
            scoreThreshold,
        });
        const results = await this.store.search(query, {
            sessionId,
            ownerId,
            topK: recallOptions.topK,
            scoreThreshold: recallOptions.scoreThreshold,
        });

        const seen = new Set();

        return results
            .map((result) => this.formatResult(result))
            .filter((entry) => {
                if (!entry || seen.has(entry)) {
                    return false;
                }

                seen.add(entry);
                return true;
            });
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
        const ownerId = String(options?.ownerId || '').trim() || null;
        // Store the user message (fire and forget — don't block on it)
        this.remember(sessionId, message, 'user', ownerId ? { ownerId } : {}).catch((err) => {
            console.error('[Memory] Failed to store message:', err.message);
        });

        // Recall relevant context
        try {
            const context = await this.recall(message, {
                sessionId: ownerId ? null : sessionId,
                ownerId,
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
    async rememberResponse(sessionId, response, metadata = {}) {
        try {
            await this.remember(sessionId, response, 'assistant', metadata);
        } catch (err) {
            console.error('[Memory] Failed to store response:', err.message);
        }
    }

    async rememberResearchNote(sessionId, note, metadata = {}) {
        const normalizedNote = stripNullCharacters(note).trim();
        if (!normalizedNote) {
            return null;
        }

        try {
            return await this.store.store(sessionId, normalizedNote, {
                role: 'research-note',
                memoryType: 'research',
                ...metadata,
            });
        } catch (err) {
            console.error('[Memory] Failed to store research note:', err.message);
            return null;
        }
    }

    /**
     * Delete all memories for a session.
     * @param {string} sessionId
     */
    async forget(sessionId) {
        await this.store.deleteSession(sessionId);
    }

    formatResult(result = {}) {
        const text = String(result.text || '').trim();
        if (!text) {
            return null;
        }

        const role = String(result.metadata?.role || result.role || 'memory').trim();
        return `[Past ${role} message] ${text}`;
    }
}

// Singleton
const memoryService = new MemoryService();

module.exports = {
    memoryService,
    MemoryService,
    DEFAULT_RECALL_PROFILE,
    RESEARCH_RECALL_PROFILE,
};
