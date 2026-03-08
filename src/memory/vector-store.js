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

    async initialize() {
        if (this.initialized) return;

        try {
            const collections = await this.client.getCollections();
            const exists = collections.collections.some((collection) => collection.name === this.collection);

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

        return results.map((result) => ({
            id: result.id,
            score: result.score,
            text: result.payload.text,
            sessionId: result.payload.sessionId,
            timestamp: result.payload.timestamp,
            metadata: result.payload,
        }));
    }

    async deleteSession(sessionId) {
        await this.client.delete(this.collection, {
            wait: true,
            filter: {
                must: [{ key: 'sessionId', match: { value: sessionId } }],
            },
        });
    }

    async deleteArtifact(artifactId) {
        await this.client.delete(this.collection, {
            wait: true,
            filter: {
                must: [{ key: 'artifactId', match: { value: artifactId } }],
            },
        });
    }

    async healthCheck() {
        try {
            await this.client.getCollections();
            return true;
        } catch {
            return false;
        }
    }
}

const vectorStore = new VectorStore();

module.exports = { vectorStore, VectorStore };
