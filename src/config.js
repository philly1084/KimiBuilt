require('dotenv').config();
const fs = require('fs');
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

function resolveConfigPath(value = '') {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return '';
    }

    if (path.isAbsolute(normalized)) {
        return path.normalize(normalized);
    }

    if (normalized.includes('/') || normalized.includes('\\') || /\.[a-z0-9]+$/i.test(normalized)) {
        return path.resolve(process.cwd(), normalized);
    }

    return normalized;
}

function parseOptionalInteger(value) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalFloat(value) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalStringList(value) {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return [];
    }

    return normalized
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function buildAudioProviderCandidates() {
    const defaultBaseURL = 'https://api.openai.com/v1';
    const candidates = [
        {
            id: 'transcription',
            apiKey: String(process.env.OPENAI_TRANSCRIPTION_API_KEY || '').trim(),
            baseURL: String(process.env.OPENAI_TRANSCRIPTION_BASE_URL || process.env.OPENAI_BASE_URL || defaultBaseURL).trim() || defaultBaseURL,
        },
        {
            id: 'media',
            apiKey: String(process.env.OPENAI_MEDIA_API_KEY || '').trim(),
            baseURL: String(process.env.OPENAI_MEDIA_BASE_URL || defaultBaseURL).trim() || defaultBaseURL,
        },
        {
            id: 'openai',
            apiKey: String(process.env.OPENAI_API_KEY || '').trim(),
            baseURL: String(process.env.OPENAI_BASE_URL || defaultBaseURL).trim() || defaultBaseURL,
        },
    ].filter((candidate) => candidate.apiKey);

    const seen = new Set();
    return candidates.filter((candidate) => {
        const cacheKey = `${candidate.apiKey}::${candidate.baseURL}`;
        if (seen.has(cacheKey)) {
            return false;
        }
        seen.add(cacheKey);
        return true;
    });
}

function normalizePiperVoiceDefinition(value = {}, defaults = {}) {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const id = String(value.id || value.voiceId || defaults.id || '').trim();
    const modelPath = resolveConfigPath(value.modelPath || value.model_path || defaults.modelPath || '');
    if (!id || !modelPath) {
        return null;
    }

    return {
        id,
        label: String(value.label || value.voiceLabel || defaults.label || '').trim() || id,
        description: String(value.description || value.voiceDescription || defaults.description || '').trim(),
        modelPath,
        configPath: resolveConfigPath(value.configPath || value.config_path || defaults.configPath || ''),
        speakerId: parseOptionalInteger(value.speakerId ?? value.speaker_id ?? defaults.speakerId),
        lengthScale: parseOptionalFloat(value.lengthScale ?? value.length_scale ?? defaults.lengthScale),
        noiseScale: parseOptionalFloat(value.noiseScale ?? value.noise_scale ?? defaults.noiseScale),
        noiseW: parseOptionalFloat(value.noiseW ?? value.noise_w ?? defaults.noiseW),
        sentenceSilence: parseOptionalFloat(value.sentenceSilence ?? value.sentence_silence ?? defaults.sentenceSilence),
    };
}

function parsePiperVoicesPayload(rawValue = '', defaults = {}) {
    const normalized = String(rawValue || '').trim();
    if (!normalized) {
        return [];
    }

    try {
        const parsed = JSON.parse(normalized);
        return (Array.isArray(parsed) ? parsed : [])
            .map((entry) => normalizePiperVoiceDefinition(entry, defaults))
            .filter(Boolean);
    } catch (error) {
        console.warn(`[Config] Failed to parse Piper voices JSON: ${error.message}`);
        return [];
    }
}

function getBundledPiperRoot() {
    return path.resolve(__dirname, '../data/piper');
}

function resolveBundledPiperBinaryPath() {
    const executableName = process.platform === 'win32' ? 'piper.exe' : 'piper';
    const bundledBinaryPath = path.join(getBundledPiperRoot(), 'runtime', 'piper', executableName);

    try {
        return fs.existsSync(bundledBinaryPath) ? bundledBinaryPath : '';
    } catch (_error) {
        return '';
    }
}

function resolveBundledPiperVoicesPath() {
    const bundledVoicesPath = path.join(getBundledPiperRoot(), 'voices', 'manifest.json');

    try {
        return fs.existsSync(bundledVoicesPath) ? bundledVoicesPath : '';
    } catch (_error) {
        return '';
    }
}

