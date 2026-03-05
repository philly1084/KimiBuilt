const { QdrantClient } = require('@qdrant/js-client-rest');
const { config } = require('../config');
const { embedder } = require('./embedder');
const { v4: uuidv4 } = require('uuid');

/**
 * Qdrant vector store wrapper.
 * Manages the conversations collection and provides store/search/delete.
 */
class VectorStore {
    constructor() {
        this.client = new QdrantClient({ url: config.qdrant.url });
        this.collection = config.qdrant.collection;
        this.vectorSize = config.qdrant.vectorSize;
        this.initialized = false;
    }

    /**
     * Ensure the collection exists. Called once on startup.
     */
    async initialize() {
        if (this.initialized) return;

        try {
            const collections = await this.client.getCollections();
            const exists = collections.collections.some(
                (c) => c.name === this.collection
            );

            if (!exists) {
                await this.client.createCollection(this.collection, {
                    vectors: {
                        size: this.vectorSize,
                        distance: 'Cosine',
                    },
                });
                console.log(`[Qdrant] Created collection: ${this.collection}`);
            } else {
                console.log(`[Qdrant] Collection already exists: ${this.collection}`);
            }

            this.initialized = true;
        } catch (err) {
            console.error('[Qdrant] Initialization failed:', err.message);
            throw err;
        }
    }

    /**
     * Embed text and store in Qdrant.
     * @param {string} sessionId - Session identifier
     * @param {string} text - Text to store
     * @param {Object} [metadata] - Additional metadata
     * @returns {Promise<string>} The point ID
     */
    async store(sessionId, text, metadata = {}) {
        const vector = await embedder.embed(text);
        const pointId = uuidv4();

        await this.client.upsert(this.collection, {
            wait: true,
            points: [
                {
                    id: pointId,
                    vector,
                    payload: {
                        sessionId,
                        text,
                        timestamp: new Date().toISOString(),
                        ...metadata,
                    },
                },
            ],
        });

        return pointId;
    }

    /**
     * Search for similar texts.
     * @param {string} query - Query text to search for
     * @param {Object} [options]
     * @param {string} [options.sessionId] - Filter by session
     * @param {number} [options.topK=5] - Number of results
     * @param {number} [options.scoreThreshold=0.7] - Minimum similarity score
     * @returns {Promise<Object[]>} Matching results with text and score
     */
    async search(query, { sessionId = null, topK = 5, scoreThreshold = 0.7 } = {}) {
        const vector = await embedder.embed(query);

        const filter = sessionId
            ? { must: [{ key: 'sessionId', match: { value: sessionId } }] }
            : undefined;

        const results = await this.client.search(this.collection, {
            vector,
            limit: topK,
            score_threshold: scoreThreshold,
            filter,
            with_payload: true,
        });

        return results.map((r) => ({
            id: r.id,
            score: r.score,
            text: r.payload.text,
            sessionId: r.payload.sessionId,
            timestamp: r.payload.timestamp,
            metadata: r.payload,
        }));
    }

    /**
     * Delete all vectors for a session.
     * @param {string} sessionId
     */
    async deleteSession(sessionId) {
        await this.client.delete(this.collection, {
            wait: true,
            filter: {
                must: [{ key: 'sessionId', match: { value: sessionId } }],
            },
        });
    }

    /**
     * Check connectivity to Qdrant.
     * @returns {Promise<boolean>}
     */
    async healthCheck() {
        try {
            await this.client.getCollections();
            return true;
        } catch {
            return false;
        }
    }
}

// Singleton
const vectorStore = new VectorStore();

module.exports = { vectorStore, VectorStore };
