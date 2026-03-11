require('dotenv').config();

const config = {
    // Server
    port: parseInt(process.env.PORT, 10) || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',

    // OpenAI-compatible gateway for chat/tool use
    openai: {
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        imageModel: process.env.OPENAI_IMAGE_MODEL || '',
    },

    // Official OpenAI media endpoints for image/video generation
    media: {
        apiKey: process.env.OPENAI_MEDIA_API_KEY || '',
        baseURL: process.env.OPENAI_MEDIA_BASE_URL || 'https://api.openai.com/v1',
        imageModel: process.env.OPENAI_MEDIA_IMAGE_MODEL || 'gpt-image-1.5',
        videoModel: process.env.OPENAI_MEDIA_VIDEO_MODEL || 'sora-2',
    },

    // Ollama - Embeddings
    ollama: {
        baseURL: process.env.OLLAMA_BASE_URL || 'http://ollama:11434',
        embedModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text:latest',
    },

    // Qdrant - Vector Store
    qdrant: {
        url: process.env.QDRANT_URL || 'http://qdrant:6333',
        collection: process.env.QDRANT_COLLECTION || 'conversations',
        vectorSize: 768,
    },

    postgres: {
        url: process.env.POSTGRES_URL || process.env.DATABASE_URL || null,
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT, 10) || 5432,
        database: process.env.POSTGRES_DB || 'kimibuilt',
        user: process.env.POSTGRES_USER || 'kimibuilt',
        password: process.env.POSTGRES_PASSWORD || null,
        ssl: process.env.POSTGRES_SSL === 'true',
    },

    artifacts: {
        browserPath: process.env.ARTIFACT_BROWSER_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || '',
        browserArgs: process.env.ARTIFACT_BROWSER_ARGS || '',
        pdfTimeoutMs: parseInt(process.env.ARTIFACT_PDF_TIMEOUT_MS, 10) || 15000,
    },
};

function validate() {
    const errors = [];
    if (!config.openai.apiKey) {
        errors.push('OPENAI_API_KEY is required');
    }
    if (errors.length > 0) {
        throw new Error(`Config validation failed:\n  - ${errors.join('\n  - ')}`);
    }
}

module.exports = { config, validate };