function loadConfiguredPiperVoices(defaults = {}) {
    const candidateVoicesPaths = [
        resolveConfigPath(process.env.PIPER_TTS_VOICES_PATH || ''),
        resolveBundledPiperVoicesPath(),
    ].filter(Boolean);
    const seenPaths = new Set();

    for (const voicesPath of candidateVoicesPaths) {
        if (seenPaths.has(voicesPath)) {
            continue;
        }
        seenPaths.add(voicesPath);

        try {
            const fileContents = fs.readFileSync(voicesPath, 'utf8');
            const parsedVoices = parsePiperVoicesPayload(fileContents, defaults);
            if (parsedVoices.length > 0) {
                return {
                    voicesPath,
                    voices: parsedVoices,
                };
            }
        } catch (error) {
            console.warn(`[Config] Failed to load Piper voices file "${voicesPath}": ${error.message}`);
        }
    }

    const parsedVoices = parsePiperVoicesPayload(process.env.PIPER_TTS_VOICES_JSON || '', defaults);
    if (parsedVoices.length > 0) {
        return {
            voicesPath: resolveConfigPath(process.env.PIPER_TTS_VOICES_PATH || '') || resolveBundledPiperVoicesPath(),
            voices: parsedVoices,
        };
    }

    const legacyVoice = normalizePiperVoiceDefinition({
        id: defaults.id,
        label: defaults.label,
        description: defaults.description,
        modelPath: process.env.PIPER_TTS_MODEL_PATH || '',
        configPath: process.env.PIPER_TTS_CONFIG_PATH || '',
        speakerId: process.env.PIPER_TTS_SPEAKER_ID,
        lengthScale: process.env.PIPER_TTS_LENGTH_SCALE,
        noiseScale: process.env.PIPER_TTS_NOISE_SCALE,
        noiseW: process.env.PIPER_TTS_NOISE_W,
        sentenceSilence: process.env.PIPER_TTS_SENTENCE_SILENCE,
    }, defaults);

    return {
        voicesPath: resolveConfigPath(process.env.PIPER_TTS_VOICES_PATH || '') || resolveBundledPiperVoicesPath(),
        voices: legacyVoice ? [legacyVoice] : [],
    };
}

