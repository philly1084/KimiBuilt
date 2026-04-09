require('dotenv').config();
const path = require('path');
const { getStateDirectory } = require('./runtime-state-paths');
const { resolveDefaultRepositoryPath } = require('./repository-paths');

const persistenceDataDir = process.env.KIMIBUILT_DATA_DIR
    ? path.resolve(process.env.KIMIBUILT_DATA_DIR)
    : getStateDirectory();
const defaultRepositoryPath = resolveDefaultRepositoryPath({
    explicitPath: process.env.DEFAULT_GIT_REPOSITORY_PATH,
    currentWorkingDirectory: process.cwd(),
    dataDir: persistenceDataDir,
    repositoryUrl: process.env.KIMIBUILT_DEPLOY_REPO_URL || '',
});

const config = {
    // Server
    port: parseInt(process.env.PORT, 10) || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',

    // OpenAI-compatible gateway for chat/tool use
    openai: {
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        apiMode: process.env.OPENAI_API_MODE || 'auto',
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        reasoningEffort: process.env.OPENAI_REASONING_EFFORT || '',
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

    persistence: {
        dataDir: persistenceDataDir,
    },

    artifacts: {
        browserPath: process.env.ARTIFACT_BROWSER_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || '',
        browserArgs: process.env.ARTIFACT_BROWSER_ARGS || '',
        pdfTimeoutMs: parseInt(process.env.ARTIFACT_PDF_TIMEOUT_MS, 10) || 15000,
    },

    tts: {
        piper: {
            enabled: process.env.PIPER_TTS_ENABLED !== 'false',
            binaryPath: process.env.PIPER_TTS_BINARY_PATH || 'piper',
            modelPath: process.env.PIPER_TTS_MODEL_PATH || '',
            configPath: process.env.PIPER_TTS_CONFIG_PATH || '',
            voiceId: process.env.PIPER_TTS_VOICE_ID || 'piper-female-natural',
            voiceLabel: process.env.PIPER_TTS_VOICE_LABEL || 'Female natural',
            voiceDescription: process.env.PIPER_TTS_VOICE_DESCRIPTION || 'A Piper voice tuned for clear, natural female speech.',
            speakerId: Number.isFinite(parseInt(process.env.PIPER_TTS_SPEAKER_ID, 10))
                ? parseInt(process.env.PIPER_TTS_SPEAKER_ID, 10)
                : null,
            lengthScale: Number.isFinite(parseFloat(process.env.PIPER_TTS_LENGTH_SCALE))
                ? parseFloat(process.env.PIPER_TTS_LENGTH_SCALE)
                : 1.02,
            noiseScale: Number.isFinite(parseFloat(process.env.PIPER_TTS_NOISE_SCALE))
                ? parseFloat(process.env.PIPER_TTS_NOISE_SCALE)
                : 0.55,
            noiseW: Number.isFinite(parseFloat(process.env.PIPER_TTS_NOISE_W))
                ? parseFloat(process.env.PIPER_TTS_NOISE_W)
                : 0.8,
            sentenceSilence: Number.isFinite(parseFloat(process.env.PIPER_TTS_SENTENCE_SILENCE))
                ? parseFloat(process.env.PIPER_TTS_SENTENCE_SILENCE)
                : 0.24,
            maxTextChars: Math.max(
                200,
                parseInt(process.env.PIPER_TTS_MAX_TEXT_CHARS, 10) || 2400,
            ),
            timeoutMs: Math.max(
                1000,
                parseInt(process.env.PIPER_TTS_TIMEOUT_MS, 10) || 45000,
            ),
        },
    },

    auth: {
        username: process.env.LILLYBUILT_AUTH_USERNAME || process.env.KIMIBUILT_AUTH_USERNAME || '',
        password: process.env.LILLYBUILT_AUTH_PASSWORD || process.env.KIMIBUILT_AUTH_PASSWORD || '',
        jwtSecret: process.env.LILLYBUILT_JWT_SECRET || process.env.KIMIBUILT_JWT_SECRET || '',
        cookieName: process.env.LILLYBUILT_AUTH_COOKIE || 'lillybuilt_auth',
        tokenTtlSeconds: parseInt(process.env.LILLYBUILT_AUTH_TTL_SECONDS || process.env.KIMIBUILT_AUTH_TTL_SECONDS, 10) || (12 * 60 * 60),
    },

    search: {
        provider: process.env.SEARCH_PROVIDER || 'perplexity',
        perplexityApiKey: process.env.PERPLEXITY_API_KEY || '',
        perplexityBaseURL: process.env.PERPLEXITY_BASE_URL || 'https://api.perplexity.ai',
        defaultLimit: Math.max(
            1,
            parseInt(process.env.WEB_SEARCH_DEFAULT_LIMIT, 10) || 12,
        ),
        maxLimit: Math.max(
            8,
            parseInt(process.env.WEB_SEARCH_MAX_LIMIT, 10) || 20,
        ),
    },

    scrape: {
        contentCharLimit: Math.max(
            500,
            parseInt(process.env.WEB_SCRAPE_CONTENT_CHAR_LIMIT, 10) || 12000,
        ),
    },

    memory: {
        sessionIsolationDefault: process.env.SESSION_ISOLATION_DEFAULT !== 'false',
        recentMessageWindow: Math.max(
            1,
            parseInt(process.env.MEMORY_RECENT_MESSAGE_WINDOW, 10) || 40,
        ),
        recentTranscriptLimit: Math.max(
            1,
            parseInt(process.env.MEMORY_RECENT_TRANSCRIPT_LIMIT, 10) || 20,
        ),
        recentMessageCharLimit: Math.max(
            500,
            parseInt(process.env.MEMORY_RECENT_MESSAGE_CHAR_LIMIT, 10) || 6000,
        ),
        recallTopK: Math.max(
            1,
            parseInt(process.env.MEMORY_RECALL_TOP_K, 10) || 12,
        ),
        recallScoreThreshold: Number.isFinite(parseFloat(process.env.MEMORY_RECALL_SCORE_THRESHOLD))
            ? parseFloat(process.env.MEMORY_RECALL_SCORE_THRESHOLD)
            : 0.7,
        researchRecallTopK: Math.max(
            1,
            parseInt(process.env.MEMORY_RESEARCH_RECALL_TOP_K, 10) || 16,
        ),
        researchRecallScoreThreshold: Number.isFinite(parseFloat(process.env.MEMORY_RESEARCH_RECALL_SCORE_THRESHOLD))
            ? parseFloat(process.env.MEMORY_RESEARCH_RECALL_SCORE_THRESHOLD)
            : 0.64,
        researchSearchLimit: Math.max(
            1,
            parseInt(process.env.WEB_RESEARCH_SEARCH_LIMIT, 10) || 16,
        ),
        researchFollowupPages: Math.max(
            1,
            parseInt(process.env.WEB_RESEARCH_FOLLOWUP_PAGES, 10) || 6,
        ),
        researchSourceExcerptChars: Math.max(
            500,
            parseInt(process.env.WEB_RESEARCH_SOURCE_EXCERPT_CHARS, 10) || 2000,
        ),
        toolResultCharLimit: Math.max(
            1000,
            parseInt(process.env.TOOL_RESULT_CHAR_LIMIT, 10) || 18000,
        ),
        debugTrace: process.env.MEMORY_DEBUG_TRACE === 'true',
    },

    deploy: {
        defaultRepositoryPath,
        defaultRepositoryUrl: process.env.KIMIBUILT_DEPLOY_REPO_URL || '',
        defaultTargetDirectory: process.env.KIMIBUILT_DEPLOY_TARGET_DIR || '',
        defaultManifestsPath: process.env.KIMIBUILT_DEPLOY_MANIFESTS_PATH || 'k8s',
        defaultNamespace: process.env.KIMIBUILT_DEPLOY_NAMESPACE || 'kimibuilt',
        defaultDeployment: process.env.KIMIBUILT_DEPLOY_DEPLOYMENT || 'backend',
        defaultContainer: process.env.KIMIBUILT_DEPLOY_CONTAINER || 'backend',
        defaultBranch: process.env.KIMIBUILT_DEPLOY_BRANCH || 'master',
    },

    opencode: {
        enabled: process.env.OPENCODE_ENABLED !== 'false',
        binaryPath: process.env.OPENCODE_BINARY_PATH || 'opencode',
        defaultAgent: process.env.OPENCODE_DEFAULT_AGENT || 'build',
        defaultModel: process.env.OPENCODE_DEFAULT_MODEL || '',
        gatewayApiKey: process.env.OPENCODE_GATEWAY_API_KEY || '',
        allowedWorkspaceRoots: process.env.OPENCODE_ALLOWED_WORKSPACE_ROOTS
            ? String(process.env.OPENCODE_ALLOWED_WORKSPACE_ROOTS)
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean)
                .map((value) => path.resolve(value))
            : [defaultRepositoryPath],
        remoteDefaultWorkspace: process.env.OPENCODE_REMOTE_DEFAULT_WORKSPACE || '',
        providerEnvAllowlist: String(process.env.OPENCODE_PROVIDER_ENV_ALLOWLIST || [
            'OPENAI_API_KEY',
            'OPENAI_BASE_URL',
            'OPENAI_MODEL',
            'GITHUB_TOKEN',
            'GH_TOKEN',
            'ANTHROPIC_API_KEY',
            'GOOGLE_API_KEY',
            'OPENROUTER_API_KEY',
            'XAI_API_KEY',
            'AZURE_OPENAI_API_KEY',
            'AZURE_OPENAI_ENDPOINT',
            'AWS_ACCESS_KEY_ID',
            'AWS_SECRET_ACCESS_KEY',
            'AWS_REGION',
        ].join(','))
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        remoteAutoInstall: process.env.OPENCODE_REMOTE_AUTO_INSTALL === 'true',
    },

    runtime: {
        remoteBuildAutonomyDefault: process.env.REMOTE_BUILD_AUTONOMY_DEFAULT !== 'false',
        remoteBuildMaxAutonomousRounds: Math.max(
            1,
            parseInt(process.env.REMOTE_BUILD_MAX_AUTONOMOUS_ROUNDS, 10) || 8,
        ),
        remoteBuildMaxAutonomousToolCalls: Math.max(
            1,
            parseInt(process.env.REMOTE_BUILD_MAX_AUTONOMOUS_TOOL_CALLS, 10) || 24,
        ),
        remoteBuildMaxAutonomousMs: Math.max(
            1000,
            parseInt(process.env.REMOTE_BUILD_MAX_AUTONOMOUS_MS, 10) || 120000,
        ),
        remoteBuildBudgetExtensionMaxUses: Math.max(
            0,
            parseInt(process.env.REMOTE_BUILD_BUDGET_EXTENSION_MAX_USES, 10) || 2,
        ),
        remoteBuildBudgetExtensionRounds: Math.max(
            0,
            parseInt(process.env.REMOTE_BUILD_BUDGET_EXTENSION_ROUNDS, 10) || 4,
        ),
        remoteBuildBudgetExtensionToolCalls: Math.max(
            0,
            parseInt(process.env.REMOTE_BUILD_BUDGET_EXTENSION_TOOL_CALLS, 10) || 12,
        ),
        remoteBuildBudgetExtensionMs: Math.max(
            0,
            parseInt(process.env.REMOTE_BUILD_BUDGET_EXTENSION_MS, 10) || 60000,
        ),
    },
};

function validate() {
    const errors = [];
    if (!config.openai.apiKey) {
        errors.push('OPENAI_API_KEY is required');
    }
    const authConfigCount = [
        config.auth.username,
        config.auth.password,
        config.auth.jwtSecret,
    ].filter(Boolean).length;

    if (errors.length > 0) {
        throw new Error(`Config validation failed:\n  - ${errors.join('\n  - ')}`);
    }

    if (authConfigCount > 0 && authConfigCount < 3) {
        console.warn('[Config] Partial auth configuration detected. Auth is disabled until username, password, and jwt secret are all set.');
    }
}

// Preserve the nested export used in app code while also exposing top-level
// config sections for older tests and callers that require('./config').runtime.
module.exports = {
    ...config,
    config,
    validate,
};