const piperVoiceDefaults = {
    id: process.env.PIPER_TTS_VOICE_ID || 'piper-female-natural',
    label: process.env.PIPER_TTS_VOICE_LABEL || 'Female natural',
    description: process.env.PIPER_TTS_VOICE_DESCRIPTION || 'A Piper voice tuned for clear, natural female speech.',
    modelPath: process.env.PIPER_TTS_MODEL_PATH || '',
    configPath: process.env.PIPER_TTS_CONFIG_PATH || '',
    speakerId: parseOptionalInteger(process.env.PIPER_TTS_SPEAKER_ID),
    lengthScale: parseOptionalFloat(process.env.PIPER_TTS_LENGTH_SCALE) ?? 1.02,
    noiseScale: parseOptionalFloat(process.env.PIPER_TTS_NOISE_SCALE) ?? 0.55,
    noiseW: parseOptionalFloat(process.env.PIPER_TTS_NOISE_W) ?? 0.8,
    sentenceSilence: parseOptionalFloat(process.env.PIPER_TTS_SENTENCE_SILENCE) ?? 0.24,
};
const configuredPiperVoices = loadConfiguredPiperVoices(piperVoiceDefaults);
const configuredAudioProviders = buildAudioProviderCandidates();
const normalizedPiperMaxTextChars = Math.max(
    200,
    parseInt(process.env.PIPER_TTS_MAX_TEXT_CHARS, 10) || 2400,
);
const normalizedPiperTimeoutMs = Math.max(
    1000,
    parseInt(process.env.PIPER_TTS_TIMEOUT_MS, 10) || 45000,
);
const normalizedPiperPodcastTimeoutMs = Math.max(
    normalizedPiperTimeoutMs,
    parseInt(process.env.PIPER_TTS_PODCAST_TIMEOUT_MS, 10) || 180000,
);
const normalizedPiperPodcastChunkChars = Math.max(
    250,
    Math.min(
        normalizedPiperMaxTextChars,
        parseInt(process.env.PIPER_TTS_PODCAST_CHUNK_CHARS, 10) || Math.min(900, normalizedPiperMaxTextChars),
    ),
);

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
        provider: 'piper',
        piper: {
            enabled: process.env.PIPER_TTS_ENABLED !== 'false',
            binaryPath: resolveConfigPath(process.env.PIPER_TTS_BINARY_PATH || resolveBundledPiperBinaryPath() || 'piper'),
            voicesPath: configuredPiperVoices.voicesPath,
            voices: configuredPiperVoices.voices,
            modelPath: resolveConfigPath(process.env.PIPER_TTS_MODEL_PATH || ''),
            configPath: resolveConfigPath(process.env.PIPER_TTS_CONFIG_PATH || ''),
            voiceId: piperVoiceDefaults.id,
            defaultVoiceId: process.env.PIPER_TTS_DEFAULT_VOICE_ID
                || configuredPiperVoices.voices.find((voice) => voice.id === 'hfc-female-rich')?.id
                || configuredPiperVoices.voices[0]?.id
                || piperVoiceDefaults.id,
            voiceLabel: piperVoiceDefaults.label,
            voiceDescription: piperVoiceDefaults.description,
            speakerId: parseOptionalInteger(process.env.PIPER_TTS_SPEAKER_ID),
            lengthScale: parseOptionalFloat(process.env.PIPER_TTS_LENGTH_SCALE) ?? 1.02,
            noiseScale: parseOptionalFloat(process.env.PIPER_TTS_NOISE_SCALE) ?? 0.55,
            noiseW: parseOptionalFloat(process.env.PIPER_TTS_NOISE_W) ?? 0.8,
            sentenceSilence: parseOptionalFloat(process.env.PIPER_TTS_SENTENCE_SILENCE) ?? 0.24,
            maxTextChars: normalizedPiperMaxTextChars,
            timeoutMs: normalizedPiperTimeoutMs,
            podcastTimeoutMs: normalizedPiperPodcastTimeoutMs,
            podcastChunkChars: normalizedPiperPodcastChunkChars,
        },
    },

    audio: {
        apiKey: configuredAudioProviders[0]?.apiKey || '',
        baseURL: configuredAudioProviders[0]?.baseURL || 'https://api.openai.com/v1',
        providerCandidates: configuredAudioProviders,
        transcriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe',
        fallbackModels: parseOptionalStringList(process.env.OPENAI_TRANSCRIPTION_FALLBACK_MODELS),
        maxUploadBytes: Math.max(
            1024 * 1024,
            parseInt(process.env.OPENAI_TRANSCRIPTION_MAX_UPLOAD_BYTES, 10) || (25 * 1024 * 1024),
        ),
    },

    audioProcessing: {
        enabled: process.env.AUDIO_PROCESSING_ENABLED !== 'false',
        ffmpegBinaryPath: resolveConfigPath(process.env.FFMPEG_BINARY_PATH || 'ffmpeg'),
        timeoutMs: Math.max(
            1000,
            parseInt(process.env.AUDIO_PROCESSING_TIMEOUT_MS, 10) || 90000,
        ),
        mp3BitrateKbps: Math.max(
            64,
            parseInt(process.env.PODCAST_MP3_BITRATE_KBPS, 10) || 192,
        ),
        podcastMasteringEnabled: process.env.PODCAST_MASTERING_ENABLED !== 'false',
        podcastMasteringLufs: parseOptionalFloat(process.env.PODCAST_MASTERING_LOUDNESS_LUFS) ?? -16,
        podcastMasteringTruePeakDb: parseOptionalFloat(process.env.PODCAST_MASTERING_TRUE_PEAK_DB) ?? -1.5,
        podcastIntroPath: resolveConfigPath(process.env.PODCAST_INTRO_PATH || ''),
        podcastOutroPath: resolveConfigPath(process.env.PODCAST_OUTRO_PATH || ''),
        podcastMusicBedPath: resolveConfigPath(process.env.PODCAST_MUSIC_BED_PATH || ''),
        podcastSpeechVolume: parseOptionalFloat(process.env.PODCAST_SPEECH_VOLUME) ?? 1,
        podcastMusicVolume: parseOptionalFloat(process.env.PODCAST_MUSIC_VOLUME) ?? 0.22,
        podcastIntroVolume: parseOptionalFloat(process.env.PODCAST_INTRO_VOLUME) ?? 1,
        podcastOutroVolume: parseOptionalFloat(process.env.PODCAST_OUTRO_VOLUME) ?? 1,
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
        respectRobotsTxt: process.env.WEB_SCRAPE_RESPECT_ROBOTS_TXT !== 'false',
        robotsTimeoutMs: Math.max(
            1000,
            parseInt(process.env.WEB_SCRAPE_ROBOTS_TIMEOUT_MS, 10) || 8000,
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
        defaultPublicDomain: process.env.KIMIBUILT_DEPLOY_PUBLIC_DOMAIN || 'demoserver2.buzz',
        defaultIngressClassName: process.env.KIMIBUILT_DEPLOY_INGRESS_CLASS || 'traefik',
        defaultTlsClusterIssuer: process.env.KIMIBUILT_DEPLOY_TLS_CLUSTER_ISSUER || 'letsencrypt-prod',
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
        judgmentV2Enabled: process.env.RUNTIME_JUDGMENT_V2_ENABLED === 'true',
        plannerModel: process.env.OPENAI_PLANNER_MODEL || '',
        synthesisModel: process.env.OPENAI_SYNTHESIS_MODEL || '',
        repairModel: process.env.OPENAI_REPAIR_MODEL || '',
        plannerReasoningEffort: process.env.OPENAI_PLANNER_REASONING_EFFORT || '',
        synthesisReasoningEffort: process.env.OPENAI_SYNTHESIS_REASONING_EFFORT || '',
        repairReasoningEffort: process.env.OPENAI_REPAIR_REASONING_EFFORT || '',
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
